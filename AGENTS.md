# C.Verse Platform — AGENTS.md

Monorepo (`pnpm` workspaces): React 19/Vite SPA (`apps/web` → Cloudflare Pages), Hono 4 API (`apps/api` → Cloudflare Workers; Node for local dev), React 19 admin SPA (`apps/admin` → VPS behind Cloudflare Tunnel + Access), shared Zod schemas & constants (`packages/shared`). C.Card MVP — 11 flows. Supabase Postgres + Cloudflare R2.

Architecture: **fat database, thin API**. All money/stock mutations run inside Postgres SECURITY DEFINER RPCs (`supabase/migrations/04_rpc.sql`) through the `apps/api/src/lib/db.ts` facade — single-transaction by construction. Routes only verify auth → validate (zValidator) → call RPC → map errors. Reads go through selector modules. The browser holds only the anon key — RLS is the real enforcement layer.

## Docs

- Canonical planning docs: `docs/` (`00_readme` … `16_foundation_cleanup`, 17 files, read in order) — enough for all codebase work; do not read the spec repo.
- `docs/` is a byte-identical mirror of `00_Dream_Project/dev-strategy/` in the separate spec repo (`C:\Users\iqbal\Documents\C-Verse\00_Dream_Project`), synced both ways. **Codebase = source of truth.** Every `docs/` edit must be committed to BOTH repos (`pnpm sync:docs` after committing here). AGENTS.md is not mirrored.

## Environment

- Node >= 20, `pnpm@12.0.0` (lockfile v9) — never npm/yarn. Install: `pnpm install` at root (workspaces `apps/*` + `packages/*`).
- Dev all: `pnpm dev` (API :8787 + web :5173; web proxies `/api` → 8787). Admin: `pnpm --filter @c-verse/admin dev` (:3000).
- API dev: `pnpm --filter @c-verse/api dev:node` (tsx watch, :8787) or `dev` (wrangler dev — needs `wrangler.toml` bindings).
- Env files (copy each app's `.env.example`):
  - `apps/web/.env.local` — `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY`, `VITE_TURNSTILE_SITE_KEY`. Anon only — service-role keys must NEVER enter web/admin bundles.
  - `apps/admin/.env.local` — anon key + `VITE_API_URL` (dev `http://localhost:8787`; empty = same-origin), `VITE_TURNSTILE_SITE_KEY`.
  - `apps/api/.dev.vars` — `SUPABASE_URL`/`SUPABASE_ANON_KEY`/`SUPABASE_SERVICE_ROLE_KEY`, `TURNSTILE_SECRET_KEY`, `NFC_MASTER_KEY`, `MIDTRANS_*`, `PAYOUT_WEBHOOK_SIGNING_KEY`, SMTP. One file serves Wrangler and Node.
  - Prod secrets: `wrangler secret put` (+ `CF_ACCOUNT_ID`, `CF_API_TOKEN`) — never in the repo.
- API fails fast without `SUPABASE_URL` — the DB is mandatory, no in-memory fallback.

## Supabase (linked cloud project `c-verse` — no local stack)

- Query/verify: `npx supabase db query --linked "SQL"` — `--linked` is MANDATORY; without it the CLI silently targets a local DB. Multi-statement OK. Linter: `npx supabase db advisors --linked`. (No `db execute` subcommand; no `psql` in PATH.)
- Apply migrations + reseed: `"y" | npx supabase db reset --linked` — WIPES ALL cloud data. Owner confirmation required every time; the `"y"` pipe is mandatory (non-interactive shells die with `context canceled` on the `[y/N]` prompt). Edits to already-applied migrations are never re-applied by `db push` — reset is the way to apply them.
- `supabase/migrations/`: 5 consolidated files, every object written ONCE in final form (no `create or replace` chains): `01_schema` (DDL/enums/tables), `02_auth` (auth mirror + canonical email), `03_rls` (policies + guard triggers), `04_rpc` (all SECURITY DEFINER RPCs + grants), `05_indexes` (performance). Never edit an applied migration.
- Local stack (`npx supabase start`) only on explicit request.

## Quality gates

- `pnpm run typecheck` — `tsc --noEmit`, strict, 4 workspaces (shared/api/web/admin).
- `pnpm test` — Vitest (shared + api + admin).
- `pnpm run lint` — Biome, 0 errors / 0 warnings hard gate. Auto-fix: `pnpm run lint:fix`, `pnpm run format`.
- `pnpm run build` — all workspaces. Note: api build = `tsc --noEmit` only; deploy = `pnpm --filter @c-verse/api deploy`.
- Module boundaries: `pnpm --filter @c-verse/api lint:boundaries` (see Layout).
- CI (`.github/workflows/ci.yml`, PR + main): install → typecheck → lint → lint:boundaries → test → build, plus `supabase db lint` on PRs.
- Integration SQL: run `supabase/tests/*.sql` via `db query --linked "$(cat file.sql)"`, then a `reset --linked` to clear fixtures.

## Layout

- `apps/api/src/index.ts` — composition root: mounts 18 modules under `/api/*`, alias `/api/listings` → marketplace, `scheduled` handler → `lib/cron.ts` (drop activation/draw, payout batch). `server.ts` = local Node entry.
- `apps/api/src/modules/<name>/` — one module per domain: auth, drops, orders, wallet, nfc, marketplace, bids, browse, profile, publicProfile, shipments, gamification, creators, kyc, seo, notifications, payments, admin. Each has `routes.ts` + a one-line `index.ts` (the only legal import surface from outside), `reads.ts` when its selectors have a single consumer, unit tests in `__tests__/`. Boundary rules (`apps/api/tools/check-boundaries.mjs`): `lib/` never imports `modules/`; anything outside a module may import only that module's `index.ts`.
- `apps/api/src/lib/` — kernel: `auth.ts` (JWT verify, `requireUser`), `db.ts` (RPC facade; the client uses the user's JWT so RPCs see `auth.uid()`), `reads.ts` + `reads/` (multi-consumer selectors, snake→camel mappers), `errors.ts` (`sanitizeDbError`), `cmac.ts` (AES-CMAC RFC 4493 + SUN AN12196), `payments/` (Midtrans), `cron.ts`, `supabase.ts` (fail-fast client), `store.ts` (domain types, `uid`/`nowIso`).
- `apps/web/src/` — public SPA (`App.tsx` routes, `pages/`, `lib/api.ts`). `apps/admin/src/` — separate admin SPA (Supabase MFA `aal2`).
- `packages/shared/src/index.ts` — single source of Zod schemas + business constants (rates, fee shares, caps, `calcLevel`, `calcSignedPrice`). Import via `@c-verse/shared` — never hardcode rates/fees/thresholds in apps.
- `supabase/` — `config.toml`, `migrations/`, `seed.sql` (fixed UUIDs in `auth.users`), `tests/` (SQL + `.mjs` integration tests).
- `sync-docs.mjs` (root) — docs mirror: `pnpm sync:docs` (apply) / `:check` (dry-run) / `:reverse`. Never auto-commits.

## Domain rules

- Auth: Supabase JWT (Google OAuth / email OTP + Turnstile) via `requireUser(c)` on every route; 401 invalid, 403 suspended (`flag_reason`). **Passwordless everywhere** — web: OAuth/OTP; admin: email OTP + MFA `aal2` + Cloudflare Access. Demo-login `POST /api/auth/demo-login` is dev-only (`ENABLE_DEMO_LOGIN` + seed-email whitelist).
- Confirmations: every spend/destructive action in web & admin MUST go through the in-app `useConfirm()` modal (D8) — native `window.confirm` is banned.
- C-Coin: integers only (`CHECK >= 1`), IDR→C-Coin = `ceil`, `int` columns — never numeric/decimal.
- Revenue: every settlement writes `platform_revenue` + credits the treasury system user via `record_platform_revenue` — primary 70/30; secondary 15% = 7.5 platform / 7.5 royalty / 85 seller; shipment fees (`ref_type 'shipment'`). Platform revenue must never evaporate.
- Drops: admin-only create/cancel/status. `priceCcoin` canonical; `signedCount = ceil(total/10)`; signed premium = +20 flat; release 12:00 WIB; raffle window 24h (`raffle_end_at`), draw via cron; `scheduled→live` auto via cron.
- Purchases settle straight to vault — no address/shipping at buy time; card `location='platform_vault'`, order `settled`. Shipping is ONE post-vault flow: owner requests `vault_shipout`, fee charged there. Seed sales: two-phase (escrow_hold → admin vault-in + verify → release); abort via `cancel_seed_sale`.
- Secondary: buyout (max 20 active/user) and direct bids (1 active/card, max 3 active/user, accept-only, no expiry, 90-day history). The 24h rebuy cooldown (C-12) applies in BOTH `buyout_card` and `place_bid`. Tampered/defect/lost cards are not tradable.
- NFC: `verified` ONLY via valid CMAC + forward-only counter (atomic `UPDATE ... WHERE last_ctr < ctr`); QR caps at `registered`; tamper = permanent + audit log. Tap → `/cards/:cardId/3d`, QR → `/cards/:cardId`; iOS SUN URL via `GET /api/nfc/sun-verify`.
- KYC: required for payouts (`payout_request` gate; `hold_payout_until` fraud hold); non-KYC top-up balance cap 500 C-Coin; not required for buyout/bid acceptance.
- Payments: top-up via Midtrans Snap → webhook verifies signature + status + ceil. Payout: request (funds locked) → weekly batch → admin transfers MANUALLY via IRIS (auto-disburse = post-MVP) → optional IRIS webhook. Refund: `payout_refund` RPC for failed/aborted payouts.
- Admin mutations: only via role-gated API routes (`/api/admin/*`, KYC approve, drop/shipment status PATCHes) — all appended to `admin_audit_log` (append-only).
- Gamification: `level = floor(total_xp/10) + 1` (clamp 1..100); spend 1 C = 1 XP (badge rewards via SQL trigger); top-ups give no XP. Leaderboard: RPC `get_leaderboard` (`xp|cards|badges|creator`, deterministic tie-break) via `GET /api/gamification/leaderboard`.
- Profiles: `/u/:username`, `/c/:username`; `is_anonymous` hides collection/level/badges; suspended users are hidden from public profiles.
- Errors: never echo raw Supabase/Postgres `error.message` (leaks schema) — map through `lib/errors.ts:sanitizeDbError`; log raw server-side.
- Seed dev (fixed UUIDs; login via OTP/Google): `demo@cverse.id`, `admin@cverse.id`, `karina@creator.id`; roles user/creator/admin. Creator accounts are admin-provisioned — there is no self-apply route.

## Pitfalls

- Destructive ops (`db reset --linked`, drop database, force-push): STOP and ask the owner first; then execute non-interactively with the `"y"` pipe (see Supabase).
- Windows shell is git-bash (POSIX, not PowerShell) — convert paths with `cygpath -w`.
- Ports 8787/5173/3000 must be free; `scripts-dev.mjs` kills children on SIGINT/SIGTERM.
- `.env*`, `.dev.vars`, `.wrangler/`, `supabase/.temp` are gitignored — never commit secrets; public bundles get only anon keys.
- Do not reintroduce: password login, auction timers/anti-sniping (C-07, post-MVP), in-memory stores, decimal C-Coin.
- AGENTS.md/README: stay concise — facts once, no repeating infra disclaimers.

## Commit workflow

Run before EVERY commit, in order: `pnpm run format` → `pnpm run lint:fix` → `pnpm run typecheck` → `pnpm test` → `pnpm run lint` (0/0) → `pnpm run build`. A failure in typecheck/test/lint/build = do not commit; fix first. Stage explicit paths (never `-A`/`.`).

- Conventional Commits (`fix:`, `feat:`, `refactor:`, `docs:`, `test:`, `chore:`, `tools:`, `perf:`); audit/security fixes as `fix(audit):` / `fix(security):`.
- One atomic commit per logical unit. TDD: failing test first (Red) → implement (Green) → gates → commit. RPC route tests mock `lib/db.js` (not `lib/supabase.js`) — the user-scoped client lives there.
- Docs changes: run `pnpm sync:docs` after the commit, then commit the mirror in the spec repo.

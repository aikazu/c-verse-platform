# C.Verse Platform — AGENTS.md

Monorepo (`pnpm` workspaces): React 19/Vite SPA (`apps/web` → Cloudflare Workers Static Assets di `dev.c-verse.co`), Hono 4 API privat (`apps/api` → Cloudflare Worker via Service Binding; Node untuk local dev), React 19 admin SPA (`apps/admin` → Cloudflare Worker + Access/WARP), shared Zod schemas & constants (`packages/shared`). C.Card MVP — 11 flows. Supabase Postgres + Cloudflare R2.

Architecture: **fat database, thin API**. All money/stock mutations run inside Postgres SECURITY DEFINER RPCs (`supabase/migrations/07`–`17` RPC files) through the `apps/api/src/lib/db.ts` facade — single-transaction by construction. Routes only verify auth → validate (zValidator) → call RPC → map errors. Reads go through selector modules. The browser holds only the anon key — RLS is the real enforcement layer.

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
  - `apps/api/.dev.vars` — `SUPABASE_URL`/`SUPABASE_ANON_KEY`/`SUPABASE_SERVICE_ROLE_KEY`, `NFC_MASTER_KEY`, `MIDTRANS_*`, `PAYOUT_WEBHOOK_SIGNING_KEY`, `EMAIL_ENABLED`/`EMAIL_FROM`/`ADMIN_ALERT_EMAIL` (Cloudflare Email Service; SMTP dropped). One file serves Wrangler and Node.
  - Prod secrets: `wrangler secret put` (+ `CF_ACCOUNT_ID`, `CF_API_TOKEN`) — never in the repo.
- API fails fast without `SUPABASE_URL` — the DB is mandatory, no in-memory fallback.

## Supabase (local stack = standard test bench)

- `supabase/migrations/`: 18 numbered SQL files (lexical order = execution order, each ≤300 LoC), every object written ONCE in final form (no `create or replace` chains): 01–03 schema (DDL/enums/tables, indexes, grants), 04 auth (auth mirror + canonical email), 05–06 RLS (policies + guard triggers), 07–17 RPC (all SECURITY DEFINER RPCs + grants), 18 indexes (performance). Never edit an applied migration; `db push` never re-applies edits to applied files — changes land via a reset.
- LOCAL stack is the standard test bench: `npx supabase start` (needs Docker), then `npx supabase db reset` (local) applies migrations + seed.sql. Integration tests in `supabase/tests/` run against the local DB (`postgresql://postgres:postgres@127.0.0.1:54322/postgres`) via `node <test>.mjs <url>` or plain `db query`; a local `db reset` clears fixtures. Local auth emails are magic links (not OTP codes), visible in Mailpit :54324. Local reset is routine — no confirmation needed.

## Quality gates

- `pnpm run typecheck` — `tsc --noEmit`, strict, 4 workspaces (shared/api/web/admin).
- `pnpm test` — Vitest (shared + api + admin).
- `pnpm test:e2e` — Playwright from repo root (`playwright.config.ts`): webServer auto-starts/reuses API :8787, web :5173, admin :3000 (Turnstile suppressed on servers it starts); needs the local Supabase stack.
- `pnpm run lint` — Biome, 0 errors / 0 warnings hard gate. Auto-fix: `pnpm run lint:fix`, `pnpm run format`.
- `pnpm run build` — all workspaces. Note: api build = `tsc --noEmit` only; deploy = `pnpm --filter @c-verse/api run deploy`.
- Module boundaries: `pnpm --filter @c-verse/api lint:boundaries` (see Layout).
- CI (`.github/workflows/ci.yml`, PR + main): install → typecheck → lint → lint:boundaries → test → build, plus PR-only `supabase db lint` and Playwright e2e (webServer auto-start/reuse) on PRs.
- Integration tests: run `supabase/tests/*` against the LOCAL stack (`.mjs` via `node <test>.mjs postgresql://postgres:postgres@127.0.0.1:54322/postgres`; SQL via plain `db query "$(cat file.sql)"`), then a local `db reset` to clear fixtures. `rpc_nfc_replay_test.mjs` needs `NFC_MASTER_KEY` in env (from `apps/api/.dev.vars`, generate: `openssl rand -hex 16`) or it skips.

## Layout

- `apps/api/src/index.ts` — composition root: mounts 17 modules under `/api/*`, alias `/api/listings` → marketplace, `scheduled` handler → `lib/cron.ts` (drop activation/draw, payout batch). `server.ts` = local Node entry.
- `apps/api/src/modules/<name>/` — one module per domain: auth, drops, orders, wallet, nfc, marketplace, bids, profile, publicProfile, shipments, gamification, creators, kyc, seo, notifications, payments, admin. Each has `routes.ts` + a one-line `index.ts` (the only legal import surface from outside), `reads.ts` when its selectors have a single consumer, unit tests in `__tests__/`. Boundary rules (`apps/api/tools/check-boundaries.mjs`): `lib/` never imports `modules/`; anything outside a module may import only that module's `index.ts`.
- `apps/api/src/lib/` — kernel: `auth.ts` (JWT verify, `requireUser`), `db.ts` (RPC facade; the client uses the user's JWT so RPCs see `auth.uid()`), `reads.ts` + `reads/` (multi-consumer selectors, snake→camel mappers), `errors.ts` (`sanitizeDbError`), `cmac.ts` (AES-CMAC RFC 4493 + SUN AN12196), `payments/` (Midtrans), `cron.ts`, `supabase.ts` (fail-fast client), `store.ts` (domain types, `uid`/`nowIso`).
- `apps/web/src/` — public SPA (`App.tsx` routes, `pages/`, `lib/api.ts`). `apps/admin/src/` — separate admin SPA; login email OTP, protected by Access/WARP plus server-side admin role and suspension checks.
- `packages/shared/src/index.ts` — single source of Zod schemas + business constants (rates, fee shares, caps, `calcLevel`, `calcSignedPrice`). Import via `@c-verse/shared` — never hardcode rates/fees/thresholds in apps.
- `supabase/` — `config.toml`, `migrations/`, `seed.sql` (fixed UUIDs in `auth.users`), `tests/` (SQL + `.mjs` integration tests).
- `sync-docs.mjs` (root) — docs mirror: `pnpm sync:docs` (apply) / `:check` (dry-run) / `:reverse`. Never auto-commits.

## Domain rules

- Auth: Supabase JWT (Google OAuth / email OTP + Turnstile) via `requireUser(c)` on every route; 401 invalid, 403 suspended (`flag_reason`). **Passwordless everywhere** — web: OAuth/OTP; admin: email OTP + Cloudflare Access/WARP. Privileged admin routes enforce server-side role and suspension checks; do not add mandatory application MFA/TOTP, globally disable MFA, or unenroll user factors. Demo-login `POST /api/auth/demo-login` is dev-only (`ENABLE_DEMO_LOGIN` + seed-email whitelist).
- Confirmations: every spend/destructive action in web & admin MUST go through the in-app `useConfirm()` modal (D8) — native `window.confirm` is banned.
- C-Coin: integers only (`CHECK >= 1`), IDR→C-Coin = `ceil`, `int` columns — never numeric/decimal.
- Revenue: every settlement writes `platform_revenue` + credits the treasury system user via `record_platform_revenue` — primary 70/30; secondary 15% = 7.5 platform / 7.5 royalty / 85 seller; shipment fees (`ref_type 'shipment'`). Platform revenue must never evaporate.
- Drops: admin-only create/cancel/status. `priceCcoin` canonical; `signedCount = ceil(total/10)`; signed premium = +20 flat; release 12:00 WIB; raffle window 24h (`raffle_end_at`), draw via cron; `scheduled→live` auto via cron. Reads: `GET /api/drops/:id` adds `winners` once drawn ({unitNumber, variant, displayName}); `GET /api/drops/:id/cards` lists all units (isOwned, no identity).
- Support: `POST /api/wallet/support` → RPC `send_support` — 100% to the creator (no `platform_revenue`), sender XP 1:1, min 1 C-Coin, target must be an active creator. `/browse` is per-drop tile grid → drop detail; there is no `/api/browse` module.
- Purchases settle straight to vault — no address/shipping at buy time; card `location='platform_vault'`, order `settled`. Shipping is ONE post-vault flow: owner requests `vault_shipout`, fee charged there. Seed sales: two-phase (escrow_hold → admin vault-in + verify → release); abort via `cancel_seed_sale`.
- Secondary: buyout (max 20 active/user) and direct bids (1 active/card, max 3 active/user, accept-only, no expiry, 90-day history, cancellable only 24h after placement — `BID_CANCEL_COOLDOWN`). The 24h rebuy cooldown (C-12) applies in BOTH `buyout_card` and `place_bid`. Secondary prices below 3 C-Coin are rejected (`SECONDARY_PRICE_TOO_SMALL`). Tampered/defect/lost cards are not tradable.
- NFC: `verified` ONLY via valid CMAC + forward-only counter (atomic `UPDATE ... WHERE last_ctr < ctr`); QR caps at `registered`; tamper = permanent + audit log. Tap → `/cards/:cardId/3d`, QR → `/cards/:cardId`; iOS SUN URL via `GET /api/nfc/sun-verify`.
- KYC: required for payouts (`payout_request` gate; `hold_payout_until` fraud hold); non-KYC top-up balance cap 500 C-Coin; not required for buyout/bid acceptance.
- Payments: top-up via Midtrans Snap → webhook verifies signature + status + ceil. Payout: request (funds locked) → weekly batch → admin transfers MANUALLY via IRIS (auto-disburse = post-MVP) → optional IRIS webhook. Refund: `payout_refund` RPC for failed/aborted payouts.
- Admin mutations: only via role-gated API routes (`/api/admin/*`, KYC approve, drop/shipment status PATCHes) — all appended to `admin_audit_log` (append-only).
- Gamification: `level = floor(total_xp/10) + 1` (clamp 1..100); spend 1 C = 1 XP (badge rewards via SQL trigger); top-ups give no XP. Leaderboard: RPC `get_leaderboard` (`xp|cards|badges|creator`, deterministic tie-break) via `GET /api/gamification/leaderboard`.
- Profiles: `/u/:username`, `/c/:username`; `is_anonymous` hides collection/level/badges; suspended users are hidden from public profiles. Display names of anonymous/suspended users render as "Anonim" in public lists (marketplace seller, bids bidder, drop winners, ownership history).
- Errors: never echo raw Supabase/Postgres `error.message` (leaks schema) — map through `lib/errors.ts:sanitizeDbError`; log raw server-side.
- Seed dev (fixed UUIDs; login via OTP/Google): `demo@cverse.id`, `admin@cverse.id`, `karina@creator.id`; roles user/creator/admin. Creator accounts are admin-provisioned — there is no self-apply route.

## Pitfalls

- Destructive ops (drop database, force-push): STOP and ask the owner first.
- Windows shell is git-bash (POSIX, not PowerShell) — convert paths with `cygpath -w`.
- Dev servers: start what you need without asking — probe first; reuse an already-running healthy service (never collide); restart is fine when needed (stale cache). No duplicate/zombie processes: stop what you started when done; Windows orphan gotcha — TaskStop doesn't kill children (check `netstat -ano`, kill orphan node PIDs). `scripts-dev.mjs` kills children on SIGINT/SIGTERM.
- `.env*`, `.dev.vars`, `.wrangler/`, `supabase/.temp` are gitignored — never commit secrets; public bundles get only anon keys.
- Do not reintroduce: password login, auction timers/anti-sniping (C-07, post-MVP), in-memory stores, decimal C-Coin.
- AGENTS.md/README: stay concise — facts once, no repeating infra disclaimers.

## Commit workflow

Run before EVERY commit, in order: `pnpm run format` → `pnpm run lint:fix` → `pnpm run typecheck` → `pnpm test` → `pnpm run lint` (0/0) → `pnpm run build`. A failure in typecheck/test/lint/build = do not commit; fix first. Stage explicit paths (never `-A`/`.`).

- Conventional Commits (`fix:`, `feat:`, `refactor:`, `docs:`, `test:`, `chore:`, `tools:`, `perf:`); audit/security fixes as `fix(audit):` / `fix(security):`.
- One atomic commit per logical unit. TDD: failing test first (Red) → implement (Green) → gates → commit. RPC route tests mock `lib/db.js` (not `lib/supabase.js`) — the user-scoped client lives there.
- Docs changes: run `pnpm sync:docs` after the commit, then commit the mirror in the spec repo.

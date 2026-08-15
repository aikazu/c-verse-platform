# C.Verse Platform — AGENTS.md

Monorepo `pnpm` workspaces: React 19/Vite SPA (`apps/web` → Cloudflare Pages) + Hono 4 API (`apps/api` → Cloudflare Workers / Node) + React 19/Vite Admin (`apps/admin` → VPS + Cloudflare Tunnel + Access) + shared Zod schemas/constants (`packages/shared`). C.Card MVP — 9 flows. Supabase Postgres (SG) + Cloudflare R2.

Dokumen perencanaan **canonical = `docs/`** (`00_readme` → `09_recommendations`, 10 files, `[VALIDATED]`). Jangan baca `00_Dream_Project/`.

## Dev environment

- Requires Node >=20 and `pnpm@9.12.3` — do not use npm/yarn. Lockfile `pnpm-lock.yaml` v9.
- `pnpm install` at repo root (workspaces: `apps/*` + `packages/*`).
- Env — template per app (copy dari `.env.example` di masing-masing folder):
  - `apps/web/.env.local` ← `apps/web/.env.example`: `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY`, `VITE_TURNSTILE_SITE_KEY`, `VITE_ENABLE_DEMO_LOGIN`. Anon only — service-role DILARANG di web bundle.
  - `apps/admin/.env.local` ← `apps/admin/.env.example`: `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` (anon + MFA aal2, di belakang Cloudflare Access).
  - `apps/api/.dev.vars` ← `apps/api/.env.example` (satu file untuk Wrangler & Node): `SUPABASE_URL`/`SUPABASE_ANON_KEY`/`SUPABASE_SERVICE_ROLE_KEY`, `TURNSTILE_SECRET_KEY`, `NFC_MASTER_KEY`, `MIDTRANS_*`, `PAYOUT_WEBHOOK_SIGNING_KEY`, SMTP.
  - Secrets prod (tidak di repo): sama seperti di atas + `CF_ACCOUNT_ID`, `CF_API_TOKEN` via `wrangler secret put`.
- Supabase WAJIB — tanpa `SUPABASE_URL` API gagal start (fail-fast, tidak ada fallback in-memory).
- Supabase local (wajib untuk dev): `npx supabase start` (API :54321, DB :54322, Studio :54323), `npx supabase db reset` → `supabase/migrations/*.sql` + `supabase/seed.sql`.

## Build & test

- Jalankan semua: `pnpm dev` (`scripts-dev.mjs` → API :8787 + web :5173). Admin terpisah: `pnpm --filter @c-verse/admin dev` → :3000.
- Per app:
  - `pnpm --filter @c-verse/api dev:node` — Hono via `@hono/node-server` + `tsx watch src/server.ts` :8787
  - `pnpm --filter @c-verse/api dev` — `wrangler dev --port 8787` (Workers runtime, butuh `wrangler.toml` bindings)
  - `pnpm --filter @c-verse/web dev` — `vite --host 0.0.0.0 --port 5173` (proxy `/api` → `http://localhost:8787`)
  - `pnpm --filter @c-verse/admin dev` — `vite --host 127.0.0.1 --port 3000`
- Typecheck: `pnpm run typecheck` (`pnpm -r typecheck` → `tsc --noEmit` per package; 4 workspaces: shared, api, web, admin)
- Test: `pnpm test` (Vitest; proyek `packages/shared` + `apps/api`). Lint: `pnpm lint` (Biome, 0 error/warning hard gate). Format: `pnpm format`.
- Integration SQL (RPC/RLS) butuh `npx supabase start` (Docker): `psql ... -f supabase/tests/rls_test.sql`.
- Build: `pnpm run build` (`pnpm -r build`); `pnpm --filter @c-verse/web build` → `apps/web/dist`, `pnpm --filter @c-verse/admin build` → `apps/admin/dist`, `pnpm --filter @c-verse/api build` = `tsc --noEmit` only. Workers deploy: `pnpm --filter @c-verse/api deploy` (`wrangler deploy`).
- Lint: `pnpm run lint` = no-op (`echo "no lint configured"`).
- CI: `.github/workflows/ci.yml` (PR + main): `pnpm install → typecheck → lint → test → build` + `supabase db lint` di PR.

## Project layout

- `apps/api/src/index.ts` — Hono app (CORS + logger, mounts `/api/*`, JSON 404). `apps/api/src/server.ts` — Node entry lokal.
- `apps/api/src/routes/` — `auth.ts`, `drops.ts`, `orders.ts`, `wallet.ts`, `nfc.ts`, `marketplace.ts` (buyout-on-card; alias `/api/listings`), `bids.ts`, `browse.ts`, `profile.ts`, `publicProfile.ts`, `shipments.ts`, `gamification.ts`, `creators.ts`, `kyc.ts`, `seo.ts`, `payments.ts` (Midtrans).
- `apps/api/src/lib/` — `auth.ts` (Supabase JWT verify + `requireUser`), `cmac.ts` (AES-CMAC RFC 4493 + SUN AN12196), `db.ts` (RPC facade — klien pakai JWT user karena RPC baca `auth.uid()`), `reads.ts` + `reads/` (domain selectors — Supabase select + mapper snake_case→camelCase; semua route read lewat sini), `cron.ts` (scheduled handler → `escrow_auto_release`/`draw_pending_drops`/`payout_batch_run`), `payments/` (provider + midtrans), `supabase.ts` (klien wajib — throw saat env absen).
- `apps/api/src/lib/store.ts` — domain types (dipakai mapper/route) + helper murni `uid`/`nowIso`. Tidak ada lagi data in-memory.
- `apps/web/src/` — `App.tsx` (routes: `/`, `/drops`, `/drops/:id/checkout`, `/home`, `/cards/:cardId/3d`, `/marketplace`, `/browse`, `/collection`, `/me/manage`, `/me/privacy`, `/me/kyc`, `/wallet`, `/leaderboard`, `/c/:username`, `/u/:username`, `/creator`) + `pages/` + `lib/api.ts` + `worker-seo.ts`.
- `apps/admin/src/` — Vite SPA terpisah (Guard `aal2` via Supabase MFA TOTP, nav ADM-01..10: dashboard/creators/drops/orders/nfc/payouts/badges/disputes/audit/investor).
- `packages/shared/src/index.ts` — **single source** Zod schemas + constants (`C_COIN_RATE_IDR=10_000`, `SECONDARY_*`, `REVENUE_SHARE_*`, `calcLevel`, `KYC_TRIGGER 99`, `MAX_BUYOUT 20`). Import via `@c-verse/shared`.
- `supabase/` — `config.toml`, `migrations/*.sql` (auth uuid + RLS matrix + RPC atomic), `seed.sql` (fixed UUID = `auth.users`), `tests/rls_test.sql`.
- `docs/` — `00_readme.md` … `09_recommendations.md` (10 files). Baca urut 01→09.

## Conventions

- ESM only (`"type": "module"`), Strict TS (`strict: true`, `moduleResolution: bundler`).
- API: `Hono` + `zValidator` dengan schema dari `@c-verse/shared`. Mount via `app.route("/api/<name>", module)` di `apps/api/src/index.ts`. Alias `/api/listings` → marketplace (buyout).
- Auth: Supabase JWT (Google OAuth + email OTP + Turnstile) — `requireUser(c)` di semua route; 401 invalid, 403 suspend (`flag_reason`). Register/login password DILARANG. Demo-login dihapus (butuh Supabase).
- Uang & stok: wajib lewat RPC (`apps/api/src/lib/db.ts`: checkout, drop_entry/draw, place/cancel/accept bid, set_buyout/buyout_card, wallet_credit/debit — single transaction). DB wajib — fail-fast tanpa `SUPABASE_URL` (F-08).
- NFC: verdict `verified` HANYA via CMAC valid (`lib/cmac.ts`, key diversification N5) + counter maju. QR → maksimal `registered`. Tamper permanen.
- Shared constants canonical — jangan hard-code rate/fee/threshold di app (`idrToCCoin = Math.ceil`).
- C-Coin: **integer ≥1 tanpa desimal** (`CHECK x >= 1`), konversi IDR→C-Coin ceil. Kolom `int`, jangan `numeric`.
- Drop: `priceCcoin` canonical (platform-produced 70/30), `signedCount = ceil(total/10)`, `priceSigned = ceil(price*1.67)`.
- Checkout: 1 kartu/user/drop, `shipping` (alamat + ongkir → tracking) vs `vault` (settled langsung, `platform_vault`).
- Secondary: Marketplace `buyout_price_ccoin NOT NULL` (max 20/user); Browse bid langsung (1 active, outbid/cancel release, accept only, tanpa expire; history 90 hari). Fee 15% (7.5 platform + 7.5 royalti, snapshot di `metadata`).
- Verify: tap NFC → `/cards/:cardId/3d` (Verified), QR → `/cards/:cardId` (Registered). Ownership history hanya di info. iOS SUN URL via `GET /api/nfc/sun-verify`.
- Gamifikasi: `level = floor(total_xp/10)`, `spend 1 C = 1 XP` (+ badge `xp_reward`), top-up tidak menambah XP. Badge di `apps/admin` (ADM-07).
- Profil: `/u/:username` & `/c/:username`; `is_anonymous` hide koleksi/level/badge. Domain `c-verse.co` + `c-verse.id` redirect — LOCK sebelum NFC.
- KYC: hanya payout + top-up besar. Tidak untuk pasang buyout/accept bid. `hold_payout_until` untuk fraud hold.
- Admin: terpisah, `service-role` + Cloudflare Access + 2FA TOTP (`aal2`) + `admin_audit_log` append-only. Login admin = email OTP (magic link), tanpa password. Tidak ada route admin di API publik.
- Demo (seed `auth.users`, tanpa password — login via OTP/Google): `demo@cverse.id` (120 C-Coin), `admin@cverse.id`; creator `karina@creator.id` dll. Role `user` (legacy `collector`), `creator`, `admin`.

## Pitfalls

- Wajib `pnpm` — `pnpm-lock.yaml` v9; jangan pakai npm/yarn.
- Ports 8787 (API) + 5173 (web) + 3000 (admin) harus free; `scripts-dev.mjs` kill children on SIGINT/SIGTERM.
- `apps/api` build tidak emit — `tsc --noEmit` only; deploy = `wrangler deploy`.
- `.env`, `.env.local`, `.wrangler/`, `supabase/.temp` gitignored — jangan commit secrets; Wrangler vars di `.dev.vars`.
- `git` di Windows via git-bash: `bash` POSIX, bukan PowerShell. Konversi path dengan `cygpath -w`.
- Jangan bocorkan `service-role` / `NFC_MASTER_KEY` ke bundle publik — `apps/web` hanya `anon` key + RLS.
- Jangan ubah kolom C-Coin ke desimal; jangan buat auction timer/anti-sniping di MVP (docs 07 C-07).
- AGENTS/README: tulis ringkas. Jangan verbosity ("selalu prod & dev", "tidak pernah Supabase", disclaimer dual-env, atau penjelasan infrastruktur yang mengulang dirinya sendiri). Fakta cukup sekali; tidak perlu disclaim tiap paragraf.

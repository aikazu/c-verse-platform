# C.Verse Platform — AGENTS.md

Monorepo `pnpm` workspaces: React 19/Vite SPA (`apps/web` → Cloudflare Pages) + Hono 4 API (`apps/api` → Cloudflare Workers / Node) + React 19/Vite Admin (`apps/admin` → VPS + Cloudflare Tunnel + Access, **terpisah — TIDAK di Pages**) + shared Zod schemas/constants (`packages/shared`). C.Card MVP — 9 flows (primary drop 1 kartu/user/drop, fulfillment vault/ship, settlement escrow, NFC/QR verify melekat di halaman kartu, Marketplace buyout + Browse bid langsung, ship-from-vault, C-Coin top-up/payout closed-loop, gamifikasi via XP). Supabase Postgres (SG region) + Storage (R2 parity).

Dokumen perencanaan **canonical = `docs/`** (`00-README` → `08-deployment`, self-contained, status `[DRAFT]` kecuali dikunci founder). Jangan baca `00_Dream_Project/` lagi — `docs/` sudah ringkasan final.

## Dev environment

- Requires Node >=20 and `pnpm@9.12.3` — do not use npm/yarn. Lockfile `pnpm-lock.yaml` v9.
- `pnpm install` at repo root (workspaces: `apps/*` + `packages/*`).
- Env:
  - `apps/web/.env.local` + `apps/admin/.env.local`: `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` (anon only, RLS).
  - `apps/api/.dev.vars` (Wrangler) / `.env.local` (Node): `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` — **service-role HANYA di `apps/admin` / server, tidak pernah di-bundle `apps/web`**.
  - Secrets prod (tidak di repo): `CF_ACCOUNT_ID`, `CF_API_TOKEN`, `SMTP_HOST=smtp.sumopod.com:465 SSL`, `SMTP_USER/PASS`, `MIDTRANS_SERVER_KEY`, `NFC_MASTER_KEY`, `PAYOUT_WEBHOOK_SIGNING_KEY`. Public vars `VITE_*` boleh di-bundle.
- Tanpa Supabase, API jalan in-memory via `apps/api/src/lib/store.ts` (`ensureSeed()`).
- Supabase local (optional): `npx supabase start` (API :54321, DB :54322, Studio :54323), `npx supabase db reset` → `supabase/migrations/*.sql` + `supabase/seed.sql`. Buckets: `artwork` (public 10 MiB), `card-assets` (public 20 MiB), `kyc` (private 5 MiB).

## Build & test

- Jalankan semua: `pnpm dev` (`scripts-dev.mjs` → API :8787 + web :5173). Admin terpisah: `pnpm --filter @c-verse/admin dev` → :3000.
- Per app:
  - `pnpm --filter @c-verse/api dev:node` — Hono via `@hono/node-server` + `tsx watch src/server.ts` :8787
  - `pnpm --filter @c-verse/api dev` — `wrangler dev --port 8787` (Workers runtime, butuh `wrangler.toml` bindings)
  - `pnpm --filter @c-verse/web dev` — `vite --host 0.0.0.0 --port 5173` (proxy `/api` → `http://localhost:8787`)
  - `pnpm --filter @c-verse/admin dev` — `vite --host 127.0.0.1 --port 3000`
- Typecheck: `pnpm run typecheck` (`pnpm -r typecheck` → `tsc --noEmit` per package; 4 workspaces: shared, api, web, admin)
- Build: `pnpm run build` (`pnpm -r build`); `pnpm --filter @c-verse/web build` → `apps/web/dist`, `pnpm --filter @c-verse/admin build` → `apps/admin/dist`, `pnpm --filter @c-verse/api build` = `tsc --noEmit` only. Workers deploy: `pnpm --filter @c-verse/api deploy` (`wrangler deploy`).
- Lint: `pnpm run lint` = no-op (`echo "no lint configured"`).
- CI: *(disabled di dev — lihat `.github/workflows.disabled/`)* — aktif lagi saat siap prod: `supabase-branch-check.yml` on PR `supabase/**` → `pnpm install`, `typecheck`, `build`, `supabase db lint`.

## Project layout

- `apps/api/src/index.ts` — Hono app (CORS + logger, mounts `/api/*`, JSON 404). `apps/api/src/server.ts` — Node entry lokal.
- `apps/api/src/routes/` — `auth.ts`, `drops.ts`, `orders.ts` (checkout vault/shipping + `vault-shipout`), `wallet.ts`, `nfc.ts` (cards verify + 3D + SUN URL), `listings.ts` (Marketplace buyout via `cards.buyout_price_ccoin`), `bids.ts` (direct on card: 1 active, outbid/cancel, accept only), `browse.ts`, `profile.ts`, `publicProfile.ts` (`/u/:username` anon), `shipments.ts`, `gamification.ts`, `creators.ts`, `kyc.ts`.
- `apps/api/src/lib/store.ts` — in-memory store + `ensureSeed()` (mirror `supabase/seed.sql`); helpers `isKycApproved`, `awardBadgeIfNeeded`, `logAudit`.
- `apps/web/src/` — `App.tsx` (routes: `/`, `/drops`, `/drops/:id`, `/drops/:id/checkout`, `/home`, `/cards/:cardId`, `/cards/:cardId/3d`, `/marketplace`, `/browse`, `/verify`, `/collection`/`/me`, `/me/manage`, `/me/privacy`, `/me/kyc`, `/orders`, `/wallet`, `/leaderboard`, `/c/:username`, `/u/:username`, `/creator`, `/admin` placeholder) + `pages/` (Landing, Drops, DropDetail, Checkout, CardInfo, Card3D, Marketplace, Browse, Verify, Collection, ManageCards, Home, Orders, Wallet, Leaderboard, etc.) + `lib/api.ts`/`auth.tsx`.
- `apps/admin/src/` — Vite SPA terpisah (Guard `aal2` via Supabase MFA TOTP, nav ADM-01..09: dashboard/creators/drops/orders/nfc/payouts/badges/disputes/audit). `apps/admin/README.md` = runbook Tunnel+Access.
- `packages/shared/src/index.ts` — **single source** Zod schemas + constants (`C_COIN_RATE_IDR=10_000`, `SECONDARY_*`, `REVENUE_SHARE_*`, `calcLevel`, `KYC_TRIGGER 99`, `MAX_BUYOUT 20`). Import via `@c-verse/shared` (tsconfig `paths`). Jangan relative-import.
- `supabase/` — `config.toml`, `migrations/20260812000000_initial_schema.sql` + `20260813000000_rework_align_docs.sql`, `seed.sql` (users/creators/cards location buyout/shipments/ownership/bids/badges).
- `docs/` — `00-README.md` … `08-deployment.md` (canonical). Baca urut 01→08; `00` orientasi. Angka kunci di `00-README` §4 + `packages/shared`.

## Conventions

- ESM only (`"type": "module"`), Strict TS (`strict: true`, `moduleResolution: bundler`).
- API: `Hono` + `zValidator` dari `@hono/zod-validator` dengan schema dari `@c-verse/shared`. Mount via `app.route("/api/<name>", module)` di `apps/api/src/index.ts`. Compat aliases: `/api/marketplace` → listings.
- Shared constants canonical — jangan hard-code rate/fee/threshold di app (`docs/00-README` §4 + `packages/shared` adalah lock; `idrToCCoin` = `Math.ceil`).
- C-Coin: **semua nominal integer ≥1 tanpa desimal** (`CHECK x >= 1`), konversi IDR→C-Coin dibulatkan ke atas. Kolom `int`, jangan ubah ke `numeric`.
- Drop: 1 harga canonical `priceCcoin` (MVP platform-produced 70/30; creator-produced defer Y2+). `signedCount = ceil(total/10)`.
- Checkout: 1 kartu/user/drop (atomik), opsi `shipping` (alamat + ongkir C-Coin integer → tracking) vs `vault` (tanpa alamat, `settled` langsung, `platform_vault` custody). `orders.delivery_option`, `cards.location`, `shipments` type `vault_shipout`.
- Secondary: Marketplace = `cards.buyout_price_ccoin NOT NULL` (KYC wajib, max 20/user); Browse = bid langsung di kartu (1 `active` tertinggi, outbid/cancel release C-Coin, owner `accept` only tanpa reject, **tanpa expire**; history 90 hari, `accepted` selamanya). Fee secondary total 15% (7.5 platform + 7.5 royalti kreator lifetime).
- Verify: **tidak ada halaman verifikasi terpisah** — tap NFC → `/cards/:cardId/3d` (badge `Verified Card`), QR di dus → `/cards/:cardId` (`Registered`). `ownershipHistory` hanya di info, bukan di 3D. iOS SUN URL via `GET /api/nfc/sun-verify`.
- Gamifikasi: `level = floor(total_xp/10)`, `spend 1 C-Coin = 1 XP` (+ `xp_reward` badge via `awardBadgeIfNeeded`), **top-up tidak menambah XP**. Badge definisi (criteria+ikon+xp_reward) di `apps/admin` (ADM-07).
- Profil publik: `/u/:username` & `/c/:username`; `is_anonymous` hide koleksi/level/badge/ranking. Domain: `c-verse.co` primary + `c-verse.id` redirect — **LOCK sebelum provisioning NFC** (NDEF URL permanen).
- KYC trigger: top-up kumulatif >99 C-Coin, pasang buyout, atau accept bid (manual Y1). Threshold kreator 100rb+ followers *combined* (validasi off-platform, bukan in-app).
- Admin: app terpisah — akses Supabase via `service-role` + Cloudflare Access (Zero Trust) + **2FA TOTP wajib** (`aal2` guard di app) + `admin_audit_log` append-only (retensi ≥1 tahun). Tidak ada route admin di API publik.
- Demo accounts: `demo@cverse.id`/`demo123` (kolektor, 120 C-Coin, order+card vault demo), `admin@cverse.id`/`admin123`. Role enum `user` (legacy `collector` alias), `creator`, `admin`.

## Pitfalls

- Wajib `pnpm` — `pnpm-lock.yaml` v9; jangan pakai npm/yarn.
- Ports 8787 (API) + 5173 (web) + 3000 (admin) harus free; `scripts-dev.mjs` kill children on SIGINT/SIGTERM. Vite bind `127.0.0.1` only.
- `apps/api` build tidak emit — `tsc --noEmit` only; deploy Workers = `wrangler deploy`.
- `.env`, `.env.local`, `.env.*.local`, `.wrangler/`, `supabase/.temp`, `supabase/.branches` gitignored — jangan commit secrets; Wrangler vars di `.dev.vars`.
- `git` di Windows via git-bash: terminal `bash` POSIX, bukan PowerShell. Konversi path dengan `cygpath -w` untuk Node tools butuh Windows path.
- Jangan bocorkan `service-role` / `NFC_MASTER_KEY` ke bundle publik — `apps/web` hanya `anon` key + RLS.
- Jangan pernah ubah kolom C-Coin ke desimal; jangan buat auction timer/anti-sniping di MVP (defer — docs/07 C-07).

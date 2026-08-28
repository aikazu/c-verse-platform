# C.Verse Platform — AGENTS.md

Monorepo `pnpm` workspaces: React 19/Vite SPA (`apps/web` → Cloudflare Pages) + Hono 4 API (`apps/api` → Cloudflare Workers / Node) + React 19/Vite Admin (`apps/admin` → VPS + Cloudflare Tunnel + Access) + shared Zod schemas/constants (`packages/shared`). C.Card MVP — 9 flows. Supabase Postgres (SG) + Cloudflare R2.

Dokumen perencanaan **canonical = `docs/`** (`00_readme` → `16_foundation_cleanup`, 17 files, `[VALIDATED]`) — cukup ini untuk kerja codebase, jangan perlu baca repo spec. `docs/` adalah **MIRROR byte-identik** dari `00_Dream_Project/dev-strategy/` (repo spec terpisah: `C:\Users\iqbal\Documents\C-Verse\00_Dream_Project`), disinkron **DUA ARAH**: keputusan/temuan saat implementasi di sini → propagasi balik ke repo spec; ide baru dari repo spec → dibawa ke sini untuk diimplementasi. **Codebase = source of truth.** Tiap edit `docs/` WAJIB disalin identik ke `dev-strategy/` lalu commit di kedua repo (AGENTS.md tidak di-mirror).

## Dev environment

- Requires Node >=20 and `pnpm@9.12.3` — do not use npm/yarn. Lockfile `pnpm-lock.yaml` v9.
- `pnpm install` at repo root (workspaces: `apps/*` + `packages/*`).
- Env — template per app (copy dari `.env.example` di masing-masing folder):
  - `apps/web/.env.local` ← `apps/web/.env.example`: `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY`, `VITE_TURNSTILE_SITE_KEY`. Anon only — service-role DILARANG di web bundle.
  - `apps/admin/.env.local` ← `apps/admin/.env.example`: `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` (anon + MFA aal2, di belakang Cloudflare Access) + `VITE_API_URL` (dev `http://localhost:8787`, kosong = same-origin).
  - `apps/api/.dev.vars` ← `apps/api/.env.example` (satu file untuk Wrangler & Node): `SUPABASE_URL`/`SUPABASE_ANON_KEY`/`SUPABASE_SERVICE_ROLE_KEY`, `TURNSTILE_SECRET_KEY`, `NFC_MASTER_KEY`, `MIDTRANS_*`, `PAYOUT_WEBHOOK_SIGNING_KEY`, SMTP.
  - Secrets prod (tidak di repo): sama seperti di atas + `CF_ACCOUNT_ID`, `CF_API_TOKEN` via `wrangler secret put`.
- Supabase WAJIB — tanpa `SUPABASE_URL` API gagal start (fail-fast, tidak ada fallback in-memory).
- Supabase — kerja DB LANGSUNG ke project cloud linked (`c-verse`), tanpa stack lokal/Docker:
  - Apply migration + seed ulang: `"y" | npx supabase db reset --linked` — HANYA setelah konfirmasi eksplisit user (menghapus SELURUH data cloud; lihat Pitfalls). Pipe `"y"` wajib: prompt `Do you want to reset the remote database? [y/N]` dibaca dari stdin, shell non-interaktif tanpa pipe selalu mati `context canceled`. Edit pada file migration lama tidak pernah di-apply ulang oleh `db push` (sudah tercatat applied) — reset --linked adalah cara apply-nya.
  - Query/verifikasi SQL: `npx supabase db query --linked "SQL"` — flag `--linked` WAJIB, tanpa itu CLI diam-diam konek ke database lokal; multi-statement OK. Linter security/performance (sama dengan Dashboard): `npx supabase db advisors --linked`. Tidak ada subcommand `db execute` di CLI ini; `psql` tidak ada di PATH Windows.
  - Stack lokal (`npx supabase start` — API :54321, DB :54322, Studio :54323) hanya kalau diminta eksplisit.
  - `supabase/migrations/` ter-organisir 5 file by domain (consolidated 2026-08-24): `01_schema` (DDL/enums/tables/base indexes), `02_auth` (auth mirror + canonical_email), `03_rls` (policies + guard triggers), `04_rpc` (semua SECURITY DEFINER RPC FINAL versions + grants), `05_indexes` (performance). Setiap objek ditulis SATU KALI di versi final — TIDAK ada `create or replace` chain.

## Build & test

- Jalankan semua: `pnpm dev` (`scripts-dev.mjs` → API :8787 + web :5173). Admin terpisah: `pnpm --filter @c-verse/admin dev` → :3000.
- Per app:
  - `pnpm --filter @c-verse/api dev:node` — Hono via `@hono/node-server` + `tsx watch src/server.ts` :8787
  - `pnpm --filter @c-verse/api dev` — `wrangler dev --port 8787` (Workers runtime, butuh `wrangler.toml` bindings)
  - `pnpm --filter @c-verse/web dev` — `vite --host 0.0.0.0 --port 5173` (proxy `/api` → `http://localhost:8787`)
  - `pnpm --filter @c-verse/admin dev` — `vite --host 127.0.0.1 --port 3000`
- Typecheck: `pnpm run typecheck` (`pnpm -r typecheck` → `tsc --noEmit` per package; 4 workspaces: shared, api, web, admin)
- Test: `pnpm test` (Vitest; proyek `packages/shared` + `apps/api`). Lint: `pnpm lint` (Biome, 0 error/warning hard gate). Format: `pnpm format`.
- Integration SQL (`supabase/tests/rls_test.sql` — fixture insert lalu commit): `npx supabase db query --linked (Get-Content supabase/tests/rls_test.sql -Raw)` (pwsh) atau `--linked "$(cat supabase/tests/rls_test.sql)"` (bash); jalankan reset --linked setelahnya untuk membersihkan fixture.
- Build: `pnpm run build` (`pnpm -r build`); `pnpm --filter @c-verse/web build` → `apps/web/dist`, `pnpm --filter @c-verse/admin build` → `apps/admin/dist`, `pnpm --filter @c-verse/api build` = `tsc --noEmit` only. Workers deploy: `pnpm --filter @c-verse/api deploy` (`wrangler deploy`).
- Lint: `pnpm run lint` — `biome check .` (0 error/warning hard gate, lihat `biome.json`). Format: `pnpm run format`.
- CI: `.github/workflows/ci.yml` (PR + main): `pnpm install → typecheck → lint → test → build` + `supabase db lint` di PR.

## Commit workflow

Sebelum setiap commit, WAJIB jalankan:
1. `pnpm run format` — biome auto-format
2. `pnpm run lint:fix` — biome auto-fix (import ordering, dll)
3. `pnpm run typecheck` — tsc strict di 4 workspace
4. `pnpm run test` — vitest (50+ test, harus PASS)
5. `pnpm run lint` — 0 error, 0 warning
6. `pnpm run build` — semua workspace build
7. **Doc changes?** Jalankan `pnpm sync:docs` setelah commit untuk propagate ke spec repo (mirror byte-identik).

Jika salah satu dari langkah 3-6 gagal, jangan commit. Fix dulu. Gunakan `git add -A && git commit -m "..."` hanya setelah semua gate hijau.

**Pola per logical unit** — setiap fix/feature/security change = 1 commit atomic dengan:
- Test gagal dulu (Red) untuk logika baru, lalu implementasi (Green), gate, commit.
- Mock `lib/db.js` (bukan `lib/supabase.js`) untuk test RPC routes — `userDb()` ada di db.js.
- Naming Conventional Commits (`fix:`, `feat:`, `refactor:`, `docs:`, `test:`, `chore:`, `tools:`). Audit/security fix pakai prefix `fix(audit):` atau `fix(security):` kalau relevan.

## Project layout

- `apps/api/src/index.ts` — Hono app (CORS + logger, mounts `/api/*`, JSON 404). `apps/api/src/server.ts` — Node entry lokal.
- `apps/api/src/routes/` — `auth.ts`, `drops.ts`, `orders.ts`, `wallet.ts`, `nfc.ts`, `marketplace.ts` (buyout-on-card; alias `/api/listings`), `bids.ts`, `browse.ts`, `profile.ts`, `publicProfile.ts`, `shipments.ts`, `gamification.ts`, `creators.ts`, `kyc.ts`, `seo.ts`, `payments.ts` (Midtrans), `admin.ts` (mutasi admin role-gated: users/wallet-hold/disputes/audit).
- `apps/api/src/lib/` — `auth.ts` (Supabase JWT verify + `requireUser`), `cmac.ts` (AES-CMAC RFC 4493 + SUN AN12196), `db.ts` (RPC facade — klien pakai JWT user karena RPC baca `auth.uid()`), `reads.ts` + `reads/` (domain selectors — Supabase select + mapper snake_case→camelCase; semua route read lewat sini), `cron.ts` (scheduled handler → `activate_scheduled_drops`/`draw_pending_drops`/`payout_batch_run`), `payments/` (provider + midtrans), `supabase.ts` (klien wajib — throw saat env absen).
- `apps/api/src/lib/store.ts` — domain types (dipakai mapper/route) + helper murni `uid`/`nowIso`. Tidak ada lagi data in-memory.
- `apps/web/src/` — `App.tsx` (routes: `/`, `/drops`, `/drops/:id/checkout`, `/home`, `/cards/:cardId/3d`, `/marketplace`, `/browse`, `/collection`, `/me/manage`, `/me/privacy`, `/me/kyc`, `/wallet`, `/leaderboard`, `/c/:username`, `/u/:username`, `/creator`) + `pages/` + `lib/api.ts` + `worker-seo.ts`.
- `apps/admin/src/` — Vite SPA terpisah (Guard `aal2` via Supabase MFA TOTP, nav ADM-01..10: dashboard/creators/drops/orders/nfc/payouts/badges/disputes/audit/investor).
- `packages/shared/src/index.ts` — **single source** Zod schemas + constants (`C_COIN_RATE_IDR=10_000`, `SECONDARY_*`, `REVENUE_SHARE_*`, `calcLevel`, `calcSignedPrice` (+20 flat), `BALANCE_CAP_CCOIN=500`, `MAX_ACTIVE_BIDS_PER_USER=3`, `MAX_BUYOUT 20`). Import via `@c-verse/shared`.
- `supabase/` — `config.toml`, `migrations/*.sql` (5 file by domain: schema/auth/rls/rpc/indexes — lihat Dev environment untuk breakdown), `seed.sql` (fixed UUID = `auth.users`), `tests/` (`rls_test.sql`, `rpc_*.mjs`, `revenue_flow_test.mjs`).
- `docs/` — `00_readme.md` … `16_foundation_cleanup.md` (17 files). Baca urut 00→16. Mirror byte-identik ke `00_Dream_Project/dev-strategy/` via `sync-docs.mjs`.
- `sync-docs.mjs` (root) — byte-identical mirror sync Platform/docs ↔ spec/dev-strategy. Mode: `pnpm sync:docs` (apply), `:check` (dry-run, CI-friendly exit codes), `:reverse` (spec → Platform). Tidak auto-commit.

## Conventions

- ESM only (`"type": "module"`), Strict TS (`strict: true`, `moduleResolution: bundler`).
- API: `Hono` + `zValidator` dengan schema dari `@c-verse/shared`. Mount via `app.route("/api/<name>", module)` di `apps/api/src/index.ts`. Alias `/api/listings` → marketplace (buyout).
- Auth: Supabase JWT (Google OAuth + email OTP + Turnstile) — `requireUser(c)` di semua route; 401 invalid, 403 suspend (`flag_reason`). Register/login password DILARANG. Demo-login dev-only (masa demo): `POST /api/auth/demo-login` via `admin.generateLink` — flag `ENABLE_DEMO_LOGIN` + whitelist email seed; tombol hanya ikut bundle DEV; admin dev build merelaksasi aal2 (docs/10 §7). Konfirmasi aksi spend/destruktif di web & admin WAJIB modal in-app `useConfirm()` (D8) — native `window.confirm` dilarang.
- Uang & stok: wajib lewat RPC (`apps/api/src/lib/db.ts`: checkout, drop_entry/draw, place/cancel/accept bid, set_buyout/buyout_card, payout_request, wallet_credit/debit — single transaction). DB wajib — fail-fast tanpa `SUPABASE_URL` (F-08).
- Revenue ledger: setiap settlement primary (70/30) & secondary (7,5/7,5/85) menulis `platform_revenue` (fee snapshot) + kredit wallet **treasury** (user sistem `...0c0`) via `record_platform_revenue` — pendapatan platform tidak boleh menguap.
- NFC: verdict `verified` HANYA via CMAC valid (`lib/cmac.ts`, key diversification N5) + counter maju (UPDATE atomic `WHERE last_ctr < ctr`). QR → maksimal `registered`, tidak pernah menurunkan `verified`. Tamper permanen + audit log.
- Shared constants canonical — jangan hard-code rate/fee/threshold di app (`idrToCCoin = Math.ceil`).
- C-Coin: **integer ≥1 tanpa desimal** (`CHECK x >= 1`), konversi IDR→C-Coin ceil. Kolom `int`, jangan `numeric`.
- Drop: `priceCcoin` canonical (platform-produced 70/30), `signedCount = ceil(total/10)`, `priceSigned = priceUnsigned + 20` FLAT (founder 2026-08-16). Rilis default 12:00 WIB; raffle window 24 jam (`raffle_end_at`), draw via cron; `scheduled→live` otomatis cron.
- Checkout: 1 kartu/user/drop, pilih pool (regular=unsigned, premium=signed). Semua pembelian (drop/FCFS, buyout, bid accept) settle LANGSUNG ke vault — tanpa alamat/ongkir di titik beli (founder 2026-08-28: purchase → vault only); kartu `location='platform_vault'`, order `settled`. Shipping = SATU flow pasca-vault: owner minta `vault_shipout` dari Kelola Kartu, ship fee di titik itu → treasury + `platform_revenue` ref_type 'shipment'. Seed two-phase (PHASE-1 escrow_hold → admin vault-in + verify → release) tetap.
- Secondary: Marketplace `buyout_price_ccoin NOT NULL` (max 20/user); Browse bid langsung (1 active/kartu, **max 3 aktif/user**, outbid/cancel release, accept only, tanpa expire; history 90 hari). Fee 15% (7,5 platform + 7,5 royalti) — ketiga bagian dicatat `platform_revenue` + treasury. Settle → `platform_vault` (tanpa `buyer_address`); pengiriman via `vault_shipout`. Blok rebuy 24 jam (C-12). Kartu tampered/defect/lost tidak tradable.
- Verify: tap NFC → `/cards/:cardId/3d` (Verified), QR → `/cards/:cardId` (Registered). Ownership history hanya di info. iOS SUN URL via `GET /api/nfc/sun-verify`.
- Gamifikasi: `level = floor(total_xp/10) + 1` (clamp 1..100), `spend 1 C = 1 XP` (+ badge `xp_reward` via trigger SQL), top-up tidak menambah XP. Badge di `apps/admin` (ADM-07). Leaderboard multi-type (`xp`|`cards`|`badges`|`creator`) via RPC `get_leaderboard` (`04_rpc.sql`, privasi + tie-break deterministik); endpoint `GET /api/gamification/leaderboard` di `apps/api/src/routes/gamification.ts`.
- Profil: `/u/:username` & `/c/:username`; `is_anonymous` hide koleksi/level/badge; user suspended (`flag_reason`) disembunyikan dari profil publik. Domain `c-verse.co` + `c-verse.id` redirect — LOCK sebelum NFC.
- KYC: wajib payout (`payout_request` RPC gate). Cap saldo top-up non-KYC 500 C-Coin (KYC approved = tanpa cap). Tidak untuk pasang buyout/accept bid. `hold_payout_until` untuk fraud hold.
- Payments: top-up `POST /api/payments/topup` (Snap) → webhook verifikasi signature + status + **ceil**; payout `POST /api/payments/payout` (request, dana dikunci) → batch mingguan `POST /api/payments/admin/payout-run` → admin transfer MANUAL via IRIS dashboard (founder 2026-08-23; auto-disburse = post-MVP) → webhook IRIS opsional untuk status update. Refund path: `POST /api/payments/admin/payouts/:id/refund` (RPC `payout_refund`, ter-audit) untuk payout failed/aborted — kredit wallet kreator + status `refunded`.
- Admin: terpisah, anon key + MFA TOTP (`aal2`) + Cloudflare Access; **mutasi lewat route API role-gated** (`/api/admin/*`, `/api/kyc/:id/approve`, `PATCH /api/drops/:id/status`, `PATCH /api/shipments/:id/status`) — semua ter-audit `admin_audit_log` append-only. Login admin = email OTP (magic link), tanpa password.
- Seed dev (fixed UUID, login via OTP/Google): `demo@cverse.id` (120 C-Coin), `admin@cverse.id`; creator `karina@creator.id` dll. Role `user`, `creator`, `admin`. Onboarding creator: `POST /api/creators/apply` → admin approve.

## Pitfalls

- Wajib `pnpm` — `pnpm-lock.yaml` v9; jangan pakai npm/yarn.
- Ports 8787 (API) + 5173 (web) + 3000 (admin) harus free; `scripts-dev.mjs` kill children on SIGINT/SIGTERM.
- `apps/api` build tidak emit — `tsc --noEmit` only; deploy = `wrangler deploy`.
- `.env`, `.env.local`, `.wrangler/`, `supabase/.temp` gitignored — jangan commit secrets; Wrangler vars di `.dev.vars`.
- `git` di Windows via git-bash: `bash` POSIX, bukan PowerShell. Konversi path dengan `cygpath -w`.
- Jangan bocorkan `service-role` / `NFC_MASTER_KEY` ke bundle publik — `apps/web` hanya `anon` key + RLS.
- Jangan ubah kolom C-Coin ke desimal; jangan buat auction timer/anti-sniping di MVP (docs 07 C-07).
- AGENTS/README: tulis ringkas. Jangan verbosity ("selalu prod & dev", "tidak pernah Supabase", disclaimer dual-env, atau penjelasan infrastruktur yang mengulang dirinya sendiri). Fakta cukup sekali; tidak perlu disclaim tiap paragraf.
- **Operasi destruktif (db reset --linked, drop database, force-push)** — PAUSE dan minta konfirmasi user sebelum eksekusi. CLI Supabase `db reset --linked` menghapus SELURUH data di project cloud yang linked, bukan database lokal. Setelah konfirmasi eksplisit, eksekusi non-interaktif dengan pipe jawaban: `"y" | npx supabase db reset --linked` — pola ini berlaku untuk semua prompt `[y/N]` CLI Supabase (tanpa pipe, shell non-interaktif mati `context canceled`).
- **Error message dari Supabase/Postgres** — jangan echo raw `error.message` ke response (leak schema: constraint/column name). Pakai `apps/api/src/lib/errors.ts:sanitizeDbError` untuk memetakan 7 pola umum + fallback `Operasi gagal`. Log raw message server-side untuk debugging.

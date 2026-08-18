# 08 — Deployment Runbook (Step-by-Step)

> Status: [VALIDATED]
> Last updated: 2026-08-18 (sinkronisasi dengan codebase: pnpm workspace
> tanpa Turborepo, migrasi via Supabase CLI, 2 cron trigger)
> Menjawab open items O-5 (CI/CD pipeline) & O-7 (domain/SSL)
> di `06_tech_decisions.md`. Dok ini self-contained — semua
> detail deploy ada di sini.

## 1. Target & Arsitektur Deploy

```
repo-root (pnpm workspace, tanpa Turborepo)
├── apps/web/      → Cloudflare Pages (SPA publik, statik)
├── apps/admin/    → LOKAL / VPS + Cloudflare Access (bukan Pages)
├── apps/api/      → Cloudflare Workers (Hono)
└── packages/shared → dikonsumsi web+admin+api (build via `pnpm -r build`)

Infra pendukung:
- Supabase (Postgres + Auth + Realtime + Supavisor)
- Cloudflare R2 (artwork, model 3D, KYC private) — binding masih
  dikomentari di `wrangler.toml` sampai bucket dibuat
- Cloudflare Cron Triggers (escrow settlement + raffle draw, payout batch)
- Midtrans (sandbox → prod)
- Belum aktif: Cloudflare Queues (email/notifikasi/payout), SMTP
  transaksional di API, FCM push
```

Environment:
- `prod` = branch `main` (deploy otomatis).
- `preview` = tiap PR/branch (deploy ke URL preview Pages).

## 2. Prasyarat (Sprint 0)

Akun & kredensial yang harus sudah ada:

| # | Akun/Layanan | Keperluan |
|---|--------------|-----------|
| 1 | Cloudflare (zone domain) | Pages, Workers, R2, Queues, Cron, Access, DNS |
| 2 | GitHub (repo) | CI/CD Actions |
| 3 | Supabase | Postgres, Auth, Realtime, Storage |
| 4 | SumoPod SMTP | Email OTP Supabase Auth (smtp.sumopod.com:465 SSL — diisi di Supabase Dashboard, bukan env API) |
| 5 | Midtrans/Xendit (sandbox dulu) | Top-up & disbursement (top-up bisa live setelah T&C final + cap saldo) |
| 6 | Firebase (FCM) | Push notification — **post-MVP, belum diimplementasi** |

Tool lokal: Node 20+, pnpm 9.12.3, wrangler CLI (`pnpm dlx wrangler`),
Supabase CLI (`npx supabase`, migrasi SQL), git + GitHub CLI.

Kredensial yang disimpan rahasia (tidak pernah di repo):
`CF_ACCOUNT_ID`, `CF_API_TOKEN`, `SUPABASE_SERVICE_ROLE_KEY`,
`MIDTRANS_SERVER_KEY`, `PAYOUT_WEBHOOK_SIGNING_KEY`,
`NFC_MASTER_KEY`. Kredensial SMTP (`SMTP_HOST`/`PORT`/`USER`/`PASS`)
dan captcha secret Turnstile diisi di **Supabase Dashboard** — API
tidak membacanya. Public vars boleh di bundle dengan konvensi
**Vite `VITE_*`** (anon keys).

## 3. Setup Cloudflare (sekali, Sprint 0)

### 3.1 Domain & DNS
1. Domain (FINAL 2026-08-13):
   - **Primary: `c-verse.co`** — zona utama, NDEF URL final
   - **Secondary: `c-verse.id`** — 301 redirect ke `c-verse.co`
     (brand protection).
   - **LOCKED — provisioning NFC bisa dimulai** (URL NDEF ditulis
     permanen di chip).
   Tambah zona di Cloudflare untuk `c-verse.co` (dan `c-verse.id`
   sebagai alasan terpisah) → update nameserver di registrar.
2. DNS records (zona `c-verse.co`):
   | Type | Name | Target |
   |------|------|--------|
   | A/AAAA | `@` | Pages custom domain (Cloudflare mengelola otomatis) |
   | A/AAAA | `api` | Worker route (atau via `wrangler` binding) |
   | CNAME | `www` | Pages |
3. SSL/TLS mode: **Full (strict)**.
4. Pages custom domain: attach `@` ke project Pages apps/web
   (otomatis provisioning SSL).

### 3.2 Cloudflare Pages (apps/web)
1. Buat project Pages `cverse-web` → hubungkan repo GitHub.
2. Build config:
   - Build command: `pnpm --filter web build`
   - Output dir: `apps/web/dist`
   - Root dir: `/`
3. Environment variables (prod + preview): anon keys Supabase
   `PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_ANON_KEY`,
   `PUBLIC_API_URL=https://api.c-verse.co`.

### 3.3 Cloudflare Workers (apps/api)
1. Buat Worker `cverse-api` (dari `apps/api`).
2. Route: `api.c-verse.co/*`.
3. Cron Triggers (`wrangler.toml` — 2 trigger aktif):
   | Cron (UTC) | WIB | Fungsi |
   |------|-----|--------|
   | `*/5 * * * *` | tiap 5 menit | `activate_scheduled_drops` (scheduled→live) → `escrow_auto_release` (DELIVERED + H+7) → `draw_pending_drops` (drops lewat `raffle_end_at`, idempotent — C-15) |
   | `0 23 * * 1` | Selasa 06:00 | `payout_batch_run` (settlement mingguan, fee 1%) |
4. Queues (`email-queue` dll) belum aktif — blok masih dikomentari
   di `wrangler.toml`; aktifkan saat notifikasi diimplementasi.
5. Secrets (wrangler secret put, TIDAK di repo):
   `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
   `JWT_SECRET` (JWKS verifikasi), `SMTP_HOST`, `SMTP_PORT`,
   `SMTP_USER`, `SMTP_PASS` (smtp.sumopod.com:465 SSL),
   `MIDTRANS_SERVER_KEY`, `NFC_MASTER_KEY`,
   `PAYOUT_WEBHOOK_SIGNING_KEY`.

### 3.4 Cloudflare R2
- Bucket `cverse-assets` (publik via CDN): artwork, model 3D.
- Bucket `cverse-kyc` (PRIVATE): KYC dokumen — akses via
  presigned URL + audit log, TIDAK publik.
- Bucket `cverse-qr` (opsional): fallback QR statik per kartu.

### 3.5 Admin app (apps/admin) — TIDAK di Pages
- Deploy ke **VPS kecil** (Rp 100-200rb/bln) atau mesin lokal
  founder; akses lewat **Cloudflare Tunnel + Access**:
  1. Install `cloudflared` di VPS.
  2. `cloudflared tunnel create cverse-admin` → route
     `admin.c-verse.co` ke `http://localhost:3000`.
  3. Cloudflare Access: policy **Allow founders** (email list)
     di depan `admin.c-verse.co` — no internet attacker.
- Env admin: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
  (service-role HANYA di sini), `ADMIN_ALLOWED_EMAILS`.
- Build: `pnpm --filter admin build` → `pnpm --filter admin
  start` (serve statik) di belakang tunnel.

## 4. Setup Supabase (sekali, Sprint 0)

1. Buat project baru (region SG singapore) — nama `cverse-{env}`.
2. Simpan di `.env.local` (lokal) & secrets (CI):
   `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_PASSWORD`.
3. Auth: aktifkan Google OAuth + email OTP; **aktifkan captcha
   anti-spam di email OTP** (Cloudflare Turnstile — buat site key
   + secret key, set di Dashboard Auth → config captcha); set
   redirect URLs
   (prod: `https://c-verse.co`, preview: `https://*.pages.dev`).
4. Migrasi: `npx supabase db push` (atau `npx supabase db reset`
   untuk lokal) — file SQL murni di `supabase/migrations/*.sql`
   (7 fase). Cek `npx supabase db lint` untuk drift.
5. RLS: apply policy per tabel (lihat `05_data_model.md` RLS) —
   verifikasi dengan `supabase/rls` test setelah deploy.
6. Realtime: enable broadcast untuk channel `drop_countdown` &
   `bid_events` (extension `supabase_realtime`).

## 5. Build & Verifikasi Lokal (sebelum deploy)

```bash
pnpm install                 # install deps workspace
pnpm run format              # biome auto-format
pnpm run lint:fix            # biome auto-fix
pnpm run typecheck           # tsc --noEmit × 4 workspace
pnpm run test                # vitest (packages/shared + apps/api, wajib hijau)
pnpm run lint                # biome check . — 0 error/warning
pnpm run build               # pnpm -r build (shared → web/admin dist, api = tsc)
```

Preview lokal API: `pnpm --filter api dev` (wrangler dev) →
test endpoint `/health` & CMAC verify di device nyata (C-03).

## 6. Deploy Pertama (Manual, sekali jalan)

```bash
# 1) Web → Pages (branch main ter-trigger otomatis oleh CI;
#    manual sekali: pnpm dlx wrangler pages deploy \
#    apps/web/dist --project-name cverse-web)

# 2) API → Workers (variabel + secret sudah di-set):
pnpm --filter api deploy     # = wrangler deploy
pnpm --filter api migrate    # drizzle-kit ke Supabase prod (hati-hati)
pnpm dlx wrangler deploy --cron dist/cron.js   # buat cron Jobs

# 3) Verifikasi:
curl https://api.c-verse.co/health               # 200 + json ok
curl -I https://c-verse.co                       # 200 (SPA)
curl -I https://c-verse.id                       # 301 -> c-verse.co
# buka https://c-verse.co/cards/:shortId/3d      # halaman kartu
```

## 7. CI/CD — GitHub Actions (otomatis mulai deploy ini)

File: `.github/workflows/deploy.yml`

```yaml
name: Deploy
on:
  push:
    branches: [main]        # prod
  pull_request:             # preview
jobs:
  test-build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint && pnpm test && pnpm build

  deploy-prod:
    if: github.ref == 'refs/heads/main'
    needs: [test-build]
    runs-on: ubuntu-latest
    env:
      CF_API_TOKEN: ${{ secrets.CF_API_TOKEN }}
      CF_ACCOUNT_ID: ${{ secrets.CF_ACCOUNT_ID }}
      SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - run: pnpm install --frozen-lockfile
      - run: pnpm build
      - name: Deploy API
        run: pnpm --filter api deploy
      - name: Deploy Web (Pages)
        run: pnpm dlx wrangler pages deploy apps/web/dist \
             --project-name cverse-web --branch main
```

Preview (PR): deploy web ke Pages `--branch <pr-ref>` (URL
`https://<pr-ref>.cverse-web.pages.dev`), API skip (pakai
`--env preview` kalau butuh worker preview).

Secrets CI yang wajib diset (GitHub Settings → Secrets):
`CF_API_TOKEN`, `CF_ACCOUNT_ID`, `SUPABASE_SERVICE_ROLE_KEY`,
`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`,
`MIDTRANS_SERVER_KEY` (sandbox), `NFC_MASTER_KEY`,
`PAYOUT_WEBHOOK_SIGNING_KEY`.

## 8. Rollback / Hotfix

- **Web**: Pages → Deployments → pilih deploy sebelumnya →
  "Rollback". Statik SPA = rollback instant.
- **API**: `wrangler rollback` (ke release terakhir) ATAU
  redeploy commit sebelumnya.
- **DB**: migrasi TIDAK auto-rollback. Prinsipi: migrasi selalu
  backward-compatible (add column nullable dulu, drop belakangan);
  kalau rusak, restore point-in-time Supabase + log replay
  dari ledger (append-only) untuk rekonsiliasi.
- **Rule**: jangan deploy Worker + migrate DB dalam satu commit
  (dua langkah terpisah).

## 9. Checklist Go-Live (pre-pilot drop)

- [ ] Domain SSL aktif (https padan, bukan mixed content).
- [ ] `/health` OK; halaman kartu 3D OK di Chrome Android.
- [ ] Web NFC verify OK di device nyata (C-03); fallback QR OK.
- [ ] Supabase RLS verified (service-role tidak bocor ke publik).
- [ ] Secrets tidak ada di bundle publik (cari `service_role|SERVER_KEY` di `dist/`).
- [ ] Email (SumoPod SMTP) terkirim: order, payout, notifikasi.
- [ ] Monitoring aktif: Sentry (error) + BetterStack (uptime) +
      PostHog/Plausible (analitik). Alert ke #ops channel.
- [ ] Cron OK: settlement release, raffle draw, payout Selasa.
- [ ] Rekonsiliasi harian ledger vs top-up (ADM-05) jalan.
- [ ] QC: DF test — `curl` API dengan auth salah → 401, tanpa
      leak stack trace.
- [ ] **Top-up readiness**: T&C final (disclosure "saldo tidak
      dapat diuangkan", refund-to-source, cap saldo) + cap saldo
      diimplementasi sebelum top-up live.

## 10. Catatan Biaya Y1 (estimasi)

| Item | Unit | Estimasi/bln |
|------|------|--------------|
| Cloudflare Free tier | Pages+Workers+R2+Queues | Rp 0 (worst case upgrade ~Rp 500rb) |
| Supabase Free → Pro | 500 MB → 8 GB | Rp 0 → ~Rp 350rb |
| VPS admin (tunnel) | 1 vCPU/1 GB | Rp 100-200rb |
| SumoPod SMTP | sesuaikan plan (cek kuota vendor) | cek vendor |
| Midtrans/Xendit | fee top-up + disbursement | variabel (cost of goods) |
| **Total infra Y1** | | **≤ Rp 1 juta/bln** (dalam opex Rp 135 jt/thn) |

## Sumber

- `06_tech_decisions.md` (stack, open items O-5/O-7 — dijawab
  runbook ini).
- `40_operations/01_tech_stack.md` (full-edge, CI/CD O5, domain O7).
- `90_research/20_tech_stack_decision.md` (monorepo,
  free tier).
- `05_data_model.md` (RLS → step 4.5).
- Konvensi angka: A024 build time **6-8 bulan** (`01_scope.md`
  §5); opex Y1 **Rp 135 jt/thn (~Rp 11 jt/bulan)** per financial
  model — burn kas bootstrap ~Rp 10-15 jt/bulan (termasuk
  kebutuhan founder di luar opex tercatat).
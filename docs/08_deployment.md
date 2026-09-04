# 08 — Deployment Runbook (Step-by-Step)

> Status: [VALIDATED]
> Last updated: 2026-09-04 (admin production di VPS aktif melalui
> Cloudflare Tunnel + Access; bucket R2 `cverse-kyc` + binding Worker
> aktif; upload/review KYC tidak memakai Supabase Storage)
> Previous: 2026-08-31 (deploy.yml TIDAK ada — deploy manual;
> email = Cloudflare Email Service)
> Previous: 2026-08-20 (konvensi angka opex Y1 → Rp 38 jt, burn ~1 jt/bln)
> Previous: 2026-08-18 (sinkronisasi dengan codebase: pnpm workspace
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
- Cloudflare R2 (`cverse-kyc` private) — binding `KYC` aktif;
  artwork/model 3D belum dipindahkan pada tahap ini
- Cloudflare Cron Triggers (raffle draw, payout batch — settlement
  pembelian langsung di RPC, tanpa cron; founder 2026-08-28)
- Midtrans (sandbox → prod)
- Belum aktif: Cloudflare Queues (notifikasi/payout), FCM push.
  Email transaksional API (akses kreator + digest failure cron) via
  Cloudflare Email Service — binding `send_email` (`EMAIL`), gate
  `EMAIL_ENABLED` (update 2026-08-29; SMTP/nodemailer dihapus)
```

Environment:
- `prod` = branch `main` (deploy manual; CI hanya quality gates).
- `preview` = URL preview Pages saat dibuat manual dari PR/branch.

## 2. Prasyarat (Sprint 0)

Akun & kredensial yang harus sudah ada:

| # | Akun/Layanan | Keperluan |
|---|--------------|-----------|
| 1 | Cloudflare (zone domain) | Pages, Workers, R2, Queues, Cron, Access, DNS |
| 2 | GitHub (repo) | CI/CD Actions |
| 3 | Supabase | Postgres, Auth, Realtime (bukan storage KYC) |
| 4 | Cloudflare Email Service | Email transaksional API (akses kreator + digest cron) — binding `send_email`; sender OTP Supabase Auth dikonfigurasi di Supabase Dashboard, bukan env API |
| 5 | Midtrans/Xendit (sandbox dulu) | Top-up & disbursement (top-up bisa live setelah T&C final + cap saldo) |
| 6 | Firebase (FCM) | Push notification — **post-MVP, belum diimplementasi** |

Tool lokal: Node 20+, pnpm 12.0.0, wrangler CLI (`pnpm dlx wrangler`),
Supabase CLI (`npx supabase`, migrasi SQL), git + GitHub CLI.

Kredensial yang disimpan rahasia (tidak pernah di repo):
`CF_ACCOUNT_ID`, `CF_API_TOKEN`, `SUPABASE_SERVICE_ROLE_KEY`,
`MIDTRANS_SERVER_KEY`, `PAYOUT_WEBHOOK_SIGNING_KEY`,
`NFC_MASTER_KEY` (generate: `openssl rand -hex 16` — AES-128,
32 karakter hex; nilai dev `.dev.vars` dan produksi harus konsisten
per environment karena dipakai diversifikasi AppKey per-UID).
Kredensial email provider OTP Supabase Auth
dan captcha secret Turnstile diisi di **Supabase Dashboard** — API
tidak membacanya (env email API hanya `EMAIL_ENABLED`/`EMAIL_FROM`/
`ADMIN_ALERT_EMAIL` — Cloudflare Email Service). Public vars boleh di bundle dengan konvensi
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
   | CNAME | `admin` | `<tunnel-id>.cfargotunnel.com` (proxied) |
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
   `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`,
   `VITE_API_URL=https://api.c-verse.co`.

### 3.3 Cloudflare Workers (apps/api)
1. Worker bernama `c-verse-api` (dari `apps/api`, sesuai `wrangler.toml`).
2. Origin produksi 2026-09-04: `https://api.c-verse.co` sebagai Worker
   Custom Domain. `workers_dev=true` dipertahankan untuk diagnosis darurat;
   preview URL acak dimatikan. Deployment dikunci ke Cloudflare account
   `0252b83dcbeac8879add5c278fbc342d` agar resource tidak salah akun.
3. Cron Triggers (`wrangler.toml` — 3 trigger aktif):
   | Cron (UTC) | WIB | Fungsi |
   |------|-----|--------|
   | `* * * * *` | tiap 1 menit | drain queue email transaksional saat `EMAIL_ENABLED=true` |
   | `*/5 * * * *` | tiap 5 menit | `activate_scheduled_drops` (scheduled→live) → `draw_pending_drops` (drops lewat `raffle_end_at`, idempotent — C-15) — settlement pembelian langsung di RPC (purchase → vault only, founder 2026-08-28) |
   | `0 23 * * 1` | Selasa 06:00 | `payout_batch_run` (settlement mingguan, fee 1%) |
4. Queues (`email-queue` dll) belum aktif — blok masih dikomentari
   di `wrangler.toml`; aktifkan saat notifikasi diimplementasi.
5. Secrets (wrangler secret put, TIDAK di repo):
   `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `EMAIL_ENABLED`, `EMAIL_FROM`,
   `ADMIN_ALERT_EMAIL` (Cloudflare Email Service — binding `EMAIL`
   di `wrangler.toml`; SMTP dihapus 2026-08-29),
   `MIDTRANS_SERVER_KEY`, `NFC_MASTER_KEY`,
   `PAYOUT_WEBHOOK_SIGNING_KEY`.
   `SUPABASE_URL` adalah environment variable non-rahasia di
   `wrangler.toml`; autentikasi user diverifikasi melalui JWKS Supabase.
6. Native Rate Limiting bindings aktif di `wrangler.toml`:
   auth/payment 30, NFC 60, KYC submit 10, global 600 request per
   menit per actor + lokasi edge. Ini menggantikan limiter in-memory
   Node yang tidak kompatibel dengan Workers global scope.

### 3.4 Cloudflare R2
- Bucket `cverse-assets` (publik via CDN): artwork, model 3D — belum
  dibuat/dihubungkan pada tahap KYC.
- Bucket `cverse-kyc` (PRIVATE, dibuat ulang pada account produksi
  2026-09-04; location hint APAC): KTP, selfie,
  NPWP. Binding `KYC` memakai Workers API `put/get/head/delete`.
  Browser tidak memakai presigned URL dan tidak memerlukan CORS R2:
  upload multipart diproksi Worker (maks. 5 MiB/file), review admin
  lewat endpoint streaming role admin + AAL2, `Cache-Control:
  private, no-store`, dan audit log per dokumen.
- Bucket `cverse-qr` (opsional): fallback QR statik per kartu.

### 3.5 Admin app (apps/admin) — TIDAK di Pages
- Production aktif 2026-09-04 di VPS `cverse-admin` melalui rantai:
  Cloudflare Access → Tunnel `cverse-admin` → `cloudflared` → Nginx
  `127.0.0.1:8080` → build statik admin. Nginx tidak listen di
  interface publik; firewall hanya membuka SSH key-only.
- Access app `C.Verse Admin` melindungi `admin.c-verse.co` dengan policy
  allowlist email founder, sesi 6 jam, App Launcher tersembunyi, cookie
  `HttpOnly`, dan binding cookie. Policy Access dibuat **sebelum** DNS
  CNAME dipublikasikan agar origin tidak pernah terbuka tanpa gate.
- Build dilakukan lokal dengan nilai publik `VITE_SUPABASE_URL`,
  `VITE_SUPABASE_ANON_KEY` (publishable key),
  `VITE_API_URL=https://api.c-verse.co`, dan
  `VITE_TURNSTILE_SITE_KEY`. `service-role` hanya secret Worker; VPS
  tidak menyimpan environment aplikasi atau runtime Node.js.
- Deploy isi `apps/admin/dist` ke release versioned di
  `/var/www/cverse-admin/releases/`, verifikasi checksum, lalu ubah
  symlink `/var/www/cverse-admin/current`. Rollback = arahkan kembali
  symlink ke release sebelumnya, `nginx -t`, lalu reload Nginx.
- Verifikasi dari luar: `https://admin.c-verse.co` tanpa sesi harus
  merespons redirect ke Cloudflare Access, sedangkan port publik VPS
  80/443 harus tertutup.

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
   (21 file SQL: 01–03 schema → 04 auth → 05–06 RLS → 07–17 RPC →
   18 indexes → 19–20 hardening → migrasi object key KYC R2).
   Cek `npx supabase db lint` untuk drift.
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
pnpm run test                # vitest (packages/shared + apps/api + apps/admin, wajib hijau)
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

# 2) Database lalu API Worker (secret sudah di-set):
supabase db push             # rename kolom KYC ke *_object_key lebih dulu
pnpm --filter api deploy     # = wrangler deploy
pnpm dlx wrangler deploy --cron dist/cron.js   # buat cron Jobs

# 3) Verifikasi:
curl https://api.c-verse.co/health               # 200 + json ok
curl -I https://c-verse.co                       # 200 (SPA)
curl -I https://c-verse.id                       # 301 -> c-verse.co
# buka https://c-verse.co/cards/:shortId/3d      # halaman kartu
```

## 7. CI/CD — GitHub Actions

> **STATUS (2026-08-31)**: `.github/workflows/deploy.yml` **TIDAK ADA** —
> tidak ada deploy otomatis dari CI. CI aktif hanya `.github/workflows/ci.yml`
> (gates, PR + main — lihat `15_quality_gates.md` §2). Deploy dilakukan
> MANUAL: API = `pnpm --filter @c-verse/api deploy` (= `wrangler deploy`);
> Web = build + deploy Pages dari dashboard/CLI; admin = build statik +
> serve di belakang tunnel. Blok di bawah = desain otomasi yang BELUM
> diimplementasi (jangan dianggap realita).

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
`EMAIL_ENABLED`, `EMAIL_FROM`, `ADMIN_ALERT_EMAIL`,
`MIDTRANS_SERVER_KEY` (sandbox), `NFC_MASTER_KEY`,
`PAYOUT_WEBHOOK_SIGNING_KEY`.

## 8. Rollback / Hotfix

- **Web**: Pages → Deployments → pilih deploy sebelumnya →
  "Rollback". Statik SPA = rollback instant.
- **API**: `wrangler rollback` (ke release terakhir) ATAU
  redeploy commit sebelumnya.
- **Admin**: arahkan symlink `/var/www/cverse-admin/current` ke release
  sebelumnya, jalankan `nginx -t`, lalu reload Nginx. Tunnel dan Access
  tidak perlu diubah.
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
- [ ] `admin.c-verse.co` tanpa sesi mendapat redirect Cloudflare Access;
      origin VPS port 80/443 tidak dapat diakses publik.
- [ ] Secrets tidak ada di bundle publik (cari `service_role|SERVER_KEY` di `dist/`).
- [ ] Email via Cloudflare Email Service terkirim: akses kreator +
      digest failure cron (`EMAIL_ENABLED=true`, binding `EMAIL`).
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
| Midtrans/Xendit | fee top-up + disbursement | variabel (cost of goods) |
| **Total infra Y1** | | **≤ Rp 1 juta/bln** (dalam opex Rp 38 jt/thn, recompute 2026-08-20; angka lama 135 jt dibatalkan) |

## Sumber

- `06_tech_decisions.md` (stack, open items O-5/O-7 — dijawab
  runbook ini).
- 01_tech_stack (full-edge, CI/CD O5: GitHub Actions → wrangler
  deploy, domain O7).
- 20_tech_stack_decision (keputusan full-edge 2026-08-05/2026-08-11:
  monorepo, free tier cukup Y1, struktur dual-token; email
  transaksional kini Cloudflare Email Service).
- `05_data_model.md` (RLS → step 4.5).
- Konvensi angka: A024 build time **6-8 bulan** (`01_scope.md`
  §5); opex Y1 **Rp 38 jt/thn (~3,2 jt/bulan)** per financial
  model (recompute 2026-08-20: marketing 0, AI one-time, infra
  free tier) — burn kas bootstrap pasca-launch ~Rp 1 jt/bulan
  (A029; versi lama 135 jt/10-15 jt per bulan dibatalkan).

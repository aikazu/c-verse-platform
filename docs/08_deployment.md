# 08 — Deployment Runbook (Step-by-Step)

> Status: [VALIDATED]
> Last updated: 2026-09-05 (web development, admin, dan aplikasi dana
> aktif di Cloudflare Workers; Access mewajibkan posture WARP; API
> privat dipanggil melalui Service Binding; VPS/Tunnel dipensiunkan)
> Previous: 2026-09-04 (bucket R2 `cverse-kyc` + binding Worker aktif;
> upload/review KYC tidak memakai Supabase Storage)
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
Internet
├── c-verse.co          → Coming Soon publik (tidak diubah selama development)
├── dev.c-verse.co      → Access/WARP → c-verse-web-dev (Worker + Static Assets)
│                                         └─ Service Binding → c-verse-api
├── admin.c-verse.co    → Access/WARP → c-verse-admin (Worker + Static Assets)
│                                         └─ Service Binding → c-verse-api
└── funds.c-verse.co    → Access/WARP → c-verse-funds (Worker + Static Assets)
                                          └─ Service Binding → c-verse-funds-api → D1

c-verse-api dan c-verse-funds-api:
- tanpa custom domain/route publik;
- workers.dev=false dan preview_urls=false;
- hanya dapat dipanggil melalui Service Binding (scheduled trigger API utama
  tetap berjalan langsung di Worker).
```

Infra pendukung: Supabase (Postgres/Auth/Realtime/Supavisor), R2
`cverse-kyc` privat, Cloudflare Email Service, D1 `c-verse-funds`, Cron
Triggers, dan Midtrans sandbox. Cloudflare Queues dan FCM belum aktif.

Environment saat ini:
- `development edge` = branch `main`, deploy manual ke host WARP-only.
- `production public` = belum diluncurkan; root tetap Coming Soon.
- Preview URL Worker dimatikan. Preview dilakukan lokal dengan Wrangler.

### Batasan pengujian webhook selama development

Provider Midtrans tidak mempunyai sesi founder/WARP. Karena itu callback
`POST /api/payments/midtrans/webhook` dan payout webhook tidak dapat mencapai
deployment saat ini. Pengujian top-up sandbox end-to-end belum dapat dinyatakan
lulus hanya dari health check atau UI yang berhasil dibuka.

Sebelum pengujian tersebut, sepakati ingress publik khusus webhook: gateway
terpisah yang hanya meneruskan method/path callback yang dipilih melalui
Service Binding, tetap dengan verifikasi signature dan idempotensi pada API.
Ingress ini belum dibuat; jangan membuka API utama atau melonggarkan policy
WARP untuk mengakomodasi callback. Supabase Auth/Data API tetap digunakan
langsung oleh browser sesuai arsitektur anon key + RLS; Service Binding
memprivatkan Worker API, bukan seluruh endpoint Supabase.

## 2. Prasyarat (Sprint 0)

Akun & kredensial yang harus sudah ada:

| # | Akun/Layanan | Keperluan |
|---|--------------|-----------|
| 1 | Cloudflare (zone domain) | Workers, Static Assets, Service Bindings, D1, R2, Queues, Cron, Access/WARP, DNS |
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
2. DNS/custom domains aktif (zona `c-verse.co`):
   | Type | Name | Target |
   |------|------|--------|
   | Existing | `@` | Coming Soon publik; jangan ditimpa selama development |
   | Worker custom domain | `dev` | `c-verse-web-dev` |
   | Worker custom domain | `admin` | `c-verse-admin` |
   | Worker custom domain | `funds` | `c-verse-funds` |
   | Tidak ada | `api` | Sengaja tidak dibuat; backend privat via Service Binding |
3. SSL/TLS mode: **Full (strict)**.
4. Worker custom domain memprovisikan DNS dan sertifikat otomatis.

### 3.2 Worker gateway web (apps/web)
1. Worker `c-verse-web-dev` menyajikan `apps/web/dist` melalui Static
   Assets di `dev.c-verse.co`.
2. Binding `API` menunjuk ke Worker `c-verse-api`. Route `/api/*`,
   `/sitemap.xml`, dan lookup metadata SEO memakai binding ini; tidak ada
   fetch ke hostname API publik.
3. `VITE_API_URL` hanya override untuk local development. Build edge
   memakai `/api` same-origin. Nilai publik lain: `VITE_SUPABASE_URL`,
   `VITE_SUPABASE_ANON_KEY`, dan `VITE_TURNSTILE_SITE_KEY`.
4. Gateway menghapus cookie dan assertion Access sebelum request internal
   diteruskan, lalu menambahkan security headers ke response.

### 3.3 Private Cloudflare Worker (apps/api)
1. Worker bernama `c-verse-api` (dari `apps/api`, sesuai `wrangler.toml`).
2. Tidak ada custom domain, route publik, `workers.dev`, atau preview URL.
   Hanya gateway web/admin yang mempunyai Service Binding ke Worker ini.
   Deployment dikunci ke account ID di `wrangler.toml` agar resource tidak
   salah akun.
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

### 3.5 Worker gateway admin (apps/admin)
- Worker `c-verse-admin` menyajikan Static Assets di
  `admin.c-verse.co`; binding `API` menunjuk ke `c-verse-api`.
- Browser memakai Supabase publishable/anon key + RLS. Service-role hanya
  secret backend. Mutasi privileged tetap memerlukan role admin + AAL2 dan
  menghasilkan audit log.
- Route API memakai `/api` same-origin. Gateway menghapus cookie dan
  assertion Access sebelum meneruskan request melalui Service Binding.
- Tidak ada origin VPS, Nginx, atau Cloudflare Tunnel.

### 3.6 Access/WARP dan aplikasi dana
- Access app `C.Verse Internal Apps` melindungi host `dev`, `admin`, dan
  `funds` dengan allowlist founder serta requirement device posture WARP.
- Sesi 6 jam; cookie `HttpOnly` + binding cookie; App Launcher tersembunyi.
- Uji dari jaringan non-WARP harus ditolak sebelum Worker. Uji dari device
  founder dengan WARP harus dapat membuka SPA dan endpoint health/data.
- Aplikasi dana memakai gateway `c-verse-funds` dan API privat
  `c-verse-funds-api`. Hanya API privat yang mempunyai binding D1
  `c-verse-funds`; gateway tidak memiliki akses database langsung.

## 4. Setup Supabase (sekali, Sprint 0)

1. Buat project baru (region SG singapore) — nama `cverse-{env}`.
2. Simpan di `.env.local` (lokal) & secrets (CI):
   `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_PASSWORD`.
3. Auth: aktifkan Google OAuth + email OTP; **aktifkan captcha
   anti-spam di email OTP** (Cloudflare Turnstile — buat site key
   + secret key, set di Dashboard Auth → config captcha); set
   redirect URLs untuk root, `https://dev.c-verse.co`,
   `https://*.dev.c-verse.co`, dan `https://admin.c-verse.co`.
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
# 1) Database bila ada migrasi baru
npx supabase db push

# 2) Backend privat lebih dulu, lalu gateway
pnpm --filter @c-verse/api run deploy
pnpm --filter @c-verse/web run deploy
pnpm --filter @c-verse/admin run deploy

# 3) Verifikasi dari device founder dengan WARP
curl https://dev.c-verse.co/api/health
curl https://admin.c-verse.co/api/health
curl -I https://c-verse.co  # Coming Soon tetap aktif
```

Verifikasi tambahan wajib dilakukan dari jaringan/device tanpa WARP:
`dev`, `admin`, dan `funds` harus ditolak oleh Access. Jangan membuat
custom domain sementara untuk `c-verse-api`; diagnosis backend dilakukan
melalui gateway lokal atau observability Worker.

## 7. CI/CD — GitHub Actions

> **STATUS (2026-09-05)**: `.github/workflows/deploy.yml` **TIDAK ADA** —
> tidak ada deploy otomatis dari CI. CI aktif hanya `.github/workflows/ci.yml`
> (gates, PR + main — lihat `15_quality_gates.md` §2). Deploy dilakukan
> MANUAL: API = `pnpm --filter @c-verse/api run deploy` (= `wrangler deploy`);
> Web/admin = script `deploy` masing-masing. Otomasi masa depan wajib
> mempertahankan urutan quality gates → API privat → gateway web/admin,
> dan tidak boleh mengaktifkan `workers.dev`/preview URL.

Secrets CI yang wajib diset (GitHub Settings → Secrets):
`CF_API_TOKEN`, `CF_ACCOUNT_ID`, `SUPABASE_SERVICE_ROLE_KEY`,
`EMAIL_ENABLED`, `EMAIL_FROM`, `ADMIN_ALERT_EMAIL`,
`MIDTRANS_SERVER_KEY` (sandbox), `NFC_MASTER_KEY`,
`PAYOUT_WEBHOOK_SIGNING_KEY`.

## 8. Rollback / Hotfix

- **Web/admin**: Workers → Deployments → rollback ke version sebelumnya.
- **API privat**: `wrangler rollback` (ke release terakhir) ATAU
  redeploy commit sebelumnya.
- **Access**: perubahan policy dilakukan terpisah dari deploy aplikasi.
  Pertahankan satu jalur break-glass akun Cloudflare founder; jangan
  melonggarkan requirement WARP sebagai rollback aplikasi.
- **DB**: migrasi TIDAK auto-rollback. Prinsipi: migrasi selalu
  backward-compatible (add column nullable dulu, drop belakangan);
  kalau rusak, restore point-in-time Supabase + log replay
  dari ledger (append-only) untuk rekonsiliasi.
- **Rule**: jangan deploy Worker + migrate DB dalam satu commit
  (dua langkah terpisah).

## 9. Checklist Go-Live (pre-pilot drop)

- [ ] Domain SSL aktif (HTTPS valid, bukan mixed content).
- [ ] `/api/health` di `dev` dan `admin` OK dari device WARP;
      halaman kartu 3D OK di Chrome Android.
- [ ] Web NFC verify OK di device nyata (C-03); fallback QR OK.
- [ ] Supabase RLS verified (service-role tidak bocor ke publik).
- [ ] `dev`, `admin`, dan `funds` ditolak dari device non-WARP.
- [ ] `c-verse-api` dan `c-verse-funds-api` tidak memiliki custom
      domain, route, `workers.dev`, atau preview URL.
- [ ] Root `c-verse.co` tetap Coming Soon sampai keputusan public launch.
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
- [ ] Ingress webhook khusus disepakati, dibuat, dan diuji dengan callback
      sandbox terverifikasi sebelum menyatakan top-up end-to-end siap.

## 10. Catatan Biaya Y1 (estimasi)

| Item | Unit | Estimasi/bln |
|------|------|--------------|
| Cloudflare Free tier | Workers+Static Assets+D1+R2+Queues | Rp 0 (worst case upgrade ~Rp 500rb) |
| Supabase Free → Pro | 500 MB → 8 GB | Rp 0 → ~Rp 350rb |
| VPS admin/funds | Dipensiunkan 2026-09-05 | Rp 0 |
| Midtrans/Xendit | fee top-up + disbursement | variabel (cost of goods) |
| **Total infra Y1** | | **≤ Rp 1 juta/bln** (dalam opex Rp 38 jt/thn, recompute 2026-08-20; angka lama 135 jt dibatalkan) |

## Sumber

- `06_tech_decisions.md` (stack, open items O-5/O-7 — dijawab
  runbook ini).
- 01_tech_stack (full-edge, Workers Static Assets + Service Binding,
  CI/CD O5, domain O7).
- 20_tech_stack_decision (keputusan full-edge 2026-08-05/2026-08-11:
  monorepo, Workers cukup Y1, struktur dual-token; email
  transaksional kini Cloudflare Email Service).
- `05_data_model.md` (RLS → step 4.5).
- Konvensi angka: A024 build time **6-8 bulan** (`01_scope.md`
  §5); opex Y1 **Rp 38 jt/thn (~3,2 jt/bulan)** per financial
  model (recompute 2026-08-20: marketing 0, AI one-time, infra
  free tier) — burn kas bootstrap pasca-launch ~Rp 1 jt/bulan
  (A029; versi lama 135 jt/10-15 jt per bulan dibatalkan).
- Keputusan founder dan cutover 2026-09-05: `dev`, `admin`, dan
  aplikasi dana memakai Worker gateway + Access/WARP; backend privat
  via Service Binding; VPS/Tunnel dipensiunkan; root tetap Coming Soon.

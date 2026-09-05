# 06 — Tech Decisions (Keputusan Arsitektur)

> Status: [VALIDATED]
> Last updated: 2026-09-05 (`cverse-assets` public aktif di
> `https://assets.c-verse.co`; D1/D9: aplikasi dana dikonsolidasikan
> menjadi satu native Worker + Static Assets + D1; API utama tetap
> privat melalui Service Binding; Access mewajibkan identitas founder
> + posture WARP; cutover dana terverifikasi dan Worker API lama dipensiunkan)
> Previous: 2026-09-04 (KYC private storage dipindah penuh ke
> Cloudflare R2 melalui Worker binding)
> Previous: 2026-09-03 (D3b: dual-token C-Coin/C-Gems — saldo
> penghasilan, lock 24 jam, payout/conversi)
> Previous: 2026-08-31 (email = Cloudflare Email Service binding
> `send_email` — SumoPod SMTP dihapus)
> Previous: 2026-08-18 (sinkronisasi dengan codebase — hapus Turborepo/Drizzle, catat service-role shortcut)
> Konsolidasi final dari full-edge decision. Dok ini SELF-CONTAINED
> — tidak perlu baca dok sumber lain untuk memahami arsitektur MVP.

## 1. Stack Ringkas (Full-Edge, Zero Server Management)

```
repo-root (pnpm workspace)
├── apps/web/      → Worker + Static Assets (`dev.c-verse.co`) — Access/WARP + anon key/RLS
├── apps/admin/    → Worker + Static Assets (`admin.c-verse.co`) — Access/WARP + anon key/RLS
├── apps/api/      → private Cloudflare Worker (Hono) — Service Binding + verify JWT via Supabase JWKS
└── packages/shared → Zod schema (DTO dipakai web + admin + api)

Infra pendukung:
  Supabase (Postgres + Auth + Realtime + Supavisor)
  Cloudflare R2 (`cverse-kyc` private; `cverse-assets` public aktif di `https://assets.c-verse.co` untuk artwork/model/avatar). Avatar user melalui `/me/privacy`, artwork melalui Drops admin; upload JPEG/PNG/WebP melewati API privat — `08_deployment.md` 3.4. Cron Triggers untuk queue email DB, raffle draw dan payout batch; CF Queues belum aktif. Settlement pembelian langsung di RPC, badge event-driven tanpa cron.
  Cloudflare Email Service (binding `send_email` — email transaksional API: akses kreator + queue notifikasi uang/pemenuhan `lib/emailQueue.ts` via cron 1 menit; lane LOW VOLUME HIGH VALUE — outbid, bid masuk, dan kalah raffle tetap in-app saja, 2026-09-02), FCM (push, post-MVP), Midtrans (top-up + disbursement)
  Domain FINAL: c-verse.co (primary; Coming Soon selama development), c-verse.id → 301 redirect
  NDEF URL final: https://c-verse.co/cards/{shortId}/3d (LOCK sebelum provisioning)
```

```
Development web flow:
  WARP device ──► Access ──► Web gateway ──Service Binding──► API privat
                                │                                │
                                └─ Static Assets                 └─ Supabase / R2 / Email

Admin flow (terpisah):
  Founder + WARP ──► Access ──► Admin gateway ──Service Binding──► API privat
                                      │
                                      └─ read: Supabase anon key + RLS
```

| Layer | Pilihan |
|-------|---------|
| Frontend | React 19 + Vite SPA (apps/web) di Cloudflare Workers Static Assets; host development WARP-only |
| Admin app | React 19 + Vite SPA (apps/admin) di Cloudflare Workers Static Assets + Access/WARP |
| Styling | Tailwind CSS 4 + shadcn/ui + Radix |
| Data fetching | TanStack Query |
| Backend | Hono di private Cloudflare Worker (apps/api), hanya melalui Service Binding |
| Database | Supabase Postgres (region SG) + Supavisor |
| ORM | — (query via Supabase client langsung — tidak pakai ORM) |
| Auth | Supabase Auth (Google OAuth + email OTP, **email OTP wajib captcha anti-spam** — Cloudflare Turnstile), JWKS di Hono |
| Storage | Cloudflare R2 `cverse-kyc` private; `cverse-assets` public (APAC, `assets.c-verse.co`, `r2.dev` off) dengan enam fixture terverifikasi dan mapping remote aktif; reset lokal tetap memakai URL Static Assets |
| Queue/async | Queue notifikasi di Postgres + Cron Triggers; CF Queues belum aktif |
| Rate limiting | Native Cloudflare Rate Limiting bindings (auth/payment 30, NFC 60, KYC 10, upload gambar publik 10, global 600 request/menit) |
| Realtime | Supabase Realtime broadcast (< 50 concurrent bidder) |
| Payment | Midtrans (primary) + Xendit (backup) — HANYA top-up & disbursement |
| Shipping | Biteship / RajaOngkir |
| Email | Cloudflare Email Service — binding `send_email` (`EMAIL`), gate `EMAIL_ENABLED`/`EMAIL_FROM`/`ADMIN_ALERT_EMAIL`; SMTP/nodemailer dihapus |
| Push | Firebase Cloud Messaging (FCM) |
| Analytics | PostHog (product) + Plausible (web) |
| Monitoring | Sentry + BetterStack |
| CI/CD | GitHub Actions → wrangler deploy |
| Monorepo | pnpm workspace: apps/web, apps/admin, apps/api, packages/shared (Zod) |

## 2. Keputusan Arsitektur Kunci

### D1 — Admin App TERPISAH di Edge, WARP-Only [revisi 2026-09-05]

- `apps/admin` disajikan oleh Worker `c-verse-admin` melalui Static
  Assets di `admin.c-verse.co`; tidak ada origin VPS atau Tunnel.
- **Cloudflare Access + posture WARP** menjadi perimeter wajib:
  identitas founder harus diizinkan dan device harus terhubung WARP.
- Admin app login melalui Supabase Auth memakai anon key; seluruh
  operasi sensitif melalui route Worker `/api/admin/*` atau route
  admin per-modul, dengan gate server-side role admin aktif dan audit log.
- `SUPABASE_SERVICE_ROLE_KEY` hanya berada di Worker, tidak pernah
  dibundle ke admin SPA. Cloudflare Access tetap menjadi perimeter
  tambahan untuk host admin.
- Web/admin browser = anon key + RLS. Service-role hanya berada di
  Worker API dan tidak pernah masuk bundle frontend.
- **Catatan (dev shortcut)**: `lib/supabase.ts` di API server saat ini
  prefer `serviceKey ?? anonKey` — service-role dipakai backend privat
  sebagai shortcut MVP (bypass RLS selama migrasi). Rencana: transisi
  ke anon key + RLS penuh setelah semua RPC dan RLS tervalidasi.
- Konsekuensi: admin tidak dapat digunakan saat WARP/Access tidak
  tersedia; ini fail-closed yang diterima selama development.
- NFC provisioning (tulis key ke tag) = **tool desktop
  terpisah**, bukan bagian dari admin web app.

Rasional keamanan (jujur):
- Access + posture WARP menghentikan request unmanaged sebelum
  Worker admin menerima traffic; Service Binding menghilangkan
  origin API yang dapat dipanggil langsung dari internet.
- TAPI crown jewel = database + service-role key + payment
  credential + NFC master key. Proteksi utama = key management
  + RLS + Cloudflare Access, bukan sekadar lokasi app.

#### Keamanan admin: akses berlapis + audit log (ADM-08/09)

**Kontrol akses (ADM-09)** — tanpa MFA/TOTP aplikasi wajib, dengan
pertahanan berlapis:
- **Lapis 1 (jaringan)**: Cloudflare Access — identitas founder dan
  posture WARP wajib sebelum app admin terbuka.
- **Lapis 2 (aplikasi)**: Supabase email OTP, lalu role `admin` dan
  `flag_reason` diperiksa server-side sebelum route privileged berjalan.
- **Lapis 3 (data dan forensik)**: browser hanya memakai anon key dengan
  RLS; setiap mutasi dan akses sensitif dicatat di audit log append-only.
- Keputusan 2026-09-05 tidak menonaktifkan MFA secara global dan tidak
  menghapus faktor yang sudah terdaftar pada pengguna.
- Catatan D1: admin browser memakai anon key + RLS. Mutasi privileged
  diteruskan ke Worker API yang memverifikasi role + suspension; guard UI
  bukan satu-satunya kontrol.

**Audit log (ADM-08)** — setiap mutasi admin di-log
append-only (tidak bisa edit/hapus): siapa (user_id), aksi
(create/update/delete/view-sensitive), target (tabel+id),
payload ringkas (bukan PII penuh), IP + session, created_at.
View + filter di PG-ADM-09; kebocoran service-role terdeteksi
dari anomali di log ini (mis. aksi di jam aneh / IP asing).
Retensi: minimum 1 tahun (UU PDP + forensik fraud).

> [SUPERSEDED — 2026-09-05] Rancangan ADM-09 sebelumnya mewajibkan
> Supabase MFA TOTP dan AAL2. Rancangan itu tidak lagi menjadi syarat
> aplikasi; catatan historis dipertahankan untuk jejak keputusan.

### D2 — NFC iOS: Koreksi Asumsi [baru 2026-08-12]

- **Fakta**: CMAC dihitung oleh CHIP (AES-128, key di secure
  memory tag), bukan HP. Saat tap, chip menempel
  `?uid=..&ctr=..&c=CMAC` ke URL NDEF (SUN/SDM).
- **iOS**: background tag reading membuka URL NDEF di Safari
  → URL membawa data kriptografik → server verify → **halaman
  3D kartu tampil verified**. **Tap-to-verify JALAN di iOS
  TANPA Web NFC API.**
- **Web NFC API** (`navigator.nfc`) = Chrome Android 89+ only;
  hanya dibutuhkan untuk scan terprogram dari dalam halaman.
- Implikasi: fallback QR BUKAN keharusan untuk iOS; QR di dus
  untuk HP tanpa NFC. **Validasi device nyata di Sprint 0
  (C-03)** sebelum mematikan fallback.

### D3 — C-Coin: Top-Up Aman setelah T&C Final

- Wallet + ledger + payout = fitur teknis biasa, **boleh
  dibangun**.
- **Top-up uang riil bisa diterima** setelah T&C final
  (disclosure "saldo tidak dapat diuangkan", refund-to-source,
  cap saldo) + cap saldo diimplementasi. Validasi lawyer
  2026-08-13: struktur Opsi A valid, C-Coin bukan e-money.
- Fallback Opsi B (wallet-as-a-service issuer berizin) disimpan
  sebagai contingency untuk perubahan regulasi masa depan.

### D3b — Dual-Token: C-Coin (belanja) + C-Gems (penghasilan) [baru 2026-09-03]

- Keputusan owner (brainstorm + riset regulasi 2026-09-02,
  terkunci 2026-09-03): ledger dipisah menjadi dua token —
  penuntasan implisit C-01 (dulu satu saldo nyampur "hasil titip
  jual" dengan saldo belanja).
- **C-Coin = saldo belanja**: lahir dari top-up (Midtrans), untuk
  drop, marketplace, bid, ongkir ship-out, kirim Dukungan.
  One-way, TIDAK bisa dicairkan, non-refundable. XP didapat saat
  dibelanjakan (aturan spend existing).
- **C-Gems = saldo penghasilan**: lahir HANYA dari settlement
  milik sendiri — hasil jual seed (release), buyout/accept-bid
  (seller 85%), royalti kreator (drop primary + sekunder), dan
  Dukungan yang diterima (100%). Non-transferable antar user.
- **Pintu keluar C-Gems (hanya dua)**:
  1. Payout ke IDR — KYC wajib, batch mingguan, fee 1%; payout
     debit HANYA lot Gems matured (cooldown di bawah). Hasil
     pencairan = "Pembayaran Hasil Titip Jual/Konsinyasi".
  2. Konversi satu arah Gems→C-Coin 1:1 — tanpa potongan, tanpa
     XP di titik konversi; C-Coin hasil konversi dapat XP saat
     dibelanjakan.
- **Cooldown 24 jam per-lot**: setiap kredit Gems membentuk lot
  terkunci 24 jam (`gem_lots.mature_at`); payout hanya debit lot
  matured (FIFO). Konversi TIDAK terkena cooldown. Skema
  `wallets.balance_gems` + `gem_lots` + `gem_transactions`:
  `05_data_model.md`.
- **Revenue lane TIDAK berubah**: treasury/system user tetap
  menerima C-Coin via `record_platform_revenue`; share 70/30
  (primary) & 7,5/7,5/85 (secondary) tetap.
- **Rasio legal**: C-Coin one-way/non-cashable mempertahankan
  posisi closed-loop C-01 Opsi A. Keputusan owner 2026-09-04:
  refresh opini lawyer dual-token bukan release gate; residual
  risk diterima dengan guardrail produk dan monitoring regulasi.
  Lihat amend C-01 di `07_constraints.md`.
- **Motivasi (temuan audit)**: RPC `payout_request` lama debit
  C-Coin tanpa gate kreator → premis non-cashable bocor; kini
  payout debit `balance_gems` matured only.

### D4 — Verifikasi NFC (Server-Side CMAC)

- NDEF: `https://c-verse.co/cards/{short_id}/3d` + SUN dynamic
  mirror (UID + counter + CMAC).
  > **PENTING**: domain/path NDEF final sebelum provisioning
  > tag — mengubah URL di NDEF = re-provision/pemrograman ulang
  > chip (bukan bisa diubah remote). **Domain FINAL: `c-verse.co`**
  > (FINAL 2026-08-13); `c-verse.id` redirect. LOCK sebelum
  > produksi inlay.
- Backend (Workers): derive expected CMAC dari AppKey
  (diversified master key + UID) + counter → compare → parse
  TagTamper → lookup `cards` by short_id/UID.
- Master key di KMS (Cloudflare Workers Secrets / external
  KMS), tidak pernah di client.
- Library: AES/CMAC open source (Node crypto) — NXP TapLinx
  SDK opsional.
- Web Crypto tersedia di Workers; verifikasi < 1ms.

### D5 — Checkout "Siapa Cepat" (Race)

- Transaksi atomik via RPC/SQL transaction dengan row lock
  pada `cards` atau `drops` (unit tersisa).
- Counter real-time via Supabase Realtime broadcast.
- Idempotency: checkout key per user+drop.

### D6 — Realtime

- Supabase Realtime broadcast cukup untuk < 50 concurrent
  bid (secondary). Durable Objects TIDAK dipakai Y1.

### D7 — Shared Schema

- `packages/shared`: schema Zod (Zod 4) untuk semua DTO yang
  dipakai web + admin + api. Satu sumber kebenaran validasi.
- Selain schema, `packages/shared` juga menampung peta label status UI
  (`dropStatusLabel`, `orderStatusLabel`, `shipmentStatusLabel`,
  `cardLocationLabel`, `kycStatusLabel`, `walletTxTypeLabel`) — enum
  backend (snake_case/English) dipetakan ke label Indonesia di satu
  tempat, fallback ke nilai mentah agar status tak dikenal tidak
  membuat UI crash. Web & admin merender status lewat `StatusBadge`
  yang memakai peta ini.

### D8 — Frontend UI Conventions [baru 2026-08-19]

- **Aksesibilitas baseline**: toast `role="status"`/`aria-live`
  (error → `role="alert"`); setiap input terhubung label via
  `htmlFor`/`id` atau `aria-label`; modal = `role="dialog"` +
  `aria-modal` + tutup via Escape; skip link "Lompat ke konten"
  (`#main-content`); `:focus-visible` + `prefers-reduced-motion` global.
- **State query**: list/detail wajib menangani `isError` (bukan hanya
  `isLoading`) — komponen bersama `apps/web/src/lib/QueryStates.tsx`
  (`LoadingState`/`ErrorState` + retry); akses `data` di-guard agar
  gagal fetch tidak crash ke ErrorBoundary. Di admin, kegagalan load
  ditampilkan (bukan tampil `0`/stuck "Memuat…").
- **Aksi mutasi**: tombol di-`disable` saat request in-flight; SEMUA
  aksi destruktif/finansial wajib konfirmasi modal in-app
  `ConfirmProvider`/`useConfirm()` (tema Space Arcade; opsi `danger`
  untuk aksi irreversible) — ikut raffle, bid, buyout, top-up,
  ship-out, terima bid, batal drop, suspend, fraud-hold, approve KYC,
  batch payout, draw, resolve sengketa, batal kirim. Native
  `window.confirm` DILARANG di apps/web dan apps/admin
  [update 2026-08-29] — admin memakai `ConfirmProvider` sendiri
  (komponen setara, styling `cfm-*` ter-inherit via `@import`) +
  disable-while-loading.
- **Konsistensi visual**: warna lewat CSS var (`--gold-bg`,
  `--signal-bg`, `--alert-bg`, `--info-bg`, dst) — jangan hardcode
  rgba; komponen berulang diekstrak (`StatusBadge`, `LevelBar`); IDR
  via `formatIdr` + kurs dari `C_COIN_RATE_IDR` (jangan `* 10000`).

### D9 — API Privat via Service Binding [baru 2026-09-05]

- Worker `c-verse-api` tidak memiliki custom domain, route publik,
  `workers.dev`, atau preview URL. Scheduled triggers tetap berjalan
  langsung pada Worker.
- Gateway `c-verse-web-dev` dan `c-verse-admin` menyajikan SPA serta
  meneruskan `/api/*` secara same-origin melalui Service Binding
  `API`; frontend tidak lagi bergantung pada `api.c-verse.co`.
- Gateway menghapus `Cookie` dan `Cf-Access-Jwt-Assertion` sebelum
  request internal diteruskan. API hanya menerima credential aplikasi
  yang memang dibutuhkan, bukan credential perimeter Zero Trust.
- `dev.c-verse.co`, `admin.c-verse.co`, dan aplikasi dana internal
  berada di satu Access app dengan allowlist founder + posture WARP.
  Root `c-verse.co` tetap Coming Soon selama development.
- **Pengecualian terlingkup aplikasi dana**: `c-verse-funds` di
  `funds.c-verse.co` adalah satu native Worker yang menyajikan Static
  Assets dan route API dengan binding D1 `c-verse-funds`; konfigurasi
  Worker tunggal memakai `nodejs_compat`, `ASSETS`, dan `CF_VERSION`.
  Entrypoint `src/worker.mjs` meneruskan request internal ke
  `handleApiRequest(request, env)` di `src/api.mjs`; tipe lingkungan
  tunggal adalah `FundsEnv` di `worker-configuration.d.ts`.
- Ini bukan batas kapabilitas database terpisah: isolasi berada pada
  modul aplikasi dan perimeter Access founder allowlist + posture WARP
  yang tepercaya. Karena itu tidak ada Service Binding, deployment,
  atau type file kedua untuk `c-verse-funds-api`.
- Script aplikasi dana adalah `npm run dev`, `npm run check`,
  `npm run deploy`, dan `npm run cf-typegen`. Cutover 2026-09-05 telah
  terverifikasi; Worker API lama dipensiunkan setelah verifikasi.

## 3. Yang BELUM Diputuskan (Open Items)

| Kode | Item | Status |
|------|------|--------|
| O-1 | Detail implementasi CMAC & key derivation di KMS Workers | Sprint 0 |
| O-2 | Region final Supabase (SG vs lain) | Sprint 0 |
| O-3 | Struktur bucket R2 KYC | **Selesai 2026-09-04: bucket privat `cverse-kyc`, binding `KYC`, akses hanya lewat Worker** |
| O-4 | Cache strategy TanStack Query | Sprint 0 |
| O-5 | CI/CD pipeline detail | **Dijawab `08_deployment.md` section 7** |
| O-6 | Monitoring stack final | Sprint 0 |
| O-7 | Domain & SSL | **Dijawab `08_deployment.md` section 3 & 9** |
| C-03 | Validasi iOS tap-to-verify SUN URL di device nyata | Sprint 0 (blocking D2) |

## Sumber

- 01_tech_stack (full-edge, konsolidasi 2026-08-11).
- 20_tech_stack_decision (keputusan full-edge 2026-08-05/2026-08-11:
  React/Vite + Hono di Cloudflare Workers, Supabase, R2;
  monorepo; free tier cukup Y1).
- 18_nfc_decision (N5 arsitektur verifikasi — SUN/SDM: ISO 7816-4
  file system, SDM mirror UID+counter+CMAC ke NDEF, server-side CMAC
  verify; N5b iOS via SUN URL).
- 05_mvp_flow (Flow 1-9).
- 02_legal_compliance 2,2 (C-Coin [VALIDATED 2026-08-13]: bukan
  e-money, struktur Opsi A closed-loop + payout fee 1%).
- Diskusi founder 2026-08-12 (D1, D2).
- Brainstorm + riset regulasi dual-token 2026-09-02 (keputusan
  owner terkunci 2026-09-03) — D3b.
- Keputusan founder 2026-09-05: web development dan admin memakai
  backend privat melalui Service Binding; aplikasi dana adalah satu
  native Worker dengan D1; Access wajib WARP; root domain tetap Coming
  Soon selama development. Cutover aplikasi dana telah terverifikasi dan
  Worker API lama dipensiunkan.
- Keputusan founder 2026-09-05: hapus kewajiban MFA/TOTP aplikasi admin;
  pertahankan login email OTP, otorisasi API, RLS, Access/WARP, dan audit log.

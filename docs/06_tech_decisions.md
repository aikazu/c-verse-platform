# 06 — Tech Decisions (Keputusan Arsitektur)

> Status: [VALIDATED]
> Last updated: 2026-08-18 (sinkronisasi dengan codebase — hapus Turborepo/Drizzle, catat service-role shortcut)
> Konsolidasi final dari full-edge decision. Dok ini SELF-CONTAINED
> — tidak perlu baca dok sumber lain untuk memahami arsitektur MVP.

## 1. Stack Ringkas (Full-Edge, Zero Server Management)

```
repo-root (pnpm workspace)
├── apps/web/      → Cloudflare Pages (SPA publik, statik) — anon key + RLS
├── apps/admin/    → LOKAL / VPS + Cloudflare Tunnel + Access — service-role key (bypass RLS)
├── apps/api/      → Cloudflare Workers (Hono) — verify JWT via Supabase JWKS
└── packages/shared → Zod schema (DTO dipakai web + admin + api)

Infra pendukung:
  Supabase (Postgres + Auth + Realtime + Supavisor)
  Cloudflare R2 (artwork, 3D, KYC private) + Queues (email, payout) + Cron Triggers (escrow settlement, raffle draw, payout batch — badge murni event-driven tanpa cron, lihat `05_data_model.md`)
  SumoPod SMTP (email), FCM (push), Midtrans/Xendit (top-up + disbursement)
  Domain FINAL: c-verse.co (primary), c-verse.id → 301 redirect
  NDEF URL final: https://c-verse.co/cards/{shortId}/3d (LOCK sebelum provisioning)
```

```
Request flow (public):
  User ──► Wrangler WORKER ──► Supabase (RLS + RPC) ──► R2 / Queues
              │                    ▲
              │  verify JWT         │ Realtime broadcast
              └────────────────────┘ (drop_countdown, bid_events)

Admin flow (terpisah):
  Founder ──► Cloudflare Access ──► Admin app (localhost/VPS) ──► Supabase (service-role)
                                        │
                                        └─ direct: NFC tool → Supabase REST
```

| Layer | Pilihan |
|-------|---------|
| Frontend | React 19 + Vite SPA (apps/web) di Cloudflare Pages |
| Admin app | React 19 + Vite SPA (apps/admin) — **LOKAL/VPS, bukan Pages** |
| Styling | Tailwind CSS 4 + shadcn/ui + Radix |
| Data fetching | TanStack Query |
| Backend | Hono di Cloudflare Workers (apps/api) |
| Database | Supabase Postgres (region SG) + Supavisor |
| ORM | — (query via Supabase client langsung — tidak pakai ORM) |
| Auth | Supabase Auth (Google OAuth + email OTP, **email OTP wajib captcha anti-spam** — Cloudflare Turnstile), JWKS di Hono |
| Storage | Cloudflare R2 (artwork, model 3D) — zero egress fee |
| Queue/async | CF Queues + Cron Triggers |
| Realtime | Supabase Realtime broadcast (< 50 concurrent bidder) |
| Payment | Midtrans (primary) + Xendit (backup) — HANYA top-up & disbursement |
| Shipping | Biteship / RajaOngkir |
| Email | Abstraction layer (default **SumoPod SMTP** — smtp.sumopod.com:465 SSL; vendor-agnostic) |
| Push | Firebase Cloud Messaging (FCM) |
| Analytics | PostHog (product) + Plausible (web) |
| Monitoring | Sentry + BetterStack |
| CI/CD | GitHub Actions → wrangler deploy |
| Monorepo | pnpm workspace: apps/web, apps/admin, apps/api, packages/shared (Zod) |

## 2. Keputusan Arsitektur Kunci

### D1 — Admin App TERPISAH, TIDAK di Edge [baru 2026-08-12]

- `apps/admin` dijalankan **lokal** (mesin founder) atau VPS
  kecil + **Cloudflare Access** (Zero Trust). TIDAK di-upload
  ke Cloudflare Pages publik.
- Admin app akses **Supabase langsung via service-role key**
  (env var, tidak pernah di bundle publik).
- **TIDAK ADA route admin di Workers API publik.** Public API
  hanya untuk user/kreator.
- Public app = anon key + RLS. Service-role = admin only.
- **Catatan (dev shortcut)**: `lib/supabase.ts` di API server saat ini
  prefer `serviceKey ?? anonKey` — service-role dipakai di API publik
  sebagai shortcut MVP (bypass RLS selama migrasi). Rencana: transisi
  ke anon key + RLS penuh setelah semua RPC dan RLS tervalidasi.
- Konsekuensi: operasi berhenti jika mesin admin mati →
  rekomendasi VPS kecil + Cloudflare Access (Rp 100-200rb/bln)
  untuk always-on.
- NFC provisioning (tulis key ke tag) = **tool desktop
  terpisah**, bukan bagian dari admin web app.

Rasional keamanan (jujur):
- "Lokal" menghilangkan endpoint admin dari internet (tidak
  bisa brute-force/crawl).
- TAPI crown jewel = database + service-role key + payment
  credential + NFC master key. Proteksi utama = key management
  + RLS + Cloudflare Access, bukan sekadar lokasi app.

#### Keamanan admin: 2FA + audit log (ADM-08/09)

**2FA (ADM-09)** — Supabase Auth MFA (TOTP) wajib untuk semua
akun admin, dua lapis:
- **Lapis 1 (jaringan)**: Cloudflare Access — gate jaringan
  (email OTP/push ke device founder) sebelum app admin terbuka.
- **Lapis 2 (aplikasi)**: Supabase MFA TOTP — enrollment scan
  QR authenticator (Google Auth/dll) + simpan **recovery codes**
  saat pertama login; tiap login berikutnya: login biasa = sesi
  aal1 (menu non-sensitive tetap bisa diakses, mis. dashboard
  ringkas), UI privileged (semua CRUD ADM-01..10) terkunci
  sampai `supabase.auth.mfa.challenge()` + `verify()` upgrade
  sesi ke **aal2**.
- **Break-glass**: admin lain (sudah aal2) bisa reset enrollment
  yang hilang — semua langkah tercatat di audit log.
- Catatan D1: admin app akses Supabase via service-role
  (lewati RLS), jadi penegakan aal2 dilakukan DI APP (guard
  route/UI) + Cloudflare Access di jaringan. Deklarasikan
  ekspektasi ini di runbook.

**Audit log (ADM-08)** — setiap mutasi admin di-log
append-only (tidak bisa edit/hapus): siapa (user_id), aksi
(create/update/delete/view-sensitive), target (tabel+id),
payload ringkas (bukan PII penuh), IP + session, created_at.
View + filter di PG-ADM-09; kebocoran service-role terdeteksi
dari anomali di log ini (mis. aksi di jam aneh / IP asing).
Retensi: minimum 1 tahun (UU PDP + forensik fraud).

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
- **Aksi mutasi**: tombol di-`disable` saat request in-flight; aksi
  destruktif/finansial (batal drop, suspend, fraud-hold, approve KYC,
  batch payout, draw, resolve sengketa, batal kirim) minta konfirmasi.
- **Konsistensi visual**: warna lewat CSS var (`--gold-bg`,
  `--signal-bg`, `--alert-bg`, `--info-bg`, dst) — jangan hardcode
  rgba; komponen berulang diekstrak (`StatusBadge`, `LevelBar`); IDR
  via `formatIdr` + kurs dari `C_COIN_RATE_IDR` (jangan `* 10000`).

## 3. Yang BELUM Diputuskan (Open Items)

| Kode | Item | Status |
|------|------|--------|
| O-1 | Detail implementasi CMAC & key derivation di KMS Workers | Sprint 0 |
| O-2 | Region final Supabase (SG vs lain) | Sprint 0 |
| O-3 | Struktur bucket R2 (artwork, model 3D, KYC) | Sprint 0 |
| O-4 | Cache strategy TanStack Query | Sprint 0 |
| O-5 | CI/CD pipeline detail | **Dijawab `08_deployment.md` section 7** |
| O-6 | Monitoring stack final | Sprint 0 |
| O-7 | Domain & SSL | **Dijawab `08_deployment.md` section 3 & 9** |
| C-03 | Validasi iOS tap-to-verify SUN URL di device nyata | Sprint 0 (blocking D2) |

## Sumber

- 01_tech_stack (full-edge, konsolidasi 2026-08-11).
- 20_tech_stack_decision (keputusan full-edge 2026-08-05/2026-08-11:
  React/Vite + Hono di Cloudflare Pages/Workers, Supabase, R2;
  monorepo; free tier cukup Y1).
- 18_nfc_decision (N5 arsitektur verifikasi — SUN/SDM: ISO 7816-4
  file system, SDM mirror UID+counter+CMAC ke NDEF, server-side CMAC
  verify; N5b iOS via SUN URL).
- 05_mvp_flow (Flow 1-9).
- 02_legal_compliance 2,2 (C-Coin [VALIDATED 2026-08-13]: bukan
  e-money, struktur Opsi A closed-loop + payout fee 1%).
- Diskusi founder 2026-08-12 (D1, D2).
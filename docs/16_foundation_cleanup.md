# 16 — Foundation Cleanup (quick fixes hasil audit 2026-08-15)

> Status: [SEBAGIAN TEREEKSEKUSI — F-05/F-09/F-10 RESOLVED di kode; F-03 DEFERRED; F-06 RESOLVED-INVALID — lihat catatan per item]
> Created: 2026-08-15
> Daftar perbaikan kecil hasil audit `C:\Users\iqbal\Documents\C-Verse\Platform`
> yang tidak masuk spec besar 10-14. Eksekusi sekali jalan (1-2 hari),
> boleh paralel dengan spec mana pun — tidak bertabrakan.
> Prinsip: setiap fix menyebut file:line + perubahan eksak.

## Fix List

### F-01 Vault default (pelanggaran C-10 FINAL)
- `packages/shared/src/index.ts` baris ~129:
  `deliveryOptionSchema.default("shipping")` → `.default("vault")`.
- `apps/api/src/modules/orders/routes.ts`: default parameter checkout ke
  `vault`; shipping = opt-in eksplisit.
  (Update 2026-08-28 — founder: purchase → vault only; opsi
  shipping dihapus dari checkout, bukan sekadar non-default.)
- Migration: `orders.delivery_option` default `'vault'` sudah jadi bagian
  definisi tabel di `01_schema.sql` (sebelumnya phase 1 `foundation`,
  timestamp `20260817000000` — dilebur saat konsolidasi 2026-08-24),
  bukan migration terpisah.
- UI `/drops/:id/checkout`: opsi terpilih default = "Simpan di vault
  (gratis)"; kirim fisik = pilihan kedua.

### F-02 Hapus jalur legacy auction/listing (pelanggaran C-07 FINAL)
- Hapus dari `packages/shared`: `listingStatusSchema` (berisi
  `expired`), `listingTypeSchema`, `createListingSchema`,
  `bidSchema` (versi listingId), interface `Listing`.
- Hapus route `apps/api/src/routes/listings.ts` (mount di index juga).
- Migration: tabel `listings` & enum `listing_status`/`listing_type` tidak
  pernah dibuat — dihilangkan langsung di `01_schema.sql` (sebelumnya
  phase 1 `foundation`, timestamp `20260817000000` — dilebur saat
  konsolidasi 2026-08-24); `bids` dibuat langsung ke `card_id`
  (tanpa `listing_id`).
- UI `Marketplace.tsx`/`Browse.tsx`: pastikan tidak ada sisa
  "duration/endsAt/expired".

### F-03 KYC threshold top-up — [DEFERRED — 2026-08-23]
- **Status pra-launch**: payout flow diubah jadi request + admin
  approval + disbursement manual (founder 2026-08-23). Threshold
  auto-trigger tidak dibutuhkan pra-launch karena tidak ada alur
  payout otomatis yang harus di-gate.
- Tunda implementasi `KYC_TRIGGER_THRESHOLD_CCOIN` & demo override
  sampai ada disbursement otomatis (Y2+). Tidak ada konstanta
  `KYC_TOPUP_THRESHOLD_DEMO` yang ditambahkan ke `packages/shared`.
- Kapasitas saldo non-KYC 500 C-Coin (`BALANCE_CAP_CCOIN`) tetap
  satu-satunya gate KYC yang dipakai MVP — lihat `07_constraints.md`
  C-08.

### F-04 Tipe `WalletTransaction` tertinggal
- `packages/shared/src/index.ts` interface `WalletTransaction`:
  tambah `metadata?: Record<string, unknown> | null;` dan
  `feeCcoin?: number | null;` (runtime & DB sudah pakai — interface
  bohong saat ini).

### F-05 Hapus endpoint publik berbahaya
- `apps/api/src/modules/nfc/routes.ts` `POST /simulate-tamper/:cardId` —
  pindah ke route admin service-role (atau hapus total; set status
  tamper cukup via admin app ADM-04).
- **[RESOLVED 2026-08-29]** Endpoint sudah TIDAK ADA di source
  (`apps/api/src`) — hanya sisa artefak build `.wrangler/tmp`; tidak
  ada route yang perlu dihapus.

### F-06 Dead code `calcLevel` — [RESOLVED-INVALID 2026-08-23, REFRESHED 2026-08-27]
- Premis audit salah: `packages/shared/src/index.ts:432-442`
  `calcLevel` memang **menggunakan** `level` — return
  `{ level, tier }` (dipakai `xpForNextLevel` dan UI leaderboard).
- Tier lookup: 10-band Galactic ladder `LEVEL_TIERS`
  (`packages/shared/src/index.ts:417-428`) — `calcLevel` memilih
  band via `Math.floor((level - 1) / 10)`; tier diturunkan
  read-time, tidak disimpan di Postgres.
- Tidak ada perubahan kode; item dihapus dari daftar perbaikan.

### F-07 Halaman `Admin.tsx` di web publik
- `apps/web/src/pages/Admin.tsx` — hapus beserta route-nya.
  Admin = app terpisah (D1 FINAL); tidak ada route admin di web
  publik.

### F-08 Fail-fast tanpa database
- `apps/api/src/index.ts` startup: kalau `SUPABASE_URL` kosong DAN
  `NODE_ENV === 'production'` → `throw new Error('SUPABASE_URL
  required in production')` — jangan silent fallback in-memory di
  produksi. (Fallback in-memory hanya dev/demo lokal.)

### F-09 `.env.example` sinkron — [RESOLVED 2026-08-23]
- Status aktual `apps/api/.env.example` sudah mencantumkan semua env
  yang dibaca kode:
  - `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY`
    (WAJIB; service-role hanya server/admin).
  - `EMAIL_ENABLED` + `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` /
    `SMTP_PASS` (Node-runtime only — lihat catatan prod di T5).
  - `NFC_MASTER_KEY` (16 byte hex / 32 char; key diversification per-UID N5).
  - `MIDTRANS_SERVER_KEY` + `MIDTRANS_IS_PRODUCTION` (sandbox dulu).
  - `PAYOUT_WEBHOOK_SIGNING_KEY` (docs/14 §3.2).
- **Tidak** ditambah ke `apps/api/.env.example` (dan memang tidak
  dipakai API):
  - `TURNSTILE_SECRET_KEY` — diset via dashboard Supabase Auth
    provider (server verify token), bukan di env API.
  - `TURNSTILE_SITE_KEY` / `MIDTRANS_CLIENT_KEY` — frontend/web
    saja, masing-masing `apps/web/.env.example`. API tidak butuh.
- Verifikasi `.env` / `.dev.vars` / `.wrangler/` tetap gitignored —
  hanya `.env.example` yang di-track.

### F-10 README klaim vs realita
- `README.md` Platform: bagian "Keamanan & Anti-Fraud" mengklaim
  hal yang baru akan jalan setelah spec 10-14. Tandai section dengan
  status implementasi per item: `[done]` / `[spec 1x]` supaya tidak
  menyesatkan.

## Acceptance Criteria

- [ ] `grep -rn "shipping" packages/shared | grep default` → tidak
      ada default shipping.
- [ ] `grep -rn "expired\|durationDays\|endsAt" packages/shared
      apps/api/src apps/web/src` → nol hasil (setelah F-02).
- [ ] `pnpm typecheck` lulus tanpa hack `as unknown as` baru di
      area yang difix.
- [ ] Test 3.1 spec 15 hijau untuk shared setelah perubahan.
- [ ] Demo flow smoke (15 §3,4 langkah 3) tetap jalan: checkout
      default vault.

## Sumber

- Audit foundation Platform 2026-08-15 (dev-strategy session).
- `07_constraints.md` C-07, C-10, C-08 (FINAL yang dilanggar code).
- Keputusan founder 2026-08-23: payout = request + admin approval +
  disbursement manual → F-03 KYC threshold auto-trigger di-defer.

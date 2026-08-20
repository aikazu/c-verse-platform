# 16 — Foundation Cleanup (quick fixes hasil audit 2026-08-15)

> Status: [DRAFT — SPEC SIAP EKSEKUSI]
> Created: 2026-08-15
> Daftar perbaikan kecil hasil audit `C:\Users\iqbal\Documents\C-Verse\Platform`
> yang tidak masuk spec besar 10-14. Eksekusi sekali jalan (1-2 hari),
> boleh paralel dengan spec mana pun — tidak bertabrakan.
> Prinsip: setiap fix menyebut file:line + perubahan eksak.

## Fix List

### F-01 Vault default (pelanggaran C-10 FINAL)
- `packages/shared/src/index.ts` baris ~129:
  `deliveryOptionSchema.default("shipping")` → `.default("vault")`.
- `apps/api/src/routes/orders.ts`: default parameter checkout ke
  `vault`; shipping = opt-in eksplisit.
- Migration: `orders.delivery_option` default `'vault'` sudah jadi bagian
  definisi tabel di fase 1 (migration phase 1 `foundation`,
  timestamp `20260817000000`), bukan migration terpisah.
- UI `/drops/:id/checkout`: opsi terpilih default = "Simpan di vault
  (gratis)"; kirim fisik = pilihan kedua.

### F-02 Hapus jalur legacy auction/listing (pelanggaran C-07 FINAL)
- Hapus dari `packages/shared`: `listingStatusSchema` (berisi
  `expired`), `listingTypeSchema`, `createListingSchema`,
  `bidSchema` (versi listingId), interface `Listing`.
- Hapus route `apps/api/src/routes/listings.ts` (mount di index juga).
- Migration: tabel `listings` & enum `listing_status`/`listing_type` tidak
  pernah dibuat — dihilangkan langsung di fase 1 (migration phase 1
  `foundation`, timestamp `20260817000000`);
  `bids` dibuat langsung ke `card_id` (tanpa `listing_id`).
- UI `Marketplace.tsx`/`Browse.tsx`: pastikan tidak ada sisa
  "duration/endsAt/expired".

### F-03 KYC threshold top-up
- `packages/shared/src/index.ts`: `KYC_TRIGGER_THRESHOLD_CCOIN = 99`
  → ganti nilai **1000** (1.000 C-Coin = Rp 10 jt, usulan kebijakan
  KYC [DRAFT]: trigger payout/disbursement ke IDR + akumulasi top-up
  besar; verifikasi manual Y1, SLA 1x24 jam, rekening atas nama KTP,
  retensi 5 tahun UU PDP) + komentar:
  `// finalisasi sebelum launch (10_kyc_policy) — jangan dipakai
  // untuk demo tanpa env override`.
- Tambah `KYC_TOPUP_THRESHOLD_DEMO = 99` (khusus seed demo) bila
  akun demo butuh trigger rendah.

### F-04 Tipe `WalletTransaction` tertinggal
- `packages/shared/src/index.ts` interface `WalletTransaction`:
  tambah `metadata?: Record<string, unknown> | null;` dan
  `feeCcoin?: number | null;` (runtime & DB sudah pakai — interface
  bohong saat ini).

### F-05 Hapus endpoint publik berbahaya
- `apps/api/src/routes/nfc.ts` `POST /simulate-tamper/:cardId` —
  pindah ke route admin service-role (atau hapus total; set status
  tamper cukup via admin app ADM-04).

### F-06 Dead code `calcLevel`
- `packages/shared/src/index.ts` `calcLevel`: variabel `level`
  (baris pertama) tidak pernah dipakai — hapus; sisakan versi
  clamp `lvl` + tier.

### F-07 Halaman `Admin.tsx` di web publik
- `apps/web/src/pages/Admin.tsx` — hapus beserta route-nya.
  Admin = app terpisah (D1 FINAL); tidak ada route admin di web
  publik.

### F-08 Fail-fast tanpa database
- `apps/api/src/index.ts` startup: kalau `SUPABASE_URL` kosong DAN
  `NODE_ENV === 'production'` → `throw new Error('SUPABASE_URL
  required in production')` — jangan silent fallback in-memory di
  produksi. (Fallback in-memory hanya dev/demo lokal.)

### F-09 `.env.example` sinkron
- Tambah variabel baru dari spec 10/12/14:
  `SUPABASE_SERVICE_ROLE_KEY` (komentar: server/admin only),
  `NFC_MASTER_KEY`, `MIDTRANS_SERVER_KEY`, `MIDTRANS_CLIENT_KEY`,
  `MIDTRANS_IS_PRODUCTION`, `TURNSTILE_SITE_KEY`,
  `TURNSTILE_SECRET_KEY`, `PAYOUT_WEBHOOK_SIGNING_KEY`.
- Verifikasi `.env` tidak pernah ter-commit (sudah benar saat audit:
  hanya `.env.example` yang tracked — pertahankan).

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
- Kebijakan KYC (threshold top-up usulan: 1.000 C-Coin = Rp 10 jt,
  trigger payout + akumulasi top-up besar; [DRAFT] — finalisasi
  sebelum launch).

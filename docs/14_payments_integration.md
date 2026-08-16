# 14 — Payments Integration (Midtrans top-up + payout disbursement)

> Status: [IMPLEMENTED 2026-08-16 — top-up Snap + webhook idempotent +
> cap saldo KYC-gated (C-08 FINAL) + payout_request self-service;
> disbursement IRIS via ops (belum auto-call dari code)]
> Created: 2026-08-15; updated: 2026-08-16.
> Gate legal: integrasi sandbox BOLEH jalan kapan pun; **top-up uang
> riil hanya setelah T&C final** — cap saldo sudah live (C-08).

## 1. Prinsip

1. Midtrans = primary, Xendit = backup Y2. **Buat abstraction, bukan
   dua implementasi**: interface `PaymentProvider` + impl Midtrans saja.
2. Uang masuk HANYA via webhook terverifikasi signature — bukan dari
   response redirect user (bisa dipalsukan).
3. Semua kredit saldo via RPC `wallet_credit` (spec 13) dengan
   `idempotency_key = midtrans order_id` — duplicate notification aman.
4. Fee 1% payout dihitung sisi platform (net = nominal × 0,99),
   bukan dipotong gateway.
5. KYC + rekening atas nama sendiri = syarat register beneficiary
   payout (konsisten `10_kyc_policy.md`).

## 2. Top-Up (Midtrans Snap)

### 2,1 Flow
```
User pilih nominal C-Coin (min 1, max 10000; cap saldo lihat C-08)
  -> POST /api/payments/topup { amountCcoin }
     API: gate cap non-KYC 500 C-Coin (balance + amount > 500 dan
          KYC belum approved -> 422 KYC_TOPUP_CAP, Snap TIDAK dibuat)
          amount_idr = ccoin x 10.000
          order_id = "top-{userId}-{epoch}-{rand4}"   (unik, idempotent)
          Midtrans Snap API: POST /snap/v1/transactions
            (server_key Basic auth, item_details, gross_amount)
  -> return snap_token / redirect_url -> web buka Snap UI
  -> User bayar (QRIS/VA/e-wallet)
  -> Midtrans POST /api/payments/midtrans/webhook (notification)
     1. Verify signature: sha512(server_key + order_id +
        status_code + gross_amount) == signature_key  -> 401 kalau gagal
     2. Ambil status transaksi via API
        GET /v2/{order_id}/status (jangan percaya body webhook saja)
     3. Map status:
        settlement|capture  -> sukses
        pending             -> abaikan (tunggu notif berikut)
        deny|cancel|expire  -> gagal (tidak kredit)
     4. Sukses -> RPC wallet_credit(userId, ceil(idr/10.000),
        type='top_up', idempotency_key = order_id)
        ON CONFLICT idempotency -> replay, saldo TIDAK dobel
        Cap non-KYC kena race -> TOPUP_CAP_EXCEEDED -> 200 ignored
        + audit log (refund manual via Midtrans)
  -> Web poll / supabase realtime: saldo ter-update
```

### 2,2 Detail teknis
- Env: `MIDTRANS_SERVER_KEY`, `MIDTRANS_CLIENT_KEY`,
  `MIDTRANS_IS_PRODUCTION=false` (sandbox dulu).
- Sandbox: Snap UI sandbox + kartu uji BNI/VA simulasi
  (dokumentasi Midtrans → "Testing Sandbox"). Simpan kartu uji di
  `docs/sandbox-credentials.md` LOKAL (jangan commit).
- Halaman `/wallet`: state top-up `pending -> paid/failed` + batas waktu
  Snap (default 24 jam; set `expiry_duration` 1 jam).
- Refund/cancel order sebelum settlement: biarkan expire Snap —
  TIDAK ADA refund top-up yang sudah settlement (Opsi A closed-loop;
  refund hanya reversal untuk pembatalan transaksi spesifik, via ops).

## 3. Payout / Disbursement (Midtrans Disbursement API)

### 3,1 Register beneficiary (sekali per user, saat KYC approve)
```
POST /api/payouts/beneficiary/register (service/admin atau auto saat
KYC approved):
  Midtrans IRIS / Disbursement API:
    - beneficiary_name = nama KTP (harus sama!)
    - bank_account     = rekening terverifikasi
  simpan beneficiary_id -> users/payout_accounts
```
- Verifikasi rekening: cek nama via inquiry API kalau tersedia;
  mismatch nama KTP = tolak (SOP `10_kyc_policy.md`).

### 3,2 Batch payout (cron Selasa 06:00 WIB + trigger admin ADM-05)
```
RPC payout_batch_run():
  - ambil semua payout pending (approved KYC, >= min 10 C-Coin,
    hold_payout_until is null)
  - per payout: net_idr = (ccoin - ceil(ccoin x 0.01)) x 10.000
    -> insert payout_batches + payouts (status 'queued')
  -> API loop: create disbursement per payout (amount = net_idr,
     beneficiary_id, with_reference)
  -> webhook status disbursement:
     POST /api/payments/midtrans/payout-webhook
       (verify PAYOUT_WEBHOOK_SIGNING_KEY / signature IRIS)
       paid   -> payouts.status='paid' + wallet tx type='payout' final
       failed -> payouts.status='failed' -> masuk retry queue
                 (max 3x) -> gagal total: notifikasi user + ops review
```
- Gagal disbursement TIDAK mengembalikan ke saldo C-Coin begitu saja —
  tetap di antrian payout (konsisten `05_mvp_flow.md` Flow 9).
- Log semua tahap ke `admin_audit_log` (payout_trigger).

## 4. Struktur Code

```
apps/api/src/lib/payments/
  provider.ts        # interface PaymentProvider
  midtrans.ts        # impl: createSnapTopup, verifyNotification,
                     #        getStatus, registerBeneficiary, disburse
  index.ts           # export getProvider() (env-driven)
apps/api/src/routes/payments.ts
  POST /topup
  POST /midtrans/webhook        (signature verify + idempotent)
  POST /midtrans/payout-webhook
```
- Semua nominal C-Coin integer ≥ 1 (pakai `@c-verse/shared`, tidak
  hardcode rate).
- Webhook WAJIB balas 200 cepat; proses berat via CF Queues.

## 5. Test Wajib (vitest + sandbox)

- [ ] Signature salah → 401, tidak kredit.
- [ ] Notification duplicate (kirim 2x) → saldo naik SEKALI.
- [ ] status pending → tidak kredit; lalu settlement → kredit.
- [ ] order_id tidak dikenal → 404 log, tidak crash.
- [ ] Payout: net = gross - 1% (contoh 100 C → fee 1 C → 99 C →
      Rp 990.000 disburse).
- [ ] Beneficiary nama beda KTP → ditolak register.
- [ ] E2E sandbox: QRIS sandbox settlement → saldo naik di web.

## 6. Jangan Dilakukan

- Jangan kredit saldo dari callback redirect browser (hanya webhook
  server-to-server terverifikasi).
- Jangan simpan kartu/nomor rekening di tabel readable anon —
  service-role only (RLS spec 11).
- Jangan implement Xendit sekarang (interface saja).
- Jangan aktifkan mode production sebelum T&C final + cap + go-live
  checklist `08_deployment.md` lulus.

## 7. Acceptance Criteria

- [ ] Top-up sandbox QRIS/VA end-to-end: bayar → saldo naik → ledger
      row `top_up` dengan metadata gateway.
- [ ] Payout sandbox: batch cron → disburse → status paid → wallet tx
      `payout` + `payout_fee` benar.
- [ ] Semua webhook idempotent (bukti test duplicate).
- [ ] `.env.example` diperbarui dengan variabel Midtrans.

## 8. Sumber

- `40_operations/05_mvp_flow.md` Flow 9 (top-up & payout Opsi A).
- `dev-strategy/07_constraints.md` C-08 (cap), C-09/C-09b (payout,
  min 10 C-Coin).
- `40_operations/10_kyc_policy.md` (rekening atas nama KTP).
- Midtrans docs: Snap API, Payment Notification Verifikasi Signature,
  Disbursement/IRIS API.

# 09 — Rekomendasi Development

> Status: [DRAFT]
> Last updated: 2026-08-13
> Dok ini berisi rekomendasi teknis & operasional berdasarkan
> hasil audit dev-strategy dan validasi legal.

## 1. Prioritas Build (Sprint 0-1)

| Priority | Area | Mengapa |
|----------|------|---------|
| P0 | **Domain + Cloudflare setup** (08-deployment.md) | NFC provisioning butuh domain final. Beli/transfer domain, setup zone, DNS, Pages, Workers |
| P0 | **Auth + Wallet engine** (F001, F036) | Semua fitur bergantung pada auth (Google OAuth + email OTP) dan wallet C-Coin (ledger immutable, top-up, escrow) |
| P1 | **Drop + Checkout** (F004, F005) | Core loop: admin bikin drop -> user beli -> vault default -> ship-out opsional |
| P1 | **Admin app dasar** (ADM-01..04) | Founder harus bisa operasi tanpa DB: kelola kreator, drop, order, NFC batch |
| P2 | **NFC verify** (F007) + Halaman kartu (PG-CARD-01/02) | Provenance = value prop utama. Tapi butuh kartu fisik dulu |
| P2 | **Secondary: Marketplace + Browse** (F011, F012) | Bisa dibangun setelah primary loop stabil |
| P3 | **Gamifikasi** (F017-F019) | Level, badge, leaderboard — nice-to-have, tidak mengganggu transaksi |

## 2. Rekomendasi Arsitektur

### 2.1 Wallet Engine (C-Coin)
- **Semua transaksi = integer**, tanpa float/desimal. Konversi IDR→C-Coin ceiling.
- **Ledger append-only**: `wallet_transactions` tidak bisa UPDATE/DELETE.
  Saldo = SUM transaksi. Kolom `balance` di `wallets` hanya cache.
- **Escrow**: status di ledger (`escrow_status enum('held','released')`).
  Vault: release saat SETTLED. Shipping: release DELIVERED + H+7.
- **Idempotency key**: wajib di semua webhook (top-up, payout callback).
- **Minimum payout**: 10 C-Coin. Saldo menumpuk sampai threshold.

### 2.2 Vault-First Architecture
- **Default semua transaksi**: kartu tetap di vault platform.
- **Ownership ≠ lokasi fisik**: `cards.current_owner_id` terpisah dari
  `cards.location`. Ownership bisa berpindah berkali-kali tanpa
  fisik bergerak.
- **Ship-out**: hanya saat owner minta (bayar ongkir). `shipments`
  type `vault_shipout`.
- **Secondary**: seller WAJIB kirim ke vault untuk verifikasi NFC
  sebelum payout. Kalau sudah di vault, langsung selesai.

### 2.3 NFC Provisioning Flow
- **Desktop tool terpisah** (bukan web app):
  - Input: batch dari Supabase (list UUID + UID + NDEF config).
  - Proses: tulis NDEF URL (`https://c-verse.co/cards/{shortId}/3d?...`)
    + SUN config (AES-128 key) ke chip.
  - Output: update `nfc_configured = true` di Supabase.
- **Library**: NXP TapLinx SDK (Java/C) atau open-source alternative.
- **Koneksi ke Supabase**: service-role key via REST API (read batch,
  write status).
- **Sprint 0**: prototype dengan 5 tag + manual verify.

### 2.4 Badge System
- **Evaluasi event-driven**: saat transaksi/level-up, bukan cron.
  Hindari delay award.
- **Criteria JSON** fleksibel: `{type, min, ...}`.
  Contoh: `{type: 'collect_count', min: 1}`,
  `{type: 'level', min: 5}`,
  `{type: 'creator_cards', creator_id: 'uuid', min: 3}`.
- **Permanence**: sekali award, tetap di profil selamanya.
- **Admin panel**: CRUD definisi badge (ADM-07). Icon upload ke R2.

### 2.5 Signed Card (1:10)
- **Alokasi random saat checkout**: sistem memilih signed/unsigned
  dari pool yang tersisa. Buyer tidak bisa memilih.
- **Race**: signed punya pool terpisah (`signed_units`). Begitu
  signed habis, sisa unsigned tetap bisa dibeli.
- **Harga berbeda**: signed = 50 C-Coin (Rp 500.000), unsigned = 30 C-Coin (Rp 300.000).
  Potong saldo sesuai jenis yang dialokasikan.

### 2.6 Anti-Fraud Y1
| Mekanisme | Detail |
|-----------|--------|
| Rate limit bid | Max 10 bid aktif/user, max 50 bid/hari |
| Strike system | 3 strike = suspend 30 hari |
| Shill detection | Cross-check IP + device fingerprint + payment method |
| Wash trading | Cooling period 7 hari: kartu tidak bisa dibeli kembali oleh owner |
| Max buyout aktif | 20 kartu/user |

## 3. Operasional Manual (Y1)

Karena MVP dijalankan tim kecil (3 founder), beberapa proses
tetap manual:

| Proses | Manual? | Tool |
|--------|---------|------|
| KYC verification | Manual Y1 | Admin app lihat dokumen + approve/reject |
| NFC provisioning | Desktop tool | TapLinx + REST ke Supabase |
| Vault management | Manual | Rak fisik + label per short_id |
| Dispute resolution | Manual | Email/WA + admin app status |
| Rekonsiliasi harian | Manual | Cron report + admin cek |
| QC defect decision | Manual | Admin lihat foto + putuskan redistribute/destroy |
| Payout batch trigger | Semi-manual | Cron proposal -> admin approve |

## 4. Risiko Teknis yang Diterima

| Risiko | Mitigasi |
|--------|----------|
| Supabase Realtime broadcast < 50 concurrent bidder | Durable Objects tidak dipakai Y1 |
| Admin app lokal mati | VPS + Cloudflare Access (Rp 100-200rb/bln) |
| Web NFC tidak ada di iOS | SUN URL via background tag reading (perlu validasi C-03) |
| NFC chip failure rate > 2% | Multi-vendor, triple test, QR fallback |
| Webhook top-up gagal | Idempotency key + cron reconciliation |

## 5. Yang Belum Final (Butuh Keputusan)

| Item | Deadline | Owner |
|------|----------|-------|
| Threshold KYC akumulasi top-up besar | Sebelum payout pertama | Founder bisnis |
| Cap saldo maksimum (Rp 5-10 juta) | Sebelum top-up live | Founder bisnis |
| Besaran diskon redistribute defect (10-30%) | Sebelum secondary live | Founder produk |
| Cooling period wash trading (7 hari) | Sebelum secondary live | Founder produk |

## Sumber

- Audit dev-strategy 2026-08-13 (21 temuan).
- Validasi lawyer fintech 2026-08-13.
- Diskusi user 2026-08-13 (domain final, vault default, min payout).
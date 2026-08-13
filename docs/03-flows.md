# 03 — Flow End-to-End MVP

> Status: [DRAFT]
> Last updated: 2026-08-13 (Q026 resolved — semua gate legal
> dihapus; KYC trigger di-simplify)
> Semua fitur dibangun penuh. Top-up uang riil bisa diterima
> setelah T&C final + cap saldo diimplementasi.

## Flow 1: Primary Sale Drop (user)

```
[PUBLIC] katalog drop -> detail drop (countdown, unit tersisa)
   -> klik Beli -> [LOGIN GATE] -> checkout
   -> SALDO C-Coin cukup?
        |-- YA -> DEFAULT: SIMPAN DI INVENTORY (vault)
        |        -> kartu ter-bind virtual, fisik dipegang platform
        |        -> tanpa alamat/ongkir/tracking
        |        -> OPSIONAL: kirim fisik sekarang (isi alamat +
        |           bayar ongkir C-Coin, misal 2 C-Coin)
        |-- TIDAK -> arahkan ke top-up (area user /wallet)
   -> debit saldo C-Coin (race: 1 kartu/user limit)
   -> escrow hold -> order created (status: PAID)
   -> notifikasi email

Signed card allocation:
- Drop punya signed_count = ceil(total_units / 10).
- Buyer checkout: sistem random assign signed/unsigned saat debit.
- Signed card = limited (1:10). Race berlaku seperti unit biasa —
  signed habis lebih dulu, sisa unsigned tetap bisa dibeli.
- Tidak ada pilihan explicit "saya mau signed" — sistem yang
  mengalokasikan.

Decision points:
- **AVAILABILITY**: unit tersisa = 0 → disable tombol beli.
- **LIMIT**: user sudah punya 1 kartu dari drop yang sama →
  blok checkout.
- **RACE**: dua user checkout bersamaan pada unit terakhir →
  satu berhasil, satu gagal (transaksi atomik di DB).
- **SALDO**: debit C-Coin cukup (harga + ongkir bila kirim
  sekarang) → sukses; tidak cukup → prompt top-up.
- **DELIVERY**: vault = default, tanpa alamat/ongkir. Kirim fisik
  = opsional saat checkout (isi alamat + `shipping_fee_ccoin`).
- **SHIP-FROM-VAULT**: setelah order settled, owner bisa minta
  kirim kapan saja via PG-USR-07 (bayar ongkir saat itu, bukan
  saat checkout).

Status order:
- `shipping`: `PAID → QC → SHIPPED → DELIVERED → SETTLED`.
- `vault` (default): `PAID → QC → SETTLED` (tidak ada shipped/delivered).

> **ATURAN C-Coin**: semua nominal integer ≥ 1, tanpa desimal
> (konversi IDR → C-Coin dibulatkan ke atas).

## Flow 2: Fulfillment (ops/admin)

```
[ADMIN] order baru (PAID) -> production batch
   -> NFC provisioning (ADM-04): assign UUID<->UID, config NDEF/SDM
   -> QC semua unit (defect < 2%) -> input hasil QC
   -> PER CABANG delivery_option:
        shipping -> packing + no resi -> SHIPPED -> 3PL pickup
                    -> buyer terima -> DELIVERED
                    -> auto-release escrow H+7 (window komplain)
        vault    -> bind ke akun buyer (inventory) -> SETTLED
                    (fisik dipegang platform di gudang/vault)
                    -> escrow release LANGSUNG (tidak ada risiko kirim)
```

SOP detail: `40_operations/03_operations_playbook.md` SOP 1-3.

## Flow 3: Payment & Settlement (C-Coin)

```
checkout -> debit WalletTransaction (immutable, append-only)
   -> escrow hold state di ledger (vault: release saat SETTLED; shipping: release DELIVERED + H+7)
   -> DELIVERED -> auto-release -> split dalam C-Coin:
       primary (platform-produced): 70% platform / 30% kreator
   -> payout batch (Selasa, H+1) -> IDR kurs Rp 10.000
   -> withholding PPh 23 + PPN 11% -> payout fee 1% fixed
   -> seller/kreator: default disburse IDR, opsional tahan C-Coin
```

- Ledger: `wallet_transactions` append-only, tidak ada UPDATE/
  DELETE. Saldo = SUM dari transaksi.
- Rekonsiliasi harian: top-up webhook vs ledger vs float riil
  (ADM-05).

## Flow 4: NFC Tap → Halaman 3D Kartu (Android Chrome)

```
tap kartu -> Web NFC API baca NDEF (URL SUN + UID + counter + CMAC)
   -> URL langsung menuju /cards/:cardId/3d?uid=..&ctr=..&c=CMAC
   -> backend derive expected CMAC (AES-128, master key KMS)
   -> compare + cek counter (anti-replay)
   -> parse TagTamper flag
   -> halaman 3D kartu tampil: 3D viewer + info singkat kartu
      (series — link drop, unit number #X dari Y, kreator — link,
      release date, owner — link) + verified badge "Verified Card"
      (hanya lewat tap NFC)
```

- **TIDAK ada halaman verifikasi terpisah** — verifikasi melekat
  di halaman kartu.
- Wajib Chrome Android 89+ untuk Web NFC (scan terprogram).
- Status verify: `verified` (CMAC match) / `tamper` / `unknown`
  (database match tanpa CMAC).

## Flow 5: Fallback (iOS & non-Chrome)

```
iOS: tap kartu -> background tag reading -> URL SUN terbuka di
Safari -> URL menuju halaman 3D kartu -> backend verify CMAC
dari URL (tanpa Web NFC API) -> halaman 3D tampil verified.
   ^-- DIPERLUKAN VALIDASI DEVICE NYATA (C-03, 07-constraints)

Non-NFC / gagal: scan QR di dus
   -> halaman INFO kartu (/cards/:cardId) -> status "Registered"
      (tanpa CMAC, lebih lemah)
```

## Flow 6: Ownership Transfer (secondary)

```
TIDAK ADA NFC re-write. Transfer = perpindahan record database.
1) Activation pertama: tap -> bind ke akun pertama (current_owner).
2) Secondary transfer: buyer menang bid/beli -> one-time token
   -> update current_owner_id + insert OwnershipHistory
   -> owner baru tap konfirmasi (opsional).
```
> Lokasi fisik kartu (custody) terpisah dari kepemilikan:
> `cards.location enum('platform_stock','with_owner','platform_vault')`.
> Pada secondary, buyer memilih tujuan kirim (lihat Flow 7) —
> ke alamatnya ATAU dikirim/rawat di platform (vault).

## Flow 7: Secondary — Marketplace + Browse

```
DUA jalur masuk (bukan auction timer):

MARKETPLACE (buyout):
   owner set buyout_price_ccoin di kartunya (PG-USR-07)
   -> kartu tampil di /marketplace
   -> buyer klik "Beli" -> bayar C-Coin langsung -> transfer
   -> buyout terambil -> notif ke owner

BROWSE (bid langsung di kartu):
   user cari kartu di /browse (search by kartu/kreator)
   -> bid/offer ke owner WALAUPUN owner tidak pasang harga
   -> C-Coin bidder di-hold (1 bid active per kartu = tertinggi)
   -> BID LEBIH TINGGI masuk -> bid lama status outbid,
      C-Coin bidder lama otomatis kembali ke saldo
   -> bidder bisa CANCEL bidnya sendiri (selama belum accepted)
      -> C-Coin release
   -> owner TIDAK bisa reject — hanya ACCEPT (current active)
   -> accept -> transfer ownership + escrow -> bid lain yang tersisa otomatis outbid + release
```

**TIDAK ada bid expire** — tidak ada timer/batas waktu; bid
active bertahan sampai accept (owner), cancel (bidder), atau
outbid (bid lebih tinggi).

History bid per kartu: tampil 90 hari terakhir; bid `accepted`
(complete) permanen selamanya.

Settlement:
```
   -> split: 7,5% platform + 7,5% royalti kreator LIFETIME
   + 85% owner
   -> buyer bayar C-Coin -> transfer ownership (Flow 6)
   -> SELLER WAJIB kirim kartu ke platform vault untuk verifikasi:
        seller kirim fisik ke platform -> platform verifikasi NFC
        + QC ringan -> verified -> vault masuk inventory buyer
   -> KALAU SUDAH DI VAULT (dari sebelumnya): langsung selesai,
        ownership pindah, fisik tetap di vault
   -> buyer bisa minta ship-out kapan saja (bayar ongkir C-Coin)
   -> seller payout (Flow 3) — HANYA setelah kartu terverifikasi
        di vault platform
```

### Kirim dari Vault (ship-from-custody, KEPUTUSAN USER 2026-08-12)
```
Owner yang kartunya ber-location 'platform_vault' (beli primary
simpan di inventory ATAU secondary kirim ke platform) bisa
request KIRIM ke alamatnya kapan saja:
   -> PG-USR-07 (kelola kartu) -> pilih kartu + "Kirim dari
      vault" -> isi alamat -> bayar ongkir C-Coin (integer >= 1)
   -> rows `shipments` type='vault_shipout' -> packing -> 3PL
   -> tracking -> delivered -> kartu jadi 'with_owner'
```

Aturan:
```
   - 1 kartu = 1 owner; hanya owner yang bisa set buyout/accept bid.
   - Owner bisa cabut buyout price kapan saja (selama belum dibeli).
   - **KYC wajib SEBELUM payout/disbursement ke IDR + akumulasi
     top-up besar.** Tidak perlu KYC untuk pasang buyout, accept
     bid, atau top-up rutin di bawah threshold.
   - Hanya 1 bid active per kartu (tertinggi); outbid/cancel
     melepas C-Coin otomatis.
   - Bidder bisa cancel bidnya sendiri; owner tidak bisa reject.
   - Max 20 kartu buyout aktif per user (guard).
```

Anti-fraud Y1 (rule-based, bukan ML):
- Rate limit bid: max 10 bid aktif per user, max 50 bid/hari.
- Strike system: 3 strike = suspend 30 hari.
- Shill detection: cross-check IP + device fingerprint + payment
  method. Flag jika bidder dan owner punya pola sama.
- Wash trading cooling period: 7 hari setelah terjual, kartu tidak
  bisa dibeli kembali oleh owner sebelumnya.
- Max buyout aktif: 20 kartu per user.

## Flow 8: Top-Up & Payout C-Coin

```
TOP-UP (di area user, /wallet):
   -> Midtrans Snap -> webhook idempotent -> append WalletTransaction
   -> disclosure "saldo tidak dapat diuangkan" sebelum bayar
   -> top-up bisa diterima setelah T&C final + cap saldo
      diimplementasi

PAYOUT:
   -> escrow release -> hitung porsi C-Coin -> pilih disburse IDR
      (default, fee 1%) atau tahan C-Coin
   -> KYC + verifikasi rekening WAJIB sebelum payout -> batch payout
   -> **Minimum payout**: 10 C-Coin (Rp 100.000). Saldo menumpuk
      sampai threshold terpenuhi. Payout fee 1% tetap dipotong.
```

Open items payout: SLA, mekanisme disbursement final, cap saldo
(Rp 5-10 juta) — [DRAFT].

## Flow 9: Admin Intra-day (ops)

```
ADM-02: buat drop -> set artwork final, harga (C-Coin), unit,
   signed_count = ceil(total/10), waktu drop -> publish (H-7)
ADM-01: register kreator baru (hasil rekrutan off-platform)
   -> profile + payment info -> aktif
ADM-05: rekonsiliasi harian -> cocokkan top-up webhook vs ledger
   vs float -> trigger payout batch
ADM-04: provisioning batch tag baru -> assign UUID<->UID ->
   config NDEF/SDM -> marking QC
ADM-06: dispute masuk -> review bukti -> keputusan
```

## Matriks Gate (tersisa)

| Titik | Gate | Status |
|-------|------|--------|
| iOS tap-to-verify SUN URL (Flow 5) | C-03 validasi device | [DRAFT] |

## Sumber

- `40_operations/05_mvp_flow.md` (Flow 1-9 orisinal).
- `20_product/06_auction_mechanics.md` (rules auction).
- `20_product/05_nfc_ux.md` (edge cases tap).
- `40_operations/03_operations_playbook.md` (SOP).
- `40_operations/02_legal_compliance.md` 2,2 (C-Coin validasi).
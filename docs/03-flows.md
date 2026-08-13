# 03 — Flow End-to-End MVP

> Status: [DRAFT]
> Last updated: 2026-08-12
> Gate = titik bertanda `[GATE]`. **Q026 (status hukum C-Coin)
> adalah gate GO-LIVE, BUKAN bloker build** — semua fitur
> dibangun penuh; yang menunggu legal hanya menerima uang riil
> (top-up) dan escrow live.

## Flow 1: Primary Sale Drop (user)

```
[PUBLIC] katalog drop -> detail drop (countdown, unit tersisa)
   -> klik Beli -> [LOGIN GATE] -> checkout
   -> SALDO C-Coin cukup?
        |-- YA -> pilih PENGIRIMAN:
        |        A) KIRIM FISIK  -> isi alamat + bayar ongkir C-Coin
        |        B) SIMPAN DI INVENTORY (vault) -> tanpa alamat/tracking
        |-- TIDAK -> arahkan ke top-up (area user /wallet)
   -> debit saldo C-Coin (race: 1 kartu/user limit)
   -> escrow hold [GATE: Q026 — go-live] -> order created (status: PAID)
   -> notifikasi email
```

Decision points:
- **AVAILABILITY**: unit tersisa = 0 → disable tombol beli.
- **LIMIT**: user sudah punya 1 kartu dari drop yang sama →
  blok checkout.
- **RACE**: dua user checkout bersamaan pada unit terakhir →
  satu berhasil, satu gagal (transaksi atomik di DB).
- **SALDO**: debit C-Coin cukup (harga + ongkir bila kirim) →
  sukses; tidak cukup → prompt top-up.
- **DELIVERY**: kirim fisik = `shipping_fee_ccoin` + alamat;
  inventory = tanpa ongkir, kartu langsung ter-bind virtual.

Status order:
- `shipping`: `PAID → QC → SHIPPED → DELIVERED → SETTLED`.
- `vault`: `PAID → QC → SETTLED` (tidak ada shipped/delivered).

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
                    -> auto-release escrow H+7 [GATE: Q026]
        vault    -> bind ke akun buyer (inventory) -> SETTLED
                    (fisik dipegang platform di gudang/vault)
                    -> escrow release (tidak ada risiko kirim)
```

SOP detail: `40_operations/03_operations_playbook.md` SOP 1-3.

## Flow 3: Payment & Settlement (C-Coin)

```
checkout -> debit WalletTransaction (immutable, append-only)
   -> escrow hold state di ledger [GATE: Q026]
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
   -- **WAJIB KYC dulu** (trigger: pasang harga jual)
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
      [WAJIB KYC owner dulu sebelum accept]
   -> accept -> transfer ownership + escrow [GATE: Q026 — go-live]
   -> bid lain yang tersisa otomatis outbid + release
```

**TIDAK ada bid expire** — tidak ada timer/batas waktu; bid
active bertahan sampai accept (owner), cancel (bidder), atau
outbid (bid lebih tinggi).

History bid per kartu: tampil 90 hari terakhir; bid `accepted`
(complete) permanen selamanya.

Settlement [GATE: Q026 — go-live]:
```
   -> split: 7,5% platform + 7,5% royalti kreator LIFETIME
   + 85% owner
   -> buyer bayar C-Coin -> transfer ownership (Flow 6)
   -> PILIH TUJUAN KIRIM (KEPUTUSAN USER 2026-08-12):
        A) KIRIM KE ALAMAT BUYER  -> ongkir C-Coin + tracking
           (seller kirim ke buyer ATAU dari vault platform)
        B) KIRIM / RAWAT DI PLATFORM -> kartu dikirim seller ke
           platform, dipegang vault atas nama buyer, platform
           verifikasi ulang (NFC/QC ringan); tanpa ongkir buyer
        -> ownership berpindah; lokasi fisik per pilihan di atas
   -> seller payout (Flow 3)
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
   - **KYC wajib SEBELUM: pasang buyout, accept bid, dan top-up
     kumulatif > 99 C-Coin.**
   - Hanya 1 bid active per kartu (tertinggi); outbid/cancel
     melepas C-Coin otomatis.
   - Bidder bisa cancel bidnya sendiri; owner tidak bisa reject.
   - Max 20 kartu buyout aktif per user (guard).
```

Anti-fraud Y1 (rule-based, bukan ML): rate limit bid,
strike system (3 strike = suspend 30 hari), monitor shill
cross-account.

## Flow 8: Top-Up & Payout C-Coin

```
TOP-UP (di area user, /wallet):
   -> Midtrans Snap -> webhook idempotent -> append WalletTransaction
   -> disclosure "saldo tidak dapat diuangkan" sebelum bayar
   -> BUILD PENUH; go-live terima uang riil menunggu Q026
      (bukan bloker build)

PAYOUT:
   -> escrow release -> hitung porsi C-Coin -> pilih disburse IDR
      (default, fee 1%) atau tahan C-Coin
   -> KYC + verifikasi rekening WAJIB -> batch payout
```

Open items payout (dari `05_mvp_flow.md` Flow 9): minimum
payout, SLA, mekanisme disbursement final, cap saldo (usulan
Rp 5-10 juta) — semua [DRAFT].

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

## Matriks Gate

| Titik | Gate | Status |
|-------|------|--------|
| Top-up uang riil (F006/F036) | Q026 legal clear — **gate GO-LIVE, bukan bloker build** | [BUILD OK] |
| Escrow hold di ledger (Flow 1/3/7) | Q026 legal clear — **gate GO-LIVE** | [BUILD OK] |
| iOS tap-to-verify SUN URL (Flow 5) | C-03 validasi device | [DRAFT] |

## Sumber

- `40_operations/05_mvp_flow.md` (Flow 1-9 orisinal).
- `20_product/06_auction_mechanics.md` (rules auction).
- `20_product/05_nfc_ux.md` (edge cases tap).
- `40_operations/03_operations_playbook.md` (SOP).
- `90_research/legal-consultation-brief.md` (Sesi A → Q026).
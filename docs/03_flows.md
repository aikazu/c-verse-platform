# 03 — Flow End-to-End MVP

> Status: [VALIDATED — partial: open items payout (SLA, disbursement,
> cap Rp 5-10 jt) & validasi C-03 iPhone masih [DRAFT] — lihat
> `07_constraints.md`]
> Last updated: 2026-08-20 (Flow 10 Creator Seed C.Card + Flow 11
> provision akun kreator admin — keputusan 2026-08-20)
> Previous: 2026-08-15 (Flow 1 → raffle hybrid + pilihan pool;
> audit konsistensi: harga signed eksplisit di decision point SALDO)
> Semua fitur dibangun penuh. Top-up uang riil bisa diterima
> setelah T&C final + cap saldo diimplementasi.

## Flow 1: Primary Sale Drop — Raffle Hybrid (user)

MEKANISME FINAL 2026-08-15 (keputusan user): raffle hybrid —
entry window 24 jam pertama + draw otomatis, sisa unit FCFS
"siapa cepat dia dapat". Menggantikan FCFS murni.

```
Phase 1 — RAFFLE ENTRY (drop live s/d raffle_end_at, default 24 jam)
[PUBLIC] katalog drop -> detail drop (countdown window, jumlah
   entry live per pool, harga per pool)
   -> klik "Ikuti" -> [LOGIN GATE] -> PILIH POOL:
        - REGULER  : hold drops.price_ccoin (mis. 30) — pool unsigned
        - PREMIUM  : hold drops.price_signed_ccoin (mis. 50) — pool signed
        - KEDUANYA : hold maksimum (50) — premium diundi dulu,
          kalah -> masuk pool reguler; dapat reguler ->
          selisih (20) otomatis dikembalikan
   -> SALDO cukup? YA -> hold C-Coin (escrow) -> entry recorded
      TIDAK -> arahkan ke top-up (area user /wallet)
   -> limit 1 entry/user/drop; entry TIDAK bisa dibatalkan
      (dana otomatis kembali saat draw, maksimal H+24)

Phase 2 — DRAW (otomatis, batch job saat window tutup)
raffle_end_at tercapai -> cron 5-menit trigger RPC draw_drop()
   (idempotent via drops.drawn_at) -> SATU transaksi:
   1. Pool PREMIUM diundi dulu (entrants premium + keduanya)
      -> winners sebanyak signed_units tersedia
   2. Pool REGULER diundi (entrants reguler + entrants "keduanya"
      yang kalah premium) -> winners sebanyak unit unsigned tersisa
   3. Winners -> order dibuat (PAID, DEFAULT vault), kartu dialokasi
      random per pool, hold dikonversi menjadi pembayaran
   4. Losers -> hold di-release penuh otomatis
   5. Notifikasi hasil (email/FCM) ke semua entrants

Phase 3 — FCFS SISA UNIT (setelah draw s/d drop_end_at / sold out)
unit tersisa per pool (peminat < stok) -> checkout biasa
   "siapa cepat dia dapat" (RPC checkout, race-safe):
   -> pilih pool yang masih ada stok; harga mengikuti pool
   -> user yang KALAH raffle boleh ikut (belum punya kartu drop ini)
   -> user yang MENANG tidak boleh (limit 1 kartu/drop)
   -> DEFAULT: SIMPAN DI INVENTORY (vault) — kartu ter-bind
      virtual, fisik dipegang platform, tanpa alamat/ongkir/tracking
   -> OPSIONAL: kirim fisik sekarang (isi alamat + bayar ongkir
      C-Coin, misal 2 C-Coin)
   Winner raffle juga bisa minta kirim kapan saja setelah order
   via "Kirim dari vault" (PG-USR-07) — ongkir dibayar saat itu.

Signed card pool:
- Drop punya signed_units = ceil(total_units / 10) di pool PREMIUM;
  sisanya pool REGULER.
- Buyer memilih pool secara EKSPLISIT saat entry/checkout —
  tidak ada lagi random surprise 1:10, harga yang dibayar selalu
  sesuai pilihan pool (reguler = harga unsigned, premium = harga
  signed = unsigned + 20 C-Coin FLAT — 20/40, 40/60, 50/70;
  founder 2026-08-16, menggantikan multiplier 1,67x).

Decision points:
- **WINDOW**: raffle_end_at = drop_start_at + 24 jam (default,
  bisa diatur admin per drop). Sebelum window tutup: hanya entry.
  Setelah draw: hanya FCFS. Waktu rilis default 12:00 WIB saat
  create drop (founder 2026-08-16).
- **ENTRY LIMIT**: 1 entry per user per drop (unique constraint);
  user yang sudah MENANG diblok dari FCFS drop itu (limit 1
  kartu/drop), user yang kalah boleh ikut FCFS.
- **RACE**: raffle phase TIDAK ada race (draw = satu batch job
  atomik). FCFS: dua user checkout bersamaan pada unit terakhir →
  satu berhasil, satu gagal (transaksi atomik di DB).
- **SALDO**: entry = hold sesuai pool: reguler =
  `drops.price_ccoin` (30), premium/keduanya =
  `drops.price_signed_ccoin` (default price + 20). Harga final
  di-snapshot ke `orders.price_ccoin`; selisih hold winner reguler
  — SEMUA pool yang hold-nya lebih besar dari harga (termasuk pool
  premium yang jatuh ke reguler, FIX 2026-08-16) — di-release
  otomatis. FCFS: debit langsung + ongkir bila kirim sekarang.
- **DELIVERY**: vault = default, tanpa alamat/ongkir. Kirim fisik
  = opsional saat checkout FCFS (isi alamat + `shipping_fee_ccoin`);
  row `shipments` type='primary_shipping' status='requested'
  dibuat OTOMATIS (queue fulfillment admin). Winner raffle: order
  dibuat default vault.
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

SOP fulfillment: admin packing, panggil kurir, input no resi, update status order. QC: periksa dus (cetak, lipatan), acrylic (retak, gores, magnet), kartu (cetak, holo, NFC tap). Defect rate > 2% = investigasi batch.

## Flow 3: Payment & Settlement (C-Coin)

```
checkout -> debit WalletTransaction (immutable, append-only)
   -> escrow hold state di ledger (vault: release saat SETTLED; shipping: release DELIVERED + H+7)
   -> DELIVERED (buyer confirm SETELAH status shipped — guard 409) -> auto-release H+7
   -> split dalam C-Coin + LEDGER platform_revenue (FIX 2026-08-16):
       primary (platform-produced): 70% platform / 30% kreator
       secondary (buyout/bid): 7,5% platform / 7,5% royalti / 85% seller
       -> setiap event menulis row platform_revenue (snapshot fee rate)
          + kredit wallet treasury platform (fixed UUID ...0c0)
   -> payout: creator POST /api/payments/payout (request, dana dikunci)
   -> payout batch mingguan (cron/admin) -> IDR kurs Rp 10.000
   -> withholding PPh 23 + PPN 11% -> payout fee 1% fixed
   -> seller/kreator: default disburse IDR, opsional tahan C-Coin
   -> webhook IRIS menandai payouts.status = disbursed/failed
```

- Ledger: `wallet_transactions` append-only, tidak ada UPDATE/
  DELETE. Saldo = kolom `wallets.balance_ccoin` (di-maintain atomik
  oleh RPC wallet_credit/debit; invarian ≡ SUM transaksi).
- Cap saldo (founder 2026-08-16): top-up non-KYC maks 500 C-Coin
  (ditolak 422 sebelum Snap dibuat); KYC approved = tanpa cap.
- Rekonsiliasi harian: top-up webhook vs ledger vs float riil
  (ADM-05). Pendapatan platform = SUM(platform_revenue) ≡ saldo
  wallet treasury.

## Flow 4: NFC Tap → Halaman 3D Kartu (Android Chrome)

```
tap kartu -> Web NFC API baca NDEF (URL SUN + UID + counter + CMAC)
   -> URL langsung menuju /cards/:shortId/3d?uid=..&ctr=..&c=CMAC
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
   ^-- DIPERLUKAN VALIDASI DEVICE NYATA (C-03, 07_constraints)

Non-NFC / gagal: scan QR di dus
   -> halaman INFO kartu (/cards/:shortId) -> status "Registered"
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
   + 85% owner — ketiganya DIREKAM di platform_revenue
     (snapshot fee rate) + wallet treasury (FIX 2026-08-16)
   -> buyer bayar C-Coin -> transfer ownership (Flow 6)
   -> dest 'buyer_address' (alamat wajib >= 10 char): row
      shipments type='secondary_buyout'/'secondary_bid'
      status='requested' dibuat OTOMATIS di RPC (queue admin)
   -> dest 'platform_vault': ownership pindah, fisik tetap
      / masuk vault — buyer bisa minta ship-out kapan saja
   -> seller payout (Flow 3) — HANYA setelah KYC approved
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
   - **KYC wajib SEBELUM payout/disbursement ke IDR.** Cap saldo
     top-up non-KYC 500 C-Coin; KYC approved = tanpa cap (founder
     2026-08-16). Tidak perlu KYC untuk pasang buyout atau accept bid.
   - Hanya 1 bid active per kartu (tertinggi); outbid/cancel
     melepas C-Coin otomatis.
   - **Maks 3 bid aktif per user** (founder 2026-08-16; RPC BID_LIMIT).
   - Bidder bisa cancel bidnya sendiri; owner tidak bisa reject.
   - Max 20 kartu buyout aktif per user (guard).
   - Kartu tampered/defect/lost tidak tradable (RPC CARD_NOT_TRADABLE).
```

Anti-fraud Y1 (rule-based, bukan ML):
- Rate limit bid: max 3 bid aktif per user (founder 2026-08-16,
  dienforce RPC; max 50 bid/hari menyusul di layer API).
- Strike system: 3 strike = suspend 30 hari.
- Shill detection: cross-check IP + device fingerprint + payment
  method. Flag jika bidder dan owner punya pola sama.
- **Blok rebuy seller 1 hari**: owner sebelumnya tidak bisa membeli
  kembali kartu yang sama dalam 1x24 jam (putus loop same-day
  A→B→A). Pembeli bebas listing ulang kapan saja. Wash trading
  diterima — setiap transaksi tetap kena fee 15%, price history
  tetap publik (keputusan user 2026-08-15).
- **Creator self-dealing**: kreator (dan akun terafiliasi) dilarang
  membeli kartu drop mereka sendiri di secondary untuk 30 hari pertama
  setelah drop. Jika terdeteksi: suspend 14 hari + hold payout 30 hari.
- **Multiple account detection**: jika 2+ akun terdeteksi berbagi
  device/IP yang sama → flag + investigasi manual.
- Max buyout aktif: 20 kartu per user.

## Flow 8: Top-Up & Payout C-Coin

```
TOP-UP (di area user, /wallet):
   -> POST /api/payments/topup (amountCcoin) -> Midtrans Snap
      (redirectUrl/snapToken) -> bayar -> webhook idempotent
      (signature + status via API getStatus + konversi CEIL)
      -> append WalletTransaction type='top_up'
   -> disclosure "saldo tidak dapat diuangkan" sebelum bayar
   -> CAP SALDO (founder 2026-08-16): non-KYC maks 500 C-Coin —
      top-up yang melampaui ditolak 422 (KYC_TOPUP_CAP) SEBELUM
      Snap dibuat; race double-webhook ditolak RPC TOPUP_CAP_EXCEEDED
      (audit log + refund manual). KYC approved = TANPA cap.

PAYOUT (self-service request + batch, FIX 2026-08-16):
   -> creator POST /api/payments/payout {amountCcoin}
      -> RPC payout_request: KYC approved WAJIB (KYC_REQUIRED),
         min 10 C-Coin (MIN_PAYOUT), hold fraud dicek (PAYOUT_HELD),
         saldo didebit (dikunci) + row payouts status='pending'
   -> batch mingguan (cron Selasa 06:00 WIB / admin POST
      /api/payments/admin/payout-run) -> payout_batch_run
      (fee 1%, idr_amount diisi net)
   -> disbursement IRIS (ops) -> webhook /midtrans/payout-webhook
      -> payouts.status = disbursed/failed
```

## Flow 9: Admin Intra-day (ops)

```
ADM-02: buat drop -> set artwork final, harga (C-Coin), unit,
   signed_units = ceil(total/10), raffle_end_at (default
   drop_start + 24 jam), waktu drop -> publish (H-7)
ADM-01: register kreator baru (hasil rekrutan off-platform)
   -> profile + payment info -> aktif
   -> (+ 2026-08-20: buat akun login kreator via Flow 11)
ADM-05: rekonsiliasi harian -> cocokkan top-up webhook vs ledger
   vs float -> trigger payout batch
ADM-04: provisioning batch tag baru -> assign UUID<->UID ->
   config NDEF/SDM -> marking QC
ADM-06: dispute masuk -> review bukti -> keputusan
```

## Flow 10: Creator Seed C.Card (akuisisi kreator + seeding secondary)

> **KEPUTUSAN USER 2026-08-20 [VALIDATED]** — Creator Seed C.Card.
> **BUKAN primary raffle**:
> seed card masuk LANGSUNG ke secondary (Marketplace/Browse normal),
> TIDAK pernah lewat entry window/draw primary (Flow 1). Flow ini
> menggantikan marketing berbayar (Rp 0) sekaligus seeding 1-of-1
> untuk secondary market. Volume fleksibel: min ~3 kartu/bulan,
> tanpa cap keras. COGS seed card = biaya akuisisi (marketing-in-kind,
> bukan penjualan; Rp 104.000 unsigned / Rp 120.000 signed), sunk
> bila tak laku.

```
[1] PRODUKSI 1-of-1 (tim internal, in-house design)
    - artboard tentang kreator target (edisi tunggal, unik)
    - 1 unit kartu + NFC provisioning (ADM-04)
    - COGS dicatat sebagai BIAYA AKUISISI (marketing-in-kind,
      BUKAN penjualan); sunk bila tak laku (Rp 104.000 unsigned /
      Rp 120.000 signed; asumsi 40 kreator Y1 ≈ Rp 4,8 jt)
[2] TANDA TANGAN KREATOR
    - tim mendatangi kreator; kartu ditandatangani kreator
[3] SERAH + PITCH
    - kartu diserahkan ke kreator sebagai HADIAH (kreator TIDAK
      top-up / tidak membayar) sambil pitch kolaborasi
[4] DAFTAR 1-OF-1 — OWNERSHIP KREATOR
    - kartu didaftarkan sebagai 1-of-1; current_owner_id = kreator
      (syarat: akun kreator AKTIF via Flow 11 — rekening kreator
      aktif SEBELUM listing)
[5] LISTING MARKETPLACE
    - tampil di /marketplace + /browse; owner bisa set buyout price
      ATAU biarkan bid langsung (perilaku secondary normal)
[6] BID PUBLIK -> [7] ACCEPT (kreator-owner, tanpa reject)
    - mekanik Flow 7 normal (1 bid active tertinggi/kartu, hold
      C-Coin, outbid/cancel release)
[8] VAULT-IN WAJIB + VERIFIKASI NFC (GATE — TIDAK BOLEH LEWAT)
    - SEBELUM settle/serah ke buyer, kartu fisik WAJIB masuk vault
      platform dulu (kartu ada di tangan kreator sejak [3];
      kreator kirim ke vault)
    - verifikasi: (a) NFC tap — UID sesuai record, (b) kondisi
      fisik — tidak ada kerusakan baru
    - TIDAK BOLEH kartu terjual sementara fisik masih di kreator
      tanpa verifikasi vault
    - TERIMPLEMENTASI (2026-08-21): gate di RPC accept_bid &
      buyout_card (migration 20260821000000_seed_card) — jika drop
      induk kartu drops.is_seed = true TAPI location <> platform_vault
      ATAU verify_status <> verified -> RPC raise exception
      SEED_VAULT_IN_REQUIRED (settle ditolak, rollback atomik).
      Provenance seed = flag level drop drops.is_seed (bukan kolom
      di cards) — lihat C-17 & 05_data_model.
[9] RELEASE KE BUYER
    - setelah vault-in verified: ownership pindah di ledger + fisik
      release dari vault (kirim fisik / tetap vault atas nama buyer,
      pilihan buyer)
    - TERIMPLEMENTASI (2026-08-21): release otomatis oleh RPC saat
      settle sukses (ownership_history baru + shipment secondary
      sesuai pilihan tujuan buyer, perilaku Flow 7 normal); path
      vault-in fisik = PATCH /api/admin/cards/:id/vault-in (admin —
      set cards.location='platform_vault' + audit pemeriksaan fisik;
      verified NFC tetap hanya dari tap — lihat C-17 / keputusan
      desain 2026-08-21 di 07_constraints)
```

Split penjualan pertama seed card (secondary 85/7,5/7,5): karena
kreator = OWNER sekaligus kreator kartu, kreator efektif menerima
**85% + 7,5% royalti lifetime = 92,5%**, platform 7,5% (bukan fee
12%/6% — lihat glossary). Semua transaksi tetap C-Coin; payout /
escrow normal (Flow 3 & 7). Serah hadiah [3] BUKAN transaksi
penjualan — tidak ada split/gateway/escrow.

## Flow 11: Provision Akun Kreator (admin) — passwordless

> **KEPUTUSAN USER 2026-08-20 [VALIDATED]** — akun kreator
> admin-provisioned + passwordless. Menggantikan gap
> "kreator terdaftar tapi tidak pernah bisa login": `creators.user_id`
> selama ini nullable tanpa flow pengisian (G1/G2 closed). Kreator
> TIDAK self-register — TIDAK ada halaman invite publik.

```
[ADMIN] admin app: "Buat akun kreator" — email dari deal memo
   -> POST /api/admin/users/provision (gate admin aal2) — TERIMPLEMENTASI:
        1. cek duplikat email -> 409 "Email sudah terdaftar"
        2. create auth user (TANPA password, email_confirm: true,
           user_metadata: { full_name, role: 'creator' }) — Supabase Auth
           admin API; trigger DB otomatis buat row public.users
        3. update public.users -> role='creator', display_name
        4. insert creators (handle unique, status='active',
           total_followers_combined default 0) — handle bentrok -> 409
           "Handle sudah dipakai" + rollback hapus auth user
        5. kirim email akses via modul email ber-flag EMAIL_ENABLED
           (default OFF di dev -> emailSent:false; SumoPod SMTP saat ON)
        6. audit log admin_audit_log (action 'create', payload
           { provision:true, handle, emailSent })
   -> [KREATOR] login pertama & seterusnya via OTP email ATAU Google
      OAuth (passwordless) — email harus sama dengan yang di-set admin
   -> dashboard /creator aktif langsung; payout self-service (Flow 8)
      langsung jalan (akun ter-link sebelum login pertama)
```
- **Status: langkah 1–6 TERIMPLEMENTASI (2026-08-21)** via endpoint nyata
  + form admin "Buat akun kreator"; login OTP/OAuth kreator tetap
  mengikuti alur passwordless Supabase Auth (Google/OTP) di web.

- Aturan anti-fraud: akun kreator kini TERIDENTIFIKASI → C-13
  (creator self-dealing dilarang 30 hari) enforceable.
- Audit: setiap provisioning dicatat `admin_audit_log`; role
  promotion hanya via RPC admin.

## Matriks Gate (tersisa)

| Titik | Gate | Status |
|-------|------|--------|
| iOS tap-to-verify SUN URL (Flow 5) | C-03 validasi device | [DRAFT] |

## Sumber

- `05_data_model.md` (tabel & relasi).
- `06_tech_decisions.md` (arsitektur).
- `07_constraints.md` (gate & aturan).
- `02_pages.md` (halaman user & admin).
- Creator Seed C.Card (keputusan 2026-08-20, [VALIDATED]) — Flow 10:
  produksi 1-of-1 → tanda tangan → serah + pitch → daftar ownership
  kreator → listing → bid publik → accept → vault-in wajib +
  verifikasi NFC → release.
- Akun kreator admin-provisioned (keputusan 2026-08-20, [VALIDATED])
  — Flow 11: endpoint `POST /api/admin/users/provision` (create auth
  user tanpa password, `profiles.role='creator'`, isi `creators.user_id`,
  email akses via SumoPod SMTP); login OTP email / Google OAuth.
  TERIMPLEMENTASI 2026-08-21.
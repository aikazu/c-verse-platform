# 05 — Data Model (Skema Logis)

> Status: [VALIDATED]
> Last updated: 2026-08-12
> Skema LOGIS (tabel + relasi + enum), bukan DDL final.
> Database: Supabase Postgres (region SG). ORM: Drizzle.
> Nama kolom: `snake_case`. PK: `uuid` (default `gen_random_uuid()`).

## 1. Prinsip

1. **Ledger immutable**: `wallet_transactions` append-only.
   Saldo = `SUM` transaksi, TIDAK disimpan sebagai kolom yang
   bisa diedit langsung (jika disimpan, hanya cache).
2. **Escrow = state**: escrow adalah status di ledger/order,
   bukan rekening terpisah (validasi lawyer: cukup T&C +
   pencatatan terpisah di ledger).
3. **Ownership berbasis record**: `cards.current_owner_id` +
   `ownership_history` — TIDAK ada rewrite NFC.
4. **Admin akses service-role**: app publik hanya anon key +
   RLS; admin app pakai service-role (bypass RLS).
5. **Soft delete**: kolom `deleted_at` untuk recovery, jangan
   hard delete data transaksional.

## 2. Tabel Inti

### users & profiles
```
users (dari Supabase Auth: id, email, phone, created_at)
profiles
  id uuid PK (FK users.id)
  display_name text
  username text UNIQUE
  avatar_url text
  role enum('user','creator','admin')   -- default 'user'
  is_anonymous bool default false       -- privacy: profil tidak tampil publik
  total_xp int default 0                -- experience; sumber: spend C-Coin + reward badge
  level int default 1                   -- = floor(total_xp / 10)
  cumulative_spend_ccoin int default 0  -- 1 C-Coin spent = 1 XP (top-up TIDAK menambah XP)
  created_at, updated_at
```

### creators (kreator hasil rekrutan off-platform)
```
creators
  id uuid PK
  user_id uuid FK profiles.id (nullable — sebelum login)
  handle text UNIQUE          -- IG/TikTok/YT/X
  total_followers_combined int -- >= 100.000 (threshold)
  status enum('active','suspended','inactive')
  bank_account jsonb          -- {bank, account_no, holder}
  kyc_completed bool default false
  notes text                  -- riwayat kontak off-platform
  created_at, updated_at
```
> Threshold 100rb+ combined di-validasi manual saat rekrutan
> (off-platform), bukan auto-check di sistem.

### drops
```
drops
  id uuid PK
  creator_id uuid FK creators.id
  title text
  description text
  artwork_2d_url text        -- upload by ops (approved off-platform)
  artwork_3d_url text nullable -- F008 (cut line)
  price_ccoin int            -- e.g. 30 (Rp 300.000)
  total_units int
  signed_units int           -- ceil(total_units / 10)
  drop_start_at timestamptz
  drop_end_at timestamptz
  status enum('draft','scheduled','published','live','sold_out','closed','cancelled')
  created_by uuid FK users.id (admin)
  created_at, updated_at
```

### cards (unit fisik)
```
cards
  id uuid PK                  -- UUID kartu (public identifier)
  drop_id uuid FK drops.id
  unit_number int             -- #X dari total
  is_signed bool default false
  tag_uid text UNIQUE         -- 7-byte UID dari NFC chip
  short_id text UNIQUE        -- untuk URL /cards/:shortId
  current_owner_id uuid FK users.id nullable -- null = belum di-bind (inventory)
  location enum('platform_stock','with_owner','platform_vault')
     -- lokasi FISIK kartu, terpisah dari ownership:
     --   platform_stock: belum terjual (stok platform)
     --   with_owner: fisik sedang/dipegang owner
--   platform_vault: dipegang platform atas nama owner (custody)
	  --     Manajemen fisik Y1: manual (bin/label per kartu di rak).
	  --     Ship-out request: admin cari kartu via short_id -> packing -> 3PL.
	  --     Tidak ada warehouse management system — SOP manual di
	  --     `40_operations/03_operations_playbook.md`.
	  status enum('inventory','bound','listed_buyout','bid_pending','sold','tampered','defect','lost')
  buyout_price_ccoin int nullable -- dipasang owner -> muncul di Marketplace
  nfc_configured bool default false
qc_status enum('pending','passed','failed')
	  -- QC checklist: (1) dus: fisik, cetak, lipatan; (2) acrylic: retak, gores, magnet;
	  -- (3) kartu: cetak, holo, NFC tap. Defect rate > 2% = investigasi batch.
	created_at, updated_at
```
> Marketplace = kartu dengan `buyout_price_ccoin` NOT NULL.
> Browse = semua kartu `bound` bisa di-bid walau tanpa
> buyout price.
> Keuntungan pemisahan lokasi vs kepemilikan: buyer boleh
> MENJUAL kartu yang masih di platform_vault (physical kartu
> tidak pindah, hanya record); saat buyer mau terima fisik,
> pakai shipment `vault_shipout` (lihat di bawah).

### shipments (pengiriman fisik — primary, secondary, vault)
```
shipments
  id uuid PK
  card_id uuid FK cards.id
  requester_id uuid FK users.id          -- owner yang minta kirim
  type enum('primary_shipping','primary_vault',   -- jalur primary
            'secondary_buyout','secondary_bid',   -- jalur secondary
            'vault_shipout')             -- kirim keluar dari vault
  from_location enum('platform','seller')
  to_dest enum('buyer_address','platform_vault')  -- ke alamat / ke platform
  address jsonb nullable                 -- hanya jika to_dest='buyer_address'
  fee_ccoin int                          -- ongkir (integer, >= 1); 0 jika ke platform
  status enum('requested','packed','shipped','delivered','cancelled')
  tracking_number text nullable
  platform_check jsonb nullable          -- hasil rawat/verifikasi platform (NFC/QC ringan) utk to_dest='platform_vault'
  created_at, updated_at
```
> Primary: delivery_option 'shipping' → shipment `primary_shipping`;
> 'vault' → `primary_vault` (fisik tetap platform, tanpa ongkir).
> Secondary: buyer pilih tujuan — ke alamat (`secondary_*` +
> fee ongkir) ATAU ke platform vault (`to_dest='platform_vault'`,
> ongkir 0; platform verifikasi ulang chip saat terima).
> **Ship-from-vault**: kartu `platform_vault` boleh di-request
> kirim kapan saja (`vault_shipout`, fee ongkir C-Coin).
> Semua nominal C-Coin integer ≥ 1.

### orders (primary sale)
```
orders
  id uuid PK
  buyer_id uuid FK users.id
  drop_id uuid FK drops.id
  card_id uuid FK cards.id UNIQUE   -- 1 order = 1 kartu
  status enum('paid','qc','shipped','delivered','settled','refunded','disputed')
  delivery_option enum('shipping','vault')  -- kirim fisik vs simpan di inventory
  price_ccoin int
  shipping_fee_ccoin int nullable   -- hanya jika delivery_option='shipping'
  shipping_address jsonb nullable   -- hanya jika delivery_option='shipping'
  escrow_status enum('held','released')
  tracking_number text nullable     -- hanya untuk 'shipping'
  shipped_at, delivered_at timestamptz nullable
  created_at, updated_at
```
> Invariant: max 1 order per (buyer, drop). Enforced via
> partial unique index / application check.
> **delivery_option='vault'** (DEFAULT): kartu tetap ter-bind
	> ke akun (inventory di koleksi), fisik dipegang platform,
	> tanpa alamat/tracking. Status order: `paid → qc → settled`.
	> Ship-from-vault: owner bisa minta kirim kapan saja via
	> `shipments` type='vault_shipout' (bayar ongkir saat itu).
	> `delivery_option='shipping'`: status
	> `paid → qc → shipped → delivered → settled`.

> **ATURAN NOMINAL C-Coin (keputusan user 2026-08-12)**: semua
> nominal C-Coin — harga drop, buyout price, bid, ongkir,
> top-up, fee — WAJIB **integer minimal 1** (`CHECK x >= 1`),
> TIDAK ada desimal (1,5 / 0,5 dilarang). Konversi dari IDR
> ke C-Coin dibulatkan ke atas (ceiling) ke integer. Kolom
> sudah `int` — jangan pernah ubah ke numeric/decimal.

### wallets & wallet_transactions (C-Coin)
```
wallets
  user_id uuid PK FK users.id
  balance_ccoin int           -- cache; audit via SUM(transactions)
  updated_at

wallet_transactions
  id uuid PK
  user_id uuid FK users.id
  type enum('top_up','checkout','escrow_hold','escrow_release',
            'settlement','payout','royalty','refund','adjustment')
  amount_ccoin int            -- signed (+/-)
  ref_type text nullable      -- 'order', 'bid', 'payout'
  ref_id uuid nullable
  metadata jsonb nullable     -- idempotency key, gateway ref
  created_at timestamptz
```
> **Append-only**: tidak ada UPDATE/DELETE. Idempotency:
> webhook top-up pakai `metadata.idempotency_key` UNIQUE.
> **Partial failure handling**: webhook gateway -> system insert
> wallet_transaction dalam transaksi DB. Jika insert gagal (DB error),
> webhook return 500 -> gateway retry. Idempotency key mencegah
> duplikasi saat retry. Jika webhook tidak sampai (network failure),
> Cron reconciliation harian (ADM-05) mendeteksi top-up sukses di
> gateway tapi tidak ada di ledger -> alert admin untuk manual
> reconcile.

### bids (offer ke owner — bisa di kartu manapun)
```
bids
  id uuid PK
  card_id uuid FK cards.id
  bidder_id uuid FK users.id
  amount_ccoin int
  status enum('active','outbid','cancelled','accepted')
  created_at, outbid_at, cancelled_at, accepted_at timestamptz nullable
```
> Model bid (keputusan 2026-08-12):
> - Hanya SATU `active` bid per kartu = bid tertinggi saat ini.
> - Bid baru lebih tinggi → bid lama status `outbid`, C-Coin
>   bidder lama otomatis release (kembali ke saldo).
> - Bidder bisa `cancel` bidnya sendiri (selama belum accepted)
>   → C-Coin release.
> - Owner TIDAK bisa reject — hanya accept (current active) atau
>   diam.
> - **TIDAK ada expire** — bid active bertahan tanpa batas waktu;
>   berakhir hanya via accept (owner), cancel (bidder), atau
>   outbid (bid lebih tinggi). Tidak ada kolom `expires_at`.
> - History bid per kartu: tampil 90 hari terakhir; bid status
>   `accepted` (complete = transaksi selesai) permanen
>   selamanya.

### ownership_history (provenance)
```
ownership_history
  id uuid PK
  card_id uuid FK cards.id
  owner_id uuid FK users.id
  acquired_via enum('primary','secondary_buyout','secondary_bid','gift')
  order_id uuid FK orders.id nullable
  bid_id uuid FK bids.id nullable
  transferred_at timestamptz
```

### nfc_batches (provisioning)
```
nfc_batches
  id uuid PK
  batch_code text UNIQUE
  vendor text
  qty int
  status enum('received','provisioned','qc_passed','qc_failed','deployed')
  created_at
```

### qc_defects
```
qc_defects
  id uuid PK
  card_id uuid FK cards.id
  defect_type enum('dus','acrylic','kartu','nfc')
  severity enum('minor','major','critical')
  notes text
  resolution enum('redistribute','destroy','return_vendor')
  redistribute_discount_pct int   -- potongan harga jual 10-30% jika di-redistribute
  created_at
```
> **Redistribute defect**: kartu defect (misal acrylic retak ringan)
> bisa dijual dengan potongan 10-30% dari harga. Keputusan per-case
> oleh admin. Kartu defect yang di-redistribute tetap punya NFC
> verified — hanya fisik yang kurang sempurna.
> **Tag damage post-delivery**: jika NFC rusak setelah di tangan
> owner, kartu tetap bisa diperdagangkan sebagai "unverified"
> (tanpa jaminan NFC). Harga wajar lebih rendah. Tidak bisa
> di-claim sebagai defect produksi.

### kyc_records
```
kyc_records
  id uuid PK
  user_id uuid FK users.id
  full_name, nik, selfie_url, npwp_url nullable
  status enum('pending','approved','rejected')
  reviewed_by uuid FK users.id nullable (admin)
  created_at, updated_at
```
> Trigger KYC (keputusan 2026-08-13, validasi lawyer): payout/
> disbursement ke IDR + akumulasi top-up besar. Tidak perlu KYC
> untuk pasang buyout, accept bid, atau top-up rutin.

### disputes
```
disputes
  id uuid PK
  order_id uuid FK orders.id nullable
  card_id uuid FK cards.id nullable
  reporter_id uuid FK users.id
  reason text
  status enum('open','under_review','resolved_refund','resolved_strike','resolved_suspend')
  decision_notes text nullable
  created_at, updated_at
```

### badge_definitions (admin-configurable)
```
badge_definitions
  id uuid PK
  name text                     -- contoh: "Collector Starter"
  description text              -- "Berhasil beli 1 kartu"
  criteria jsonb                -- Kriteria yang dievaluasi:
     {type: 'collect_count', min: 1}       -- jumlah koleksi
     {type: 'collect_count', min: 10}      -- 10 kartu
     {type: 'level', min: 5}               -- level tertentu
     {type: 'creator_cards', creator_id: 'uuid', min: 3}  -- koleksi kreator tertentu
     {type: 'xp_total', min: 100}          -- total XP
  icon_url text
  xp_reward int default 0
  is_active bool default true
  created_by uuid FK users.id (admin)
  created_at, updated_at

user_badges
  id uuid PK
  user_id uuid FK users.id
  badge_id uuid FK badge_definitions.id
  awarded_at timestamptz
  xp_reward_snapshot int      -- snapshot xp_reward saat diraih
  UNIQUE (user_id, badge_id)
```
> **Rule**: Badge sekali diraih, tetap di profil selamanya — tidak
> dicabut meskipun criteria tidak lagi terpenuhi (misal sudah
> menjual kartunya). Evaluasi badge: event-driven (saat transaksi/
> level-up), bukan cron — untuk menghindari keterlambatan award.

### admin_audit_log (append-only, tidak bisa edit/hapus)
```
admin_audit_log
  id uuid PK
  admin_user_id uuid FK users.id
  action enum('create','update','delete','view_sensitive',
              'login','login_mfa','2fa_enroll','2fa_reset',
              'payout_trigger','config_change')
  target_table text           -- tabel yang diubah (drops, orders, ...)
  target_id text              -- id record (uuid/short_id) nullable
  payload_summary jsonb       -- ringkasan perubahan (BUKAN PII penuh)
  ip text, session_id text
  created_at timestamptz default now()
```
> Penulisan: hook terpusat di admin app (semua mutasi lewat satu
> service function → log otomatis). RLS: TIDAK ada RLS publik;
> akses via service-role dari admin app. Retensi ≥ 1 tahun
> (UU PDP + forensik fraud).
> 2FA: Supabase MFA TOTP (aal2) — bukan kolom di sini; akses
> admin app dibatasi di level app + Cloudflare Access
> (`06-tech-decisions.md` D1).

### notifications & payouts
```
notifications
  id uuid PK
  user_id uuid FK users.id
  channel enum('email','push','in_app')
  template_key text
  payload jsonb
  status enum('pending','sent','failed')
  created_at

payout_batches
  id uuid PK
  batch_code text UNIQUE
  status enum('draft','processing','paid','failed')
  total_ccoin, total_idr bigint
  fee_1pct_idr bigint
  created_at
payouts
  id uuid PK
  batch_id uuid FK payout_batches.id
  user_id uuid FK users.id
  type enum('creator_share','seller_proceeds','royalty')
  ccoin_amount int
  idr_amount bigint
  withholding_tax jsonb   -- PPh 23, PPN 11
  status enum('pending','disbursed','failed')
```

## 3. Relasi Ringkas

```
profiles 1─N creators (user bisa jadi kreator)
creators 1─N drops
drops 1─N cards
cards 1─1 orders (saat primary sale)
cards N─1 bids (offer ke owner; 1 kartu bisa banyak bid)
cards 1─N ownership_history
users 1─1 wallets
wallets 1─N wallet_transactions
users 1─N orders (buyer)
users 1─N payouts
orders 1─1 disputes (optional)
badge_definitions 1─N user_badges
profiles 1─N user_badges
```

> Tidak ada tabel `listings` terpisah — buyout price ada di
> kolom `cards.buyout_price_ccoin`; bid mengarah langsung ke
> `cards.id`.

## 4. Invariant Kritis (wajib di-enforce)

| # | Invariant | Enforce di |
|---|-----------|------------|
| I1 | Balance C-Coin tidak pernah negatif | DB check/transaction |
| I2 | wallet_transactions append-only | RLS + trigger |
| I3 | Max 1 kartu/drop per buyer | App + partial unique index |
| I4 | Buyout price hanya bisa dipasang/cabut oleh OWNER | RLS + app check |
| I5 | Checkout atomik pada unit terakhir (race) | `SELECT ... FOR UPDATE` / RPC transaction |
| I6 | Escrow vault release saat SETTLED; escrow shipping release DELIVERED + H+7 | App logic + cron |
| I7 | UID unik; konflik UID = flag investigasi | UNIQUE tag_uid + alert admin |
| I8 | QR verify tanpa CMAC hanya status "Registered" | Verify service |
| I9 | Hanya SATU bid active per kartu (tertinggi); bid lebih tinggi meng-outbid yang lama + release C-Coin | App logic + transaction |
| I10 | Max 20 kartu buyout aktif per user | App check |
| I11 | Level = floor(total_xp / 10); total_xp = spend C-Coin (1 C-Coin = 1 XP) + reward badge; top-up tidak menambah XP | Trigger/app logic |
| I12 | Profil publik hanya jika `is_anonymous = false` | RLS/query filter |

## 5. RLS (Row Level Security) — Ringkas

| Table | Publik (anon/authenticated) | Catatan |
|-------|------------------------------|---------|
| drops, cards (public fields) | READ publik (status live) | detail sold di-hide |
| orders | OWNER read/write | |
| wallets | OWNER read | |
| wallet_transactions | OWNER read | |
| bids | READ publik (90 hari, complete selamanya); WRITE bidder (place/cancel); accept hanya OWNER kartu | |
| cards.buyout_price_ccoin | WRITE hanya OWNER kartu | |
| profiles (koleksi/level/badge) | READ publik HANYA jika is_anonymous=false | |
| badge_definitions | READ publik; WRITE admin | |
| user_badges | READ publik (via profil); WRITE system | |
| creators, kyc, payout, disputes | NO public access | admin (service-role) only + creator read own |

> App publik TIDAK pernah punya service-role key. Semua
> operasi sensitif lewat RPC/function dengan security definer
> atau RLS check.

## Sumber

- `03-flows.md` (Flow 1-9 → struktur data).
- `40_operations/05_mvp_flow.md` (Wallet + WalletTransaction
  ledger, escrow, payout).
- `20_product/06_auction_mechanics.md` (rules → invariant
  listing/bid).
- `40_operations/01_tech_stack.md` (Supabase, Drizzle, RLS).
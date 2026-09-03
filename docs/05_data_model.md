# 05 — Data Model (Skema Logis)

> Status: [VALIDATED]
> Last updated: 2026-09-03 (dual-token: `wallets.balance_gems` +
> tabel `gem_lots`/`gem_transactions` — keputusan D3b
> `06_tech_decisions.md`)
> Previous: 2026-08-31 (skema cards/bids/badges diselaraskan ke
> `01_schema.sql`: `variant`, `nfc_uid`/`nfc_short_id`, `owner_id`,
> PK text, tabel `badges`, user_badges PK komposit; catatan kolom legacy)
> Previous: 2026-08-20 (creators.user_id diisi via admin-provisioning RPC; role 'creator' di-set admin — keputusan 2026-08-20)
> Skema LOGIS (tabel + relasi + enum), bukan DDL final.
> Database: Supabase Postgres (region SG). Query: Supabase client langsung (tanpa ORM).
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
  xp_reached_at timestamptz default now() -- tie-break leaderboard; hanya update saat total_xp BERUBAH (trigger guard)
  level int default 1                   -- = floor(total_xp / 10) + 1, clamp 1..100
cumulative_spend_ccoin int default 0  -- maintained by RPC di kelima site spend (checkout/platform_buy via wallet_debit; record_spend_conversion; accept_bid buyer settle; release_seed_sale Paths A & B); top-up & badge xp_reward TIDAK menyentuhnya
	  flag_reason text nullable              -- alasan fraud flag (isi manual admin)
	  consent_analytics_detail bool default false -- izin kreator lihat data per-user (anonim)
	  consent_data_market bool default false      -- izin data agregat untuk laporan pasar
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
> **`user_id` diisi via ADMIN-PROVISIONING (keputusan 2026-08-20)**:
> admin app create auth user + set `profiles.role='creator'` +
> isi `creators.user_id` (service-role:
> `supabase.auth.admin.createUser({ email, email_confirm: true,
> user_metadata: { role: 'creator' } })` — TANPA password; set
> `profiles.role='creator'`; update `creators.user_id` = auth uid;
> kirim email akses via Cloudflare Email Service). Field ini
> dulu nullable tanpa flow pengisian (gap G1/G2) — sekarang selalu
> terisi saat akun kreator dibuat; kreator login OTP/OAuth passwordless.
> **TERIMPLEMENTASI (2026-08-21)**: `creators.user_id` + row `users`
> (role 'creator') kini diisi oleh endpoint provision
> `POST /api/admin/users/provision` (gate admin aal2, service-role,
> ter-audit) — bukan RPC. Insert `creators` dilakukan endpoint tsb
> langsung (id `cr-…`, `status='active'`, `total_followers_combined`
> default 0); `users.id` tetap = `auth.users.id` (trigger).

### drops
```
drops
  id uuid PK
  creator_id uuid FK creators.id
  title text
  description text
  artwork_2d_url text        -- upload by ops (approved off-platform)
  artwork_3d_url text nullable -- F008 (cut line)
  price_ccoin int            -- e.g. 30 (Rp 300.000) — harga unsigned
  price_signed_ccoin int nullable -- harga signed = price_ccoin + 20 FLAT (founder 2026-08-16)
                              -- e.g. 30 -> 50 (Rp 500.000); nullable utk drop lama
  total_units int
  signed_units int           -- ceil(total_units / 10)
  drop_start_at timestamptz
  drop_end_at timestamptz
  raffle_end_at timestamptz    -- default drop_start_at + 24 jam
                               -- (entry window, C-15)
  drawn_at timestamptz nullable -- idempotency marker draw raffle
                               -- (null = belum drawn)
  status enum('draft','scheduled','published','live','sold_out','closed','cancelled')
  created_by uuid FK users.id (admin)
  created_at, updated_at
  is_seed bool default false      -- SEED CARD PROVENANCE (2026-08-20, Flow 10/C-17):
                                  -- true = drop 1-of-1 utk Creator Seed C.Card —
                                  -- kartu di-hadiahkan ke kreator (creator_id),
                                  -- dijual di secondary normal (BUKAN raffle).
                                  -- TWO-PHASE (2026-08-21, sebelumnya
                                 -- 20260821020000_seed_two_phase.sql,
                                 -- sekarang di 04a–04k RPC files): bid/accept
                                  -- BUKAN lagi di-gate; RELEASE (release_seed_sale,
                                  -- service_role) menolak settle dgn
                                  -- SEED_VAULT_IN_REQUIRED selama location <>
                                  -- platform_vault ATAU verify_status <> verified
                                  -- (lihat C-17)
```

### drop_entries (raffle entry — Flow 1 Phase 1, C-15)
```
drop_entries
  id uuid PK
  drop_id uuid FK drops.id
  user_id uuid FK users.id
  pool enum('regular','premium','both')  -- reguler/premium/keduanya
  hold_ccoin int              -- 30 / 50 (max pool yang diikuti)
  status enum('held','won_premium','won_regular','lost')
  entry_at timestamptz
  drawn_at timestamptz nullable
  UNIQUE (drop_id, user_id)   -- limit 1 entry/user/drop
```
> Entry tidak bisa dibatalkan; hold = escrow (`wallet_transactions`
> type `drop_entry_hold`). Draw: winner premium/keduanya →
> `won_premium` (bayar `price_signed_ccoin`), winner reguler →
> `won_regular` (bayar `price_ccoin`; pool "both" release selisih),
> sisanya `lost` (release penuh). Order winner dibuat default vault,
> `orders.source = 'raffle'`. Detail mekanik: `03_flows.md` Flow 1.

### cards (unit fisik)
```
cards
  id text PK                  -- PK text (bukan uuid), prefix id kartu
  drop_id uuid FK drops.id
  unit_number int             -- #X dari total; UNIQUE (drop_id, unit_number)
  variant enum('unsigned','signed') not null  -- pool kartu (BUKAN bool is_signed)
  status enum('inventory','bound','listed_buyout','bid_pending','sold','tampered','defect','lost')
  owner_id uuid FK users.id nullable -- null = belum di-bind (inventory)
  owner_since timestamptz default now() NOT NULL -- tie-break leaderboard 'cards' (only updates saat owner BERUBAH via trigger guard)
  nfc_uid text NOT NULL UNIQUE   -- UID chip NFC (mantul nama lama tag_uid)
  nfc_short_id text NOT NULL UNIQUE -- untuk URL /cards/:shortId
  verify_status enum('verified','tamper_detected','registered','unknown') not null default 'unknown'
  last_ctr int not null default 0 -- anti-replay NFC (docs/12)
  location enum('platform_stock','with_owner','platform_vault')
     -- lokasi FISIK kartu, terpisah dari ownership:
     --   platform_stock: belum terjual (stok platform)
     --   with_owner: fisik sedang/dipegang owner
--   platform_vault: dipegang platform atas nama owner (custody)
--     Manajemen fisik Y1: manual (bin/label per kartu di rak).
		  --     Ship-out request: admin cari kartu via short_id -> packing -> 3PL.
		  --     Tidak ada warehouse management system — semua manual Y1.
  buyout_price_ccoin int nullable -- dipasang owner -> muncul di Marketplace
  nfc_configured bool default false
qc_status text not null default 'pending'
     -- text + CHECK in ('pending','passed','failed') — BUKAN tipe enum
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
> Pembelian TIDAK membuat shipment (founder 2026-08-28: purchase
> → vault only) — order pembelian settle langsung, kartu
> `platform_vault`. Satu-satunya flow pengiriman =
> **ship-from-vault**: owner minta kirim kapan saja
> (`vault_shipout`, fee ongkir C-Coin di titik ship-out →
> treasury + `platform_revenue` ref_type 'shipment'). Type
> `primary_shipping`/`primary_vault`/`secondary_*` = legacy
> (tidak dibuat lagi oleh transaksi pembelian).
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
  source enum('raffle','fcfs')  -- asal order: pemenang draw vs FCFS sisa
  price_ccoin int            -- snapshot harga KARTU yang teralokasi:
                              -- signed -> drops.price_signed_ccoin,
                              -- unsigned -> drops.price_ccoin
  shipping_fee_ccoin int nullable   -- hanya jika delivery_option='shipping'
  shipping_address jsonb nullable   -- hanya jika delivery_option='shipping'
  escrow_status enum('held','released')
  tracking_number text nullable     -- hanya untuk 'shipping'
  shipped_at, delivered_at timestamptz nullable
  created_at, updated_at
```
> Invariant: max 1 order per (buyer, drop). Enforced via
> partial unique index / application check.
> **Semua order pembelian = vault** (founder 2026-08-28: purchase
> → vault only): settle langsung, status `paid → qc → settled`;
> kolom `delivery_option`/`shipping_fee_ccoin`/`shipping_address`
> legacy (tidak dipakai flow pembelian). Ship-from-vault: owner
> minta kirim kapan saja via `shipments` type='vault_shipout'
> (bayar ongkir saat itu).

> **ATURAN NOMINAL C-Coin (keputusan user 2026-08-12)**: semua
> nominal C-Coin — harga drop, buyout price, bid, ongkir,
> top-up, fee — WAJIB **integer minimal 1** (`CHECK x >= 1`),
> TIDAK ada desimal (1,5 / 0,5 dilarang). Konversi dari IDR
> ke C-Coin dibulatkan ke atas (ceiling) ke integer. Kolom
> sudah `int` — jangan pernah ubah ke numeric/decimal.

### wallets & wallet_transactions (C-Coin) + C-Gems ledger
```
wallets
  user_id uuid PK FK users.id
  balance_ccoin int           -- cache; audit via SUM(transactions)
  balance_gems int default 0  -- cache saldo C-Gems; audit via SUM(gem_transactions)
  total_topup_ccoin int default 0  -- akumulasi top-up (gate cap non-KYC + KYC threshold)
  total_spent_ccoin int default 0  -- akumulasi spend (basis XP)
  hold_payout_until timestamptz nullable  -- hold payout jika akun di-flag fraud
  updated_at

wallet_transactions
  id uuid PK
  user_id uuid FK users.id
  type enum('top_up','checkout','escrow_hold','escrow_release',
            'settlement','payout','royalty','refund','adjustment',
            'platform_buy',     -- platform beli kartu di secondary (admin seed)
            'platform_revenue', -- fee snapshot masuk wallet treasury
            'vault_shipout',    -- fee ongkir kirim dari vault
            'support')          -- dukungan ke kreator (100% kreator, XP pengirim 1:1)
  amount_ccoin int            -- signed (+/-)
  ref_type text nullable      -- 'order', 'bid', 'payout'
  ref_id uuid nullable
  metadata jsonb nullable     -- idempotency key, gateway ref, fee_rate snapshot
  created_at timestamptz

platform_revenue                                   [BARU 2026-08-16]
  id text PK
  source text                 -- 'primary' | 'secondary_buyout' | 'secondary_bid' | 'shipment'
  ref_type text               -- 'order' | 'bid' | 'buyout' | 'shipment'
  ref_id text                 -- UNIQUE (ref_type, ref_id): id order/bid/tx debit
  gross_ccoin int
  platform_ccoin int          -- bagian platform (70% primary / 7,5% secondary)
  royalty_ccoin int
  seller_ccoin int            -- 0 untuk primary
  fee_snapshot jsonb          -- {platform_pct, royalty_pct, seller_pct, rate_idr}
  created_at timestamptz
```
> **Treasury platform** [BARU 2026-08-16]: user sistem fixed UUID
> `00000000-0000-4000-8000-0000000000c0` (is_anonymous, bukan akun
> login). Setiap settlement meng-credit bagian platform ke wallet
> treasury via `record_platform_revenue` (idempotent per ref).
> Rekonsiliasi: `SUM(platform_revenue.platform_ccoin)` ≡ saldo
> wallet treasury — pendapatan platform TIDAK menguap.
> **Append-only**: tidak ada UPDATE/DELETE. Idempotency:
> webhook top-up pakai `metadata.idempotency_key` UNIQUE.
> **Fee rate snapshot** [IMPLEMENTED 2026-08-16]: setiap settlement
> primary/secondary menulis row `platform_revenue` berisi snapshot
> `fee_snapshot` (platform_pct/royalty_pct/seller_pct/rate_idr).
> Fee rate bisa berubah karena seasonal event (normal 7,5%+7,5%,
> event 2,5%+7,5%) — baca dari snapshot, jangan hardcode saat
> settlement ulang.
> **Partial failure handling**: webhook gateway -> system insert
> wallet_transaction dalam transaksi DB. Jika insert gagal (DB error),
> webhook return 500 -> gateway retry. Idempotency key mencegah
> duplikasi saat retry. Jika webhook tidak sampai (network failure),
> Cron reconciliation harian (ADM-05) mendeteksi top-up sukses di
> gateway tapi tidak ada di ledger -> alert admin untuk manual
> reconcile.

> **Catatan kolom legacy/penyimpangan nama** (skema riil `01_schema.sql`
> vs skema logis lama): `users.xp` (duplikat lama dari `total_xp` —
> tetap ada, jangan dipakai untuk hitung level), `wallets.total_topup_ccoin`
> / `total_spent_ccoin` (akumulasi, di-maintain RPC), `bids.bidder_name`
> (denormalisasi display name utk masking publik), `cards.qc_status` =
> `text` + CHECK (bukan tipe enum).

### gem_lots & gem_transactions (C-Gems — dual-token, keputusan 2026-09-03)
```
gem_lots
  id uuid PK
  user_id uuid FK users.id
  amount int                  -- nominal lot saat kredit (integer >= 1)
  remaining int               -- sisa lot; debit payout mengurangi (FIFO matured)
  ref_type text               -- mis. 'seed_release' | 'buyout' | 'bid_accept' | 'royalty' | 'support'
  ref_id uuid nullable
  created_at timestamptz
  mature_at timestamptz       -- created_at + 24 jam; payout hanya lot matured

gem_transactions
  id uuid PK
  user_id uuid FK users.id
  amount int                  -- signed (+/-)
  balance_after_gems int      -- saldo Gems setelah transaksi (audit trail)
  ref_type text
  ref_table text nullable
  ref_id uuid nullable
  idem_key text UNIQUE        -- idempotency
  created_at timestamptz
```
> **C-Gems** (aturan lengkap: D3b `06_tech_decisions.md`; legal:
> amend C-01 `07_constraints.md`): saldo penghasilan — lahir HANYA
> dari settlement milik sendiri (release seed, seller 85%
> buyout/accept-bid, royalti kreator, Dukungan 100%);
> non-transferable antar user. Setiap kredit membentuk lot terkunci
> 24 jam; payout (KYC, batch mingguan, fee 1%) hanya debit lot
> matured FIFO. Konversi satu arah Gems→C-Coin 1:1 (tanpa potongan,
> tanpa XP) TIDAK terkena cooldown. Append-only; semua nominal
> integer >= 1.

### bids (offer ke owner — bisa di kartu manapun)
```
bids
  id text PK                  -- PK text (bukan uuid)
  card_id uuid FK cards.id
  bidder_id uuid FK users.id
  bidder_name text not null   -- denormalisasi nama tampilan bidder (masking "Anonim" di baca API)
  amount_ccoin int
  status enum('active','outbid','cancelled','accepted')
  created_at, outbid_at, cancelled_at, accepted_at timestamptz nullable
  destination enum('buyer_address','platform_vault') nullable  -- TWO-PHASE seed (2026-08-21):
                                                                -- pilihan buyer disimpan saat PHASE-1 accept,
                                                                -- dipakai release_seed_sale utk settlement/shipment
  shipping_address text nullable                               -- alamat buyer saat PHASE-1 accept
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

### creator_page_views (analytics — log dari day 1)
```
creator_page_views
  id uuid PK
  creator_id uuid FK creators.id
  viewed_at timestamptz
  referrer text nullable         -- domain asal (IG, TikTok, direct, dll)
  city text nullable             -- dari IP geolokasi (anonymized)
  user_id uuid FK users.id nullable  -- null = anonymous visitor
```
> Log setiap page view halaman kreator `/c/:username`. Data agregat
> untuk dashboard kreator (total visitor, unique visitor, top
> referrer, demografi). Y1 < 10k baris/hari — tidak perlu sharding.
> Retensi: 2 tahun (data mentah), agregat selamanya.

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

### badges (admin-configurable; mantul nama badge_definitions)
```
badges
  id text PK                  -- PK text (bukan uuid)
  code text UNIQUE            -- key evaluasi trigger badge
  name text                     -- contoh: "Collector Starter"
  description text              -- "Berhasil beli 1 kartu"
  criteria jsonb                -- Kriteria yang dievaluasi:
     {type: 'collect_count', min: 1}       -- jumlah koleksi
     {type: 'collect_count', min: 10}      -- 10 kartu
     {type: 'level', min: 5}               -- level tertentu
     {type: 'creator_cards', min: 10}                   -- ≥10 kartu dari SATU kreator (seed: kreator mana pun)
     {type: 'creator_cards', creator_id: 'uuid', min: 3}  -- koleksi kreator tertentu (spec form, opsional)
     {type: 'xp_total', min: 100}          -- total XP
  icon text not null
  icon_url text
  xp int default 0              -- alias legacy kolom xp_reward
  xp_reward int default 0
  is_active bool default true
  created_by uuid FK users.id (admin)
  created_at, updated_at

user_badges
  PK komposit (user_id, badge_id)   -- BUKAN id uuid tersendiri
  user_id uuid FK users.id
  badge_id text FK badges.id
  earned_at timestamptz default now()
  awarded_at timestamptz default now()
  xp_reward_snapshot int      -- snapshot xp_reward saat diraih
```
> **Rule**: Badge sekali diraih, tetap di profil selamanya — tidak
> dicabut meskipun criteria tidak lagi terpenuhi (misal sudah
> menjual kartunya). Evaluasi badge: event-driven via trigger
> Postgres DALAM transaksi yang sama dengan event kualifikasi
> (transaksi/level-up) — award instan + atomic (tidak ada window
> event hilang), TANPA cron catch-up (keputusan user 2026-08-15).

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
> (`06_tech_decisions.md` D1).

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
  status enum('pending','processing','disbursed','failed','refunded')
         -- 'processing' (batch run) + 'refunded' (admin refund) ditambah
         -- 20260823000000_payout_refund.sql; webhook hanya boleh
         -- memfinalisasi pending/processing (guard 2026-08-29)
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
users 1─N gem_lots
users 1─N gem_transactions
users 1─N orders (buyer)
users 1─N payouts
orders 1─1 disputes (optional)
badge_definitions (tabel `badges`) 1─N user_badges
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
| I3 | Max 1 entry + 1 kartu/drop per user — pemenang raffle diblok dari FCFS drop yang sama; user kalah boleh FCFS | App + partial unique index + UNIQUE(drop_id,user_id) di drop_entries |
| I4 | Buyout price hanya bisa dipasang/cabut oleh OWNER | RLS + app check |
| I5 | Checkout atomik pada unit terakhir (race) | `SELECT ... FOR UPDATE` / RPC transaction |
| I6 | Semua pembelian release saat SETTLED (purchase → vault only, founder 2026-08-28 — tanpa jalur shipping; `vault_shipout` = flow terpisah, fee → treasury) | App logic (RPC settlement) |
| I7 | UID unik; konflik UID = flag investigasi | UNIQUE tag_uid + alert admin |
| I8 | QR verify tanpa CMAC hanya status "Registered" | Verify service |
| I9 | Hanya SATU bid active per kartu (tertinggi); bid lebih tinggi meng-outbid yang lama + release C-Coin | App logic + transaction |
| I10 | Max 20 kartu buyout aktif per user | App check |
| I11 | Level = floor(total_xp / 10) + 1 (clamp 1..100); total_xp = spend C-Coin (1 C-Coin = 1 XP) + reward badge; top-up tidak menambah XP | Trigger/app logic |
| I12 | Profil publik hanya jika `is_anonymous = false` AND `flag_reason IS NULL` (suspended) — termasuk leaderboard (filter **di dalam RPC** `get_leaderboard`), sitemap, dan ownership history (historical owner di-mask jadi "Anonim") | RPC + RLS |
| I13 | Blok rebuy seller 1 hari — kartu tidak bisa dibeli kembali oleh owner sebelumnya dalam 1x24 jam; pembeli bebas listing ulang kapan saja; wash trading diterima (fee 15% tetap kena) | App logic |
| I14 | Creator self-dealing — kreator dilarang membeli kartu drop sendiri di secondary untuk 30 hari pertama | App logic + flag |
| I15 | C-Gems: lot & transaksi append-only; payout HANYA debit lot matured (> 24 jam, FIFO); saldo Gems tidak pernah negatif; non-transferable antar user | RPC gem ledger |

## 5. RLS (Row Level Security) — Ringkas

| Table | Publik (anon/authenticated) | Catatan |
|-------|------------------------------|---------|
| drops, cards (public fields) | READ publik (status live) | detail sold di-hide |
| orders | OWNER read/write | |
| wallets | OWNER read | |
| wallet_transactions | OWNER read | |
| bids | READ publik (90 hari, complete selamanya); WRITE bidder (place/cancel); accept hanya OWNER kartu | |
| cards.buyout_price_ccoin | WRITE hanya OWNER kartu | |
| profiles (users; koleksi/level/badge) | READ publik via API service-role HANYA jika is_anonymous=false; akses tabel langsung: anon ditolak (`revoke all on users from anon`), authenticated = own row, admin = semua (`public.is_admin()`) | hardening 2026-08-30 |
| badges (definitions) | READ publik; WRITE admin | |
| user_badges | READ publik (via profil); WRITE system | |
| creators, kyc, payout, disputes | NO public access | admin (service-role) only + creator read own |

> App publik TIDAK pernah punya service-role key. Semua
> operasi sensitif lewat RPC/function dengan security definer
> atau RLS check.

## Sumber

- `03_flows.md` (Flow 1-9 → struktur data).
- 05_mvp_flow (Wallet + WalletTransaction ledger, escrow, payout,
  Flow 8.1 provisioning akun kreator).
- 06_auction_mechanics (rules → invariant listing/bid: max 20
  buyout aktif/user, min buyout 1 C-Coin, bid tanpa expire, max 1
  kartu primer / 10 sekunder per user, KYC payout).
- 01_tech_stack (Supabase, Drizzle, RLS).
- Akun kreator admin-provisioned (keputusan 2026-08-20,
  [VALIDATED]) — `creators.user_id` diisi via endpoint provision
  (`POST /api/admin/users/provision`). TERIMPLEMENTASI 2026-08-21.
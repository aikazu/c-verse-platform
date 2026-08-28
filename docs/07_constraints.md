# 07 — Constraints, Gates & Open Items

> Status: [VALIDATED] (C-01/C-02 resolved 2026-08-13)
> Last updated: 2026-08-23 (C-17 → admin abort path PHASE-1 stuck seed
> sale: RPC `cancel_seed_sale` di `04_rpc.sql` (sebelumnya
> `20260823050000_seed_sale_abort.sql`), service_role only,
> refund penuh buyer tanpa fees/XP)
> Previous: 2026-08-21 (C-17 → two-phase settlement: bid/accept
> BUKAN lagi di-gate; release yang wajib menunggu vault-in + NFC
> verified — SEED_VAULT_IN_REQUIRED pindah ke release_seed_sale
> di `04_rpc.sql` (sebelumnya `20260821020000_seed_two_phase.sql`),
> keputusan 2026-08-21)
> Previous: 2026-08-20 (C-13 enforceable via akun kreator
> admin-provisioned + C-17 Creator Seed C.Card — keputusan 2026-08-20;
> C-14 & T-2 diselaraskan koreksi user: burn sejati ~Rp 1 jt/bln,
> modal tidak habis Y1)
> Previous: 2026-08-20 (C-14 & T-2 koreksi finansial)
> Dok ini menjawab: **apa yang TIDAK boleh dibangun / di-live**
> dulu, dan apa yang masih menunggu keputusan.

## 1. Legal — C-Coin (RESOLVED 2026-08-13)

### C-01 [RESOLVED 2026-08-13] Status hukum C-Coin Opsi A (Q026)
- **Respon lawyer (2026-08-13)**: Struktur Opsi A VALID.
  1. C-Coin **bukan e-money** — one-way di primary (tidak bisa
     dicashout). C-Coin primary bersifat **non-refundable**
     (pembayaran B2C biasa). Pencairan seller/kreator di secondary
     dicatat sebagai "Pembayaran Hasil Titip Jual/Konsinyasi".
  2. Refund ke metode asal = reversal aman. Penutupan akun
     bersaldo boleh dikembalikan ke metode top-up terakhir.
  3. Escrow hold state di ledger internal cukup dengan T&C +
     pencatatan terpisah (segregated di ledger); tidak wajib
     rekening escrow bank di skala Y1.
- **Label legal yang direkomendasikan**: "Gamified Point
  Redemption" (lebih kuat secara hukum daripada "Trading
  Collectibles" — menekankan aspek poin/platform, bukan jual-beli
  barang). Karakterisasi ini harus konsisten di semua komunikasi
  publik dan T&C.
- **Vault-first recommendation**: Barang fisik sebaiknya tetap
  di vault platform selama secondary market. Kepemilikan fisik
  baru dikirim saat pemilik akhir meminta pengiriman. Desain
  sudah sesuai (lihat `cards.location` + `shipments` di
  `05_data_model.md`).

### C-02 [RESOLVED 2026-08-13] Escrow design (gap G9)
- Mekanisme escrow ledger internal sudah divalidasi lawyer.
  Status `escrow_status` di ledger bisa di-live tanpa segregasi
  bank. T&C + rekonsiliasi harian cukup.

## 2. NFC — Validasi Device

### C-03 [DRAFT] iOS tap-to-verify via SUN URL
- Hipotesis: iPhone membaca NDEF URL (background tag reading)
  → URL SUN (dengan CMAC) terbuka di Safari → server verify.
- **WAJIB divalidasi di device nyata** (Sprint 0) sebelum
  mematikan fallback QR. Edge case yang diuji:
  - iPhone terkunci / screen off.
  - Prompt "Open in Safari?" vs langsung.
  - iOS versi lama (7-11) vs baru.
  - Interaksi dengan Web NFC di Android (parity UX).

### C-04 [VALIDATED] Web NFC = Chrome Android 89+ only
- `navigator.nfc` tidak ada di iOS Safari, Firefox, desktop.
- Desain flow verify TIDAK boleh bergantung pada Web NFC
  sebagai satu-satunya jalur (lihat C-03).

## 3. Operasional / Produk

### C-05 Threshold kreator = 100 ribu+ followers COMBINED
- Gabungan semua platform sosial (IG + TikTok + YouTube + X,
  dll). Divalidasi manual saat rekrutan off-platform.
- Onboarding TANPA aplikasi/approval in-platform — direct
  contact. Admin hanya mengelola data (ADM-01).
- **Quality gate**: engagement rate ≥ 5% dari 10 post terakhir
  wajib sebelum deal memo. ER < 3% = skip. Threshold per platform:
  IG/Twitter 5%+, TikTok 10%+. Filter manual oleh founder saat
  rekrutmen.

### C-05b KYC trigger (diupdate 2026-08-13, validasi lawyer)
- **Prinsip**: KYC hanya diwajibkan untuk seller yang ingin
  withdrawal/cash-out hasil penjualan ke rekening bank. Tidak
  perlu KYC di top-up rutin, bid/buyout, atau menerima bid.
- Threshold KYC aktif saat: (1) payout/disbursement hasil seller
  & kreator ke IDR — WAJIB KYC + verifikasi rekening tujuan.
  (2) Akumulasi top-up besar (threshold finalisasi sebelum
  launch).
- **Tidak ada KYC untuk**: pasang buyout price, menerima bid,
  atau top-up rutin di bawah threshold. Cukup verifikasi akun
  standar (email OTP).

### C-05c Level & badge (XP, bukan masa berlaku)
- Level = floor(total_xp / 10) + 1, clamp 1..100. Sumber XP:
  spend C-Coin (1 C-Coin = 1 XP) + xp_reward badge. Top-up tidak
  menambah. Tier diturunkan **read-time** via `calcLevel`
  (`packages/shared/src/index.ts`), TIDAK tersimpan di DB.
- **Tier ladder (Galactic)**: 10 band × 10 level — `orbit`
  (L1-10) · `meteor` (11-20) · `komet` (21-30) · `planet`
  (31-40) · `nebula` (41-50) · `nova` (51-60) · `supernova`
  (61-70) · `pulsar` (71-80) · `kuasar` (81-90) · `galaksi`
  (91-100). Konstanta `LEVEL_TIERS` di `packages/shared/src/index.ts`.
- Badge: definisi (kriteria + ikon + XP reward) dikonfigurasi
  admin (ADM-07); evaluasi otomatis event-driven via trigger
  SQL (ownership/bid/KYC) — termasuk `creator_cards` evaluator
  aktif di `trg_badge_ownership` (`04_rpc.sql`). "exp" =
  EXPERIENCE, bukan expiry.

### C-05d Privasi profil
- Profil publik (koleksi, level, badge, ranking) default
  tampil; user bisa mengaktifkan **privacy anonymous** untuk
  menyembunyikan.

### C-05e Flow bid (keputusan 2026-08-12)
- TANPA reject — owner hanya accept (current active) atau diam.
- Bidder bisa cancel bidnya sendiri → C-Coin release.
- Bid lebih tinggi → bid lama `outbid`, C-Coin balik otomatis
  ke bidder lama.
- History bid per kartu: 90 hari terakhir; bid `accepted` (complete)
  permanen selamanya.
 > **Cancel vs outbid**: keduanya melepas C-Coin ke saldo bidder.
 > Cancel = inisiatif bidder. Outbid = otomatis saat bid lebih
 > tinggi masuk. Efek ke saldo sama (release).

### C-06 [DEFERRED] Deposit secondary high-value (R6)
- Hold deposit untuk bid/buyout high-value di-defer sampai
  secondary live & ada data volume. Tidak di-build di MVP.
  Keputusan: hold C-Coin jika diimplementasi nanti.

### C-07 [FINAL 2026-08-12] Secondary = Marketplace + Browse (tanpa auction)
- Marketplace: owner pasang buyout price. Browse: bid langsung
  di kartu walau tanpa harga (owner **accept only — TANPA
  reject**; bidder bisa cancel; bid TIDAK ada expire). TIDAK ada
  auction timer/anti-sniping/deposit timebox di MVP.

### C-08 [FINAL — founder 2026-08-16] Cap saldo top-up KYC-gated
- Lawyer mengonfirmasi cap saldo sebagai faktor mitigasi yang
  valid (2026-08-13).
- **FINAL**: cap saldo top-up **500 C-Coin (Rp 5 juta)** untuk
  user **non-KYC** — top-up yang melampaui ditolak (HTTP 422
  `KYC_TOPUP_CAP`) sebelum Snap dibuat; race double-webhook
  ditolak RPC (`TOPUP_CAP_EXCEEDED`, audit + refund manual).
  **KYC approved = TANPA cap.** Enforced di RPC `wallet_credit`
  (defense in depth) + gate di `POST /api/payments/topup`.

### C-09 [DRAFT] Detail payout
- Minimum payout, verifikasi rekening, SLA, mekanisme
  disbursement final, perlakuan pajak — belum di-lock.
  Payout teknis tetap dibangun dengan default yang wajar.

### C-09b [FINAL] Minimum payout
- Minimum payout: **10 C-Coin (Rp 100.000)**. Saldo seller/kreator
  menumpuk sampai threshold terpenuhi. Payout fee 1% tetap
  dipotong dari total.

### C-10 [FINAL — update 2026-08-28] Purchase → vault only; kirim fisik = ship-out pasca-vault
- **Primary**: checkout settle LANGSUNG ke vault (founder
  2026-08-28: purchase → vault only) — kartu ter-bind virtual,
  fisik dipegang platform, tanpa alamat/ongkir/tracking di titik
  beli. Ship-from-vault: owner minta kirim kapan saja via Kelola
  Kartu (`vault_shipout`, bayar ongkir saat itu; fee → treasury +
  `platform_revenue`).
- **Secondary**: kartu selalu masuk/tetap di vault, ownership
  pindah di ledger — TANPA `buyer_address`; buyer minta ship-out
  kapan saja (ongkir C-Coin + tracking di titik ship-out).
- `orders.delivery_option` + kolom shipping = legacy (tidak
  dipakai flow pembelian).
- `cards.location enum('platform_stock','with_owner',
  'platform_vault')`, `shipments` table (type aktif:
  `vault_shipout` + jalur seed two-phase).
- **Rekomendasi lawyer (2026-08-13)**: vault-first memperkuat
  posisi "Gamified Point Redemption" — barang tidak berpindah
  fisik, hanya ledger. Juga menghindari fraud pengiriman antar-
  user.

### C-11 [FINAL] Nominal C-Coin integer ≥ 1
- Semua nominal C-Coin (harga, buyout, bid, ongkir, top-up,
  fee) WAJIB **integer minimal 1**, tanpa desimal (1,5 / 0,5
  dilarang). Kolom sudah `int` (`CHECK x >= 1`);
  konversi IDR → C-Coin dibulatkan ke atas (ceiling).

### C-12 [FINAL — revisi 2026-08-15] Blok rebuy seller 1 hari
- Owner yang menjual kartu di secondary TIDAK BISA membeli kembali
  kartu yang sama dalam 1x24 jam (blok rebuy oleh seller sebelumnya —
  hanya memutus loop A→B→A di hari yang sama).
- [2026-08-29] Enforcement di KEDUA jalur beli secondary:
  `buyout_card` dan `place_bid` (COOLING_PERIOD_24H) — accept bid
  otomatis tertutup karena bid aktif dari prev-owner <24 jam tidak
  bisa lagi tercipta.
- Pembeli BOLEH langsung listing ulang kapan saja setelah beli —
  TIDAK ada hold/cooling period untuk listing.
- **Wash trading / jual-beli berulang untuk menaikkan harga
  DITERIMA** sebagai aktivitas pasar (keputusan user 2026-08-15):
  setiap transaksi tetap kena fee 15% — kenaikan volume/harga
  justru menguntungkan platform (7,5%) dan kreator (7,5% royalti
  lifetime). Transparansi tetap jalan: price history + ownership
  history publik per kartu — pembeli menilai sendiri pola transaksi.
- XP farming via transaksi diterima — kriteria leaderboard
  diperluas (tab `Level`/`Kolektor`/`Lencana` + papan per-kreator).
- Konsisten invariant I13 (`05_data_model.md`) dan Flow 7
  (`03_flows.md`). Menggantikan cooling 14 hari (dan 7 hari
  sebelumnya).

### C-13 [FINAL] Creator self-dealing dilarang 30 hari
- Kreator (dan akun terafiliasi yang terdeteksi) dilarang membeli
  kartu drop mereka sendiri di secondary untuk 30 hari pertama
  setelah drop. Pelanggaran: suspend 14 hari + hold payout 30 hari.
- **ENFORCEABLE sejak 2026-08-20**: akun kreator kini
  TERIDENTIFIKASI (admin-provisioned, auth passwordless — lihat
  `10_auth_migration.md` & keputusan akun kreator admin-provisioned
  (FINAL 2026-08-20: admin create auth user passwordless via Supabase
  Auth admin API, set `profiles.role = 'creator'`, isi
  `creators.user_id`, kirim akses via SumoPod SMTP)),
  sehingga larangan ini bisa di-enforce per akun (RULE/RLS + audit),
  tidak lagi bergantung flag manual. Berlaku juga untuk seed card:
  kreator pemilik seed card dilarang membeli kembali kartu seed
  miliknya dalam 30 hari pertama.
- **PERLUASAN SEED (TERIMPLEMENTASI 2026-08-21, sebelumnya
  `20260821000000_seed_card.sql` — sekarang di `04_rpc.sql`)**:
  untuk kartu dari seed drop
  (`drops.is_seed = true`), guard 30 hari TIDAK lagi bergantung
  `drop_start_at`/`drop_at`/`created_at` (seed BUKAN raffle — drop
  tidak punya jadwal bermakna). Basis pragmatis yang dipakai di RPC
  `buyout_card`: `ownership_history` terakhir milik kreator
  (`drops.creator_id` — menandai serah hadiah ke kreator, Flow 10
  langkah [3]) dengan fallback `cards.created_at`; kreator seed
  dilarang buyout balik dalam 30 hari sejak anchor itu. Hanya
  memblok kreator seed — buyer normal tidak terpengaruh.
- Split seed card (Creator Seed C.Card, 2026-08-20) = **85% owner
  + 7,5% royalti kreator lifetime + 7,5% platform** (secondary
  normal); pada penjualan pertama oleh kreator-owner: kreator
  efektif **92,5%** / platform 7,5%. BUKAN fee 12%/6% — konsisten
  glossary & 19_revenue_split (secondary = 85% owner + 7,5% royalti
  kreator lifetime + 7,5% platform; keputusan 2026-07-27/2026-08-04).

### C-14 [DRAFT] Target Y1 realistis
- Drop: 40-65/tahun (bukan 150). Unit: 400-650 kartu (bukan 1.500).
- Quarter: Q1=0 (build), Q2=5-10 (pilot), Q3=15-25, Q4=20-30.
- Konsekuensi: revenue model, COGS, dan unit economics perlu
  direvisi dengan volume realistis ini.
- **Catatan 2026-08-20 (selaras koreksi user)**: dengan Opex Y1
  recompute Rp 38 jt dan burn sejati pasca-launch ~Rp 1 jt/bulan
  (A029), C-14 menghasilkan **EBITDA base ≈ -Rp 4,8 jt**, bukan
  -120,6 jt. Modal Rp 50-100 jt TIDAK habis dalam Y1 — risiko
  utama pindah dari burn ke **demand/sold-out** (working capital
  produksi 52,8 jt Y1 tidak kembali bila kartu tak laku; arti
  angka: GMV primary Rp 112 jt, revenue platform 78,4 jt, kas
  akhir Y1 +44,6 jt di modal 50 jt).

### C-15 [FINAL 2026-08-15] Primary sale = raffle hybrid + pilihan pool
- **Entry window 24 jam pertama** setelah drop live (default,
  bisa diatur admin per drop via `drops.raffle_end_at`).
- Buyer pilih pool EKSPLISIT: **reguler** (hold harga unsigned,
  mis. 30), **premium** (hold harga signed, mis. 50), atau
  **keduanya** (hold maksimum; premium diundi dulu, kalah →
  masuk pool reguler; dapat reguler → selisih di-release).
- Draw otomatis batch (cron 5-menit, idempotent via
  `drops.drawn_at`) — winner langsung jadi order (default vault),
  loser hold kembali otomatis. Pemenang tidak mungkin gagal bayar
  (dana sudah di-hold saat entry).
- **Sisa unit setelah draw → FCFS** "siapa cepat dia dapat"
  (RPC checkout race-safe) sampai sold out / `drop_end_at`.
- Alasan: drop Y1 kecil (10-15 unit, limit 1 kartu/user) — FCFS
  murni dimenangkan bot/scalper dalam hitungan detik; raffle
  memberi keadilan + 2 momentum hype (buka entry + hasil draw).
- Signed = pool premium (`signed_units = ceil(total/10)`) —
  menggantikan random alokasi 1:10 (tidak ada random surprise
  harga). Konsisten Flow 1 (`03_flows.md`), `drop_entries`
  (`05_data_model.md`), RPC `drop_entry`/`draw_drop`
  (`13_atomic_checkout_rpc.md`).

### C-16 [FINAL 2026-08-15] Bahasa Platform = Indonesia (Casual-Profesional) + Istilah English
- **UI/UX Utama**: Bahasa Indonesia casual-profesional (sesuai UU No. 24/2009 & UU PDP).
- **Istilah Domain/Fandom**: Tetap Bahasa Inggris (*Raffle*, *Drop*, *Pool*, *Vault*, *Collectible*, *C.Card*, *Marketplace*, *Bid*, *Buyout*, *Tap & Verify*).
- **Codebase/Comments**: 100% Bahasa Inggris.
- **i18n Readiness**: Default locale `id`, disiapkan arsitektur i18n untuk `en` pada ekspansi Y2+.

### C-17 [FINAL 2026-08-20] Creator Seed C.Card — seeding secondary, BUKAN primary raffle
- Flow akuisisi kreator (pengganti marketing berbayar, Rp 0) +
  seeding likuiditas secondary: produksi kartu **1-of-1** tentang
  kreator → tanda tangan kreator → serah sebagai hadiah + pitch
  kolaborasi → daftar ownership = kreator (syarat akun kreator
  aktif, lihat C-13 / Flow 11) → listing Marketplace/Browse →
  bid publik → accept → **VAULT-IN WAJIB + verifikasi NFC
  (UID + kondisi fisik) sebelum settle/serah ke buyer** → release.
- **BUKAN primary raffle/drop**: seed card TIDAK pernah lewat
  entry window/draw (Flow 1) — selalu secondary normal (C-07).
  Beri nama flow tersendiri (jangan tertukar primary drop).
- **Provenance seed = flag level drop `drops.is_seed` (TERIMPLEMENTASI
  2026-08-21, sebelumnya `20260821000000_seed_card.sql` —
  sekarang di `01_schema.sql`)**: seed card =
  kartu yang drop induknya `is_seed = true`; seed drop dibuat dengan
  `creator_id` = kreator target, sehingga royalti 7,5% otomatis ke
  kreator via kode existing (tanpa kolom fallback). Kolom baru di
  `05_data_model.md`.
- **Gate vault-in TERIMPLEMENTASI (2026-08-21) — TWO-PHASE SETTLEMENT
  (keputusan 2026-08-21)**: bid/accept/checkout BUKAN lagi di-gate —
  bid BOLEH dari mana saja (kartu di kreator ATAU di vault) selama
  TIDAK ada transaksi berjalan. Saat owner accept / buyer buyout:
  **PHASE-1 LOCK** (deal terkunci, kartu `bid_pending`, seller belum
  dibayar, ownership belum pindah; selama `bid_pending` bid/buyout
  baru -> `SALE_IN_PROGRESS`). **RELEASE-lah yang wajib menunggu
  vault-in + NFC verified**: RPC `release_seed_sale` (service_role
  HANYA, dipicu admin via `POST /api/admin/cards/:id/release-seed-sale`)
  mengecek `drops.is_seed`; jika seed card TIDAK di `platform_vault`
  ATAU `verify_status <> 'verified'` -> raise `SEED_VAULT_IN_REQUIRED`
  (gate SEED_VAULT_IN_REQUIRED lama di `accept_bid`/`buyout_card`
  dihapus — sebelumnya `20260821020000_seed_two_phase.sql`,
  sekarang di `04_rpc.sql`). **verified hanya
  bisa dicapai via tap NFC** (SUN/CMAC crypto — `nfc.ts`); admin path
  vault-in `PATCH /api/admin/cards/:id/vault-in` HANYA menandai
  kedatangan fisik (`location='platform_vault'`) + audit pemeriksaan
  kondisi fisik — TIDAK pernah memalsukan `verify_status='verified'`
  (keputusan desain 2026-08-21). Gate mengecek KEDUANYA.
- **Pre-gate seed-only vault-in (2026-08-23)**: route
  `PATCH /api/admin/cards/:id/vault-in` menolak kartu non-seed
  (`drops.is_seed = false`) dengan `400 NOT_SEED_CARD` sebelum
  menyentuh tabel `cards`/audit. Non-seed C.Card tidak pernah
  masuk vault — owner pegang langsung atau kirim. Hanya kartu dari
  drop `is_seed = true` yang memenuhi prasyarat RELEASE.
- **release_seed_sale idempotent (2026-08-21)**: guard status kartu
  harus `bid_pending` — setelah release sukses (status -> `sold`)
  panggilan ulang -> `NO_PENDING_SALE`; settle accepted-bid ATAU
  order pending (buyout PHASE-1: `paid`/escrow `held`) -> seller 85%
  + royalti kreator 7,5% + platform 7,5% + ownership ke buyer +
  shipment (dari `platform` — kartu release dari vault).
- **Admin abort PHASE-1 stuck sale (2026-08-23)**: jika kartu seed
  hilang / dispute / tidak pernah di-vault-in sehingga release
  tidak mungkin, admin memicu `POST /api/admin/cards/:id/cancel-seed-sale`
  → RPC `cancel_seed_sale` (service_role ONLY, mirror guard pattern
  release_seed_sale di `04_rpc.sql` — sebelumnya
  `20260823030000_release_seed_grant_lock.sql`). Buyer di-refund FULL — tanpa fees,
  tanpa XP (XP granted TEPAT SEKALI di PHASE-2 release per invariant
  founder 2026-08-23, PHASE-1 tidak grant XP). Path A: bid
  `accepted` → `cancelled` + `wallet_credit` buyer. Path B: order
  `paid` → `refunded` + `wallet_credit` buyer. Kartu kembali ke
  `inventory`. Idempotent (`p_idem='seed-abort-'||card_id`).
  Tidak touch treasury/platform_revenue — PHASE-1 menulis tidak ada
  revenue leg. RPC `cancel_seed_sale` di `04_rpc.sql` (sebelumnya
  `20260823050000_seed_sale_abort.sql`).
- Split penjualan pertama: **85% owner + 7,5% royalti kreator
  lifetime + 7,5% platform** (secondary normal) — kreator-owner
  efektif **92,5%** / platform 7,5% (bukan fee 12%/6%).
- **COGS seed card = biaya AKUISISI** (marketing-in-kind, bukan
  penjualan); sunk bila tak laku. Volume fleksibel: min ~3
  kartu/bulan, TANPA cap keras. Statistik COGS: unsigned ~Rp
  104.000, signed +Rp 16.000 = Rp 120.000 (signed = kreator
  menandatangani); asumsi 40 kreator Y1 ≈ Rp 4,8 jt (A031).
  Langkah lengkap di Flow 10 (`03_flows.md`).

## 4. Batasan Teknis yang Diterima

| # | Batasan | Konsekuensi |
|---|---------|-------------|
| T-1 | Supabase Realtime broadcast < 50 concurrent bidder | Durable Objects tidak dipakai Y1 |
| T-2 | CF Workers free tier + Supabase cukup Y1 (margin 5-10x) | Upgrade ~Rp 500rb/bln worst case. **Burn sejati infra pasca-launch = Rp 0 (free tier) s.d. Rp 500rb/bln (worst) — lihat A029** |
| T-3 | Web NFC tidak ada di iOS | Jalur verify universal (SUN URL) + fallback QR |
| T-4 | 3D viewer (F008) effort 4-5 PW | Cut line #1 |
| T-5 | Admin app lokal = operasi berhenti jika mesin mati | Mitigasi: VPS + Cloudflare Access |

## 5. Open Items (Sprint 0 Checklist)

| Kode | Item | Blocker? |
|------|------|----------|
| C-03 | Validasi iOS SUN URL | Ya (mempengaruhi D2) |
| O-1..O-7 | Tech open items (lihat `06_tech_decisions.md` section 3) | Tidak |
| ~~Q026~~ | ~~Status hukum C-Coin~~ | **RESOLVED 2026-08-13** — bukan blocker |
| R6 | Desain deposit secondary | Tidak (post-launch secondary) |
| F2 | Acrylic case: magnet vs screw | Tidak (ops, tunggu RFQ vendor) |
| Q016 | PWA vs native | Tidak (PWA untuk MVP, sudah final) |

## 6. Matriks Keputusan yang DILARANG Dibalik

| Keputusan | Status |
|-----------|--------|
| C-Coin medium tunggal, rate Rp 10.000 | FINAL (2026-08-11) |
| Opsi A closed-loop tanpa withdraw buyer | FINAL (2026-08-11) — **DIVALIDASI lawyer 2026-08-13** |
| C-Coin bukan e-money; "Gamified Point Redemption" (bukan lelang); KYC hanya untuk cash-out (payout/disbursement ke IDR) | FINAL (2026-08-13, validasi lawyer) |
| Threshold kreator 100rb+ combined | FINAL (2026-08-12) |
| Onboarding off-platform tanpa approval in-platform | FINAL (2026-08-12) |
| Admin app terpisah, tidak di edge | FINAL (2026-08-12) |
| Secondary = Marketplace + Browse (bukan auction) | FINAL (2026-08-12) |
| Tidak ada halaman verifikasi terpisah (melekat di halaman kartu) | FINAL (2026-08-12) |
| Primary = platform-produced SAJA (70/30), kreator-produced defer | FINAL (2026-08-12) |
| Leaderboard punya halaman sendiri (PG-LB-01) — multi-type: `xp` (default), `cards`, `badges`, `creator` (papan per-kreator via `?tab=`); privasi dijamin RPC `get_leaderboard` (`04_rpc.sql`) | FINAL (2026-08-12; expanded 2026-08-27) |
| Top-up di area user; **bisa diterima setelah T&C final + cap saldo** (Q026 resolved 2026-08-13) | FINAL (2026-08-13) |
| KYC trigger: payout/disbursement ke IDR + akumulasi top-up besar (TIDAK untuk pasang buyout/accept bid) | FINAL (2026-08-13, validasi lawyer) |
| Profil publik + privacy anonymous | FINAL (2026-08-12) |
| Level = via XP (spend 1 C-Coin = 1 XP; 10 XP = 1 level; badge +XP) | FINAL (2026-08-12) |
| Badge admin-configurable (kriteria + ikon + XP reward), ADM-07 | FINAL (2026-08-12) |
| Bid flow: tanpa reject; bidder cancel; outbid release C-Coin; history 90 hari (complete selamanya) | FINAL (2026-08-12) |
| Domain: `c-verse.co` primary, `c-verse.id` redirect — LOCK sebelum provisioning NFC | FINAL (2026-08-13) |
| Halaman kreator PUBLIK `/c/:username` (list drop); profil kolektor `/u/:username` + privacy anonymous | FINAL (2026-08-12) |
| Revenue split 70/30 primary + 7,5/7,5/85 secondary (default; seasonal event bisa turunkan platform share ke 2,5% via fee_rate snapshot — lihat `09_recommendations.md` build-time; royalti kreator 7,5% TIDAK pernah turun) | FINAL (2026-08-04) |
| Tech stack full-edge | FINAL (2026-08-11) |
| Form factor kartu 63x88mm + holo + signed 1:10 | FINAL |
| Pengiriman: purchase → vault only (tanpa alamat/ongkir di checkout); kirim fisik = ship-out pasca-vault (ongkir C-Coin saat ship-out) | FINAL (2026-08-28; sebelumnya 2026-08-12) |
| Secondary: settle ke platform_vault (tanpa `buyer_address`); ship-from-vault kapan saja (ongkir C-Coin) | FINAL (2026-08-28; sebelumnya 2026-08-12) |
| Semua nominal C-Coin integer ≥ 1 (tanpa desimal) | FINAL (2026-08-12) |
| Chip NTAG 424 DNA TagTamper | FINAL (2026-08-03) |
| UI Bahasa Indonesia Casual-Profesional + Istilah Domain English (C-16) | FINAL (2026-08-15) |

## Sumber

- 14_legal_consultation_brief (Sesi A-D; Sesi A gate launch —
  dijawab lawyer fintech 2026-08-13).
- 02_legal_compliance (2,2 C-Coin / struktur Opsi A — status
  [VALIDATED 2026-08-13]: C-Coin bukan e-money, "Gamified Point
  Redemption" bukan lelang, KYC cash-out only).
- 18_nfc_decision (N5: SUN/SDM — ISO 7816-4 file system, SDM mirror
  UID+counter+CMAC ke NDEF, server-side CMAC verify; N5b: iOS via
  SUN URL).
- Open questions tracker (Q027-Q030: payout mekanisme final,
  akuntansi float liability, pajak payout fee 1%, refund saldo +
  penutupan akun; R6: deposit secondary; O1-O7: open items ops).
- 05_assumptions (A015 status hukum C-Coin — confidence HIGH,
  tervalidasi lawyer 2026-08-13; A027-A031 keputusan 2026-08-20:
  A027 marketing=0, A028 AI one-time 16-24 jt, A029 burn sejati
  ~Rp 1 jt/bln, A030 legal+domain sekali, A031 seed card 4,8 jt).
- Diskusi founder 2026-08-12.
- Validasi lawyer fintech 2026-08-13.
- Keputusan user 2026-08-20 (marketing=0, AI one-time, pemisahan
  burn/working-capital/akuisisi) — selaras C-14 & T-2 di atas;
  angka kunci: Opex Y1 Rp 38 jt, EBITDA base ≈ -Rp 4,8 jt,
  burn pasca-launch ~Rp 1 jt/bln (base), kas akhir Y1 +44,6 jt.
- Creator Seed C.Card (keputusan 2026-08-20, diperbarui 2026-08-21
  two-phase settlement) — flow 1-of-1: produksi → tanda tangan →
  serah + pitch → daftar ownership kreator → listing → bid publik →
  accept (PHASE-1 LOCK) → vault-in wajib + verifikasi NFC →
  release admin (PHASE-2: settle 85/7,5/7,5); C-13 enforceable.
- Akun kreator admin-provisioned + passwordless (keputusan
  2026-08-20) — dasar C-13 enforceable.
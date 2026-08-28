# 09 — Rekomendasi Development

> Status: [VALIDATED]
> Last updated: 2026-08-14
> Dok ini berisi rekomendasi teknis & operasional — termasuk
> **build-time implications**: hal-hal yang harus diantisipasi
> sejak Sprint 0 meskipun fiturnya belum dibangun.

## 1. Prioritas Build (Sprint 0-1)

| Priority | Area | Mengapa |
|----------|------|---------|
| P0 | **Domain + Cloudflare setup** (08_deployment.md) | NFC provisioning butuh domain final. Beli/transfer domain, setup zone, DNS, Pages, Workers |
| P0 | **Auth + Wallet engine** (F001, F036) | Semua fitur bergantung pada auth (Google OAuth + email OTP) dan wallet C-Coin (ledger immutable, top-up, escrow) |
| P0 | **SEO Worker + HTMLRewriter** | Halaman kreator `/c/:username` dan kartu `/cards/:shortId/3d` harus ter-index Google sejak launch. Build 2-3 hari, Worker di depan SPA inject OG meta + JSON-LD + sitemap |
| P1 | **Drop + Checkout raffle hybrid** (F004, F005) | Core loop: admin bikin drop -> raffle entry 24 jam (pool + hold) -> draw otomatis -> FCFS sisa -> vault default, ship-out opsional |
| P1 | **Admin app dasar** (ADM-01..04) | Founder harus bisa operasi tanpa DB: kelola kreator, drop, order, NFC batch |
| P2 | **NFC verify** (F007) + Halaman kartu (PG-CARD-01/02) | Provenance = value prop utama. Tapi butuh kartu fisik dulu |
| P2 | **Secondary: Marketplace + Browse** (F011, F012) | Bisa dibangun setelah primary loop stabil |
| P2 | **Anti-fraud rules** (1-day rebuy block, creator self-dealing, multiple account detection) | Proteksi platform dari abuse. Build bersamaan dengan secondary |
| P2 | **Creator analytics** (F016 — insight kolektor) | Traffic, repeat rate, avg spending — nilai jual ke kreator |
| P3 | **Gamifikasi** (F017-F019) | Level, badge, leaderboard — nice-to-have, tidak mengganggu transaksi |

## 2. Rekomendasi Arsitektur

### 2.1 Wallet Engine (C-Coin)
- **Semua transaksi = integer**, tanpa float/desimal. Konversi IDR→C-Coin ceiling.
- **Ledger append-only**: `wallet_transactions` tidak bisa UPDATE/DELETE.
  Saldo = SUM transaksi. Kolom `balance_ccoin` di `wallets` hanya cache.
- **Escrow**: status di ledger (`escrow_status enum('held','released')`).
  Semua pembelian release saat SETTLED (founder 2026-08-28:
  purchase → vault only — tanpa jalur shipping di checkout).
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
- **Evaluasi event-driven**: trigger Postgres dalam transaksi yang
  sama dengan event kualifikasi (transaksi/level-up) — award instan,
  tanpa cron (keputusan user 2026-08-15).
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
| Rate limit bid | Max 3 bid aktif/user (RPC `BID_LIMIT`, founder 2026-08-16) |
| Strike system | 3 strike = suspend 30 hari |
| Shill detection | Cross-check IP + device fingerprint + payment method |
| Wash trading | Diterima (fee 15% tetap kena) — hanya blok rebuy seller 1 hari; listing ulang bebas |
| Creator self-dealing | 30 hari setelah drop: kreator dilarang beli kartu drop sendiri di secondary |
| Max buyout aktif | 20 kartu/user |

### 2.7 Pricing — Per Tier Kreator
- Harga tidak fixed — tergantung tier kreator:
  - Emerging (100-300k): 20 C-Coin
  - Established (300k-1jt): 30 C-Coin
  - Top (1jt+): 50 C-Coin
  - Hype (viral): 40-60 C-Coin
- Signed variant: unsigned + 20 C-Coin **FLAT** (founder 2026-08-16;
  30 → 50, 20 → 40, 50 → 70). Menggantikan multiplier 1,67× lama.
- Primary = flat price. Numbering premium (#1, lucky numbers)
  hanya di secondary — pasar yang menentukan.
- **Build-time implication**: `drops.price_ccoin` per-drop, bukan
  global constant. Admin UI input harga variabel. Signed price
  auto-calculate dari base.

### 2.8 Creator Analytics — Data Foundation
- Creator dashboard menampilkan: visitor profil, referrer (IG/TikTok),
  demografi anonim, repeat buyer rate, avg spending, cross-creator
  buying, numbering analytics.
- **Build-time implication**: pastikan dari awal:
  - Page view `/c/:username` di-log (tanpa PII, cukup hit counter
    + referrer + geolokasi kota).
  - `wallet_transactions` punya `ref_type` dan `ref_id` yang cukup
    untuk kalkulasi repeat buyer rate.
  - `ownership_history` mencakup `acquired_via` — bedakan primary
    vs secondary buyout vs secondary bid.
  - Data ini dikumpulkan sejak day 1, meski dashboard kreator
    dibangun di Sprint berikutnya. Retrofit data historis mahal.

## 3. Build-Time Implications — Antisipasi Y2+

Hal-hal yang harus diantisipasi sejak Sprint 0 meskipun fiturnya
belum dibangun. Retrofit di Y2+ akan jauh lebih mahal.

### 3.1 Fee Rate — Jangan Hardcode
- Secondary fee normal = 15%, event = 10% (seasonal promo, 4×/tahun).
- **Jangan hardcode 7,5%** di settlement logic.
- Simpan `fee_rate_platform` dan `fee_rate_royalty` di tabel
  `orders` atau `wallet_transactions` sebagai snapshot saat
  transaksi. Fee rate bisa berubah karena event.
- Alternatif: tabel `fee_schedule` (period, rate) yang dirujuk
  settlement logic.

### 3.2 Numbering Economy — Data Model
- `cards.unit_number` wajib di-index, ditampilkan prominent di
  halaman kartu.
- Secondary harus bisa filter/sort by `unit_number` — antisipasi
  dari awal di API query.
- Tidak perlu algoritma pricing untuk numbered — pasar yang
  menentukan. Tapi data historis harga per nomor harus bisa
  ditarik untuk analytics.

### 3.3 Admin Seed — Platform Buy
- Platform mungkin perlu membeli kartu di secondary untuk bootstrap
  likuiditas (seed 1-2 kartu/drop).
- `wallet_transactions.type` perlu nilai `admin_seed` atau
  `platform_buy` — jangan dicatat sebagai `checkout` biasa.
- Admin app perlu mekanisme: admin pilih kartu → beli dengan
  dana platform → kartu masuk inventory platform → bisa di-listing
  dengan label "Listing oleh Platform".

### 3.4 Data Consent — dari Awal
- Monetisasi data (creator analytics detail, market report, API)
  adalah Y2+. Tapi framework consent harus dibangun dari awal.
- `profiles` perlu kolom:
  - `consent_analytics_detail bool default false` — izin kreator
    lihat data per-user (anonim).
  - `consent_data_market bool default false` — izin data agregat
    untuk laporan pasar.
- Jangan retrofit — nanti user harus re-consent, banyak yang
  tidak akan merespons.

### 3.5 Creator Analytics — Log dari Day 1
- Page view kreator, referrer, demografi (kota) — cukup simpan
  sebagai row di tabel `creator_page_views` (cardinalitas rendah,
  Y1 < 10k/hari).
- Jangan pakai Google Analytics — data harus di DB sendiri agar
  bisa di-query untuk insight kreator.
- Struktur minimal:
  ```
  creator_page_views
    id uuid PK
    creator_id uuid FK
    viewed_at timestamptz
    referrer text nullable     -- domain asal
    city text nullable         -- dari IP geolokasi
    user_id uuid FK nullable   -- null = anonymous visitor
  ```

## 4. Operasional Manual (Y1)

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
| Creator recruitment | Manual | SOP 6 langkah: riset -> filter ER -> contact -> deal memo -> onboarding -> drop |
| Secondary market seed | Manual | Admin beli 1-2 kartu/drop untuk listing likuiditas |

## 5. Risiko Teknis yang Diterima

| Risiko | Mitigasi |
|--------|----------|
| Supabase Realtime broadcast < 50 concurrent bidder | Durable Objects tidak dipakai Y1 |
| Admin app lokal mati | VPS + Cloudflare Access (Rp 100-200rb/bln) |
| Web NFC tidak ada di iOS | SUN URL via background tag reading (perlu validasi C-03) |
| NFC chip failure rate > 2% | Multi-vendor, triple test, QR fallback |
| Webhook top-up gagal | Idempotency key + cron reconciliation |

## 6. Yang Belum Final (Butuh Keputusan)

| Item | Deadline | Owner |
|------|----------|-------|
| Threshold KYC akumulasi top-up besar | Sebelum payout pertama | Founder bisnis |
| Cap saldo maksimum (Rp 5-10 juta) | Sebelum top-up live | Founder bisnis |
| Besaran diskon redistribute defect (10-30%) | Sebelum secondary live | Founder produk |

### 6.1 Revised Target Y1
- Drop: 40-65/tahun (bukan 150). Unit: 400-650 kartu (bukan 1.500).
- Quarter: Q1=0 (build), Q2=5-10 (pilot), Q3=15-25, Q4=20-30.
- Konsekuensi: revenue model, COGS, unit economics perlu direvisi.
- Lihat `07_constraints.md` C-14.

### 6.2 Anti-Fraud — Build Bersamaan Secondary
- Jangan tunda anti-fraud ke post-launch. Begitu secondary live,
  insentif fraud langsung aktif.
- Minimum: blok rebuy seller 1 hari + creator self-dealing 30 hari +
  rate limit bid + multiple account detection.

## Sumber

- `01_scope.md` (fitur MVP).
- `05_data_model.md` (invariant I13, I14).
- `07_constraints.md` C-12, C-13, C-14.
- `03_flows.md` (anti-fraud rules updated).
- `02_pages.md` (halaman kreator & kartu — target SEO).
- `07_constraints.md` C-05 (ER quality gate).
- Diskusi user 2026-08-13 (domain final, vault default, min payout).
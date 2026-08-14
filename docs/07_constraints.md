# 07 — Constraints, Gates & Open Items

> Status: [VALIDATED] (C-01/C-02 resolved 2026-08-13)
> Last updated: 2026-08-13
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

### C-05c Level & badge (XP, bukan masa berlaku)
- Level = floor(total_xp / 10). Sumber XP: spend C-Coin
  (1 C-Coin = 1 XP) + xp_reward badge. Top-up tidak menambah.
- Badge: definisi (kriteria + ikon + XP reward) dikonfigurasi
  admin (ADM-07); evaluasi otomatis saat user memenuhi
  kriteria. "exp" = EXPERIENCE, bukan expiry.

### C-05d Privasi profil
- Profil publik (koleksi, level, badge, ranking) default
  tampil; user bisa mengaktifkan **privacy anonymous** untuk
  menyembunyikan.

### C-06 [DEFERRED] Deposit secondary high-value (R6)
- Hold deposit untuk bid/buyout high-value di-defer sampai
  secondary live & ada data volume. Tidak di-build di MVP.
  Keputusan: hold C-Coin jika diimplementasi nanti.

### C-07 [DRAFT] Secondary = Marketplace + Browse (tanpa auction)
- Marketplace: owner pasang buyout price. Browse: bid langsung
  di kartu walau tanpa harga (owner **accept only — TANPA
  reject**; bidder bisa cancel; bid TIDAK ada expire). TIDAK ada
  auction timer/anti-sniping/deposit timebox di MVP.

### C-08 [VALIDATED 2026-08-13] Cap saldo maksimum
- Lawyer mengonfirmasi cap saldo sebagai faktor mitigasi yang
  valid. Usulan awal Rp 5-10 juta (setara 500-1.000 C-Coin)
  wajar untuk skala Y1.
- **Action**: finalisasi threshold sebelum launch. Implementasi
  di wallet engine: batasi saldo maksimum per user, tolak top-up
  yang melampaui cap.

### C-09 [DRAFT] Detail payout
- Minimum payout, verifikasi rekening, SLA, mekanisme
  disbursement final, perlakuan pajak — belum di-lock.
  Payout teknis tetap dibangun dengan default yang wajar.

### C-09b [FINAL] Minimum payout
- Minimum payout: **10 C-Coin (Rp 100.000)**. Saldo seller/kreator
  menumpuk sampai threshold terpenuhi. Payout fee 1% tetap
  dipotong dari total.

### C-10 [FINAL] Vault = DEFAULT, kirim fisik = OPSIONAL
- **Primary**: checkout DEFAULT simpan di inventory (vault) —
  kartu ter-bind virtual, fisik dipegang platform, tanpa ongkir/
  tracking. OPSIONAL kirim fisik sekarang (isi alamat + ongkir
  C-Coin). Ship-from-vault: owner bisa minta kirim kapan saja
  setelah order settled (bayar ongkir saat itu).
- **Secondary**: kartu tetap di vault, ownership pindah di ledger.
  Buyer bisa minta seller kirim fisik (ongkir C-Coin + tracking)
  ATAU biarkan tetap di vault — ship-out kapan saja.
- `orders.delivery_option enum('shipping','vault')` — vault default.
- `cards.location enum('platform_stock','with_owner',
  'platform_vault')`, `shipments` table (type: primary/
  secondary/vault_shipout).
- **Rekomendasi lawyer (2026-08-13)**: vault-first memperkuat
  posisi "Gamified Point Redemption" — barang tidak berpindah
  fisik, hanya ledger. Juga menghindari fraud pengiriman antar-
  user.

### C-11 [FINAL] Nominal C-Coin integer ≥ 1
- Semua nominal C-Coin (harga, buyout, bid, ongkir, top-up,
  fee) WAJIB **integer minimal 1**, tanpa desimal (1,5 / 0,5
  dilarang). Kolom sudah `int` (`CHECK x >= 1`);
  konversi IDR → C-Coin dibulatkan ke atas (ceiling).

### C-12 [FINAL] Wash trading cooling period 14 hari
- Kartu yang baru dibeli tidak bisa di-listing ulang di secondary
  sebelum 14 hari. Berlaku untuk seller yang sama (current_owner).
  Menggantikan aturan 7 hari sebelumnya.

### C-13 [FINAL] Creator self-dealing dilarang 30 hari
- Kreator (dan akun terafiliasi yang terdeteksi) dilarang membeli
  kartu drop mereka sendiri di secondary untuk 30 hari pertama
  setelah drop. Pelanggaran: suspend 14 hari + hold payout 30 hari.

### C-14 [DRAFT] Target Y1 realistis
- Drop: 40-65/tahun (bukan 150). Unit: 400-650 kartu (bukan 1.500).
- Quarter: Q1=0 (build), Q2=5-10 (pilot), Q3=15-25, Q4=20-30.
- Konsekuensi: revenue model, COGS, dan unit economics perlu
  direvisi dengan volume realistis ini.

## 4. Batasan Teknis yang Diterima

| # | Batasan | Konsekuensi |
|---|---------|-------------|
| T-1 | Supabase Realtime broadcast < 50 concurrent bidder | Durable Objects tidak dipakai Y1 |
| T-2 | CF Workers free tier + Supabase cukup Y1 (margin 5-10x) | Upgrade ~Rp 500rb/bln worst case |
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
| C-Coin bukan e-money; "Gamified Point Redemption" (bukan lelang); KYC cash-only | FINAL (2026-08-13, validasi lawyer) |
| Threshold kreator 100rb+ combined | FINAL (2026-08-12) |
| Onboarding off-platform tanpa approval in-platform | FINAL (2026-08-12) |
| Admin app terpisah, tidak di edge | FINAL (2026-08-12) |
| Secondary = Marketplace + Browse (bukan auction) | FINAL (2026-08-12) |
| Tidak ada halaman verifikasi terpisah (melekat di halaman kartu) | FINAL (2026-08-12) |
| Primary = platform-produced SAJA (70/30), kreator-produced defer | FINAL (2026-08-12) |
| Leaderboard punya halaman sendiri (PG-LB-01) | FINAL (2026-08-12) |
| Top-up di area user; **bisa diterima setelah T&C final + cap saldo** (Q026 resolved 2026-08-13) | FINAL (2026-08-13) |
| KYC trigger: payout/disbursement ke IDR + akumulasi top-up besar (TIDAK untuk pasang buyout/accept bid) | FINAL (2026-08-13, validasi lawyer) |
| Profil publik + privacy anonymous | FINAL (2026-08-12) |
| Level = via XP (spend 1 C-Coin = 1 XP; 10 XP = 1 level; badge +XP) | FINAL (2026-08-12) |
| Badge admin-configurable (kriteria + ikon + XP reward), ADM-07 | FINAL (2026-08-12) |
| Bid flow: tanpa reject; bidder cancel; outbid release C-Coin; history 90 hari (complete selamanya) | FINAL (2026-08-12) |
| Domain: `c-verse.co` primary, `c-verse.id` redirect — LOCK sebelum provisioning NFC | FINAL (2026-08-13) |
| Halaman kreator PUBLIK `/c/:username` (list drop); profil kolektor `/u/:username` + privacy anonymous | FINAL (2026-08-12) |
| Revenue split 70/30 primary + 7,5/7,5/85 secondary | FINAL (2026-08-04) |
| Tech stack full-edge | FINAL (2026-08-11) |
| Form factor kartu 63x88mm + holo + signed 1:10 | FINAL |
| Pengiriman = pilihan (kirim fisik vs simpan di inventory; ongkir C-Coin) | FINAL (2026-08-12) |
| Secondary: buyer pilih kirim ke alamat ATAU kirim/rawat di platform; ship-from-vault kapan saja (ongkir C-Coin) | FINAL (2026-08-12) |
| Semua nominal C-Coin integer ≥ 1 (tanpa desimal) | FINAL (2026-08-12) |
| Chip NTAG 424 DNA TagTamper | FINAL (2026-08-03) |

## Sumber

- `90_research/14_legal_consultation_brief.md` (Sesi A-D).
- `40_operations/02_legal_compliance.md` (2,2 C-Coin — status [VALIDATED]).
- `90_research/18_nfc_decision.md` (N5, N5b).
- `90_research/open_questions_tracker.csv` (Q027-Q030,
  R6, O1-O7).
- `00_foundation/05_assumptions.md` (A015 status hukum
  C-Coin — confidence HIGH, tervalidasi lawyer).
- Diskusi founder 2026-08-12.
- Validasi lawyer fintech 2026-08-13.
# 07 — Constraints, Gates & Open Items

> Status: [DRAFT]
> Last updated: 2026-08-12
> Dok ini menjawab: **apa yang TIDAK boleh dibangun / di-live**
> dulu, dan apa yang masih menunggu keputusan.

## 1. Legal — C-Coin (BLOCKER UTAMA)

### C-01 [GO-LIVE GATE] Status hukum C-Coin Opsi A (Q026)
- Struktur: saldo buyer closed-loop TANPA withdraw; hasil
  seller/kreator auto-disburse IDR (payout fee 1%); refund
  hanya ke metode pembayaran asal untuk pembatalan spesifik.
- Pertanyaan inti ke lawyer fintech (Sesi A di
  `legal-consultation-brief.md`):
  1. Apakah closed-loop tanpa redemption = uang elektronik
     (PBI 20/2018, PBI 24/2023) atau pengecualian voucher/poin?
  2. Apakah refund-to-source = reversal aman atau redemption
     yang merusak status closed-loop?
  3. Apakah escrow sebagai hold state ledger cukup dengan T&C,
     atau wajib pemisahan dana?
- **BUKAN bloker build**: semua fitur (wallet, ledger, top-up,
  payout) DI-BANGUN penuh. Q026 hanya **gate GO-LIVE** —
  tidak menerima top-up uang riil sebelum A1-A3 terjawab.
- Fallback: Opsi B (wallet-as-a-service issuer berizin) — tidak
  di-build dulu.

### C-02 [GO-LIVE GATE] Escrow design (gap G9)
- Flow 1/3/7 menahan dana di escrow → mekanisme teknis TIDAK
  di-lock sampai C-01 clear. Build status `escrow_status` di
  ledger penuh; jangan live sampai Q026 clear.

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

### C-05b KYC trigger (bukan transaksi > Rp 1 juta)
- KYC aktif saat: (1) top-up kumulatif > 99 C-Coin, (2) pasang
  buyout price, (3) menerima (accept) bid.

### C-05e Flow bid (keputusan 2026-08-12)
- TANPA reject — owner hanya accept (current active) atau diam.
- Bidder bisa cancel bidnya sendiri → C-Coin release.
- Bid lebih tinggi → bid lama `outbid`, C-Coin balik otomatis
  ke bidder lama.
- History bid per kartu: 90 hari terakhir; bid `accepted` (complete)
  permanen selamanya.

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

### C-06 [DRAFT] Deposit 5% untuk secondary high-value (R6)
- Mekanisme hold deposit untuk bid/buyout berisiko tinggi
  (mis. > Rp 5 juta) belum ada desainnya. Kandidat: hold
  C-Coin. Defer sampai secondary live & ada data volume.

### C-07 [DRAFT] Secondary = Marketplace + Browse (tanpa auction)
- Marketplace: owner pasang buyout price. Browse: bid langsung
  di kartu walau tanpa harga (owner **accept only — TANPA
  reject**; bidder bisa cancel; bid TIDAK ada expire). TIDAK ada
  auction timer/anti-sniping/deposit timebox di MVP.

### C-08 [DRAFT] Cap saldo maksimum
- Usulan awal Rp 5-10 juta — JANGAN di-lock sebelum jawaban
  lawyer (C-01) + validasi demand.

### C-09 [DRAFT] Detail payout
- Minimum payout, verifikasi rekening, SLA, mekanisme
  disbursement final, perlakuan pajak — belum di-lock.
  Payout teknis tetap dibangun dengan default yang wajar.

### C-10 [FINAL] Pengiriman = PILIHAN (bukan keharusan)
- Checkout punya 2 opsi (keputusan user 2026-08-12):
  - **Kirim fisik** (shipping): isi alamat, bayar **biaya
    pengiriman dalam C-Coin**, tracking/no resi aktif.
    Status: `paid → qc → shipped → delivered → settled`.
  - **Simpan di inventory** (vault): TANPA alamat/ongkir/
    tracking; kartu ter-bind virtual ke koleksi, fisik dipegang
    platform. Status: `paid → qc → settled`.
- **Berlaku juga di secondary** (keputusan user 2026-08-12):
  buyer hasil buyout/bid accept memilih tujuannya — kirim ke
  alamat OR **kirim/rawat di platform** (platform vault +
  verifikasi ulang NFC/QC ringan, tanpa ongkir).
- **Ship-from-vault**: kartu lokasi `platform_vault` bisa
  dikirim ke alamat owner kapan saja (`shipments` type
  `vault_shipout`, ongkir C-Coin).
- `orders.delivery_option enum('shipping','vault')`,
  `cards.location enum('platform_stock','with_owner',
  'platform_vault')`, `shipments` table (type: primary/
  secondary/vault_shipout).

### C-11 [FINAL] Nominal C-Coin integer ≥ 1
- Semua nominal C-Coin (harga, buyout, bid, ongkir, top-up,
  fee) WAJIB **integer minimal 1**, tanpa desimal (1,5 / 0,5
  dilarang). Kolom sudah `int` (`CHECK x >= 1`);
  konversi IDR → C-Coin dibulatkan ke atas (ceiling).

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
| O-1..O-7 | Tech open items (lihat `06-tech-decisions.md` section 3) | Tidak |
| Q026 | Status hukum C-Coin | Ya (gate top-up) |
| R6 | Desain deposit secondary | Tidak (post-launch secondary) |
| F2 | Acrylic case: magnet vs screw | Tidak (ops, tunggu RFQ vendor) |
| Q016 | PWA vs native | Tidak (PWA untuk MVP, sudah final) |

## 6. Matriks Keputusan yang DILARANG Dibalik

| Keputusan | Status |
|-----------|--------|
| C-Coin medium tunggal, rate Rp 10.000 | FINAL (2026-08-11) |
| Opsi A closed-loop tanpa withdraw buyer | FINAL (2026-08-11) |
| Threshold kreator 100rb+ combined | FINAL (2026-08-12) |
| Onboarding off-platform tanpa approval in-platform | FINAL (2026-08-12) |
| Admin app terpisah, tidak di edge | FINAL (2026-08-12) |
| Secondary = Marketplace + Browse (bukan auction) | FINAL (2026-08-12) |
| Tidak ada halaman verifikasi terpisah (melekat di halaman kartu) | FINAL (2026-08-12) |
| Primary = platform-produced SAJA (70/30), kreator-produced defer | FINAL (2026-08-12) |
| Leaderboard punya halaman sendiri (PG-LB-01) | FINAL (2026-08-12) |
| Top-up di area user; TANPA bloker build (Q026 = gate go-live) | FINAL (2026-08-12) |
| KYC trigger: top-up kumulatif > 99 C-Coin / pasang buyout / terima bid | FINAL (2026-08-12) |
| Profil publik + privacy anonymous | FINAL (2026-08-12) |
| Level = via XP (spend 1 C-Coin = 1 XP; 10 XP = 1 level; badge +XP) | FINAL (2026-08-12) |
| Badge admin-configurable (kriteria + ikon + XP reward), ADM-07 | FINAL (2026-08-12) |
| Bid flow: tanpa reject; bidder cancel; outbid release C-Coin; history 90 hari (complete selamanya) | FINAL (2026-08-12) |
| Domain: primary **kemungkinan** `c-verse.co`; `c-verse.id` redirect — LOCK sebelum provisioning NFC | DRAFT (2026-08-12) |
| Halaman kreator PUBLIK `/c/:username` (list drop); profil kolektor `/u/:username` + privacy anonymous | FINAL (2026-08-12) |
| Revenue split 70/30 primary + 7,5/7,5/85 secondary | FINAL (2026-08-04) |
| Tech stack full-edge | FINAL (2026-08-11) |
| Form factor kartu 63x88mm + holo + signed 1:10 | FINAL |
| Pengiriman = pilihan (kirim fisik vs simpan di inventory; ongkir C-Coin) | FINAL (2026-08-12) |
| Secondary: buyer pilih kirim ke alamat ATAU kirim/rawat di platform; ship-from-vault kapan saja (ongkir C-Coin) | FINAL (2026-08-12) |
| Semua nominal C-Coin integer ≥ 1 (tanpa desimal) | FINAL (2026-08-12) |
| Chip NTAG 424 DNA TagTamper | FINAL (2026-08-03) |

## Sumber

- `90_research/legal-consultation-brief.md` (Sesi A-D).
- `40_operations/02_legal_compliance.md` (2,2 C-Coin; gap G9).
- `90_research/nfc-decision-ntag-424-dna.md` (N5, N5b).
- `90_research/open_questions_tracker.csv` (Q026, Q027-Q030,
  R6, O1-O7).
- `00_foundation/05_assumptions.md` (A015 status hukum
  C-Coin — confidence LOW).
- Diskusi founder 2026-08-12.
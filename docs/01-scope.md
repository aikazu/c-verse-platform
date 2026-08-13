# 01 — Scope MVP C.Card

> Status: [DRAFT]
> Last updated: 2026-08-12

## 1. Definisi MVP

**C.Card** = platform kartu kolaborasi edisi terbatas untuk
kreator Indonesia (100 ribu+ followers combined). Kartu fisik
63x88mm, holo, acrylic hardcase, chip NTAG 424 DNA TagTamper
sebagai provenance, sertifikat digital via tap NFC.

Mekanisme inti yang WAJIB jalan di MVP:
1. **Primary sale (Drop)**: drop time-boxed, harga fixed, "siapa
   cepat dia dapat". **Platform-produced SAJA** (70/30) — tidak
   ada kreator-produced di MVP.
2. **Provenance**: tap NFC / scan QR di dus → langsung ke
   halaman kartu (3D dari tap, info dari QR) — sertifikat
   melekat di halaman kartu, TIDAK ada halaman verifikasi
   terpisah dan TIDAK ada input serial manual.
3. **Secondary (Marketplace + Browse)**: Marketplace = kartu
   dengan buyout price yang dipasang owner; Browse = cari kartu
   + bid langsung walau owner tidak pasang harga (1 bid active
   tertinggi/kartu; bid lebih tinggi meng-outbid yang lama &
   C-Coin balik; bidder bisa cancel; owner accept only — TANPA
   reject).
4. **C-Coin**: medium tunggal semua transaksi (1 C-Coin =
   Rp 10.000; top-up gated by legal, lihat `07-constraints.md`).
5. **Leaderboard**: halaman peringkat kolektor (F019).
6. **Admin/ops**: founder menjalankan operasi tanpa sentuh
   database.

Non-goals MVP (eksplisit): mobile native, B2B portal, web3,
multi-currency, voting komunitas, subscription kreator, AR,
loyalty (semua post-MVP).

## 2. Fitur Final (MoSCoW + RICE)

### MUST — Blok 1 (11 fitur)

| ID | Fitur | RICE | Catatan |
|----|-------|------|---------|
| F001 | Registrasi (Google OAuth + email OTP) — **email OTP wajib captcha anti-spam** | 240 | Supabase Auth |
| F002 | Onboarding & kurasi kreator | 80 | **Off-platform**: ops input data kreator hasil rekrutan manual. TIDAK ada form aplikasi publik |
| F003 | Upload artwork + narasi | 60 | Ops/designer upload atas nama kreator (artwork sudah di-approve off-platform) |
| F004 | Drop scheduling & listing | 200 | Admin bikin drop; publik lihat di catalog |
| F005 | Checkout "siapa cepat" | 250 | Race condition, limit 1 kartu/user, potong saldo C-Coin; **opsi pengiriman: kirim fisik (ongkir C-Coin) ATAU simpan di inventory (tanpa kirim)** |
| F006 | Payment gateway top-up + disbursement | 200 | Midtrans/Xendit. **Build penuh; go-live terima uang riil menunggu Q026** |
| F036 | Wallet C-Coin: saldo closed-loop, ledger immutable, payout fee 1% | 200 | Tanpa withdraw buyer; seller/kreator auto-disburse IDR |
| F007 | NFC NTAG 424 tap & verify | 180 | CMAC server-side; fallback QR di dus |
| F008 | Sertifikat digital + 3D viewer | 180 | **Cut line #1** — bisa turun ke sertifikat statis |
| F009 | Order tracking | 120 | Status order + no resi |
| F010 | Notifikasi push/email | 100 | Email abstraction layer + FCM |

### SHOULD — Blok 2 (10 fitur)

| ID | Fitur | RICE | Catatan |
|----|-------|------|---------|
| F011 | Secondary: Marketplace (buyout) + Browse (bid langsung di kartu) | 180 | Marketplace = owner pasang buyout price; Browse = cari + bid walau tanpa harga. **Pilihan kirim**: ke alamat buyer ATAU kirim/rawat di platform (vault) |
| F012 | Bid flow: active 1 tertinggi/kartu; outbid & cancel release C-Coin; owner accept only (tanpa reject) | 150 | Bidder bisa cancel; bid lebih tinggi invalidate bid lama |
| F013 | Notifikasi bid & buyout (anti-snipe manual) | 80 | Notif ke owner saat bid masuk; ke buyer saat buyout terambil |
| F014 | KYC | 60 | **Trigger**: top-up kumulatif > 99 C-Coin, pasang buyout, atau mau terima bid. Verifikasi manual Y1 |
| F015 | Profile & collection view | 100 | Koleksi user + ownership history; **profil bisa publik** (koleksi, level, badge, ranking) kecuali privacy anonymous aktif |
| F016 | Creator dashboard (analitik) | 70 | Traffic + pendapatan only (bukan admin) |
| F017 | Gamifikasi: level | 80 | **Naik via XP**: spend 1 C-Coin = 1 XP; 10 XP = 1 level (top-up TIDAK menambah XP) |
| F018 | Gamifikasi: badge | 80 | **Kriteria + logo/ikon + XP reward dikonfigurasi di admin page** (ADM-07); XP badge berkontribusi naik level (bukan masa berlaku) |
| F019 | Leaderboard | 50 | **Halaman sendiri** (PG-LB-01) — tetap Should |
| F020 | Dispute resolution | 60 | MVP: manual (email/WA) + status di admin |

### COULD — Blok 3 (7 fitur)

| ID | Fitur | RICE | Status default |
|----|-------|------|----------------|
| F021 | Multi-language (EN) | 40 | Defer kecuali bandwidth |
| F022 | Resale price history chart | 50 | Defer |
| F023 | Creator collab tool | 30 | Defer |
| F024 | Custom packaging | 30 | Defer |
| F025 | Gift flow | 25 | Defer |
| F026 | In-app chat | 30 | Defer |
| F027 | Push personalisasi | 25 | Defer |

### NEW — Admin/Ops Dashboard (app terpisah, 9 fitur)

> Admin dashboard = **app terpisah** (bukan di edge), akses
> langsung ke Supabase via service-role key. Tidak ada route
> admin di API publik. Detail: `06-tech-decisions.md`.

| ID | Fitur | Deskripsi |
|----|-------|-----------|
| ADM-01 | Kelola kreator | CRUD data kreator hasil rekrutan off-platform (bukan approval). Set status akun, payment info, threshold terpenuhi |
| ADM-02 | Kelola drop | Buat drop (artwork final yang sudah di-approve off-platform, harga, unit, waktu), schedule, publish, tutup drop |
| ADM-03 | Kelola order & fulfillment | Lihat semua order, update status (paid → QC → shipped → delivered), handle return, input no resi |
| ADM-04 | NFC provisioning & QC | Register batch tag (assign UUID↔UID), konfigurasi NDEF/SDM, catat hasil QC + defect |
| ADM-05 | Payout & rekonsiliasi | Lihat escrow/settlement, trigger payout batch (H+1, fee 1%, withholding), rekonsiliasi top-up vs ledger harian |
| ADM-06 | Dispute resolution | Lihat dispute, mediasi, keputusan (refund / strike / suspend) |
| ADM-07 | Kelola badge (definisi) | CRUD definisi badge: kriteria (mis. koleksi N C.Card, punya C.Card kreator A/B), logo/ikon, **XP reward** (experience untuk naik level) |
| ADM-08 | Audit log admin | Catat SEMUA aksi admin (siapa, aksi, target, payload ringkas, IP/session, waktu) — **append-only, tidak bisa edit/hapus**; view + filter di admin app |
| ADM-09 | 2FA admin | Supabase MFA **TOTP wajib** untuk SEMUA akun admin: enrollment (scan QR + recovery codes) saat pertama login, lalu challenge TOTP tiap login sebelum UI privileged terbuka (sesi aal2) |

### WON'T (this release)

F028 B2B portal, F029 native app, F030 web3 wallet, F031
multi-currency, F032 voting komunitas, F033 subscription,
F034 AR, F035 loyalty.

## 3. Cut Lines (Urutan Pangkas Saat Timeline Mepet)

> Prinsip: **semua fitur di scope dibangun** (tidak ada blocker
> legal untuk build). Cut lines hanya mekanisme darurat jika
> timeline molor — bukan keputusan scope default.

1. **F008 3D viewer** → sertifikat statis 2D (tetap verified,
   hanya kehilangan wow factor). Hemat ~4-5 PW.
2. **F012 bid/accept** → hanya buyout dulu (Marketplace tanpa
   bid di Browse). Hemat ~2 PW.
3. **F008 + F012 digabung** = MVP tetap launchable dengan
   primary sale + verifikasi di halaman kartu + buyout.

Titik NOL (tidak bisa dipangkas tanpa mengganti definisi MVP):
F001-F007, F009-F011, F013-F019, F036, ADM-01..09.

## 4. Definition of Done (Release MVP)

- [ ] Primary drop: beli → bayar (C-Coin) → escrow → kirim →
      delivered → release, jalan end-to-end.
- [ ] Verify: tap NFC → LANGSUNG halaman 3D kartu (CMAC
      verified); QR di dus → halaman info kartu (Registered).
      TIDAK ada halaman verifikasi terpisah, TIDAK ada input
      serial manual.
- [ ] Secondary: Marketplace (buyout price) + Browse (bid
      langsung di kartu, owner accept) jalan.
- [ ] KYC: trigger top-up kumulatif > 99 C-Coin / pasang buyout
      / terima bid.
- [ ] Level naik via XP (spend 1 C-Coin = 1 XP, 10 XP = 1
      level); badge (kriteria + ikon + XP reward) dikonfigurasi
      di admin page.
- [ ] Profil publik tampil (koleksi, level, badge, ranking)
      kecuali privacy anonymous aktif.
- [ ] Admin: ADM-01..07 bisa menjalankan operasi tanpa DB
      manual.
- [ ] Top-up & wallet dibangun penuh (ledger immutable);
      **go-live terima uang riil menunggu Q026** (bukan bloker
      build).
- [ ] Unit test coverage > 70%, critical path integration
      tested, QA 3 device, security review fitur data sensitif.

## 5. Estimasi Effort

| Area | Effort (PW) |
|------|-------------|
| Blok 1 (11 fitur) | 30-32 (+4-5 F008, +2-3 F036) |
| Blok 2 (10 fitur) | 16 |
| Blok 3 (7 fitur) | 6 |
| Admin (ADM-01..09) | 8-10 (termasuk badge definition, audit log, 2FA) |
| **Total** | **60-65** |

Dengan tim 1-2 developer + AI-assisted: **6-8 bulan** (bukan
5 bulan — jujur, bukan asumsi optimistik). Cut lines di
section 3 adalah mekanisme kontrolnya.

## Sumber

- `20_product/03_features_mvp.md` (gaya RICE/MoSCoW, fitur
  F001-F036).
- `40_operations/05_mvp_flow.md` (Flow 1-9).
- `40_operations/03_operations_playbook.md` (SOP 1-6 → dasar
  fitur ADM-01..06).
- Diskusi founder 2026-08-12: admin terpisah, tanpa approval
  onboarding, threshold 100rb+ combined.
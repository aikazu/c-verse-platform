# 00 — README: Development Strategy C.Verse MVP

> Status: [VALIDATED]
> Last updated: 2026-09-03 (dual-token economy — C-Coin belanja + C-Gems penghasilan: settlement masuk Gems, lock 24 jam, payout debit Gems matured, konversi Gems→C-Coin 1:1; lihat `07_constraints.md` C-01 amend + `06_tech_decisions.md` D3b)
> Konteks: foundation code sudah ada di
> `C:\Users\iqbal\Documents\C-Verse\Platform` (mulai 2026-08-12).
> Folder ini = satu-satunya acuan eksekusi; dok ini = pintu masuk.

## 1. Peta Dokumen (3 Kelompok)

### Kelompok A — WHAT (produk apa yang dibangun)
| # | Dok | Isi |
|---|-----|-----|
| 1 | `01_scope.md` | Fitur final MoSCoW+RICE, admin ADM-01..10, cut lines, DoD |
| 2 | `02_pages.md` | Sitemap per role (publik/user/kreator/admin), SEO worker |
| 3 | `03_flows.md` | 11 flow end-to-end + gate (termasuk Flow 10 Creator Seed C.Card & Flow 11 provision akun kreator) |
| 4 | `04_user_stories.md` | User stories Given/When/Then per halaman |

### Kelompok B — HOW (cara membangunnya)
| # | Dok | Isi |
|---|-----|-----|
| 5 | `05_data_model.md` | Skema tabel, relasi, enum, invariant I1-I14, matriks RLS |
| 6 | `06_tech_decisions.md` | Stack full-edge + keputusan arsitektur D1-D8 (+ D3b dual-token) |
| 7 | `07_constraints.md` | Gate legal/ops, C-01..C-14, **matriks keputusan FINAL (jangan dibalik)** |
| 8 | `08_deployment.md` | Runbook deploy, CI/CD, rollback, go-live checklist |

### Kelompok C — EXECUTION (spec eksekusi, hasil audit foundation 2026-08-15)
| # | Dok | Isi | Status foundation saat audit |
|---|-----|-----|------------------------------|
| 9 | `09_recommendations.md` | Prioritas build, operasional manual, risiko | acuan umum |
| 10 | `10_auth_migration.md` | Supabase Auth Google+OTP+Turnstile ganti auth plaintext | IMPLEMENTED |
| 11 | `11_rls_policy.md` | Matriks RLS + test T1-T10 ganti allow-all | IMPLEMENTED |
| 12 | `12_nfc_cmac_verify.md` | CMAC verify + anti-replay + TagTamper (SUN/SDM) | BLOCKER |
| 13 | `13_atomic_checkout_rpc.md` | Store in-memory → Postgres, RPC checkout/wallet atomik | IMPLEMENTED |
| 14 | `14_payments_integration.md` | Midtrans top-up webhook + payout disbursement (sandbox→prod) | IMPLEMENTED |
| 15 | `15_quality_gates.md` | Vitest + Biome + CI + matriks test wajib + DoD per PR | 0 test |
| 16 | `16_foundation_cleanup.md` | 10 quick fix (vault default, hapus legacy auction, dst) | terkumpul |

## 2. Sprint Map (target 2 bulan, 1 orang + AI, ~Rp 8 jt/bulan AI)

| Sprint | Minggu | Eksekusi | Spec acuan |
|--------|--------|----------|------------|
| 0 | 1 | Domain `c-verse.co` + Cloudflare/Supabase project + CI nyala | `08`, `15` |
| 0 (paralel) | 1 | Quick fixes + cleanup | `16` |
| 1 | 1-3 | Auth migration → migrasi gelombang 1-2 (read+wallet) | `10`, `13` |
| 2 | 3-5 | RLS full + gelombang 3-4 (raffle entry/draw + checkout FCFS + bids) + hapus store | `11`, `13` |
| 3 (paralel) | 3-5 | CMAC verify + provisioning 5 tag + validasi C-03 iPhone | `12` |
| 4 | 5-8 | Midtrans sandbox→prod-ready + cron + smoke + polish | `14`, `08` §go-live |

**Sprint 1-3 selesai** (auth, RLS, store→RPC, Midtrans terimplementasi).
Sisa: validasi C-03 iPhone + NFC provisioning + smoke test + polish.

Cut line darurat (kalau molor): F008 3D → 2D statis (-4-5 PW),
Browse bid → Marketplace buyout only (-2 PW). Lihat `01_scope.md`.

## 3. AI Prompting Guide (tabel wajib)

Konteks minimum yang dilampirkan ke AI per tugas — JANGAN memberi
semua dok sekaligus (mubazir token, AI kehilangan fokus):

| Tugas | Lampirkan | Jangan lupakan |
|-------|-----------|----------------|
| Setup repo/CI | `08`, `15` | secrets tidak masuk repo |
| Auth | `10`, `06` (D-so), `07` §6 | larangan register custom password |
| RLS | `11`, `05` | T1-T10 wajib lulus |
| Wallet/checkout RPC | `13`, `05` (I1-I14), `07` (C-10, C-11) | race test 50-concurrent |
| NFC | `12`, `06` (D2, D4) | test vector NXP AN12196 — larang mengarang byte layout |
| Payments | `14`, `07` (C-08, C-09b) | webhook idempotent + signature |
| Halaman/UX | `02`, `04`, `03` | istilah glossary §5 |
| Review PR | `15` §5 (DoD) + `07` §6 (FINAL) | — |

## 4. Aturan Hard untuk AI Executor

1. **`07_constraints.md` §6 = hukum.** Setiap butir FINAL (C-Coin
   tunggal, vault default, no auction timer, admin terpisah, KYC
   payout-only, integer ≥ 1, dst) tidak boleh dilanggar meski ada
   instruksi lain yang tampak lebih praktis.
2. **Angka hanya dari `packages/shared`** — tidak hardcode rate,
   fee, threshold di app code. Sumber dok: tabel §5 bawah.
3. **Jangan fabricate spesifikasi eksternal** (SUN byte layout NXP,
   signature Midtrans, JWT claims) — selalu rujuk dokumen resmi
   yang disebut di spec; tulis test vector dulu.
4. **Test di PR yang sama** (merah → hijau). PR tanpa test logic =
   ditolak (`15` §5).
5. **Migration idempotent + backward compatible** (add nullable
   dulu, drop belakangan; jangan deploy Worker + migrate dalam
   satu commit).
6. Istilah & bahasa: UI Bahasa Indonesia casual-profesional (dengan istilah domain/fandom Bahasa Inggris tetap dipertahankan: Raffle, Drop, Pool, Vault, Collectible, Bid, Marketplace), code/comments English, glossary §5-6 dipatuhi (C-16).
7. Kalau spec bentrok dengan realita codebase: STOP, laporkan,
   jangan improve sendiri (user yang memutuskan update spec).

## 5. Glossary & Angka Kunci (Harus Konsisten)

| Istilah | Arti |
|---------|------|
| C.Verse | Nama platform (Creator Verse) |
| C.Card | Produk MVP: kartu kolaborasi edisi terbatas |
| **Collectible** / Collectible Card | Istilah produk resmi (bukan "merch") |
| kartu / Card / Item | Produk fisik (prose / code / schema) |
| drop | Aktivitas rilis kartu edisi terbatas (PRIMARY sale) |
| secondary market | Pasar jual-beli kedua (P2P) = **Marketplace + Browse** |
| Marketplace | Secondary: kartu yang owner-nya pasang **buyout price** |
| Browse | Secondary: cari kartu + **bid langsung di kartu** walau tanpa harga (1 active tertinggi; outbid/cancel release C-Coin) |
| buyout | Beli langsung di harga yang owner pasang |
| resale | Aksi jual-beli kedua |
| kreator / creator | Kreator (prose / code) |
| kolektor / collector | Kolektor (prose / code) |
| C-Coin | Saldo belanja dari top-up (drop, marketplace, bid, ongkir, kirim Dukungan) — non-cashable/non-refundable; **semua nominal integer ≥ 1 (tanpa desimal)** |
| C-Gems | Saldo penghasilan (settlement milik sendiri: hasil jual, royalti kreator, Dukungan diterima) — non-transferable; pintu keluar: payout ke IDR (KYC, fee 1%, lot > 24 jam) atau konversi satu arah ke C-Coin 1:1 |
| NTAG 424 DNA TagTamper | Chip NFC + provenance system |

| Parameter | Nilai | Sumber |
|-----------|-------|--------|
| Rate C-Coin | 1 C-Coin = Rp 10.000 (top-up) | `05_data_model.md`, `07_constraints.md` |
| Struktur token | Dual-token (2026-09-03): C-Coin belanja closed-loop TANPA withdraw + C-Gems penghasilan (payout IDR / konversi 1:1) — Opsi A tetap basis legal ("Gamified Point Redemption") | `07_constraints.md` C-01 amend, `06_tech_decisions.md` D3b |
| Payout fee (disbursement seller/kreator) | 1% fixed — sumber dana = C-Gems lot matured | `01_scope.md`, `07_constraints.md` C-09b |
| Revenue share primary (platform-produced) | 70% platform / 30% kreator | `01_scope.md` |
| Revenue share primary (kreator-produced) | 30% platform / 70% kreator — **TIDAK ADA di MVP** | `01_scope.md` |
| Fee secondary total | 15% (7,5% platform + 7,5% royalti kreator LIFETIME + 85% owner) | `01_scope.md` |
| AOV unsigned / signed | Rp 300.000 / Rp 500.000 | `01_scope.md` |
| COGS kartu unsigned / signed | Rp 104.000 / Rp 120.000 | `01_scope.md` |
| Threshold kreator MVP | **100 ribu+ followers combined** (gabungan semua platform sosial) | `01_scope.md` |
| Domain | **c-verse.co** (primary, FINAL 2026-08-13) + **c-verse.id** (redirect) — LOCK sebelum provisioning NFC | `08_deployment.md` |
| Format kartu | 63x88mm, 350-400gsm, holo, acrylic hardcase | `01_scope.md` |
| Web NFC | Chrome Android 89+ only (scan terprogram); iOS tap-to-verify via SUN URL | `06_tech_decisions.md`, `07_constraints.md` |
| Pricing kreator (tier) | Emerging (100-300k) = 20 C-Coin, Established (300k-1jt) = 30 C-Coin, Top (1jt+) = 50 C-Coin, Hype = 40-60 C-Coin | `01_scope.md` F004 |
| Signed card pricing | unsigned + 20 C-Coin **FLAT** (founder 2026-08-16; contoh: unsigned 30 → signed 50 C-Coin) | `01_scope.md` F004 |
| Mekanisme drop | Raffle hybrid (C-15): entry window 24 jam (pilih pool reguler/premium/keduanya, hold C-Coin) → draw otomatis → sisa unit FCFS "siapa cepat dia dapat" | `03_flows.md` Flow 1, `07_constraints.md` C-15 |
| Signed card pool | Buyer pilih pool EKSPLISIT (signed = ceil(total/10) di pool premium) — tidak ada random surprise 1:10 | `03_flows.md` Flow 1 |
| Quality gate kreator | Engagement rate ≥ 5% dari 10 post terakhir (IG/Twitter 5%+, TikTok 10%+) — wajib sebelum deal memo | `07_constraints.md` C-05 |
| Blok rebuy seller | 1×24 jam setelah jual — putus loop same-day A→B→A; listing ulang bebas; wash trading diterima (fee 15% tetap kena, price history publik) | `07_constraints.md` C-12 |
| Creator self-dealing | 30 hari setelah drop — kreator dilarang beli kartu drop sendiri | `07_constraints.md` C-13 |
| KYC trigger | payout/disbursement ke IDR + akumulasi top-up besar; TIDAK untuk pasang buyout, accept bid, atau top-up rutin | `01_scope.md` F014 |

Angka kanonik implementasi: `packages/shared/src/index.ts` —
HARUS sinkron dengan tabel di atas (dua arah).

## 6. Istilah yang DILARANG

- "merchandise" / "merch" (pakai "collectible" / "kartu") — **larangan
  berlaku untuk menyebut PRODUK**; frasa negasi landing seperti
  "Bukan sekadar merch." founder-approved (2026-08-16) tetap
  dipakai. Produk = selalu "C.Card".
- "konveksi" / "garment" (pakai "vendor kartu/acrylic/packaging").
- "item" lowercase di prose (pakai "kartu" / "Card").
- "fee 12%" / "fee 6%" (model lama — pakai revenue share).

## 7. Peta Sumber (Workspace Brainstorm)

| Topik | Dok sumber |
|-------|------------|
| Visi & problem | 01_vision (Visi 1 kalimat: collectible limited edition analog trading card, long-term multi-tier; Misi 3 pilar — kreator, kolektor, ekosistem), 02_problem_statement (pain point #1-#3) |
| Persona | 03_target_users (5 persona: Kreator Indie Aurel, Kreator Established Bara, Kolektor Pemula Nara, Kolektor Serius Dharma, Brand Celcius) |
| Asumsi angka | 05_assumptions (A002 provenance, A019 AOV Rp 300k/Rp 500k, A027-A031 koreksi 2026-08-20) |
| Fitur MVP (orisinal) | 03_features_mvp (gaya RICE+MoSCoW, F001-F036) |
| NFC & arsitektur verifikasi | 18_nfc_decision (N5 SUN/SDM: ISO 7816-4, SDM mirror UID+counter+CMAC ke NDEF, server-side CMAC verify; N5b iOS via SUN URL), 05_nfc_ux (tap flow Skenario A, edge cases E1-E5) |
| Revenue split | 19_revenue_split (primary 70/30 platform-produced; secondary total 15% = 7,5% platform + 7,5% royalti kreator lifetime + 85% owner; keputusan 2026-07-27/2026-08-04) |
| GTM off-platform | 17_mvp_off_platform_gtm (rekrut via personal relationship + 1-2 agency partner, 30-50 kreator; TANPA aplikasi/approval in-platform; keputusan 2026-08-12) |
| Tech stack | 01_tech_stack (full-edge: React/Vite di CF Pages + Hono di CF Workers + Supabase + R2, konsolidasi 2026-08-11), 20_tech_stack_decision (monorepo, free tier cukup Y1) |
| Flow MVP (orisinal) | 05_mvp_flow (Flow 1-10: primary raffle+C FCFS, fulfillment, payment/settlement, NFC tap, QR fallback, ownership transfer, secondary Marketplace+Browse, pendukung/onboarding, top-up & payout; Flow 10 seed card 2026-08-20) |
| Legal & C-Coin | 02_legal_compliance (2,2 [VALIDATED 2026-08-13]: C-Coin bukan e-money, struktur Opsi A closed-loop + payout fee 1%), 14_legal_consultation_brief (Sesi A gate launch — A1-A3 dijawab lawyer fintech 2026-08-13); dual-token 2026-09-03 menuntaskan pemisahan "hasil titip jual" — refresh lawyer = pending sebelum go-live |
| SOP operasional | 03_operations_playbook (SOP 1-6: produksi & QC, inventory, fulfillment/shipping, CS, trust & safety, finance & payout) |

## 8. Perubahan Terhadap Dokumen Sumber (2026-08-12)

Dok di folder ini meng-override dokumen sumber workspace:

1. **Threshold kreator = 100 ribu+ followers combined** (dulu
   10 ribu). Berlaku di semua dok.
2. **Onboarding kreator murni off-platform** — tidak ada
   aplikasi/approval in-platform, tidak ada "inbox kurasi".
   Admin hanya mengelola data kreator yang sudah direkrut.
3. **Admin/Ops Dashboard = app terpisah** (bukan di edge),
   fitur ADM-01 s/d ADM-10 (lihat `01_scope.md`).
4. **NFC iOS**: tap-to-verify via SUN URL dianggap MUNGKIN
   (koreksi asumsi lama "iOS tidak bisa verify") — wajib
   divalidasi device nyata di Sprint 0/3 sebelum dipatok
   (lihat `07_constraints.md` C-03, `12_nfc_cmac_verify.md` §3).
5. **Struktur secondary = Marketplace + Browse** (bukan
   listing+auction): Marketplace = kartu dengan buyout price;
   Browse = cari + bid langsung di kartu walau owner tidak
   pasang harga. **Bid: 1 active tertinggi/kartu; bid lebih
   tinggi meng-outbid bid lama (C-Coin balik otomatis);
   bidder bisa cancel; owner accept only — TANPA reject.**
   **Bid TIDAK ada expire** — bertahan sampai accept/cancel/
   outbid. History bid per kartu: 90 hari ke belakang; bid
   complete (accepted) selamanya. Tidak ada auction timer/
   anti-sniping di MVP.
6. **Tidak ada halaman verifikasi terpisah** — verifikasi
   melekat di halaman kartu: tap NFC → langsung halaman 3D
   kartu (CMAC verified); QR di dus → halaman info kartu
   (Registered). Tidak ada input serial manual.
7. **Primary = platform-produced SAJA** (70/30) — kreator-
   produced (30/70) di-defer Y2+.
8. **Leaderboard (F019) punya halaman sendiri** (PG-LB-01) — multi-type:
   tab `Level` (`xp` default) \| `Kolektor` (`cards`) \| `Lencana`
   (`badges`) + papan per-kreator (`?tab=` sinkron). Privasi & tie-break
   deterministik dijamin RPC `get_leaderboard` (`04_rpc.sql`); chip tier
   berwarna hanya di papan Level.
9. **Top-up di area USER** (PG-USR-05, bukan halaman publik);
   **Q026 RESOLVED 2026-08-13** — bukan gate go-live. Top-up
   uang riil bisa diterima setelah T&C final dan cap saldo
   diimplementasi. Semua fitur dibangun penuh.
10. **KYC trigger (validasi lawyer 2026-08-13)**: KYC hanya
    untuk seller yang ingin cash-out/withdrawal hasil
    penjualan. Threshold: payout/disbursement ke IDR + akumulasi
    top-up besar. TIDAK ada KYC untuk pasang buyout atau terima
    bid.
11. **Profil publik** (koleksi, level, badge, ranking) bisa
    dilihat tanpa login — kecuali user mengaktifkan **privacy
    anonymous**.
12. **Level = via XP**: spend 1 C-Coin = 1 XP; 10 XP = 1 level
    (top-up tidak menambah XP).
13. **Badge dikonfigurasi di admin page** (kriteria + ikon +
    **XP reward** = experience untuk naik level, bukan masa
    berlaku) — ADM-07.
14. **Halaman 3D kartu = simple**: 3D viewer + info singkat
    (Series — link ke drop, Unit number, Kreator — link, Release
    date, Owner — link) + verified badge "Verified Card" (HANYA
    lewat tap NFC). **Ownership history TIDAK di halaman 3D** —
    ada di halaman info kartu.
15. **Keamanan admin (ADM-08/09)**: **2FA TOTP wajib** untuk
    semua akun admin (Supabase MFA aal2 + Cloudflare Access)
    dan **audit log append-only** untuk semua aksi admin
    (`admin_audit_log`, retensi ≥ 1 tahun).
16. **Pembelian → vault langsung** (founder 2026-08-28: purchase
    → vault only) — semua pembelian (drop/FCFS, buyout, bid
    accept) settle tanpa alamat/ongkir; fisik dipegang platform.
    Shipping = SATU flow pasca-vault: owner minta ship-out
    (`vault_shipout`) dari Kelola Kartu dan bayar ongkir di titik
    itu (fee → treasury + `platform_revenue` ref_type
    'shipment'). Berlaku juga di secondary — ownership pindah di
    ledger, kartu tetap di vault. Semua nominal C-Coin & C-Gems
    **integer ≥ 1 tanpa desimal**.
17. **Dual-token economy** (2026-09-03): penghasilan seller/kreator/
    royalti/Dukungan diterima masuk sebagai **C-Gems** (lot terkunci
    24 jam; payout hanya lot matured — KYC, fee 1%; konversi satu
    arah Gems→C-Coin 1:1 tanpa XP). C-Coin tetap medium belanja
    non-cashable. Detail: `06_tech_decisions.md` D3b.

## Sumber

- Workspace `00_Dream_Project/` (AGENTS.md aturan self-contained
  2026-08-20, dok sumber brainstorm di atas).
- Diskusi founder 2026-08-12 (keputusan threshold, onboarding
  off-platform, admin app terpisah, struktur folder).
- Audit foundation `Platform` repo 2026-08-15 (lahiran spec 10-16).

# Development Strategy — C.Verse MVP

> Status: [DRAFT]
> Last updated: 2026-08-12
> Berlaku untuk: MVP C.Card (Creator Card), Y1.

## 1. Apa Folder Ini

Folder ini adalah **development strategy** untuk MVP C.Verse
(C.Card): definisi scope, halaman, flow, user stories, data
model, keputusan teknis, dan constraint. Folder ini
**self-contained** — AI agent atau developer baru cukup
membaca semua dok di folder ini (urutan di bawah) untuk
memahami apa yang harus dibangun, tanpa perlu membaca
workspace brainstorm asal (`00_Dream_Project/`).

Folder ini **bukan** codebase. Ini adalah dokumen perencanaan
yang nantinya dipindah ke workspace development sebagai acuan
implementasi.

## 2. Cara Baca (Urutan)

| Urutan | Dok | Isi |
|--------|-----|-----|
| 1 | `01-scope.md` | Definisi MVP: fitur final (MoSCoW + RICE), fitur admin baru, batasan, cut lines |
| 2 | `02-pages.md` | Peta halaman per role + sitemap + komponen kunci |
| 3 | `03-flows.md` | Flow end-to-end (user, kreator, admin) dengan decision point & gate |
| 4 | `04-user-stories.md` | User stories per halaman (Given/When/Then) |
| 5 | `05-data-model.md` | Skema logis: tabel inti, relasi, status enum |
| 6 | `06-tech-decisions.md` | Stack & keputusan arsitektur yang sudah di-lock |
| 7 | `07-constraints.md` | Blocker, gate, dan open items yang menentukan WHAT NOT TO BUILD |
| 8 | `08-deployment.md` | **Runbook deploy step-by-step** (Cloudflare Pages/Workers/R2, Supabase, CI/CD, rollback, go-live checklist) |

Baca 01-07 secara berurutan. 00-README (ini) cukup untuk
orientasi cepat.

## 3. Konvensi Status

- `[DRAFT]` — hipotesis, belum divalidasi.
- `[VALIDATED]` — sudah ada bukti/data/keputusan final.
- `[BLOCKED]` — butuh input untuk lanjut (sebutkan apa
  blocker-nya).
- `[SUPERSEDED]` — sudah digantikan dok lain.

## 4. Glossary & Angka Kunci (Harus Konsisten)

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
| C-Coin | Mata uang platform, medium tunggal transaksi — **semua nominal integer ≥ 1 (tanpa desimal)** |
| NTAG 424 DNA TagTamper | Chip NFC + provenance system |

| Parameter | Nilai | Sumber |
|-----------|-------|--------|
| Rate C-Coin | 1 C-Coin = Rp 10.000 (top-up) | `05-data-model.md`, `07-constraints.md` |
| Struktur C-Coin | Opsi A: saldo buyer closed-loop TANPA withdraw; hasil seller/kreator auto-disburse IDR | `07-constraints.md` |
| Payout fee (disbursement seller/kreator) | 1% fixed | `01-scope.md` |
| Revenue share primary (platform-produced) | 70% platform / 30% kreator | `01-scope.md` |
| Revenue share primary (kreator-produced) | 30% platform / 70% kreator — **TIDAK ADA di MVP** | `01-scope.md` |
| Fee secondary total | 15% (7,5% platform + 7,5% royalti kreator LIFETIME + 85% owner) | `01-scope.md` |
| AOV unsigned / signed | Rp 300.000 / Rp 500.000 | `01-scope.md` |
| COGS kartu unsigned / signed | Rp 104.000 / Rp 120.000 | `01-scope.md` |
| Threshold kreator MVP | **100 ribu+ followers combined** (gabungan semua platform sosial) | `01-scope.md` |
| Domain | **c-verse.co** (primary, kemungkinan besar) + **c-verse.id** (redirect) — LOCK sebelum provisioning NFC | `08-deployment.md` (2026-08-12, [DRAFT]) |
| Format kartu | 63x88mm, 350-400gsm, holo, acrylic hardcase | `01-scope.md` |
| Web NFC | Chrome Android 89+ only (scan terprogram); iOS tap-to-verify via SUN URL | `06-tech-decisions.md`, `07-constraints.md` |

## 5. Istilah yang DILARANG

- "merchandise" / "merch" (pakai "collectible" / "kartu").
- "konveksi" / "garment" (pakai "vendor kartu/acrylic/packaging").
- "item" lowercase di prose (pakai "kartu" / "Card").
- "fee 12%" / "fee 6%" (model lama — pakai revenue share).

## 6. Peta Sumber (Workspace Brainstorm)

Dok di folder ini adalah ringkasan final. Untuk detail penalaran
dan data mentah, lihat dok sumber di workspace:

| Topik | Dok sumber |
|-------|------------|
| Visi & problem | `00_foundation/01_vision.md`, `02_problem_statement.md` |
| Persona | `00_foundation/03_target_users.md` |
| Asumsi angka | `00_foundation/05_assumptions.md` |
| Fitur MVP (orisinal) | `20_product/03_features_mvp.md` |
| NFC & arsitektur verifikasi | `90_research/nfc-decision-ntag-424-dna.md`, `20_product/05_nfc_ux.md` |
| Revenue split | `90_research/revenue-split-decision.md` |
| GTM off-platform | `90_research/mvp-off-platform-gtm.md` |
| Tech stack | `40_operations/01_tech_stack.md`, `90_research/tech-stack-decision-full-edge.md` |
| Flow MVP (orisinal) | `40_operations/05_mvp_flow.md` |
| Legal & C-Coin | `40_operations/02_legal_compliance.md`, `90_research/legal-consultation-brief.md` |
| SOP operasional | `40_operations/03_operations_playbook.md` |

## 7. Perubahan Terhadap Dokumen Sumber (2026-08-12)

Dok di folder ini mengasumsikan beberapa keputusan yang
meng-override dokumen sumber:

1. **Threshold kreator = 100 ribu+ followers combined** (dulu
   10 ribu). Berlaku di semua dok.
2. **Onboarding kreator murni off-platform** — tidak ada
   aplikasi/approval in-platform, tidak ada "inbox kurasi".
   Admin hanya mengelola data kreator yang sudah direkrut.
3. **Admin/Ops Dashboard = app terpisah** (bukan di edge),
   fitur baru ADM-01 s/d ADM-06 (lihat `01-scope.md`).
4. **NFC iOS**: tap-to-verify via SUN URL dianggap MUNGKIN
   (koreksi asumsi lama "iOS tidak bisa verify") — wajib
   divalidasi device nyata di Sprint 0 sebelum dipatok
   (lihat `07-constraints.md` C-03).
5. **Struktur secondary = Marketplace + Browse** (bukan
   listing+auction): Marketplace = kartu dengan buyout price;
   Browse = cari + bid langsung di kartu walau owner tidak
   pasang harga. **Bid: 1 active tertinggi/kartu; bid lebih
   tinggi meng-outbid bid lama (C-Coin balik otomatis);
   bidder bisa cancel; owner accept only — TANPA reject.**
   **Bid TIDAK ada expire** — bertahan sampai accept/cancel/
   outbid.
   History bid per kartu: 90 hari ke belakang; bid complete
   (accepted) selamanya. Tidak ada auction timer/anti-sniping
   di MVP.
6. **Tidak ada halaman verifikasi terpisah** — verifikasi
   melekat di halaman kartu: tap NFC → langsung halaman 3D
   kartu (CMAC verified); QR di dus → halaman info kartu
   (Registered). Tidak ada input serial manual.
7. **Primary = platform-produced SAJA** (70/30) — kreator-
   produced (30/70) di-defer Y2+.
8. **Leaderboard (F019) punya halaman sendiri** (PG-LB-01).
9. **Top-up di area USER** (PG-USR-05, bukan halaman publik);
   **tidak ada bloker build** — Q026 (status hukum C-Coin)
   hanya gate GO-LIVE (terima uang riil), semua fitur dibangun.
10. **KYC trigger**: top-up kumulatif > 99 C-Coin, pasang
    buyout, atau menerima (accept) bid.
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
16. **Pengiriman = pilihan**: checkout (primary) bisa **kirim
    fisik** (ongkir dibayar **C-Coin**, tracking aktif) ATAU
    **simpan di inventory** (vault). **Secondary juga**: buyer
    hasil buyout/bid accept pilih kirim ke alamat ATAU
    **kirim/rawat di platform** (vault + verifikasi ulang).
    Kartu di vault bisa **dikirim kapan saja** (ship-from-vault,
    ongkir C-Coin). Semua nominal C-Coin **integer ≥ 1 tanpa
    desimal**.

## Sumber

- Workspace `00_Dream_Project/` (INDEX.md, AGENTS.md, dok
  sumber di atas).
- Diskusi founder 2026-08-12 (keputusan threshold, onboarding
  off-platform, admin app terpisah, struktur folder).
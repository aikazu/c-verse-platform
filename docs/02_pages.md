# 02 — Peta Halaman MVP

> Status: [VALIDATED]
> Last updated: 2026-09-04 (public legal center: /legal + 5
> dokumen, route alias TOS/privacy, footer links, sitemap + OG)
> Previous: 2026-08-31 (sitemap admin: + /kyc approve/reject,
> NFC seed ops vault-in/release, /investor via RPC
> `get_investor_stats`; /register route web)
> Previous: 2026-08-27 (PG-LB-01 multi-type leaderboard: tab
> Level | Kolektor | Lencana + Papan Kolektor per-kreator di `/c/:username`)
> Previous: 2026-08-21 (badge holografik "✦ Seed 1-of-1"
> di kartu Marketplace, Browse, halaman kartu (info) & 3D
> untuk drop is_seed — Flow 10 [5])
> Previous: 2026-08-13 (konten divalidasi — domain final,
> halaman kartu; marketplace = secondary buyout; browse = bid
> langsung di kartu tanpa harga; leaderboard jadi halaman;
> top-up di area user; profil publik + privacy anonymous;
> badge dikelola admin)
> Code (route/komponen) pakai Bahasa Inggris; prose pakai
> Bahasa Indonesia casual-profesional (dengan istilah domain/fandom Bahasa Inggris seperti Raffle, Drop, Vault, Collectible, Bid, Buyout tetap dipertahankan — C-16). Arsitektur i18n disiapkan sejak awal (default locale `id`).

## 1. Arsitektur App

Dua aplikasi terpisah (satu monorepo):

| App | Lokasi | Audience | Auth |
|-----|--------|----------|------|
| `apps/web` | Cloudflare Pages (publik) | Visitor, kolektor, kreator | Supabase Auth (Google OAuth + email OTP) |
| `apps/admin` | Lokal / VPS + Cloudflare Access (TIDAK publik) | Founder tim internal | Cloudflare Access + Supabase Auth + role check + **2FA TOTP wajib** |

Tidak ada route admin di API publik. Admin app akses Supabase
langsung via service-role key. Detail: `06_tech_decisions.md`.

Konvensi UI lintas-halaman (a11y baseline, state error + retry,
konfirmasi aksi destruktif, `StatusBadge`/label status shared, token
warna): lihat `06_tech_decisions.md` D7–D8.

## 2. Istilah Pasar

| Istilah | Arti |
|---------|------|
| **Drop** | Primary sale (platform-produced, 70/30) |
| **Marketplace** | Secondary: kartu yang owner-nya pasang **buyout price** |
| **Browse** | Secondary: cari berdasarkan kartu + **bid langsung di kartu** walau owner tidak pasang harga (1 active tertinggi; outbid/cancel release C-Coin) |
| **Buyout** | Beli langsung di harga yang owner pasang |
| **Bid (offer)** | Tawaran ke owner — C-Coin di-hold; outbid/cancel balik ke bidder; owner accept only (tanpa reject) |

## 3. Sitemap — PUBLIC (tanpa login)

| ID | Route | Halaman | Komponen kunci |
|----|-------|---------|----------------|
| PG-LAND-01 | `/` | Landing page | Hero, drop terbaru, cara kerja, CTA register |
| PG-DROP-01 | `/drops` | Daftar drop (primary) | Grid drop aktif + upcoming, filter kreator |
| PG-DROP-02 | `/drops/:dropId` | Detail drop | Countdown fase (raffle entry window / FCFS), artwork, harga per pool (reguler/premium), jumlah entry live per pool + unit tersisa; fase raffle: tombol "Ikuti" (pilih pool, login gate); fase FCFS (setelah draw): tombol "Beli" (login gate); **grid SEMUA kartu drop** — group Premium (Signed) → Regular (Unsigned) via `GET /api/drops/:id/cards` — + **section Pemenang** setelah draw (`GET /api/drops/:id` → `winners`: unitNumber, variant, displayName; nama anonim/suspended = "Anonim") |
| PG-MARKET-01 | `/marketplace` | Marketplace (secondary buyout) | Kartu dengan buyout price, filter, beli langsung; sellerName anonim/suspended = "Anonim"; **badge holografik "✦ Seed 1-of-1"** untuk kartu dari seed drop (Flow 10) |
| PG-BROWSE-01 | `/browse` | Browse (discovery drop) | Grid tile **per-drop** (bukan per kartu) — klik tile → `/drops/:id`; ticker stats (drop / unit terjual / unit total). Tanpa search kartu / bid langsung di sini — bid & buyout di halaman kartu (`PG-CARD-01`) |
| PG-CARD-01 | `/cards/:shortId` | Halaman kartu (info) | Sertifikat, **jejak ownership** (ownerName = "Anonim" untuk historical owner yang sekarang `is_anonymous` ATAU `flag_reason` set), bid tertinggi + **form tawar untuk non-owner** (konfirmasi modal D8; label "BID KAMU — TERTINGGI" bila bid tertinggi milik viewer), harga buyout (jika ada) + beli buyout berkonfirmasi, QR fallback; **badge holografik "✦ Seed 1-of-1"** untuk kartu dari seed drop (Flow 10) |
| PG-CARD-02 | `/cards/:shortId/3d` | Halaman kartu (3D view) — **simple** | 3D viewer + info singkat: **Series** (link ke detail drop), **Unit number** (#X dari Y), **Kreator** (link ke halaman kreator), **Release date**, **Owner** (link ke halaman owner) + **verified badge "Verified Card"** (hanya muncul lewat tap NFC) + **badge holografik "✦ Seed 1-of-1"** untuk kartu dari seed drop (Flow 10). Ownership history TIDAK di halaman 3D — ada di halaman info (`PG-CARD-01`) |
| PG-LB-01 | `/leaderboard` | Leaderboard | Peringkat kolektor (F019). Tab `Level` (default, `xp`) \| `Kolektor` (`cards`) \| `Lencana` (`badges`) — `?tab=` sinkron dengan URL. User suspended (`flag_reason`) dan anonymous (`is_anonymous`) difilter **di dalam RPC** `get_leaderboard(p_type, p_creator_id, p_limit)` (RPC `07`–`17`) sebelum ORDER + LIMIT agar rank survivor tetap benar; tie-break deterministik `score DESC, reached_at ASC, username ASC NULLS LAST, user_id ASC`. Chip tier berwarna hanya di papan Level (UX jujur). Public tanpa auth. Cache 60s untuk `xp`, 30s untuk board lain |
| PG-CRT-PUB-01 | `/c/:username` | Halaman kreator (publik) | **Handle, bio, link media sosial** + **list drop** (published/live/upcoming, klik ke detail drop) + **tombol Dukungan** (login user kirim C-Coin min 1 → 100% ke kreator, tanpa potongan platform; pengirim XP 1:1 — `POST /api/wallet/support`) + **Papan Kolektor** (top 10 kolektor kreator tersebut — `type=creator`, `creatorId=<uuid>`). TANPA jumlah follower. Creator suspended disembunyikan dari listing publik; creator anonymous juga disembunyikan (konsisten dgn privacy rule). Papan Kolektor TIDAK punya link ke papan global |
| PG-PROF-01 | `/u/:username` | Profil kolektor (publik) | Koleksi, level, badge, ranking leaderboard — **kecuali user mengaktifkan privacy anonymous ATAU di-suspend (`flag_reason`)** |
| PG-AUTH-01 | `/login` · `/register` | Login/Register | Google OAuth + email OTP (**email OTP wajib captcha anti-spam** — Cloudflare Turnstile) |
| PG-LEGAL-00 | `/legal` | Pusat Legal | Hub publik untuk seluruh kebijakan, status dokumen, versi, tanggal update, dan kanal kontak |
| PG-LEGAL-01 | `/legal/terms` | Syarat & Ketentuan | T&C/TOS v1.0: akun, dual-token, raffle, Vault, secondary, NFC, refund, suspension, liability, sengketa; alias `/terms`, `/tos`, `/terms-of-service` |
| PG-LEGAL-02 | `/legal/privacy` | Kebijakan Privasi | Data, tujuan/dasar pemrosesan, penerima, retensi, keamanan, hak subjek data; alias `/privacy-policy` |
| PG-LEGAL-03 | `/legal/shipping` | Pengiriman & Vault | Purchase-to-vault only, ship-out, refund ongkir, tanggung jawab kehilangan/kerusakan |
| PG-LEGAL-04 | `/legal/kyc` | Kebijakan KYC | Payout C-Gems, cap saldo non-KYC, data verifikasi, monitoring risiko, banding |
| PG-LEGAL-05 | `/legal/creator-terms` | Ketentuan Kreator | Lisensi, revenue share, lifetime royalty, Creator Seed, C-Gems, integritas pasar |

## 4. Halaman Verifikasi TIDAK ADA (di-merge)

`/verify/:shortId` DITIADAKAN. Verifikasi melekat di halaman kartu:

- **Tap NFC** → SUN URL langsung menuju halaman 3D kartu
  (`/cards/:shortId/3d`) dengan status verified (CMAC match).
- **QR di dus** → halaman info kartu (`/cards/:shortId`) dengan
  status "Registered" (tanpa CMAC, label lebih lemah).
- Satu kartu = satu halaman publik (info + 3D), tanpa halaman
  verifikasi terpisah dan tanpa input serial manual.
- Drop list publik: halaman kreator `/c/:username` (list drop)
  + halaman kolektor `/u/:username` (koleksi/level/badge/ranking).

## 5. Sitemap — USER / KOLEKTOR (login)

| ID | Route | Halaman | Komponen kunci |
|----|-------|---------|----------------|
| PG-USR-01 | `/home` | Home user | Drop trending, notif, saldo C-Coin |
| PG-USR-02 | `/drops/:dropId/checkout` | Entry raffle / checkout drop | Fase raffle: pilih pool (reguler/premium/keduanya) + hold C-Coin (escrow); fase FCFS: ringkasan, potong saldo, race handling, pilih pool yang ada stok; **settle LANGSUNG ke vault — tanpa alamat/ongkir (founder 2026-08-28: purchase → vault only)**; kirim fisik nanti via "Kirim dari vault" |
| PG-USR-03 | `/orders` | Daftar order | List order + status (semua settle vault — tanpa opsi kirim) |
| PG-USR-04 | `/orders/:orderId` | Detail order | Timeline `PAID → QC → SETTLED` (founder 2026-08-28: purchase → vault only); tracking/no resi hanya di shipment `vault_shipout` (pasca-vault), bukan di order |
| PG-USR-05 | `/wallet` | Wallet C-Coin | Saldo, mutasi (ledger), histori top-up, status payout; **top-up di sini (bukan halaman publik)** |
| PG-USR-06 | `/me` | Profile & collection | Profil, koleksi kartu, ownership history, level & badge |
| PG-USR-07 | `/me/manage` | Kelola kartu (sell) | Set/ubah/cabut **buyout price**, lihat bid active, accept bid (tanpa reject); **lihat lokasi kartu** (dengan owner / di vault platform) + tombol **"Kirim dari vault"** (ongkir C-Coin) untuk kartu yang dipegang platform — vault adalah default, ship-out kapan saja |
| PG-USR-07b | `/me/manage/verify-shipment` | Verifikasi kiriman secondary | Halaman USER untuk SELLER secondary input resi pengiriman kartu ke platform (jalur vault). Input hasil verifikasi NFC + QC dilakukan di ADMIN app (ADM-04), BUKAN di web publik — release payout otomatis setelah verifikasi admin |
| PG-USR-08 | `/notifications` | Notifikasi | List notif (email/FCM) |
| PG-USR-09 | `/me/kyc` | KYC | Upload KTP/selfie/NPWP (trigger: payout/disbursement ke IDR + akumulasi top-up besar; tidak perlu KYC untuk pasang buyout atau accept bid) |
| PG-USR-10 | `/me/privacy` | Privacy settings | Toggle **privacy anonymous** (profil tidak tampil publik) |

## 6. Sitemap — KREATOR (login, role creator)

| ID | Route | Halaman | Komponen kunci |
|----|-------|---------|----------------|
| PG-CRT-01 | `/creator` | Creator dashboard | **Traffic + pendapatan SAJA** (bukan admin) |
| PG-CRT-02 | `/creator/drops` | Daftar drop | List drop + status + mini-analitik |
| PG-CRT-03 | `/creator/drops/:dropId` | Detail drop | Per unit sold, pendapatan, payout status |
| PG-CRT-04 | `/creator/payouts` | Payout & royalti | Riwayat payout, royalti secondary, fee 1% |

> Kreator TIDAK submit artwork via platform di MVP — artwork
> final di-upload oleh ops (approved off-platform). Kreator
> hanya melihat data & analitik.

## 7. Sitemap — ADMIN (`apps/admin`, app terpisah)

| ID | Route | Halaman | Fitur | Komponen kunci |
|----|-------|---------|-------|----------------|
| PG-ADM-01 | `/` | Admin dashboard | ADM-01..10 | Ringkasan: count drop/order/kreator + antrian kerja (Pengiriman perlu diproses [shipment requested/packed], KYC pending, dispute open/under_review, Payout perlu tindakan [payout pending/processing/failed]) link ke /orders, /kyc, /disputes, /payouts |
| PG-ADM-02 | `/creators` | Kelola kreator | ADM-01 | CRUD data kreator (hasil rekrutan off-platform), status akun, payment info |
| PG-ADM-03 | `/drops` | Kelola drop | ADM-02 | Buat drop (artwork final, harga, unit, waktu), schedule, publish, tutup |
| PG-ADM-04 | `/orders` | Kelola order | ADM-03 | Semua order, update status, no resi, return |
| PG-ADM-05 | `/nfc` | NFC provisioning & QC | ADM-04 | Batch tag, assign UUID↔UID, config NDEF/SDM, QC report + **seed sale ops** (kartu seed `bid_pending`): tombol **Vault-in** (`PATCH /api/admin/cards/:id/vault-in`), **Release** (`POST /api/admin/cards/:id/release-seed-sale`), **Batalkan sale** (`POST /api/admin/cards/:id/cancel-seed-sale`) — semua dengan modal konfirmasi D8 |
| PG-ADM-06 | `/payouts` | Payout & rekonsiliasi | ADM-05 | Escrow, trigger payout batch, rekonsiliasi harian |
| PG-ADM-07 | `/disputes` | Dispute | ADM-06 | List dispute, mediasi, keputusan |
| PG-ADM-08 | `/badges` | Kelola badge | ADM-07 | **Definisi badge: kriteria + logo/ikon + XP reward** (admin-configurable, contoh: koleksi N C.Card, punya C.Card kreator A/B) |
| PG-ADM-09 | `/audit` | Audit log admin | ADM-08 | Lihat semua aksi admin (**append-only**): siapa, aksi, target, payload ringkas, IP/session, waktu — filter |
| PG-ADM-11 | `/kyc` | Kelola KYC | F014 | Review submission (KTP/selfie), **approve / reject (+ alasan penolakan tercatat di audit log)** |
| PG-ADM-10 | `/investor` | Investor Data Pack | — | Ringkasan metrik kunci: GMV, user growth, drop performance, creator earnings, secondary volume — via RPC `get_investor_stats` (RPC `07`–`17`). Tabel + chart sederhana. **BUKAN untuk publik** |

> **2FA admin (ADM-09)**: bukan halaman terpisah — flow
> enrollment + challenge TOTP melekat di login admin (Supabase
> MFA, sesi aal2). Semua UI privileged (ADM-01..10) terkunci
> sampai sesi aal2 tercapai.

## 8. Halaman Kreator & Kartu — Target SEO

Halaman kreator (`/c/:username`) adalah **aset SEO paling
berharga** platform. Target: muncul di page 1 Google untuk query
**"nama kreator"** dan **"nama kreator card"** — sebagai profil
resmi koleksi.

### 8.1 Strategi SEO per Halaman

| Halaman | Route | SEO Target | Teknik |
|---------|-------|-----------|--------|
| **Profil kreator** | `/c/:username` | Page 1 untuk "nama kreator" + "nama kreator card" | OG meta (title, desc, image) + JSON-LD `Person` + link sosial media kreator |
| **Halaman kartu** | `/cards/:shortId/3d` | Page 1 untuk "nama kreator card" / "nama kreator C.Card" | OG meta + JSON-LD `Product` + `ImageObject` |
| **Detail drop** | `/drops/:dropId` | Page 2+ untuk "nama kreator drop" | OG meta + JSON-LD `Event` |
| **Landing page** | `/` | Brand search "C.Verse" "C.Card" | Standar meta tags |

### 8.2 Implementasi — HTMLRewriter di Edge

Semua SEO ditangani oleh **1 Worker di depan SPA** tanpa perlu
SSR framework:

```mermaid
Request → Cloudflare Worker → HTMLRewriter inject meta tags →
                                fetch SPA dari Pages →
                                stream response ke crawler
```

Worker aktif hanya untuk halaman publik yang butuh SEO:
- `GET /c/:username` — inject Person schema + OG
- `GET /cards/:shortId/3d` — inject Product schema + OG
- `GET /drops/:dropId` — inject OG + Event schema
- `GET /sitemap.xml` — sitemap dinamis. Sitemap EXCLUDE creator suspended (`flag_reason`) + anonymous (`is_anonymous`) — konsisten dgn `/api/creators` listing dan privacy rule publik.
- `GET /legal*` — OG + WebPage JSON-LD untuk pusat legal dan
  lima dokumen; seluruh route legal masuk sitemap publik.

Halaman login/dashboard/wallet — SPA murni, skip Worker.

### 8.3 Biaya & Effort
- **Build**: 2-3 hari (Worker + HTMLRewriter + sitemap generator)
- **Runtime**: Cloudflare Workers free tier (100k req/hari gratis;
  traffic SEO Y1 < 1k/hari)
- **Tidak perlu ubah arsitektur**: SPA tetap murni, Worker di
  depan sebagai proxy ringan

## 9. Halaman PENTING yang Sengaja TIDAK Ada

| Halaman | Alasan |
|---------|--------|
| Form apply kreator / inbox kurasi | Onboarding off-platform (direct contact) — `01_scope.md` F002 |
| Upload artwork self-serve kreator | Artwork di-approve & di-upload ops |
| Halaman verifikasi terpisah (/verify) | **Di-merge ke halaman kartu** (3D dari tap, info dari QR) |
| Checkout IDR langsung | Medium tunggal = C-Coin |
| Withdraw buyer | Struktur Opsi A closed-loop |
| Admin (public) | Admin app terpisah, tidak di edge |

## Sumber

- `01_scope.md` (fitur → mapping halaman).
- 05_mvp_flow (Flow 1-9 → dasar route; Flow 8.1 provisioning
  akun kreator, Flow 10 seed card).
- 13_demo_platform_internal (6 screen demo: Landing → Drop Detail
  → Checkout → Order Success → NFC Tap → 3D Viewer, floating nav;
  referensi visual flow user).
- Diskusi founder 2026-08-12 (revisi halaman: marketplace,
  browse, leaderboard, kartu 3D + info; verifikasi di-merge).

# 02 — Peta Halaman MVP

> Status: [VALIDATED]
> Last updated: 2026-08-13 (konten divalidasi — domain final,
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
| PG-DROP-02 | `/drops/:dropId` | Detail drop | Countdown fase (raffle entry window / FCFS), artwork, harga per pool (reguler/premium), jumlah entry live per pool + unit tersisa; fase raffle: tombol "Ikuti" (pilih pool, login gate); fase FCFS (setelah draw): tombol "Beli" (login gate) |
| PG-MARKET-01 | `/marketplace` | Marketplace (secondary buyout) | Kartu dengan buyout price, filter, beli langsung |
| PG-BROWSE-01 | `/browse` | Browse (cari kartu) | **Search by kartu/kreator**, bid langsung di kartu walau tanpa harga |
| PG-CARD-01 | `/cards/:shortId` | Halaman kartu (info) | Sertifikat, **jejak ownership**, bid tertinggi, harga buyout (jika ada), QR fallback |
| PG-CARD-02 | `/cards/:shortId/3d` | Halaman kartu (3D view) — **simple** | 3D viewer + info singkat: **Series** (link ke detail drop), **Unit number** (#X dari Y), **Kreator** (link ke halaman kreator), **Release date**, **Owner** (link ke halaman owner) + **verified badge "Verified Card"** (hanya muncul lewat tap NFC). Ownership history TIDAK di halaman 3D — ada di halaman info (`PG-CARD-01`) |
| PG-LB-01 | `/leaderboard` | Leaderboard | Peringkat kolektor (F019) |
| PG-CRT-PUB-01 | `/c/:username` | Halaman kreator (publik) | **Handle, bio, link media sosial** + **list drop** (published/live/upcoming, klik ke detail drop). TANPA jumlah follower. Privasi creator TIDAK di-hide (kreator = identitas publik) |
| PG-PROF-01 | `/u/:username` | Profil kolektor (publik) | Koleksi, level, badge, ranking leaderboard — **kecuali user mengaktifkan privacy anonymous** |
| PG-AUTH-01 | `/login` | Login/Register | Google OAuth + email OTP (**email OTP wajib captcha anti-spam** — Cloudflare Turnstile) |

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
| PG-USR-02 | `/drops/:dropId/checkout` | Entry raffle / checkout drop | Fase raffle: pilih pool (reguler/premium/keduanya) + hold C-Coin (escrow); fase FCFS: ringkasan, potong saldo, race handling, pilih pool yang ada stok; **DEFAULT simpan di inventory (vault) — tanpa alamat/ongkir; OPSIONAL kirim fisik sekarang (alamat + ongkir C-Coin)** |
| PG-USR-03 | `/orders` | Daftar order | List order + status (label kirim fisik vs inventory) |
| PG-USR-04 | `/orders/:orderId` | Detail order | Tracking, no resi, timeline — **hanya order kirim fisik**; order inventory tanpa tracking/alamat |
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
| PG-ADM-01 | `/` | Admin dashboard | ADM-01..08 | Ringkasan: drop aktif, order, escrow, payout due |
| PG-ADM-02 | `/creators` | Kelola kreator | ADM-01 | CRUD data kreator (hasil rekrutan off-platform), status akun, payment info |
| PG-ADM-03 | `/drops` | Kelola drop | ADM-02 | Buat drop (artwork final, harga, unit, waktu), schedule, publish, tutup |
| PG-ADM-04 | `/orders` | Kelola order | ADM-03 | Semua order, update status, no resi, return |
| PG-ADM-05 | `/nfc` | NFC provisioning & QC | ADM-04 | Batch tag, assign UUID↔UID, config NDEF/SDM, QC report |
| PG-ADM-06 | `/payouts` | Payout & rekonsiliasi | ADM-05 | Escrow, trigger payout batch, rekonsiliasi harian |
| PG-ADM-07 | `/disputes` | Dispute | ADM-06 | List dispute, mediasi, keputusan |
| PG-ADM-08 | `/badges` | Kelola badge | ADM-07 | **Definisi badge: kriteria + logo/ikon + XP reward** (admin-configurable, contoh: koleksi N C.Card, punya C.Card kreator A/B) |
| PG-ADM-09 | `/audit` | Audit log admin | ADM-08 | Lihat semua aksi admin (**append-only**): siapa, aksi, target, payload ringkas, IP/session, waktu — filter |
| PG-ADM-10 | `/investor` | Investor Data Pack | — | Ringkasan metrik kunci: GMV, user growth, drop performance, creator earnings, secondary volume — untuk founder tarik data cepat saat meeting. Tabel + chart sederhana. **BUKAN untuk publik** |

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
- `GET /sitemap.xml` — sitemap dinamis

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
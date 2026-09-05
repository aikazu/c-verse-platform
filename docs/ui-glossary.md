# UI Glossary — C.Verse Web (Space Arcade)

**Purpose:** Single source of truth for page titles, channel labels, and user-facing terms.
Every `PageHero` prop, nav label, and empty-state string must use these values — no synonyms.

## Page titles & channels

| Route | `channel` | `channelLabel` | `title` (h1) | Nav / UserMenu label |
|---|---|---|---|---|
| `/` | — | — | **C.Card** | — |
| `/home` | `00` | `BERANDA` | **Beranda** | Beranda |
| `/drops` | `01` | `DROPS` | **Drops** | Drops |
| `/drops/:id` | `01` | `DROPS` | `{drop.title}` (data-driven) | — |
| `/marketplace` | `02` | `MARKET` | **Marketplace** | Marketplace |
| `/browse` | `03` | `JELAJAHI` | **Jelajahi** | Jelajahi |
| `/leaderboard` | `04` | `PERINGKAT` | **Peringkat** | Peringkat |
| `/u/:username` | `05` | `PROFIL` | `{displayName}` | — |
| `/badges` | `06` | `LENCANA` | **Lencana** | Lencana |
| `/c/:username` | `06A` | `KREATOR` | `{displayName}` | — |
| `/creator` | `06B` | `KREATOR` | **Dasbor Kreator** | Dasbor Kreator |
| `/creator/drops/:id` | `06C` | `KREATOR` | `{drop.title}` | — |
| `/creator/payouts` | `06D` | `KREATOR` | **Riwayat Penarikan** | Penarikan & Royalti |
| `/cards/:id` | `07A` | `C.CARD` | `{drop.title} · #N` | — |
| `/cards/:id/3d` | `07B` | `C.CARD` | `{drop.title} · #N` | — |
| `/wallet` | `08` | `DOMPET` | **Dompet** | Dompet |
| `/collection` | `09` | `KOLEKSI` | **Koleksi** | Koleksi |
| `/me/manage` | `10A` | `KELOLA` | **Kelola C.Card** | Kelola C.Card |
| `/me/manage/verify-shipment` | `10B` | `KELOLA` | **Kirim ke Vault** | Kirim ke Vault |
| `/me/kyc` | `11` | `KYC` | **Verifikasi Identitas** | Verifikasi |
| `/me/privacy` | `12` | `PRIVASI` | **Privasi** | Privasi |
| `/orders` | `13A` | `PESANAN` | **Pesanan** | Pesanan |
| `/orders/:id` | `13B` | `PESANAN` | **Detail Pesanan** | — |
| `/drops/:id/checkout` | `14` | `CHECKOUT` | **Checkout** | — |
| `/notifications` | `15` | `NOTIFIKASI` | **Notifikasi** | Notifikasi |

Rules:
- Channel numbers are unique per route (no `CH:06` ×4 or `CH:10` ×2).
- PageHero renders a visible h1, useful context, actions, and an optional data ticker. It has no `extra` or `heroVisual` prop, animated illustration, or static ready indicator.
- Hero `sub` is only used when it adds context not in the title (e.g. handle `@karina` above a display name). Never repeat the title as sub/eyebrow.
- Card 3D uses a dedicated Space Arcade inspection header, retaining channel `07B / C.CARD` and the canonical data-driven h1. Controls: **Depan**, **Belakang**, **Jeda/Putar**, **Zoom**, **Reset tampilan**, **Mode fokus**. Artwork availability must never imply NFC verification.

## Vocabulary

| Concept | Canonical term | Notes |
|---|---|---|
| Home page | **Beranda** | Replaces `Cockpit` (theme jargon) and `Home` (English) in nav + h1 + aria. |
| Card variants | **Reguler** / **Signed** | Lowercase `signed` → `Signed`; `Premium (Signed)` / `Regular` removed. |
| Sale phases | **Raffle** / **Segera Diundi** / **Beli Langsung** / **Selesai** / **Akan Datang** | `FCFS` → `Beli Langsung`; `Draw Soon` / `Menunggu Draw` → `Segera Diundi`. |
| Storage | **Vault** (capital V, proper noun) | Never `vault`, `gudang vault`, `di vault` lowercase. |
| Withdrawal | **Penarikan** (user), **Penarikan & Royalti** (menu) | `Payout` only in code/API, not in UI. |
| Actor | **Kolektor** | Replaces `Pilot`, `Pemain`, `PILOT DOSSIER/CLEARANCE`, `PEMAIN` ticker. |
| Notifications | **Notifikasi** | Replaces `Inbox`, `SIGNAL`, `INBOX FEED`. |
| Order table | **Pesanan** | `<th>Order</th>` → `Pesanan`. |
| Currency | **C** (inline), **C-Coin** (balance label) | Consistent: `1 C = Rp…`, never mixed `C`/`C-Coin` in same card without reason. |
| Earnings balance | **C-Gems** | Saldo penghasilan (hasil jual, royalti, Dukungan diterima) — separate from C-Coin (saldo belanja); non-transferable. |
| Gem lock status | **Bisa dicairkan** / **Terkunci 24 jam** | Status lot C-Gems; Penarikan hanya untuk lot **Bisa dicairkan**. |
| Harga Marketplace | **Harga jual**, **Harga terendah**, **Harga tertinggi** | Tombol pembelian: **Beli langsung**. Hindari `buyout` dan terjemahan `floor` menjadi `Lantai`. |
| Penawaran harga | **Penawaran**, **Tawar**, **Terima penawaran**, **Batalkan penawaran** | Ganti `bid` dan `outbid` dengan tindakan atau keadaan yang dijelaskan langsung. |
| Pilihan kartu | **Pilih jenis kartu** | Ganti `Pilih Pool`; jelaskan Reguler tanpa tanda tangan dan Signed dengan tanda tangan kreator. |
| Isi saldo | **Isi saldo** | Gunakan untuk `top-up` pada tombol, konfirmasi, dan riwayat transaksi. |
| Penukaran saldo | **Tukar C-Gems ke C-Coin**, **Tukar** | Jelaskan bahwa penukaran tidak bisa dibatalkan. |
| Status transaksi | **Saldo ditahan sementara**, **Penahanan saldo selesai**, **Penyelesaian transaksi** | Padanan label `escrow_hold`, `escrow_release`, dan `settlement`; nilai API tidak berubah. |
| Kategori lencana | **Kategori**, **Tingkat**, **Syarat** | Hindari `keluarga`, `tier`, `kabinet prestasi`, dan `misi` untuk label navigasi atau tindakan. Nama lencana dan tingkat tetap mengikuti katalog. |
| Pemeriksaan kartu | **Terdaftar**, **Keaslian terverifikasi**, **Segel terdeteksi berubah** | Terdaftar melalui QR tidak membuktikan keaslian. Gambar yang berhasil dimuat juga bukan bukti verifikasi NFC. |
| Pemutakhiran daftar | **Muat ulang** | Ganti `Refresh` pada tombol dan label aksesibilitas. |

## Bahasa yang mudah dipahami

Keputusan bahasa UI, 2026-09-05: gunakan bahasa Indonesia yang umum, singkat,
dan langsung menjelaskan data atau tindakan. Hindari jargon pasar, istilah
internal sistem, terjemahan harfiah, serta slogan yang tidak membantu pengguna.

- Nama produk seperti C.Card, Drops, Marketplace, Vault, C-Coin, dan C-Gems
  tetap dipakai. Jelaskan istilah yang belum umum saat pertama dibutuhkan:
  Raffle adalah undian pembelian; Vault adalah tempat penyimpanan kartu C.Verse.
- Ringkasan Marketplace memuat jumlah kartu yang ditampilkan dan rentang
  harganya. Median dihapus dari ringkasan, bukan diganti menjadi rata-rata.
  Label **Termurah** mengacu pada urutan harga kartu yang sudah dimuat.
- Teks keadaan kosong menjelaskan hasil dan langkah berikutnya. Hindari kode
  dekoratif seperti `NO_LISTINGS` dan klaim jadwal rilis yang tidak didukung data.
- Teks konfirmasi menjelaskan dampak pada kartu atau saldo dengan bahasa umum.
  Penyederhanaan bahasa tidak mengubah biaya, batas, masa tunggu, persetujuan,
  atau aturan transaksi.
- Istilah teknis tetap boleh digunakan dalam kode, API, log, dan dokumen teknis.
  Jangan menampilkan nama variabel, token pembayaran, atau kode internal sebagai
  petunjuk bagi pengguna.
- Halaman publik, termasuk dokumen legal, tidak memuat fase pengembangan
  (`MVP`, `Y1`, `Y2`), target perekrutan kreator, jumlah minimum pengikut,
  atau panduan kerja internal. Ketentuan kreator menjelaskan kerja sama,
  lisensi, pembagian pendapatan, dan kewajiban yang relevan bagi kreator.
- Status legal belum final dan data identitas operator yang belum tersedia
  tetap ditampilkan sampai data sah tersedia. Tanggal pembaruan naskah tidak
  berarti dokumen sudah berlaku.
- Teks keuangan harus sesuai perhitungan sistem: biaya penarikan 1% dibulatkan
  ke atas ke C-Gems utuh; ringkasan konfirmasi menampilkan biaya dan perkiraan
  penerimaan. Batas 500 C-Coin sebelum verifikasi diterapkan saat isi saldo,
  bukan menghapus hak atas pengembalian dana atau penukaran C-Gems.

## Redundancy rule

Navigation and a visible page title may share a name. Do not hide the h1 to avoid
that repetition. Section headings should identify their own content rather than
repeat a decorative eyebrow.

Use ink surfaces, thin cyan borders, amber primary actions, and compact corners
across Web/Admin. Keep status/tier colors semantic. Copy must describe data,
state, or an action; omit decorative slogans, fake telemetry, and unverifiable
claims. Space Arcade is a visual direction, not a reason to rename product actions.

## Sumber

- Arahan pemilik dan peninjauan bahasa halaman publik, akun, transaksi, serta kreator, 2026-09-05.
- Implementasi PageHero, AuthForm, dan viewer C.Card, ditinjau 2026-09-05.
- [Peta halaman](02_pages.md) dan [keputusan teknis](06_tech_decisions.md).

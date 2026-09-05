# Database dan fixture pengembangan remote

> Status: [VALIDATED]
> Diperbarui: 2026-09-05. Data sintetis untuk pengembangan, bukan data bisnis.

## Baseline

`migrations/` berisi baseline 18 file berurutan ditambah migrasi
forward-only lencana dan integritas flow (2026-09-05). Setiap file maksimum
500 baris fisik, termasuk komentar/baris kosong. Baseline tetap utuh;
guard Vitest memeriksa urutan, batas baris, serta duplikasi fungsi baseline.

Operasi aplikasi dan E2E memakai project Supabase development remote yang
terhubung, bukan `supabase start`, Docker, atau database lokal. Sebelum operasi
data, konfirmasi ref project yang dipilih:

```powershell
$env:E2E_SUPABASE_PROJECT_REF = "rnsfgbhoahzvrbtvjjtw"
$env:E2E_SUPABASE_URL = "https://rnsfgbhoahzvrbtvjjtw.supabase.co"
# Muat E2E_SUPABASE_ANON_KEY dan E2E_SUPABASE_SERVICE_ROLE_KEY dari penyimpanan rahasia lokal.
```

`playwright.config.ts` hanya memulai API, Web, dan Admin di loopback lokal.
API menerima kredensial remote lewat environment, dengan `ENV=development`,
`ENABLE_DEMO_LOGIN=0`, dan `EMAIL_ENABLED=0`. Browser hanya menerima anon key.
Helper E2E memvalidasi ref serta hostname HTTPS sebelum request database,
memeriksa user fixture canonical, lalu memakai `admin/generate_link` + `verify`
server-side. Jadi tidak ada Mailpit, email OTP, atau akun baru yang dibuat oleh
flow E2E remote. Endpoint yang sudah aktif hanya boleh dipakai bila
`E2E_REUSE_SERVERS=1` disetel secara eksplisit.

```powershell
pnpm exec playwright test --project=web
npx supabase db query --linked --file supabase/tests/flow_integrity_test.sql
```

`flow_integrity_test.sql` memakai fixture sendiri dalam transaksi rollback.
Asersi mencakup custody secondary, shipment dua arah, Seed release/abort
berulang, pool raffle, FCFS, ledger, dan akses RPC akun suspended. Tidak ada
fixture atau saldo tes tersebut yang menetap setelah selesai.

Reset remote berulang dan seed ulang development telah diotorisasi pemilik bila
dibutuhkan implementasi atau verifikasi. Jalankan seluruh baseline dan seed,
bukan potongan file; jangan menjalankan ulang seed pada database berisi transaksi
nyata. Fixture memakai waktu relatif saat reset agar raffle dan pending flow
tetap dapat dicoba, sementara ID tetap stabil untuk tes.

### Remote development sudah di-reset secara terkendali

Setelah persetujuan eksplisit, project Supabase `rnsfgbhoahzvrbtvjjtw` di-reset
dengan `npx supabase db reset --linked --yes` pada 2026-09-05. Hasilnya
18 baseline migration dan seed: 10 `auth.users`, 11 profil (termasuk treasury),
8 drop, dan 58 kartu. Backup schema serta data `public`/`auth` sebelum reset
tersimpan lokal di `supabase/.temp/public-assets-reset/` yang diabaikan Git.

`db push` tidak menjalankan ulang file baseline yang telah diterapkan. Untuk DB
yang harus mempertahankan data, gunakan migrasi forward-only; jangan gunakan
baseline ini sebagai upgrade in-place. Reset Postgres tidak membersihkan R2,
dan reset ini tidak menghapus object R2 mana pun. Review referensi object
secara terpisah; jangan menghapus prefix profil/KYC atau bucket otomatis saat
reset.

## Skenario seed

Enam file terurut membangun 15 akun sintetis (+ treasury), 9 Drop, dan 184 kartu:

| File | Tanggung jawab |
|---|---|
| `seeds/00_identities.sql` | Akun OTP, profil/avatar, kreator, KYC dummy; katalog 43 lencana berasal dari migrasi |
| `seeds/10_catalog.sql` | Artwork/mesh, fase drop, stok dan kondisi kartu |
| `seeds/20_economy.sql` | Order, raffle, ownership, bid, shipment, QC, dispute |
| `seeds/25_ledgers.sql` | C-Coin, C-Gems, lot matang, payout, treasury, XP |
| `seeds/27_achievements.sql` | Arsip 126 kartu hadiah, lima persona Bronze-Nova, backfill lencana berdasarkan kriteria |
| `seeds/30_assertions.sql` | Read model admin/notifikasi dan assertion lintas domain |

| Persona / fixture | Cakupan |
|---|---|
| `demo@cverse.id` | Kolektor, koleksi tidak kosong, KYC pending, wallet dan vault |
| `admin@cverse.id` | Role admin; login OTP, bukan fixture TOTP/AAL2 |
| `karina@creator.id` | Kreator; 45 C-Gems matang untuk kontrak payout/support |
| Hype Collective / Nova Studio | Kreator lain dan variasi lot C-Gems |
| Rival | Pemilik `card-aespa-live-02`, target secondary market |
| Ghost / Marked | Profil anonim / suspended untuk pengujian masking |
| Atlas / Luna | Peserta tambahan agar 10 pemenang raffle benar-benar unik |
| `badge.bronze@cverse.id` sampai `badge.nova@cverse.id` | Lima persona pencapaian dengan 1/5/15/30/75 kartu hadiah, wallet nol, tier Collector I-V; sesi fixture remote |
| Treasury | Akun sistem terpisah, ledger pendapatan platform |
| Katalog | Live FCFS/raffle, scheduled, signed, sold-out, draft, Creator Seed |
| Transaksi | Primary ke vault, secondary, ship-out pasca-vault, ledger dua token |

ID `drop-aespa-live`, `drop-genesis-live`, `drop-aespa-signed`,
`drop-aespa-2027`, dan `drop-genesis-beta` adalah kontrak tes. Jangan mengganti
ID ini hanya untuk mengganti desain artwork. Assertion SQL di akhir seed
memeriksa saldo/ledger/lot, stok, ownership, dan fixture kritis.

`drop-aurora-raffle` menyediakan window raffle aktif 24 jam sejak reset;
`drop-genesis-live` menyediakan sisa stok FCFS setelah draw. Keduanya
dapat dicoba oleh Karina tanpa alokasi sebelumnya. Tes settlement memakai
kedua ID secara eksplisit, bukan menebak urutan katalog atau menunggu cron.

Saldo awal penting: Demo 320 C-Coin / 0 C-Gems; Rival 306 / 0;
Karina 70 / 45 (seluruh 45 matang); Hype 68 / 21 (7 terkunci);
Nova 40 / 17; treasury 360 C-Coin. Saldo adalah hasil ledger, bukan angka
cache yang berdiri sendiri. Fixture payout mengurangi lot matang secara FIFO;
setiap royalty/settlement/support memiliki sumber pembayar, setiap pendapatan
platform memiliki kredit treasury, dan refund raffle/bid memiliki hold awal.
Nilai ini berlaku tepat setelah reset, sebelum tes yang memutasi saldo.

### Rework lencana dan seed pencapaian

Migrasi `20260905071602_badge_catalog.sql` menyimpan 43 definisi dan
`20260905071652_badge_engine.sql` memasang evaluator atomik serta backfill.
Keduanya mempertahankan snapshot XP dan perolehan yang sudah ada. Reset
seed pengembangan memakai reward baru; tidak ada insert hadiah XP buatan
ke `user_badges`. Arsip Nova berisi kartu hadiah, sehingga tidak menambah
spend, order, atau progres pembelian primer/sekunder. NFC arsip berstatus
`unknown`, bukan klaim pernah diverifikasi dengan perangkat nyata.

Tingkat lencana yang diharapkan dapat dilihat di `/badges` dan profil
`/u/badge-bronze` sampai `/u/badge-nova`. Lencana nonaktif tetap terlihat
di daftar Admin dan dapat diaktifkan kembali. Pengguna lama yang baru
memenuhi syarat setelah pengaktifan dapat dievaluasi pada event berikutnya
atau melalui backfill service-only.

```powershell
if (-not $env:SUPABASE_DB_URL) { throw "Muat connection string database development remote terlebih dahulu" }
node supabase/tests/badge_engine_test.mjs $env:SUPABASE_DB_URL
pnpm test:e2e e2e/specs/18-badges.spec.ts --project=web
```

Tes integrasi memakai namespace fixture sendiri dan membersihkannya.
Konfirmasi bahwa connection string menargetkan project development yang
terhubung. Jangan memakai database produksi atau fallback database lokal.

KYC hanya memakai data dummy dan object key placeholder; file identitas tidak
dibuat atau diunggah. Preview dokumen KYC seed dapat mengembalikan 404 sampai
fixture privat yang sah disediakan. Status verifikasi kartu seed adalah
snapshot sintetis, bukan bukti scan NFC/CMAC fisik.

## Aset mock dan R2

`seed-assets.json` adalah manifest file, MIME, object key, `dropId`,
provenance, dan prompt final built-in ImageGen. `sourcePath` menunjuk sumber
repository; `seedUrl` adalah URL seed, bukan selalu path Static Assets.

Setiap Drop memiliki satu artwork depan-belakang yang unik. Keunikan berlaku
antar-Drop; unit bernomor dalam edisi Drop yang sama tetap memakai artwork
edisinya. Sembilan atlas tidak boleh memiliki URL, assignment Drop, atau
SHA-256 konten yang sama. Geometri kartu OBJ tetap satu bentuk netral; desain
depan dan belakang berasal dari atlas masing-masing Drop.

| Drop | Artwork khusus | Object key R2 |
|---|---|---|
| `drop-aespa-live` | Karina: Eclipse | `mock/v1/artworks/karina.jpg` |
| `drop-genesis-live` | Genesis: Monolith | `mock/v1/artworks/genesis.png` |
| `drop-aespa-signed` | Karina: Seraph Signed | `mock/v2/artworks/karina-seraph.png` |
| `drop-aespa-2027` | Aurora: Solstice 2027 | `mock/v2/artworks/aurora-solstice.png` |
| `drop-genesis-beta` | Genesis: Signal Draft | `mock/v2/artworks/genesis-signal.png` |
| `drop-aurora-raffle` | Aurora: Open Raffle | `mock/v1/artworks/aurora.png` |
| `drop-seed-karina-01` | Karina: Velvet Seed | `mock/v2/artworks/karina-velvet.png` |
| `drop-seed-karina-02` | Karina: Starlight Seed | `mock/v2/artworks/karina-starlight.png` |
| `drop-nova-archive-gifts` | Nova Archive: Gifted Constellation | `mock/v2/artworks/nova-constellation.png` |

Enam PNG baru disimpan di `supabase/fixtures/artworks/`, di luar bundle web,
dan memakai URL R2 sejak seed. Seraph, Velvet, dan Starlight adalah variasi
editorial AI dari referensi Karina yang sudah diberikan; pose, busana,
komposisi, dan desain belakang berbeda. Solstice, Signal, dan Constellation
adalah artwork AI original. Referensi Karina tetap untuk mock internal;
keberadaan file tidak membuktikan izin publikasi komersial.

Genesis/Aurora dan avatar Demo/Nova tetap tersedia di
`apps/web/public/mock/v1/`. Dua avatar memiliki konten berbeda; persona
tanpa avatar tetap menguji fallback. Atlas dipakai viewer OBJ dan daftar 2D.
`pnpm seed:assets` memeriksa signature, hash, duplikasi, dan cakupan seluruh
Drop dari `seeds/*.sql`. Guard Vitest menguji file yang disalin dengan nama
berbeda, assignment ganda, dan Drop tanpa artwork. Assertion SQL akhir seed
juga menolak Drop dengan URL artwork kosong atau berulang.

Semua 12 object manifest memakai bucket publik `cverse-assets` pada
`https://assets.c-verse.co`. `r2.dev` tetap nonaktif; `cverse-kyc` tetap
private. Jangan mengunggah artwork ke bucket KYC. Upload PNG baru harus
mempertahankan key, MIME `image/png`, dan cache immutable. Verifikasi HTTP,
SHA-256 terhadap file repository, serta CORS sebelum mengubah referensi DB.

```sh
pnpm seed:assets
pnpm seed:assets --base-url https://assets.c-verse.co --sql
```

Kedua perintah bersifat read-only: tidak mengunggah atau mengeksekusi SQL.
Mapping artwork memakai `drops.id`, sehingga referensi lama yang berulang
dapat dipisahkan tanpa reset. Model dan avatar dipetakan dari URL lokal yang
cocok persis. SQL hanya menyentuh URL artwork, model, dan avatar; tidak
mengubah inventory, transaksi, wallet, atau KYC. Nama dan narasi desain
tercatat pada `10_catalog.sql`.

Pemasangan 2026-09-05 memperbarui delapan Drop yang sudah ada di remote
development `rnsfgbhoahzvrbtvjjtw` tanpa reset. Dua migrasi lencana yang
tertunda juga diterapkan sebelum rilis Worker. Lima persona pencapaian dan
arsip kesembilan ditambahkan dari fixture canonical tanpa menjalankan ulang
ledger atau transaksi. Hasil remote: 9 Drop, 9 URL artwork berbeda, 184 kartu,
dan 43 definisi lencana. Seluruh sembilan artwork memiliki hash berbeda.
Runbook upload aplikasi, namespace profil, dan privasi ada di
`docs/08_deployment.md` bagian R2. Smoke R2 memerlukan
`TEST_PUBLIC_ASSETS=1`.

## Sumber

- `config.toml`, `migrations/`, `seeds/`, `seed-assets.json` dan guard test repository.
- [Supabase seed data](https://supabase.com/docs/guides/local-development/seeding-your-database).
- [Cloudflare R2 Workers API](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/).

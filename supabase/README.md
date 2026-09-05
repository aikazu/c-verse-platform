# Database dan fixture lokal

> Status: [VALIDATED]
> Diperbarui: 2026-09-05. Data sintetis untuk pengembangan, bukan data bisnis.

## Baseline

`migrations/` berisi baseline 18 file berurutan ditambah dua migrasi
forward-only lencana (katalog dan engine, 2026-09-05). Setiap file maksimum
500 baris fisik, termasuk komentar/baris kosong. Baseline tetap utuh;
guard Vitest memeriksa urutan, batas baris, serta duplikasi fungsi baseline.

```sh
npx supabase start
npx supabase db reset --local
npx supabase db lint --local
pnpm seed:assets
```

Reset lokal menjalankan `migrations/*.sql`, kemudian `seeds/*.sql` secara
leksikografis sesuai `config.toml`. Jalankan seluruh rangkaian, bukan satu
potongan seed. Jangan menjalankan ulang seed pada DB berisi transaksi nyata.
Fixture memakai waktu relatif saat reset agar raffle dan pending flow tetap
dapat dicoba; ID tetap stabil untuk tes. Reset juga mengembalikan URL aset lokal.

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
| `badge.bronze@cverse.id` sampai `badge.nova@cverse.id` | Lima persona pencapaian dengan 1/5/15/30/75 kartu hadiah, wallet nol, tier Collector I-V; login OTP lokal |
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

```sh
node supabase/tests/badge_engine_test.mjs postgresql://postgres:postgres@127.0.0.1:54322/postgres
pnpm test:e2e e2e/specs/18-badges.spec.ts --project=web
```

Tes integrasi memakai namespace fixture sendiri dan membersihkannya.
Jangan jalankan seed maupun tes mutasi tersebut ke database hosted.

KYC hanya memakai data dummy dan object key placeholder; file identitas tidak
dibuat atau diunggah. Preview dokumen KYC seed dapat mengembalikan 404 sampai
fixture privat yang sah disediakan. Status verifikasi kartu seed adalah
snapshot sintetis, bukan bukti scan NFC/CMAC fisik.

## Aset mock dan R2

`seed-assets.json` adalah manifest file, MIME, object key tujuan, provenance,
dan prompt final ImageGen. `sourcePath` adalah sumber file repository;
`seedUrl` adalah URL yang dipakai seed, bukan selalu path Static Assets.
Empat PNG di `apps/web/public/mock/v1/` adalah keluaran built-in ImageGen;
bukan foto identitas asli. Sumber `karina.jpg` dipindah ke
`supabase/fixtures/artworks/`, di luar bundle web. Runtime dan seed Karina
langsung memakai R2; `placeholder.obj` tetap dibundel. Referensi Karina hanya untuk mock
internal; keberadaan file tidak membuktikan izin publikasi komersial.

Artwork Genesis/Aurora berupa atlas depan-belakang, bukan poster tunggal.
Viewer OBJ membaca atlas; daftar 2D saat ini memakai URL atlas yang sama.
Varian katalog sengaja berbagi tiga artwork, tanpa URL palsu untuk setiap varian.
Avatar Demo/Nova tersedia; avatar null pada persona lain menguji fallback.

`pnpm seed:assets` memvalidasi file dan signature image serta menampilkan
SHA-256/ukuran/MIME dan mapping. Tidak terhubung ke jaringan atau mengunggah.
Enam object manifest sudah berada di `cverse-assets` (APAC) dan terverifikasi
HTTP 200, SHA-256 lokal cocok, serta CORS GET/HEAD di origin publik
`https://assets.c-verse.co`. Custom domain itu memakai TLS minimum 1.2 dan
`r2.dev` tetap nonaktif; `cverse-kyc` tetap private tanpa public domain.
Manifest memuat `publicBaseUrl` tersebut. `pnpm seed:assets` tetap hanya
memvalidasi dan mencetak rencana:

```sh
pnpm seed:assets --base-url https://assets.c-verse.co
pnpm seed:assets --base-url https://assets.c-verse.co --sql
```

Opsi `--sql` hanya mencetak SQL untuk ditinjau operator, bukan mengeksekusi.
Mapping mengubah URL lokal yang cocok persis pada `drops.artwork_url`,
`drops.artwork_3d_url`, dan `users.avatar_url`. Tidak menyentuh KYC.
Upload harus mempertahankan object key/MIME manifest. Jangan menyimpan file
ke bucket KYC atau mengganti URL DB sebelum objek dapat dibaca.

Alur fixture: file tervalidasi -> R2 `cverse-assets` -> origin aset HTTPS ->
URL di Postgres -> browser. Mapping remote sudah diterapkan setelah verifikasi
untuk 8 URL artwork, 8 model, dan 2 avatar. Reset lokal memakai R2 untuk Karina;
lima aset lain memakai Static Assets sampai SQL mapping sengaja diterapkan.
Tes offline memvalidasi sumber Karina tanpa mengunduh; smoke delivery R2
memerlukan `TEST_PUBLIC_ASSETS=1`. Endpoint/UI
upload artwork admin dan upload/hapus avatar user memakai bucket publik yang
sama, terpisah dari KYC. Runbook lengkap (termasuk namespace profil dan
privasi) ada di `docs/08_deployment.md` bagian R2.

## Sumber

- `config.toml`, `migrations/`, `seeds/`, `seed-assets.json` dan guard test repository.
- [Supabase seed data](https://supabase.com/docs/guides/local-development/seeding-your-database).
- [Cloudflare R2 Workers API](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/).

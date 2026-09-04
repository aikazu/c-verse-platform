# Database dan fixture lokal

> Status: [VALIDATED]
> Diperbarui: 2026-09-05. Data sintetis untuk pengembangan, bukan data bisnis.

## Baseline

`migrations/` berisi 18 file final berurutan, maksimum 500 baris fisik
per file (termasuk komentar/baris kosong). Hardening grant, masking bid
anonim, dan object key KYC R2 sudah dilebur; tidak ada override 19/20
atau migrasi KYC tambahan. Guard Vitest memeriksa batas dan duplikasi.

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

### Remote tidak otomatis mengikuti konsolidasi

Pemeriksaan baca-saja 2026-09-05 menunjukkan remote masih mencatat 21 versi
migrasi lama. `db push` tidak menjalankan ulang file applied yang diedit.
Jangan menghapus migration history saja atau menganggap reset sebelumnya
berarti schema kosong. Untuk target development disposable, minta persetujuan
reset remote baru, pastikan project/environment, backup bila perlu, lalu
terapkan baseline dan seed bersama. Untuk DB yang harus mempertahankan data,
pakai migrasi forward-only terpisah; jangan gunakan baseline ini sebagai upgrade
in-place. Pekerjaan ini tidak menjalankan reset, seed, atau repair remote.
Reset Postgres juga tidak membersihkan R2. Review referensi object secara
terpisah; jangan menghapus prefix profil/KYC atau bucket otomatis saat reset.

## Skenario seed

Lima file terurut membangun 10 akun sintetis (+ treasury), 8 drop, dan 58 kartu:

| File | Tanggung jawab |
|---|---|
| `seeds/00_identities.sql` | Akun OTP, profil/avatar, kreator, KYC dummy, badge |
| `seeds/10_catalog.sql` | Artwork/mesh, fase drop, stok dan kondisi kartu |
| `seeds/20_economy.sql` | Order, raffle, ownership, bid, shipment, QC, dispute |
| `seeds/25_ledgers.sql` | C-Coin, C-Gems, lot matang, payout, treasury, XP |
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

KYC hanya memakai data dummy dan object key placeholder; file identitas tidak
dibuat atau diunggah. Preview dokumen KYC seed dapat mengembalikan 404 sampai
fixture privat yang sah disediakan. Status verifikasi kartu seed adalah
snapshot sintetis, bukan bukti scan NFC/CMAC fisik.

## Aset mock dan R2

`seed-assets.json` adalah manifest file, MIME, object key tujuan, provenance,
dan prompt final ImageGen. Empat PNG baru di `apps/web/public/mock/v1/`
adalah keluaran built-in ImageGen; bukan foto identitas asli. `karina.jpg`
dan `placeholder.obj` tetap dipertahankan. Referensi Karina hanya untuk mock
internal; keberadaan file tidak membuktikan izin publikasi komersial.

Artwork Genesis/Aurora berupa atlas depan-belakang, bukan poster tunggal.
Viewer OBJ membaca atlas; daftar 2D saat ini memakai URL atlas yang sama.
Varian katalog sengaja berbagi tiga artwork, tanpa URL palsu untuk setiap varian.
Avatar Demo/Nova tersedia; avatar null pada persona lain menguji fallback.

`pnpm seed:assets` memvalidasi file dan signature image serta menampilkan
SHA-256/ukuran/MIME dan mapping. Tidak terhubung ke jaringan atau mengunggah.
Setelah bucket/CDN benar-benar disiapkan dan SEMUA objek diverifikasi HTTP:

```sh
# Ganti host contoh dengan origin aset HTTPS yang telah diverifikasi.
pnpm seed:assets --base-url https://assets.example.test
pnpm seed:assets --base-url https://assets.example.test --sql
```

Opsi `--sql` hanya mencetak SQL untuk ditinjau operator, bukan mengeksekusi.
Mapping mengubah URL lokal yang cocok persis pada `drops.artwork_url`,
`drops.artwork_3d_url`, dan `users.avatar_url`. Tidak menyentuh KYC.
Upload harus mempertahankan object key/MIME manifest. Jangan menyimpan file
ke bucket KYC atau mengganti URL DB sebelum objek dapat dibaca.

Alur target: file tervalidasi -> R2 `cverse-assets` -> origin aset HTTPS ->
URL di Postgres -> browser. Saat ini file mock dilayani Static Assets web;
bucket `cverse-assets` dan fitur upload artwork/avatar belum diaktifkan.
Runbook lengkap (termasuk namespace profil dan privasi) ada di
`docs/08_deployment.md` bagian R2.

## Sumber

- `config.toml`, `migrations/`, `seeds/`, `seed-assets.json` dan guard test repository.
- [Supabase seed data](https://supabase.com/docs/guides/local-development/seeding-your-database).
- [Cloudflare R2 Workers API](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/).

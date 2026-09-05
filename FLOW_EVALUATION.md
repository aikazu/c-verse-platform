# Evaluasi flow Platform - 2026-09-05

> Status: [VALIDATED] - perbaikan dan batas verifikasi dicatat di bawah.
> Cakupan: aplikasi Web, API, Admin, RPC/RLS, dan kontrak flow MVP.
> Target integrasi: Supabase development `rnsfgbhoahzvrbtvjjtw`.

## Hasil utama

Evaluasi menghubungkan halaman, endpoint, aturan akses, transaksi database,
dan hasil yang terlihat pengguna. Perbaikan berikut telah diimplementasikan:

| Area | Gap yang ditemukan | Perilaku setelah perbaikan |
|---|---|---|
| Admin | RLS pengguna menyembunyikan draft, order, shipment, payout, dan batch NFC dari panel admin | Tujuh endpoint baca khusus memeriksa session, role admin, dan suspension; respons private/no-store |
| Pembuatan drop | Admin pembuat menjadi penerima pendapatan kreator | Admin memilih kreator aktif; API memvalidasi record, role, dan suspension target |
| Storefront kreator | Handle publik mengembalikan draft/cancelled; status kreator diabaikan | Semua jalur publik memakai eligibility yang sama dan hanya menghitung/menampilkan drop publik |
| Cache katalog | Daftar personal yang dapat berisi draft memakai public cache | Daftar authenticated private/no-store; katalog anonim tetap cache 60 detik |
| Login | Guest secondary buntu; OAuth kehilangan halaman tujuan | Login gate mempertahankan route; OAuth kembali ke origin lalu mengonsumsi tujuan lokal tervalidasi, sekali pakai, maksimum 10 menit |
| Raffle/FCFS | Premium-only dapat masuk reguler, peserta both tidak setara, stok defect dapat dialokasikan | Pool dipatuhi, regular/both diundi bersama, stok wajib inventory, waktu entry diperiksa; gagal alokasi direfund |
| Checkout | Deep link dapat menawarkan pembayaran pada fase/pool yang tidak tersedia | UI memeriksa FCFS dan stok, mengarahkan saldo kurang ke wallet; hasil draw tetap tampil selama FCFS |
| Secondary | Harga 1/2 C tidak bisa settle; kartu di tangan owner dapat langsung dianggap di vault | Harga minimum 3 C; non-Seed wajib kembali ke vault sebelum settlement; bid pada inventory tanpa owner ditolak |
| Shipment | Trade bersamaan dengan pengiriman, inbound menjadi with_owner, request dianggap QC passed, tracking menimpa order lama | Lock kartu dan transaksi shipment menjaga custody; delivered mengikuti tujuan; QC dan order historis tetap akurat |
| Antrean admin | Shipment tanpa order tidak dapat diproses melalui UI | Antrean mandiri memakai shipment ID; packing, batal sebelum dikirim, kirim, dan selesai tersedia sesuai transisi |
| Seed | Accepted bid lama dipakai pada resale; key abort per kartu menghalangi refund berikutnya | Hanya bid belum settled diproses; refund idempotent per bid/order; Seed pending bisa dikembalikan; release tetap wajib vault + NFC |
| Akun suspended | Pengguna dapat melewati penjagaan API lewat RPC atau PATCH kartu | Mutasi RPC memeriksa akun aktif; direct update kartu dicabut agar listing memakai RPC |
| NFC | Hasil verifikasi scan turun menjadi Registered setelah navigasi viewer | Receipt server terikat kartu selama 60 detik meneruskan hasil; tidak mengulang counter atau mengalahkan status tamper |
| Email | Queue tidak meneruskan konfigurasi/binding Worker dengan benar | Worker env dipakai untuk DB dan pengiriman; EMAIL_ENABLED ikut pada queue dan alert cron |
| Dispute | Status selesai tersimpan tanpa refund/strike; suspend menargetkan pembeli yang melapor | Tiga resolusi yang belum lengkap ditolak 409 sebelum mutasi; review/catatan tetap tersedia |
| Pemulihan fixture | Assertion reset masih membatasi 6 aset setelah katalog menjadi 12 | Allowlist mengikuti manifest 12 aset; regresi mendeteksi drift kontrak sebelum reset |

## Peta cakupan

Review sumber dilakukan untuk seluruh 12 kelompok flow pada `docs/03_flows.md`.
Review sumber, unit test, uji SQL, dan browser memiliki cakupan berbeda;
baris berikut tidak menyatakan semua integrasi eksternal sudah diuji langsung.

| Flow | Bukti dan batas pemeriksaan |
|---|---|
| 1. Raffle dan FCFS | Regresi SQL remote: waktu entry, pool/refund, defect, FCFS setelah kalah, satu alokasi/drop; browser entry point dan state UI |
| 2. Fulfillment | RPC remote outbound/inbound, shipment aktif, custody; API schema/auth dan panel admin |
| 3. Settlement | SQL remote secondary/Seed/FCFS, C-Coin versus ledger, Gems versus ledger/lot; tidak mengirim dana ke provider |
| 4. NFC Android | Crypto/receipt dan route test; browser memakai NDEF mock, bukan perangkat fisik |
| 5. QR/iOS | QR publik/guest dan viewer; iOS SUN perangkat nyata belum diuji |
| 6. Ownership | Transfer title hanya setelah custody memenuhi gate; Seed resale dan abort diuji dalam transaksi rollback |
| 7. Marketplace/bid | Login guest, nominal, custody, hold/cancel, limit dan masking melalui cakupan yang relevan |
| 8. Wallet/top-up/payout | Penjagaan saldo, Gems, KYC, request/refund dan webhook dicakup suite API; transaksi Midtrans/IRIS nyata belum dijalankan |
| 9. Admin | Pembacaan lintas akun, role/suspension, create drop, dispute; batas operasional di bawah masih berlaku |
| 10. Creator Seed | Pending sale, return-to-vault, NFC gate, release, resale, tiga abort dan retry tanpa double-credit |
| 11. Akun kreator | Review provisioning/rollback, penerima drop, env email; tidak mengirim email akses ke orang lain |
| 12. KYC | Suite API mencakup storage/auth/review dan error; dokumen seed dummy tidak membuktikan upload R2 produksi |

Login, profil, koleksi, notifikasi, lencana, leaderboard, dan halaman legal
turut dibaca sebagai alur pendukung. Tidak ada redesign atau pergantian stack.

## Verifikasi dan perubahan lingkungan

- Empat migrasi forward-only diterapkan ke remote development; baseline
  migration tetap utuh. Setelah E2E, reset/reseed remote memulihkan fixture
  sintetis. Reset awal mengungkap allowlist aset usang; reset penuh berikutnya
  lulus setelah perbaikan. Seluruh 12 objek R2 memberi HTTP 200 sebelum mapping.
- `supabase/tests/flow_integrity_test.sql`: 35 asersi lulus setelah penerapan.
  Seluruh fixture/ledger test tersebut berada dalam transaksi rollback, dan
  lulus kembali setelah reset. Tidak ada mismatch C-Coin/Gems terhadap ledger
  atau lot Gems, fixture regresi tertinggal, maupun izin direct UPDATE kartu.
- Gates berurutan format, lint:fix, typecheck, test, lint, build lulus;
  617 test pada 87 file. API boundary check: nol pelanggaran. Mirror: seluruh
  18 file identik. Bundle hosting memakai Supabase remote dan API same-origin;
  pemeriksaan bundle menolak alamat API lokal dan service-role key.
- Browser Web: 32 kasus terfokus tervalidasi melalui run utama (30 lulus)
  dan rerun terarah setelah dua assertion state-dependent diperbaiki. Admin:
  9/9 lulus, termasuk publish draft dari UI dan fulfillment disposable sampai
  delivered. Data transaksi tes dipulihkan melalui reset development di atas.
- Konfigurasi lokal pengguna tidak ditimpa. Harness E2E memvalidasi project
  dan hostname remote, memakai fixture session, mematikan email, dan hanya
  meneruskan anon key ke browser. Tidak ada database lokal/Docker.
- Bukti E2E di atas memakai aplikasi lokal dengan database development remote.
  Rilis Web/API/Admin menggunakan build hosting yang sama; hasil deployment
  dan smoke hostname dilaporkan terpisah saat penyerahan rilis.

## Gap yang masih terbuka

1. **Penyelesaian dispute**: sumber dana refund setelah settlement belum
   diputuskan, termasuk perlakuan bagian seller/royalti/revenue. Strike dan
   suspension memerlukan target eksplisit, catatan tindakan, serta durasi.
   Aksi final sekarang diblokir agar tidak memberi hasil sukses palsu.
2. **Provisioning NFC/QC operasional**: panel batch masih bersifat baca;
   registrasi UID, penulisan NDEF/SDM, dan hasil QC lengkap belum menjadi
   satu alur admin. Tidak memalsukan NFC verified untuk menutup gap ini.
3. **Validasi eksternal**: OTP/Google sungguhan, NFC Android/iOS fisik,
   Midtrans/IRIS, dan pengiriman kurir memerlukan pengujian terpisah.
   Gateway ingress khusus webhook pembayaran belum dibuat; callback provider
   tidak dapat menembus perimeter WARP saat ini. API utama tetap privat.
4. **Kontrak lanjutan kreator/lencana**: bio/tautan sosial, penyajian traffic
   analytics, breakdown pendapatan kreator pada investor, serta CRUD penuh
   definisi badge belum seluruhnya sesuai cerita produk. Katalog 43 badge
   dan kontrol aktivasi yang ada dipertahankan.
5. **Beban/concurrency menyeluruh**: regresi menjaga lock dan idempotensi
   yang diubah; evaluasi ini bukan load test seluruh race lintas kartu atau
   seluruh kombinasi kegagalan provider.

## Sumber

- `AGENTS.md`, `docs/00_readme.md`, `docs/03_flows.md`,
  `docs/04_user_stories.md`, `docs/07_constraints.md`, `docs/08_deployment.md`.
- Implementasi `apps/web`, `apps/admin`, `apps/api`, dan baseline/RPC di
  `supabase/migrations`; kode menjadi sumber perilaku yang diamati.
- Empat migrasi integritas flow bertanggal 20260905 dan
  `supabase/tests/flow_integrity_test.sql`.
- Unit/route tests, harness `e2e/`, serta review independen atas custody,
  idempotensi Seed, dan receipt NFC pada perubahan akhir.

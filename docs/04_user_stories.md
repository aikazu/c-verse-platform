# 04 — User Stories MVP

> Status: [DRAFT]
> Last updated: 2026-08-12
> Format: Given / When / Then. ID: US-{AREA}-{NNN}.
> Mapping ke halaman: `02_pages.md`. Mapping ke fitur:
> `01_scope.md`.

## A. Public (tanpa login)

### US-PUB-001 — Lihat katalog drop
```
Given visitor membuka /drops
When halaman dimuat
Then tampil grid drop aktif + upcoming
And setiap kartu drop menampilkan kreator, harga (C-Coin),
   dan unit tersisa
```

### US-PUB-002 — Lihat detail drop dengan countdown
```
Given visitor membuka /drops/:dropId
When drop masih berlangsung
Then tampil countdown real-time, artwork, harga, unit tersisa
And tombol beli aktif jika unit tersisa > 0
And tombol beli menuntun ke login jika belum login
```

### US-PUB-003 — Halaman kartu (info) tanpa login
```
Given visitor membuka /cards/:cardId (via QR di dus / link)
When halaman dimuat
Then tampil info kartu: kreator, drop, unit number (#X dari Y),
   jejak ownership, bid tertinggi, harga buyout (jika ada),
   status verifikasi
And ada tombol untuk membuka halaman 3D kartu
```

### US-PUB-004 — Tap NFC langsung ke halaman 3D kartu
```
Given visitor men-tap kartu fisik (Chrome Android / iOS SUN URL)
When halaman 3D kartu terbuka
Then tampil 3D interactive viewer + verified badge "Verified Card"
   (CMAC match — HANYA muncul lewat tap NFC)
And info singkat kartu tampil: Series (link ke drop), Unit number
   (#X dari Y), Kreator (link), Release date, Owner (link)
And ownership history TIDAK tampil di halaman 3D — pindah ke
   halaman info kartu (PG-CARD-01)
```

### US-PUB-005 — Marketplace (buyout)
```
Given visitor membuka /marketplace
When halaman dimuat
Then tampil kartu yang owner-nya memasang buyout price
And bisa membeli langsung di harga buyout (login gate)
```

### US-PUB-006 — Browse (cari kartu + bid langsung)
```
Given visitor membuka /browse
When mencari kartu/kreator
Then tampil hasil pencarian kartu
And user bisa mengajukan bid ke kartu WALAU owner tidak
   memasang harga (login gate)
```

### US-PUB-007 — Leaderboard
```
Given visitor membuka /leaderboard
When halaman dimuat
Then tampil peringkat kolektor berdasarkan aktivitas/spending
```

### US-PUB-008 — Registrasi & login
```
Given visitor membuka /login
When memilih Google OAuth atau email OTP
Then akun dibuat/di-login via Supabase Auth
And email OTP WAJIB melewati captcha anti-spam (Cloudflare Turnstile)
And diarahkan ke /home
```

### US-PUB-009 — Profil publik
```
Given visitor membuka /u/:username
When pemilik profil tidak mengaktifkan privacy anonymous
Then tampil koleksi, level, badge, dan ranking leaderboard
And kartu dalam koleksi menautkan ke halaman kartu masing-masing
```

### US-PUB-010 — Profil disembunyikan (privacy anonymous)
```
Given visitor membuka /u/:username
When pemilik profil mengaktifkan privacy anonymous
Then profil tidak menampilkan koleksi/level/badge/ranking
And hanya menampilkan username (atau placeholder anonymous)
```

### US-PUB-011 — Halaman kreator publik (list drop)
```
Given visitor membuka /c/:username
When halaman dimuat
Then tampil handle, bio, dan link media sosial kreator
And TIDAK menampilkan jumlah follower
And list drop kreator (published/live/upcoming) ditampilkan
And setiap drop menautkan ke halaman detail drop
And drop yang belum publish tidak tampil
```

## B. User / Kolektor (login)

### US-USR-001 — Checkout "siapa cepat"
```
Given user membuka detail drop dengan unit tersisa > 0
When mengklik "Beli" dan saldo C-Coin cukup
Then DEFAULT: kartu disimpan di inventory (vault) —
   tanpa alamat/ongkir, fisik dipegang platform
And OPSIONAL: user bisa memilih kirim fisik sekarang —
   isi alamat + bayar ongkir C-Coin
And saldo di-debit atomik (harga + ongkir bila kirim fisik)
And order dibuat dengan status PAID
And notifikasi email terkirim
And user tidak bisa checkout drop yang sama > 1 kartu
```

### US-USR-001b — Simpan di inventory (vault, DEFAULT)
```
Given user checkout drop
When memilih "simpan di inventory" (default)
Then kartu ter-bind ke koleksi user secara virtual
And TIDAK ada alamat pengiriman, ongkir, atau tracking
And status order langsung menuju SETTLED setelah QC
And user bisa minta kirim kapan saja via "Kirim dari vault"
   (bayar ongkir saat itu, bukan saat checkout)
```

### US-USR-002 — Gagal checkout karena saldo kurang
```
Given user membuka checkout dengan saldo C-Coin tidak cukup
When mengklik "Beli"
Then checkout digagalkan
And user diarahkan ke halaman top-up (dengan disclosure
   "saldo tidak dapat diuangkan")
```

### US-USR-003 — Race kondisi unit terakhir
```
Given dua user checkout bersamaan pada unit terakhir
When transaksi di-proses
Then hanya satu order yang berhasil dibuat
And user kedua menerima pesan "Unit sudah habis"
```

### US-USR-004 — Lihat order & tracking
```
Given user memiliki order dengan delivery_option='shipping'
When membuka /orders/:orderId
Then tampil timeline status (PAID → QC → SHIPPED → DELIVERED)
And no resi tampil saat status SHIPPED
And order vault (inventory) TIDAK menampilkan tracking/alamat —
   cukup status PAID → QC → SETTLED
```

### US-USR-005 — Lihat wallet C-Coin & top-up
```
Given user membuka /wallet
When halaman dimuat
Then tampil saldo C-Coin
And mutasi (ledger) ditampilkan append-only
And tombol "Top-up" tersedia (Midtrans Snap) dengan disclosure
   "saldo tidak dapat diuangkan"
```

### US-USR-006 — Tap NFC → halaman 3D kartu (Android)
```
Given user men-tap kartunya (Chrome Android 89+)
When halaman 3D kartu terbuka
Then badge "Verified Card" tampil (CMAC match)
And info singkat kartu tampil: series, unit number, kreator,
   release date, owner (masing-masing link ke halaman terkait)
And ownership history TIDAK di halaman 3D — ada di halaman info
```

### US-USR-007 — Halaman info kartu via QR (iOS / non-NFC)
```
Given user iOS membuka halaman kartu via QR di dus
When halaman info dimuat
Then tampil status "Registered" (tanpa CMAC)
And label status menjelaskan verifikasi lebih lemah
```

### US-USR-007b — Secondary: vault default, ship-out opsional
```
Given user menang/terima kartu di secondary (buyout / bid accept)
When settlement selesai
Then DEFAULT: kartu tetap di vault — ownership pindah di ledger,
   fisik tidak bergerak
And OPSIONAL: user minta seller kirim fisik sekarang:
   isi alamat + bayar ongkir C-Coin + tracking
   (seller kirim dari lokasinya ATAU dari vault platform)
And ownership sudah berpindah sejak settlement (kirim tidak
   menunda kepemilikan)
And user bisa minta ship-out kapan saja setelah settlement
```

### US-USR-007c — Kirim kartu dari vault
```
Given user memiliki kartu dengan lokasi 'platform_vault'
   (beli primary simpan di inventory ATAU secondary kirim ke platform)
When membuka /me/manage -> pilih kartu -> "Kirim dari vault"
Then isi alamat + bayar ongkir C-Coin (integer ≥ 1)
And shipment dibuat (packing -> 3PL -> tracking -> delivered)
And lokasi kartu berubah ke 'with_owner' saat delivered
```

### US-USR-007d — Secondary: seller kirim ke vault, verified, baru payout
```
Given kartu terjual di secondary (buyout / bid accept)
When settlement diproses
Then jika kartu location = 'with_owner':
     -> seller WAJIB kirim kartu ke platform untuk verifikasi
     -> platform terima -> NFC verify + QC ringan
     -> jika verified: vault masuk inventory buyer, seller payout
     -> jika gagal verify: dispute, seller tidak dibayar
And jika kartu location = 'platform_vault':
     -> langsung selesai: ownership pindah, seller langsung dibayar
     -> tanpa perlu kirim fisik
```

### US-USR-008 — Pasang buyout price di kartu
```
Given user memiliki kartu terverifikasi
When membuka /me/manage dan memasang buyout price
Then kartu tampil di /marketplace
And user bisa mengubah/mencabut buyout price kapan saja
   (selama belum dibeli)
```

### US-USR-009 — Bid langsung di kartu (offer, C-Coin di-hold)
```
Given user menemukan kartu di /browse (dengan atau tanpa buyout)
When mengajukan bid/offer
Then nominal bid integer minimal 1 C-Coin (tanpa desimal)
And C-Coin bidder di-hold (1 active bid per kartu = tertinggi)
And owner menerima notifikasi bid
And bid TIDAK mengikat sampai owner accept
```

### US-USR-010 — Owner accept bid (tanpa reject)
```
Given owner menerima bid active di salah satu kartunya
When memilih "Accept"
Then accept → transfer ownership + notif ke bidder
And TIDAK ada opsi reject untuk owner
```

### US-USR-010b — Bid lebih tinggi meng-outbid bid lama
```
Given kartu memiliki 1 bid active
When bidder lain mengajukan bid lebih tinggi
Then bid lama status outbid
And C-Coin bidder lama otomatis kembali ke saldo
And bid baru menjadi active
```

### US-USR-010c — Bidder cancel bid sendiri
```
Given bidder memiliki bid active (atau outbid) di suatu kartu
When membatalkan bidnya sendiri
Then C-Coin bid-nya release kembali ke saldo
```
> C-Coin bid outbid/cancel tidak bisa di-klaim siapapun selain
> bidder pemiliknya (kembali otomatis ke saldo owner C-Coin).

### US-USR-011 — KYC
```
Given user akan melakukan payout/disbursement ke IDR, ATAU
   akumulasi top-up mencapai threshold besar
   (KYC HANYA untuk cash-out/withdrawal — validasi lawyer 2026-08-13)
When trigger terpenuhi
Then wajib menyelesaikan KYC (KTP, selfie, NPWP opsional)
   sebelum payout diproses
   (TIDAK ada KYC untuk pasang buyout, accept bid, atau top-up rutin)
```

### US-USR-012 — Level naik melalui XP
```
Given user menghabiskan C-Coin untuk transaksi
When akumulasi XP (spend 1 C-Coin = 1 XP) mencapai kelipatan 10
Then level user naik
And top-up TIDAK menambah XP/progress level
And reward XP badge ikut menambah progress level
```

### US-USR-013 — Badge dari definisi admin
```
Given admin mendefinisikan badge (kriteria + ikon + XP reward)
   di admin page
When user memenuhi kriteria
Then user mendapat badge + XP reward
And XP terkumpul menaikkan level user
And badge tampil di profil & koleksi
```

### US-USR-014 — Privacy anonymous
```
Given user membuka /me/privacy
When mengaktifkan "privacy anonymous"
Then profil tidak lagi tampil publik
And koleksi/level/badge/ranking disembunyikan dari /u/:username
```

### US-USR-015 — History bid per kartu
```
Given user membuka halaman info kartu
When melihat riwayat bid
Then tampil bid 90 hari terakhir (semua status)
And bid berstatus accepted (complete) tampil selamanya
```

## C. Kreator

### US-CRT-001 — Lihat analitik pendapatan
```
Given kreator login
When membuka /creator
Then tampil traffic & pendapatan: total revenue, per-drop,
   jumlah unit sold, payout status
And TIDAK ada akses ke halaman admin/operasional
```

### US-CRT-002 — Lihat royalti secondary
```
Given kreator memiliki kartu yang di-resale di secondary
When membuka /creator/payouts
Then tampil royalti 7,5% per resale (lifetime)
And riwayat payout dengan fee 1% dan withholding pajak
```

## D. Admin (app terpisah)

### US-ADM-001 — Register kreator hasil rekrutan off-platform
```
Given ops telah merekrut & menyepakati kreator via direct contact
When ops membuka /creators dan menambah data kreator
Then data kreator tersimpan (nama, handle, email, bank, status)
And status awal = "active" (TIDAK ada status "pending approval")
And kreator dapat login dan melihat /creator
```

### US-ADM-002 — Buat drop
```
Given artwork final sudah di-approve off-platform
When admin membuka /drops dan membuat drop baru
Then set artwork, harga (C-Coin), jumlah unit, signed_count
   (ceil(total/10)), jadwal drop
And drop bisa di-publish (H-7) atau di-schedule
```

### US-ADM-003 — Kelola order & fulfillment
```
Given ada order PAID
When admin membuka /orders
Then lihat semua order + status
And bisa update status (QC → SHIPPED) dan input no resi
And auto-release escrow terjadi saat DELIVERED + H+7
```

### US-ADM-004 — Provisioning batch NFC
```
Given ada batch tag NTAG 424 DNA baru dari vendor
When admin membuka /nfc dan register batch
Then tag di-assign UUID↔UID
And konfigurasi NDEF/SDM (URL SUN + mirror) dilakukan
And hasil QC tiap unit tercatat (defect < 2%)
```

### US-ADM-005 — Payout batch & rekonsiliasi
```
Given escrow sudah release (settlement)
When admin membuka /payouts dan trigger payout
Then payout batch dibuat (Selasa H+1, fee 1%, withholding)
And rekonsiliasi harian: top-up webhook vs ledger vs float
   cocok (accuracy 100%)
```

### US-ADM-006 — Tangani dispute
```
Given kolektor mengajukan dispute
When admin membuka /disputes
Then lihat bukti + riwayat transaksi
And bisa memutuskan (refund / strike / suspend)
And keputusan tercatat di ledger
```

### US-ADM-007 — Definisi badge
```
Given admin membuka /badges
When membuat/ubah definisi badge
Then set kriteria (mis. koleksi N C.Card, punya C.Card kreator
   A/B), logo/ikon, dan XP reward (experience untuk naik level)
And user yang memenuhi kriteria otomatis mendapat badge + XP
```

### US-ADM-008 — 2FA admin (TOTP wajib)
```
Given admin pertama kali login (Google OAuth / email OTP)
When halaman enrollment 2FA tampil
Then scan QR authenticator + simpan recovery codes
And sesi dasar (aal1) TIDAK bisa buka UI privileged
And setelah verifikasi kode TOTP, sesi upgrade ke aal2
And login berikutnya: kode TOTP diminta tiap kali sebelum
   UI privileged terbuka
And recovery codes bisa dipakai jika HP hilang
And reset enrollment (break-glass) hanya oleh admin lain
```

### US-ADM-009 — Audit log semua aksi admin
```
Given admin melakukan aksi (CRUD, payout trigger, config, login)
When aksi selesai
Then catatan append-only dibuat: siapa, aksi, target, ringkasan,
   IP/session, waktu
And di /audit bisa di-filter (tanggal, admin, tipe aksi)
And catatan TIDAK bisa di-edit atau dihapus (retensi ≥ 1 tahun)
```

## E. Edge Cases (wajib di-cover)

| Kode | Skenario | Perilaku |
|------|----------|----------|
| EDGE-01 | Tap NFC gagal deteksi | Fallback scan QR di dus |
| EDGE-02 | Tag konflik/duplicate UID | Tolak + flag investigasi fraud |
| EDGE-03 | Tamper terdeteksi | Flag irreversibel + dokumentasi foto |
| EDGE-04 | HP/browser tanpa NFC | Fallback QR |
| EDGE-05 | Verify tanpa akun | Halaman kartu (3D/info) publik terbuka tanpa login — data minim (UU PDP) |
| EDGE-06 | Order rusak/hilang saat pengiriman | Buyer foto bukti -> dispute (F020) -> admin review -> refund ke metode asal / replace / kompensasi C-Coin. Kartu tetap di vault platform, tidak dikembalikan ke seller. |
| EDGE-07 | Top-up dibuka? | Bisa setelah T&C final + cap saldo; wallet/ledger sudah live di dev/staging |

## Sumber

- `02_pages.md` (halaman), `01_scope.md` (fitur),
  `03_flows.md` (alur).
- `20_product/02_user_journey.md` (per persona).
- `20_product/05_nfc_ux.md` (edge cases E1-E5).
- `20_product/06_auction_mechanics.md` (limit & anti-fraud).
- Diskusi founder 2026-08-12: tanpa approval onboarding;
  secondary = Marketplace (buyout) + Browse (bid langsung di
  kartu); verifikasi melekat di halaman kartu (3D dari tap,
  info dari QR); leaderboard punya halaman sendiri.
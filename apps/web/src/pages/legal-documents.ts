export type LegalTable = {
  headers: string[];
  rows: string[][];
};

export type LegalSection = {
  id: string;
  title: string;
  paragraphs?: string[];
  bullets?: string[];
  table?: LegalTable;
  note?: string;
};

export type LegalSource = {
  label: string;
  href?: string;
};

export type LegalDocument = {
  slug: string;
  code: string;
  title: string;
  shortTitle: string;
  description: string;
  status: string;
  updated: string;
  version: string;
  audience: string;
  sections: LegalSection[];
  sources: LegalSource[];
};

const commonLegalSources: LegalSource[] = [
  {
    label: "Undang-Undang Nomor 8 Tahun 1999 tentang Perlindungan Konsumen",
    href: "https://peraturan.bpk.go.id/Details/45288/uu-no-8-tahun-1999",
  },
  {
    label: "Peraturan Pemerintah Nomor 80 Tahun 2019 tentang Perdagangan Melalui Sistem Elektronik",
    href: "https://peraturan.bpk.go.id/Details/126143/pp-no-80-tahun-2019",
  },
  {
    label: "Peraturan Pemerintah Nomor 71 Tahun 2019 tentang Penyelenggaraan Sistem dan Transaksi Elektronik",
    href: "https://peraturan.bpk.go.id/Details/122030/pp-no-71-tahun-2019",
  },
  {
    label: "Permendag Nomor 19 Tahun 2026 tentang Penyelenggaraan Usaha Perdagangan Melalui Sistem Elektronik",
    href: "https://peraturan.bpk.go.id/Details/351720/permendag-no-19-tahun-2026",
  },
];

const terms: LegalDocument = {
  slug: "terms",
  code: "LEGAL-01",
  title: "Syarat & Ketentuan C.Verse",
  shortTitle: "Syarat & Ketentuan",
  description: "Aturan penggunaan C.Verse, C.Card, C-Coin, C-Gems, Vault, Primary Sale, dan secondary market.",
  status: "Final internal",
  updated: "4 September 2026",
  version: "1.0",
  audience: "Semua pengguna",
  sections: [
    {
      id: "ruang-lingkup",
      title: "1. Ruang Lingkup dan Persetujuan",
      paragraphs: [
        "Ketentuan ini mengatur akses dan penggunaan C.Verse, termasuk C.Card, Primary Sale, secondary market, C-Coin, C-Gems, Vault, NFC, pengiriman, serta fitur terkait.",
        "Dengan membuat akun atau menggunakan layanan, Pengguna menyatakan telah membaca, memahami, dan menyetujui Ketentuan ini serta Kebijakan Privasi yang berlaku. Persetujuan elektronik, catatan transaksi, OTP, dan tindakan konfirmasi pada Platform dapat menjadi bukti persetujuan dan transaksi sesuai hukum Indonesia.",
        "Jika Pengguna tidak menyetujui Ketentuan ini, Pengguna tidak boleh menggunakan layanan.",
      ],
    },
    {
      id: "definisi",
      title: "2. Definisi",
      table: {
        headers: ["Istilah", "Arti"],
        rows: [
          ["Platform", "C.Verse, layanan penerbitan, koleksi, penyimpanan, dan perdagangan Collectible Card edisi terbatas."],
          ["Operator", "Badan usaha yang mengoperasikan Platform sebagaimana diidentifikasi pada bagian Identitas Operator."],
          ["C.Card", "Collectible Card fisik edisi terbatas dengan provenance digital dan chip NFC NTAG 424 DNA TagTamper."],
          ["Primary Sale", "Penjualan perdana C.Card melalui Platform."],
          ["Secondary Market", "Perdagangan C.Card antar-Pengguna melalui buyout atau bid."],
          ["Vault", "Penyimpanan fisik C.Card oleh Operator atau mitra kustodian untuk pemilik yang tercatat."],
          ["C-Coin", "Saldo belanja closed-loop dari top-up atau refund transaksi yang hanya dapat digunakan di Platform."],
          ["C-Gems", "Saldo hasil penjualan, revenue share, royalti, atau Dukungan yang dapat di-payout atau dikonversi menjadi C-Coin."],
          ["Hold", "Penguncian sementara saldo untuk raffle, bid, atau transaksi yang belum selesai."],
        ],
      },
    },
    {
      id: "akun",
      title: "3. Kelayakan dan Akun",
      bullets: [
        "Pengguna harus berusia minimal 18 tahun dan cakap melakukan perbuatan hukum. Pengguna di bawah 18 tahun hanya dapat menggunakan layanan dengan persetujuan dan pengawasan orang tua atau wali yang sah.",
        "Pendaftaran dan login menggunakan metode passwordless yang tersedia, termasuk OAuth atau email OTP. Akun kreator dibuat atau diaktifkan admin berdasarkan kerja sama off-platform.",
        "Satu orang hanya boleh mengoperasikan satu akun, kecuali Operator menyetujui akun bisnis atau kebutuhan lain secara tertulis.",
        "Pengguna wajib memberikan data yang benar, menjaga akses email, perangkat, OTP, dan segera melaporkan dugaan akses tidak sah.",
        "Akun tidak boleh dijual, dipindahtangankan, atau dipinjamkan kepada pihak lain.",
      ],
    },
    {
      id: "sifat-layanan",
      title: "4. Sifat Layanan dan Collectible",
      paragraphs: [
        "C.Card adalah collectible fisik. Pembelian tidak memberikan ekuitas, instrumen investasi, hak atas keuntungan Operator, atau jaminan kenaikan harga.",
        "Harga secondary market ditentukan oleh Pengguna. Operator tidak menjamin likuiditas, harga jual kembali, keuntungan, atau adanya pembeli.",
        "Gambar digital merupakan representasi. Variasi minor pada warna, cetakan, tanda tangan, kemasan, dan material dapat terjadi selama tidak menghilangkan fungsi atau nilai pokok produk.",
      ],
    },
    {
      id: "c-coin",
      title: "5. C-Coin",
      paragraphs: ["Nilai nominal top-up adalah 1 C-Coin = Rp10.000. Semua nominal C-Coin menggunakan bilangan bulat minimal 1 C-Coin."],
      bullets: [
        "C-Coin hanya dapat digunakan untuk transaksi di Platform, tidak dapat ditransfer antar-Pengguna, tidak menghasilkan bunga atau imbal hasil, dan tidak dapat dicairkan menjadi Rupiah.",
        "Top-up diproses penyedia pembayaran pihak ketiga. Biaya, metode, batas, dan status ditampilkan sebelum konfirmasi sejauh relevan.",
        "Saldo C-Coin akun non-KYC dibatasi maksimal 500 C-Coin. Akun KYC-approved tetap tunduk pada kontrol risiko dan batas penyedia pembayaran.",
        "Top-up berhasil pada prinsipnya final, kecuali transaksi duplikat, kesalahan sistem, transaksi tidak sah terverifikasi, kewajiban hukum, atau keputusan Operator untuk melindungi Pengguna.",
        "C-Coin dapat ditempatkan dalam Hold. Hold dilepas bila raffle, bid, atau transaksi tidak berhasil atau dibatalkan sesuai Ketentuan.",
        "Refund pembelian yang dibayar C-Coin dikembalikan sebagai C-Coin, kecuali hukum mewajibkan metode lain.",
      ],
    },
    {
      id: "c-gems",
      title: "6. C-Gems",
      bullets: [
        "C-Gems diterima dari hasil secondary sale, revenue share Primary Sale, royalti kreator, Dukungan, atau sumber lain yang ditampilkan Platform.",
        "C-Gems tidak dapat dibeli melalui top-up dan tidak dapat ditransfer langsung antar-Pengguna.",
        "Setiap penerimaan membentuk lot. Lot eligible untuk payout setelah masa tunggu 24 jam; masa tunggu tidak berlaku untuk konversi ke C-Coin.",
        "Payout memerlukan KYC, minimum 10 C-Gems, dikenai fee 1%, dan dibayarkan ke rekening pihak terverifikasi.",
        "Permintaan payout ditargetkan diproses batch setiap Selasa pada Hari Kerja. Bank, provider, hari libur, gangguan, atau pemeriksaan risiko dapat memengaruhi waktu penerimaan.",
        "C-Gems dapat dikonversi satu arah menjadi C-Coin 1:1 tanpa biaya dan tanpa XP. Konversi bersifat final.",
        "Payout gagal mengembalikan nilai pokok yang belum terkirim ke saldo C-Gems.",
      ],
    },
    {
      id: "primary",
      title: "7. Primary Sale dan Raffle Hybrid",
      bullets: [
        "Setiap Drop menampilkan jumlah unit, harga, pool reguler atau premium, periode entry, dan informasi produk.",
        "Periode raffle berlangsung 24 jam kecuali dinyatakan lain. C-Coin ditempatkan dalam Hold saat entry dikonfirmasi.",
        "Entry tidak dapat dibatalkan. Hold pemenang diselesaikan menjadi pembayaran dan Hold yang tidak menang dilepas.",
        "Unit tersisa setelah draw dapat dijual FCFS dengan harga pool yang sama.",
        "Setiap Pengguna maksimal memperoleh satu C.Card per Drop, kecuali halaman Drop menetapkan lain.",
        "Jumlah signed variant adalah pembulatan ke atas dari 10% total unit dan ditawarkan melalui pool premium yang dinyatakan eksplisit.",
        "Jika Drop dibatalkan, Hold dilepas atau C-Coin yang telah dipotong dikembalikan penuh.",
      ],
    },
    {
      id: "vault",
      title: "8. Vault dan Pengiriman Fisik",
      paragraphs: [
        "Semua pembelian Primary Sale dan secondary market diselesaikan ke Vault terlebih dahulu. Pengiriman fisik adalah tindakan terpisah setelah kartu settled di Vault.",
        "Pemilik dapat mengajukan ship-out, memilih alamat dan layanan yang tersedia, lalu membayar ongkir dalam C-Coin setelah total ditampilkan. Pembatalan hanya tersedia sebelum kartu diserahkan kepada mitra logistik.",
        "Operator menjaga kartu dengan kehati-hatian yang wajar. Kehilangan atau kerusakan karena kesalahan Operator atau mitra dalam kendalinya akan menerima remedi yang wajar berdasarkan bukti, kondisi, harga transaksi, dan hak konsumen.",
      ],
    },
    {
      id: "secondary",
      title: "9. Secondary Market",
      bullets: [
        "Hanya C.Card eligible, berada di Vault, dan lolos kontrol NFC/provenance yang dapat diperdagangkan.",
        "Buyout memiliki harga minimum 3 C-Coin dan maksimal 20 listing aktif per Pengguna.",
        "Bid dibatasi maksimal 3 aktif per bidder dan hanya bid tertinggi yang aktif untuk satu C.Card. Outbid melepas Hold sebelumnya.",
        "Bid dapat dibatalkan setelah 24 jam. Pemilik hanya dapat menerima bid; bid tidak memiliki masa kedaluwarsa otomatis.",
        "Hasil seller dan royalti kreator dikreditkan sebagai C-Gems setelah settlement.",
        "Distribusi secondary sale adalah 7,5% Operator, 7,5% lifetime royalty kreator, dan sisa untuk seller. Bagian Operator dan kreator dibulatkan ke atas; rincian final tampil sebelum konfirmasi.",
        "Creator Seed C.Card memakai settlement dua fase: Hold buyer, vault-in dan verifikasi, lalu release admin. Abort yang sah mengembalikan C-Coin penuh tanpa fee dan XP.",
        "C.Card tampered, defect yang menghilangkan eligibility, lost, atau gagal verifikasi tidak dapat diperdagangkan.",
        "Seller tidak dapat membeli kembali C.Card yang sama selama 24 jam. Kreator tidak dapat membeli atau bid atas C.Card miliknya sendiri selama 30 hari setelah transfer yang relevan.",
        "Transaksi palsu, kolusi, wash trading, manipulasi harga, penyalahgunaan akun, dan koordinasi menyesatkan dilarang.",
      ],
    },
    {
      id: "nfc",
      title: "10. NFC, Provenance, dan Kepemilikan",
      bullets: [
        "Chip NFC digunakan untuk autentikasi dan provenance, bukan alat pembayaran.",
        "Pengguna dilarang merusak, menyalin, mengganti, mengkloning, atau memanipulasi chip, URL autentikasi, tanda tamper, dan catatan provenance.",
        "Catatan kepemilikan Platform merupakan catatan operasional dan dapat ditinjau berdasarkan bukti transaksi serta verifikasi fisik.",
        "Dukungan Web NFC bergantung pada perangkat dan browser. QR atau verifikasi admin dapat tersedia sebagai fallback.",
      ],
    },
    {
      id: "refund",
      title: "11. Pembatalan, Refund, dan Sengketa Transaksi",
      paragraphs: [
        "Hak pembatalan dan refund bergantung pada tahap transaksi, status C.Card, sifat limited edition, serta hukum perlindungan konsumen. Pengguna wajib melaporkan transaksi tidak sah, barang salah, kerusakan, kehilangan, atau ketidaksesuaian material secepatnya dengan bukti yang tersedia.",
        "Operator dapat menahan settlement atau payout selama investigasi yang wajar. Suspension atau penutupan akun tidak dengan sendirinya menghanguskan saldo sah.",
        "Ketentuan ini tidak membatasi hak konsumen yang tidak dapat dikesampingkan berdasarkan hukum Indonesia.",
      ],
    },
    {
      id: "kepatuhan",
      title: "12. KYC, Pajak, dan Kepatuhan",
      bullets: [
        "KYC wajib untuk payout C-Gems dan dapat diwajibkan untuk batas saldo, pola transaksi, pemeriksaan risiko, atau kewajiban hukum.",
        "Operator dapat meminta identitas, rekening bank, NPWP bila relevan, bukti sumber transaksi, atau dokumen pendukung secara proporsional.",
        "Pengguna bertanggung jawab atas kewajiban pajaknya. Operator dapat memotong, memungut, melaporkan, atau meminta data jika diwajibkan hukum.",
        "Operator dapat menolak atau menunda transaksi untuk memenuhi sanksi, pencegahan fraud, anti-pencucian uang, perintah otoritas, atau kewajiban hukum.",
      ],
    },
    {
      id: "larangan",
      title: "13. Penggunaan yang Dilarang dan Penegakan",
      bullets: [
        "Fraud, impersonation, phishing, chargeback abuse, eksploitasi celah, botting, atau manipulasi raffle.",
        "Pencucian uang, penyamaran sumber dana, atau penggunaan akun pihak lain.",
        "Pelanggaran kekayaan intelektual, privasi, keamanan, ketersediaan Platform, atau hukum.",
        "Penghindaran batas akun, KYC, Hold, payout, dan kontrol pasar.",
      ],
      note: "Operator dapat memberi peringatan, membatasi fitur, membatalkan transaksi, menahan settlement, melakukan suspension, atau menutup akun secara proporsional. Alasan dan kanal keberatan diberikan sejauh tidak dilarang hukum atau mengganggu investigasi.",
    },
    {
      id: "kekayaan-intelektual",
      title: "14. Hak Kekayaan Intelektual",
      paragraphs: [
        "Platform, perangkat lunak, merek, desain, teks, dan materi terkait dilindungi hukum. Membeli C.Card tidak memindahkan hak cipta, merek, likeness, atau hak komersial kreator.",
        "Kreator menjamin memiliki atau telah memperoleh hak yang diperlukan atas materi yang diserahkan kepada Operator.",
      ],
    },
    {
      id: "privasi-komunikasi",
      title: "15. Privasi dan Komunikasi Elektronik",
      paragraphs: [
        "Pemrosesan data pribadi diatur dalam Kebijakan Privasi C.Verse. Pengguna menyetujui komunikasi transaksional yang diperlukan untuk OTP, keamanan, akun, transaksi, payout, dan pembaruan Ketentuan.",
        "Komunikasi promosi diberikan sesuai pilihan Pengguna dan dapat dihentikan melalui mekanisme yang tersedia.",
      ],
    },
    {
      id: "penutupan",
      title: "16. Suspension, Penutupan Akun, dan Saldo",
      paragraphs: [
        "Pengguna dapat meminta penutupan akun setelah transaksi, dispute, payout, dan kewajiban tertunda selesai. Operator dapat melakukan suspension segera apabila terdapat risiko keamanan, fraud, kerugian, pelanggaran material, atau perintah otoritas.",
        "Penyelesaian C-Coin, C-Gems, C.Card di Vault, data, dan kewajiban dilakukan sesuai hak Pengguna dan hukum. Operator tidak mengambil saldo atau kartu tanpa dasar kontraktual atau hukum yang sah.",
      ],
    },
    {
      id: "perubahan",
      title: "17. Ketersediaan dan Perubahan Layanan",
      paragraphs: [
        "Operator berupaya menjaga layanan tersedia tetapi tidak menjamin bebas gangguan. Pemeliharaan, insiden, vendor, jaringan, force majeure, dan perubahan hukum dapat memengaruhi layanan.",
        "Perubahan material diberitahukan sekurang-kurangnya 30 hari sebelum berlaku jika wajar dan diizinkan hukum. Perubahan mendesak untuk keamanan atau hukum dapat berlaku lebih cepat. Persetujuan ulang diminta jika diwajibkan.",
      ],
    },
    {
      id: "tanggung-jawab",
      title: "18. Jaminan dan Batas Tanggung Jawab",
      paragraphs: [
        "Layanan diberikan berdasarkan ketersediaan dengan standar kehati-hatian yang wajar. Operator tidak menjamin nilai resale, profit, kecocokan untuk spekulasi, atau layanan pihak ketiga.",
        "Tidak ada ketentuan yang mengecualikan tanggung jawab atas kesengajaan, kelalaian berat, fraud Operator, pelanggaran data yang menjadi tanggung jawab Operator, atau hak konsumen yang tidak dapat dikesampingkan.",
      ],
    },
    {
      id: "sengketa",
      title: "19. Hukum dan Penyelesaian Sengketa",
      paragraphs: [
        "Ketentuan ini tunduk pada hukum Republik Indonesia. Pengguna dan Operator terlebih dahulu berupaya menyelesaikan keluhan melalui kanal dukungan dalam itikad baik.",
        "Jika tidak selesai, konsumen dapat menggunakan Badan Penyelesaian Sengketa Konsumen, mediasi, arbitrase berdasarkan kesepakatan, atau pengadilan yang berwenang. Tidak ada forum eksklusif yang menghilangkan hak konsumen.",
      ],
    },
    {
      id: "umum",
      title: "20. Ketentuan Umum",
      paragraphs: [
        "Jika satu ketentuan dinyatakan tidak berlaku, ketentuan lain tetap berlaku sejauh dimungkinkan. Kegagalan menegakkan hak tidak berarti pelepasan hak.",
        "Versi Bahasa Indonesia menjadi versi yang mengikat. Terjemahan hanya disediakan untuk kemudahan.",
      ],
    },
    {
      id: "operator",
      title: "21. Identitas Operator dan Kontak",
      table: {
        headers: ["Data", "Nilai"],
        rows: [
          ["Nama badan usaha", "Akan diisi sebelum publikasi komersial"],
          ["Nomor Induk Berusaha", "Akan diisi sebelum publikasi komersial"],
          ["Alamat terdaftar", "Akan diisi sebelum publikasi komersial"],
          ["Tanggal berlaku", "Akan ditetapkan sebelum publikasi komersial"],
          ["Dukungan", "support@c-verse.co"],
          ["Legal dan sengketa", "legal@c-verse.co"],
          ["Privasi", "privacy@c-verse.co"],
        ],
      },
      note: "Dokumen ini merupakan versi final internal. Identitas Operator dan tanggal berlaku wajib diisi sebelum layanan komersial dibuka.",
    },
  ],
  sources: [
    ...commonLegalSources,
    {
      label: "Peraturan Bank Indonesia Nomor 20/6/PBI/2018 tentang Uang Elektronik",
      href: "https://peraturan.bpk.go.id/Details/135874/peraturan-bi-no-206pbi2018-tahun-2018",
    },
  ],
};

const privacy: LegalDocument = {
  slug: "privacy",
  code: "LEGAL-02",
  title: "Kebijakan Privasi C.Verse",
  shortTitle: "Kebijakan Privasi",
  description: "Cara C.Verse mengumpulkan, menggunakan, membagikan, menyimpan, dan melindungi data pribadi.",
  status: "Draft publikasi",
  updated: "4 September 2026",
  version: "0.9",
  audience: "Pengguna dan pengunjung",
  sections: [
    {
      id: "pengendali",
      title: "1. Pengendali Data",
      paragraphs: [
        "Operator C.Verse bertindak sebagai pengendali data pribadi untuk kegiatan yang dijelaskan dalam kebijakan ini. Identitas badan usaha, NIB, dan alamat terdaftar akan dicantumkan sebelum layanan komersial dibuka.",
        "Pertanyaan privasi dapat dikirim ke privacy@c-verse.co.",
      ],
    },
    {
      id: "data-dikumpulkan",
      title: "2. Data yang Kami Kumpulkan",
      table: {
        headers: ["Kategori", "Contoh"],
        rows: [
          ["Akun", "Nama, email, username, avatar, nomor telepon."],
          ["Transaksi", "Top-up, Hold, pembelian, bid, listing, C-Coin, C-Gems, payout, dan refund."],
          ["KYC", "Nama sesuai identitas, NIK, KTP, selfie, NPWP opsional, dan rekening bank."],
          ["Pengiriman", "Nama penerima, telepon, alamat, resi, dan status pengiriman."],
          ["C.Card dan NFC", "UID, counter, hasil autentikasi, status tamper, ownership, dan provenance."],
          ["Teknis", "Alamat IP, perangkat, browser, log keamanan, cookie, dan data penggunaan."],
          ["Preferensi", "Visibilitas profil, consent analitik, dan consent laporan pasar."],
        ],
      },
    },
    {
      id: "sumber",
      title: "3. Sumber Data",
      bullets: [
        "Langsung dari Pengguna saat mendaftar, bertransaksi, KYC, menghubungi dukungan, atau mengubah preferensi.",
        "Dari Google OAuth atau penyedia login sesuai persetujuan Pengguna.",
        "Dari payment gateway, bank, provider disbursement, dan mitra logistik untuk status transaksi.",
        "Dari perangkat NFC, log Platform, sistem keamanan Cloudflare, dan catatan operasional admin.",
      ],
    },
    {
      id: "tujuan",
      title: "4. Tujuan Pemrosesan",
      bullets: [
        "Membuat dan mengamankan akun, autentikasi, serta pemulihan akses.",
        "Menjalankan top-up, pembelian, raffle, secondary market, settlement, payout, refund, Vault, dan pengiriman.",
        "Memverifikasi keaslian C.Card dan menjaga provenance.",
        "Mencegah fraud, multi-account abuse, wash trading, gangguan keamanan, dan pelanggaran hukum.",
        "Memberikan dukungan, notifikasi transaksional, dan komunikasi layanan.",
        "Mengembangkan produk melalui analitik agregat dan consent opsional.",
        "Memenuhi kewajiban hukum, audit, pajak, dan permintaan otoritas yang sah.",
      ],
    },
    {
      id: "dasar-hukum",
      title: "5. Dasar Hukum Pemrosesan",
      bullets: [
        "Pelaksanaan kontrak saat data diperlukan untuk menyediakan layanan yang diminta.",
        "Persetujuan untuk pemrosesan opsional, termasuk promosi dan jenis analitik tertentu.",
        "Kewajiban hukum untuk KYC, pajak, pembukuan, keamanan, dan permintaan otoritas.",
        "Kepentingan sah yang proporsional untuk pencegahan fraud, keamanan, dukungan, dan perbaikan layanan.",
      ],
    },
    {
      id: "penerima",
      title: "6. Penerima Data",
      table: {
        headers: ["Penerima", "Tujuan"],
        rows: [
          ["Supabase dan Cloudflare", "Hosting data, API, keamanan, penyimpanan, CDN, dan email transaksional."],
          ["Payment gateway/provider disbursement", "Top-up, verifikasi status, payout, dan refund."],
          ["Mitra KYC", "Verifikasi identitas apabila integrasi pihak ketiga digunakan."],
          ["Mitra logistik", "Pemrosesan ship-out dan klaim pengiriman."],
          ["Kreator", "Hanya insight agregat sesuai consent; identitas Pengguna tidak dibagikan untuk analitik kreator."],
          ["Otoritas", "Pemenuhan permintaan yang sah dan kewajiban hukum."],
        ],
      },
      note: "C.Verse tidak menjual data pribadi kepada pihak ketiga untuk pemasaran.",
    },
    {
      id: "retensi",
      title: "7. Retensi Data",
      paragraphs: [
        "Data disimpan selama diperlukan untuk tujuan pemrosesan, pelaksanaan kontrak, audit, pencegahan fraud, dan kewajiban hukum. Periode berbeda dapat berlaku untuk akun, transaksi, KYC, komunikasi dukungan, dan log teknis.",
        "Catatan transaksi dan provenance dapat disimpan lebih lama untuk integritas ownership dan audit. Setelah masa retensi berakhir, data dihapus, dianonimkan, atau dibatasi penggunaannya sesuai kemampuan teknis dan hukum.",
      ],
    },
    {
      id: "keamanan",
      title: "8. Keamanan Data",
      bullets: [
        "Enkripsi saat transit dan kontrol akses berbasis peran.",
        "Penyimpanan private untuk dokumen KYC dan akses admin terproteksi.",
        "Audit log, pemantauan aktivitas, RLS, pemisahan environment, dan prinsip least privilege.",
        "Penanganan insiden serta pemberitahuan kepada pihak terdampak dan otoritas bila diwajibkan.",
      ],
    },
    {
      id: "hak",
      title: "9. Hak Subjek Data",
      bullets: [
        "Meminta informasi dan akses terhadap data pribadi.",
        "Memperbaiki data yang tidak akurat atau tidak lengkap.",
        "Menarik persetujuan untuk pemrosesan berbasis consent.",
        "Meminta penghapusan, pembatasan, atau penghentian pemrosesan sejauh diizinkan hukum.",
        "Mengajukan keberatan, keluhan, atau meminta portabilitas data jika berlaku.",
      ],
      note: "Permintaan dikirim ke privacy@c-verse.co. Kami dapat meminta verifikasi identitas dan menolak bagian permintaan yang bertentangan dengan kewajiban hukum atau hak pihak lain dengan memberikan alasan.",
    },
    {
      id: "cookie",
      title: "10. Cookie dan Penyimpanan Lokal",
      paragraphs: [
        "Platform menggunakan cookie atau penyimpanan lokal yang diperlukan untuk sesi, keamanan, preferensi, dan fungsi utama. Analitik non-esensial hanya digunakan sesuai consent dan konfigurasi yang tersedia.",
      ],
    },
    {
      id: "anak",
      title: "11. Data Anak",
      paragraphs: [
        "Layanan ditujukan untuk Pengguna berusia 18 tahun atau lebih. Jika kami mengetahui data anak diproses tanpa dasar atau persetujuan wali yang sah, kami akan membatasi akun dan mengambil langkah penghapusan yang sesuai.",
      ],
    },
    {
      id: "perubahan",
      title: "12. Perubahan Kebijakan",
      paragraphs: [
        "Perubahan material diberitahukan melalui Platform atau email sekurang-kurangnya 30 hari sebelum berlaku jika wajar dan diizinkan hukum. Persetujuan ulang diminta jika diwajibkan.",
      ],
    },
    {
      id: "kontak",
      title: "13. Kontak dan Keluhan",
      paragraphs: [
        "Hubungi privacy@c-verse.co untuk permintaan hak, pertanyaan, atau keluhan privasi. Keluhan umum dapat dikirim ke support@c-verse.co.",
      ],
    },
  ],
  sources: [
    {
      label: "Undang-Undang Nomor 27 Tahun 2022 tentang Pelindungan Data Pribadi",
      href: "https://peraturan.bpk.go.id/Details/229798/uu-no-27-tahun-2022",
    },
    ...commonLegalSources,
  ],
};

const shipping: LegalDocument = {
  slug: "shipping",
  code: "LEGAL-03",
  title: "Kebijakan Pengiriman & Vault",
  shortTitle: "Pengiriman & Vault",
  description: "Aturan settlement ke Vault, ship-out, biaya, pembatalan, serta penanganan kehilangan atau kerusakan.",
  status: "Final internal",
  updated: "4 September 2026",
  version: "1.0",
  audience: "Pemilik C.Card",
  sections: [
    {
      id: "prinsip",
      title: "1. Prinsip Dasar",
      bullets: [
        "Semua Primary Sale dan transaksi secondary market diselesaikan ke Vault terlebih dahulu.",
        "Pengiriman fisik bukan opsi saat checkout pembelian. Pemilik mengajukan ship-out setelah C.Card settled di Vault.",
        "Kepemilikan terpisah dari lokasi fisik sehingga C.Card di Vault dapat diperdagangkan tanpa perpindahan fisik.",
      ],
    },
    {
      id: "settlement",
      title: "2. Settlement ke Vault",
      paragraphs: [
        "Primary Sale menggunakan alur paid, QC, lalu settled tanpa alamat buyer atau ongkir pada checkout. Secondary market memindahkan ownership pada ledger setelah kontrol settlement selesai.",
        "C.Card di tangan seller harus diterima Platform, cocok dengan data NFC, memiliki status tamper valid, dan lolos pemeriksaan kondisi sebelum release payout.",
        "Creator Seed C.Card menggunakan settlement dua fase. C-Coin buyer di-Hold sampai vault-in dan verifikasi selesai. Abort yang sah mengembalikan pembayaran penuh tanpa fee dan XP.",
      ],
    },
    {
      id: "ship-out",
      title: "3. Ship-out dari Vault",
      bullets: [
        "Ship-out dapat diminta setelah C.Card settled dan tidak sedang di-Hold, listing yang menghalangi, sengketa, atau verifikasi.",
        "Pemilik mengonfirmasi alamat dan biaya, membayar ongkir dalam C-Coin, lalu shipment berjalan melalui status requested, packed, shipped, dan delivered.",
        "Biaya MVP menggunakan konstanta server dan ditampilkan sebelum konfirmasi.",
        "Target packing adalah 1-2 Hari Kerja; estimasi pengiriman 1-3 Hari Kerja untuk Jawa dan 3-7 Hari Kerja untuk luar Jawa setelah serah ke logistik.",
      ],
    },
    {
      id: "pembatalan",
      title: "4. Pembatalan dan Refund Ongkir",
      paragraphs: [
        "Shipment berstatus requested dapat dibatalkan sebelum packing dan C-Coin ongkir dikembalikan penuh. Shipment packed atau shipped tidak dapat dibatalkan sepihak.",
        "Jika kegagalan disebabkan kesalahan Platform, Platform menanggung pengiriman ulang dan mengembalikan biaya yang tidak semestinya dibebankan.",
      ],
    },
    {
      id: "risiko",
      title: "5. Tanggung Jawab dan Risiko",
      table: {
        headers: ["Situasi", "Penanganan"],
        rows: [
          [
            "Rusak atau hilang di Vault karena kesalahan Platform",
            "Investigasi dan remedi wajar berdasarkan kondisi, harga transaksi, bukti, dan hak konsumen.",
          ],
          [
            "Hilang atau rusak dalam ship-out",
            "Klaim logistik/asuransi dikoordinasikan Platform; tanggung jawab akhir mengikuti bukti dan hukum.",
          ],
          [
            "Hilang saat seller mengirim ke Vault",
            "Seller mengajukan klaim kepada pengirim yang dipilih; Platform membantu dengan bukti penerimaan.",
          ],
          ["NFC rusak di Vault", "Investigasi dan pemulihan atau remedi jika menjadi tanggung jawab Platform."],
        ],
      },
    },
    {
      id: "dukungan",
      title: "6. Dukungan",
      paragraphs: [
        "Keluhan dikirim ke support@c-verse.co dengan ID shipment, foto, video unboxing bila ada, dan bukti pendukung lain. Kebijakan ini tidak menghapus hak konsumen yang tidak dapat dikesampingkan.",
      ],
    },
  ],
  sources: commonLegalSources,
};

const kyc: LegalDocument = {
  slug: "kyc",
  code: "LEGAL-04",
  title: "Kebijakan KYC",
  shortTitle: "Kebijakan KYC",
  description: "Ketentuan verifikasi identitas untuk payout C-Gems, cap saldo, dan pengendalian risiko.",
  status: "Draft publikasi",
  updated: "4 September 2026",
  version: "0.9",
  audience: "Seller dan kreator",
  sections: [
    {
      id: "prinsip",
      title: "1. Prinsip",
      paragraphs: [
        "KYC adalah proses verifikasi identitas untuk memenuhi kepatuhan dan mengurangi fraud. KYC wajib sebelum payout C-Gems ke rekening bank.",
        "Akun non-KYC tetap dapat menggunakan fitur non-payout, tetapi saldo C-Coin dibatasi maksimal 500 C-Coin. Operator dapat meminta KYC lebih awal berdasarkan indikator risiko.",
      ],
    },
    {
      id: "trigger",
      title: "2. Trigger KYC",
      table: {
        headers: ["Trigger", "Ketentuan"],
        rows: [
          ["Payout pertama", "KYC wajib untuk payout C-Gems berapa pun nilainya; minimum request 10 C-Gems."],
          ["Cap saldo", "KYC diperlukan untuk memiliki saldo C-Coin di atas 500 C-Coin."],
          ["Pemeriksaan risiko", "KYC dapat diminta karena pola transaksi, fraud, sanksi, atau kewajiban hukum."],
          ["Perubahan data", "Nama, identitas, atau rekening baru dapat memerlukan verifikasi ulang."],
        ],
      },
    },
    {
      id: "data",
      title: "3. Data yang Dibutuhkan",
      bullets: [
        "Nama lengkap, NIK 16 digit, foto e-KTP, dan selfie dengan KTP.",
        "Nomor rekening bank dan nama pemilik rekening yang sesuai identitas.",
        "NPWP apabila relevan untuk administrasi pajak.",
        "Dokumen tambahan secara proporsional jika verifikasi atau pemeriksaan risiko memerlukannya.",
      ],
    },
    {
      id: "proses",
      title: "4. Proses Verifikasi",
      paragraphs: [
        "Pengguna mengisi formulir dan mengunggah dokumen. Tim Platform meninjau permohonan dengan status pending, approved, atau rejected. Target verifikasi manual Y1 adalah 1x24 jam.",
        "Penolakan disertai alasan yang dapat diinformasikan dan kesempatan unggah ulang, kecuali pengungkapan mengganggu kontrol keamanan atau dilarang hukum.",
      ],
    },
    {
      id: "rekening",
      title: "5. Verifikasi Rekening",
      paragraphs: [
        "Rekening payout harus berada atas nama pihak yang terverifikasi. Perubahan rekening memerlukan verifikasi ulang atau pemeriksaan tambahan.",
      ],
    },
    {
      id: "keamanan",
      title: "6. Keamanan dan Retensi",
      bullets: [
        "Dokumen KYC disimpan pada penyimpanan private dengan enkripsi saat transit dan kontrol akses terbatas.",
        "Akses admin dilindungi autentikasi, MFA, Cloudflare Access, audit log, dan prinsip least privilege.",
        "Data disimpan selama diperlukan untuk tujuan KYC, sengketa, audit, dan kewajiban hukum, lalu dihapus atau dibatasi.",
      ],
    },
    {
      id: "monitoring",
      title: "7. Monitoring Risiko",
      bullets: [
        "Top-up berulang atau pola structuring.",
        "Payout yang tidak selaras dengan aktivitas transaksi wajar.",
        "Beberapa akun dengan identitas atau rekening yang sama.",
        "Volume, perangkat, atau pola ownership yang tidak wajar.",
      ],
      note: "Operator dapat menahan payout dan meminta klarifikasi selama investigasi yang proporsional.",
    },
    {
      id: "threshold",
      title: "8. Threshold Final",
      table: {
        headers: ["Parameter", "Nilai"],
        rows: [
          ["Payout C-Gems", "KYC wajib sejak payout pertama; minimum request 10 C-Gems."],
          ["Saldo C-Coin non-KYC", "Maksimal 500 C-Coin atau Rp5.000.000."],
          ["Saldo C-Coin KYC-approved", "Tidak ada cap produk khusus; tetap tunduk pada risk control dan limit provider."],
          ["Monitoring structuring", "Berbasis indikator internal yang tidak dipublikasikan."],
        ],
      },
    },
    {
      id: "banding",
      title: "9. Penolakan dan Banding",
      paragraphs: [
        "Pengguna yang ditolak tidak dapat melakukan payout tetapi tetap dapat menggunakan fitur non-payout sejauh tidak dibatasi karena risiko lain. Banding dapat diajukan ke support@c-verse.co dengan bukti tambahan.",
      ],
    },
  ],
  sources: [
    {
      label: "Undang-Undang Nomor 27 Tahun 2022 tentang Pelindungan Data Pribadi",
      href: "https://peraturan.bpk.go.id/Details/229798/uu-no-27-tahun-2022",
    },
    ...commonLegalSources,
  ],
};

const creatorTerms: LegalDocument = {
  slug: "creator-terms",
  code: "LEGAL-05",
  title: "Ketentuan Kreator",
  shortTitle: "Ketentuan Kreator",
  description: "Ringkasan hak, lisensi, revenue share, royalti, payout, dan kewajiban kreator C.Verse.",
  status: "Draft kontrak",
  updated: "4 September 2026",
  version: "0.9",
  audience: "Kreator",
  sections: [
    {
      id: "status",
      title: "1. Status dan Onboarding",
      paragraphs: [
        "Kreator MVP direkrut off-platform oleh tim C.Verse. Tidak tersedia aplikasi atau approval kreator di dalam Platform.",
        "Threshold operasional MVP adalah minimal 100.000 followers combined pada seluruh platform sosial dan diverifikasi manual.",
      ],
    },
    {
      id: "hak-cipta",
      title: "2. Hak Cipta dan Lisensi",
      paragraphs: [
        "Kreator tetap memiliki hak cipta atas karya yang digunakan dalam C.Card. Kreator memberikan lisensi non-eksklusif kepada Operator untuk memproduksi, menampilkan, memasarkan, mendistribusikan, dan menjual C.Card sesuai kolaborasi.",
        "Pembatasan wilayah, jangka waktu, penggunaan likeness, approval desain, dan materi kampanye ditetapkan lebih rinci dalam perjanjian kolaborasi individual.",
      ],
    },
    {
      id: "jaminan",
      title: "3. Jaminan Kreator",
      bullets: [
        "Materi merupakan karya asli atau telah memiliki seluruh izin yang diperlukan.",
        "Materi tidak melanggar hak cipta, merek, privasi, publisitas, atau hak pihak ketiga.",
        "Materi tidak mengandung konten melanggar hukum.",
        "Kreator memberikan informasi identitas, rekening, pajak, dan audiens secara benar.",
      ],
    },
    {
      id: "primary",
      title: "4. Revenue Share Primary Sale",
      paragraphs: [
        "Skema MVP hanya platform-produced. Operator menanggung produksi, logistik awal, dan QC. Revenue share adalah 70% untuk Operator dan 30% untuk Kreator, dihitung dari harga jual kotor sesuai settlement.",
        "Untuk contoh harga 30 C-Coin, bagian Kreator adalah 9 C-Gems sebelum pajak atau penyesuaian yang diwajibkan hukum.",
      ],
    },
    {
      id: "royalti",
      title: "5. Royalti Secondary Market",
      paragraphs: [
        "Kreator memperoleh lifetime royalty nominal 7,5% setiap kali C.Card yang terkait berpindah tangan melalui secondary market. Distribusi nominal adalah 7,5% Operator, 7,5% Kreator, dan sisa untuk seller.",
        "Karena token menggunakan bilangan bulat, bagian Operator dan Kreator dibulatkan ke atas dan seller menerima sisanya. Rincian final dicatat pada settlement.",
      ],
    },
    {
      id: "seed",
      title: "6. Creator Seed C.Card",
      paragraphs: [
        "Creator Seed C.Card adalah C.Card 1-of-1 milik kreator yang dapat diperdagangkan melalui secondary market. Pada penjualan pertama, kreator menerima bagian seller ditambah lifetime royalty, secara nominal 92,5% sebelum pembulatan.",
        "Settlement baru dilepas setelah C.Card masuk Vault dan NFC serta kondisinya diverifikasi.",
      ],
    },
    {
      id: "payout",
      title: "7. C-Gems dan Payout",
      bullets: [
        "Revenue share, royalti, hasil Creator Seed C.Card, dan Dukungan dikreditkan sebagai C-Gems.",
        "Lot C-Gems eligible untuk payout setelah 24 jam.",
        "Payout minimum 10 C-Gems, memerlukan KYC, dikenai fee 1%, dan ditargetkan diproses setiap Selasa pada Hari Kerja.",
        "C-Gems dapat dikonversi satu arah menjadi C-Coin 1:1 tanpa fee dan tanpa XP.",
        "Pajak dipotong atau dilaporkan sesuai status pihak dan hukum yang berlaku.",
      ],
    },
    {
      id: "integritas",
      title: "8. Integritas Pasar",
      bullets: [
        "Kreator dilarang melakukan self-dealing, wash trading, manipulasi harga, penggunaan akun nominee, atau promosi yang menjanjikan profit.",
        "Kreator tidak dapat membeli atau bid atas C.Card miliknya sendiri selama 30 hari setelah transfer yang relevan.",
        "Hubungan komersial, endorsement, dan informasi material harus diungkapkan secara jujur.",
      ],
    },
    {
      id: "terminasi",
      title: "9. Masa Berlaku dan Terminasi",
      paragraphs: [
        "Ketentuan detail masa kolaborasi, pembatalan Drop, penggunaan materi setelah terminasi, dan kewajiban yang bertahan ditetapkan dalam perjanjian individual.",
        "Lifetime royalty untuk C.Card yang telah dirilis tetap berjalan sesuai catatan Platform dan perjanjian, kecuali hukum atau putusan sengketa menentukan lain.",
      ],
    },
    {
      id: "prioritas",
      title: "10. Prioritas Dokumen",
      note: "Halaman ini adalah ringkasan kebijakan publik. Perjanjian kolaborasi individual yang ditandatangani berlaku untuk detail komersial spesifik. Jika terdapat pertentangan, ketentuan individual berlaku sepanjang tidak mengurangi hak yang tidak dapat dikesampingkan atau melanggar hukum.",
    },
  ],
  sources: commonLegalSources,
};

export const legalDocuments: LegalDocument[] = [terms, privacy, shipping, kyc, creatorTerms];

export const legalDocumentsBySlug = new Map(legalDocuments.map((document) => [document.slug, document]));

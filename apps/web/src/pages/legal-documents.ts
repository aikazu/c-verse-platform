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
  updatedAt: string;
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
  description: "Aturan penggunaan C.Verse, C.Card, C-Coin, C-Gems, Vault, penjualan perdana, dan jual beli antarkolektor.",
  status: "Final internal",
  updated: "5 September 2026",
  updatedAt: "2026-09-05",
  version: "1.0",
  audience: "Semua pengguna",
  sections: [
    {
      id: "ruang-lingkup",
      title: "1. Ruang Lingkup dan Persetujuan",
      paragraphs: [
        "Ketentuan ini mengatur akses dan penggunaan C.Verse, termasuk C.Card, penjualan perdana, jual beli antarkolektor, C-Coin, C-Gems, Vault, NFC, pengiriman, serta fitur terkait.",
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
          ["Platform", "C.Verse, layanan penerbitan, koleksi, penyimpanan, dan perdagangan kartu koleksi edisi terbatas."],
          ["Operator", "Badan usaha yang mengoperasikan Platform sebagaimana diidentifikasi pada bagian Identitas Operator."],
          ["C.Card", "Kartu koleksi fisik edisi terbatas dengan chip NFC untuk memeriksa keaslian dan riwayat kepemilikan."],
          ["Penjualan perdana", "Penjualan perdana C.Card melalui Platform."],
          ["Jual beli antarkolektor", "Jual beli C.Card antar-Pengguna dengan harga yang dipasang penjual atau melalui penawaran harga."],
          ["Vault", "Penyimpanan fisik C.Card oleh Operator atau mitra penyimpanan untuk pemilik yang tercatat."],
          ["C-Coin", "Saldo belanja dari pengisian saldo atau pengembalian dana transaksi. C-Coin hanya dapat digunakan di C.Verse."],
          [
            "C-Gems",
            "Saldo hasil penjualan, pembagian pendapatan, royalti, atau Dukungan yang dapat ditarik ke rekening atau ditukar menjadi C-Coin.",
          ],
          ["Penahanan saldo", "Penguncian sementara saldo untuk undian pembelian, penawaran, atau transaksi yang belum selesai."],
        ],
      },
    },
    {
      id: "akun",
      title: "3. Kelayakan dan Akun",
      bullets: [
        "Pengguna harus berusia minimal 18 tahun dan cakap melakukan perbuatan hukum. Pengguna di bawah 18 tahun hanya dapat menggunakan layanan dengan persetujuan dan pengawasan orang tua atau wali yang sah.",
        "Pendaftaran dan masuk akun menggunakan Google atau kode sekali pakai yang dikirim ke email. Akun kreator diaktifkan berdasarkan perjanjian kerja sama dengan C.Verse.",
        "Satu orang hanya boleh mengoperasikan satu akun, kecuali Operator menyetujui akun bisnis atau kebutuhan lain secara tertulis.",
        "Pengguna wajib memberikan data yang benar, menjaga akses email, perangkat, OTP, dan segera melaporkan dugaan akses tidak sah.",
        "Akun tidak boleh dijual, dipindahtangankan, atau dipinjamkan kepada pihak lain.",
      ],
    },
    {
      id: "sifat-layanan",
      title: "4. Sifat Layanan dan Kartu Koleksi",
      paragraphs: [
        "C.Card adalah kartu koleksi fisik. Pembelian tidak memberikan ekuitas, instrumen investasi, hak atas keuntungan Operator, atau jaminan kenaikan harga.",
        "Harga jual beli antarkolektor ditentukan oleh Pengguna. Operator tidak menjamin harga jual kembali, keuntungan, atau tersedianya pembeli.",
        "Gambar digital merupakan representasi. Variasi minor pada warna, cetakan, tanda tangan, kemasan, dan material dapat terjadi selama tidak menghilangkan fungsi atau nilai pokok produk.",
      ],
    },
    {
      id: "c-coin",
      title: "5. C-Coin",
      paragraphs: ["Nilai nominal isi saldo adalah 1 C-Coin = Rp10.000. Semua nominal C-Coin menggunakan bilangan bulat minimal 1 C-Coin."],
      bullets: [
        "C-Coin hanya dapat digunakan untuk transaksi di Platform, tidak dapat ditransfer antar-Pengguna, tidak menghasilkan bunga atau imbal hasil, dan tidak dapat dicairkan menjadi Rupiah.",
        "Isi saldo diproses penyedia pembayaran pihak ketiga. Biaya, metode, batas, dan status ditampilkan sebelum konfirmasi sejauh relevan.",
        "Sebelum verifikasi identitas disetujui, isi saldo hanya dapat dilakukan jika saldo setelah pengisian tidak melebihi 500 C-Coin. Batas ini tidak membatalkan pengembalian dana transaksi atau penukaran C-Gems. Setelah verifikasi disetujui, pemeriksaan keamanan dan batas penyedia pembayaran tetap berlaku.",
        "Isi saldo berhasil pada prinsipnya final, kecuali transaksi duplikat, kesalahan sistem, transaksi tidak sah terverifikasi, kewajiban hukum, atau keputusan Operator untuk melindungi Pengguna.",
        "C-Coin dapat ditahan sementara untuk undian pembelian, penawaran, atau transaksi. Saldo dikembalikan jika Pengguna tidak terpilih, ada penawaran yang lebih tinggi, atau transaksi dibatalkan sesuai ketentuan.",
        "Pengembalian dana untuk pembelian yang dibayar dengan C-Coin diberikan dalam C-Coin, kecuali hukum mewajibkan metode lain.",
      ],
    },
    {
      id: "c-gems",
      title: "6. C-Gems",
      bullets: [
        "C-Gems diterima dari hasil penjualan antarkolektor, pembagian pendapatan penjualan perdana, royalti kreator, Dukungan, atau sumber lain yang ditampilkan Platform.",
        "C-Gems tidak dapat dibeli melalui isi saldo dan tidak dapat ditransfer langsung antar-Pengguna.",
        "C-Gems dari setiap penerimaan dapat ditarik ke rekening setelah masa tunggu 24 jam. Masa tunggu ini tidak berlaku untuk penukaran ke C-Coin.",
        "Penarikan dana memerlukan verifikasi identitas (KYC), minimum 10 C-Gems, dan dibayarkan ke rekening pihak terverifikasi. Biaya sebesar 1% dari jumlah pengajuan dibulatkan ke atas ke C-Gems utuh. Contoh: penarikan 10 C-Gems dikenai biaya 1 C-Gems, sehingga dana yang diterima Rp90.000 sebelum potongan pajak jika berlaku.",
        "Permintaan penarikan dana ditargetkan diproses bersama setiap Selasa yang merupakan hari kerja. Proses bank atau penyedia pembayaran, hari libur, gangguan layanan, dan pemeriksaan keamanan dapat memengaruhi waktu penerimaan.",
        "C-Gems dapat ditukar menjadi C-Coin dengan perbandingan 1:1, tanpa biaya dan tanpa penambahan XP. Penukaran tidak dapat dibatalkan; C-Coin tidak dapat ditukar kembali menjadi C-Gems.",
        "Jika penarikan gagal dan dana dipastikan belum terkirim, nilai pokok dikembalikan ke saldo C-Gems. Status pengembalian dapat dilihat di Dompet.",
      ],
    },
    {
      id: "primary",
      title: "7. Penjualan Perdana dan Undian Pembelian",
      bullets: [
        "Setiap rilis di Drops menampilkan jumlah kartu, harga, pilihan Reguler atau Signed (bertanda tangan), jadwal pendaftaran, dan informasi produk.",
        "Pendaftaran undian pembelian (Raffle) berlangsung 24 jam kecuali dinyatakan lain pada halaman rilis. C-Coin ditahan sementara saat pendaftaran dikonfirmasi.",
        "Pendaftaran tidak dapat dibatalkan. Saldo yang ditahan digunakan untuk membayar kartu jika Pengguna terpilih; saldo peserta yang tidak terpilih dikembalikan.",
        "Kartu yang tersisa setelah undian dapat dibeli langsung selama persediaan masih ada, dengan harga yang sama untuk masing-masing jenis kartu.",
        "Setiap Pengguna maksimal memperoleh satu C.Card per rilis.",
        "Jumlah kartu Signed adalah 10% dari total kartu, dibulatkan ke atas. Harga dan jumlahnya ditampilkan terpisah dari kartu Reguler.",
        "Jika Drop dibatalkan, penahanan saldo dilepas atau C-Coin yang telah dipotong dikembalikan penuh.",
      ],
    },
    {
      id: "vault",
      title: "8. Vault dan Pengiriman Fisik",
      paragraphs: [
        "Kartu dari penjualan perdana maupun jual beli antarkolektor disimpan di Vault terlebih dahulu. Setelah transaksi selesai, pemilik dapat meminta pengiriman fisik secara terpisah.",
        "Pemilik dapat meminta pengiriman ke alamatnya dan membayar ongkir dalam C-Coin setelah total biaya ditampilkan. Permintaan pembatalan diajukan melalui dukungan sebelum pengemasan dimulai, sebagaimana diatur dalam Kebijakan Pengiriman & Vault.",
        "Operator menjaga kartu dengan kehati-hatian yang wajar. Kehilangan atau kerusakan karena kesalahan Operator atau mitra dalam kendalinya akan menerima penanganan atau ganti rugi yang wajar berdasarkan bukti, kondisi, harga transaksi, dan hak konsumen.",
      ],
    },
    {
      id: "secondary",
      title: "9. Jual Beli Antarkolektor",
      bullets: [
        "Kartu yang dijual harus memenuhi syarat kondisi dan keaslian serta berada di Vault. Pengecualian untuk penjualan pertama kartu edisi tunggal milik kreator dijelaskan di bawah.",
        "Harga jual langsung minimal 3 C-Coin. Setiap Pengguna dapat memasang maksimal 20 kartu untuk dijual secara bersamaan.",
        "Setiap penawar dapat memiliki maksimal 3 penawaran aktif. Hanya penawaran tertinggi yang aktif untuk satu C.Card. Jika ada penawaran lebih tinggi, saldo penawar sebelumnya dikembalikan.",
        "Penawaran dapat dibatalkan setelah 24 jam sejak diajukan. Transaksi terjadi jika pemilik menerima penawaran; penawaran tidak berakhir secara otomatis.",
        "Hasil penjualan dan royalti kreator dikreditkan sebagai C-Gems setelah penyelesaian transaksi.",
        "Distribusi penjualan antarkolektor adalah 7,5% Operator, 7,5% royalti seumur hidup kreator, dan sisa untuk penjual. Bagian Operator dan kreator dibulatkan ke atas; rincian final tampil sebelum konfirmasi.",
        "Pada penjualan pertama kartu edisi tunggal milik kreator, C-Coin pembeli ditahan sampai kartu diterima di Vault dan lolos pemeriksaan keaslian serta kondisi. Setelah pemeriksaan selesai, pembayaran diteruskan kepada pihak yang berhak. Jika transaksi dibatalkan sesuai ketentuan, C-Coin dikembalikan penuh tanpa biaya dan tanpa penambahan XP.",
        "Kartu dengan segel yang terdeteksi berubah, cacat yang membuatnya tidak layak jual, hilang, atau gagal verifikasi tidak dapat diperdagangkan.",
        "Penjual tidak dapat membeli kembali C.Card yang sama selama 24 jam. Kreator tidak dapat membeli atau mengajukan penawaran atas C.Card miliknya sendiri selama 30 hari setelah transfer yang relevan.",
        "Transaksi palsu, kolusi, transaksi semu untuk memanipulasi pasar, manipulasi harga, penyalahgunaan akun, dan koordinasi menyesatkan dilarang.",
      ],
    },
    {
      id: "nfc",
      title: "10. NFC, Keaslian, dan Kepemilikan",
      bullets: [
        "Chip NFC digunakan untuk memeriksa keaslian kartu dan mencatat riwayat kepemilikan. Chip ini tidak digunakan untuk pembayaran.",
        "Pengguna dilarang merusak, menyalin, mengganti, atau memanipulasi chip, tautan pemeriksaan keaslian, segel, dan riwayat kepemilikan.",
        "Catatan kepemilikan Platform merupakan catatan operasional dan dapat ditinjau berdasarkan bukti transaksi serta verifikasi fisik.",
        "Pemeriksaan melalui NFC memerlukan kartu fisik serta perangkat yang mendukung. Kode QR membuka informasi kartu dan tidak membuktikan keaslian. Jika NFC tidak dapat dibaca, hubungi dukungan untuk pemeriksaan lebih lanjut.",
      ],
    },
    {
      id: "refund",
      title: "11. Pembatalan, Pengembalian Dana, dan Sengketa Transaksi",
      paragraphs: [
        "Hak pembatalan dan pengembalian dana bergantung pada tahap transaksi, status C.Card, sifat edisi terbatas, serta hukum perlindungan konsumen. Pengguna wajib melaporkan transaksi tidak sah, barang salah, kerusakan, kehilangan, atau ketidaksesuaian material secepatnya dengan bukti yang tersedia.",
        "Operator dapat menahan penyelesaian transaksi atau penarikan dana selama investigasi yang wajar. Pembatasan atau penutupan akun tidak dengan sendirinya menghanguskan saldo sah.",
        "Ketentuan ini tidak membatasi hak konsumen yang tidak dapat dikesampingkan berdasarkan hukum Indonesia.",
      ],
    },
    {
      id: "kepatuhan",
      title: "12. KYC, Pajak, dan Kepatuhan",
      bullets: [
        "KYC wajib untuk penarikan dana C-Gems dan dapat diwajibkan untuk batas saldo, pola transaksi, pemeriksaan risiko, atau kewajiban hukum.",
        "Operator dapat meminta identitas, rekening bank, NPWP bila relevan, bukti sumber transaksi, atau dokumen pendukung secara proporsional.",
        "Pengguna bertanggung jawab atas kewajiban pajaknya. Operator dapat memotong, memungut, melaporkan, atau meminta data jika diwajibkan hukum.",
        "Operator dapat menolak atau menunda transaksi untuk memenuhi sanksi, pencegahan penipuan, anti-pencucian uang, perintah otoritas, atau kewajiban hukum.",
      ],
    },
    {
      id: "larangan",
      title: "13. Penggunaan yang Dilarang dan Penegakan",
      bullets: [
        "Penipuan, penyamaran identitas, pencurian akses akun, penyalahgunaan sanggahan pembayaran, eksploitasi celah sistem, penggunaan bot, atau manipulasi undian.",
        "Pencucian uang, penyamaran sumber dana, atau penggunaan akun pihak lain.",
        "Pelanggaran kekayaan intelektual, privasi, keamanan, ketersediaan Platform, atau hukum.",
        "Upaya menghindari batas akun, verifikasi identitas, penahanan saldo, ketentuan penarikan, dan aturan jual beli.",
      ],
      note: "Operator dapat memberi peringatan, membatasi fitur, membatalkan transaksi, menahan penyelesaian transaksi, melakukan pembatasan akun, atau menutup akun secara proporsional. Alasan dan kanal keberatan diberikan sejauh tidak dilarang hukum atau mengganggu investigasi.",
    },
    {
      id: "kekayaan-intelektual",
      title: "14. Hak Kekayaan Intelektual",
      paragraphs: [
        "Platform, perangkat lunak, merek, desain, teks, dan materi terkait dilindungi hukum. Membeli C.Card tidak memberikan hak cipta, hak atas merek, hak penggunaan nama atau citra diri kreator, maupun hak komersial kreator.",
        "Kreator menjamin memiliki atau telah memperoleh hak yang diperlukan atas materi yang diserahkan kepada Operator.",
      ],
    },
    {
      id: "privasi-komunikasi",
      title: "15. Privasi dan Komunikasi Elektronik",
      paragraphs: [
        "Pemrosesan data pribadi diatur dalam Kebijakan Privasi C.Verse. Pengguna menyetujui komunikasi transaksional yang diperlukan untuk OTP, keamanan, akun, transaksi, penarikan dana, dan pembaruan Ketentuan.",
        "Komunikasi promosi diberikan sesuai pilihan Pengguna dan dapat dihentikan melalui mekanisme yang tersedia.",
      ],
    },
    {
      id: "penutupan",
      title: "16. Pembatasan Akun, Penutupan Akun, dan Saldo",
      paragraphs: [
        "Pengguna dapat meminta penutupan akun setelah transaksi, sengketa, penarikan dana, dan kewajiban tertunda selesai. Operator dapat melakukan pembatasan akun segera apabila terdapat risiko keamanan, penipuan, kerugian, pelanggaran material, atau perintah otoritas.",
        "Penyelesaian C-Coin, C-Gems, C.Card di Vault, data, dan kewajiban dilakukan sesuai hak Pengguna dan hukum. Operator tidak mengambil saldo atau kartu tanpa dasar kontraktual atau hukum yang sah.",
      ],
    },
    {
      id: "perubahan",
      title: "17. Ketersediaan dan Perubahan Layanan",
      paragraphs: [
        "Operator berupaya menjaga layanan tersedia tetapi tidak menjamin bebas gangguan. Pemeliharaan, insiden, penyedia layanan, jaringan, keadaan di luar kendali, dan perubahan hukum dapat memengaruhi layanan.",
        "Perubahan material diberitahukan sekurang-kurangnya 30 hari sebelum berlaku jika wajar dan diizinkan hukum. Perubahan mendesak untuk keamanan atau hukum dapat berlaku lebih cepat. Persetujuan ulang diminta jika diwajibkan.",
      ],
    },
    {
      id: "tanggung-jawab",
      title: "18. Jaminan dan Batas Tanggung Jawab",
      paragraphs: [
        "Layanan diberikan berdasarkan ketersediaan dengan standar kehati-hatian yang wajar. Operator tidak menjamin nilai jual kembali, keuntungan, kecocokan untuk spekulasi, atau layanan pihak ketiga.",
        "Tidak ada ketentuan yang mengecualikan tanggung jawab atas kesengajaan, kelalaian berat, penipuan Operator, pelanggaran data yang menjadi tanggung jawab Operator, atau hak konsumen yang tidak dapat dikesampingkan.",
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
      label: "Peraturan Bank Indonesia Nomor 10 Tahun 2025 tentang Pengaturan Industri Sistem Pembayaran",
      href: "https://www.bi.go.id/id/publikasi/peraturan/Pages/PBI_102025.aspx",
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
  updated: "5 September 2026",
  updatedAt: "2026-09-05",
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
          ["Akun", "Nama, email, nama pengguna, foto profil, nomor telepon."],
          [
            "Transaksi",
            "Isi saldo, penahanan saldo, pembelian, penawaran, penawaran jual, C-Coin, C-Gems, penarikan dana, dan pengembalian dana.",
          ],
          ["KYC", "Nama sesuai identitas, NIK, KTP, selfie, NPWP opsional, dan rekening bank."],
          ["Pengiriman", "Nama penerima, telepon, alamat, resi, dan status pengiriman."],
          ["C.Card dan NFC", "Kode identitas chip, urutan pemindaian, hasil pemeriksaan keaslian dan segel, serta riwayat kepemilikan."],
          ["Teknis", "Alamat IP, perangkat, browser, catatan keamanan, cookie, dan data penggunaan."],
          ["Preferensi", "Visibilitas profil, persetujuan analitik, dan persetujuan laporan pasar."],
        ],
      },
    },
    {
      id: "sumber",
      title: "3. Sumber Data",
      bullets: [
        "Langsung dari Pengguna saat mendaftar, bertransaksi, KYC, menghubungi dukungan, atau mengubah preferensi.",
        "Dari Google atau penyedia layanan masuk akun sesuai persetujuan Pengguna.",
        "Dari penyedia pembayaran, bank, penyedia transfer dana, dan mitra logistik untuk status transaksi.",
        "Dari chip NFC pada kartu, catatan penggunaan Platform, sistem keamanan, dan catatan penanganan layanan.",
      ],
    },
    {
      id: "tujuan",
      title: "4. Tujuan Pemrosesan",
      bullets: [
        "Membuat dan mengamankan akun, memverifikasi akses saat masuk, serta membantu pemulihan akses.",
        "Menjalankan isi saldo, pembelian, undian pembelian, jual beli antarkolektor, penyelesaian transaksi, penarikan dana, pengembalian dana, Vault, dan pengiriman.",
        "Memeriksa keaslian C.Card dan mencatat riwayat kepemilikannya.",
        "Mencegah penipuan, penyalahgunaan beberapa akun, transaksi semu untuk memanipulasi pasar, gangguan keamanan, dan pelanggaran hukum.",
        "Memberikan dukungan, notifikasi transaksional, dan komunikasi layanan.",
        "Mengembangkan layanan menggunakan ringkasan statistik sesuai pilihan persetujuan Pengguna.",
        "Memenuhi kewajiban hukum, audit, pajak, dan permintaan otoritas yang sah.",
      ],
    },
    {
      id: "dasar-hukum",
      title: "5. Dasar Hukum Pemrosesan",
      bullets: [
        "Pelaksanaan kontrak saat data diperlukan untuk menyediakan layanan yang diminta.",
        "Persetujuan untuk pemrosesan opsional, termasuk promosi dan jenis analitik tertentu.",
        "Pemenuhan kewajiban hukum yang berlaku, termasuk pajak, pembukuan, dan permintaan otoritas yang sah.",
        "Kepentingan sah yang proporsional untuk pencegahan penipuan, keamanan, dukungan, dan perbaikan layanan.",
      ],
    },
    {
      id: "penerima",
      title: "6. Penerima Data",
      table: {
        headers: ["Penerima", "Tujuan"],
        rows: [
          ["Supabase dan Cloudflare", "Pengoperasian layanan, penyimpanan data, keamanan, penyajian konten, dan pengiriman email layanan."],
          ["Penyedia pembayaran dan transfer dana", "Isi saldo, verifikasi status, penarikan dana, dan pengembalian dana."],
          ["Mitra KYC", "Verifikasi identitas apabila integrasi pihak ketiga digunakan."],
          ["Mitra logistik", "Pemrosesan pengiriman dari Vault dan klaim pengiriman."],
          [
            "Kreator",
            "Hanya ringkasan statistik sesuai pilihan persetujuan Pengguna; identitas Pengguna tidak dibagikan untuk analitik kreator.",
          ],
          ["Otoritas", "Pemenuhan permintaan yang sah dan kewajiban hukum."],
        ],
      },
      note: "C.Verse tidak menjual data pribadi kepada pihak ketiga untuk pemasaran.",
      paragraphs: [
        "Penyedia infrastruktur dapat memproses data di luar Indonesia. Transfer tersebut harus memenuhi ketentuan Pasal 56 UU Pelindungan Data Pribadi: tingkat pelindungan yang setara atau lebih tinggi, atau pelindungan yang memadai dan mengikat. Jika kedua syarat tersebut tidak terpenuhi, persetujuan Pengguna harus diperoleh sebelum transfer dilakukan.",
      ],
    },
    {
      id: "retensi",
      title: "7. Masa Penyimpanan Data",
      paragraphs: [
        "Data disimpan selama diperlukan untuk tujuan pemrosesan, pelaksanaan kontrak, audit, pencegahan penipuan, dan kewajiban hukum. Periode berbeda dapat berlaku untuk akun, transaksi, KYC, komunikasi dukungan, dan catatan teknis.",
        "Catatan transaksi, keaslian, dan kepemilikan kartu dapat disimpan lebih lama untuk menjaga kebenaran riwayat kartu dan memenuhi kebutuhan audit. Setelah masa penyimpanan berakhir, data dihapus atau dianonimkan sesuai ketentuan hukum. Jika data masih harus disimpan karena kewajiban hukum atau sengketa, penggunaannya dibatasi untuk keperluan tersebut.",
      ],
    },
    {
      id: "keamanan",
      title: "8. Keamanan Data",
      bullets: [
        "Data dienkripsi saat dikirim, dan akses dibatasi sesuai tugas petugas.",
        "Dokumen verifikasi identitas disimpan secara tertutup dan hanya dapat diakses petugas berwenang.",
        "Pencatatan serta pemantauan akses, dengan izin yang dibatasi sesuai tugas setiap petugas.",
        "Jika terjadi kegagalan pelindungan data pribadi, Operator wajib memberi pemberitahuan tertulis kepada Pengguna terdampak dan lembaga yang berwenang paling lambat 3 x 24 jam sesuai UU Pelindungan Data Pribadi. Pemberitahuan menjelaskan data yang terdampak, kapan dan bagaimana kejadian berlangsung, serta langkah penanganannya.",
      ],
    },
    {
      id: "hak",
      title: "9. Hak atas Data Pribadi",
      bullets: [
        "Meminta informasi dan akses terhadap data pribadi.",
        "Memperbaiki data yang tidak akurat atau tidak lengkap.",
        "Menarik kembali persetujuan atas pemrosesan data yang memerlukan persetujuan Pengguna.",
        "Meminta penghapusan, pembatasan, atau penghentian pemrosesan sejauh diizinkan hukum.",
        "Mengajukan keberatan atau keluhan, serta meminta salinan data dalam format yang dapat dipindahkan jika berlaku.",
      ],
      note: "Permintaan dikirim ke privacy@c-verse.co. Kami dapat meminta verifikasi identitas dan menolak bagian permintaan yang bertentangan dengan kewajiban hukum atau hak pihak lain dengan memberikan alasan.",
    },
    {
      id: "cookie",
      title: "10. Cookie dan Penyimpanan Lokal",
      paragraphs: [
        "Platform menggunakan cookie atau penyimpanan lokal yang diperlukan untuk sesi, keamanan, preferensi, dan fungsi utama. Analitik yang tidak diperlukan untuk fungsi utama hanya digunakan sesuai pilihan persetujuan Pengguna.",
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
  description:
    "Aturan penyelesaian transaksi ke Vault, pengiriman dari Vault, biaya, pembatalan, serta penanganan kehilangan atau kerusakan.",
  status: "Final internal",
  updated: "5 September 2026",
  updatedAt: "2026-09-05",
  version: "1.0",
  audience: "Pemilik C.Card",
  sections: [
    {
      id: "prinsip",
      title: "1. Prinsip Dasar",
      bullets: [
        "Semua penjualan perdana dan transaksi jual beli antarkolektor diselesaikan ke Vault terlebih dahulu.",
        "Permintaan pengiriman fisik diajukan terpisah setelah pembelian selesai dan kartu berada di Vault.",
        "Kepemilikan terpisah dari lokasi fisik sehingga C.Card di Vault dapat diperdagangkan tanpa perpindahan fisik.",
      ],
    },
    {
      id: "settlement",
      title: "2. Penyelesaian Transaksi ke Vault",
      paragraphs: [
        "Setelah pembayaran penjualan perdana selesai, kepemilikan kartu dicatat dan kartu disimpan di Vault. Alamat dan ongkir tidak diminta saat pembelian. Untuk jual beli antarkolektor, kepemilikan berpindah setelah pembayaran dan pemeriksaan transaksi selesai.",
        "Kartu yang masih berada pada penjual harus diterima di Vault, sesuai dengan data NFC, memiliki segel yang lolos pemeriksaan, dan memenuhi syarat kondisi sebelum hasil penjualan diteruskan.",
        "Pada penjualan pertama kartu edisi tunggal milik kreator, C-Coin pembeli ditahan sampai kartu diterima di Vault dan lolos verifikasi. Jika transaksi dibatalkan sesuai ketentuan, pembayaran dikembalikan penuh tanpa biaya dan tanpa penambahan XP.",
      ],
    },
    {
      id: "ship-out",
      title: "3. Pengiriman dari Vault",
      bullets: [
        "Pengiriman dapat diminta setelah transaksi selesai dan kartu berada di Vault. Permintaan dapat ditunda jika kartu sedang dalam proses transaksi, sengketa, atau pemeriksaan.",
        "Pemilik mengonfirmasi alamat dan biaya, lalu membayar ongkir dalam C-Coin. Perkembangan pengiriman ditampilkan mulai dari permintaan diterima, dikemas, dikirim, hingga diterima pemilik.",
        "Biaya pengiriman ditampilkan sebelum pemilik mengonfirmasi permintaan.",
        "Pengemasan ditargetkan selesai dalam 1-2 hari kerja. Perkiraan waktu pengiriman setelah diserahkan ke mitra logistik adalah 1-3 hari kerja untuk Jawa dan 3-7 hari kerja untuk luar Jawa.",
      ],
    },
    {
      id: "pembatalan",
      title: "4. Pembatalan dan Pengembalian Dana Ongkir",
      paragraphs: [
        "Pemilik dapat menghubungi dukungan untuk membatalkan permintaan sebelum pengemasan dimulai. Jika pembatalan disetujui pada tahap ini, ongkir dikembalikan penuh dalam C-Coin. Pengiriman yang sudah dikemas atau dikirim tidak dapat dibatalkan sepihak. Ketentuan ini tidak mengurangi hak konsumen atas barang yang salah, rusak, atau tidak sesuai pesanan.",
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
            "Investigasi dan penanganan atau ganti rugi wajar berdasarkan kondisi, harga transaksi, bukti, dan hak konsumen.",
          ],
          [
            "Hilang atau rusak dalam pengiriman dari Vault",
            "Klaim logistik/asuransi dikoordinasikan Platform; tanggung jawab akhir mengikuti bukti dan hukum.",
          ],
          [
            "Hilang saat penjual mengirim ke Vault",
            "Penjual mengajukan klaim kepada penyedia logistik yang dipilih; Platform membantu dengan bukti penerimaan.",
          ],
          ["NFC rusak di Vault", "Pemeriksaan, perbaikan, atau ganti rugi jika kerusakan menjadi tanggung jawab Platform."],
        ],
      },
    },
    {
      id: "dukungan",
      title: "6. Dukungan",
      paragraphs: [
        "Keluhan dikirim ke support@c-verse.co dengan nomor pengiriman, foto, video pembukaan paket bila ada, dan bukti pendukung lain. Kebijakan ini tidak menghapus hak konsumen yang tidak dapat dikesampingkan.",
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
  description: "Ketentuan verifikasi identitas, batas saldo C-Coin, dan penarikan C-Gems ke rekening bank.",
  status: "Draft publikasi",
  updated: "5 September 2026",
  updatedAt: "2026-09-05",
  version: "0.9",
  audience: "Penjual dan kreator",
  sections: [
    {
      id: "prinsip",
      title: "1. Prinsip",
      paragraphs: [
        "Verifikasi identitas (KYC) digunakan untuk memastikan identitas Pengguna dan mencegah penipuan. Sesuai kebijakan C.Verse, verifikasi ini wajib sebelum C-Gems ditarik ke rekening bank.",
        "Sebelum verifikasi identitas, Pengguna tetap dapat menggunakan fitur selain penarikan dana. Isi saldo dibatasi agar saldo setelah pengisian tidak melebihi 500 C-Coin. Operator dapat meminta verifikasi lebih awal untuk pemeriksaan keamanan.",
      ],
    },
    {
      id: "trigger",
      title: "2. Kapan Verifikasi Diperlukan",
      table: {
        headers: ["Kebutuhan", "Ketentuan"],
        rows: [
          ["Penarikan dana pertama", "KYC wajib untuk penarikan dana C-Gems berapa pun nilainya; pengajuan minimal 10 C-Gems."],
          ["Isi saldo", "KYC diperlukan jika isi saldo akan membuat saldo melebihi 500 C-Coin."],
          ["Pemeriksaan risiko", "KYC dapat diminta karena pola transaksi, penipuan, sanksi, atau kewajiban hukum."],
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
        "Pengguna mengisi formulir dan mengunggah dokumen. Tim C.Verse memeriksa permohonan dan menampilkan status menunggu, disetujui, atau ditolak. Pemeriksaan ditargetkan selesai dalam 1x24 jam.",
        "Penolakan disertai alasan yang dapat diinformasikan dan kesempatan unggah ulang, kecuali pengungkapan mengganggu kontrol keamanan atau dilarang hukum.",
      ],
    },
    {
      id: "rekening",
      title: "5. Verifikasi Rekening",
      paragraphs: [
        "Rekening penarikan dana harus berada atas nama pihak yang terverifikasi. Perubahan rekening memerlukan verifikasi ulang atau pemeriksaan tambahan.",
      ],
    },
    {
      id: "keamanan",
      title: "6. Keamanan dan Masa Penyimpanan",
      bullets: [
        "Dokumen KYC disimpan pada penyimpanan tertutup dengan enkripsi saat transit dan kontrol akses terbatas.",
        "Hanya petugas berwenang yang dapat mengakses dokumen sesuai tugasnya. Akses dilindungi dengan verifikasi masuk dan dicatat untuk pemeriksaan keamanan.",
        "Data disimpan selama diperlukan untuk tujuan KYC, sengketa, audit, dan kewajiban hukum, lalu dihapus atau dibatasi.",
      ],
    },
    {
      id: "monitoring",
      title: "7. Pemeriksaan Keamanan",
      bullets: [
        "Operator memeriksa aktivitas transaksi untuk mencegah penipuan dan penyalahgunaan layanan.",
        "Operator dapat meminta klarifikasi atau dokumen pendukung yang relevan.",
        "Pemeriksaan dilakukan secara proporsional terhadap risiko yang ditemukan.",
        "Pengguna dapat menghubungi dukungan untuk menanyakan status pemeriksaan atau mengajukan keberatan.",
      ],
      note: "Operator dapat menahan penarikan dana dan meminta klarifikasi selama investigasi yang proporsional.",
    },
    {
      id: "threshold",
      title: "8. Batas Saldo dan Penarikan",
      table: {
        headers: ["Parameter", "Nilai"],
        rows: [
          ["Penarikan dana C-Gems", "KYC wajib sejak penarikan dana pertama; pengajuan minimal 10 C-Gems."],
          [
            "Isi saldo sebelum verifikasi identitas",
            "Saldo setelah pengisian maksimal 500 C-Coin atau Rp5.000.000. Batas ini tidak membatalkan pengembalian dana atau penukaran C-Gems.",
          ],
          [
            "Isi saldo setelah verifikasi identitas",
            "Batas pengisian 500 C-Coin tidak berlaku setelah verifikasi disetujui. Pemeriksaan keamanan dan batas penyedia pembayaran tetap berlaku.",
          ],
        ],
      },
    },
    {
      id: "banding",
      title: "9. Penolakan dan Banding",
      paragraphs: [
        "Pengguna yang ditolak tidak dapat melakukan penarikan dana tetapi tetap dapat menggunakan fitur selain penarikan dana sejauh tidak dibatasi karena risiko lain. Banding dapat diajukan ke support@c-verse.co dengan bukti tambahan.",
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
  description: "Ringkasan hak, lisensi, pembagian pendapatan, royalti, penarikan dana, dan kewajiban kreator C.Verse.",
  status: "Draft kontrak",
  updated: "5 September 2026",
  updatedAt: "2026-09-05",
  version: "0.9",
  audience: "Kreator",
  sections: [
    {
      id: "status",
      title: "1. Kerja Sama Kreator",
      paragraphs: [
        "Kerja sama kreator dituangkan dalam perjanjian kolaborasi dengan C.Verse. Akun kreator diaktifkan setelah kerja sama disepakati.",
        "Hak, kewajiban, materi yang digunakan, dan jadwal rilis disepakati bersama sebelum kartu diterbitkan.",
      ],
    },
    {
      id: "hak-cipta",
      title: "2. Hak Cipta dan Lisensi",
      paragraphs: [
        "Kreator tetap memiliki hak cipta atas karya yang digunakan dalam C.Card. Kreator memberikan lisensi non-eksklusif kepada Operator untuk memproduksi, menampilkan, memasarkan, mendistribusikan, dan menjual C.Card sesuai kolaborasi.",
        "Pembatasan wilayah, jangka waktu, penggunaan citra diri kreator, persetujuan desain, dan materi kampanye ditetapkan lebih rinci dalam perjanjian kolaborasi individual.",
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
      title: "4. Pembagian Pendapatan Penjualan Perdana",
      paragraphs: [
        "Operator menanggung produksi, logistik awal, dan pemeriksaan kualitas kartu. Pendapatan penjualan perdana dibagi 70% untuk Operator dan 30% untuk Kreator dari harga jual kotor. Bagian Kreator dibulatkan ke bawah dalam C-Gems utuh; sisanya menjadi bagian Operator.",
        "Untuk contoh harga 30 C-Coin, bagian Kreator adalah 9 C-Gems sebelum pajak atau penyesuaian yang diwajibkan hukum.",
      ],
    },
    {
      id: "royalti",
      title: "5. Royalti Jual Beli Antarkolektor",
      paragraphs: [
        "Kreator memperoleh royalti seumur hidup nominal 7,5% setiap kali C.Card yang terkait berpindah tangan melalui jual beli antarkolektor. Distribusi nominal adalah 7,5% Operator, 7,5% Kreator, dan sisa untuk penjual.",
        "Karena nilai C-Coin dan C-Gems menggunakan bilangan bulat, bagian Operator dan Kreator dibulatkan ke atas dan penjual menerima sisanya. Rincian final dicatat pada penyelesaian transaksi.",
      ],
    },
    {
      id: "seed",
      title: "6. C.Card Edisi Tunggal",
      paragraphs: [
        "C.Card edisi tunggal adalah kartu yang hanya dibuat satu buah dan awalnya dimiliki kreator. Kartu ini dapat dijual kepada kolektor. Pada penjualan pertama, kreator menerima bagian penjual serta royalti, secara nominal 92,5% sebelum pembulatan.",
        "Pembayaran diteruskan setelah C.Card diterima di Vault dan lolos pemeriksaan NFC serta kondisi.",
      ],
    },
    {
      id: "payout",
      title: "7. C-Gems dan Penarikan Dana",
      bullets: [
        "Pembagian pendapatan, royalti, hasil penjualan C.Card edisi tunggal, dan Dukungan dikreditkan sebagai C-Gems.",
        "C-Gems dari setiap penerimaan dapat ditarik ke rekening setelah masa tunggu 24 jam.",
        "Penarikan dana minimum 10 C-Gems dan memerlukan verifikasi identitas. Biaya 1% dari jumlah pengajuan dibulatkan ke atas ke C-Gems utuh. Permintaan ditargetkan diproses setiap Selasa yang merupakan hari kerja; waktu penerimaan bergantung pada bank dan pemeriksaan transaksi.",
        "C-Gems dapat ditukar menjadi C-Coin dengan perbandingan 1:1, tanpa biaya dan tanpa penambahan XP. Penukaran tidak dapat dibatalkan.",
        "Pajak dipotong atau dilaporkan sesuai status pihak dan hukum yang berlaku.",
      ],
    },
    {
      id: "integritas",
      title: "8. Integritas Pasar",
      bullets: [
        "Kreator dilarang bertransaksi dengan akun sendiri atau akun pihak lain yang dikendalikannya, membuat transaksi semu, memanipulasi harga, atau menjanjikan keuntungan dalam promosi.",
        "Kreator tidak dapat membeli atau mengajukan penawaran atas C.Card miliknya sendiri selama 30 hari setelah transfer yang relevan.",
        "Hubungan komersial, promosi berbayar, dan informasi material harus diungkapkan secara jujur.",
      ],
    },
    {
      id: "terminasi",
      title: "9. Masa Berlaku dan Pengakhiran Kerja Sama",
      paragraphs: [
        "Ketentuan detail masa kolaborasi, pembatalan Drop, penggunaan materi setelah kerja sama berakhir, dan kewajiban yang bertahan ditetapkan dalam perjanjian individual.",
        "Royalti seumur hidup untuk C.Card yang telah dirilis tetap berjalan sesuai catatan Platform dan perjanjian, kecuali hukum atau putusan sengketa menentukan lain.",
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

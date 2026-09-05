export const categories = [
  { id: "1543187103884775534", name: "✦ MULAI DI SINI", access: "public" },
  { id: "1543187114584449054", name: "💬 RUANG KOMUNITAS", access: "public" },
  { id: "1543187122507354112", name: "🎴 DUNIA C.CARD", access: "public" },
  { id: "1543187136746885190", name: "🛟 PUSAT BANTUAN", access: "public", ticket: true },
  { id: "1543187150403797032", name: "✦ STUDIO KREATOR", access: "creator" },
  { id: "1543187159987523664", name: "🎙 HANGOUT", access: "public" },
  { id: "1543187167038283788", name: "🔒 OPERASIONAL", access: "staff" },
];

// IDs preserve history, links, and the existing Ticket Tool panel through renames.
export const channels = [
  {
    id: "1543187108754100266",
    name: "mulai-di-sini",
    category: 0,
    access: "readonly",
    topic: "Selamat datang di C.Verse. Baca aturan, pilih minat di Channels & Roles, lalu kenalan. Situs resmi: https://c-verse.co",
  },
  {
    id: "1543181812065632257",
    name: "aturan-komunitas",
    category: 0,
    access: "readonly",
    topic:
      "Sopan, bebas spam dan scam. Jangan bagikan OTP, identitas, atau bukti pembayaran. Semua transaksi C.Card hanya di https://c-verse.co",
  },
  {
    id: "1543187111690113070",
    name: "pengumuman",
    category: 0,
    access: "readonly",
    topic: "Kabar resmi C.Verse. Informasi produk, pembaruan komunitas, dan agenda yang sudah dikonfirmasi.",
  },
  {
    id: "1543174684080734311",
    name: "ruang-ngobrol",
    category: 1,
    access: "public",
    slowmode: 5,
    topic: "Tempat ngobrol para kolektor dan kreator. Pembuka hari ini: karya atau kreator apa yang sedang kamu ikuti?",
  },
  {
    id: "1543187119034470520",
    name: "halo-kolektor",
    category: 1,
    access: "public",
    slowmode: 30,
    topic: "Kenalan yuk: panggilanmu, kreator atau seri favorit, dan hal yang ingin kamu tahu tentang C.Card. Tidak perlu data pribadi.",
  },
  {
    id: "1543187127095918592",
    name: "info-drop",
    category: 2,
    access: "readonly",
    topic: "Jadwal dan tautan drop resmi. Waktu mengikuti halaman drop di C.Verse. Aktifkan minat Info Drop untuk mengikuti kabarnya.",
  },
  {
    id: "1543187130107306074",
    name: "ruang-kartu",
    category: 2,
    access: "public",
    slowmode: 5,
    topic:
      "Ngobrol artwork, cerita kreator, NFC, dan pengalaman koleksi. Apa detail C.Card favoritmu? Penawaran dan transaksi tetap di platform.",
  },
  {
    id: "1543187133295235092",
    name: "showcase",
    category: 2,
    access: "public",
    slowmode: 60,
    tags: ["Kartu favorit", "Koleksi", "Detail artwork", "Cerita NFC"],
    gallery: true,
    topic:
      "GALERI KOLEKTOR\nSatu post untuk satu kartu atau set. Ceritakan apa yang membuatnya spesial, lalu tambahkan foto dan tag.\nJudul: nama kartu / seri. Isi: cerita koleksi + detail favorit. Sensor data pribadi; bukan tempat jual-beli.",
  },
  {
    id: "1543187157089525760",
    name: "spotlight-kreator",
    category: 2,
    access: "spotlight",
    topic:
      "Kenali karya dan proses kreatif di balik C.Card. Staf menerbitkan sorotan untuk semua; kreator dapat mengusulkan karya melalui studio privat.",
  },
  {
    id: "1543187141411078165",
    name: "bantuan",
    category: 3,
    access: "readonly",
    ticket: true,
    topic:
      "Bantuan akun dan transaksi melalui panel Ticket Tool. Jangan tulis OTP, kata sandi, dokumen KYC, atau bukti pembayaran di ruang publik.",
  },
  {
    id: "1543187144346968114",
    name: "laporan-masalah",
    category: 3,
    access: "public",
    slowmode: 60,
    tags: ["Web", "Koleksi & NFC", "Tampilan", "Perlu info", "Selesai"],
    topic:
      "LAPORAN BUG PUBLIK\nJudul singkat. Sertakan perangkat/browser, langkah, hasil yang diharapkan, dan hasil aktual. Sensor screenshot.\nMasalah akun/transaksi: gunakan tiket privat. Celah keamanan atau data sensitif: jangan diposting di sini.",
  },
  {
    id: "1543187147131981935",
    name: "ide-komunitas",
    category: 3,
    access: "public",
    slowmode: 60,
    tags: ["Pengalaman koleksi", "Komunitas", "Aksesibilitas", "Dipertimbangkan", "Diterapkan"],
    topic:
      "IDE UNTUK C.VERSE\nSatu ide per post: masalah yang kamu alami, usulanmu, dan siapa yang terbantu.\nBaca ide sebelumnya dan beri reaksi jika sependapat. Tag status ditetapkan staf; usulan tidak menjanjikan tanggal rilis.",
  },
  {
    id: "1543187153595408396",
    name: "studio-kreator",
    category: 4,
    access: "creator",
    topic: "Ruang privat kreator terverifikasi dan staf untuk koordinasi karya. Kerja sama kreator tetap melalui tim C.Verse.",
  },
  { id: "1543187164089679894", name: "Lounge · Ngobrol Santai", category: 5, access: "public", voice: true },
  {
    id: "1543187174235574282",
    name: "staff-chat",
    category: 6,
    access: "staff",
    topic: "Koordinasi moderator dan tim C.Verse. Ringkas keputusan dan tindak lanjut di thread.",
  },
  {
    id: "1543187177134104627",
    name: "mod-log",
    category: 6,
    access: "stafflog",
    topic:
      "Alert AutoMod dan tindak lanjut moderasi. Buka Audit Log server untuk perubahan konfigurasi; channel ini bukan salinan seluruh Audit Log.",
  },
  {
    id: "1543187180237627452",
    name: "ticket-log",
    category: 6,
    access: "stafflog",
    ticket: true,
    topic: "Log/transkrip Ticket Tool. Hanya staf dan bot tiket. Jangan menyimpan OTP, kredensial, atau dokumen KYC.",
  },
  {
    id: "1543181812065632260",
    name: "discord-updates",
    category: 6,
    access: "stafflog",
    topic: "Pembaruan Community resmi dari Discord untuk pengelola server.",
  },
  {
    name: "github-updates",
    category: 6,
    access: "adminlog",
    topic:
      "Notifikasi repository privat C.Verse: push, pull request, dan release. Hanya Owner/Admin; detail kode tidak masuk ruang publik.",
  },
  {
    name: "deploy-status",
    category: 6,
    access: "adminlog",
    topic: "Hasil CI/build/deploy C.Verse. Build sukses tidak otomatis berarti versi sudah ter-deploy; ikuti tautan sumber.",
  },
  {
    name: "cloudflare-alerts",
    category: 6,
    access: "adminlog",
    topic: "Alert operasional Cloudflare. Periksa jenis kejadian dan dashboard sumber sebelum menyimpulkan outage.",
  },
];

export const webhookPlan = [
  { key: "github", channel: "github-updates", name: "C.Verse · GitHub" },
  { key: "deploy", channel: "deploy-status", name: "C.Verse · Build & Deploy" },
  { key: "cloudflare", channel: "cloudflare-alerts", name: "C.Verse · Cloudflare" },
];

export function onboardingPayload(ids, roles, current) {
  const prior = current.prompts?.find((prompt) => prompt.title === "Apa yang ingin kamu ikuti di C.Verse?");
  return {
    enabled: true,
    mode: 0,
    default_channel_ids: [
      "mulai-di-sini",
      "aturan-komunitas",
      "pengumuman",
      "ruang-ngobrol",
      "halo-kolektor",
      "ruang-kartu",
      "showcase",
      "ide-komunitas",
    ].map((name) => ids[name]),
    prompts: [
      {
        id: prior?.id ?? "0",
        type: 0,
        title: "Apa yang ingin kamu ikuti di C.Verse?",
        single_select: false,
        required: false,
        in_onboarding: true,
        options: [
          {
            title: "Info Drop",
            description: "Ikuti jadwal dan kabar rilis C.Card.",
            emoji: { name: "🎴" },
            role_ids: [roles["Info Drop"]],
            channel_ids: [ids["info-drop"]],
          },
          {
            title: "Cerita Kreator",
            description: "Kenali karya dan proses di balik C.Card.",
            emoji: { name: "✦" },
            role_ids: [roles["Cerita Kreator"]],
            channel_ids: [ids["spotlight-kreator"]],
          },
          {
            title: "Bantuan & Feedback",
            description: "Dapatkan bantuan privat atau laporkan masalah umum.",
            emoji: { name: "🛟" },
            role_ids: [],
            channel_ids: [ids["bantuan"], ids["laporan-masalah"]],
          },
        ].map((option) => ({
          ...option,
          ...(prior?.options.find((item) => item.title === option.title)?.id
            ? { id: prior.options.find((item) => item.title === option.title).id }
            : {}),
        })),
      },
    ],
  };
}

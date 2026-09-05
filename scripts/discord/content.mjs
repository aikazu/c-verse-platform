import { discordClient, readState, writeState } from "./client.mjs";

export function messagePlan(ids) {
  const mention = (name) => `<#${ids[name]}>`;
  return [
    {
      key: "welcome",
      channel: "mulai-di-sini",
      existingId: "1543187189599309886",
      embed: {
        title: "✦ SELAMAT DATANG DI C.VERSE",
        color: 0xffc94d,
        description:
          "Rumah untuk cerita kreator, karya yang kamu suka, dan koleksi yang berarti. Baru mengenal C.Card? Mulai dari tiga langkah ini.",
        fields: [
          {
            name: "01 · Kenali ruangnya",
            value: `Baca ${mention("aturan-komunitas")}. Semua transaksi C.Card berlangsung di [c-verse.co](https://c-verse.co).`,
          },
          {
            name: "02 · Pilih ceritamu",
            value: "Buka Channels & Roles untuk mengikuti Info Drop atau Cerita Kreator. Pilihan ini opsional dan bisa diganti kapan saja.",
          },
          {
            name: "03 · Mulai dengan satu sapaan",
            value: `Kenalan di ${mention("halo-kolektor")}, ngobrol di ${mention("ruang-kartu")}, atau ceritakan koleksimu di ${mention("showcase")}.`,
          },
          {
            name: "Butuh bantuan?",
            value: `Gunakan panel di ${mention("bantuan")}. Jangan membagikan OTP, kredensial, dokumen KYC, atau bukti pembayaran di ruang publik.`,
          },
        ],
        footer: { text: "C.Verse · Setiap koleksi punya cerita." },
      },
    },
    {
      key: "rules",
      channel: "aturan-komunitas",
      embed: {
        title: "📜 NYAMAN BERKOMUNITAS, AMAN BERKOLEKSI",
        color: 0xffc94d,
        description:
          "**1 · Hargai sesama.** Tidak ada pelecehan, ujaran kebencian, ancaman, atau konten seksual eksplisit.\n\n**2 · Jaga ruang tetap relevan.** Jangan spam, mengirim undangan/promosi tanpa izin, atau menyalahgunakan mention.\n\n**3 · Transaksi hanya di platform.** Jual-beli dan penawaran C.Card dilakukan melalui c-verse.co. Tidak ada jual-beli saldo atau transaksi lewat DM.\n\n**4 · Lindungi data pribadi.** Jangan membagikan OTP, kredensial, dokumen identitas, atau bukti pembayaran di ruang publik. Staf tidak meminta password atau OTP.\n\n**5 · Periksa sumber.** Info resmi ada di channel pengumuman dan info-drop. Waspadai DM yang mengaku staf, hadiah, atau meminta transfer.\n\n**6 · Laporkan dengan aman.** Gunakan panel bantuan untuk masalah privat. Moderator dapat menghapus konten, memberi timeout, kick, atau ban sesuai tingkat pelanggaran.",
        footer: { text: "Bantu kami menjaga ruang yang ramah untuk semua." },
      },
    },
    {
      key: "introductions",
      channel: "halo-kolektor",
      embed: {
        title: "👋 MULAI DARI SATU CERITA",
        color: 0x58c0f8,
        description:
          "Tidak perlu perkenalan formal. Coba isi tiga baris ini:\n\n**Panggil aku:** …\n**Kreator, karya, atau seri yang sedang kuikuti:** …\n**Hal yang ingin kutahu tentang C.Card:** …\n\nSudah kenalan? Sambut satu orang lain atau tanya tentang karya favoritnya. Tidak perlu nama lengkap atau data pribadi.",
      },
    },
    {
      key: "conversation",
      channel: "ruang-kartu",
      embed: {
        title: "🎴 CERITA DI BALIK KOLEKSI",
        color: 0xffc94d,
        description: `Apa yang membuat sebuah kartu terasa spesial buatmu: artwork, cerita kreatornya, atau pengalaman mendapatkannya?\n\nCeritakan di sini. Jika ingin berbagi foto, buat post di ${mention("showcase")} dengan satu detail favoritmu.`,
      },
    },
  ];
}

export const messageNonce = (key) => `${key}-260905`;

export async function publishContent() {
  if (!process.argv.includes("--publish")) throw new Error("Message publication requires explicit --publish");
  const api = discordClient();
  const ids = readState("resources.json");
  const published = readState("messages.json");
  for (const item of messagePlan(ids)) {
    const channelId = ids[item.channel];
    if (!channelId) throw new Error(`Missing channel: ${item.channel}`);
    const payload = { embeds: [item.embed], allowed_mentions: { parse: [] }, components: [] };
    const existing = published[item.key] ?? item.existingId;
    const result = existing
      ? await api("PATCH", `/channels/${channelId}/messages/${existing}`, payload)
      : await api("POST", `/channels/${channelId}/messages`, {
          ...payload,
          flags: 4096,
          nonce: messageNonce(item.key),
          enforce_nonce: true,
        });
    published[item.key] = result.id;
    writeState("messages.json", published);
    await api("PUT", `/channels/${channelId}/messages/pins/${result.id}`);
    console.log(`Published and pinned: ${item.key}`);
  }
}

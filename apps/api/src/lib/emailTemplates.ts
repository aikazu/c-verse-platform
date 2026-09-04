// Template email notifikasi transaksional (2026-09-02).
// Lane email = LOW VOLUME HIGH VALUE (keputusan owner): hanya event uang dan
// pemenuhan fisik yang masuk queue (channel='email' di notifications, ditulis
// trigger SQL via notify_user). Event berkala (outbid, bid_received, kalah
// raffle) sengaja TIDAK punya template — worker memperlakukan key tanpa
// render sebagai kegagalan permanen, jadi tidak bisa terkirim by accident.
// Gaya Bahasa Indonesia mengikuti creatorAccessEmailTemplate (lib/email.ts).

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

type Payload = Record<string, unknown>;

/** Payload values are DB-generated (never user HTML); still escaped defensively. */
function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function str(payload: Payload, key: string): string {
  const value = payload[key];
  return value === null || value === undefined ? "" : String(value);
}

function render(title: string, lines: string[], ctaLabel?: string, ctaPath?: string): RenderedEmail {
  const text = [`Halo,`, "", title, "", ...lines, "", "— Tim C.Verse"].join("\n");
  const cta = ctaLabel && ctaPath ? [`<p><a href="https://c-verse.co${ctaPath}">${ctaLabel}</a></p>`] : [];
  const html = [
    "<p>Halo,</p>",
    `<p><strong>${escapeHtml(title)}</strong></p>`,
    ...lines.map((line) => `<p>${escapeHtml(line)}</p>`),
    ...cta,
    "<p>— Tim C.Verse</p>",
  ].join("\n");
  return { subject: title, text, html };
}

/**
 * Map template_key (notifications.template_key, ditulis trigger SQL) -> email.
 * Returns null untuk key tanpa template — dipanggil hanya oleh worker drain,
 * yang menandai null sebagai kegagalan permanen (attempts cap).
 */
export function renderNotificationEmail(templateKey: string, payload: Payload | null): RenderedEmail | null {
  const p: Payload = payload ?? {};
  switch (templateKey) {
    case "topup_settled":
      return render(
        `Top-up berhasil — +${str(p, "amount")} C-Coin`,
        [
          `Saldo C-Coin kamu bertambah ${str(p, "amount")} dan sekarang berjumlah ${str(p, "balance")}.`,
          `Nomor referensi: ${str(p, "refId")}`,
        ],
        "Cek dompet kamu",
        "/wallet",
      );
    case "payout_disbursed":
      return render(
        `Payout ${str(p, "amount")} C-Gems sudah ditransfer`,
        [
          `Permintaan payout ${str(p, "payoutId")} sebesar ${str(p, "amount")} C-Gems sudah ditransfer secara manual oleh tim kami.`,
          "Dana dalam bentuk Rupiah dikirim ke rekening terdaftar kamu.",
        ],
        "Lihat riwayat payout",
        "/wallet",
      );
    case "payout_failed":
      return render(
        `Payout ${str(p, "amount")} C-Gems gagal diproses`,
        [
          `Permintaan payout ${str(p, "payoutId")} sebesar ${str(p, "amount")} C-Gems tidak dapat diproses.`,
          "Dana sudah dikembalikan penuh ke saldo C-Gems kamu dan bisa diajukan ulang kapan saja.",
        ],
        "Cek dompet kamu",
        "/wallet",
      );
    case "bid_accepted":
      return render(
        `Bid kamu diterima — ${str(p, "amount")} C-Coin`,
        [
          `Penjual menerima tawaran ${str(p, "amount")} C-Coin untuk C.Card yang kamu bid.`,
          "Pembayaran langsung diproses dan C.Card masuk ke vault kamu.",
        ],
        "Lihat C.Card kamu",
        "/cards",
      );
    case "card_bought":
      return render(
        `C.Card kamu terjual — +${str(p, "amount")} C-Coin`,
        [
          `${str(p, "dropTitle") || "C.Card"} kamu terjual seharga ${str(p, "amount")} C-Coin di pasar sekunder.`,
          "Hasil penjualan sudah masuk ke saldo C-Gems kamu.",
        ],
        "Cek dompet kamu",
        "/wallet",
      );
    case "shipment_shipped":
      return render(
        "C.Card kamu sudah dikirim",
        [`${str(p, "dropTitle") || "C.Card"} kamu dalam perjalanan ke alamat tujuan.`, `Nomor resi: ${str(p, "trackingNumber")}`],
        "Lihat status pengiriman",
        "/shipments",
      );
    case "shipment_delivered":
      return render(
        "C.Card kamu sudah tiba",
        [`${str(p, "dropTitle") || "C.Card"} kamu sudah diterima di alamat tujuan. Selamat menikmati koleksinya!`],
        "Lihat C.Card kamu",
        "/cards",
      );
    case "kyc_approved":
      return render(
        "Verifikasi identitas kamu disetujui",
        [
          "Verifikasi identitas (KYC) kamu disetujui.",
          "Batas penarikan payout sekarang terbuka dan batas top-up saldo tidak berlaku lagi untuk akun kamu.",
        ],
        "Buka dompet kamu",
        "/wallet",
      );
    case "kyc_rejected":
      return render(
        "Verifikasi identitas kamu ditolak",
        [
          "Verifikasi identitas (KYC) kamu belum dapat disetujui.",
          "Silakan ajukan ulang dengan dokumen yang lebih jelas dan data yang sesuai.",
        ],
        "Ajukan ulang",
        "/profile",
      );
    case "drop_won":
      return render(
        `Selamat! Kamu memenangkan ${str(p, "dropTitle") || "drop"}`,
        [
          `Kamu terpilih pada raffle ${str(p, "dropTitle") || "drop"} dan mendapatkan C.Card ${str(p, "variant") === "signed" ? "versi Signed" : "versi Regular"}.`,
          "C.Card sudah masuk ke vault kamu — kamu bisa minta kirim kapan saja dari halaman kartu.",
        ],
        "Lihat C.Card kamu",
        "/cards",
      );
    default:
      return null;
  }
}

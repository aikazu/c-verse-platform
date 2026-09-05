import { PRIMARY_DOMAIN, type PublicShowcase } from "@c-verse/shared";

async function loadArtwork(src: string): Promise<HTMLImageElement | null> {
  if (!src) return null;
  const image = new Image();
  image.crossOrigin = "anonymous";
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error("Artwork belum dapat dimuat. Coba lagi.")), 15000);
    image.onload = () => {
      clearTimeout(timer);
      resolve(image);
    };
    image.onerror = () => {
      clearTimeout(timer);
      reject(new Error("Artwork belum dapat dimuat untuk gambar berbagi. Coba lagi."));
    };
    image.src = src;
  });
}

/** Local PNG export; no permanent public object can outlive the privacy setting. */
export async function createShowcaseImage(showcase: PublicShowcase): Promise<File> {
  const artwork = await Promise.all(showcase.cards.map((card) => loadArtwork(card.artworkUrl)));
  const canvas = document.createElement("canvas");
  canvas.width = 1200;
  canvas.height = 1200;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Browser belum mendukung ekspor gambar");
  ctx.fillStyle = "#10121b";
  ctx.fillRect(0, 0, 1200, 1200);
  ctx.fillStyle = "#e6c879";
  ctx.font = "24px sans-serif";
  ctx.fillText("C.VERSE / ETALASE KOLEKSI", 64, 85);
  ctx.fillStyle = "#f4f1e9";
  ctx.font = "bold 54px sans-serif";
  ctx.fillText(showcase.title, 64, 176, 1072);
  ctx.font = "26px sans-serif";
  ctx.fillText(`Pilihan @${showcase.username}`, 64, 230, 1072);
  const width = 328;
  const gap = 28;
  const start = (1200 - showcase.cards.length * width - (showcase.cards.length - 1) * gap) / 2;
  showcase.cards.forEach((card, index) => {
    const x = start + index * (width + gap);
    ctx.fillStyle = "#242937";
    ctx.fillRect(x, 300, width, 500);
    const image = artwork[index];
    if (image) {
      const scale = Math.min(width / image.naturalWidth, 500 / image.naturalHeight);
      const w = image.naturalWidth * scale;
      const h = image.naturalHeight * scale;
      ctx.drawImage(image, x + (width - w) / 2, 300 + (500 - h) / 2, w, h);
    }
    ctx.fillStyle = "#f4f1e9";
    ctx.font = "bold 24px sans-serif";
    ctx.fillText(card.title, x, 851, width);
    ctx.fillStyle = "#e6c879";
    ctx.font = "22px sans-serif";
    ctx.fillText(`#${card.unitNumber} · ${card.variant === "signed" ? "Signed" : "Reguler"}`, x, 890, width);
  });
  ctx.fillStyle = "#e6c879";
  ctx.fillRect(64, 1000, 1072, 2);
  ctx.font = "28px sans-serif";
  ctx.fillText(`${PRIMARY_DOMAIN}/u/${showcase.username}`, 64, 1070, 1072);
  ctx.fillStyle = "#abb2c5";
  ctx.font = "20px sans-serif";
  ctx.fillText("Koleksi dapat berubah. Lihat etalase terbaru melalui tautan profil.", 64, 1120, 1072);
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((value) => (value ? resolve(value) : reject(new Error("Ekspor gambar gagal"))), "image/png"),
  );
  return new File([blob], `etalase-${showcase.username}.png`, { type: "image/png" });
}

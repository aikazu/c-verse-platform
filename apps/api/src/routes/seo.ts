import { Hono } from "hono";
import { store, ensureSeed } from "../lib/store.js";
import { PRIMARY_DOMAIN } from "@c-verse/shared";

const app = new Hono();
app.use("*", async (c, next) => { ensureSeed(); await next(); });

// GET /sitemap.xml — dynamic sitemap for SEO (docs 02 s.8: SPA + Worker HTMLRewriter + sitemap generator)
app.get("/sitemap.xml", async (c) => {
  const base = `https://${PRIMARY_DOMAIN}`;
  const drops = [...store.drops.values()].filter((d) => ["published", "live", "sold_out", "scheduled"].includes(d.status));
  const creators = [...store.users.values()].filter((u) => (u.role as string) === "creator");
  const cards = [...store.cards.values()].slice(0, 100); // cap for Y1
  const now = new Date().toISOString();
  const urls: string[] = [
    `<url><loc>${base}/</loc><lastmod>${now}</lastmod></url>`,
    `<url><loc>${base}/drops</loc><lastmod>${now}</lastmod></url>`,
    `<url><loc>${base}/marketplace</loc><lastmod>${now}</lastmod></url>`,
    `<url><loc>${base}/browse</loc><lastmod>${now}</lastmod></url>`,
    `<url><loc>${base}/leaderboard</loc><lastmod>${now}</lastmod></url>`,
  ];
  for (const d of drops) urls.push(`<url><loc>${base}/drops/${d.id}</loc><lastmod>${d.createdAt}</lastmod></url>`);
  for (const u of creators) {
    const handle = (u as unknown as { username?: string }).username ?? u.id;
    const rec = [...store.creators.values()].find((cr) => cr.userId === u.id);
    const slug = rec?.handle ?? handle;
    urls.push(`<url><loc>${base}/c/${slug}</loc><lastmod>${u.createdAt}</lastmod></url>`);
  }
  for (const ca of cards) urls.push(`<url><loc>${base}/cards/${ca.id}/3d</loc><lastmod>${ca.createdAt ?? now}</lastmod></url>`);
  const xml = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join("")}</urlset>`;
  return new Response(xml, { headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
});

// GET /meta?path=/c/:handle | /cards/:id/3d | /drops/:id  — OG + JSON-LD for edge Worker HTMLRewriter to inject
app.get("/meta", async (c) => {
  const path = c.req.query("path") ?? "/";
  if (path.startsWith("/c/")) {
    const slug = path.slice(3).split("?")[0].split("/")[0];
    const rec = [...store.creators.values()].find((cr) => cr.handle.toLowerCase() === slug.toLowerCase());
    const user = rec ? store.users.get(rec.userId!) : [...store.users.values()].find((u) => ((u as unknown as { username?: string }).username ?? "").toLowerCase() === slug.toLowerCase());
    if (!user) return c.json({ error: "Not found" }, 404);
    const rec2 = [...store.creators.values()].find((cr) => cr.userId === user.id);
    return c.json({
      og: { title: `${user.displayName} — C.Verse`, description: `Koleksi kreator ${user.displayName} di C.Verse`, image: null },
      jsonLd: { "@context": "https://schema.org", "@type": "Person", name: user.displayName, url: `https://${PRIMARY_DOMAIN}/c/${rec2?.handle ?? slug}`, sameAs: [] },
    });
  }
  if (path.startsWith("/cards/")) {
    const id = path.split("/")[2];
    const card = store.cards.get(id) ?? [...store.cards.values()].find((ca) => ca.nfcShortId === id);
    if (!card) return c.json({ error: "Not found" }, 404);
    const drop = store.drops.get(card.dropId);
    return c.json({
      og: { title: `${drop?.title ?? "Kartu"} #${card.unitNumber} — C.Verse`, description: drop?.narrative?.slice(0, 160) ?? "Kartu koleksi C.Verse", image: drop?.artworkUrl ?? null },
      jsonLd: { "@context": "https://schema.org", "@type": "Product", name: `${drop?.title ?? "Kartu"} #${card.unitNumber}`, image: drop?.artworkUrl, brand: drop?.creatorName, sku: card.nfcShortId },
    });
  }
  if (path.startsWith("/drops/")) {
    const id = path.split("/")[2];
    const drop = store.drops.get(id);
    if (!drop) return c.json({ error: "Not found" }, 404);
    return c.json({
      og: { title: `${drop.title} — Drop C.Verse`, description: drop.narrative?.slice(0, 160) ?? "", image: drop.artworkUrl },
      jsonLd: { "@context": "https://schema.org", "@type": "Event", name: drop.title, image: drop.artworkUrl, startDate: (drop as unknown as { dropStartAt?: string }).dropStartAt ?? (drop as unknown as { dropAt?: string }).dropAt ?? undefined },
    });
  }
  return c.json({ og: { title: "C.Verse — Koleksi Kreator Edisi Terbatas", description: "Platform kartu kolaborasi kreator Indonesia — collectible fisik + provenance NFC.", image: null }, jsonLd: null });
});

export default app;

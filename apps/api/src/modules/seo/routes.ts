import { PRIMARY_DOMAIN } from "@c-verse/shared";
import { Hono } from "hono";
import { getCreatorByHandle, getCreatorByUserId, listCreators, listCreatorUsers } from "../../lib/reads/creators.js";
import { getCardByIdOrNfc, getDropById, listCards, listDrops } from "../../lib/reads/drops.js";
import { getUserById, getUserByUsername } from "../../lib/reads/users.js";
import type { CreatorRec } from "../../lib/store.js";

const app = new Hono();

// Status drop yang dianggap publik untuk permukaan SEO (sitemap + OG meta) —
// daftar yang sama dengan filter sitemap drops. draft/cancelled/closed tidak
// publik: URL kartu/drop-nya tidak boleh bocor lewat sitemap maupun meta.
const SEO_PUBLIC_DROP_STATUSES: string[] = ["published", "live", "sold_out", "scheduled"];

const LEGAL_PAGE_META: Record<string, { title: string; description: string }> = {
  "/legal": {
    title: "Pusat Legal — C.Verse",
    description: "Pusat Syarat & Ketentuan, privasi, KYC, pengiriman, Vault, dan ketentuan kreator C.Verse.",
  },
  "/legal/terms": {
    title: "Syarat & Ketentuan — C.Verse",
    description: "Aturan penggunaan C.Verse, C.Card, C-Coin, C-Gems, Vault, Primary Sale, dan secondary market.",
  },
  "/legal/privacy": {
    title: "Kebijakan Privasi — C.Verse",
    description: "Cara C.Verse mengumpulkan, menggunakan, membagikan, menyimpan, dan melindungi data pribadi.",
  },
  "/legal/shipping": {
    title: "Kebijakan Pengiriman & Vault — C.Verse",
    description: "Aturan settlement C.Card ke Vault, ship-out, biaya, pembatalan, kehilangan, dan kerusakan.",
  },
  "/legal/kyc": {
    title: "Kebijakan KYC — C.Verse",
    description: "Ketentuan verifikasi identitas untuk payout C-Gems, cap saldo, dan pengendalian risiko.",
  },
  "/legal/creator-terms": {
    title: "Ketentuan Kreator — C.Verse",
    description: "Hak, lisensi, revenue share, royalti, payout, dan kewajiban kreator C.Verse.",
  },
};

// GET /sitemap.xml — dynamic sitemap for SEO (docs 02 s.8: SPA + Worker HTMLRewriter + sitemap generator)
app.get("/sitemap.xml", async (_c) => {
  const base = `https://${PRIMARY_DOMAIN}`;
  const drops = (await listDrops()).filter((d) => SEO_PUBLIC_DROP_STATUSES.includes(d.status));
  const creators = await listCreatorUsers();
  const recByUserId = new Map<string, CreatorRec>(
    (await listCreators()).filter((cr) => cr.userId != null).map((cr) => [cr.userId as string, cr]),
  );
  // Audit batch 2 F3: hanya kartu milik drop publik yang boleh masuk sitemap —
  // tanpa filter ini URL kartu drop draft/cancelled ikut ter-list.
  const publicDropIds = new Set(drops.map((d) => d.id));
  const cards = (await listCards()).filter((ca) => publicDropIds.has(ca.dropId)).slice(0, 100); // cap for Y1
  const now = new Date().toISOString();
  const urls: string[] = [
    `<url><loc>${base}/</loc><lastmod>${now}</lastmod></url>`,
    `<url><loc>${base}/drops</loc><lastmod>${now}</lastmod></url>`,
    `<url><loc>${base}/marketplace</loc><lastmod>${now}</lastmod></url>`,
    `<url><loc>${base}/browse</loc><lastmod>${now}</lastmod></url>`,
    `<url><loc>${base}/leaderboard</loc><lastmod>${now}</lastmod></url>`,
    ...Object.keys(LEGAL_PAGE_META).map((path) => `<url><loc>${base}${path}</loc><lastmod>${now}</lastmod></url>`),
  ];
  for (const d of drops) urls.push(`<url><loc>${base}/drops/${d.id}</loc><lastmod>${d.createdAt}</lastmod></url>`);
  for (const u of creators) {
    const handle = u.username ?? u.id;
    const rec = recByUserId.get(u.id);
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
  const normalizedPath = path.split("?")[0].replace(/\/+$/, "") || "/";
  if (normalizedPath.startsWith("/u/")) {
    c.header("Cache-Control", "no-store");
    const showcase = await getPublicShowcase(normalizedPath.split("/")[2]);
    if (!showcase?.cards.length) return c.json({ error: "Not found" }, 404);
    return c.json({
      og: {
        title: `${showcase.title} — C.Verse`,
        description: `Etalase ${showcase.displayName} · ${showcase.cards.length} C.Card`,
        image: showcase.cards[0].artworkUrl || null,
      },
      jsonLd: null,
    });
  }
  const legalMeta = LEGAL_PAGE_META[normalizedPath];
  if (legalMeta) {
    return c.json({
      og: { title: legalMeta.title, description: legalMeta.description, image: null },
      jsonLd: {
        "@context": "https://schema.org",
        "@type": "WebPage",
        name: legalMeta.title,
        description: legalMeta.description,
        url: `https://${PRIMARY_DOMAIN}${normalizedPath}`,
      },
    });
  }
  if (path.startsWith("/c/")) {
    const slug = path.slice(3).split("?")[0].split("/")[0];
    const rec = await getCreatorByHandle(slug);
    // mirror store behavior: username fallback only when no creator record matches the handle
    const user = rec ? (rec.userId ? await getUserById(rec.userId) : null) : await getUserByUsername(slug);
    if (!user) return c.json({ error: "Not found" }, 404);
    // Audit batch 2 F5: halaman publik menyembunyikan kreator suspended +
    // anonymous (paritas listCreatorUsers: is_anonymous=false, flag_reason null) —
    // meta OG/JSON-LD ikut 404 agar displayName tidak bocor lewat prerender.
    if (user.flagReason || user.isAnonymous) return c.json({ error: "Not found" }, 404);
    const rec2 = await getCreatorByUserId(user.id);
    return c.json({
      og: { title: `${user.displayName} — C.Verse`, description: `Koleksi kreator ${user.displayName} di C.Verse`, image: null },
      jsonLd: {
        "@context": "https://schema.org",
        "@type": "Person",
        name: user.displayName,
        url: `https://${PRIMARY_DOMAIN}/c/${rec2?.handle ?? slug}`,
        sameAs: [],
      },
    });
  }
  if (path.startsWith("/cards/")) {
    const id = path.split("/")[2];
    const card = await getCardByIdOrNfc(id);
    if (!card) return c.json({ error: "Not found" }, 404);
    const drop = await getDropById(card.dropId);
    // Audit batch 2 F4: kartu dari drop non-publik (atau tanpa parent drop)
    // tidak mendapat OG meta — narrative/artwork drop draft/cancelled tidak
    // boleh ter-prerender. Bentuk 404 sama dengan path tak dikenal.
    if (!drop || !SEO_PUBLIC_DROP_STATUSES.includes(drop.status)) return c.json({ error: "Not found" }, 404);
    return c.json({
      og: {
        title: `${drop?.title ?? "Kartu"} #${card.unitNumber} — C.Verse`,
        description: drop?.narrative?.slice(0, 160) ?? "Kartu koleksi C.Verse",
        image: drop?.artworkUrl ?? null,
      },
      jsonLd: {
        "@context": "https://schema.org",
        "@type": "Product",
        name: `${drop?.title ?? "Kartu"} #${card.unitNumber}`,
        image: drop?.artworkUrl,
        brand: drop?.creatorName,
        sku: card.nfcShortId,
      },
    });
  }
  if (path.startsWith("/drops/")) {
    const id = path.split("/")[2];
    const drop = await getDropById(id);
    if (!drop) return c.json({ error: "Not found" }, 404);
    // Paritas cabang /cards/ (F4) + sitemap: drop draft/cancelled/closed tidak
    // publik — narrative/artwork pre-announcement tidak boleh ter-prerender.
    if (!SEO_PUBLIC_DROP_STATUSES.includes(drop.status)) return c.json({ error: "Not found" }, 404);
    return c.json({
      og: { title: `${drop.title} — Drop C.Verse`, description: drop.narrative?.slice(0, 160) ?? "", image: drop.artworkUrl },
      jsonLd: {
        "@context": "https://schema.org",
        "@type": "Event",
        name: drop.title,
        image: drop.artworkUrl,
        startDate: drop.dropStartAt ?? undefined,
      },
    });
  }
  return c.json({
    og: {
      title: "C.Verse — Koleksi Kreator Edisi Terbatas",
      description: "Platform kartu kolaborasi kreator Indonesia — collectible fisik + provenance NFC.",
      image: null,
    },
    jsonLd: null,
  });
});

export default app;

import { getPublicShowcase } from "../../lib/reads/showcase.js";

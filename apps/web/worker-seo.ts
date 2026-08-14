// C.Verse — SEO Edge Worker (HTMLRewriter) — docs 02 s.8
// Runs in front of apps/web SPA on Cloudflare. Intercepts public SEO routes and injects OG + JSON-LD.
// Build 2-3d effort; runtime free tier. Update wrangler.toml routes to put this worker in front of Pages if deployed.
// For SPA preview, also served via API /api/seo/meta by the Hono worker — this file is the edge proxy layer.

interface Env { API_ORIGIN: string }

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;

    // Only SEO routes go through HTMLRewriter; others passthrough to Pages origin.
    const isSeo =
      path === "/sitemap.xml" ||
      path.startsWith("/c/") ||
      (path.startsWith("/cards/") && path.endsWith("/3d")) ||
      path.startsWith("/drops/");

    if (path === "/sitemap.xml") {
      // proxy to API sitemap generator
      const api = env.API_ORIGIN ?? "https://api.c-verse.co";
      return fetch(`${api}/sitemap.xml`, { headers: { Accept: "application/xml" } });
    }

    // Fetch SPA shell from Pages origin (default)
    const originRes = await fetch(req);
    if (!isSeo || !originRes.headers.get("content-type")?.includes("text/html")) return originRes;

    // Fetch meta from API (OG + JSON-LD) then inject via HTMLRewriter
    const api = env.API_ORIGIN ?? "https://api.c-verse.co";
    let meta: { og?: { title?: string; description?: string; image?: string | null }; jsonLd?: unknown } | null = null;
    try {
      const r = await fetch(`${api}/api/seo/meta?path=${encodeURIComponent(path)}`);
      if (r.ok) meta = (await r.json()) as never;
    } catch {}

    if (!meta?.og && !meta?.jsonLd) return originRes;

    const rewriter = new HTMLRewriter()
      .on("head", {
        element(el) {
          if (meta?.og?.title) el.append(`<meta property="og:title" content="${esc(meta.og.title)}" />`, { html: true });
          if (meta?.og?.description) el.append(`<meta property="og:description" content="${esc(meta.og.description)}" />`, { html: true });
          if (meta?.og?.image) el.append(`<meta property="og:image" content="${esc(meta.og.image)}" />`, { html: true });
          if (meta?.jsonLd) el.append(`<script type="application/ld+json">${JSON.stringify(meta.jsonLd)}</script>`, { html: true });
        },
      });
    return rewriter.transform(originRes);
  },
} satisfies ExportedHandler<Env>;

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

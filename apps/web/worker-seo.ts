/// <reference path="./worker-configuration.d.ts" />

const API_PREFIX = "/api";
const SEO_PATHS = ["/c/", "/drops/", "/u/"];

type SeoMeta = {
  og?: { title?: string; description?: string; image?: string | null };
  jsonLd?: unknown;
};

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    const isApi = url.pathname === API_PREFIX || url.pathname.startsWith(`${API_PREFIX}/`);

    if (isApi) {
      return secureResponse(await env.API.fetch(privateApiRequest(request)), true);
    }

    if (url.pathname === "/sitemap.xml") {
      const sitemapRequest = new Request(request);
      sitemapRequest.headers.set("Accept", "application/xml");
      return secureResponse(await env.API.fetch(privateApiRequest(sitemapRequest)), false);
    }

    const assetResponse = await env.ASSETS.fetch(request);
    if (!isSeoRoute(url.pathname) || !assetResponse.headers.get("content-type")?.includes("text/html")) {
      return secureResponse(assetResponse, false);
    }

    const meta = await fetchSeoMeta(env, url);
    const isCollectorProfile = url.pathname.startsWith("/u/");
    if (!meta?.og && !meta?.jsonLd) return secureResponse(assetResponse, isCollectorProfile);

    const rewritten = new HTMLRewriter()
      .on("head", {
        element(element) {
          if (meta.og?.title) {
            element.append(`<meta property="og:title" content="${escapeHtml(meta.og.title)}" />`, { html: true });
          }
          if (meta.og?.description) {
            element.append(`<meta property="og:description" content="${escapeHtml(meta.og.description)}" />`, { html: true });
          }
          if (meta.og?.image) {
            element.append(`<meta property="og:image" content="${escapeHtml(meta.og.image)}" />`, { html: true });
          }
          if (meta.jsonLd) {
            element.append(`<script type="application/ld+json">${escapeJsonLd(meta.jsonLd)}</script>`, { html: true });
          }
        },
      })
      .transform(assetResponse);

    return secureResponse(rewritten, isCollectorProfile);
  },
} satisfies ExportedHandler<Env>;

function isSeoRoute(path: string): boolean {
  return SEO_PATHS.some((prefix) => path.startsWith(prefix)) || (path.startsWith("/cards/") && path.endsWith("/3d"));
}

async function fetchSeoMeta(env: Env, url: URL): Promise<SeoMeta | null> {
  const request = new Request(`${url.origin}/api/seo/meta?path=${encodeURIComponent(url.pathname)}`, {
    headers: { Accept: "application/json" },
  });
  try {
    const response = await env.API.fetch(request);
    return response.ok ? ((await response.json()) as SeoMeta) : null;
  } catch (error) {
    console.warn("SEO metadata lookup failed", { path: url.pathname, error: String(error) });
    return null;
  }
}

function privateApiRequest(request: Request): Request {
  const headers = new Headers(request.headers);
  headers.delete("Cookie");
  headers.delete("Cf-Access-Jwt-Assertion");
  return new Request(request, { headers });
}

function secureResponse(response: Response, isApi: boolean): Response {
  const headers = new Headers(response.headers);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
  headers.set("Cross-Origin-Opener-Policy", "same-origin");
  headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
  if (isApi) headers.set("Cache-Control", "no-store");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeJsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

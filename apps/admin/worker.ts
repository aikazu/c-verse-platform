/// <reference path="./worker-configuration.d.ts" />

const API_PREFIX = "/api";

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    const isApi = url.pathname === API_PREFIX || url.pathname.startsWith(`${API_PREFIX}/`);
    const response = isApi ? await env.API.fetch(privateApiRequest(request)) : await env.ASSETS.fetch(request);

    return secureResponse(response, isApi);
  },
} satisfies ExportedHandler<Env>;

function privateApiRequest(request: Request): Request {
  const headers = new Headers(request.headers);
  headers.delete("Cookie");
  headers.delete("Cf-Access-Jwt-Assertion");
  return new Request(request, { headers });
}

function secureResponse(response: Response, isApi: boolean): Response {
  const secured = new Response(response.body, response);
  secured.headers.set("X-Content-Type-Options", "nosniff");
  secured.headers.set("X-Frame-Options", "DENY");
  secured.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  secured.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
  secured.headers.set("Cross-Origin-Opener-Policy", "same-origin");
  secured.headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
  if (isApi) secured.headers.set("Cache-Control", "no-store");
  return secured;
}

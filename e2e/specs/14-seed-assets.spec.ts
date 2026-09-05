import { expect, type Page } from "@playwright/test";
import { assetManifest, test } from "../fixtures/public-assets";

const AURORA_CARD_ID = "card-aurora-raffle-10";
const AURORA_ATLAS_URL = "https://assets.c-verse.co/mock/v1/artworks/aurora.png";
const CARD_OBJ_URL = "https://assets.c-verse.co/mock/v1/models/card.obj";

test("seed assets load from their R2 URLs and image bodies decode in the browser", async ({ page }) => {
  expect(assetManifest.assets).toHaveLength(12);
  await page.goto("/");
  const responses = await page.evaluate(
    async (urls) =>
      Promise.all(
        urls.map(async (url) => {
          const response = await fetch(url);
          return {
            url,
            ok: response.ok,
            contentType: response.headers.get("content-type"),
            size: (await response.arrayBuffer()).byteLength,
          };
        }),
      ),
    assetManifest.assets.map((asset) => asset.seedUrl),
  );
  for (const response of responses) {
    expect(response.ok, response.url).toBe(true);
    expect(response.contentType, "SPA fallback must never masquerade as an asset").not.toContain("text/html");
    expect(response.size).toBeGreaterThan(0);
  }
  const paths = assetManifest.assets.filter((asset) => asset.kind !== "model").map((asset) => asset.seedUrl);
  const images = await page.evaluate(async (urls) => {
    return Promise.all(
      urls.map(async (url) => {
        const image = new Image();
        image.src = url;
        await image.decode();
        return { url, width: image.naturalWidth, height: image.naturalHeight };
      }),
    );
  }, paths);
  for (const image of images) {
    expect(image.width, image.url).toBeGreaterThanOrEqual(512);
    expect(image.height, image.url).toBeGreaterThanOrEqual(512);
  }
});

for (const [name, cardId, artwork] of [
  ["Genesis", "card-genesis-live-01", "/mock/v1/artworks/genesis.png"],
  ["Aurora", AURORA_CARD_ID, "/mock/v1/artworks/aurora.png"],
]) {
  test(`seeded ${name} card loads its own atlas in the OBJ viewer`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const texture = page.waitForResponse((response) => new URL(response.url()).pathname === artwork);
    await page.goto(`/cards/${cardId}/3d`);
    expect((await texture).ok()).toBe(true);
    await expect(page.locator(".c3d-canvas canvas")).toBeVisible();
    await expect(page.getByText("Memuat gambar kartu…", { exact: true })).toHaveCount(0);
    await expect(page.locator(".c3d-stage")).toHaveAttribute("data-status", "ready");
    expect(errors).toEqual([]);
  });
}

async function routeAuroraViewerAssets(page: Page, useFallbackMesh = false): Promise<void> {
  await page.route(`**/api/nfc/cards/${AURORA_CARD_ID}/3d*`, async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as { drop?: Record<string, unknown> };
    await route.fulfill({
      response,
      json: {
        ...body,
        drop: { ...body.drop, artworkUrl: AURORA_ATLAS_URL, artwork3dUrl: useFallbackMesh ? null : CARD_OBJ_URL },
      },
    });
  });
}

test("Aurora viewer requests its own CDN atlas and OBJ", async ({ page }, testInfo) => {
  test.skip(process.env.TEST_PUBLIC_ASSETS !== "1", "Set TEST_PUBLIC_ASSETS=1 for live R2 delivery smoke");
  const requested: string[] = [];
  page.on("request", (request) => requested.push(request.url()));
  await routeAuroraViewerAssets(page);
  const texture = page.waitForResponse((response) => response.url() === `${AURORA_ATLAS_URL}?cverse_texture=1`);
  const mesh = page.waitForResponse((response) => response.url() === CARD_OBJ_URL);
  await page.goto(`/cards/${AURORA_CARD_ID}/3d`);
  expect((await texture).ok()).toBe(true);
  expect((await mesh).ok()).toBe(true);
  await expect(page.locator(".c3d-canvas canvas")).toBeVisible();
  await expect(page.getByText("Memuat gambar kartu…", { exact: true })).toHaveCount(0);
  await expect(page.locator(".c3d-stage")).toHaveAttribute("data-status", "ready");
  expect(requested.some((url) => url.includes("karina"))).toBe(false);
  await page.screenshot({ path: testInfo.outputPath("aurora-3d.png"), fullPage: true });
});

test("failed Aurora atlas keeps a neutral mesh and never requests Karina", async ({ page }, testInfo) => {
  const requested: string[] = [];
  page.on("request", (request) => requested.push(request.url()));
  await routeAuroraViewerAssets(page, true);
  await page.route(`${AURORA_ATLAS_URL}*`, (route) => route.abort("failed"));
  const mesh = page.waitForResponse((response) => response.url() === CARD_OBJ_URL);
  await page.goto(`/cards/${AURORA_CARD_ID}/3d`);
  expect((await mesh).ok()).toBe(true);
  await expect(page.locator(".c3d-canvas canvas")).toBeVisible();
  await expect(page.locator(".c3d-artwork-note[role='status']")).toContainText("Gambar kartu belum bisa dimuat");
  expect(requested.some((url) => url.includes("karina"))).toBe(false);
  await page.screenshot({ path: testInfo.outputPath("aurora-3d-unavailable.png"), fullPage: true });
});

test("Genesis #8 renders after its CDN image was cached by a regular image", async ({ page }, testInfo) => {
  test.skip(process.env.TEST_PUBLIC_ASSETS !== "1", "Set TEST_PUBLIC_ASSETS=1 for live R2 delivery smoke");
  const atlas = "https://assets.c-verse.co/mock/v1/artworks/genesis.png";
  // Playwright routing disables the HTTP cache. Override only the API payload
  // in-page so this reproduces normal image -> WebGL texture cache reuse.
  await page.addInitScript(
    ({ atlas, mesh }) => {
      const originalFetch = window.fetch;
      window.fetch = async (...args) => {
        const response = await originalFetch(...args);
        if (!response.url.includes("/api/nfc/cards/card-genesis-live-08/3d")) return response;
        const body = await response.json();
        return new Response(JSON.stringify({ ...body, drop: { ...body.drop, artworkUrl: atlas, artwork3dUrl: mesh } }), {
          status: response.status,
          headers: response.headers,
        });
      };
    },
    { atlas, mesh: CARD_OBJ_URL },
  );
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto("/");
  await page.evaluate(async (url) => {
    const image = new Image();
    image.src = url;
    await image.decode();
  }, atlas);
  await page.goto("/cards/card-genesis-live-08/3d");
  await expect(page.locator(".c3d-canvas canvas")).toBeVisible();
  await expect(page.getByText("Memuat gambar kartu…", { exact: true })).toHaveCount(0);
  await expect(page.locator(".c3d-stage"), errors.join("\n")).toHaveAttribute("data-status", "ready");
  expect(errors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("genesis-08-3d-cached.png"), fullPage: true });
});

test("R2 varies asset response headers by Origin including requests without Origin", async ({ request }) => {
  test.skip(process.env.TEST_PUBLIC_ASSETS !== "1", "Set TEST_PUBLIC_ASSETS=1 for live R2 delivery smoke");
  for (const origin of [null, "https://dev.c-verse.co", "https://untrusted.example"]) {
    const response = await request.head(AURORA_ATLAS_URL, { headers: origin ? { Origin: origin } : {} });
    expect(response.ok()).toBe(true);
    expect(response.headers().vary?.toLowerCase().split(/,\s*/)).toContain("origin");
    expect(response.headers()["access-control-allow-origin"]).toBe(origin === "https://dev.c-verse.co" ? origin : undefined);
  }
});

test("Karina viewer loads the R2 artwork without a bundled texture", async ({ page }, testInfo) => {
  test.skip(process.env.TEST_PUBLIC_ASSETS !== "1", "Set TEST_PUBLIC_ASSETS=1 for live R2 delivery smoke");
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  const atlas = page.waitForResponse(
    (response) => response.url() === "https://assets.c-verse.co/mock/v1/artworks/karina.jpg?cverse_texture=1",
  );
  await page.goto("/cards/card-aespa-live-08/3d");
  expect((await atlas).ok()).toBe(true);
  await expect(page.locator(".c3d-canvas canvas")).toBeVisible();
  await expect(page.getByText("Memuat gambar kartu…", { exact: true })).toHaveCount(0);
  await expect(page.locator(".c3d-stage")).toHaveAttribute("data-status", "ready");
  expect(requests.some((url) => new URL(url).pathname === "/textures/karina.jpg")).toBe(false);
  await page.screenshot({ path: testInfo.outputPath("karina-r2-3d.png"), fullPage: true });
});

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

const manifest = JSON.parse(readFileSync(resolve("supabase/seed-assets.json"), "utf8")) as {
  assets: Array<{ kind: string; publicPath: string }>;
};

test("mock asset files are served and image bodies decode in the browser", async ({ page, request }) => {
  for (const asset of manifest.assets) {
    const response = await request.get(asset.publicPath);
    expect(response.ok(), asset.publicPath).toBe(true);
    expect(response.headers()["content-type"], "SPA fallback must never masquerade as an asset").not.toContain("text/html");
  }
  await page.goto("/");
  const paths = manifest.assets.filter((asset) => asset.kind !== "model").map((asset) => asset.publicPath);
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

test("seeded Genesis card loads its own atlas in the OBJ viewer", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const texture = page.waitForResponse((response) => new URL(response.url()).pathname === "/mock/v1/artworks/genesis.png");
  await page.goto("/cards/card-genesis-live-01/3d");
  expect((await texture).ok()).toBe(true);
  await expect(page.locator(".ci-viewer-host canvas")).toBeVisible();
  expect(errors).toEqual([]);
});

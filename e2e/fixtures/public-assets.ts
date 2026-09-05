import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test as base } from "@playwright/test";

export const assetManifest = JSON.parse(readFileSync(resolve("supabase/seed-assets.json"), "utf8")) as {
  assets: Array<{ kind: string; sourcePath: string; seedUrl: string; contentType: string }>;
};

// Exercise the real CDN URLs with deterministic local bytes unless live delivery is requested.
export const test = base.extend({
  page: async ({ page }, use) => {
    if (process.env.TEST_PUBLIC_ASSETS !== "1") {
      for (const asset of assetManifest.assets) {
        await page.route(
          (url) => `${url.origin}${url.pathname}` === asset.seedUrl,
          (route) =>
            route.fulfill({
              path: resolve(asset.sourcePath),
              contentType: asset.contentType,
              headers: { "access-control-allow-origin": "*" },
            }),
        );
      }
    }
    await use(page);
  },
});

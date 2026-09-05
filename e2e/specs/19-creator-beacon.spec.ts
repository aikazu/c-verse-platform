import { expect, test } from "@playwright/test";

// Browser regression with mocked HTTP; no database fixtures or writes.
for (const path of ["creator-handle", "00000000-0000-4000-8000-000000000123"]) {
  test(`creator URL ${path} records one view for the resolved username`, async ({ page }) => {
    const views: string[] = [];
    await page.route("**/api/public/*/view", async (route) => {
      views.push(new URL(route.request().url()).pathname);
      await route.fulfill({ status: 204 });
    });
    await page.route(`**/api/creators/${path}`, (route) =>
      route.fulfill({
        json: {
          creator: { id: "creator-id", displayName: "Test Creator", username: "canonical-username", handle: "creator-handle", xp: 0 },
          drops: [],
        },
      }),
    );
    await page.route("**/api/gamification/leaderboard?*", (route) => route.fulfill({ json: { leaderboard: [] } }));

    await page.goto(`/c/${path}`);
    await expect(page.getByRole("heading", { level: 1, name: "Test Creator" })).toBeVisible();
    await expect.poll(() => views, { timeout: 3000 }).toEqual(["/api/public/canonical-username/view"]);
  });
}

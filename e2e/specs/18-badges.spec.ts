import { expect, test } from "@playwright/test";
import { loginAs } from "../helpers";

type CatalogBadge = { id: string; name: string; criteria?: { type: string; min: number; family: string } };
type BadgeProgressPayload = { progress: Record<string, number>; badges: Array<{ badgeId: string }> };

test.describe("badge gallery", () => {
  test("profile badge opens its earned detail without leaving the profile", async ({ page }, testInfo) => {
    await page.goto("/u/badge-nova");
    const badge = page.locator(".pp-badge").filter({ hasText: "Collection Nova" });
    await badge.click();
    await expect(page).toHaveURL(/\/u\/badge-nova$/);
    const dialog = page.getByRole("dialog", { name: "Collection Nova" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("+80 XP");
    await expect(dialog.getByText("Didapat", { exact: true })).toBeVisible();
    await expect(dialog.getByText("Kemajuan", { exact: true })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(badge).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(dialog).toBeVisible();
    await page.getByRole("button", { name: "Tutup detail lencana" }).click();
    await expect(badge).toBeFocused();

    await page.setViewportSize({ width: 390, height: 844 });
    await badge.click();
    await expect(dialog).toBeVisible();
    await expect(page).toHaveURL(/\/u\/badge-nova$/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("profile-badge-detail.png") });
  });

  test("keeps an open detail visible when private progress arrives", async ({ page }) => {
    await loginAs(page, "demo@cverse.id");
    let releaseProgress: (() => void) | undefined;
    const progressGate = new Promise<void>((resolve) => {
      releaseProgress = resolve;
    });
    await page.route("**/api/gamification/badges/me/progress", async (route) => {
      const response = await route.fetch();
      await progressGate;
      await route.fulfill({ response });
    });
    try {
      await page.goto("/badges");
      await page.getByRole("button", { name: "Lihat detail First Light", exact: true }).click();
      await expect(page.getByRole("dialog", { name: "First Light" })).toBeVisible();
      releaseProgress?.();
      await expect(page.getByText("Kemajuan akun pribadi aktif", { exact: true })).toBeAttached();
      await expect(page.getByRole("dialog", { name: "First Light" })).toBeVisible();
    } finally {
      releaseProgress?.();
    }
  });

  test("public catalogue supports family search, keyboard detail, tier art, and mobile layout", async ({ page }, testInfo) => {
    await page.goto("/badges");
    await expect(page.getByRole("heading", { level: 1, name: "Kabinet Prestasi" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "Galeri lencana" })).toBeVisible();

    const tierImages = page.locator(".badges-tier-samples img");
    await expect(tierImages).toHaveCount(5);
    await expect
      .poll(async () => tierImages.evaluateAll((images) => images.every((image) => image.complete && image.naturalWidth > 0)))
      .toBe(true);
    await page.screenshot({ path: testInfo.outputPath("badges-desktop.png") });

    const familySelect = page.getByLabel("Keluarga");
    await familySelect.selectOption("collector");
    await expect(page.locator(".badges-card")).toHaveCount(5);

    const firstTitle = await page.locator(".badges-card h3").first().innerText();
    await page.getByLabel("Cari lencana").fill(firstTitle);
    await expect(page.locator(".badges-card")).toHaveCount(1);

    const detail = page.getByRole("button", { name: `Lihat detail ${firstTitle}` });
    await detail.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog", { name: firstTitle })).toBeVisible();
    const dialog = page.getByRole("dialog", { name: firstTitle });
    const bounds = await dialog.boundingBox();
    if (!bounds) throw new Error("Expected a visible badge dialog");
    expect(bounds.x).toBeGreaterThan(20);
    expect(bounds.y).toBeGreaterThan(20);
    await dialog.click({ position: { x: 10, y: 10 } });
    await expect(dialog).toBeVisible();
    await page.getByRole("button", { name: "Tutup detail lencana" }).focus();
    for (let tab = 0; tab < 8; tab += 1) await page.keyboard.press("Tab");
    expect(await page.evaluate(() => document.querySelector("dialog")?.contains(document.activeElement) ?? false)).toBe(true);
    await page.keyboard.press("Shift+Tab");
    expect(await page.evaluate(() => document.querySelector("dialog")?.contains(document.activeElement) ?? false)).toBe(true);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(detail).toBeFocused();

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/badges");
    await expect(page.getByRole("heading", { level: 1, name: "Kabinet Prestasi" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("badges-mobile.png") });
  });

  test("signed collector reads private badge progress without claiming an unearned badge", async ({ page }) => {
    await loginAs(page, "demo@cverse.id");
    await page.goto("/badges");
    await expect(page.getByText("Kemajuan akun pribadi aktif", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Terkoleksi" })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Belum" })).toBeEnabled();
    await expect(page.getByText("Status akun belum diketahui", { exact: true })).toHaveCount(0);

    const payload = await page.evaluate(async () => {
      const authEntry = Object.entries(localStorage).find(([key]) => key.startsWith("sb-") && key.endsWith("-auth-token"));
      if (!authEntry) throw new Error("Supabase session tidak ditemukan untuk memeriksa progress lencana");
      const session = JSON.parse(authEntry[1]) as { access_token?: string };
      if (!session.access_token) throw new Error("Access token tidak tersedia");
      const headers = { Authorization: `Bearer ${session.access_token}` };
      const [catalogResponse, progressResponse] = await Promise.all([
        fetch("/api/gamification/badges"),
        fetch("/api/gamification/badges/me/progress", { headers }),
      ]);
      if (!catalogResponse.ok || !progressResponse.ok) throw new Error("Endpoint badge lokal tidak merespons sukses");
      return {
        catalog: (await catalogResponse.json()) as { badges: CatalogBadge[] },
        progress: (await progressResponse.json()) as BadgeProgressPayload,
      };
    });

    const target = payload.catalog.badges.find(
      (badge) =>
        badge.criteria?.family === "collector" &&
        !payload.progress.badges.some((award) => award.badgeId === badge.id) &&
        typeof payload.progress.progress[badge.criteria.type] === "number",
    );
    expect(target).toBeTruthy();
    if (!target?.criteria) return;

    await page.getByLabel("Keluarga").selectOption("collector");
    await page.getByLabel("Cari lencana").fill(target.name);
    const detail = page.getByRole("button", { name: `Lihat detail ${target.name}` });
    await detail.click();
    const metricProgress = payload.progress.progress[target.criteria.type];
    if (metricProgress === undefined) throw new Error("Expected server progress for the selected badge metric");
    await expect(page.getByRole("dialog", { name: target.name })).toContainText(
      `${metricProgress.toLocaleString("id-ID")} / ${target.criteria.min.toLocaleString("id-ID")}`,
    );
    await page.keyboard.press("Escape");
    await expect(detail).toBeFocused();
  });
});

import { expect } from "@playwright/test";
import { test } from "../fixtures/public-assets";

const CARD_PATH = "/cards/card-genesis-live-08/3d";

test("arcade controls inspect both faces without recreating the canvas", async ({ page }, testInfo) => {
  await page.goto(CARD_PATH);
  await expect(page.getByRole("button", { name: "Sisi belakang", exact: true })).toBeVisible();
  await expect(page.locator(".c3d-stage")).toHaveAttribute("data-status", "ready");
  const canvas = await page.locator(".c3d-canvas canvas").elementHandle();
  await page.getByRole("button", { name: "Sisi depan", exact: true }).click();
  const front = await page.locator(".c3d-canvas").screenshot();
  await page.getByRole("button", { name: "Sisi belakang", exact: true }).click();
  await expect(page.getByRole("button", { name: "Sisi belakang", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Putar otomatis", exact: true })).toBeVisible();
  const back = await page.locator(".c3d-canvas").screenshot();
  expect(front.equals(back), "front and back must render different artwork").toBe(false);
  await page.getByRole("slider", { name: "Zoom kartu" }).focus();
  await page.keyboard.press("End");
  await expect(page.getByRole("slider", { name: "Zoom kartu" })).toHaveValue("1.4");
  await page.getByRole("button", { name: "Reset tampilan" }).click();
  await expect(page.getByRole("slider", { name: "Zoom kartu" })).toHaveValue("1");
  expect(await canvas?.evaluate((node) => node.isConnected && node === document.querySelector(".c3d-canvas canvas"))).toBe(true);
  await page.getByRole("button", { name: "Sisi depan", exact: true }).click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath("space-arcade-desktop.png"), fullPage: true });
});

test("reduced motion starts paused and supports keyboard inspection", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(CARD_PATH);
  await expect(page.locator(".c3d-stage")).toHaveAttribute("data-status", "ready");
  await expect(page.getByRole("button", { name: "Putar otomatis", exact: true })).toBeVisible();
  const canvas = page.locator(".c3d-canvas");
  await canvas.focus();
  await page.keyboard.press("ArrowRight");
  await expect(canvas.locator("canvas")).toHaveAttribute("data-view", "free");
  await page.keyboard.press("+");
  await expect(page.getByRole("slider", { name: "Zoom kartu" })).toHaveValue("1.1");
  await page.keyboard.press("Home");
  await expect(page.getByRole("button", { name: "Sisi depan", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("slider", { name: "Zoom kartu" })).toHaveValue("1");
});

test("pointer drag inspects the card while preserving vertical touch scrolling", async ({ page }) => {
  await page.goto(CARD_PATH);
  await expect(page.locator(".c3d-stage")).toHaveAttribute("data-status", "ready");
  const canvas = page.locator(".c3d-canvas canvas");
  await expect(canvas).toHaveCSS("touch-action", "pan-y");
  await canvas.scrollIntoViewIfNeeded();
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error("Expected viewer bounds");
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width / 2 + 60, bounds.y + bounds.height / 2 - 30, { steps: 5 });
  await page.mouse.up();
  await expect(canvas).toHaveAttribute("data-view", "free");
  await expect(page.getByRole("button", { name: "Putar otomatis", exact: true })).toBeVisible();
});

test("context loss during artwork loading cannot be overwritten by a late response", async ({ page }) => {
  let resume: (() => void) | undefined;
  const pending = new Promise<void>((resolve) => {
    resume = resolve;
  });
  await page.route("**/mock/v1/artworks/genesis.png*", async (route) => {
    await pending;
    await route.fallback();
  });
  await page.goto(CARD_PATH);
  await expect(page.locator(".c3d-canvas canvas")).toBeVisible();
  await expect(page.locator(".c3d-stage")).toHaveAttribute("data-status", "loading");
  await page.locator(".c3d-canvas canvas").dispatchEvent("webglcontextlost");
  await expect(page.locator(".c3d-stage")).toHaveAttribute("data-status", "error");
  const texture = page.waitForResponse("**/mock/v1/artworks/genesis.png*");
  resume?.();
  await texture;
  await expect(page.getByRole("alert")).toContainText("Tampilan 3D tidak tersedia");
  await expect(page.getByRole("button", { name: "Sisi depan", exact: true })).toBeDisabled();
});

test("stalled artwork falls back to a usable neutral card and ignores a late image", async ({ page }) => {
  await page.clock.install();
  let resume: (() => void) | undefined;
  const pending = new Promise<void>((resolve) => {
    resume = resolve;
  });
  const atlas = "**/mock/v1/artworks/genesis.png*";
  await page.route(atlas, async (route) => {
    await pending;
    await route.fallback();
  });
  const requested = page.waitForRequest(atlas);
  try {
    await page.goto(CARD_PATH);
    await requested;
    await expect(page.locator(".c3d-stage")).toHaveAttribute("data-status", "loading");
    await page.clock.fastForward(16000);
    await expect(page.locator(".c3d-stage")).toHaveAttribute("data-status", "unavailable");
    await expect(page.locator(".c3d-artwork-note")).toContainText("tampilan 3D ditampilkan tanpa gambar");
    const canvas = page.locator(".c3d-canvas canvas");
    await expect(canvas).toHaveAttribute("data-rendered", "true");
    await page.getByRole("button", { name: "Sisi belakang", exact: true }).click();
    await expect(canvas).toHaveAttribute("data-view", "back");
    const response = page.waitForResponse(atlas);
    resume?.();
    await (await response).finished();
    await page.clock.runFor(50);
    await expect(page.locator(".c3d-stage")).toHaveAttribute("data-status", "unavailable");
    await expect(canvas).toHaveAttribute("data-view", "back");
  } finally {
    resume?.();
  }
});

test("mobile layout and focus mode resize the existing canvas without overflow", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(CARD_PATH);
  await expect(page.locator(".c3d-stage")).toHaveAttribute("data-status", "ready");
  await page.getByRole("button", { name: "Sisi depan", exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath("space-arcade-mobile.png"), fullPage: true });
  await page.getByRole("button", { name: "Mode fokus", exact: true }).click();
  await expect(page.getByRole("button", { name: "Tutup mode fokus", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect
    .poll(() =>
      page.locator(".c3d-canvas canvas").evaluate((canvas) => Math.abs(canvas.clientWidth - (canvas.parentElement?.clientWidth ?? 0))),
    )
    .toBeLessThan(2);
  await expect(page.locator(".c3d-canvas canvas")).toHaveCount(1);
  await page.getByRole("button", { name: "Tutup mode fokus", exact: true }).click();
});

test("unavailable WebGL shows a recoverable error without losing card identity", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (...args: Parameters<typeof getContext>) {
      if (String(args[0]).includes("webgl")) return null;
      return Reflect.apply(getContext, this, args);
    };
  });
  await page.goto(CARD_PATH);
  await expect(page.getByRole("alert")).toContainText("Tampilan 3D tidak tersedia");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Genesis");
  await expect(page.getByRole("button", { name: "Sisi depan", exact: true })).toBeDisabled();
  await expect(page.getByRole("link", { name: "Detail & riwayat kartu" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("lost WebGL context disables controls and survives navigation", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(CARD_PATH);
  await expect(page.locator(".c3d-stage")).toHaveAttribute("data-status", "ready");
  await page.locator(".c3d-canvas canvas").dispatchEvent("webglcontextlost");
  await expect(page.locator(".c3d-stage")).toHaveAttribute("data-status", "error");
  await expect(page.getByRole("button", { name: "Reset tampilan" })).toBeDisabled();
  await page.getByRole("link", { name: "Detail & riwayat kartu" }).click();
  await expect(page.locator(".c3d-canvas canvas")).toHaveCount(0);
  await page.goBack();
  await expect(page.locator(".c3d-stage")).toHaveAttribute("data-status", "ready");
  await expect(page.locator(".c3d-canvas canvas")).toHaveCount(1);
  expect(errors).toEqual([]);
});

for (const status of [404, 500]) {
  test(`API ${status} shows the appropriate card error`, async ({ page }) => {
    await page.route("**/api/nfc/cards/card-genesis-live-08/3d*", (route) => route.fulfill({ status, json: { error: "Unavailable" } }));
    await page.goto(CARD_PATH);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      status === 404 ? "C.Card tidak ditemukan" : "C.Card belum dapat dimuat",
    );
    await expect(page.getByRole("button", { name: "Coba lagi" })).toHaveCount(status === 500 ? 1 : 0);
  });
}

test("NFC status is authoritative and SUN parameters reach the API", async ({ page }) => {
  let query = "";
  await page.route("**/api/nfc/cards/card-genesis-live-08/3d*", async (route) => {
    query = new URL(route.request().url()).search;
    const response = await route.fetch();
    const body = await response.json();
    await route.fulfill({
      response,
      json: { ...body, owner: null, verifiedBadge: "Verified Card", card: { ...body.card, verifyStatus: "tamper_detected" } },
    });
  });
  await page.goto(`${CARD_PATH}?uid=test&ctr=01&c=proof&t=seal`);
  await expect(page.getByRole("heading", { name: "Segel terdeteksi berubah" })).toBeVisible();
  await expect(page.getByText("Keaslian terverifikasi", { exact: true })).toHaveCount(0);
  const params = new URLSearchParams(query);
  expect(Object.fromEntries(params)).toEqual({ uid: "test", ctr: "01", cmac: "proof", t: "seal" });
  await expect(page.locator(".c3d-metadata")).not.toContainText("KOLEKTOR");
});

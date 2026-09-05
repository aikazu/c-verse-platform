import { readFile } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";
import { localAppOrigins } from "../env";
import { adminLogin, loginAs } from "../helpers";
import { remoteServiceRest } from "../helpers/db";

const origins = localAppOrigins();
const demoId = "00000000-0000-4000-8000-000000000001";
async function rest(path: string, method = "GET", body?: unknown) {
  const target = remoteServiceRest();
  const response = await fetch(`${target.base}/rest/v1/${path}`, {
    method,
    headers: { ...target.headers, Prefer: "return=representation,resolution=merge-duplicates" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) throw new Error(`Fixture ${method} failed: ${response.status}`);
  return response.json();
}
async function apiAs(page: Page, path: string, method = "GET", body?: unknown) {
  return page.evaluate(
    async ({ origin, path, method, body }) => {
      const key = Object.keys(localStorage).find((key) => key.startsWith("sb-") && key.endsWith("-auth-token"));
      const session = key ? JSON.parse(localStorage.getItem(key) ?? "{}") : {};
      const response = await fetch(`${origin}/api${path}`, {
        method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { status: response.status, body: await response.json() };
    },
    { origin: origins.api, path, method, body },
  );
}
async function restore(table: string, filter: string, rows: unknown[]) {
  await rest(`${table}?${filter}`, "DELETE");
  if (rows.length) await rest(table, "POST", rows);
}

test("showcase selection, persistence, real PNG export and privacy", async ({ page }, testInfo) => {
  test.setTimeout(100_000);
  const original = await rest(`collection_showcases?user_id=eq.${demoId}`);
  const [owner] = await rest(`users?id=eq.${demoId}&select=username,is_anonymous`);
  try {
    await rest(`users?id=eq.${demoId}`, "PATCH", { is_anonymous: false });
    await loginAs(page, "demo@cverse.id");
    await page.goto("/me");
    const editor = page.getByRole("region", { name: "Atur etalase koleksi" });
    await expect(editor.getByLabel("Judul etalase")).toBeVisible();
    for (const checkbox of await editor.getByRole("checkbox").all()) await checkbox.uncheck();
    await editor.getByLabel("Judul etalase").fill("Pilihan koleksi E2E");
    for (let index = 0; index < 3; index++) await editor.getByRole("checkbox").nth(index).check();
    await expect(editor.getByRole("checkbox").nth(3)).toBeDisabled();
    await editor.getByRole("button", { name: "Simpan etalase", exact: true }).click();
    await expect(page.getByText("Etalase tersimpan", { exact: true })).toBeVisible();
    await page.reload();
    await expect(editor.getByLabel("Judul etalase")).toHaveValue("Pilihan koleksi E2E");
    await expect(editor.locator("input:checked")).toHaveCount(3);
    await editor.getByRole("link", { name: "Lihat & bagikan etalase →" }).click();
    const showcase = page.getByRole("region", { name: "Etalase koleksi", exact: true });
    await expect(showcase.locator(".showcase-card")).toHaveCount(3);
    await page.screenshot({ path: testInfo.outputPath("showcase-desktop.png"), fullPage: true });
    const downloadEvent = page.waitForEvent("download");
    await showcase.getByRole("button", { name: "Bagikan gambar etalase" }).click();
    const download = await downloadEvent;
    const filename = testInfo.outputPath("showcase-social.png");
    await download.saveAs(filename);
    const bytes = await readFile(filename);
    expect(bytes.subarray(1, 4).toString()).toBe("PNG");
    expect(bytes.readUInt32BE(16)).toBe(1200);
    expect(bytes.readUInt32BE(20)).toBe(1200);
    // Simulate native share losing its transient permission after image generation.
    // The real canvas/file/download path still runs; this is not an OS share test.
    await page.evaluate(() => {
      Object.defineProperty(navigator, "canShare", { configurable: true, value: () => true });
      Object.defineProperty(navigator, "share", {
        configurable: true,
        value: async () => {
          throw new DOMException("Share permission expired", "NotAllowedError");
        },
      });
    });
    const fallbackDownload = page.waitForEvent("download");
    await showcase.getByRole("button", { name: "Bagikan gambar etalase" }).click();
    expect((await fallbackDownload).suggestedFilename()).toBe(download.suggestedFilename());
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: testInfo.outputPath("showcase-mobile.png"), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.goto("/me/privacy");
    await page.getByRole("button", { name: "Sembunyikan", exact: true }).click();
    await expect(page.getByRole("button", { name: "Tampilkan", exact: true })).toBeVisible();
    await page.goto(`/u/${owner.username}`);
    await expect(page.getByText("Profil ini privat.")).toBeVisible();
    await expect(page.getByRole("region", { name: "Etalase koleksi", exact: true })).toHaveCount(0);
    const publicRead = await page.request.get(`${origins.api}/api/public/u/${owner.username}/showcase`);
    expect(await publicRead.json()).toEqual({ showcase: null });
    expect((await page.request.get(`${origins.api}/api/seo/meta?path=/u/${owner.username}`)).status()).toBe(404);
  } finally {
    await rest(`users?id=eq.${demoId}`, "PATCH", { is_anonymous: owner.is_anonymous });
    await restore("collection_showcases", `user_id=eq.${demoId}`, original);
  }
});

test("contextual guide skips, persists, reopens and keeps transaction consent", async ({ page }, testInfo) => {
  test.setTimeout(80_000);
  const original = await rest(`collector_preferences?user_id=eq.${demoId}`);
  try {
    await rest("collector_preferences", "POST", { user_id: demoId, guide_dismissed: false });
    await loginAs(page, "demo@cverse.id");
    await page.goto("/drops/drop-aurora-raffle");
    const guide = page.getByRole("complementary", { name: "Panduan pengguna baru" });
    await expect(guide.getByRole("heading", { name: "Pilih pool C.Card" })).toBeVisible();
    await expect(guide).toContainText(/1 C-Coin = Rp\s*10\.000/);
    await guide.getByRole("button", { name: "Lewati panduan" }).click();
    await expect(guide.getByRole("button", { name: "Buka panduan pengguna baru" })).toBeVisible();
    await page.reload();
    await expect(guide.getByRole("button", { name: "Buka panduan pengguna baru" })).toBeVisible();
    await page.goto("/wallet");
    await guide.getByRole("button", { name: "Buka panduan pengguna baru" }).click();
    await expect(guide.getByRole("heading", { name: "Kenali saldo ditahan" })).toBeVisible();
    await page.reload();
    await expect(guide.getByRole("heading", { name: "Kenali saldo ditahan" })).toBeVisible();
    await page.goto("/drops/drop-genesis-live");
    await expect(guide.getByRole("heading", { name: "Lihat hasil Raffle" })).toBeVisible();
    await page.goto("/me");
    await expect(guide.getByRole("heading", { name: "Kartu tersimpan di Vault" })).toBeVisible();
    await page.goto("/me/manage");
    await expect(guide.getByRole("heading", { name: "Kirim saat kamu siap" })).toBeVisible();
    await expect(guide).toContainText(/2 C-Coin \(Rp\s*20\.000\)/);
    await page.screenshot({ path: testInfo.outputPath("guide-shipping.png"), fullPage: true });
    expect((await apiAs(page, "/profile/guide")).body.dismissed).toBe(false);
    expect((await apiAs(page, "/drops/drop-genesis-live/editorial/story")).status).toBe(403);
    // The guide changes no selection and performs no purchase.
    expect((await apiAs(page, "/profile/guide", "PATCH", { dismissed: true, userId: "other" })).status).toBe(400);
    await page.goto("/drops/drop-genesis-live/checkout");
    await page.getByRole("button", { name: /^Bayar \d+ C →$/ }).click();
    const confirmation = page.getByRole("dialog");
    await expect(confirmation.getByRole("checkbox")).not.toBeChecked();
    await expect(confirmation.getByRole("button", { name: "Bayar", exact: true })).toBeDisabled();
    await confirmation.getByRole("button", { name: "Batal", exact: true }).click();
  } finally {
    await restore("collector_preferences", `user_id=eq.${demoId}`, original);
  }
});

test("ops publishes a Drop without story, then manages story draft and publication", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const title = `e2e-editorial-${Date.now()}`;
  let dropId = "";
  try {
    await adminLogin(page);
    await page.goto(`${origins.admin}/drops`);
    await page.locator("#drop-creator").selectOption("00000000-0000-4000-8000-000000000003");
    await page.locator("#drop-title").fill(title);
    await page.locator("#drop-series").fill("Editorial E2E");
    await page.locator("#drop-narrative").fill("Fixture to verify optional editorial content");
    await page.locator("#drop-units").fill("2");
    const created = page.waitForResponse((response) => response.request().method() === "POST" && response.url().endsWith("/api/drops"));
    await page.getByRole("button", { name: "Buat Draft", exact: true }).click();
    const result = await created;
    expect(result.status()).toBe(201);
    dropId = (await result.json()).drop.id;
    const row = page.getByRole("row").filter({ hasText: title });
    await row.getByRole("button", { name: "Publish", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Ubah", exact: true }).click();
    await expect(row.locator(".pill").first()).toHaveText("Live");
    expect((await (await page.request.get(`${origins.api}/api/drops/${dropId}`)).json()).status).toBe("published");
    expect((await page.request.get(`${origins.api}/api/drops/${dropId}`)).status()).toBe(200);
    expect(await (await page.request.get(`${origins.api}/api/drops/${dropId}/editorial`)).json()).toEqual({ items: [] });
    await row.getByRole("button", { name: "Cerita C.Card", exact: true }).click();
    await page.locator("#editorial-title").fill("Makna karya untuk E2E");
    await page.locator("#editorial-body").fill("Cerita terbit melalui alur ops sebenarnya.");
    await page.getByRole("button", { name: "Simpan Draft", exact: true }).click();
    await expect(page.getByText("Draft disimpan.", { exact: true })).toBeVisible();
    expect(await (await page.request.get(`${origins.api}/api/drops/${dropId}/editorial`)).json()).toEqual({ items: [] });
    await page.reload();
    await row.getByRole("button", { name: "Cerita C.Card", exact: true }).click();
    await expect(page.locator("#editorial-body")).toHaveValue("Cerita terbit melalui alur ops sebenarnya.");
    await page.getByRole("button", { name: "Publikasikan", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Publikasikan", exact: true }).click();
    await expect(page.getByText("Konten dipublikasikan.", { exact: true })).toBeVisible();
    await page.locator("#editorial-body").fill("Draft revisi ini belum dipublikasikan.");
    await page.getByRole("button", { name: "Simpan Draft", exact: true }).click();
    await expect(page.getByText("Draft disimpan.", { exact: true })).toBeVisible();
    await page.goto(`${origins.web}/drops/${dropId}`);
    await expect(page.getByRole("heading", { name: "Makna karya untuk E2E" })).toBeVisible();
    await expect(page.getByText("Cerita terbit melalui alur ops sebenarnya.", { exact: true })).toBeVisible();
    await expect(page.getByText("Draft revisi ini belum dipublikasikan.", { exact: true })).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath("published-story.png"), fullPage: true });
    await page.goto(`${origins.admin}/drops`);
    await row.getByRole("button", { name: "Cerita C.Card", exact: true }).click();
    await page.getByRole("button", { name: "+ Tambah media", exact: true }).click();
    await page.locator("#editorial-media-url-0").pressSequentially("https://assets.c-verse.co/mock/v2/artworks/karina-velvet.png");
    await expect(page.locator("#editorial-media-url-0")).toBeFocused();
    await page.locator("#editorial-media-caption-0").fill("Foto proses karya");
    await page.getByRole("button", { name: "+ Tambah media", exact: true }).click();
    await page.locator("#editorial-media-type-1").selectOption("video");
    await page.locator("#editorial-media-url-1").fill("https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4");
    await page.locator("#editorial-media-caption-1").fill("Video proses contoh");
    await page.getByRole("button", { name: "Publikasikan", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Publikasikan", exact: true }).click();
    await expect(page.getByText("Konten dipublikasikan.", { exact: true })).toBeVisible();
    await page.goto(`${origins.web}/drops/${dropId}`);
    const storyImage = page.getByRole("img", { name: "Foto proses karya" });
    await storyImage.scrollIntoViewIfNeeded();
    await expect.poll(() => storyImage.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
    const video = page.locator(".drop-editorial video");
    await expect(video).toHaveAttribute("controls", "");
    await expect.poll(() => video.evaluate((video: HTMLVideoElement) => video.readyState)).toBeGreaterThan(0);
    await expect(page.getByText("Draft revisi ini belum dipublikasikan.", { exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("published-story-media.png"), fullPage: true });
    await page.goto(`${origins.admin}/drops`);
    await row.getByRole("button", { name: "Cerita C.Card", exact: true }).click();
    await page.getByRole("button", { name: "Batalkan Publikasi", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Batalkan publikasi", exact: true }).click();
    await expect(page.getByText("Publikasi dibatalkan.", { exact: true })).toBeVisible();
    await page.goto(`${origins.web}/drops/${dropId}`);
    await expect(page.getByRole("heading", { name: "Makna karya untuk E2E" })).toHaveCount(0);
  } finally {
    if (dropId) await rest(`drops?id=eq.${dropId}`, "DELETE");
  }
});

test("ops selects a Seed campaign and publishes its three stages with card link", async ({ page }, testInfo) => {
  test.setTimeout(100_000);
  const dropId = "drop-seed-karina-01";
  const filter = `drop_id=eq.${dropId}&kind=eq.seed_campaign`;
  const original = await rest(`drop_editorial?${filter}`);
  try {
    await rest(`drop_editorial?${filter}`, "DELETE");
    await adminLogin(page);
    await page.goto(`${origins.admin}/drops`);
    const [drop] = await rest(`drops?id=eq.${dropId}&select=title`);
    const row = page.getByRole("row").filter({ hasText: drop.title });
    await row.getByRole("button", { name: "Campaign", exact: true }).click();
    await page.locator("#editorial-title").fill("Awal kolaborasi E2E");
    await page.locator("#editorial-body").fill("Dokumentasi kolaborasi opsional.");
    await page.locator("#editorial-card").selectOption({ index: 1 });
    await page.locator("#editorial-making").fill("Proses pembuatan kartu.");
    await page.locator("#editorial-signing").fill("Penandatanganan bersama kreator.");
    await page.locator("#editorial-handover").fill("Penyerahan hadiah kepada kreator.");
    await page.getByRole("button", { name: "Publikasikan", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Publikasikan", exact: true }).click();
    await expect(page.locator(".editorial-message")).toContainText(/dipublikasikan/);
    await page.goto(`${origins.web}/drops/${dropId}`);
    await expect(page.getByRole("heading", { name: "Awal kolaborasi E2E" })).toBeVisible();
    for (const content of ["Proses pembuatan kartu.", "Penandatanganan bersama kreator.", "Penyerahan hadiah kepada kreator."])
      await expect(page.getByText(content, { exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Lihat kartu Creator Seed" }).click();
    await expect(page).toHaveURL(/\/cards\//);
    await expect(page.getByRole("heading", { name: "Awal kolaborasi E2E" })).toBeVisible();
    await expect(page.locator(".ci-unit")).toContainText("#1");
    await page.screenshot({ path: testInfo.outputPath("seed-campaign.png"), fullPage: true });
  } finally {
    await restore("drop_editorial", filter, original);
  }
});

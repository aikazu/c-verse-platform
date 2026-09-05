import path from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { localAppOrigins } from "../../env";
import { adminLogin } from "../../helpers";
import { remoteServiceRest } from "../../helpers/db";

const API_BASE = localAppOrigins().api;
const GENESIS_ARTWORK_FIXTURE = path.resolve(process.cwd(), "apps/web/public/mock/v1/artworks/genesis.png");
const KARINA_CREATOR_ID = "00000000-0000-4000-8000-000000000003";

function serviceHeaders(): Record<string, string> {
  return remoteServiceRest().headers;
}

async function adminAccessToken(page: Page): Promise<string> {
  const raw = await page.evaluate(() => {
    const key = Object.keys(localStorage).find((candidate) => candidate.includes("auth-token"));
    return key ? localStorage.getItem(key) : null;
  });
  if (!raw) throw new Error("Sesi admin tidak tersedia");
  const session = JSON.parse(raw) as { access_token?: string } | Array<{ access_token?: string }>;
  const token = Array.isArray(session) ? session[0]?.access_token : session.access_token;
  if (!token) throw new Error("Token admin tidak tersedia");
  return token;
}

async function cleanupDrop(title: string): Promise<void> {
  if (!title.startsWith("e2e-artwork-")) throw new Error("Cleanup hanya diizinkan untuk fixture e2e-artwork-");
  const base = remoteServiceRest().base;
  const headers = serviceHeaders();
  const result = await fetch(`${base}/rest/v1/drops?select=id&title=eq.${encodeURIComponent(title)}`, { headers });
  if (!result.ok) throw new Error(`Lookup cleanup drop gagal: HTTP ${result.status}`);
  const rows = (await result.json().catch(() => [])) as Array<{ id: string }>;
  const ids = rows.map((row) => `"${row.id}"`).join(",");
  if (!ids) return;
  const cards = await fetch(`${base}/rest/v1/cards?drop_id=in.(${ids})`, { method: "DELETE", headers });
  if (!cards.ok) throw new Error(`Cleanup kartu gagal: HTTP ${cards.status}`);
  const drops = await fetch(`${base}/rest/v1/drops?id=in.(${ids})`, { method: "DELETE", headers });
  if (!drops.ok) throw new Error(`Cleanup drop gagal: HTTP ${drops.status}`);
}

async function fillDraftForm(page: Page, title: string): Promise<void> {
  await page.locator("#drop-creator").selectOption(KARINA_CREATOR_ID);
  await page.locator("#drop-title").fill(title);
  await page.locator("#drop-series").fill(`Series ${Date.now()}`);
  await page.locator("#drop-narrative").fill("Fixture artwork upload admin dengan deskripsi yang cukup panjang.");
  await page.locator("#drop-units").fill("2");
  await page.locator("#drop-price").fill("25");
  await page.locator("#drop-artwork").setInputFiles(GENESIS_ARTWORK_FIXTURE);
}

test.describe("Artwork drop publik", () => {
  test("buat draft, unggah artwork, dan ganti artwork published dengan konfirmasi", async ({ page, request }, testInfo) => {
    test.setTimeout(60_000);
    const title = `e2e-artwork-${Date.now()}`;
    await cleanupDrop(title);
    try {
      await adminLogin(page);
      await page.getByRole("link", { name: "Drops" }).click();
      await fillDraftForm(page, title);
      await expect(page.getByAltText("Pratinjau artwork baru")).toBeVisible();

      const create = page.waitForResponse(
        (response) => new URL(response.url()).pathname === "/api/drops" && response.request().method() === "POST",
      );
      const firstUpload = page.waitForResponse(
        (response) => /\/api\/drops\/[^/]+\/artwork$/.test(new URL(response.url()).pathname) && response.request().method() === "POST",
      );
      await page.getByRole("button", { name: "Buat Draft" }).click();
      expect((await create).status()).toBe(201);
      const firstUploadResponse = await firstUpload;
      expect(firstUploadResponse.status()).toBe(200);
      const firstArtwork = (await firstUploadResponse.json()) as { artworkUrl: string };
      expect((await request.get(firstArtwork.artworkUrl)).status()).toBe(200);
      await expect(page.locator(".admin-msg")).toContainText("Draft dan artwork berhasil dibuat");

      const token = await adminAccessToken(page);
      const list = await fetch(`${API_BASE}/api/drops`, { headers: { Authorization: `Bearer ${token}` } });
      const body = (await list.json()) as { drops: Array<{ id: string; title: string }> };
      const created = body.drops.find((drop) => drop.title === title);
      expect(created).toBeDefined();
      const publish = await fetch(`${API_BASE}/api/drops/${created?.id}/status`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ status: "published" }),
      });
      expect(publish.status).toBe(200);

      await page.reload();
      const row = page.getByRole("row").filter({ hasText: title });
      await expect(row).toBeVisible();
      await row.getByRole("button", { name: "Ganti artwork" }).click();
      await expect(page.getByAltText("Artwork saat ini")).toHaveJSProperty("naturalWidth", 1254);
      await page.locator("#replace-drop-artwork").setInputFiles(GENESIS_ARTWORK_FIXTURE);
      await page.locator("#replace-drop-artwork").setInputFiles({ name: "invalid.gif", mimeType: "image/gif", buffer: Buffer.from("gif") });
      await expect(page.getByRole("button", { name: "Simpan artwork" })).toBeDisabled();
      await expect(page.getByAltText("Pratinjau artwork pengganti")).toHaveCount(0);
      await page.locator("#replace-drop-artwork").setInputFiles(GENESIS_ARTWORK_FIXTURE);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: testInfo.outputPath("artwork-ui.png"), fullPage: true });
      const replacement = page.waitForResponse(
        (response) => /\/api\/drops\/[^/]+\/artwork$/.test(new URL(response.url()).pathname) && response.request().method() === "POST",
      );
      await page.getByRole("button", { name: "Simpan artwork" }).click();
      const confirmation = page.locator(".cfm-card", { hasText: "Ganti artwork drop yang sudah tayang?" });
      await expect(confirmation).toBeVisible();
      await confirmation.getByRole("button", { name: "Ganti artwork" }).click();
      const replacementResponse = await replacement;
      expect(replacementResponse.status()).toBe(200);
      const replacementArtwork = (await replacementResponse.json()) as { artworkUrl: string };
      expect((await request.get(replacementArtwork.artworkUrl)).status()).toBe(200);
      expect((await request.get(firstArtwork.artworkUrl)).status()).toBe(404);
      const auditBase = remoteServiceRest().base;
      const audits = await fetch(
        `${auditBase}/rest/v1/admin_audit_log?select=action,payload_summary&target_id=eq.${created?.id}&action=eq.update`,
        { headers: serviceHeaders() },
      );
      expect(audits.status).toBe(200);
      expect(await audits.json()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            action: "update",
            payload_summary: expect.objectContaining({ operation: "update_artwork", artworkUrl: firstArtwork.artworkUrl }),
          }),
          expect.objectContaining({
            action: "update",
            payload_summary: expect.objectContaining({ operation: "update_artwork", artworkUrl: replacementArtwork.artworkUrl }),
          }),
        ]),
      );
      await expect(page.locator(".admin-msg")).toContainText("Artwork drop diperbarui");
      await testInfo.attach("uploaded-artwork-urls", {
        body: JSON.stringify([firstArtwork.artworkUrl, replacementArtwork.artworkUrl]),
        contentType: "application/json",
      });
    } finally {
      await cleanupDrop(title);
    }
  });

  test("upload gagal sekali lalu retry memakai draft yang sama", async ({ page }, testInfo) => {
    test.setTimeout(60_000);
    const title = `e2e-artwork-retry-${Date.now()}`;
    await cleanupDrop(title);
    let artworkAttempts = 0;
    let createdDropId: string | undefined;
    await page.route("**/api/drops/*/artwork", async (route) => {
      artworkAttempts += 1;
      if (artworkAttempts === 1) {
        await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "R2 sementara gagal" }) });
        return;
      }
      await route.continue();
    });
    try {
      await adminLogin(page);
      await page.getByRole("link", { name: "Drops" }).click();
      await fillDraftForm(page, title);
      const create = page.waitForResponse(
        (response) => new URL(response.url()).pathname === "/api/drops" && response.request().method() === "POST",
      );
      await page.getByRole("button", { name: "Buat Draft" }).click();
      const createResponse = await create;
      expect(createResponse.status()).toBe(201);
      createdDropId = ((await createResponse.json()) as { drop: { id: string } }).drop.id;
      await expect(page.locator(".admin-msg")).toContainText("Draft berhasil dibuat, tetapi artwork belum terunggah");
      await expect(page.getByRole("button", { name: "Coba upload artwork draft lagi" })).toBeVisible();

      const retry = page.waitForResponse(
        (response) => new URL(response.url()).pathname === `/api/drops/${createdDropId}/artwork` && response.request().method() === "POST",
      );
      await page.getByRole("button", { name: "Coba upload artwork draft lagi" }).click();
      const retryResponse = await retry;
      expect(retryResponse.status()).toBe(200);
      const retryArtwork = (await retryResponse.json()) as { artworkUrl: string };
      expect(artworkAttempts).toBe(2);
      await expect(page.locator(".admin-msg")).toContainText("draft yang sama");
      await testInfo.attach("uploaded-artwork-url", { body: retryArtwork.artworkUrl, contentType: "text/plain" });
    } finally {
      await page.unroute("**/api/drops/*/artwork");
      await cleanupDrop(title);
    }
  });
});

import path from "node:path";
import { expect, test } from "@playwright/test";
import { loginAs } from "../helpers";

const DEMO_AVATAR_FIXTURE = path.resolve(process.cwd(), "supabase/fixtures/avatars/demo.png");

test.describe("Avatar publik", () => {
  test("preview, upload, tampil publik, validasi file, lalu hapus", async ({ page, request }, testInfo) => {
    await loginAs(page, "demo@cverse.id");
    await page.goto("/me/privacy");
    await expect(page.locator("#profile-avatar")).toBeVisible();

    // Invalid selection must show inline feedback and clear any candidate file.
    await page.locator("#profile-avatar").setInputFiles({ name: "avatar.gif", mimeType: "image/gif", buffer: Buffer.from("gif") });
    await expect(page.locator(".ac-avatar-status-error")).toContainText("JPEG, PNG, atau WebP");
    await expect(page.getByRole("button", { name: "Simpan avatar" })).toHaveCount(0);

    await page.locator("#profile-avatar").setInputFiles(DEMO_AVATAR_FIXTURE);
    await expect(page.locator(".ac-avatar-image")).toHaveAttribute("src", /^blob:/);
    await expect(page.getByText("demo.png")).toBeVisible();

    const upload = page.waitForResponse(
      (response) => new URL(response.url()).pathname === "/api/profile/avatar" && response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Simpan avatar" }).click();
    expect((await upload).status()).toBe(200);
    await expect(page.locator(".ac-avatar-status-success")).toContainText("Avatar publik diperbarui");

    const menuAvatar = page.locator('button[aria-haspopup="menu"] img');
    await expect(menuAvatar).toBeVisible();
    const avatarUrl = await menuAvatar.getAttribute("src");
    if (!avatarUrl) throw new Error("Avatar navbar tidak memiliki URL setelah upload");
    const imageResponse = await request.get(avatarUrl);
    expect(imageResponse.status()).toBe(200);
    expect(imageResponse.headers()["cache-control"]).toBe("no-store");
    await expect(menuAvatar).toHaveJSProperty("naturalWidth", 1254);

    await page.goto("/u/demo_kolektor");
    await expect(page.locator(".pp-avatar")).toHaveAttribute("src", avatarUrl);
    await page.screenshot({ path: testInfo.outputPath("avatar-ui.png"), fullPage: true });

    await page.goto("/me/privacy");
    await page.getByRole("button", { name: "Hapus" }).click();
    const dialog = page.locator(".cfm-card", { hasText: "Hapus avatar publik?" });
    await expect(dialog).toBeVisible();
    const remove = page.waitForResponse(
      (response) => new URL(response.url()).pathname === "/api/profile/avatar" && response.request().method() === "DELETE",
    );
    await dialog.getByRole("button", { name: "Hapus avatar" }).click();
    expect((await remove).status()).toBe(200);
    await expect(page.locator(".ac-avatar-status-success")).toContainText("Avatar dihapus");
    await expect(page.locator('button[aria-haspopup="menu"] img')).toHaveCount(0);
    expect((await request.get(avatarUrl)).status()).toBe(404);
  });
});

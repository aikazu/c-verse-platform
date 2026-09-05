import { expect, test } from "@playwright/test";
import { adminLogin } from "../../helpers";

test("admin can find, deactivate, reload, and reactivate a badge", async ({ page }) => {
  await adminLogin(page);
  await page.goto("/badges");
  await expect(page.getByRole("heading", { name: "Lencana", exact: true })).toBeVisible();
  await page.getByLabel("Cari lencana").fill("Collection Nova");
  const row = page.getByRole("row").filter({ hasText: "Collection Nova" });
  await expect(row).toHaveCount(1);
  await expect(row.getByRole("button", { name: "Nonaktifkan", exact: true })).toBeVisible();

  try {
    await row.getByRole("button", { name: "Nonaktifkan", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Nonaktifkan", exact: true }).click();
    await expect(row.getByRole("button", { name: "Aktifkan", exact: true })).toBeVisible();
    await page.reload();
    await page.getByLabel("Cari lencana").fill("Collection Nova");
    await expect(row.getByRole("cell", { name: "Nonaktif", exact: true })).toBeVisible();
  } finally {
    const activate = row.getByRole("button", { name: "Aktifkan", exact: true });
    if (await activate.isVisible()) {
      await activate.click();
      await page.getByRole("dialog").getByRole("button", { name: "Aktifkan", exact: true }).click();
      await expect(row.getByRole("button", { name: "Nonaktifkan", exact: true })).toBeVisible();
      await page.reload();
      await page.getByLabel("Cari lencana").fill("Collection Nova");
      await expect(row.getByRole("cell", { name: "Aktif", exact: true })).toBeVisible();
    }
  }
});

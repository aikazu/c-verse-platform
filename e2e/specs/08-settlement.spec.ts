import { expect, type Page, test } from "@playwright/test";
import { clearMailbox, loginAs } from "../helpers";

// Separate deterministic fixtures exercise both phases without waiting for cron.
// Karina has no prior allocation in either drop and enough C-Coin for both.
const RAFFLE_DROP = "drop-aurora-raffle";
const FCFS_DROP = "drop-genesis-live";

async function readBalance(page: Page): Promise<number> {
  await page.goto("/wallet");
  const value = page.locator(".wa-balance", { hasText: "Saldo C-Coin" }).locator(".wa-balance-value");
  await expect(value).toBeVisible();
  const parsed = Number.parseInt((await value.textContent())?.trim() ?? "", 10);
  if (!Number.isFinite(parsed)) throw new Error("C-Coin balance is not readable");
  return parsed;
}

test.describe("Settlement (money flow)", () => {
  test.beforeEach(async () => {
    await clearMailbox("karina@creator.id");
  });

  test("raffle entry menahan C-Coin persis sebesar harga hold (escrow_hold)", async ({ page }) => {
    await loginAs(page, "karina@creator.id");
    const balanceBefore = await readBalance(page);
    await page.goto(`/drops/${RAFFLE_DROP}`);
    const cta = page.getByRole("button", { name: /Ikuti Raffle · tahan 28 C/ });
    await expect(cta).toBeVisible();
    await cta.click();

    const dialog = page.locator('[role="dialog"]', { hasText: "Ikut raffle" });
    await expect(dialog).toBeVisible();
    const confirmButton = dialog.getByRole("button", { name: "Ikut", exact: true });
    await expect(confirmButton).toBeDisabled();
    await expect(dialog.getByRole("link", { name: "Syarat & Ketentuan" })).toHaveAttribute("href", "/legal/terms");
    await dialog.getByRole("checkbox", { name: "Saya paham mengikuti raffle tidak bisa dibatalkan." }).check();
    await confirmButton.click();
    await expect(page).toHaveURL(/\/home/);

    expect(await readBalance(page)).toBe(balanceBefore - 28);
    const holdRow = page.locator("tr", { hasText: "Escrow ditahan" }).filter({ hasText: "-28 C" });
    await expect(holdRow.first()).toBeVisible();
    await page.goto(`/drops/${RAFFLE_DROP}`);
    await expect(page.locator(".cm-phase-pill", { hasText: "Sudah ikut" })).toContainText("28 C");
  });

  test("checkout FCFS penuh: saldo turun persis harga + kartu masuk koleksi", async ({ page }) => {
    await loginAs(page, "karina@creator.id");
    const balanceBefore = await readBalance(page);
    await page.goto("/collection");
    const cardLinks = page.locator("a[href*='/cards/']");
    await expect(cardLinks.first()).toBeVisible();
    const cardsBefore = await cardLinks.count();

    await page.goto(`/drops/${FCFS_DROP}`);
    await page.locator("a.btn-gold.cm-cta", { hasText: "Beli Sekarang" }).click();
    await expect(page).toHaveURL(new RegExp(`/drops/${FCFS_DROP}/checkout`));
    await expect(page.locator(".cm-summary-total")).toContainText("25 C");
    await page.getByRole("button", { name: /Bayar 25 C/ }).click();

    const dialog = page.locator(".cfm-card", { hasText: "Bayar 25 C?" });
    const confirmButton = dialog.getByRole("button", { name: "Bayar", exact: true });
    await expect(confirmButton).toBeDisabled();
    await expect(dialog.getByRole("link", { name: "Kebijakan Pengiriman & Vault" })).toHaveAttribute("href", "/legal/shipping");
    await dialog.getByRole("checkbox").check();
    await confirmButton.click();
    await expect(page).toHaveURL(/\/orders\//);
    await expect(page.locator(".toast-success", { hasText: "Checkout berhasil — 25 C · fisik tersimpan di vault" })).toBeVisible();

    expect(await readBalance(page)).toBe(balanceBefore - 25);
    await page.goto("/collection");
    await expect(cardLinks).toHaveCount(cardsBefore + 1);
  });
});

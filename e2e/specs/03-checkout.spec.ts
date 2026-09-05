import { expect, test } from "@playwright/test";
import { clearMailbox, loginAs } from "../helpers";

test.describe("Primary checkout", () => {
  test.beforeEach(async () => {
    await clearMailbox("demo@cverse.id");
  });

  test("halaman checkout bisa diakses setelah pilih drop", async ({ page }) => {
    await loginAs(page, "demo@cverse.id");
    await page.goto("/drops/drop-genesis-live");
    await expect(page).toHaveURL(/\/drops\/drop-genesis-live$/);
    // Halaman detail tidak error
    await expect(page.locator("body")).not.toContainText("Error");
  });

  test("checkout vault: halaman checkout memuat", async ({ page }) => {
    await loginAs(page, "demo@cverse.id");
    await page.goto("/wallet");
    // Catat saldo
    const _saldoText = await page.locator("[class*=balance]").first().textContent();

    await page.goto("/drops/drop-genesis-live");

    // Cari CTA beli — link "Beli Sekarang →" (a.btn-gold.cm-cta, DropDetail.tsx).
    // Locator lama text=Beli match badge fase "BELI LANGSUNG" (hidden) → klik
    // mendarat di elemen yang salah.
    const beliBtn = page.locator("a.cm-cta", { hasText: "Beli Sekarang" }).first();
    await expect(beliBtn, "drop-genesis-live seed harus tersedia untuk checkout FCFS").toBeVisible({ timeout: 10_000 });
    await beliBtn.click();
    await expect(page).toHaveURL(/checkout/);
    await expect(page.getByText("Penyimpanan", { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("button", { name: "Bayar 25 C →" })).toBeVisible();
  });

  test("checkout shipping: alamat wajib diisi", async () => {
    // Vault-settle MVP: checkout TIDAK punya langkah shipping — pembelian settle
    // langsung ke vault (card location='platform_vault', order 'settled') tanpa
    // alamat. Shipping hanya flow pasca-vault via vault_shipout (post-MVP).
    test.fixme(true, "shipping flow returns post-MVP; vault checkout settles without address");
  });

  test("deep link checkout menolak fase raffle dan tidak menawarkan pembayaran", async ({ page }) => {
    const unavailableDrop = {
      id: "drop-e2e-raffle",
      title: "Raffle belum FCFS",
      series: "E2E",
      narrative: "Drop fixture untuk checkout yang belum memasuki FCFS.",
      artworkUrl: "",
      totalUnits: 1,
      signedCount: 0,
      unsignedCount: 1,
      priceCcoin: 30,
      priceUnsignedCCoin: 30,
      priceSignedCCoin: 50,
      status: "live",
      dropStartAt: "2026-01-01T05:00:00.000Z",
      raffleEndAt: "2099-01-01T05:00:00.000Z",
      drawnAt: null,
      creatorId: "creator-e2e",
      creatorName: "Creator E2E",
      soldCount: 0,
      createdAt: "2026-01-01T05:00:00.000Z",
      isSeed: false,
    };
    await page.route("**/api/drops/drop-e2e-raffle", (route) => route.fulfill({ json: unavailableDrop }));
    await page.route("**/api/drops/drop-e2e-raffle/cards", (route) => route.fulfill({ json: { cards: [] } }));
    await page.goto("/drops/drop-e2e-raffle/checkout");
    await expect(page.getByRole("heading", { name: "Checkout belum tersedia" })).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole("button", { name: /Bayar/ })).toHaveCount(0);
  });
});

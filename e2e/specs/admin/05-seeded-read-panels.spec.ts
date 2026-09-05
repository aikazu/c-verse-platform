import { expect, test } from "@playwright/test";
import { adminLogin } from "../../helpers";

type DashboardPayload = {
  stats: { drops: number | null; orders: number | null; creators: number | null };
};
type Shipment = {
  id: string;
  status: string;
  type: string;
  from_location: string;
  to_dest: string;
  tracking_number: string | null;
};
type OrdersPayload = { orders: unknown[]; shipments: Shipment[] };
type NfcPayload = { batches: unknown[]; cards: unknown[] };
type PayoutPayload = { payouts: unknown[] };

function adminResponse(page: import("@playwright/test").Page, path: string) {
  return page.waitForResponse((response) => new URL(response.url()).pathname === path && response.request().method() === "GET");
}

test("admin reads seeded dashboard, orders, shipments, NFC, and payout panels", async ({ page }) => {
  await adminLogin(page);

  const dashboardResponse = await adminResponse(page, "/api/admin/dashboard");
  expect(dashboardResponse.status()).toBe(200);
  const dashboard = (await dashboardResponse.json()) as DashboardPayload;
  expect(dashboard.stats.drops).toBeGreaterThan(0);
  expect(dashboard.stats.orders).toBeGreaterThan(0);
  expect(dashboard.stats.creators).toBeGreaterThan(0);
  await expect(page.locator(".admin-stat-card", { hasText: "Drops" }).locator(".admin-stat-value")).toHaveText(
    String(dashboard.stats.drops),
  );
  await expect(page.locator(".admin-stat-card", { hasText: "Pesanan" }).locator(".admin-stat-value")).toHaveText(
    String(dashboard.stats.orders),
  );
  await expect(page.locator(".admin-stat-card", { hasText: "Kreator" }).locator(".admin-stat-value")).toHaveText(
    String(dashboard.stats.creators),
  );
  await page.screenshot({ path: "test-results/flow-admin-dashboard.png", fullPage: true });

  const ordersResponse = adminResponse(page, "/api/admin/orders");
  await page.getByRole("link", { name: "Pesanan" }).click();
  const orders = (await (await ordersResponse).json()) as OrdersPayload;
  expect(orders.orders.length).toBeGreaterThan(0);
  expect(orders.shipments.length).toBeGreaterThan(0);
  await expect(page.getByRole("heading", { name: "Pesanan", exact: true })).toBeVisible();
  await expect(page.locator("table tbody tr").first()).toBeVisible();
  await expect(page.locator(".admin-table-head", { hasText: `Antrean shipment — ${orders.shipments.length}` })).toBeVisible();

  const vaultShipout = orders.shipments.find((shipment) => shipment.type === "vault_shipout");
  expect(vaultShipout, "fixture vault_shipout harus terproyeksi di antrean shipment").toBeDefined();
  const vaultRow = page.getByRole("row").filter({ hasText: vaultShipout?.id.slice(0, 10) ?? "" });
  await expect(vaultRow).toContainText(`${vaultShipout?.from_location} → ${vaultShipout?.to_dest}`);
  await expect(vaultRow).toContainText(vaultShipout?.tracking_number ?? "—");

  const inbound = orders.shipments.find((shipment) => shipment.type === "secondary_seller_to_vault" && shipment.status === "requested");
  if (inbound) {
    const inboundRow = page.getByRole("row").filter({ hasText: inbound.id.slice(0, 10) });
    await expect(inboundRow).toContainText(`${inbound.from_location} → ${inbound.to_dest}`);
    await expect(inboundRow.getByRole("button", { name: "Packing", exact: true })).toBeVisible();
    await expect(inboundRow.getByRole("button", { name: "Kirim", exact: true })).toBeVisible();
  }

  const nfcResponse = adminResponse(page, "/api/admin/nfc");
  await page.getByRole("link", { name: "NFC" }).click();
  const nfc = (await (await nfcResponse).json()) as NfcPayload;
  expect(nfc.batches.length).toBeGreaterThan(0);
  expect(nfc.cards.length).toBeGreaterThan(0);
  await expect(page.locator(".admin-table-head", { hasText: `Batch — ${nfc.batches.length}` })).toBeVisible();
  await expect(page.locator(".admin-table-head", { hasText: "C.Card — sampel 50" })).toBeVisible();
  await page.screenshot({ path: "test-results/flow-admin-nfc.png", fullPage: true });

  const payoutsResponse = adminResponse(page, "/api/admin/payouts");
  await page.getByRole("link", { name: "Payout" }).click();
  const payouts = (await (await payoutsResponse).json()) as PayoutPayload;
  expect(payouts.payouts.length).toBeGreaterThan(0);
  await expect(page.locator(".admin-table-head", { hasText: `Payout — ${payouts.payouts.length}` })).toBeVisible();
});

import { expect, test } from "@playwright/test";
import { localAppOrigins } from "../../env";
import { adminLogin } from "../../helpers";
import { remoteServiceRest } from "../../helpers/db";

/**
 * Admin operations via admin UI (apps/admin, :3000) — lane e2e 2026-08-29.
 *
 * Current contract: active admin role is enforced server-side; deployed
 * gateways additionally require Access/WARP. Application TOTP is not required.
 * Local demo login remains development-only and does not bypass the role gate.
 * The Drops UI reads through the admin API, so drafts must remain visible and
 * status transitions are exercised through the real confirmation dialog.
 */

const API_BASE = localAppOrigins().api;
const KARINA_CREATOR_ID = "00000000-0000-4000-8000-000000000003";
const DEMO_ID = "00000000-0000-4000-8000-000000000001";
const VAULT_CARD_ID = "card-aespa-live-01";

/** Supabase REST headers dengan service role (fixture rows + cleanup). */
function serviceHeaders(): Record<string, string> {
  return remoteServiceRest().headers;
}

/** Hapus drop fixture (kartu ikut cascade) berdasarkan filter PostgREST pada judul. */
async function cleanupDrops(restTitleFilter: string): Promise<void> {
  const supabaseUrl = remoteServiceRest().base;
  const query = await fetch(`${supabaseUrl}/rest/v1/drops?select=id&title=${restTitleFilter}`, {
    headers: serviceHeaders(),
  });
  const rows = (await query.json().catch(() => [])) as Array<{ id: string }>;
  const ids = rows.map((row) => `"${row.id}"`).join(",");
  if (ids.length === 0) return;
  await fetch(`${supabaseUrl}/rest/v1/cards?drop_id=in.(${ids})`, { method: "DELETE", headers: serviceHeaders() });
  await fetch(`${supabaseUrl}/rest/v1/drops?id=in.(${ids})`, { method: "DELETE", headers: serviceHeaders() });
}

/** Fixture shipment tidak mengubah kartu: target sudah milik Demo dan berada di vault. */
async function cleanupShipment(shipmentIdFilter: string): Promise<void> {
  const rest = remoteServiceRest();
  const response = await fetch(`${rest.base}/rest/v1/shipments?id=${shipmentIdFilter}`, {
    method: "DELETE",
    headers: serviceHeaders(),
  });
  if (!response.ok) throw new Error(`Cleanup shipment fixture gagal: HTTP ${response.status}`);
}

async function createShipmentFixture(shipmentId: string): Promise<void> {
  const rest = remoteServiceRest();
  const response = await fetch(`${rest.base}/rest/v1/shipments`, {
    method: "POST",
    headers: serviceHeaders(),
    body: JSON.stringify({
      id: shipmentId,
      card_id: VAULT_CARD_ID,
      requester_id: DEMO_ID,
      type: "vault_shipout",
      from_location: "platform",
      to_dest: "platform_vault",
      address: { street: "Fixture fulfillment E2E" },
      fee_ccoin: 0,
      status: "requested",
    }),
  });
  if (!response.ok) throw new Error(`Buat shipment fixture gagal: HTTP ${response.status}`);
}

test.describe("Admin ops (UI)", () => {
  test("login admin via fixture session: Shell berbasis peran aktif", async ({ page }) => {
    await adminLogin(page);

    // Shell requires a session; no stale application MFA bypass badge.
    await expect(page.getByText("admin@cverse.id")).toBeVisible();
    await expect(page.getByText("Supabase OTP · akses berbasis peran")).toBeVisible();
    await expect(page.getByText("DEMO · aal1 tanpa TOTP")).toHaveCount(0);
  });

  test("buat drop via admin UI: toast sukses, ter-publish, dan terlihat di daftar + read publik", async ({ page, request }) => {
    test.setTimeout(60_000);
    const title = `e2e-aops-drop-${Date.now()}`;

    // Self-healing: buang sisa run gagal sebelumnya (create kartu di route
    // /api/drops memakai nfc_short_id deterministik "drop-00N" — bekas row
    // yang tidak ter-cleanup menyebabkan collision unique constraint).
    await cleanupDrops("like.e2e-aops-drop-*");

    await adminLogin(page);
    await page.getByRole("link", { name: "Drops" }).click();
    await expect(page.locator("#drop-title")).toBeVisible();
    await page.locator("#drop-creator").selectOption(KARINA_CREATOR_ID);

    // Form "Buat Drop" (Drops.tsx): judul/seri/deskripsi wajib, unit & harga C-Coin integer.
    await page.locator("#drop-title").fill(title);
    await page.locator("#drop-series").fill(`e2e-aops-seri-${Date.now()}`);
    await page.locator("#drop-narrative").fill("Drop fixture e2e admin ops untuk verifikasi pembuatan via UI");
    await page.locator("#drop-units").fill("2");
    await page.locator("#drop-price").fill("25");
    await page.getByRole("button", { name: "Buat Draft" }).click();

    // Toast sukses hanya muncul jika POST /api/drops (admin-gated) benar-benar 201.
    await expect(page.locator(".admin-msg")).toContainText("Drop dibuat", { timeout: 15000 });

    // Baris draft berasal dari named admin read API; publish melalui kontrol UI
    // dan modal konfirmasi yang dipakai operator.
    const row = page.getByRole("row").filter({ hasText: title });
    await expect(row).toBeVisible({ timeout: 15000 });
    await expect(row.locator("span.pill").filter({ hasText: "Draft" })).toBeVisible();
    await row.getByRole("button", { name: "Publish", exact: true }).click();
    const publishDialog = page.getByRole("dialog");
    await expect(publishDialog.locator("#cfm-title")).toContainText('Ubah status drop menjadi "published"');
    await publishDialog.getByRole("button", { name: "Ubah", exact: true }).click();
    await expect(row.locator("span.pill").filter({ hasText: "Live" })).toBeVisible({ timeout: 15000 });
    await expect(row.getByText("0/2")).toBeVisible(); // sold_count/total_units
    await expect(row.getByText("25 C")).toBeVisible(); // harga canonical

    // Satu cross-check read PUBLIK (anon): drop hasil UI create terlihat publik.
    const publicRead = await request.get(`${API_BASE}/api/drops`);
    expect(publicRead.ok()).toBeTruthy();
    const publicBody = (await publicRead.json()) as { drops: Array<{ title: string; status: string }> };
    const publicRow = publicBody.drops.find((drop) => drop.title === title);
    expect(publicRow).toBeDefined();
    expect(publicRow?.status).toBe("published");

    // Cleanup fixture (rows ber-prefix e2e-aops-*).
    await cleanupDrops(`eq.${encodeURIComponent(title)}`);
  });

  test("kyc: admin aktif membaca fixture, request tanpa sesi tetap ditolak", async ({ page, request }) => {
    const guest = await request.get(`${API_BASE}/api/kyc/admin/all`);
    expect(guest.status()).toBe(401);
    await adminLogin(page);
    const response = page.waitForResponse((res) => new URL(res.url()).pathname === "/api/kyc/admin/all");
    await page.getByRole("link", { name: "KYC" }).click();
    expect((await response).status()).toBe(200);
    const karina = page.getByRole("row").filter({ hasText: "Karina Aespa" });
    await expect(karina).toBeVisible();
    await expect(karina).toContainText("Disetujui");
    await expect(karina).toContainText("•••• •••• •••• 0003");
    await expect(karina.getByRole("button", { name: "Review" })).toBeEnabled();
    await expect(page.getByText("Belum ada pengajuan")).toHaveCount(0);
    // Private KYC documents are placeholders, so this checks metadata only.
  });

  test("antrean shipment: fulfillment UI menjalankan requested → packed → shipped → delivered", async ({ page }) => {
    test.setTimeout(60_000);
    const shipmentId = `e2e-admin-fulfill-${Date.now()}`;
    await cleanupShipment("like.e2e-admin-fulfill-*");
    await createShipmentFixture(shipmentId);

    try {
      await adminLogin(page);
      await page.getByRole("link", { name: "Pesanan" }).click();
      const row = page.getByRole("row").filter({ hasText: shipmentId.slice(0, 10) });
      await expect(row).toContainText("vault_shipout");
      await expect(row).toContainText("platform → platform_vault");
      await expect(row.getByRole("button", { name: "Packing", exact: true })).toBeVisible();

      await row.getByRole("button", { name: "Packing", exact: true }).click();
      const dialog = page.getByRole("dialog");
      await expect(dialog.locator("#cfm-title")).toHaveText("Tandai pengiriman ini sudah dipacking?");
      await dialog.getByRole("button", { name: "Packing", exact: true }).click();
      await expect(row).toContainText("Dikemas");

      await row.getByLabel("Nomor resi").fill("E2E-FULFILL-001");
      await row.getByRole("button", { name: "Kirim", exact: true }).click();
      await expect(dialog.locator("#cfm-title")).toHaveText("Tandai pengiriman ini dikirim?");
      await dialog.getByRole("button", { name: "Kirim", exact: true }).click();
      await expect(row).toContainText("Dikirim");
      await expect(row).toContainText("E2E-FULFILL-001");

      await row.getByRole("button", { name: "Selesai", exact: true }).click();
      await expect(dialog.locator("#cfm-title")).toHaveText("Tandai pengiriman ini selesai (diterima)?");
      await dialog.getByRole("button", { name: "Selesai", exact: true }).click();
      await expect(row).toContainText("Diterima");
    } finally {
      await cleanupShipment(`eq.${encodeURIComponent(shipmentId)}`);
    }
  });
});

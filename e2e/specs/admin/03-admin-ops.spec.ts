import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { adminLogin } from "../../helpers";

/**
 * Admin operations via admin UI (apps/admin, :3000) — lane e2e 2026-08-29.
 *
 * Current contract: active admin role is enforced server-side; deployed
 * gateways additionally require Access/WARP. Application TOTP is not required.
 * Local demo login remains development-only and does not bypass the role gate.
 * - RLS drops (05_rls `drops_select_public`) hanya memperlihatkan status
 *   publik — drop `draft` tidak muncul di daftar admin (halaman Drops baca
 *   PostgREST langsung via supabase-js). Karena itu transisi status di UI
 *   tidak bisa mengklik baris draft; publish dilakukan via endpoint yang
 *   sama dengan tombol Publish (PATCH /api/drops/:id/status) memakai token
 *   admin sesi sungguhan, lalu hasilnya di-assert di daftar UI + read publik.
 */

const API_BASE = "http://127.0.0.1:8787";

/** Baca satu variabel dari apps/api/.dev.vars (nilai service key TIDAK pernah di-echo). */
function readDevVar(key: string): string {
  const raw = readFileSync(path.resolve(process.cwd(), "apps/api/.dev.vars"), "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(/^([A-Z_0-9]+)=(.*)$/);
    if (match && match[1] === key) return match[2].trim();
  }
  throw new Error(`Key ${key} tidak ditemukan di apps/api/.dev.vars`);
}

/** Supabase REST headers dengan service role (fixture rows + cleanup). */
function serviceHeaders(): Record<string, string> {
  return {
    apikey: readDevVar("SUPABASE_SERVICE_ROLE_KEY"),
    Authorization: `Bearer ${readDevVar("SUPABASE_SERVICE_ROLE_KEY")}`,
    "Content-Type": "application/json",
  };
}

/** access_token sesi admin dari storage supabase-js (origin :3000). */
async function adminAccessToken(page: Page): Promise<string> {
  const raw = await page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.includes("auth-token"));
    return key ? localStorage.getItem(key) : null;
  });
  if (!raw) throw new Error("Sesi admin tidak ditemukan di localStorage origin :3000");
  const parsed = JSON.parse(raw) as { access_token?: string } | Array<{ access_token?: string }>;
  const token = Array.isArray(parsed) ? parsed[0]?.access_token : parsed.access_token;
  if (!token) throw new Error("access_token tidak ditemukan di storage sesi admin");
  return token;
}

/** Hapus drop fixture (kartu ikut cascade) berdasarkan filter PostgREST pada judul. */
async function cleanupDrops(restTitleFilter: string): Promise<void> {
  const supabaseUrl = readDevVar("SUPABASE_URL").replace(/\/+$/, "");
  const query = await fetch(`${supabaseUrl}/rest/v1/drops?select=id&title=${restTitleFilter}`, {
    headers: serviceHeaders(),
  });
  const rows = (await query.json().catch(() => [])) as Array<{ id: string }>;
  const ids = rows.map((row) => `"${row.id}"`).join(",");
  if (ids.length === 0) return;
  await fetch(`${supabaseUrl}/rest/v1/cards?drop_id=in.(${ids})`, { method: "DELETE", headers: serviceHeaders() });
  await fetch(`${supabaseUrl}/rest/v1/drops?id=in.(${ids})`, { method: "DELETE", headers: serviceHeaders() });
}

test.describe("Admin ops (UI)", () => {
  test("login admin via tombol demo (dev): sesi aktif dan Shell berbasis peran", async ({ page }) => {
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

    // Form "Buat Drop" (Drops.tsx): judul/seri/deskripsi wajib, unit & harga C-Coin integer.
    await page.locator("#drop-title").fill(title);
    await page.locator("#drop-series").fill(`e2e-aops-seri-${Date.now()}`);
    await page.locator("#drop-narrative").fill("Drop fixture e2e admin ops untuk verifikasi pembuatan via UI");
    await page.locator("#drop-units").fill("2");
    await page.locator("#drop-price").fill("25");
    await page.getByRole("button", { name: "Buat Draft" }).click();

    // Toast sukses hanya muncul jika POST /api/drops (admin-gated) benar-benar 201.
    await expect(page.locator(".admin-msg")).toContainText("Drop dibuat", { timeout: 15000 });

    // Publish via endpoint yang sama dengan tombol Publish baris tabel (baris draft
    // tidak dirender karena RLS drops_select_public — lihat catatan di atas).
    const token = await adminAccessToken(page);
    const listAdmin = await fetch(`${API_BASE}/api/drops`, { headers: { Authorization: `Bearer ${token}` } });
    expect(listAdmin.status).toBe(200);
    const adminBody = (await listAdmin.json()) as { drops: Array<{ id: string; title: string; status: string }> };
    const created = adminBody.drops.find((drop) => drop.title === title);
    expect(created, "drop hasil create UI harus ada di read API admin").toBeDefined();
    expect(created?.status).toBe("draft");

    const publish = await fetch(`${API_BASE}/api/drops/${created?.id}/status`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ status: "published" }),
    });
    expect(publish.status).toBe(200);

    // Setelah published, RLS memperbolehkan read — baris muncul di daftar admin UI.
    await page.reload();
    const row = page.getByRole("row").filter({ hasText: title });
    await expect(row).toBeVisible({ timeout: 15000 });
    await expect(row.locator("span.pill").filter({ hasText: "Live" })).toBeVisible();
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
});

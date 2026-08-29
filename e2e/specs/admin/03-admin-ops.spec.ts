import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { adminLogin } from "../../helpers";

/**
 * Admin operations via admin UI (apps/admin, :3000) — lane e2e 2026-08-29.
 *
 * Kontras penting (diverifikasi di source, bukan asumsi):
 * - Sesi DEMO login = aal1; bypass TotpRequired hanya di SPA (App.tsx
 *   `isDemoDev`). Endpoint admin yang melewati `requireAdmin`
 *   (apps/api/src/lib/auth.ts — role admin + aal aal2, TANPA bypass dev)
 *   tetap menolak sesi aal1.
 * - supabase/config.toml mematikan TOTP (`[auth.mfa.totp] enroll_enabled =
 *   false`), jadi aal2 tidak dapat diperoleh di bench lokal → skenario
 *   approve KYC / shipment / seed-release (semua requireAdmin) TIDAK bisa
 *   dijalankan positif di sini; yang diuji adalah penolakan aal1 yang
 *   teramati di UI (defense-in-depth server-side).
 * - RLS drops (03_rls `drops_select_public`) hanya memperlihatkan status
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
  test("login admin via tombol demo (dev): sesi aal1 aktif dan Shell dirender", async ({ page }) => {
    await adminLogin(page);

    // Shell hanya dirender dengan sesi — sidebar memuat email admin + label aal1 demo.
    await expect(page.getByText("admin@cverse.id")).toBeVisible();
    await expect(page.getByText("Supabase · aal1 (demo)")).toBeVisible();
    // Badge dev-only App.tsx: bukti bypass aal2 hanya sisi SPA.
    await expect(page.getByText("DEMO · aal1 tanpa TOTP")).toBeVisible();
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

  test("kyc: sesi aal1 (demo) ditolak server — gate MFA aal2 teramati di UI", async ({ page }) => {
    // Approve KYC positif tidak dapat diuji di bench ini: requireAdmin wajib aal2
    // dan TOTP enroll dinonaktifkan di supabase/config.toml (lihat header file).
    // Yang diuji: guard aal2 SERVER-SIDE tetap menolak meski SPA (isDemoDev)
    // melewatkan TotpRequired — halaman KYC menampilkan error dari API.
    await adminLogin(page);
    await page.getByRole("link", { name: "KYC" }).click();

    // KycPage.load() → GET /api/kyc/admin/all → 403 mfa_required → errMessage dirender.
    await expect(page.locator(".admin-msg")).toContainText("MFA (aal2) wajib", { timeout: 15000 });
    // Daftar tetap kosong — tidak ada data yang terbaca tanpa aal2.
    await expect(page.getByText("Belum ada pengajuan")).toBeVisible();
  });
});

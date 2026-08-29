import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  (globalThis as unknown as Record<string, string | undefined>).SUPABASE_URL = "http://localhost:54321";
});

// P0-2 (audit 2026-08-24): per docs/03_flows.md Flow 11, kreator TIDAK self-register.
// POST /api/creators/apply harus 404 — onboarding kreator murni admin-provisioned
// via POST /api/admin/users/provision (app terpisah).
const { app } = await import("../../../index.js");

function applyAsUser(token = "user-jwt") {
  return app.request("/api/creators/apply", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({}),
  });
}

describe("POST /api/creators/apply (removed per Flow 11)", () => {
  it("route tidak ada — kembali 404 (bukan 200/201)", async () => {
    const res = await applyAsUser();
    expect(res.status).toBe(404);
  });
});

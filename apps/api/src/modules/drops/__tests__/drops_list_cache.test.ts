import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ role: null as string | null }));

vi.mock("../../../lib/auth.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/auth.js")>()),
  requireUser: async () => (state.role ? { user: { id: "viewer", role: state.role }, token: "test" } : { error: 401 }),
}));

vi.mock("../../../lib/reads/drops.js", () => ({
  listDrops: async () => [],
}));

const { default: routes } = await import("../routes.js");

describe("drop list cache privacy", () => {
  beforeEach(() => {
    state.role = null;
  });

  it("allows short public caching for anonymous catalog reads", async () => {
    const response = await routes.request("/");
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=60");
  });

  it.each(["creator", "admin", "user"])("keeps %s lists out of shared caches", async (role) => {
    state.role = role;
    const response = await routes.request("/");
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });
});

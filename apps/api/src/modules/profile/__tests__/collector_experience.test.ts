import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

const control = vi.hoisted(() => ({ denied: 0, admin: false, save: vi.fn(), showcase: null as unknown }));
vi.mock("../../../lib/auth.js", () => ({
  requireUser: async () => (control.denied ? { error: control.denied } : { user: { id: "owner" }, token: "user-token" }),
  requireAdmin: async () =>
    control.denied ? { error: control.denied } : control.admin ? { user: { id: "admin" }, token: "admin-token" } : { error: 403 },
  adminGateError: (result: { error: number }) => ({ body: { error: "Denied" }, status: result.error }),
  clientIp: () => null,
  tokenFingerprint: async () => null,
}));
vi.mock("../../../lib/db.js", () => ({
  userDb: () => ({}),
  rpcSaveShowcase: control.save,
  rpcSaveEditorial: control.save,
  RpcError: class extends Error {},
}));
vi.mock("../../../lib/reads/showcase.js", () => ({
  getPublicShowcase: async () => control.showcase,
  getMyShowcase: async () => ({ title: "Mine", cardIds: [] }),
}));
vi.mock("../../../lib/reads/editorial.js", () => ({ getPublicEditorial: async () => [], getEditorialDraft: async () => null }));
vi.mock("../../../lib/reads/drops.js", () => ({ listCardsByDrop: async () => [], getDropById: async () => ({ isSeed: false }) }));
const profile = (await import("../routes.js")).default;
const editorial = (await import("../../drops/editorial.js")).default;
const seo = (await import("../../seo/routes.js")).default;
const app = new Hono().route("/profile", profile).route("/drops", editorial).route("/seo", seo);
const doc = { title: "Story", body: "Meaning", media: [], cardId: null, making: "", signing: "", handover: "" };
function write(path: string, body: unknown) {
  return app.request(path, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}
beforeEach(() => {
  control.denied = 0;
  control.admin = false;
  control.showcase = null;
  control.save.mockReset();
});
describe("collector editorial route boundaries", () => {
  it("requires active session to save a showcase", async () => {
    for (const denied of [401, 403]) {
      control.denied = denied;
      expect((await write("/profile/showcase", { title: "Title", cardIds: [] })).status).toBe(denied);
    }
    expect(control.save).not.toHaveBeenCalled();
  });
  it("rejects fourth card, duplicates and empty title before mutation", async () => {
    for (const body of [
      { title: "Title", cardIds: ["a", "b", "c", "d"] },
      { title: "Title", cardIds: ["a", "a"] },
      { title: "", cardIds: ["a"] },
    ]) {
      expect((await write("/profile/showcase", body)).status).toBe(400);
    }
    expect(control.save).not.toHaveBeenCalled();
  });
  it("passes valid showcase through user RPC", async () => {
    expect((await write("/profile/showcase", { title: "My work", cardIds: ["a", "b", "c"] })).status).toBe(200);
    expect(control.save).toHaveBeenCalledWith({}, "My work", ["a", "b", "c"]);
  });
  it("protects editorial reads and writes from non-admin and suspended sessions", async () => {
    for (const denied of [0, 401, 403]) {
      control.denied = denied;
      expect((await app.request("/drops/drop/editorial/story")).status).toBe(denied || 403);
      expect((await write("/drops/drop/editorial/story", { document: doc, action: "draft", revision: 0 })).status).toBe(denied || 403);
    }
    expect(control.save).not.toHaveBeenCalled();
  });
  it("rejects insecure media and unknown fields", async () => {
    control.admin = true;
    for (const url of ["javascript:alert(1)", "http://example.com/image.png", "https://name:pass@example.com/video.mp4"]) {
      expect(
        (
          await write("/drops/drop/editorial/story", {
            document: { ...doc, media: [{ type: "image", url, caption: "Test" }] },
            action: "publish",
            revision: 0,
          })
        ).status,
      ).toBe(400);
    }
    expect(
      (await write("/drops/drop/editorial/story", { document: { ...doc, html: "<script>" }, action: "draft", revision: 0 })).status,
    ).toBe(400);
    expect(control.save).not.toHaveBeenCalled();
  });
  it("returns empty public content without draft material", async () => {
    expect(await (await app.request("/drops/drop/editorial")).json()).toEqual({ items: [] });
  });
  it("profile metadata fails closed and is never cached", async () => {
    const hidden = await app.request("/seo/meta?path=/u/private");
    expect(hidden.status).toBe(404);
    expect(hidden.headers.get("Cache-Control")).toBe("no-store");
    control.showcase = { title: "My showcase", displayName: "Collector", cards: [{ artworkUrl: "https://assets.c-verse.co/test.png" }] };
    const visible = await app.request("/seo/meta?path=/u/public");
    expect(((await visible.json()) as { og: { title: string } }).og.title).toBe("My showcase — C.Verse");
    expect(visible.headers.get("Cache-Control")).toBe("no-store");
  });
});

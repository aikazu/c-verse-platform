import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch, apiFetchBlob } from "./api";

const auth = vi.hoisted(() => ({ getSession: vi.fn(), signOut: vi.fn() }));
vi.mock("./supabase", () => ({ supabase: { auth } }));
const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.resetAllMocks();
  auth.getSession.mockResolvedValue({ data: { session: { access_token: "test-session" } } });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

it("sends the session and JSON payload, then returns the server result", async () => {
  fetchMock.mockResolvedValue(Response.json({ id: "draft-1" }));
  await expect(apiFetch("/api/drops", { method: "POST", body: '{"title":"Draft"}' })).resolves.toEqual({ id: "draft-1" });
  expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/api/drops"), {
    method: "POST",
    body: '{"title":"Draft"}',
    headers: { Authorization: "Bearer test-session", "Content-Type": "application/json" },
  });
});

it("leaves multipart boundaries to the browser during artwork uploads", async () => {
  const body = new FormData();
  body.set("file", new Blob(["fixture"], { type: "image/png" }), "artwork.png");
  fetchMock.mockResolvedValue(Response.json({ artworkUrl: "/artwork.png" }));
  await apiFetch("/api/drops/draft-1/artwork", { method: "POST", body });
  expect(fetchMock).toHaveBeenCalledWith(expect.any(String), {
    method: "POST",
    body,
    headers: { Authorization: "Bearer test-session" },
  });
});

describe.each([
  ["JSON", apiFetch],
  ["private document", apiFetchBlob],
] as const)("%s API errors", (_name, load) => {
  it("preserves the server error without signing out a valid session", async () => {
    fetchMock.mockResolvedValue(Response.json({ error: "Admin access required" }, { status: 403 }));
    await expect(load("/api/admin/test")).rejects.toThrow("Admin access required");
    expect(auth.signOut).not.toHaveBeenCalled();
  });

  it("clears an expired session on 401", async () => {
    fetchMock.mockResolvedValue(Response.json({ error: "Unauthorized" }, { status: 401 }));
    await expect(load("/api/admin/test")).rejects.toThrow("Sesi berakhir — silakan masuk kembali.");
    expect(auth.signOut).toHaveBeenCalledOnce();
  });

  it("reports the HTTP status when a gateway sends a non-JSON failure", async () => {
    fetchMock.mockResolvedValue(new Response("<html>Unavailable</html>", { status: 503, statusText: "Service Unavailable" }));
    await expect(load("/api/admin/test")).rejects.toThrow("HTTP 503 Service Unavailable");
    expect(auth.signOut).not.toHaveBeenCalled();
  });
});

import { describe, expect, it, vi } from "vitest";
import { notifyDeployment, runDeployment } from "./deploy.mjs";

describe("deployment notification boundary", () => {
  it("preserves both failed and successful deployments if notification delivery fails", async () => {
    for (const code of [0, 7]) {
      expect(
        await runDeployment({
          execute: async () => code,
          notify: async () => {
            throw new Error("offline");
          },
          report: vi.fn(),
        }),
      ).toBe(code);
    }
  });
  it("sends only status and revision, suppresses mentions, and waits for persistence", async () => {
    const fetcher = vi.fn(async () => ({ ok: true }));
    await notifyDeployment({
      app: "@c-verse/web",
      exitCode: 1,
      revision: "abc123",
      webhookUrl: "https://discord.com/api/webhooks/123/test-token",
      fetcher,
    });
    const [url, request] = fetcher.mock.calls[0];
    expect(url.searchParams.get("wait")).toBe("true");
    const payload = JSON.parse(request.body);
    expect(payload.allowed_mentions).toEqual({ parse: [] });
    expect(payload.embeds[0].title).toContain("gagal");
    expect(request.body).not.toContain("test-token");
  });
  it("does not send to another origin or silently accept an HTTP error", async () => {
    const fetcher = vi.fn(async () => ({ ok: false, status: 429 }));
    await expect(notifyDeployment({ webhookUrl: "https://example.com/api/webhooks/1/secret", fetcher })).rejects.toThrow(
      "Expected a Discord",
    );
    expect(fetcher).not.toHaveBeenCalled();
    await expect(
      notifyDeployment({ webhookUrl: "https://discord.com/api/webhooks/1/secret", app: "api", exitCode: 0, fetcher }),
    ).rejects.toThrow("HTTP 429");
  });
});

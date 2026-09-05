import { describe, expect, it, vi } from "vitest";
import {
  MULTIPART_OVERHEAD_BYTES,
  managedKeyFromPublicUrl,
  parseBoundedImageForm,
  publicAssetUrl,
  serveLocalPublicAsset,
  type UploadRequestError,
  validatePublicImage,
} from "./publicAssets.js";

function ascii(value: string): Uint8Array {
  return Uint8Array.from([...value].map((character) => character.charCodeAt(0)));
}

function png(width = 2, height = 3): Uint8Array {
  const bytes = new Uint8Array(58);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13);
  bytes.set(ascii("IHDR"), 12);
  view.setUint32(16, width);
  view.setUint32(20, height);
  bytes.set([8, 6, 0, 0, 0], 24);
  view.setUint32(33, 1);
  bytes.set(ascii("IDAT"), 37);
  bytes[41] = 0;
  bytes.set(ascii("IEND"), 50);
  return bytes;
}

function jpeg(): Uint8Array {
  return Uint8Array.from([
    0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x03, 0x00, 0x02, 0x01, 0x01, 0x11, 0x00, 0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00,
    0x00, 0x3f, 0x00, 0x00, 0xff, 0xd9,
  ]);
}

function webp(): Uint8Array {
  const bytes = new Uint8Array(26);
  bytes.set(ascii("RIFF"), 0);
  new DataView(bytes.buffer).setUint32(4, 18, true);
  bytes.set(ascii("WEBPVP8L"), 8);
  new DataView(bytes.buffer).setUint32(16, 5, true);
  bytes[20] = 0x2f;
  new DataView(bytes.buffer).setUint32(21, 1 | (2 << 14), true);
  return bytes;
}

describe("public image validation", () => {
  it.each([
    ["image/png", png(), "png", 2, 3],
    ["image/jpeg", jpeg(), "jpg", 2, 3],
    ["image/webp", webp(), "webp", 2, 3],
  ] as const)("accepts structured %s content", async (type, bytes, extension, width, height) => {
    const image = await validatePublicImage(new File([Uint8Array.from(bytes).buffer], `image.${extension}`, { type }), 1024);
    expect(image).toMatchObject({ contentType: type, extension, width, height });
  });

  it("rejects MIME spoofing, truncated structures, SVG, and trailing HTML", async () => {
    await expect(
      validatePublicImage(new File([Uint8Array.from(jpeg()).buffer], "spoof.png", { type: "image/png" }), 1024),
    ).rejects.toThrow();
    await expect(
      validatePublicImage(new File([Uint8Array.from(png().slice(0, 30)).buffer], "short.png", { type: "image/png" }), 1024),
    ).rejects.toThrow();
    await expect(validatePublicImage(new File(["<svg></svg>"], "x.svg", { type: "image/svg+xml" }), 1024)).rejects.toThrow();
    await expect(
      validatePublicImage(new File([Uint8Array.from(png()).buffer, "<html>bad</html>"], "polyglot.png", { type: "image/png" }), 2048),
    ).rejects.toThrow();
  });
});

describe("bounded multipart parser", () => {
  it("parses exactly one file without requiring Content-Length", async () => {
    const form = new FormData();
    form.set("file", new File([Uint8Array.from(png()).buffer], "avatar.png", { type: "image/png" }));
    const request = new Request("http://test/upload", { method: "POST", body: form });
    const file = await parseBoundedImageForm(request, 1024);
    expect(file.name).toBe("avatar.png");
  });

  it("rejects a false Content-Length and enforces the streamed cap", async () => {
    const mismatch = new Request("http://test/upload", {
      method: "POST",
      headers: { "content-type": "multipart/form-data; boundary=x", "content-length": "1" },
      body: new Uint8Array([1, 2, 3]),
    });
    await expect(parseBoundedImageForm(mismatch, 16)).rejects.toMatchObject({ status: 400 });

    const tooLarge = new Request("http://test/upload", {
      method: "POST",
      headers: { "content-type": "multipart/form-data; boundary=x", "content-length": "1" },
      body: new Uint8Array(MULTIPART_OVERHEAD_BYTES + 18),
    });
    await expect(parseBoundedImageForm(tooLarge, 16)).rejects.toEqual(
      expect.objectContaining<Partial<UploadRequestError>>({ status: 413 }),
    );
  });
});

describe("managed public asset ownership", () => {
  const ownerId = "00000000-0000-4000-8000-000000000001";
  const objectId = "11111111-1111-4111-8111-111111111111";
  const env = { ASSETS_PUBLIC_URL: "https://assets.c-verse.co", ENV: "production" };

  it("round-trips only exact-origin, exact-owner managed URLs", () => {
    const key = `profiles/${ownerId}/avatar/${objectId}.png`;
    const url = publicAssetUrl("https://api.c-verse.co", env, key);
    expect(managedKeyFromPublicUrl("https://api.c-verse.co", env, url, { kind: "avatar", ownerId })).toBe(key);
    expect(
      managedKeyFromPublicUrl("https://api.c-verse.co", env, url, {
        kind: "avatar",
        ownerId: "00000000-0000-4000-8000-000000000002",
      }),
    ).toBeNull();
    expect(managedKeyFromPublicUrl("https://api.c-verse.co", env, `https://evil.test/${key}`, { kind: "avatar", ownerId })).toBeNull();
    expect(
      managedKeyFromPublicUrl("https://api.c-verse.co", env, "https://assets.c-verse.co/mock/v1/avatar.png", { kind: "avatar", ownerId }),
    ).toBeNull();
  });

  it("forces the local endpoint in development even when Wrangler inherited the production CDN var", () => {
    const key = `profiles/${ownerId}/avatar/${objectId}.png`;
    expect(publicAssetUrl("http://localhost:8787/api/profile/avatar", { ...env, ENV: "development" }, key)).toBe(
      `http://localhost:8787/api/assets/${key}`,
    );
  });

  it("local serving rejects mock and KYC namespaces", async () => {
    const bucket = {
      get: vi.fn(() => Promise.resolve(null)),
    } as unknown as R2Bucket;
    for (const path of ["mock/v1/avatar.png", `${ownerId}/ktp-secret.png`]) {
      const response = await serveLocalPublicAsset(new Request(`http://localhost:8787/api/assets/${path}`), {
        ASSETS: bucket,
        ENV: "development",
      });
      expect(response?.status).toBe(404);
    }
    expect(bucket.get).not.toHaveBeenCalled();
  });

  it("local serving preserves avatar no-store metadata", async () => {
    const key = `profiles/${ownerId}/avatar/${objectId}.png`;
    const bucket = {
      get: vi.fn(() =>
        Promise.resolve({
          body: new Blob(["image"]).stream(),
          httpEtag: '"etag"',
          writeHttpMetadata: (headers: Headers) => {
            headers.set("content-type", "image/png");
            headers.set("cache-control", "no-store");
          },
        }),
      ),
    } as unknown as R2Bucket;
    const response = await serveLocalPublicAsset(new Request(`http://localhost:8787/api/assets/${key}`), {
      ASSETS: bucket,
      ENV: "development",
    });
    expect(response?.status).toBe(200);
    expect(response?.headers.get("cache-control")).toBe("no-store");
  });
});

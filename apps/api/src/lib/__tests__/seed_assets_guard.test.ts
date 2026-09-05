import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "../../../../..");
const script = join(root, "scripts/seed-assets.mjs");
type Asset = { id: string; kind: string; dropId?: string; seedUrl: string; objectKey: string; bytes: number; sha256: string; url: string };
type ValidateAssetDefinitions = (
  assets: Array<Record<string, unknown>>,
  options: { readAsset(sourcePath: string): Buffer; seededDropIds?: string[] },
) => unknown;
const { validateAssetDefinitions } = (await import(pathToFileURL(script).href)) as { validateAssetDefinitions: ValidateAssetDefinitions };

describe("mock asset delivery contract", () => {
  it("keeps every seed asset outside the web bundle and seeds its verified R2 URL", () => {
    const { assets } = JSON.parse(execFileSync(process.execPath, [script], { encoding: "utf8" })) as {
      assets: Array<{ id: string; file: string; objectKey: string; url: string }>;
    };
    expect(assets.find((asset) => asset.id === "karina")).toMatchObject({
      file: join(root, "supabase/fixtures/artworks/karina.jpg"),
      url: "https://assets.c-verse.co/mock/v1/artworks/karina.jpg",
    });
    expect(existsSync(join(root, "apps/web/public/textures/karina.jpg"))).toBe(false);
    expect(existsSync(join(root, "apps/web/public/mock"))).toBe(false);
    expect(existsSync(join(root, "apps/web/public/placeholder.obj"))).toBe(false);
    for (const asset of assets) {
      expect(asset.file.startsWith(join(root, "supabase/fixtures"))).toBe(true);
      expect(asset.url).toBe(`https://assets.c-verse.co/${asset.objectKey}`);
    }
  });
  it("validates actual image signatures, unique artwork, and every SQL asset reference", () => {
    const { assets } = JSON.parse(execFileSync(process.execPath, [script], { encoding: "utf8" })) as { assets: Asset[] };
    const paths = new Set(assets.map((asset) => asset.seedUrl));
    const atlases = assets.filter((asset) => asset.kind === "atlas");
    expect(assets).toHaveLength(12);
    expect(atlases).toHaveLength(9);
    expect(new Set(assets.map((asset) => asset.id)).size).toBe(assets.length);
    expect(paths.size).toBe(assets.length);
    expect(new Set(assets.map((asset) => asset.objectKey)).size).toBe(assets.length);
    expect(new Set(atlases.map((asset) => asset.dropId)).size).toBe(atlases.length);
    expect(new Set(atlases.map((asset) => asset.sha256)).size).toBe(atlases.length);
    for (const asset of assets) {
      expect(asset.bytes).toBeGreaterThan(0);
      expect(asset.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(asset.objectKey).toMatch(/^mock\/v[0-9]+\//);
      expect(asset.url).toBe(asset.seedUrl);
    }
    const seeds = readdirSync(join(root, "supabase/seeds")).filter((name) => name.endsWith(".sql"));
    expect(seeds.length).toBeGreaterThan(1);
    expect(existsSync(join(root, "supabase/seed.sql")), "legacy seed entrypoint must be retired").toBe(false);
    const sql = seeds
      .map((name) => {
        const content = readFileSync(join(root, "supabase/seeds", name), "utf8");
        expect(content.split(/\r?\n/).length, `${name} physical LOC`).toBeLessThanOrEqual(500);
        return content;
      })
      .join("\n");
    const referenced = [...sql.matchAll(/'((?:\/|https:\/\/)[^']+\.(?:png|jpg|jpeg|webp|obj))'/g)].map((match) => match[1]);
    expect(new Set(referenced)).toEqual(paths);
    const assertions = readFileSync(join(root, "supabase/seeds/30_assertions.sql"), "utf8");
    const allowlist = assertions.match(/approved_asset_paths\s+constant\s+text\[\]\s*:=\s*array\[([\s\S]*?)\];/i)?.[1];
    expect(allowlist, "reset assertions must cover the current asset manifest").toBeDefined();
    expect(new Set([...(allowlist ?? "").matchAll(/'([^']+)'/g)].map((match) => match[1]))).toEqual(paths);
    const seededDropIds = [...sql.matchAll(/\(\s*'((?:drop)-[^']+)'/g)].map((match) => match[1]);
    expect(new Set(atlases.map((asset) => asset.dropId))).toEqual(new Set(seededDropIds));
  });

  it("rejects distinct artwork entries with reused bytes or drop assignments", () => {
    const png = Buffer.from("89504e470d0a1a0a00", "hex");
    const atlas = (id: string, dropId: string, suffix: string) => ({
      id,
      kind: "atlas",
      dropId,
      sourcePath: `supabase/fixtures/artworks/${suffix}.png`,
      seedUrl: `https://assets.example.test/mock/v2/artworks/${suffix}.png`,
      objectKey: `mock/v2/artworks/${suffix}.png`,
      contentType: "image/png",
    });
    const first = atlas("first", "drop-one", "first");
    const second = atlas("second", "drop-two", "second");
    const options = { readAsset: () => png, seededDropIds: ["drop-one", "drop-two"] };

    expect(() => validateAssetDefinitions([first, second], options)).toThrow("Duplicate artwork content");
    expect(() =>
      validateAssetDefinitions([first, { ...second, dropId: "drop-one" }], {
        ...options,
        readAsset: (path) => Buffer.concat([png, Buffer.from(path)]),
      }),
    ).toThrow("Duplicate or missing atlas dropId");
    expect(() => validateAssetDefinitions([first], { ...options, seededDropIds: ["drop-one", "drop-two"] })).toThrow(
      "Every seeded drop must have one distinct artwork atlas",
    );
  });

  it.each([
    ["id", (first: Record<string, unknown>, second: Record<string, unknown>) => ({ ...second, id: first.id })],
    ["seed URL", (first: Record<string, unknown>, second: Record<string, unknown>) => ({ ...second, seedUrl: first.seedUrl })],
    ["object key", (first: Record<string, unknown>, second: Record<string, unknown>) => ({ ...second, objectKey: first.objectKey })],
  ])("rejects a duplicate artwork %s", (_label, duplicate) => {
    const first = {
      id: "first",
      kind: "atlas",
      dropId: "drop-one",
      sourcePath: "supabase/fixtures/artworks/first.png",
      seedUrl: "https://assets.example.test/mock/v2/artworks/first.png",
      objectKey: "mock/v2/artworks/first.png",
      contentType: "image/png",
    };
    const second = {
      ...first,
      id: "second",
      dropId: "drop-two",
      sourcePath: "supabase/fixtures/artworks/second.png",
      seedUrl: "https://assets.example.test/mock/v2/artworks/second.png",
      objectKey: "mock/v2/artworks/second.png",
    };
    expect(() =>
      validateAssetDefinitions([first, duplicate(first, second)], {
        readAsset: (path) => Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), Buffer.from(path)]),
      }),
    ).toThrow("Duplicate");
  });

  it("maps artwork, models and profiles to the same reviewed HTTPS R2 origin without uploading", () => {
    const sql = execFileSync(process.execPath, [script, "--base-url", "https://assets.example.test", "--sql"], { encoding: "utf8" });
    expect(sql).toContain("update public.users set avatar_url = 'https://assets.example.test/mock/v1/avatars/demo.png'");
    expect(sql).toContain("update public.drops set artwork_3d_url = 'https://assets.example.test/mock/v1/models/card.obj'");
    expect(sql).toContain(
      "update public.drops set artwork_url = 'https://assets.example.test/mock/v2/artworks/karina-seraph.png' where id = 'drop-aespa-signed'",
    );
    expect(sql).not.toContain("kyc_records");
    expect(sql).not.toContain("delete ");
    const liveSql = execFileSync(process.execPath, [script, "--base-url", "https://assets.c-verse.co", "--sql"], { encoding: "utf8" });
    expect(liveSql).toContain(
      "update public.drops set artwork_url = 'https://assets.c-verse.co/mock/v2/artworks/karina-seraph.png' where id = 'drop-aespa-signed'",
    );
    expect(liveSql.match(/update public.drops set artwork_url/g)).toHaveLength(9);
    expect(liveSql).toContain("where avatar_url in ('/mock/v1/avatars/demo.png')");
    expect(liveSql).toContain("where artwork_3d_url in ('/placeholder.obj')");
  });

  it.each([
    "http://assets.example.test",
    "https://user:secret@assets.example.test",
    "https://assets.example.test/path",
    "https://assets.example.test/?q=x",
  ])("rejects unsafe or ambiguous base URL %s", (url) => {
    expect(() => execFileSync(process.execPath, [script, "--base-url", url], { stdio: "pipe" })).toThrow();
  });
});

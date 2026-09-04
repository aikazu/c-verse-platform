import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "../../../../..");
const script = join(root, "scripts/seed-assets.mjs");
type Asset = { publicPath: string; objectKey: string; bytes: number; sha256: string; url: string };

describe("mock asset delivery contract", () => {
  it("validates actual image signatures, unique keys and every SQL asset reference", () => {
    const { assets } = JSON.parse(execFileSync(process.execPath, [script], { encoding: "utf8" })) as { assets: Asset[] };
    const paths = new Set(assets.map((asset) => asset.publicPath));
    expect(assets).toHaveLength(6);
    for (const asset of assets) {
      expect(asset.bytes).toBeGreaterThan(0);
      expect(asset.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(asset.objectKey).toMatch(/^mock\/v1\//);
      expect(asset.url).toBe(asset.publicPath);
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
    const referenced = [...sql.matchAll(/'(\/[^']+\.(?:png|jpg|jpeg|webp|obj))'/g)].map((match) => match[1]);
    expect(new Set(referenced)).toEqual(paths);
  });

  it("maps artwork, models and profiles to the same reviewed HTTPS R2 origin without uploading", () => {
    const sql = execFileSync(process.execPath, [script, "--base-url", "https://assets.example.test", "--sql"], { encoding: "utf8" });
    expect(sql).toContain("update public.users set avatar_url = 'https://assets.example.test/mock/v1/avatars/demo.png'");
    expect(sql).toContain("update public.drops set artwork_3d_url = 'https://assets.example.test/mock/v1/models/card.obj'");
    expect(sql).not.toContain("kyc_records");
    expect(sql).not.toContain("delete ");
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

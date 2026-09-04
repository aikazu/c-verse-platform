import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const publicRoot = resolve(root, "apps/web/public");
export const manifest = JSON.parse(readFileSync(resolve(root, "supabase/seed-assets.json"), "utf8"));

export function assetPlan(baseUrl) {
  let base;
  if (baseUrl) {
    base = new URL(baseUrl);
    if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash || base.pathname !== "/") {
      throw new Error("Asset base must be an HTTPS origin without credentials, path, query or fragment.");
    }
  }
  const keys = new Set();
  const paths = new Set();
  return manifest.assets.map((asset) => {
    const { publicPath, objectKey, contentType } = asset;
    if (!/^\/[a-z0-9/_.-]+$/i.test(publicPath) || publicPath.includes("..")) throw new Error("Invalid public asset path.");
    if (!/^mock\/v1\/[a-z0-9/_.-]+$/i.test(objectKey) || objectKey.includes("..")) throw new Error("Invalid mock R2 key.");
    if (keys.has(objectKey) || paths.has(publicPath)) throw new Error("Duplicate asset mapping.");
    keys.add(objectKey);
    paths.add(publicPath);
    const file = resolve(publicRoot, publicPath.slice(1));
    if (!file.startsWith(publicRoot + sep)) throw new Error("Asset escapes public directory.");
    const bytes = readFileSync(file);
    if (!bytes.length) throw new Error(`Empty asset: ${publicPath}`);
    if (contentType === "image/png" && bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") throw new Error("Invalid PNG.");
    if (contentType === "image/jpeg" && bytes.subarray(0, 3).toString("hex") !== "ffd8ff") throw new Error("Invalid JPEG.");
    return {
      id: asset.id,
      kind: asset.kind,
      file,
      publicPath,
      bucket: manifest.bucket,
      objectKey,
      contentType,
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      url: base ? new URL(objectKey, base).href : publicPath,
    };
  });
}

const sqlLiteral = (value) => `'${value.replaceAll("'", "''")}'`;

// An operator reviews this SQL only AFTER upload + HTTP verification. No DB connection here.
export function mappingSql(baseUrl) {
  if (!baseUrl) throw new Error("--sql requires --base-url for a verified asset origin.");
  const updates = assetPlan(baseUrl).map((asset) => {
    const [table, column] =
      asset.kind === "avatar" ? ["users", "avatar_url"] : ["drops", asset.kind === "model" ? "artwork_3d_url" : "artwork_url"];
    return `update public.${table} set ${column} = ${sqlLiteral(asset.url)} where ${column} = ${sqlLiteral(asset.publicPath)};`;
  });
  return ["-- Development fixtures only. Review target DB and verify every uploaded object first.", "begin;", ...updates, "commit;"].join(
    "\n",
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    let baseUrl;
    let sql = false;
    for (let i = 0; i < args.length; i++) {
      if (args[i] === "--base-url" && args[i + 1]) baseUrl = args[++i];
      else if (args[i] === "--sql") sql = true;
      else throw new Error(`Unknown or incomplete option: ${args[i]}`);
    }
    console.log(sql ? mappingSql(baseUrl) : JSON.stringify({ mode: "read-only", assets: assetPlan(baseUrl) }, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Asset validation failed.");
    process.exitCode = 1;
  }
}

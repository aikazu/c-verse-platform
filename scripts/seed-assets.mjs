import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const manifest = JSON.parse(readFileSync(resolve(root, "supabase/seed-assets.json"), "utf8"));

const readSeededDropIds = () => {
  const seedDirectory = resolve(root, "supabase/seeds");
  const ids = readdirSync(seedDirectory)
    .filter((name) => name.endsWith(".sql"))
    .flatMap((name) => {
      const seed = readFileSync(resolve(seedDirectory, name), "utf8");
      const inserts = [...seed.matchAll(/insert\s+into\s+public\.drops\s*\([\s\S]*?\)\s*values\s*([\s\S]*?)on\s+conflict/giu)];
      return inserts.flatMap((insert) => [...insert[1].matchAll(/\(\s*'([^']+)'/gu)].map((match) => match[1]));
    });
  if (!ids.length) throw new Error("Cannot find seeded drop catalog.");
  return ids;
};

export function validateAssetDefinitions(assets, { readAsset, seededDropIds = [] }) {
  const ids = new Set();
  const keys = new Set();
  const paths = new Set();
  const seedUrls = new Set();
  const atlasDropIds = new Set();
  const artworkHashes = new Set();

  const plans = assets.map((asset) => {
    const { id, kind, sourcePath, seedUrl, objectKey, contentType, dropId } = asset;
    if (!id || ids.has(id)) throw new Error("Duplicate or missing asset id.");
    if (!/^supabase\/fixtures\/[a-z0-9/_.-]+$/i.test(sourcePath) || sourcePath.includes("..")) {
      throw new Error("Invalid asset source path.");
    }
    if (!/^mock\/v[0-9]+\/[a-z0-9/_.-]+$/i.test(objectKey) || objectKey.includes("..")) throw new Error("Invalid mock R2 key.");
    if (keys.has(objectKey) || paths.has(sourcePath) || seedUrls.has(seedUrl)) throw new Error("Duplicate asset mapping.");
    if (kind === "atlas") {
      if (!dropId || atlasDropIds.has(dropId)) throw new Error("Duplicate or missing atlas dropId.");
      atlasDropIds.add(dropId);
    } else if (dropId != null) {
      throw new Error("Only artwork atlases may define dropId.");
    }
    ids.add(id);
    keys.add(objectKey);
    paths.add(sourcePath);
    seedUrls.add(seedUrl);

    const bytes = readAsset(sourcePath);
    if (!bytes.length) throw new Error(`Empty asset: ${sourcePath}`);
    if (contentType === "image/png" && bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") throw new Error("Invalid PNG.");
    if (contentType === "image/jpeg" && bytes.subarray(0, 3).toString("hex") !== "ffd8ff") throw new Error("Invalid JPEG.");
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    if (kind === "atlas") {
      if (artworkHashes.has(sha256)) throw new Error("Duplicate artwork content.");
      artworkHashes.add(sha256);
    }
    return { ...asset, bytes, sha256 };
  });

  if (seededDropIds.length) {
    const seeded = new Set(seededDropIds);
    if (
      seeded.size !== seededDropIds.length ||
      seeded.size !== atlasDropIds.size ||
      [...seeded].some((dropId) => !atlasDropIds.has(dropId))
    ) {
      throw new Error("Every seeded drop must have one distinct artwork atlas.");
    }
  }
  return plans;
}

export function assetPlan(baseUrl) {
  let base;
  if (baseUrl) {
    base = new URL(baseUrl);
    if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash || base.pathname !== "/") {
      throw new Error("Asset base must be an HTTPS origin without credentials, path, query or fragment.");
    }
  }
  const assets = validateAssetDefinitions(manifest.assets, {
    readAsset(sourcePath) {
      const file = resolve(root, sourcePath);
      if (!file.startsWith(root + sep)) throw new Error("Asset escapes repository directory.");
      return readFileSync(file);
    },
    seededDropIds: readSeededDropIds(),
  });
  return assets.map((asset) => {
    const { sourcePath, seedUrl, objectKey, contentType } = asset;
    const expectedSeedUrl = new URL(objectKey, manifest.publicBaseUrl).href;
    if (seedUrl !== expectedSeedUrl) throw new Error("Seed URL must match the verified R2 object.");
    const file = resolve(root, sourcePath);
    return {
      id: asset.id,
      kind: asset.kind,
      dropId: asset.dropId,
      file,
      seedUrl,
      legacySeedUrl: asset.legacySeedUrl,
      bucket: manifest.bucket,
      objectKey,
      contentType,
      bytes: asset.bytes.length,
      sha256: asset.sha256,
      url: base ? new URL(objectKey, base).href : seedUrl,
    };
  });
}

const sqlLiteral = (value) => `'${value.replaceAll("'", "''")}'`;

// An operator reviews this SQL only AFTER upload + HTTP verification. No DB connection here.
export function mappingSql(baseUrl) {
  if (!baseUrl) throw new Error("--sql requires --base-url for a verified asset origin.");
  const updates = assetPlan(baseUrl)
    .filter((asset) => asset.kind === "atlas" || asset.url !== asset.seedUrl || asset.legacySeedUrl)
    .map((asset) => {
      if (asset.kind === "atlas") {
        return `update public.drops set artwork_url = ${sqlLiteral(asset.url)} where id = ${sqlLiteral(asset.dropId)};`;
      }
      const [table, column] = asset.kind === "avatar" ? ["users", "avatar_url"] : ["drops", "artwork_3d_url"];
      const previousUrls = [asset.seedUrl, asset.legacySeedUrl].filter((url) => url && url !== asset.url);
      return `update public.${table} set ${column} = ${sqlLiteral(asset.url)} where ${column} in (${previousUrls.map(sqlLiteral).join(", ")});`;
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

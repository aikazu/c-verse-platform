import { PUBLIC_IMAGE_TYPES, type PublicImageType } from "@c-verse/shared";
import type { SupabaseClient } from "@supabase/supabase-js";

export const DEFAULT_ASSETS_PUBLIC_URL = "https://assets.c-verse.co";
export const MULTIPART_OVERHEAD_BYTES = 64 * 1024;

const EXTENSION_BY_TYPE: Record<PublicImageType, "jpg" | "png" | "webp"> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
const PUBLIC_IMAGE_TYPE_SET = new Set<string>(PUBLIC_IMAGE_TYPES);
const MAX_IMAGE_DIMENSION = 16_384;
const MAX_IMAGE_PIXELS = 100_000_000;
const UUID_PATTERN = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const OBJECT_UUID_PATTERN = "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const AVATAR_KEY_RE = new RegExp(`^profiles/(${UUID_PATTERN})/avatar/${OBJECT_UUID_PATTERN}\\.(jpg|png|webp)$`, "i");
const ARTWORK_KEY_RE = new RegExp(`^drops/([A-Za-z0-9_-]{1,64})/artwork/${OBJECT_UUID_PATTERN}\\.(jpg|png|webp)$`, "i");

type OptionalWidenedStrings<T> = { [Key in keyof T]?: T[Key] extends string ? string : T[Key] };
export type PublicAssetBindings = OptionalWidenedStrings<Pick<Env, "ASSETS" | "ASSETS_PUBLIC_URL" | "ENV">>;

export interface ValidatedPublicImage {
  buffer: ArrayBuffer;
  contentType: PublicImageType;
  extension: "jpg" | "png" | "webp";
  width: number;
  height: number;
}

export class UploadRequestError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 413,
  ) {
    super(message);
    this.name = "UploadRequestError";
  }
}

function uint16be(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function uint24le(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function uint16le(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function uint32be(bytes: Uint8Array, offset: number): number {
  return bytes[offset] * 0x1000000 + ((bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]);
}

function uint32le(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
}

function ascii(bytes: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(start, start + length));
}

function validateDimensions(width: number, height: number): { width: number; height: number } {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > MAX_IMAGE_DIMENSION ||
    height > MAX_IMAGE_DIMENSION ||
    width * height > MAX_IMAGE_PIXELS
  ) {
    throw new Error("Dimensi gambar tidak valid atau terlalu besar");
  }
  return { width, height };
}

function validatePng(bytes: Uint8Array): { width: number; height: number } {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 45 || !signature.every((value, index) => bytes[index] === value)) throw new Error("Isi file bukan PNG valid");

  let offset = 8;
  let dimensions: { width: number; height: number } | null = null;
  let sawData = false;
  let sawEnd = false;
  let chunkIndex = 0;
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) throw new Error("Struktur PNG terpotong");
    const length = uint32be(bytes, offset);
    const type = ascii(bytes, offset + 4, 4);
    const next = offset + 12 + length;
    if (!/^[A-Za-z]{4}$/.test(type) || next > bytes.length) throw new Error("Struktur chunk PNG tidak valid");
    if (chunkIndex === 0) {
      if (type !== "IHDR" || length !== 13) throw new Error("PNG tidak memiliki IHDR valid");
      dimensions = validateDimensions(uint32be(bytes, offset + 8), uint32be(bytes, offset + 12));
      const bitDepth = bytes[offset + 16];
      const colourType = bytes[offset + 17];
      const validDepths: Record<number, readonly number[]> = {
        0: [1, 2, 4, 8, 16],
        2: [8, 16],
        3: [1, 2, 4, 8],
        4: [8, 16],
        6: [8, 16],
      };
      if (
        !validDepths[colourType]?.includes(bitDepth) ||
        bytes[offset + 18] !== 0 ||
        bytes[offset + 19] !== 0 ||
        ![0, 1].includes(bytes[offset + 20])
      ) {
        throw new Error("Header PNG tidak valid");
      }
    } else if (type === "IHDR") {
      throw new Error("PNG memiliki IHDR ganda");
    }
    if (type === "IDAT") sawData = true;
    if (type === "IEND") {
      if (length !== 0 || next !== bytes.length) throw new Error("Akhir PNG tidak valid");
      sawEnd = true;
    }
    offset = next;
    chunkIndex += 1;
  }
  if (!dimensions || !sawData || !sawEnd) throw new Error("PNG tidak lengkap");
  return dimensions;
}

const JPEG_SOF_MARKERS = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

function validateJpeg(bytes: Uint8Array): { width: number; height: number } {
  if (bytes.length < 12 || bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error("Isi file bukan JPEG valid");
  let offset = 2;
  let dimensions: { width: number; height: number } | null = null;
  let sawScan = false;
  let sawEnd = false;

  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) throw new Error("Struktur marker JPEG tidak valid");
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) throw new Error("Marker JPEG terpotong");
    const marker = bytes[offset++];
    if (marker === 0xd9) {
      sawEnd = offset === bytes.length;
      break;
    }
    if (marker === 0xd8 || marker === 0x00 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      throw new Error("Urutan marker JPEG tidak valid");
    }
    if (offset + 2 > bytes.length) throw new Error("Segmen JPEG terpotong");
    const segmentLength = uint16be(bytes, offset);
    if (segmentLength < 2 || offset + segmentLength > bytes.length) throw new Error("Panjang segmen JPEG tidak valid");
    if (JPEG_SOF_MARKERS.has(marker)) {
      if (segmentLength < 8) throw new Error("Frame JPEG tidak valid");
      dimensions = validateDimensions(uint16be(bytes, offset + 5), uint16be(bytes, offset + 3));
    }
    offset += segmentLength;
    if (marker === 0xda) {
      sawScan = true;
      while (offset < bytes.length) {
        if (bytes[offset] !== 0xff) {
          offset += 1;
          continue;
        }
        let markerOffset = offset;
        while (markerOffset < bytes.length && bytes[markerOffset] === 0xff) markerOffset += 1;
        if (markerOffset >= bytes.length) throw new Error("Scan JPEG terpotong");
        const scanMarker = bytes[markerOffset];
        if (scanMarker === 0x00 || (scanMarker >= 0xd0 && scanMarker <= 0xd7)) {
          offset = markerOffset + 1;
          continue;
        }
        offset = markerOffset - 1;
        break;
      }
    }
  }
  if (!dimensions || !sawScan || !sawEnd) throw new Error("JPEG tidak lengkap");
  return dimensions;
}

function validateWebp(bytes: Uint8Array): { width: number; height: number } {
  if (bytes.length < 20 || ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 4) !== "WEBP" || uint32le(bytes, 4) + 8 !== bytes.length) {
    throw new Error("Isi file bukan WebP valid");
  }
  let offset = 12;
  let dimensions: { width: number; height: number } | null = null;
  let sawImagePayload = false;
  while (offset < bytes.length) {
    if (offset + 8 > bytes.length) throw new Error("Struktur WebP terpotong");
    const type = ascii(bytes, offset, 4);
    const length = uint32le(bytes, offset + 4);
    const dataOffset = offset + 8;
    const next = dataOffset + length + (length % 2);
    if (!/^[A-Z0-9 ]{4}$/.test(type) || next > bytes.length) throw new Error("Struktur chunk WebP tidak valid");

    if (type === "VP8X") {
      if (length !== 10) throw new Error("Header VP8X tidak valid");
      dimensions = validateDimensions(uint24le(bytes, dataOffset + 4) + 1, uint24le(bytes, dataOffset + 7) + 1);
    } else if (type === "VP8 ") {
      if (length < 10 || bytes[dataOffset + 3] !== 0x9d || bytes[dataOffset + 4] !== 0x01 || bytes[dataOffset + 5] !== 0x2a) {
        throw new Error("Payload VP8 tidak valid");
      }
      dimensions ??= validateDimensions(uint16le(bytes, dataOffset + 6) & 0x3fff, uint16le(bytes, dataOffset + 8) & 0x3fff);
      sawImagePayload = true;
    } else if (type === "VP8L") {
      if (length < 5 || bytes[dataOffset] !== 0x2f) throw new Error("Payload VP8L tidak valid");
      const bits = uint32le(bytes, dataOffset + 1);
      dimensions ??= validateDimensions((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
      sawImagePayload = true;
    } else if (type === "ANMF") {
      if (length < 16) throw new Error("Frame WebP animasi tidak valid");
      sawImagePayload = true;
    }
    offset = next;
  }
  if (offset !== bytes.length || !dimensions || !sawImagePayload) throw new Error("WebP tidak lengkap");
  return dimensions;
}

function imageDimensions(type: PublicImageType, bytes: Uint8Array): { width: number; height: number } {
  if (type === "image/png") return validatePng(bytes);
  if (type === "image/jpeg") return validateJpeg(bytes);
  return validateWebp(bytes);
}

export async function validatePublicImage(file: File, maxBytes: number): Promise<ValidatedPublicImage> {
  if (file.size === 0) throw new Error("File gambar kosong");
  if (file.size > maxBytes) throw new Error(`File gambar maksimal ${Math.floor(maxBytes / 1024 / 1024)} MiB`);
  const declaredType = file.type.toLowerCase();
  if (!PUBLIC_IMAGE_TYPE_SET.has(declaredType)) throw new Error("Format gambar harus JPEG, PNG, atau WebP");

  const contentType = declaredType as PublicImageType;
  const buffer = await file.arrayBuffer();
  const { width, height } = imageDimensions(contentType, new Uint8Array(buffer));
  return { buffer, contentType, extension: EXTENSION_BY_TYPE[contentType], width, height };
}

async function boundedBody(request: Request, maxBytes: number): Promise<ArrayBuffer> {
  const declaredLength = request.headers.get("content-length");
  let expectedLength: number | null = null;
  if (declaredLength !== null) {
    if (!/^\d+$/.test(declaredLength)) throw new UploadRequestError("Content-Length tidak valid", 400);
    expectedLength = Number(declaredLength);
    if (!Number.isSafeInteger(expectedLength)) throw new UploadRequestError("Content-Length tidak valid", 400);
    if (expectedLength > maxBytes) throw new UploadRequestError("Payload upload terlalu besar", 413);
  }
  if (!request.body) throw new UploadRequestError("Form upload tidak memiliki body", 400);

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel("upload body too large").catch(() => undefined);
        throw new UploadRequestError("Payload upload terlalu besar", 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (expectedLength !== null && total !== expectedLength) throw new UploadRequestError("Content-Length tidak sesuai body", 400);

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body.buffer;
}

export async function parseBoundedImageForm(request: Request, maxFileBytes: number): Promise<File> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!/^multipart\/form-data\s*;/i.test(contentType) || !/boundary=/i.test(contentType)) {
    throw new UploadRequestError("Content-Type harus multipart/form-data", 400);
  }
  const body = await boundedBody(request, maxFileBytes + MULTIPART_OVERHEAD_BYTES);
  const formRequest = new Request("http://upload.invalid", { method: "POST", headers: { "content-type": contentType }, body });
  const form = await formRequest.formData().catch(() => null);
  if (!form) throw new UploadRequestError("Form upload tidak valid", 400);
  const files = form.getAll("file");
  if (files.length !== 1 || !(files[0] instanceof File) || [...form.keys()].some((key) => key !== "file")) {
    throw new UploadRequestError("Form upload harus berisi tepat satu field file", 400);
  }
  return files[0];
}

export function buildAvatarObjectKey(userId: string, extension: ValidatedPublicImage["extension"]): string {
  if (!new RegExp(`^${UUID_PATTERN}$`, "i").test(userId)) throw new Error("User ID tidak valid untuk object key");
  return `profiles/${userId.toLowerCase()}/avatar/${crypto.randomUUID()}.${extension}`;
}

export function buildArtworkObjectKey(dropId: string, extension: ValidatedPublicImage["extension"]): string {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(dropId)) throw new Error("Drop ID tidak valid untuk object key");
  return `drops/${dropId}/artwork/${crypto.randomUUID()}.${extension}`;
}

export function isManagedPublicAssetKey(key: string): boolean {
  return AVATAR_KEY_RE.test(key) || ARTWORK_KEY_RE.test(key);
}

function configuredAssetBase(requestUrl: string, env: PublicAssetBindings): URL {
  const requestOrigin = new URL(requestUrl).origin;
  // Wrangler inherits top-level vars in local mode, including the production
  // CDN origin. ENV=development must therefore force the local serving route.
  const raw = env.ENV === "development" ? `${requestOrigin}/api/assets` : env.ASSETS_PUBLIC_URL?.trim() || DEFAULT_ASSETS_PUBLIC_URL;
  const base = new URL(raw);
  const localDev = env.ENV === "development" && ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname);
  if (
    (base.protocol !== "https:" && !(localDev && base.protocol === "http:")) ||
    base.username ||
    base.password ||
    base.search ||
    base.hash
  ) {
    throw new Error("ASSETS_PUBLIC_URL tidak valid");
  }
  base.pathname = base.pathname.replace(/\/+$/, "");
  return base;
}

export function publicAssetUrl(requestUrl: string, env: PublicAssetBindings, key: string): string {
  if (!isManagedPublicAssetKey(key)) throw new Error("Object key public asset tidak valid");
  const base = configuredAssetBase(requestUrl, env);
  return `${base.toString().replace(/\/$/, "")}/${key}`;
}

export function managedKeyFromPublicUrl(
  requestUrl: string,
  env: PublicAssetBindings,
  url: string | null,
  expected: { kind: "avatar"; ownerId: string } | { kind: "artwork"; dropId: string },
): string | null {
  if (!url) return null;
  let parsed: URL;
  let base: URL;
  try {
    parsed = new URL(url);
    base = configuredAssetBase(requestUrl, env);
  } catch {
    return null;
  }
  if (parsed.origin !== base.origin || parsed.username || parsed.password || parsed.search || parsed.hash) return null;
  const prefix = `${base.pathname.replace(/\/$/, "")}/`;
  if (!parsed.pathname.startsWith(prefix)) return null;
  const key = parsed.pathname.slice(prefix.length);
  const match = expected.kind === "avatar" ? AVATAR_KEY_RE.exec(key) : ARTWORK_KEY_RE.exec(key);
  if (!match) return null;
  const owner = match[1];
  if (expected.kind === "avatar" && owner.toLowerCase() !== expected.ownerId.toLowerCase()) return null;
  if (expected.kind === "artwork" && owner !== expected.dropId) return null;
  return key;
}

export type CasUpdateResult = "committed" | "not_committed" | "ambiguous";

async function readCurrentUrl(
  db: SupabaseClient,
  table: string,
  idColumn: string,
  id: string,
  urlColumn: string,
): Promise<string | null | undefined> {
  const { data, error } = await db.from(table).select(urlColumn).eq(idColumn, id).maybeSingle();
  if (error) throw error;
  if (!data || typeof data !== "object") return undefined;
  const value: unknown = Reflect.get(data, urlColumn);
  return value == null ? null : String(value);
}

export async function casUpdatePublicAssetUrl(
  db: SupabaseClient,
  input: {
    table: "users" | "drops";
    idColumn: "id";
    id: string;
    urlColumn: "avatar_url" | "artwork_url";
    previousUrl: string | null;
    newUrl: string | null;
  },
): Promise<CasUpdateResult> {
  let uncertainError: unknown;
  try {
    let update = db
      .from(input.table)
      .update({ [input.urlColumn]: input.newUrl })
      .eq(input.idColumn, input.id);
    update = input.previousUrl === null ? update.is(input.urlColumn, null) : update.eq(input.urlColumn, input.previousUrl);
    const { data, error } = await update.select(input.urlColumn).maybeSingle();
    if (!error && data) return "committed";
    if (!error) return "not_committed";
    const code = typeof error.code === "string" ? error.code : "";
    // Only definite validation/auth/statement rejections are safe to compensate.
    // Connection errors and unknown commit outcomes require readback instead.
    if (/^(22|23|28|42|P0)[0-9A-Z]{3}$/i.test(code)) return "not_committed";
    uncertainError = error;
  } catch (error) {
    // A transport/runtime exception leaves commit outcome unknown. Resolve by
    // readback below; do not compensate the new object until the row is known.
    uncertainError = error;
  }

  try {
    const current = await readCurrentUrl(db, input.table, input.idColumn, input.id, input.urlColumn);
    if (current === input.newUrl) return "committed";
  } catch (error) {
    uncertainError = error;
  }
  console.error(
    JSON.stringify({
      event: "public_asset_db_outcome_ambiguous",
      table: input.table,
      id: input.id,
      newUrl: input.newUrl,
      error: uncertainError instanceof Error ? uncertainError.message : String(uncertainError ?? "unknown"),
    }),
  );
  return "ambiguous";
}

export async function cleanupPublicObject(bucket: R2Bucket, key: string, event: string): Promise<void> {
  try {
    await bucket.delete(key);
  } catch (error) {
    console.error(JSON.stringify({ event, key, error: error instanceof Error ? error.message : String(error) }));
  }
}

export async function serveLocalPublicAsset(request: Request, env: PublicAssetBindings): Promise<Response | null> {
  if (env.ENV !== "development") return null;
  const bucket = env.ASSETS;
  if (!bucket) return Response.json({ error: "Public asset storage belum terkonfigurasi" }, { status: 503 });
  const pathname = new URL(request.url).pathname;
  const prefix = "/api/assets/";
  if (!pathname.startsWith(prefix)) return null;
  const key = pathname.slice(prefix.length);
  if (!isManagedPublicAssetKey(key)) return Response.json({ error: "Not found" }, { status: 404 });
  const object = await bucket.get(key);
  if (!object) return Response.json({ error: "Not found" }, { status: 404 });
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  if (!headers.has("cache-control")) headers.set("cache-control", "public, max-age=31536000, immutable");
  headers.set("x-content-type-options", "nosniff");
  return new Response(object.body, { headers });
}

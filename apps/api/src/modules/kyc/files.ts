export type KycDocumentKind = "ktp" | "selfie" | "npwp";

export interface KycBindings {
  KYC?: R2Bucket;
}

export interface ValidatedKycFile {
  buffer: ArrayBuffer;
  contentType: string;
  extension: string;
}

export const MAX_KYC_FILE_BYTES = 5 * 1024 * 1024;

const ALLOWED_MIME_TYPES: Record<KycDocumentKind, ReadonlySet<string>> = {
  ktp: new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]),
  selfie: new Set(["image/jpeg", "image/png", "image/webp"]),
  npwp: new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]),
};

const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

function detectedMime(bytes: Uint8Array): string | null {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") {
    return "image/webp";
  }
  if (bytes.length >= 5 && String.fromCharCode(...bytes.slice(0, 5)) === "%PDF-") return "application/pdf";
  return null;
}

export async function validateKycFile(kind: KycDocumentKind, file: File): Promise<ValidatedKycFile> {
  if (file.size === 0) throw new Error(`File ${kind.toUpperCase()} kosong`);
  if (file.size > MAX_KYC_FILE_BYTES) throw new Error(`File ${kind.toUpperCase()} maksimal 5 MiB`);

  const declaredType = file.type.toLowerCase();
  if (!ALLOWED_MIME_TYPES[kind].has(declaredType)) {
    throw new Error(`Format file ${kind.toUpperCase()} tidak didukung`);
  }

  const buffer = await file.arrayBuffer();
  const actualType = detectedMime(new Uint8Array(buffer));
  if (!actualType || actualType !== declaredType || !ALLOWED_MIME_TYPES[kind].has(actualType)) {
    throw new Error(`Isi file ${kind.toUpperCase()} tidak sesuai format`);
  }

  return { buffer, contentType: actualType, extension: EXTENSIONS[actualType] };
}

export function buildKycObjectKey(userId: string, kind: KycDocumentKind, extension: string): string {
  return `${userId}/${kind}-${crypto.randomUUID()}.${extension}`;
}

export function isOwnKycObjectKey(key: string, userId: string, kind: KycDocumentKind): boolean {
  return key.startsWith(`${userId}/${kind}-`) && /^[A-Za-z0-9._\-/]+$/.test(key) && !key.includes("..");
}

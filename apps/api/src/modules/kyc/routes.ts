import { Hono } from "hono";
import { z } from "zod";
import { adminGateError, clientIp, requireAdmin, requireUser, tokenFingerprint } from "../../lib/auth.js";
import { getKycById, getKycByUser, listKycRecords, logAuditDb, setKycStatus, upsertKycSubmission } from "../../lib/reads/kyc.js";
import { redactKycForOwner } from "../../lib/redact.js";
import type { KycRecord } from "../../lib/store.js";
import { buildKycObjectKey, isOwnKycObjectKey, type KycBindings, type KycDocumentKind, validateKycFile } from "./files.js";

const app = new Hono<{ Bindings: KycBindings }>();
const documentKindSchema = z.enum(["ktp", "selfie", "npwp"]);
const submissionSchema = z.object({
  fullName: z.string().trim().min(2).max(100),
  nik: z.string().regex(/^\d{16}$/, "NIK harus 16 digit angka"),
  address: z.string().trim().min(10).max(500),
  dob: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && value <= new Date().toISOString().slice(0, 10)),
});

function documentKeys(rec: KycRecord): Record<KycDocumentKind, string | null> {
  return {
    ktp: rec.ktpObjectKey ?? null,
    selfie: rec.selfieObjectKey ?? null,
    npwp: rec.npwpObjectKey ?? null,
  };
}

function adminKycRecord(rec: KycRecord) {
  const { ktpObjectKey: _ktp, npwpObjectKey: _npwp, selfieObjectKey: _selfie, ...safe } = rec;
  return {
    ...safe,
    documents: {
      ktp: Boolean(rec.ktpObjectKey),
      selfie: Boolean(rec.selfieObjectKey),
      npwp: Boolean(rec.npwpObjectKey),
    },
  };
}

async function removeObjects(bucket: R2Bucket, keys: Array<string | null | undefined>): Promise<void> {
  const present = [...new Set(keys.filter((key): key is string => Boolean(key)))];
  if (present.length === 0) return;
  await bucket.delete(present);
}

app.get("/", async (c) => {
  const authRes = await requireUser(c);
  if ("error" in authRes) return c.json({ error: authRes.error === 403 ? "Akun disuspend" : "Unauthorized" }, authRes.error);
  const rec = await getKycByUser(authRes.user.id);
  return c.json({ kyc: rec ? redactKycForOwner(rec) : null });
});

app.post("/", async (c) => {
  const authRes = await requireUser(c);
  if ("error" in authRes) return c.json({ error: authRes.error === 403 ? "Akun disuspend" : "Unauthorized" }, authRes.error);
  const bucket = c.env.KYC;
  if (!bucket) return c.json({ error: "KYC storage belum terkonfigurasi" }, 503);

  const form = await c.req.raw.formData().catch(() => null);
  if (!form) return c.json({ error: "Form KYC tidak valid" }, 400);
  const parsed = submissionSchema.safeParse({
    fullName: form.get("fullName"),
    nik: form.get("nik"),
    address: form.get("address"),
    dob: form.get("dob"),
  });
  if (!parsed.success) return c.json({ error: "Data identitas KYC tidak valid" }, 400);

  const ktp = form.get("ktp");
  const selfie = form.get("selfie");
  const npwp = form.get("npwp");
  if (!(ktp instanceof File) || !(selfie instanceof File) || (npwp != null && !(npwp instanceof File))) {
    return c.json({ error: "Lengkapi foto KTP dan selfie" }, 400);
  }

  const existing = await getKycByUser(authRes.user.id);
  if (existing?.status === "approved") return c.json({ error: "KYC sudah approved" }, 400);

  let validated: Array<{ kind: KycDocumentKind; file: Awaited<ReturnType<typeof validateKycFile>> }>;
  try {
    const required = await Promise.all([validateKycFile("ktp", ktp), validateKycFile("selfie", selfie)]);
    validated = [
      { kind: "ktp", file: required[0] },
      { kind: "selfie", file: required[1] },
    ];
    if (npwp) validated.push({ kind: "npwp", file: await validateKycFile("npwp", npwp) });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "File KYC tidak valid" }, 400);
  }

  const uploads = validated.map(({ kind, file }) => ({
    kind,
    file,
    key: buildKycObjectKey(authRes.user.id, kind, file.extension),
  }));
  const newKeys = uploads.map(({ key }) => key);
  const uploadResults = await Promise.allSettled(
    uploads.map(({ kind, file, key }) =>
      bucket.put(key, file.buffer, {
        httpMetadata: {
          contentType: file.contentType,
          contentDisposition: `inline; filename="${kind}.${file.extension}"`,
          cacheControl: "private, no-store",
        },
        customMetadata: { userId: authRes.user.id, kind },
      }),
    ),
  );
  const failedUpload = uploadResults.find((result): result is PromiseRejectedResult => result.status === "rejected");
  if (failedUpload) {
    await removeObjects(bucket, newKeys).catch((cleanupError) => console.error("kyc_upload_cleanup_failed", cleanupError));
    throw failedUpload.reason;
  }

  const keyFor = (kind: KycDocumentKind) => uploads.find((upload) => upload.kind === kind)?.key;
  let rec: KycRecord;
  try {
    rec = await upsertKycSubmission(authRes.user.id, existing, {
      ...parsed.data,
      ktpObjectKey: keyFor("ktp") as string,
      selfieObjectKey: keyFor("selfie") as string,
      npwpObjectKey: keyFor("npwp"),
    });
  } catch (error) {
    await removeObjects(bucket, newKeys).catch((cleanupError) => console.error("kyc_db_cleanup_failed", cleanupError));
    throw error;
  }

  if (existing) {
    await removeObjects(bucket, Object.values(documentKeys(existing))).catch((error) =>
      console.error("kyc_old_objects_cleanup_failed", error),
    );
  }
  return c.json({ kyc: redactKycForOwner(rec) }, 201);
});

app.get("/admin/:id/files/:kind", async (c) => {
  const authRes = await requireAdmin(c);
  if ("error" in authRes) {
    const error = adminGateError(authRes);
    return c.json(error.body, error.status);
  }
  const kind = documentKindSchema.safeParse(c.req.param("kind"));
  if (!kind.success) return c.json({ error: "Jenis dokumen KYC tidak valid" }, 400);
  const bucket = c.env.KYC;
  if (!bucket) return c.json({ error: "KYC storage belum terkonfigurasi" }, 503);

  const rec = await getKycById(c.req.param("id"));
  if (!rec) return c.json({ error: "Not found" }, 404);
  const key = documentKeys(rec)[kind.data];
  if (!key || !isOwnKycObjectKey(key, rec.userId, kind.data)) return c.json({ error: "Dokumen KYC tidak tersedia" }, 404);
  const object = await bucket.get(key);
  if (!object) return c.json({ error: "Dokumen KYC tidak tersedia" }, 404);

  await logAuditDb(
    authRes.user.id,
    "view_sensitive",
    "kyc_records",
    rec.id,
    { document: kind.data },
    clientIp(c),
    await tokenFingerprint(c.req.header("authorization")),
  );
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("Cache-Control", "private, no-store");
  headers.set("Content-Disposition", headers.get("Content-Disposition") ?? `inline; filename="${kind.data}"`);
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(object.body, { headers });
});

app.post("/:id/approve", async (c) => {
  const authRes = await requireAdmin(c);
  if ("error" in authRes) {
    const error = adminGateError(authRes);
    return c.json(error.body, error.status);
  }
  const bucket = c.env.KYC;
  if (!bucket) return c.json({ error: "KYC storage belum terkonfigurasi" }, 503);
  const current = await getKycById(c.req.param("id"));
  if (!current) return c.json({ error: "Not found" }, 404);
  const requiredKeys = [current.ktpObjectKey, current.selfieObjectKey];
  if (
    !current.ktpObjectKey ||
    !current.selfieObjectKey ||
    !isOwnKycObjectKey(current.ktpObjectKey, current.userId, "ktp") ||
    !isOwnKycObjectKey(current.selfieObjectKey, current.userId, "selfie")
  ) {
    return c.json({ error: "Dokumen KTP dan selfie wajib tersedia sebelum approval" }, 409);
  }
  const objects = await Promise.all(requiredKeys.map((key) => bucket.head(key as string)));
  if (objects.some((object) => object == null)) {
    return c.json({ error: "Dokumen KTP dan selfie wajib tersedia sebelum approval" }, 409);
  }

  const rec = await setKycStatus(c.req.param("id"), "approved");
  if (!rec) return c.json({ error: "Not found" }, 404);
  await logAuditDb(
    authRes.user.id,
    "update",
    "kyc_records",
    c.req.param("id"),
    { status: "approved" },
    clientIp(c),
    await tokenFingerprint(c.req.header("authorization")),
  );
  return c.json({ kyc: adminKycRecord(rec) });
});

app.post("/:id/reject", async (c) => {
  const authRes = await requireAdmin(c);
  if ("error" in authRes) {
    const error = adminGateError(authRes);
    return c.json(error.body, error.status);
  }
  const rejectSchema = z.object({ reason: z.string().trim().min(3).max(1000) });
  const rawBody: unknown = await c.req.json().catch(() => ({}));
  const parsed = rejectSchema.safeParse(rawBody);
  if (!parsed.success) {
    const isTooLong = parsed.error.issues.some((issue) => issue.code === "too_big");
    return c.json(
      { error: isTooLong ? "Alasan penolakan tidak valid (maks. 1000 karakter)" : "Alasan penolakan wajib diisi (min 3 karakter)" },
      400,
    );
  }
  const rec = await setKycStatus(c.req.param("id"), "rejected");
  if (!rec) return c.json({ error: "Not found" }, 404);
  await logAuditDb(
    authRes.user.id,
    "update",
    "kyc_records",
    c.req.param("id"),
    { status: "rejected", reason: parsed.data.reason },
    clientIp(c),
    await tokenFingerprint(c.req.header("authorization")),
  );
  return c.json({ kyc: adminKycRecord(rec) });
});

app.get("/admin/all", async (c) => {
  const authRes = await requireAdmin(c);
  if ("error" in authRes) {
    const error = adminGateError(authRes);
    return c.json(error.body, error.status);
  }
  const records = await listKycRecords();
  return c.json({ kyc: records.map(adminKycRecord) });
});

export default app;

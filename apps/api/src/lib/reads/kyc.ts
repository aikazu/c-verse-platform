import { mapKycRow, readDb } from "../reads.js";
import type { KycRecord } from "../store.js";
import { nowIso, uid } from "../store.js";

// Domain reads/writes: KYC (docs/13 §3 Wave 5). Writes di sini adalah tabel
// non-uang (kyc_records / user_badges / admin_audit_log) — no RPC needed.

export async function getKycByUser(userId: string): Promise<KycRecord | null> {
  const db = readDb();
  const { data, error } = await db.from("kyc_records").select("*").eq("user_id", userId).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapKycRow(data as Record<string, unknown>) : null;
}

export async function getKycById(id: string): Promise<KycRecord | null> {
  const db = readDb();
  const { data, error } = await db.from("kyc_records").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapKycRow(data as Record<string, unknown>) : null;
}

export async function listKycRecords(): Promise<KycRecord[]> {
  const db = readDb();
  const { data, error } = await db.from("kyc_records").select("*").order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => mapKycRow(r as Record<string, unknown>));
}

export interface KycSubmissionInput {
  fullName: string;
  nik: string;
  address: string;
  dob?: string;
  ktpObjectKey: string;
  npwpObjectKey?: string;
  selfieObjectKey: string;
}

/** Insert or resubmit (pending) a KYC record — unique per user (DB: upsert on user_id). */
export async function upsertKycSubmission(userId: string, existing: KycRecord | null, input: KycSubmissionInput): Promise<KycRecord> {
  const now = nowIso();
  const rec: KycRecord = {
    id: existing?.id ?? uid("kyc-"),
    userId,
    fullName: input.fullName,
    nik: input.nik,
    address: input.address,
    status: "pending",
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    dob: input.dob ?? null,
    ktpObjectKey: input.ktpObjectKey,
    npwpObjectKey: input.npwpObjectKey ?? null,
    selfieObjectKey: input.selfieObjectKey,
  };
  const db = readDb();
  const { error } = await db.from("kyc_records").upsert(
    {
      id: rec.id,
      user_id: userId,
      full_name: input.fullName,
      nik: input.nik,
      address: input.address,
      status: "pending",
      dob: input.dob ?? null,
      ktp_object_key: input.ktpObjectKey,
      npwp_object_key: input.npwpObjectKey ?? null,
      selfie_object_key: input.selfieObjectKey,
    },
    { onConflict: "user_id" },
  );
  if (error) throw new Error(error.message);
  return rec;
}

/** Admin status transition. Returns null when the record does not exist. */
export async function setKycStatus(id: string, status: "approved" | "rejected"): Promise<KycRecord | null> {
  const db = readDb();
  const { data, error } = await db.from("kyc_records").update({ status }).eq("id", id).select().maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapKycRow(data as Record<string, unknown>) : null;
}

// Pentest F3 (2026-08-30): admin_audit_log.admin_user_id is `uuid not null`
// (supabase/migrations/01_schema.sql), so the reserved actor "system" — passed
// by the NFC/payments fraud-rejection call sites (nfc/routes.ts:130,143,158,173;
// payments/routes.ts:236) — must map to the canonical treasury/system user
// UUID (04_rpc.sql record_platform_revenue v_treasury). Any other non-uuid
// value still fails loudly (fail-loud audit integrity is preserved).
export const SYSTEM_ACTOR_ID = "00000000-0000-4000-8000-0000000000c0";

/** Audit trail: append-only insert ke admin_audit_log. */
export async function logAuditDb(
  adminUserId: string,
  action: string,
  targetTable: string,
  targetId: string | null,
  payloadSummary: Record<string, unknown> | null,
  ip: string | null,
  sessionId: string | null,
): Promise<void> {
  const db = readDb();
  const { error } = await db.from("admin_audit_log").insert({
    id: uid("audit-"),
    admin_user_id: adminUserId === "system" ? SYSTEM_ACTOR_ID : adminUserId,
    action,
    target_table: targetTable,
    target_id: targetId,
    payload_summary: payloadSummary,
    ip,
    session_id: sessionId,
  });
  if (error) throw new Error(error.message);
}

// Badge award + XP ada di SQL trigger badge_on_kyc (idempotent, sekali per user) —
// path JS dihapus 2026-08-16 (pernah menyebabkan double XP saat approve KYC).

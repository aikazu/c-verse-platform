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
  };
  const db = readDb();
  const { error } = await db
    .from("kyc_records")
    .upsert(
      { id: rec.id, user_id: userId, full_name: input.fullName, nik: input.nik, address: input.address, status: "pending" },
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
    admin_user_id: adminUserId,
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

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

/**
 * Award a badge once: skip if already owned, insert user_badges with xp snapshot,
 * then add the badge XP reward to users.total_xp and recompute level. Resolves
 * the badge def by id OR code so seed ids ("b6") and DB codes ("verified") both work.
 */
export async function awardBadgeIfNeededDb(userId: string, badgeIdOrCode: string): Promise<boolean> {
  const db = readDb();
  const { data: def, error: defError } = await db
    .from("badges")
    .select("id, xp_reward, xp, is_active")
    .or(`id.eq.${badgeIdOrCode},code.eq.${badgeIdOrCode}`)
    .maybeSingle();
  if (defError) throw new Error(defError.message);
  if (!def || def.is_active === false) return false;

  const { data: owner, error: ownerError } = await db.from("users").select("id, total_xp, xp").eq("id", userId).maybeSingle();
  if (ownerError) throw new Error(ownerError.message);
  if (!owner) return false;

  const { data: owned, error: ownedError } = await db
    .from("user_badges")
    .select("badge_id")
    .eq("user_id", userId)
    .eq("badge_id", String(def.id))
    .maybeSingle();
  if (ownedError) throw new Error(ownedError.message);
  if (owned) return false;

  const reward = Number(def.xp_reward ?? def.xp ?? 0);
  const { error: insertError } = await db.from("user_badges").insert({
    user_id: userId,
    badge_id: String(def.id),
    earned_at: nowIso(),
    awarded_at: nowIso(),
    xp_reward_snapshot: reward,
  });
  if (insertError) throw new Error(insertError.message);

  if (reward > 0) {
    const newTotalXp = Number(owner.total_xp ?? owner.xp ?? 0) + reward;
    const { error: xpError } = await db
      .from("users")
      .update({ total_xp: newTotalXp, xp: newTotalXp, level: Math.max(1, Math.floor(newTotalXp / 10) + 1) })
      .eq("id", userId);
    if (xpError) throw new Error(xpError.message);
  }
  return true;
}

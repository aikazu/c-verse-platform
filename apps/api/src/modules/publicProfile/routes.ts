import { zValidator } from "@hono/zod-validator";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Hono } from "hono";
import { z } from "zod";
import { authHeaderToToken, requireUser, verifySupabaseJwt } from "../../lib/auth.js";
import { userDb } from "../../lib/db.js";
import { sanitizeDbError } from "../../lib/errors.js";
import { listCards, listDrops } from "../../lib/reads/drops.js";
import { getUserByUsernameOrId, getUserRank, listUserBadges } from "../../lib/reads/profiles.js";
import type { Drop } from "../../lib/store.js";

const app = new Hono();

// ── Creator page-view analytics (docs 09 §2.8 + §3.5) ─────────────────────
// RPCs land in supabase/migrations/04_rpc.sql: record_creator_page_view is a
// SECURITY DEFINER silent no-op for unknown/suspended/anonymous/non-creator
// usernames; get_creator_page_stats is owner-fenced (AUTH_REQUIRED/FORBIDDEN).
// The beacon must never disturb the page — but the API keeps honest status codes.

function getEnv(name: string): string | undefined {
  const g = globalThis as unknown as Record<string, string | undefined>;
  const processEnv =
    typeof process !== "undefined" ? (process as unknown as Record<string, Record<string, string | undefined> | undefined>).env : undefined;
  return g[name] ?? processEnv?.[name];
}

/** Host-only extraction (strip scheme/path/query/port), lowercased for stable grouping. */
export function referrerHostFromHeader(referer: string | undefined): string | null {
  if (!referer) return null;
  try {
    const host = new URL(referer).hostname.toLowerCase();
    return host.length > 0 ? host : null;
  } catch {
    return null;
  }
}

/** Coarse city from the Workers runtime prop — never from the client body. */
function coarseCityFromRequest(raw: Request): string | null {
  const city = (raw as unknown as { cf?: { city?: string } }).cf?.city?.trim();
  return city ? city : null;
}

/**
 * Page-view client: a valid user JWT is forwarded so the RPC sees auth.uid()
 * as viewer_id; invalid/stale tokens read as anonymous (parity with
 * getOptionalUser) so a beacon never fails on auth. Anon uses the project
 * anon key (writes go through the SECURITY DEFINER RPC only — direct table
 * INSERT is RLS-denied for anon/authenticated).
 */
async function viewerDb(c: { req: { header: (k: string) => string | undefined } }): Promise<SupabaseClient> {
  const token = authHeaderToToken(c.req.header("authorization"));
  if (token && (await verifySupabaseJwt(token))) return userDb(token);
  return userDb(getEnv("SUPABASE_ANON_KEY") ?? "");
}

const usernameParamSchema = z.object({ username: z.string().min(1).max(100) });
const statsQuerySchema = z.object({ days: z.coerce.number().int().min(1).max(365).optional() });

/** Raw jsonb shape returned by get_creator_page_stats. */
interface CreatorPageStatsRaw {
  days?: unknown;
  total?: unknown;
  distinct_viewers?: unknown;
  daily?: unknown;
  top_referrers?: unknown;
}

function toCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** snake_case jsonb -> camelCase payload, defensively tolerant of null/short shapes. */
export function mapCreatorPageStats(data: unknown): {
  days: number;
  total: number;
  distinctViewers: number;
  daily: Array<{ day: string; views: number; distinctViewers: number }>;
  topReferrers: Array<{ referrerHost: string | null; views: number }>;
} {
  const raw = (typeof data === "object" && data !== null ? data : {}) as CreatorPageStatsRaw;
  const daily = Array.isArray(raw.daily) ? (raw.daily as Array<Record<string, unknown>>) : [];
  const topReferrers = Array.isArray(raw.top_referrers) ? (raw.top_referrers as Array<Record<string, unknown>>) : [];
  return {
    days: toCount(raw.days),
    total: toCount(raw.total),
    distinctViewers: toCount(raw.distinct_viewers),
    daily: daily.map((d) => ({ day: String(d.day ?? ""), views: toCount(d.views), distinctViewers: toCount(d.distinct_viewers) })),
    topReferrers: topReferrers.map((r) => ({
      referrerHost: typeof r.referrer_host === "string" ? r.referrer_host : null,
      views: toCount(r.views),
    })),
  };
}

// POST /:username/view — invisible page-view beacon for /c/:username. Anonymous
// allowed; referrer_host + city are derived SERVER-SIDE (Referer header + cf
// prop), a client-supplied body is never trusted.
app.post("/:username/view", zValidator("param", usernameParamSchema), async (c) => {
  const { username } = c.req.valid("param");
  const db = await viewerDb(c);
  const { error } = await db.rpc("record_creator_page_view", {
    p_username: username,
    p_referrer_host: referrerHostFromHeader(c.req.header("referer")),
    p_city: coarseCityFromRequest(c.req.raw),
  });
  if (error) {
    console.error("[publicProfile] record_creator_page_view failed:", error.message);
    return c.json({ error: sanitizeDbError(error) }, 500);
  }
  return c.body(null, 204);
});

// GET /:username/views/stats — creator-only page-view stats. requireUser is
// the first fence; the RPC's AUTH_REQUIRED/FORBIDDEN (caller must own the
// creators row) is the second. UI-less for now (docs 09: dashboard later sprint)
// so the RPC stays verifiable after the owner's `db reset --linked`.
app.get("/:username/views/stats", zValidator("param", usernameParamSchema), zValidator("query", statsQuerySchema), async (c) => {
  const authRes = await requireUser(c);
  if ("error" in authRes) return c.json({ error: authRes.error === 403 ? "Akun disuspend" : "Unauthorized" }, authRes.error);
  const { days } = c.req.valid("query");
  const db = userDb(authRes.token);
  const { data, error } = await db.rpc("get_creator_page_stats", { p_days: days ?? 30 });
  if (error) {
    const code = error.message.trim().split("\n")[0];
    if (code === "AUTH_REQUIRED") return c.json({ error: "Silakan login dulu" }, 401);
    if (code === "FORBIDDEN") return c.json({ error: "Tidak diizinkan" }, 403);
    console.error("[publicProfile] get_creator_page_stats failed:", error.message);
    return c.json({ error: sanitizeDbError(error) }, 500);
  }
  c.header("Cache-Control", "private, no-store");
  return c.json({ stats: mapCreatorPageStats(data) });
});

// GET /u/:username — public collector profile (koleksi/level/badge/ranking) — hidden if isAnonymous
app.get("/u/:username", async (c) => {
  const raw = c.req.param("username");
  const user = await getUserByUsernameOrId(raw);
  if (!user) return c.json({ error: "User tidak ditemukan" }, 404);
  if (user.flagReason) return c.json({ error: "User tidak ditemukan" }, 404); // suspended: profil disembunyikan
  if (user.isAnonymous) {
    return c.json({
      user: { id: user.id, displayName: user.displayName, username: user.username ?? null, isAnonymous: true },
      hidden: true,
    });
  }
  const totalXp = user.totalXp ?? 0;
  const { calcLevel } = await import("@c-verse/shared");
  const { level, tier } = calcLevel(totalXp);
  const progressInLevel = totalXp % 10;
  const levelProgressPct = Math.round((progressInLevel / 10) * 100);
  const [drops, myCards, badges, rank] = await Promise.all([
    listDrops(),
    listCards({ ownerId: user.id }),
    listUserBadges(user.id),
    getUserRank(totalXp),
  ]);
  const dropById = new Map<string, Drop>(drops.map((d) => [d.id, d]));
  const cards = myCards.map((ca) => {
    const drop = dropById.get(ca.dropId);
    return { ...ca, drop: drop ? { id: drop.id, title: drop.title, series: drop.series } : null };
  });
  return c.json({
    user: {
      id: user.id,
      displayName: user.displayName,
      username: user.username ?? null,
      level,
      tier,
      levelProgressPct,
      rank,
    },
    cards,
    badges,
    stats: { totalCards: cards.length },
  });
});

export default app;

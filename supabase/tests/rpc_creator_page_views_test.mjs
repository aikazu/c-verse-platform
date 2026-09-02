// C.Verse — creator_page_views analytics foundation (docs/09 §2.8 + §3.5).
// Run against a disposable Supabase:
//   node supabase/tests/rpc_creator_page_views_test.mjs postgresql://postgres:postgres@127.0.0.1:54322/postgres
// Scenarios:
//   V1: anon record_creator_page_view           -> row inserted, viewer null
//   V2: authenticated viewer records view       -> row with viewer user_id
//   V3: suspended (flag_reason) username        -> silent no-op
//   V4: unknown username                        -> silent no-op
//   V5: get_creator_page_stats as anon          -> AUTH_REQUIRED
//   V6: get_creator_page_stats as non-creator   -> FORBIDDEN
//   V7: get_creator_page_stats as owner         -> correct total/distinct/daily/referrers
//   V8: RLS owner-only SELECT                   -> creator sees own rows only
import pgModule from "../../apps/api/node_modules/pg/lib/index.js";

const { Client } = pgModule;

const url = process.argv[2] ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const results = [];
function report(id, pass, detail) {
  results.push({ id, pass });
  console.log(`${id} ${pass ? "PASS" : "FAIL"}${detail ? ` (${detail})` : ""}`);
}

function errCode(e) {
  return String(e.message).trim().split("\n")[0];
}

const admin = new Client({ connectionString: url });
await admin.connect();
await admin.query("set role service_role");

// ── Fixture ─────────────────────────────────────────────────────────────────
const stamp = Date.now().toString(36);
const creatorA = { id: "c3000000-0000-4000-8000-000000000001", username: `pva-${stamp}`, email: `pva-${stamp}@race.test` };
const creatorB = { id: "c3000000-0000-4000-8000-000000000002", username: `pvb-${stamp}`, email: `pvb-${stamp}@race.test` };
const suspended = { id: "c3000000-0000-4000-8000-000000000003", username: `pvs-${stamp}`, email: `pvs-${stamp}@race.test` };
const viewer = { id: "c3000000-0000-4000-8000-000000000004", email: `pvv-${stamp}@race.test` };
const allUsers = [creatorA, creatorB, suspended, viewer].map((u) => u.id);

await admin.query("begin");
for (const u of [creatorA, creatorB, suspended, viewer]) {
  // Upsert (bukan do nothing): notification_email_queue_test memakai UUID
  // c3000000-... yang sama TANPA cleanup — tanpa upsert, username fixture
  // hilang dan record_creator_page_view gagal resolve (silent no-op).
  await admin.query(
    `insert into public.users (id, email, display_name, username, flag_reason) values ($1, $2, 'PV', $3, $4)
     on conflict (id) do update set email = excluded.email, username = excluded.username,
       display_name = excluded.display_name, flag_reason = excluded.flag_reason, is_anonymous = false`,
    [u.id, u.email, u.username ?? null, u === suspended ? "test_suspended" : null],
  );
}
await admin.query("insert into public.creators (id, handle, user_id, status) values ($1, $2, $3, 'active'), ($4, $5, $6, 'active')", [
  `cr-pva-${stamp}`,
  `pva-${stamp}`,
  creatorA.id,
  `cr-pvb-${stamp}`,
  `pvb-${stamp}`,
  creatorB.id,
]);
await admin.query("commit");

async function asRole(role, userId, fn) {
  const conn = await new Client({ connectionString: url }).connect();
  const client = conn.client ?? conn;
  await client.query(`set role ${role}`);
  if (userId) {
    await client.query(`set request.jwt.claims to '{"sub":"${userId}","role":"${role}"}'`);
  }
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

// ── V1: anon records a view -> inserted with null viewer ────────────────────
{
  await asRole("anon", null, (c) =>
    c.query("select public.record_creator_page_view($1, $2, $3)", [creatorA.username, "google.example", "Jakarta"]),
  );
  const { rows } = await admin.query("select user_id, referrer, city from public.creator_page_views where creator_id = $1", [
    `cr-pva-${stamp}`,
  ]);
  const ok = rows.length === 1 && rows[0].user_id === null && rows[0].referrer === "google.example" && rows[0].city === "Jakarta";
  report("V1", ok, JSON.stringify(rows));
}

// ── V2: authenticated viewer records a view -> viewer attributed ────────────
{
  await asRole("authenticated", viewer.id, (c) =>
    c.query("select public.record_creator_page_view($1, $2, $3)", [creatorA.username, "x.example", null]),
  );
  const { rows } = await admin.query("select user_id from public.creator_page_views where creator_id = $1 and user_id = $2", [
    `cr-pva-${stamp}`,
    viewer.id,
  ]);
  report("V2", rows.length === 1, `count=${rows.length}`);
}

// ── V3: suspended username -> silent no-op ──────────────────────────────────
{
  const before = (await admin.query("select count(*)::int as n from public.creator_page_views")).rows[0].n;
  await asRole("anon", null, (c) => c.query("select public.record_creator_page_view($1, null, null)", [suspended.username]));
  const after = (await admin.query("select count(*)::int as n from public.creator_page_views")).rows[0].n;
  report("V3", before === after, `before=${before} after=${after}`);
}

// ── V4: unknown username -> silent no-op ────────────────────────────────────
{
  const before = (await admin.query("select count(*)::int as n from public.creator_page_views")).rows[0].n;
  await asRole("anon", null, (c) => c.query("select public.record_creator_page_view($1, null, null)", [`ghost-${stamp}`]));
  const after = (await admin.query("select count(*)::int as n from public.creator_page_views")).rows[0].n;
  report("V4", before === after, `before=${before} after=${after}`);
}

// ── V5: stats without identity (authenticated, no JWT claims) -> AUTH_REQUIRED
// (EXECUTE is revoked from anon by design — an anon call fails with plain
// "permission denied" before the in-body guard; the guard is the second fence.)
{
  const err = await asRole("authenticated", null, (c) =>
    c.query("select public.get_creator_page_stats(30)").then(
      () => null,
      (e) => e,
    ),
  );
  const code = err ? errCode(err) : "no-error";
  report("V5", code === "AUTH_REQUIRED", code);
}

// ── V6: stats as authenticated non-creator -> FORBIDDEN ─────────────────────
{
  const err = await asRole("authenticated", viewer.id, (c) =>
    c.query("select public.get_creator_page_stats(30)").then(
      () => null,
      (e) => e,
    ),
  );
  const code = err ? errCode(err) : "no-error";
  report("V6", code === "FORBIDDEN", code);
}

// ── V7: stats as owner -> correct aggregates (2 anon + 1 logged view) ───────
{
  // Third view for creatorA: another anon hit with the same referrer.
  await asRole("anon", null, (c) => c.query("select public.record_creator_page_view($1, $2, null)", [creatorA.username, "google.example"]));
  // One view for creatorB (must NOT leak into creatorA's stats).
  await asRole("anon", null, (c) => c.query("select public.record_creator_page_view($1, null, null)", [creatorB.username]));

  const { rows } = await asRole("authenticated", creatorA.id, (c) => c.query("select public.get_creator_page_stats(30) as stats"));
  const stats = rows[0].stats;
  const ok =
    stats.total === 3 &&
    stats.distinct_viewers === 1 &&
    Array.isArray(stats.daily) &&
    stats.daily.length >= 1 &&
    stats.daily[0].views === 3 &&
    stats.top_referrers.length === 2 &&
    stats.top_referrers[0].referrer_host === "google.example" &&
    stats.top_referrers[0].views === 2 &&
    stats.top_referrers[1].referrer_host === "x.example" &&
    stats.top_referrers[1].views === 1;
  report("V7", ok, JSON.stringify(stats));
}

// ── V8: RLS owner-only SELECT (authenticated sees own creator rows only) ────
{
  const ownCount = (await asRole("authenticated", creatorA.id, (c) => c.query("select count(*)::int as n from public.creator_page_views")))
    .rows[0].n;
  const otherCount = (await asRole("authenticated", viewer.id, (c) => c.query("select count(*)::int as n from public.creator_page_views")))
    .rows[0].n;
  report("V8", ownCount === 3 && otherCount === 0, `own=${ownCount} other=${otherCount}`);
}

// ── Cleanup ─────────────────────────────────────────────────────────────────
await admin.query("set role postgres");
await admin.query("begin");
await admin.query("delete from public.creator_page_views where creator_id in ($1, $2)", [`cr-pva-${stamp}`, `cr-pvb-${stamp}`]);
await admin.query("delete from public.creators where id in ($1, $2)", [`cr-pva-${stamp}`, `cr-pvb-${stamp}`]);
await admin.query("delete from public.wallets where user_id = any($1)", [allUsers]);
await admin.query("delete from public.users where id = any($1)", [allUsers]);
await admin.query("commit");
console.log("CLEANUP OK");
await admin.end();

const failed = results.filter((r) => !r.pass).length;
if (failed > 0) process.exit(1);

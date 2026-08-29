// C.Verse — C-13 creator self-dealing block via bid path (docs/07 C-13 FINAL,
// parity with buyout_card guard replicated into place_bid).
// Run against a disposable Supabase:
//   node supabase/tests/rpc_c13_bid_test.mjs postgresql://postgres:postgres@127.0.0.1:54322/postgres
// Scenarios (one card per scenario, drop creator = bidder):
//   C1: creator bids own drop card (drop started 1h ago)            -> CREATOR_SELF_DEALING_30D (family 1: drop started)
//   C2: creator bids own drop card (drop started 31d ago)           -> ok (family 1 outside window)
//   C3: seed creator bids seed card (creator held it 10d ago)       -> CREATOR_SELF_DEALING_30D (family 2: holder history)
//   C4: seed creator bids seed card (creator held it 31d ago)       -> ok (family 2 outside window)
//   C5: seed creator bids seed card (no history, card 10d old)      -> CREATOR_SELF_DEALING_30D (family 3: card created_at)
//   C6: seed creator bids seed card (no history, card 31d old)      -> ok (family 3 outside window)
//   C7: non-creator bids a seed card of someone else's drop         -> ok (no over-blocking)
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
// Users 1..6 = drop creators (one per scenario drop), user 7 = card owner,
// user 8 = unrelated bidder (control). Each creator gets exactly one active
// bid max -> never trips the 3-active-bids BID_LIMIT.
const stamp = Date.now().toString(36);
const creatorIds = [1, 2, 3, 4, 5, 6].map((i) => `c2000000-0000-4000-8000-00000000000${i}`);
const ownerId = "c2000000-0000-4000-8000-000000000007";
const freshUserId = "c2000000-0000-4000-8000-000000000008";
const allUsers = [...creatorIds, ownerId, freshUserId];

const drops = [
  { n: 1, isSeed: false, startAt: "1 hour" }, // C1 family 1 inside window
  { n: 2, isSeed: false, startAt: "31 days" }, // C2 family 1 outside window
  { n: 3, isSeed: true, startAt: "31 days" }, // C3 family 2 inside window
  { n: 4, isSeed: true, startAt: "31 days" }, // C4 family 2 outside window
  { n: 5, isSeed: true, startAt: "31 days" }, // C5 family 3 inside window
  { n: 6, isSeed: true, startAt: "31 days" }, // C6 family 3 outside window
].map((d) => ({ ...d, id: `c13-drop-${stamp}-${d.n}` }));

const cards = drops.map((d) => ({
  drop: d,
  id: `c13-card-${stamp}-${d.n}`,
  createdAt: d.n === 5 ? "10 days" : d.n === 6 ? "31 days" : null,
}));

await admin.query("begin");
for (const id of allUsers) {
  await admin.query("insert into public.users (id, email, display_name) values ($1, $2, 'C13') on conflict (id) do nothing", [
    id,
    `c13-${stamp}-${id.slice(-1)}@race.test`,
  ]);
  await admin.query("insert into public.wallets (user_id, balance_ccoin) values ($1, 1000) on conflict (user_id) do nothing", [id]);
}
for (const d of drops) {
  await admin.query(
    `insert into public.drops (id, title, series, narrative, artwork_url, total_units, signed_count, unsigned_count,
       price_unsigned_ccoin, price_signed_ccoin, price_ccoin, status, drop_start_at, creator_id, creator_name, sold_count, is_seed)
     values ($1, 'C13 Drop', 'C13', 'c13', '/x.jpg', 1, 0, 1, 10, 20, 10, 'live',
       now() - $2::interval, $3, 'Karina Aespa', 0, $4)`,
    [d.id, d.startAt, creatorIds[d.n - 1], d.isSeed],
  );
}
for (const c of cards) {
  await admin.query(
    `insert into public.cards (id, drop_id, owner_id, unit_number, variant, status, nfc_uid, nfc_short_id,
       verify_status, location, nfc_configured, qc_status, created_at)
     values ($1, $2, $3, 1, 'unsigned', 'inventory', $4, $5, 'unknown', 'with_owner', false, 'pending',
       coalesce(now() - $6::interval, now()))`,
    [c.id, c.drop.id, ownerId, `C13${stamp}${c.drop.n}`, `c13-${stamp}-${c.drop.n}`, c.createdAt],
  );
}
// Family 2 fixtures: creator held the seed card before (transferred_at varies).
await admin.query(
  `insert into public.ownership_history (id, card_id, owner_id, acquired_via, transferred_at)
   values ($1, $2, $3, 'secondary_bid', now() - interval '10 days')`,
  [`c13-h-${stamp}-3`, cards[2].id, creatorIds[2]],
);
await admin.query(
  `insert into public.ownership_history (id, card_id, owner_id, acquired_via, transferred_at)
   values ($1, $2, $3, 'secondary_bid', now() - interval '31 days')`,
  [`c13-h-${stamp}-4`, cards[3].id, creatorIds[3]],
);
await admin.query("commit");

async function asUser(userId, fn) {
  const conn = await new Client({ connectionString: url }).connect();
  const client = conn.client ?? conn;
  await client.query("set role authenticated");
  await client.query(`set request.jwt.claims to '{"sub":"${userId}","role":"authenticated"}'`);
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

// ── C1: creator bids own drop card (drop started 1h ago) -> blocked ─────────
{
  const err = await asUser(creatorIds[0], (c) =>
    c.query("select public.place_bid($1, 10)", [cards[0].id]).then(
      () => null,
      (e) => e,
    ),
  );
  const code = err ? errCode(err) : "no-error";
  report("C1", code === "CREATOR_SELF_DEALING_30D", code);
}

// ── C2: creator bids own drop card (drop started 31d ago) -> ok ─────────────
{
  const err = await asUser(creatorIds[1], (c) =>
    c.query("select public.place_bid($1, 10)", [cards[1].id]).then(
      () => null,
      (e) => e,
    ),
  );
  const code = err ? errCode(err) : "ok";
  report("C2", code === "ok", code);
}

// ── C3: seed creator, holder history 10d ago -> blocked (family 2) ──────────
{
  const err = await asUser(creatorIds[2], (c) =>
    c.query("select public.place_bid($1, 10)", [cards[2].id]).then(
      () => null,
      (e) => e,
    ),
  );
  const code = err ? errCode(err) : "no-error";
  report("C3", code === "CREATOR_SELF_DEALING_30D", code);
}

// ── C4: seed creator, holder history 31d ago -> ok (family 2 expired) ───────
{
  const err = await asUser(creatorIds[3], (c) =>
    c.query("select public.place_bid($1, 10)", [cards[3].id]).then(
      () => null,
      (e) => e,
    ),
  );
  const code = err ? errCode(err) : "ok";
  report("C4", code === "ok", code);
}

// ── C5: seed creator, no history, card created 10d ago -> blocked (family 3) ─
{
  const err = await asUser(creatorIds[4], (c) =>
    c.query("select public.place_bid($1, 10)", [cards[4].id]).then(
      () => null,
      (e) => e,
    ),
  );
  const code = err ? errCode(err) : "no-error";
  report("C5", code === "CREATOR_SELF_DEALING_30D", code);
}

// ── C6: seed creator, no history, card created 31d ago -> ok (expired) ──────
{
  const err = await asUser(creatorIds[5], (c) =>
    c.query("select public.place_bid($1, 10)", [cards[5].id]).then(
      () => null,
      (e) => e,
    ),
  );
  const code = err ? errCode(err) : "ok";
  report("C6", code === "ok", code);
}

// ── C7: non-creator bids someone else's seed card -> ok (no over-block) ─────
{
  const err = await asUser(freshUserId, (c) =>
    c.query("select public.place_bid($1, 10)", [cards[4].id]).then(
      () => null,
      (e) => e,
    ),
  );
  const code = err ? errCode(err) : "ok";
  report("C7", code === "ok", code);
}

// ── Cleanup ─────────────────────────────────────────────────────────────────
// wallet_transactions append-only trigger needs table owner -> back to postgres.
await admin.query("set role postgres");
await admin.query("begin");
await admin.query("alter table public.wallet_transactions disable trigger trg_wtx_immutable");
await admin.query("delete from public.wallet_transactions where user_id = any($1)", [allUsers]);
await admin.query("alter table public.wallet_transactions enable trigger trg_wtx_immutable");
await admin.query("delete from public.bids where card_id like $1", [`c13-card-${stamp}%`]);
await admin.query("delete from public.ownership_history where card_id like $1", [`c13-card-${stamp}%`]);
await admin.query("delete from public.cards where drop_id like $1", [`c13-drop-${stamp}%`]);
await admin.query("delete from public.drops where id like $1", [`c13-drop-${stamp}%`]);
await admin.query("delete from public.wallets where user_id = any($1)", [allUsers]);
await admin.query("delete from public.users where id = any($1)", [allUsers]);
await admin.query("commit");
console.log("CLEANUP OK");
await admin.end();

const failed = results.filter((r) => !r.pass).length;
if (failed > 0) process.exit(1);

// C.Verse — C-12 rebuy-block via bid path (docs/07 C-12 FINAL).
// Jalankan against Supabase lokal (disposable — db reset bebas):
//   node supabase/tests/rpc_c12_bid_test.mjs postgresql://postgres:postgres@127.0.0.1:54322/postgres
// Skenario:
//   C1: prev owner (transfer 2 jam lalu) place_bid        -> COOLING_PERIOD_24H
//   C2: prev owner (transfer 25 jam lalu) place_bid       -> sukses
//   C3: user lain (tanpa riwayat own) place_bid kartu sama -> sukses
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
const prevOwnerRecent = { id: "b1000000-0000-4000-8000-000000000001", email: `c12-recent-${stamp}@race.test` };
const prevOwnerOld = { id: "b1000000-0000-4000-8000-000000000002", email: `c12-old-${stamp}@race.test` };
const owner = { id: "b1000000-0000-4000-8000-000000000003", email: `c12-owner-${stamp}@race.test` };
const freshUser = { id: "b1000000-0000-4000-8000-000000000004", email: `c12-fresh-${stamp}@race.test` };
const dropId = `c12-drop-${stamp}`;
const cardRecent = `c12-card-${stamp}-a`; // prev owner 2 jam lalu
const cardOld = `c12-card-${stamp}-b`; // prev owner 25 jam lalu
const allUsers = [prevOwnerRecent, prevOwnerOld, owner, freshUser].map((u) => u.id);

await admin.query("begin");
for (const u of [prevOwnerRecent, prevOwnerOld, owner, freshUser]) {
  await admin.query("insert into public.users (id, email, display_name) values ($1, $2, $3) on conflict (id) do nothing", [
    u.id,
    u.email,
    "C12",
  ]);
  await admin.query("insert into public.wallets (user_id, balance_ccoin) values ($1, $2) on conflict (user_id) do nothing", [u.id, 1000]);
}
await admin.query(
  `insert into public.drops (id, title, series, narrative, artwork_url, total_units, signed_count, unsigned_count,
     price_unsigned_ccoin, price_signed_ccoin, price_ccoin, status, drop_start_at, creator_id, creator_name, sold_count)
   values ($1, 'C12 Drop', 'C12', 'c12', '/x.jpg', 2, 0, 2, 10, 20, 10, 'live', now() - interval '26 hours',
     '00000000-0000-4000-8000-000000000003', 'Karina Aespa', 0)`,
  [dropId],
);
for (const [i, cardId] of [cardRecent, cardOld].entries()) {
  await admin.query(
    `insert into public.cards (id, drop_id, owner_id, unit_number, variant, status, nfc_uid, nfc_short_id, verify_status, location, nfc_configured, qc_status)
     values ($1, $2, $3, $4, 'unsigned', 'inventory', $5, $6, 'unknown', 'with_owner', false, 'pending')`,
    [cardId, dropId, owner.id, i + 1, `C12${stamp}${cardId.slice(-1)}`, `c12-${stamp}-${cardId.slice(-1)}`],
  );
}
await admin.query(
  `insert into public.ownership_history (id, card_id, owner_id, acquired_via, transferred_at)
   values ($1, $2, $3, 'secondary_bid', now() - interval '2 hours')`,
  [`c12-h-${stamp}-a`, cardRecent, prevOwnerRecent.id],
);
await admin.query(
  `insert into public.ownership_history (id, card_id, owner_id, acquired_via, transferred_at)
   values ($1, $2, $3, 'secondary_bid', now() - interval '25 hours')`,
  [`c12-h-${stamp}-b`, cardOld, prevOwnerOld.id],
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

// ── C1: prev owner (2 jam) place_bid -> COOLING_PERIOD_24H ──────────────────
{
  const err = await asUser(prevOwnerRecent.id, (c) =>
    c.query("select public.place_bid($1, 10)", [cardRecent]).then(
      () => null,
      (e) => e,
    ),
  );
  const code = err ? errCode(err) : "no-error";
  report("C1", code === "COOLING_PERIOD_24H", code);
}

// ── C2: prev owner (25 jam) place_bid -> sukses ─────────────────────────────
{
  const err = await asUser(prevOwnerOld.id, (c) =>
    c.query("select public.place_bid($1, 10)", [cardOld]).then(
      () => null,
      (e) => e,
    ),
  );
  const code = err ? errCode(err) : "ok";
  report("C2", code === "ok", code);
}

// ── C3: user lain place_bid kartu sama -> sukses (tidak over-block) ─────────
{
  const err = await asUser(freshUser.id, (c) =>
    c.query("select public.place_bid($1, 10)", [cardRecent]).then(
      () => null,
      (e) => e,
    ),
  );
  const code = err ? errCode(err) : "ok";
  report("C3", code === "ok", code);
}

// ── Cleanup ─────────────────────────────────────────────────────────────────
// alter table (disable trigger append-only) butuh owner tabel — kembali ke
// postgres; service_role tidak boleh.
await admin.query("set role postgres");
await admin.query("begin");
await admin.query("alter table public.wallet_transactions disable trigger trg_wtx_immutable");
await admin.query("delete from public.wallet_transactions where user_id = any($1)", [allUsers]);
await admin.query("alter table public.wallet_transactions enable trigger trg_wtx_immutable");
await admin.query("delete from public.bids where card_id like $1", [`c12-card-${stamp}%`]);
await admin.query("delete from public.ownership_history where card_id like $1", [`c12-card-${stamp}%`]);
await admin.query("delete from public.cards where drop_id = $1", [dropId]);
await admin.query("delete from public.drops where id = $1", [dropId]);
await admin.query("delete from public.wallets where user_id = any($1)", [allUsers]);
await admin.query("delete from public.users where id = any($1)", [allUsers]);
await admin.query("commit");
console.log("CLEANUP OK");
await admin.end();

const failed = results.filter((r) => !r.pass).length;
if (failed > 0) process.exit(1);

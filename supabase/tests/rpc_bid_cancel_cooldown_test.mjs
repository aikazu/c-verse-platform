// C.Verse — BID_CANCEL_COOLDOWN (owner directive 2026-09-01): bid baru bisa
// dibatalkan 24 jam setelah dipasang (BID_CANCEL_COOLDOWN_HOURS = 24 di
// packages/shared; komplemen C-12 rebuy cooldown yang berlaku SETELAH cancel).
// Jalankan against Supabase lokal (disposable — db reset bebas):
//   node supabase/tests/rpc_bid_cancel_cooldown_test.mjs postgresql://postgres:postgres@127.0.0.1:54322/postgres
// Skenario:
//   K1: cancel_bid segera setelah place_bid              -> BID_CANCEL_COOLDOWN (escrow tetap ter-hold)
//   K2: backdate created_at -25 jam -> cancel_bid        -> sukses (escrow release, saldo kembali)
//   K3: boundary tepat 24 jam (created_at == now()-24h)  -> sukses (guard strict `>` — di 24h cancel sudah boleh)
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
const bidder = { id: "b2000000-0000-4000-8000-000000000001", email: `cool-bidder-${stamp}@race.test` };
const owner = { id: "b2000000-0000-4000-8000-000000000002", email: `cool-owner-${stamp}@race.test` };
const dropId = `cool-drop-${stamp}`;
const cardA = `cool-card-${stamp}-a`; // K1 (gagal cancel) + K2 (backdate, cancel sukses)
const cardB = `cool-card-${stamp}-b`; // K3 (boundary tepat 24 jam)
const allUsers = [bidder.id, owner.id];

await admin.query("begin");
for (const u of [bidder, owner]) {
  await admin.query("insert into public.users (id, email, display_name) values ($1, $2, $3) on conflict (id) do nothing", [
    u.id,
    u.email,
    "COOL",
  ]);
  await admin.query("insert into public.wallets (user_id, balance_ccoin) values ($1, $2) on conflict (user_id) do nothing", [u.id, 1000]);
}
await admin.query(
  `insert into public.drops (id, title, series, narrative, artwork_url, total_units, signed_count, unsigned_count,
     price_unsigned_ccoin, price_signed_ccoin, price_ccoin, status, drop_start_at, creator_id, creator_name, sold_count)
   values ($1, 'Cooldown Drop', 'COOL', 'cool', '/x.jpg', 2, 0, 2, 10, 20, 10, 'live', now() - interval '26 hours',
     '00000000-0000-4000-8000-000000000003', 'Karina Aespa', 0)`,
  [dropId],
);
for (const [i, cardId] of [cardA, cardB].entries()) {
  await admin.query(
    `insert into public.cards (id, drop_id, owner_id, unit_number, variant, status, nfc_uid, nfc_short_id, verify_status, location, nfc_configured, qc_status)
     values ($1, $2, $3, $4, 'unsigned', 'inventory', $5, $6, 'unknown', 'with_owner', false, 'pending')`,
    [cardId, dropId, owner.id, i + 1, `COOL${stamp}${cardId.slice(-1)}`, `cool-${stamp}-${cardId.slice(-1)}`],
  );
}
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

async function balance(userId) {
  const r = await admin.query("select balance_ccoin::int as bal from public.wallets where user_id = $1", [userId]);
  return r.rows[0].bal;
}

// ── K1: cancel segera setelah place_bid -> BID_CANCEL_COOLDOWN ──────────────
let bidA;
{
  // composite return public.bids tidak ter-parse node-pg -> bungkus to_jsonb
  const placed = await asUser(bidder.id, (c) => c.query("select to_jsonb(public.place_bid($1, 10)) ->> 'id' as id", [cardA]));
  bidA = placed.rows[0].id;
  const err = await asUser(bidder.id, (c) =>
    c.query("select public.cancel_bid($1)", [bidA]).then(
      () => null,
      (e) => e,
    ),
  );
  const code = err ? errCode(err) : "no-error";
  // Escrow tetap ter-hold: bid masih active, saldo sudah terdebit 10.
  const stillActive = await admin.query("select status from public.bids where id = $1", [bidA]);
  const bal = await balance(bidder.id);
  report(
    "K1",
    code === "BID_CANCEL_COOLDOWN" && stillActive.rows[0].status === "active" && bal === 990,
    `${code} status=${stillActive.rows[0].status} saldo=${bal}`,
  );
}

// ── K2: backdate created_at -25 jam -> cancel sukses (escrow release) ───────
{
  await admin.query("update public.bids set created_at = now() - interval '25 hours' where id = $1", [bidA]);
  const err = await asUser(bidder.id, (c) =>
    c.query("select public.cancel_bid($1)", [bidA]).then(
      () => null,
      (e) => e,
    ),
  );
  const code = err ? errCode(err) : "ok";
  const row = await admin.query("select status from public.bids where id = $1", [bidA]);
  const tx = await admin.query(
    "select count(*)::int as n from public.wallet_transactions where user_id = $1 and type = 'escrow_release' and ref_id = $2",
    [bidder.id, bidA],
  );
  const bal = await balance(bidder.id);
  report(
    "K2",
    code === "ok" && row.rows[0].status === "cancelled" && tx.rows[0].n === 1 && bal === 1000,
    `${code} status=${row.rows[0].status} release_tx=${tx.rows[0].n} saldo=${bal}`,
  );
}

// ── K3: boundary tepat 24 jam -> cancel sukses (guard strict `>`) ───────────
// now() = transaction timestamp: satu transaksi membuat created_at == now() -
// interval '24 hours' secara eksak — mempin semantik `>` (di tepat 24 jam
// cancel sudah boleh; guard `>=` akan FAIL di sini). Backdate pakai
// `set local role service_role` karena bids tidak punya policy UPDATE untuk
// authenticated (RLS menyaring UPDATE jadi 0 baris).
{
  const placed = await asUser(bidder.id, (c) => c.query("select to_jsonb(public.place_bid($1, 10)) ->> 'id' as id", [cardB]));
  const bidB = placed.rows[0].id;
  const err = await asUser(bidder.id, async (c) => {
    try {
      await c.query("begin");
      await c.query("set local role service_role");
      await c.query("update public.bids set created_at = now() - interval '24 hours' where id = $1", [bidB]);
      await c.query("set local role authenticated");
      await c.query("select public.cancel_bid($1)", [bidB]);
      await c.query("commit");
      return null;
    } catch (e) {
      await c.query("rollback").catch(() => {});
      return e;
    }
  });
  const code = err ? errCode(err) : "ok";
  const row = await admin.query("select status from public.bids where id = $1", [bidB]);
  const bal = await balance(bidder.id);
  report("K3", code === "ok" && row.rows[0].status === "cancelled" && bal === 1000, `${code} status=${row.rows[0].status} saldo=${bal}`);
}

// ── Cleanup ─────────────────────────────────────────────────────────────────
// alter table (disable trigger append-only) butuh owner tabel — kembali ke
// postgres; service_role tidak boleh.
await admin.query("set role postgres");
await admin.query("begin");
await admin.query("alter table public.wallet_transactions disable trigger trg_wtx_immutable");
await admin.query("delete from public.wallet_transactions where user_id = any($1)", [allUsers]);
await admin.query("alter table public.wallet_transactions enable trigger trg_wtx_immutable");
await admin.query("delete from public.bids where card_id like $1", [`cool-card-${stamp}%`]);
await admin.query("delete from public.cards where drop_id = $1", [dropId]);
await admin.query("delete from public.drops where id = $1", [dropId]);
await admin.query("delete from public.wallets where user_id = any($1)", [allUsers]);
await admin.query("delete from public.users where id = any($1)", [allUsers]);
await admin.query("commit");
console.log("CLEANUP OK");
await admin.end();

const failed = results.filter((r) => !r.pass).length;
if (failed > 0) process.exit(1);

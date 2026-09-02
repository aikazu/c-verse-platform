// C.Verse — dual-token C-Gems flow (keputusan owner 2026-09-03, Lane A).
// Jalankan against Supabase lokal (disposable — db reset bebas):
//   node supabase/tests/gem_flow_test.mjs postgresql://postgres:postgres@127.0.0.1:54322/postgres
// Skenario:
//   F1: send_support -> receiver gems + lot 24 jam; sender ccoin -amount, XP +amount
//   F2: payout saat lot belum matured -> PAYOUT_GEMS_LOCKED; saldo total kurang
//       -> INSUFFICIENT_GEMS (dua error berbeda, urutan gate benar)
//   F3: payout sukses HANYA debit lot matured (FIFO): lot locked tidak tersentuh,
//       partial depletion, payouts row pending, ledger debit -amount
//   F4: convert_gems 1:1 (gems turun lot segala usia, ccoin naik, TANPA XP)
//   F5: invariant closure untuk user paling bermutasi: SUM(gem_transactions.amount)
//       = SUM(gem_lots.remaining) = wallets.balance_gems
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
function expectCode(promise) {
  return promise.then(
    () => "UNEXPECTED_OK",
    (e) => errCode(e),
  );
}

const admin = new Client({ connectionString: url });
await admin.connect();
await admin.query("set role service_role");
const _adminQuery = admin.query.bind(admin);
admin.query = async (text, params) => {
  await _adminQuery("set role service_role");
  return _adminQuery(text, params);
};

/** Client dengan identitas user (JWT sub) — meniru PostgREST authenticated. */
async function asUser(userId) {
  const c = new Client({ connectionString: url });
  await c.connect();
  await c.query("set role authenticated");
  await c.query(`set request.jwt.claims to '{"sub":"${userId}","role":"authenticated"}'`);
  return c;
}

const stamp = (Date.now().toString(16) + Math.random().toString(16).slice(2, 10)).replace(/[^0-9a-f]/g, "").slice(0, 12);
const U = {
  sender: `9f100000-0000-4000-8000-${stamp.padEnd(12, "0")}`,
  creator: `9f200000-0000-4000-8000-${stamp.padEnd(12, "0")}`, // penerima support + payee payout
  converter: `9f300000-0000-4000-8000-${stamp.padEnd(12, "0")}`,
};

async function ccoinOf(userId) {
  const r = await admin.query("select balance_ccoin::int as b from public.wallets where user_id = $1", [userId]);
  return r.rows[0]?.b ?? 0;
}
async function gemsOf(userId) {
  const r = await admin.query("select balance_gems::int as g from public.wallets where user_id = $1", [userId]);
  return r.rows[0]?.g ?? 0;
}
async function xpOf(userId) {
  return (await admin.query("select total_xp::int as xp from public.users where id = $1", [userId])).rows[0].xp;
}
async function newestLot(userId) {
  return (
    await admin.query(
      "select id, amount::int as amount, remaining::int as remaining, mature_at from public.gem_lots where user_id = $1 order by created_at desc, id desc limit 1",
      [userId],
    )
  ).rows[0];
}

// ── Fixture ─────────────────────────────────────────────────────────────────
await admin.query("begin");
for (const [key, id] of Object.entries(U)) {
  await admin.query("insert into public.users (id, email, display_name) values ($1, $2, $3) on conflict (id) do nothing", [
    id,
    `gemflow-${key}-${stamp}@test`,
    `GemFlow ${key}`,
  ]);
  await admin.query("insert into public.wallets (user_id, balance_ccoin) values ($1, $2) on conflict (user_id) do nothing", [
    id,
    key === "sender" ? 1000 : 0,
  ]);
}
await admin.query("update public.users set role = 'creator' where id = $1", [U.creator]);
await admin.query("insert into public.creators (id, handle, user_id, status) values ($1, $2, $3, 'active')", [
  `gemflow-cr-${stamp}`,
  `gemflow-${stamp}`,
  U.creator,
]);
await admin.query(
  "insert into public.kyc_records (id, user_id, full_name, nik, address, status) values ($1, $2, 'Gem Payee', $3, 'Jl. Gem No. 1 Jakarta', 'approved')",
  [
    `gemflow-kyc-${stamp}`,
    U.creator,
    `32012345${stamp
      .replace(/[^0-9]/g, "")
      .padEnd(8, "7")
      .slice(0, 8)}`,
  ],
);
await admin.query("commit");

// ── F1: support -> receiver GEMS + lot 24 jam; sender ccoin + XP C-Coin ─────
const SUPPORT_AMOUNT = 40;
{
  const senderXpBefore = await xpOf(U.sender);
  const c = await asUser(U.sender);
  await c.query("select public.send_support($1, $2)", [U.creator, SUPPORT_AMOUNT]);
  await c.end();

  const senderCcoin = await ccoinOf(U.sender);
  const creatorGems = await gemsOf(U.creator);
  const gemTx = (
    await admin.query(
      "select amount::int as amt, balance_after_gems::int as bal, ref_type, ref_id from public.gem_transactions where user_id = $1 and ref_type = 'support'",
      [U.creator],
    )
  ).rows[0];
  const lot = await newestLot(U.creator);
  const lotLocked24h =
    lot &&
    lot.mature_at > new Date() &&
    new Date(lot.mature_at) - Date.now() > 23 * 3600 * 1000 &&
    new Date(lot.mature_at) - Date.now() < 25 * 3600 * 1000;
  const senderXpDelta = (await xpOf(U.sender)) - senderXpBefore;

  const ok =
    senderCcoin === 1000 - SUPPORT_AMOUNT &&
    creatorGems === SUPPORT_AMOUNT &&
    gemTx?.amt === SUPPORT_AMOUNT &&
    gemTx?.bal === SUPPORT_AMOUNT &&
    gemTx?.ref_id === U.sender &&
    lot?.amount === SUPPORT_AMOUNT &&
    lot?.remaining === SUPPORT_AMOUNT &&
    lotLocked24h &&
    senderXpDelta === SUPPORT_AMOUNT;
  report(
    "F1 support -> receiver gems + lot 24 jam, sender ccoin/XP",
    ok,
    `senderCcoin=${senderCcoin} creatorGems=${creatorGems} tx=${JSON.stringify(gemTx ?? {})} lotMaturedIn24h=${lotLocked24h} senderXpDelta=${senderXpDelta}`,
  );
}

// ── F2: payout lot belum matured -> PAYOUT_GEMS_LOCKED; total kurang -> INSUFFICIENT_GEMS
{
  // lot kedua via support kecil (skenario: pendapatan segar lalu langsung cair)
  const c = await asUser(U.sender);
  await c.query("select public.send_support($1, 15)", [U.creator]);
  await c.end();
  const totalGems = await gemsOf(U.creator); // 40 + 15 = 55, SEMUA terkunci

  const insufficient = await expectCode(
    asUser(U.creator).then((cl) => cl.query("select public.payout_request(56)").finally(() => cl.end())),
  );
  const locked = await expectCode(asUser(U.creator).then((cl) => cl.query("select public.payout_request(55)").finally(() => cl.end())));

  const ok = totalGems === 55 && insufficient === "INSUFFICIENT_GEMS" && locked === "PAYOUT_GEMS_LOCKED";
  report(
    "F2 payout gate: INSUFFICIENT_GEMS vs PAYOUT_GEMS_LOCKED",
    ok,
    `totalGems=${totalGems} over=${insufficient} exactLocked=${locked}`,
  );
}

// ── F3: payout sukses HANYA debit lot matured (FIFO, partial) ───────────────
{
  const lots = (
    await admin.query(
      "select id, amount::int as amount, remaining::int as remaining, mature_at from public.gem_lots where user_id = $1 order by created_at, id",
      [U.creator],
    )
  ).rows;
  const [lot1, lot2] = lots; // lot1 = 40 (F1), lot2 = 15 (F2)
  // backdate lot1 saja -> matured 40, locked 15
  await admin.query("update public.gem_lots set mature_at = now() - interval '1 hour' where id = $1", [lot1.id]);

  await asUser(U.creator).then((cl) => cl.query("select public.payout_request(30)").finally(() => cl.end()));

  const after = (
    await admin.query("select id, remaining::int as remaining from public.gem_lots where id in ($1, $2) order by created_at", [
      lot1.id,
      lot2.id,
    ])
  ).rows;
  const debit = (
    await admin.query(
      "select amount::int as amt, balance_after_gems::int as bal, ref_type from public.gem_transactions where user_id = $1 and ref_type = 'payout'",
      [U.creator],
    )
  ).rows[0];
  const payout = (
    await admin.query(
      "select status::text as st, ccoin_amount::int as amt from public.payouts where user_id = $1 order by requested_at desc limit 1",
      [U.creator],
    )
  ).rows[0];
  const gems = await gemsOf(U.creator); // 55 - 30 = 25

  const lot1After = after.find((l) => l.id === lot1.id);
  const lot2After = after.find((l) => l.id === lot2.id);
  const ok =
    lot1After?.remaining === 10 && // 40 - 30 FIFO
    lot2After?.remaining === 15 && // locked lot TIDAK tersentuh
    debit?.amt === -30 &&
    debit?.bal === 25 &&
    payout?.st === "pending" &&
    payout?.amt === 30 &&
    gems === 25;
  report(
    "F3 payout hanya debit matured (FIFO partial)",
    ok,
    `lot1=${lot1After?.remaining} (harus 10) lot2=${lot2After?.remaining} (harus 15) debit=${JSON.stringify(debit ?? {})} payout=${payout?.st}/${payout?.amt} gems=${gems}`,
  );
}

// ── F4: convert_gems 1:1 — lot segala usia, ccoin naik, TANPA XP ────────────
{
  const convAmount = 25;
  await admin.query("select public.wallet_credit_gems($1, $2, 'settlement', 'test', $3, $4)", [
    U.converter,
    convAmount,
    `gemflow-conv-ref-${stamp}`,
    `gemflow-conv-${stamp}`,
  ]);
  const xpBefore = await xpOf(U.converter);
  const c = await asUser(U.converter);
  const invalid = await expectCode(c.query("select public.convert_gems(0)"));
  await c.query("select public.convert_gems($1)", [convAmount]);
  await c.end();

  const gems = await gemsOf(U.converter); // 0
  const ccoin = await ccoinOf(U.converter); // +25
  const lotDrained = (await admin.query("select remaining::int as r from public.gem_lots where user_id = $1", [U.converter])).rows[0]?.r;
  const ccTx = (
    await admin.query("select amount_ccoin::int as amt, type from public.wallet_transactions where user_id = $1 and type = 'convert'", [
      U.converter,
    ])
  ).rows[0];
  const xpDelta = (await xpOf(U.converter)) - xpBefore;

  const ok =
    invalid === "INVALID_AMOUNT" &&
    gems === 0 &&
    ccoin === convAmount &&
    lotDrained === 0 &&
    ccTx?.amt === convAmount &&
    ccTx?.type === "convert" &&
    xpDelta === 0;
  report(
    "F4 convert_gems 1:1 tanpa XP",
    ok,
    `invalid=${invalid} gems=${gems} ccoin=${ccoin} lotRemaining=${lotDrained} ccTx=${JSON.stringify(ccTx ?? {})} xpDelta=${xpDelta}`,
  );
}

// ── F5: invariant closure — ledger = lot = balance (user paling bermutasi) ──
{
  const rows = (
    await admin.query(
      `select w.balance_gems::int as balance,
              (select coalesce(sum(amount), 0)::int from public.gem_transactions where user_id = w.user_id) as ledger_sum,
              (select coalesce(sum(remaining), 0)::int from public.gem_lots where user_id = w.user_id) as lots_sum
       from public.wallets w where w.user_id = $1`,
      [U.creator],
    )
  ).rows[0];
  const ok = rows.balance === rows.ledger_sum && rows.balance === rows.lots_sum;
  report(
    "F5 closure: SUM(ledger) = SUM(lots) = balance_gems",
    ok,
    `balance=${rows.balance} ledger=${rows.ledger_sum} lots=${rows.lots_sum}`,
  );
}

// ── Cleanup ─────────────────────────────────────────────────────────────────
// Pakai raw client: wrapper admin.query me-re-assert service_role sebelum
// tiap query, sedangkan disable trigger butuh role pemilik tabel (postgres).
const allUsers = Object.values(U);
const raw = (text, params) => _adminQuery(text, params);
await raw("set role postgres");
await raw("begin");
await raw("alter table public.wallet_transactions disable trigger trg_wtx_immutable");
await raw("alter table public.gem_transactions disable trigger trg_gem_tx_immutable");
await raw("delete from public.payouts where user_id = any($1)", [allUsers]);
await raw("delete from public.kyc_records where user_id = any($1)", [allUsers]);
await raw("delete from public.wallet_transactions where user_id = any($1)", [allUsers]);
await raw("delete from public.gem_transactions where user_id = any($1)", [allUsers]);
await raw("alter table public.wallet_transactions enable trigger trg_wtx_immutable");
await raw("alter table public.gem_transactions enable trigger trg_gem_tx_immutable");
await raw("delete from public.creators where user_id = any($1)", [allUsers]);
await raw("delete from public.wallets where user_id = any($1)", [allUsers]);
await raw("delete from public.users where id = any($1)", [allUsers]);
await raw("commit");
console.log("CLEANUP OK");
await admin.end();

const failed = results.filter((r) => !r.pass).length;
console.log(`\n${results.length - failed}/${results.length} PASS`);
process.exit(failed > 0 ? 1 : 0);

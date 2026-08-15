// C.Verse — RPC race tests (docs/13 §2.3 acceptance criteria).
// Jalankan against Supabase lokal (disposable — db reset bebas):
//   node supabase/tests/rpc_race_test.mjs postgresql://postgres:postgres@127.0.0.1:54322/postgres
// Skenario:
//   R1: 50 concurrent checkout ke drop sisa 1 unit  -> tepat 1 sukses, 49 SOLD_OUT
//   R2: 2 concurrent checkout user sama            -> 1 sukses, 1 LIMIT_1_PER_DROP
//   R3: concurrent wallet_debit sampai saldo habis -> saldo tidak pernah negatif
import pgModule from "../../apps/api/node_modules/pg/lib/index.js";

const { Client } = pgModule;

const url = process.argv[2] ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const N_R1 = 50;

const results = [];
function report(id, pass, detail) {
  results.push({ id, pass });
  console.log(`${id} ${pass ? "PASS" : "FAIL"}${detail ? ` (${detail})` : ""}`);
}

function errCode(e) {
  return String(e.message).trim().split("\n")[0];
}

async function asUser(conn, sub, fn) {
  await conn.query("set role authenticated");
  await conn.query(`set request.jwt.claims to '{"sub":"${sub}","role":"authenticated"}'`);
  try {
    return await fn(conn);
  } finally {
    await conn.query("reset role");
  }
}

const admin = new Client({ connectionString: url });
await admin.connect();

// ── Fixture: test users + wallets + drop sisa 1 unit ────────────────────────
const stamp = Date.now().toString(36);
const r1Users = Array.from({ length: N_R1 }, (_, i) => ({
  id: `a0000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
  name: `Race ${i}`,
}));
const r2User = { id: "b0000000-0000-4000-8000-000000000001", name: "Race Same" };
const r3User = { id: "c0000000-0000-4000-8000-000000000001", name: "Race Debit" };
const drop1 = `race-drop1-${stamp}`;
const drop2 = `race-drop2-${stamp}`;

await admin.query("begin");
for (const u of [...r1Users, r2User, r3User]) {
  await admin.query("insert into public.users (id, email, display_name) values ($1, $2, $3) on conflict (id) do nothing", [
    u.id,
    `${u.id}@race.test`,
    u.name,
  ]);
  await admin.query("insert into public.wallets (user_id, balance_ccoin) values ($1, $2) on conflict (user_id) do nothing", [u.id, 1000]);
}
await admin.query(
  `insert into public.drops (id, title, series, narrative, artwork_url, total_units, signed_count, unsigned_count,
     price_unsigned_ccoin, price_signed_ccoin, price_ccoin, status, drop_start_at, creator_id, creator_name, sold_count)
   values ($1, 'Race Drop 1', 'Race', 'race', '/x.jpg', 1, 0, 1, 10, 20, 10, 'live', now(),
     '00000000-0000-4000-8000-000000000003', 'Karina Aespa', 0)`,
  [drop1],
);
await admin.query(
  `insert into public.cards (id, drop_id, unit_number, variant, status, card_status_new, nfc_uid, nfc_short_id, verify_status, location, nfc_configured, qc_status)
   values ($1, $2, 1, 'unsigned', 'available', 'inventory', $3, $4, 'unknown', 'platform_stock', false, 'pending')`,
  [`card-${drop1}-01`, drop1, `RACE${stamp}01`, `rc1-${stamp}`],
);
await admin.query(
  `insert into public.drops (id, title, series, narrative, artwork_url, total_units, signed_count, unsigned_count,
     price_unsigned_ccoin, price_signed_ccoin, price_ccoin, status, drop_start_at, creator_id, creator_name, sold_count)
   values ($1, 'Race Drop 2', 'Race', 'race', '/x.jpg', 2, 0, 2, 10, 20, 10, 'live', now(),
     '00000000-0000-4000-8000-000000000003', 'Karina Aespa', 0)`,
  [drop2],
);
for (const i of [1, 2]) {
  await admin.query(
    `insert into public.cards (id, drop_id, unit_number, variant, status, card_status_new, nfc_uid, nfc_short_id, verify_status, location, nfc_configured, qc_status)
     values ($1, $2, $3, 'unsigned', 'available', 'inventory', $4, $5, 'unknown', 'platform_stock', false, 'pending')`,
    [`card-${drop2}-0${i}`, drop2, i, `RACE${stamp}0${i + 1}`, `rc2-${stamp}-${i}`],
  );
}
await admin.query("commit");

// ── R1: 50 concurrent checkout, sisa 1 unit ─────────────────────────────────
{
  const conns = await Promise.all(Array.from({ length: N_R1 }, () => new Client({ connectionString: url }).connect()));
  const clients = conns.map((c) => c.client ?? c);
  await Promise.all(
    clients.map((c, i) =>
      c.query("set role authenticated").then(() =>
        c.query(`set request.jwt.claims to '{"sub":"${r1Users[i].id}","role":"authenticated"}'`),
      ),
    ),
  );
  const outcomes = await Promise.all(
    clients.map((c) =>
      c
        .query("select public.checkout($1, 'regular', 'vault', null, null) as order_id", [drop1])
        .then((r) => ({ ok: true, id: r.rows[0].order_id }))
        .catch((e) => ({ ok: false, code: errCode(e) })),
    ),
  );
  const ok = outcomes.filter((o) => o.ok);
  const soldOut = outcomes.filter((o) => !o.ok && o.code === "SOLD_OUT");
  const other = outcomes.filter((o) => !o.ok && o.code !== "SOLD_OUT");
  report(
    "R1",
    ok.length === 1 && soldOut.length === N_R1 - 1 && other.length === 0,
    `sukses=${ok.length} sold_out=${soldOut.length} lainnya=${other.length ? other.map((o) => o.code).join(",") : 0}`,
  );
  await Promise.all(clients.map((c) => c.end()));
}

// ── R2: 2 concurrent checkout user sama, drop 2 unit ────────────────────────
{
  const pair = await Promise.all([1, 2].map(() => new Client({ connectionString: url }).connect()));
  const clients = pair.map((c) => c.client ?? c);
  await Promise.all(
    clients.map((c) =>
      c.query("set role authenticated").then(() =>
        c.query(`set request.jwt.claims to '{"sub":"${r2User.id}","role":"authenticated"}'`),
      ),
    ),
  );
  const outcomes = await Promise.all(
    clients.map((c) =>
      c
        .query("select public.checkout($1, 'regular', 'vault', null, null) as order_id", [drop2])
        .then((r) => ({ ok: true }))
        .catch((e) => ({ ok: false, code: errCode(e) })),
    ),
  );
  const ok = outcomes.filter((o) => o.ok);
  const limit = outcomes.filter((o) => !o.ok && o.code === "LIMIT_1_PER_DROP");
  report(
    "R2",
    ok.length === 1 && limit.length === 1,
    `sukses=${ok.length} limit_1=${limit.length} ${outcomes.filter((o) => !o.ok && o.code !== "LIMIT_1_PER_DROP").map((o) => o.code).join(",")}`,
  );
  await Promise.all(clients.map((c) => c.end()));
}

// ── R3: concurrent wallet_debit, saldo 100, 10x debit 30 ────────────────────
{
  await admin.query("update public.wallets set balance_ccoin = 100 where user_id = $1", [r3User.id]);
  const conns = await Promise.all(Array.from({ length: 10 }, () => new Client({ connectionString: url }).connect()));
  const clients = conns.map((c) => c.client ?? c);
  await Promise.all(
    clients.map((c) =>
      c.query("set role authenticated").then(() =>
        c.query(`set request.jwt.claims to '{"sub":"${r3User.id}","role":"authenticated"}'`),
      ),
    ),
  );
  const outcomes = await Promise.all(
    clients.map((c, i) =>
      c
        .query("select public.wallet_debit($1, 30, 'checkout', 'race', $2, $3) as tx", [r3User.id, `race3-${i}`, `race3-${stamp}-${i}`])
        .then(() => ({ ok: true }))
        .catch((e) => ({ ok: false, code: errCode(e) })),
    ),
  );
  const { rows } = await admin.query("select balance_ccoin::int as b from public.wallets where user_id = $1", [r3User.id]);
  const balance = rows[0].b;
  const ok = outcomes.filter((o) => o.ok);
  const insufficient = outcomes.filter((o) => !o.ok && o.code === "INSUFFICIENT");
  report(
    "R3",
    balance === 10 && ok.length === 3 && insufficient.length === 7 && balance >= 0,
    `sukses=${ok.length} insufficient=${insufficient.length} saldo_akhir=${balance}`,
  );
  await Promise.all(clients.map((c) => c.end()));
}

// ── Cleanup fixture ─────────────────────────────────────────────────────────
await admin.query("begin");
await admin.query("alter table public.wallet_transactions disable trigger trg_wtx_immutable");
const allTest = [...r1Users.map((u) => u.id), r2User.id, r3User.id];
await admin.query("delete from public.wallet_transactions where user_id = any($1)", [allTest]);
await admin.query("alter table public.wallet_transactions enable trigger trg_wtx_immutable");
await admin.query("delete from public.ownership_history where card_id like $1", [`card-${drop1}%`]);
await admin.query("delete from public.ownership_history where card_id like $1", [`card-${drop2}%`]);
await admin.query("delete from public.orders where drop_id = any($1)", [[drop1, drop2]]);
await admin.query("delete from public.drops where id = any($1)", [[drop1, drop2]]);
await admin.query("delete from public.wallets where user_id = any($1)", [allTest]);
await admin.query("delete from public.users where id = any($1)", [allTest]);
await admin.query("commit");
console.log("CLEANUP OK");
await admin.end();

const failed = results.filter((r) => !r.pass).length;
if (failed > 0) process.exit(1);

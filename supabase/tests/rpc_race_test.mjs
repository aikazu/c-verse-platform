// C.Verse — RPC race tests (docs/13 §2.3 acceptance criteria).
// Jalankan against Supabase lokal (disposable — db reset bebas):
//   node supabase/tests/rpc_race_test.mjs postgresql://postgres:postgres@127.0.0.1:54322/postgres
// Mekanisme drop = raffle hybrid (C-15 FINAL): fase raffle TIDAK ada race
// (draw = satu batch job atomik); race hanya di fase FCFS sisa unit pasca-draw.
// Skenario:
//   R1: 50 concurrent checkout FCFS pasca-draw, sisa 1 unit -> 1 sukses, 49 SOLD_OUT
//   R2: 2 concurrent checkout user sama            -> 1 sukses, 1 LIMIT_1_PER_DROP
//   R3: concurrent wallet_debit sampai saldo habis -> saldo tidak pernah negatif
//   R4: concurrent drop_entry user sama (fase raffle) -> 1 sukses, sisanya ENTRY_EXISTS + hold sekali
//   R5: draw_drop 1 unit 2 entry -> 1 winner + 1 refund; panggilan kedua 0 (idempotent via drawn_at)
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

const admin = new Client({ connectionString: url });
await admin.connect();
await admin.query("set role service_role"); // bypass RLS on cloud transaction pooler
// Cloud transaction pooler occasionally rotates role; wrap to re-assert before each query.
const _adminQuery = admin.query.bind(admin);
admin.query = async (text, params) => {
  await _adminQuery("set role service_role");
  return _adminQuery(text, params);
};

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
const drop3 = `race-drop3-${stamp}`; // window raffle masih terbuka (untuk R4)
const r4User = { id: "d0000000-0000-4000-8000-000000000001", name: "Race Entry" };
// Semua drop produksi punya raffle_end_at (default +24 jam, F004) — fase FCFS
// sisa selalu pasca-draw, jadi fixture R1/R2 meniru kondisi itu.
const POST_DRAW = "now() - interval '25 hours', now() - interval '24 hours'"; // raffle_end_at, drawn_at

await admin.query("begin");
for (const u of [...r1Users, r2User, r3User, r4User]) {
  await admin.query("insert into public.users (id, email, display_name) values ($1, $2, $3) on conflict (id) do nothing", [
    u.id,
    `${u.id}@race.test`,
    u.name,
  ]);
  await admin.query("insert into public.wallets (user_id, balance_ccoin) values ($1, $2) on conflict (user_id) do nothing", [u.id, 1000]);
}
await admin.query(
  `insert into public.drops (id, title, series, narrative, artwork_url, total_units, signed_count, unsigned_count,
     price_unsigned_ccoin, price_signed_ccoin, price_ccoin, status, drop_start_at, creator_id, creator_name, sold_count, raffle_end_at, drawn_at)
   values ($1, 'Race Drop 1', 'Race', 'race', '/x.jpg', 1, 0, 1, 10, 20, 10, 'live', now() - interval '26 hours',
     '00000000-0000-4000-8000-000000000003', 'Karina Aespa', 0, ${POST_DRAW})`,
  [drop1],
);
await admin.query(
  `insert into public.cards (id, drop_id, unit_number, variant, status, nfc_uid, nfc_short_id, verify_status, location, nfc_configured, qc_status)
   values ($1, $2, 1, 'unsigned', 'inventory', $3, $4, 'unknown', 'platform_stock', false, 'pending')`,
  [`card-${drop1}-01`, drop1, `RACE${stamp}01`, `rc1-${stamp}`],
);
await admin.query(
  `insert into public.drops (id, title, series, narrative, artwork_url, total_units, signed_count, unsigned_count,
     price_unsigned_ccoin, price_signed_ccoin, price_ccoin, status, drop_start_at, creator_id, creator_name, sold_count, raffle_end_at, drawn_at)
   values ($1, 'Race Drop 2', 'Race', 'race', '/x.jpg', 2, 0, 2, 10, 20, 10, 'live', now() - interval '26 hours',
     '00000000-0000-4000-8000-000000000003', 'Karina Aespa', 0, ${POST_DRAW})`,
  [drop2],
);
for (const i of [1, 2]) {
  await admin.query(
    `insert into public.cards (id, drop_id, unit_number, variant, status, nfc_uid, nfc_short_id, verify_status, location, nfc_configured, qc_status)
     values ($1, $2, $3, 'unsigned', 'inventory', $4, $5, 'unknown', 'platform_stock', false, 'pending')`,
    [`card-${drop2}-0${i}`, drop2, i, `RACE${stamp}0${i + 1}`, `rc2-${stamp}-${i}`],
  );
}
await admin.query(
  `insert into public.drops (id, title, series, narrative, artwork_url, total_units, signed_count, unsigned_count,
     price_unsigned_ccoin, price_signed_ccoin, price_ccoin, status, drop_start_at, creator_id, creator_name, sold_count, raffle_end_at)
   values ($1, 'Race Drop 3', 'Race', 'race', '/x.jpg', 10, 0, 10, 10, 20, 10, 'live', now() - interval '1 hour',
     '00000000-0000-4000-8000-000000000003', 'Karina Aespa', 0, now() + interval '1 hour')`,
  [drop3],
);
for (const i of Array.from({ length: 10 }, (_, k) => k + 1)) {
  await admin.query(
    `insert into public.cards (id, drop_id, unit_number, variant, status, nfc_uid, nfc_short_id, verify_status, location, nfc_configured, qc_status)
     values ($1, $2, $3, 'unsigned', 'inventory', $4, $5, 'unknown', 'platform_stock', false, 'pending')`,
    [`card-${drop3}-${String(i).padStart(2, "0")}`, drop3, i, `RACE${stamp}1${i}`, `rc3-${stamp}-${i}`],
  );
}
await admin.query("commit");

// ── R1: 50 concurrent checkout, sisa 1 unit ─────────────────────────────────
{
  const conns = await Promise.all(Array.from({ length: N_R1 }, () => new Client({ connectionString: url }).connect()));
  const clients = conns.map((c) => c.client ?? c);
  await Promise.all(
    clients.map((c, i) =>
      c
        .query("set role authenticated")
        .then(() => c.query(`set request.jwt.claims to '{"sub":"${r1Users[i].id}","role":"authenticated"}'`)),
    ),
  );
  const outcomes = await Promise.all(
    clients.map((c) =>
      c
        .query("select public.checkout($1) as order_id", [drop1])
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
      c.query("set role authenticated").then(() => c.query(`set request.jwt.claims to '{"sub":"${r2User.id}","role":"authenticated"}'`)),
    ),
  );
  const outcomes = await Promise.all(
    clients.map((c) =>
      c
        .query("select public.checkout($1) as order_id", [drop2])
        .then(() => ({ ok: true }))
        .catch((e) => ({ ok: false, code: errCode(e) })),
    ),
  );
  const ok = outcomes.filter((o) => o.ok);
  const limit = outcomes.filter((o) => !o.ok && o.code === "LIMIT_1_PER_DROP");
  report(
    "R2",
    ok.length === 1 && limit.length === 1,
    `sukses=${ok.length} limit_1=${limit.length} ${outcomes
      .filter((o) => !o.ok && o.code !== "LIMIT_1_PER_DROP")
      .map((o) => o.code)
      .join(",")}`,
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
      c.query("set role authenticated").then(() => c.query(`set request.jwt.claims to '{"sub":"${r3User.id}","role":"authenticated"}'`)),
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

// ── R4: concurrent drop_entry user sama, window raffle terbuka ─────────────
{
  const conns = await Promise.all(Array.from({ length: 5 }, () => new Client({ connectionString: url }).connect()));
  const clients = conns.map((c) => c.client ?? c);
  await Promise.all(
    clients.map((c) =>
      c.query("set role authenticated").then(() => c.query(`set request.jwt.claims to '{"sub":"${r4User.id}","role":"authenticated"}'`)),
    ),
  );
  const outcomes = await Promise.all(
    clients.map((c) =>
      c
        .query("select public.drop_entry($1, 'regular') as entry", [drop3])
        .then(() => ({ ok: true }))
        .catch((e) => ({ ok: false, code: errCode(e) })),
    ),
  );
  const ok = outcomes.filter((o) => o.ok);
  const dup = outcomes.filter((o) => !o.ok && o.code === "ENTRY_EXISTS");
  // Hold terdebet tepat sekali: saldo 1000 - harga reguler 10
  const { rows } = await admin.query("select balance_ccoin::int as b from public.wallets where user_id = $1", [r4User.id]);
  const balance = rows[0].b;
  report(
    "R4",
    ok.length === 1 && dup.length === 4 && balance === 990,
    `sukses=${ok.length} entry_exists=${dup.length} saldo_akhir=${balance} (hold sekali)`,
  );
  await Promise.all(clients.map((c) => c.end()));
}

// ── R5: draw_drop — 1 unit unsigned, 2 entry; idempoten via drawn_at ────────
{
  const drop4 = `race-drop4-${stamp}`;
  const users = ["f0000000-0000-4000-8000-000000000001", "f0000000-0000-4000-8000-000000000002"];
  await admin.query("begin");
  await admin.query(
    `insert into public.drops (id, title, series, narrative, artwork_url, total_units, signed_count, unsigned_count,
       price_unsigned_ccoin, price_signed_ccoin, price_ccoin, status, drop_start_at, creator_id, creator_name, sold_count, raffle_end_at)
     values ($1, 'Race Draw', 'Race Draw Series', 'race', '/x.jpg', 1, 0, 1, 10, 20, 10, 'live', now() - interval '26 hours',
       '00000000-0000-4000-8000-000000000003', 'Karina Aespa', 0, now() - interval '1 hour')`,
    [drop4],
  );
  await admin.query(
    `insert into public.cards (id, drop_id, unit_number, variant, status, nfc_uid, nfc_short_id, verify_status, location, nfc_configured, qc_status)
     values ($1, $2, 1, 'unsigned', 'inventory', $3, $4, 'unknown', 'platform_stock', false, 'pending')`,
    [`card-${drop4}-01`, drop4, `RACE${stamp}D1`, `rc4-${stamp}`],
  );
  for (const [i, u] of users.entries()) {
    await admin.query("insert into public.users (id, email, display_name) values ($1, $2, $3) on conflict (id) do nothing", [
      u,
      `${u}@race.test`,
      `Race Draw ${i}`,
    ]);
    await admin.query("insert into public.wallets (user_id, balance_ccoin) values ($1, 1000) on conflict (user_id) do nothing", [u]);
    // entry langsung (hold 10 sudah dianggap) — draw_drop membaca drop_entries
    await admin.query(
      "insert into public.drop_entries (id, drop_id, user_id, pool, hold_ccoin, status) values (gen_random_uuid()::text, $1, $2, 'regular', 10, 'held')",
      [drop4, u],
    );
  }
  await admin.query("commit");

  const draw1 = await admin.query("select public.draw_drop($1) as winners", [drop4]);
  const draw2 = await admin.query("select public.draw_drop($1) as winners", [drop4]);
  const entries = await admin.query("select status, count(*)::int as n from public.drop_entries where drop_id = $1 group by status", [
    drop4,
  ]);
  const balances = await admin.query(
    "select user_id, balance_ccoin::int as b from public.wallets where user_id = any($1) order by user_id",
    [users],
  );
  const winnerOrder = await admin.query("select count(*)::int as n from public.orders where drop_id = $1 and source = 'raffle'", [drop4]);
  const statuses = Object.fromEntries(entries.rows.map((r) => [r.status, r.n]));
  // Fixture menyisipkan entry TANPA mendebet hold — winner tidak di-refund (1000),
  // loser di-refund hold +10 (1010)
  const bal = balances.rows.map((r) => r.b).sort((a, b) => a - b);
  report(
    "R5",
    draw1.rows[0].winners === 1 &&
      draw2.rows[0].winners === 0 &&
      statuses.won_regular === 1 &&
      statuses.refunded === 1 &&
      bal[0] === 1000 &&
      bal[1] === 1010 &&
      winnerOrder.rows[0].n === 1,
    `draw1=${draw1.rows[0].winners} draw2(idempoten)=${draw2.rows[0].winners} status=${JSON.stringify(statuses)} saldo=[${bal}] order_raffle=${winnerOrder.rows[0].n}`,
  );

  await admin.query("begin");
  await admin.query("reset role; alter table public.wallet_transactions disable trigger trg_wtx_immutable");
  await admin.query("delete from public.wallet_transactions where user_id = any($1)", [users]);
  await admin.query("reset role; alter table public.wallet_transactions enable trigger trg_wtx_immutable");
  await admin.query("delete from public.ownership_history where card_id like $1", [`card-${drop4}%`]);
  await admin.query("delete from public.orders where drop_id = $1", [drop4]);
  await admin.query("delete from public.wallets where user_id = any($1)", [users]);
  await admin.query("delete from public.users where id = any($1)", [users]);
  await admin.query("commit");
}

// ── Cleanup fixture ─────────────────────────────────────────────────────────
await admin.query("begin");
await admin.query("reset role; alter table public.wallet_transactions disable trigger trg_wtx_immutable");
const allTest = [...r1Users.map((u) => u.id), r2User.id, r3User.id, r4User.id];
await admin.query("delete from public.wallet_transactions where user_id = any($1)", [allTest]);
await admin.query("reset role; alter table public.wallet_transactions enable trigger trg_wtx_immutable");
await admin.query("delete from public.ownership_history where card_id like $1", [`card-${drop1}%`]);
await admin.query("delete from public.ownership_history where card_id like $1", [`card-${drop2}%`]);
await admin.query("delete from public.ownership_history where card_id like $1", [`card-${drop3}%`]);
await admin.query("delete from public.orders where drop_id = any($1)", [[drop1, drop2, drop3]]);
await admin.query("delete from public.drop_entries where drop_id = any($1)", [[drop3]]);
await admin.query("delete from public.cards where drop_id = any($1)", [[drop1, drop2, drop3]]);
await admin.query("delete from public.drops where id = any($1)", [[drop1, drop2, drop3]]);
await admin.query("delete from public.wallets where user_id = any($1)", [allTest]);
await admin.query("delete from public.users where id = any($1)", [allTest]);
await admin.query("commit");
console.log("CLEANUP OK");
await admin.end();

const failed = results.filter((r) => !r.pass).length;
if (failed > 0) process.exit(1);

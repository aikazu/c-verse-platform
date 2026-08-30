// C.Verse — A1 send_support: fan dukungan C-Coin ke kreator (2026-08-31).
// Jalankan against Supabase lokal (disposable — db reset bebas):
//   node supabase/tests/support_test.mjs postgresql://postgres:postgres@127.0.0.1:54322/postgres
// Skenario:
//   S1: dukungan sukses — saldo pindah penuh (100% ke kreator), 2 baris tx
//       type 'support', XP pengirim naik = amount, XP kreator TIDAK naik
//   S2: dukungan diri sendiri                     -> SELF_SUPPORT
//   S3: amount 0                                  -> INVALID_AMOUNT
//   S4: kreator tidak ada (uuid acak)             -> CREATOR_NOT_FOUND
//   S5: target role 'user' (bukan kreator)        -> CREATOR_NOT_FOUND
//   S6: kreator suspended (flag_reason terisi)    -> CREATOR_NOT_FOUND
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
const sender = { id: "c1000000-0000-4000-8000-000000000001", email: `support-sender-${stamp}@race.test` };
const creator = { id: "c1000000-0000-4000-8000-000000000002", email: `support-creator-${stamp}@race.test` };
const suspendedCreator = { id: "c1000000-0000-4000-8000-000000000003", email: `support-susp-${stamp}@race.test` };
const plainUser = { id: "c1000000-0000-4000-8000-000000000004", email: `support-plain-${stamp}@race.test` };
const allUsers = [sender, creator, suspendedCreator, plainUser].map((u) => u.id);
const AMOUNT = 50;

await admin.query("begin");
for (const u of [sender, creator, suspendedCreator, plainUser]) {
  await admin.query("insert into public.users (id, email, display_name) values ($1, $2, $3)", [u.id, u.email, "Support"]);
  await admin.query("insert into public.wallets (user_id, balance_ccoin) values ($1, $2)", [u.id, u.id === sender.id ? 1000 : 0]);
}
await admin.query("update public.users set role = 'creator' where id = any($1)", [[creator.id, suspendedCreator.id]]);
await admin.query("update public.users set flag_reason = 'suspended-test' where id = $1", [suspendedCreator.id]);
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

async function walletOf(userId) {
  const r = await admin.query("select balance_ccoin, total_spent_ccoin from public.wallets where user_id = $1", [userId]);
  return r.rows[0];
}

// ── S1: dukungan sukses — pindah penuh, 2 tx 'support', XP hanya pengirim ───
{
  const res = await asUser(sender.id, (c) =>
    c.query("select public.send_support($1, $2) as out", [creator.id, AMOUNT]).then(
      (r) => r.rows[0].out,
      (e) => e,
    ),
  );
  if (res instanceof Error) {
    report("S1", false, errCode(res));
  } else {
    const senderWallet = await walletOf(sender.id);
    const creatorWallet = await walletOf(creator.id);
    const txs = await admin.query(
      `select id, user_id, amount_ccoin, balance_after_ccoin, ref_type, ref_id, metadata->>'idempotency_key' as idem
       from public.wallet_transactions where type = 'support' and user_id = any($1) order by amount_ccoin asc`,
      [allUsers],
    );
    const senderXp = await admin.query("select total_xp, cumulative_spend_ccoin, level from public.users where id = $1", [sender.id]);
    const creatorXp = await admin.query("select total_xp from public.users where id = $1", [creator.id]);

    const debit = txs.rows.find((t) => t.user_id === sender.id);
    const credit = txs.rows.find((t) => t.user_id === creator.id);
    const checks = [
      [senderWallet.balance_ccoin === 1000 - AMOUNT, `sender balance ${senderWallet.balance_ccoin}`],
      [senderWallet.total_spent_ccoin === AMOUNT, `sender total_spent ${senderWallet.total_spent_ccoin}`],
      [creatorWallet.balance_ccoin === AMOUNT, `creator balance ${creatorWallet.balance_ccoin}`],
      [txs.rows.length === 2, `tx rows ${txs.rows.length}`],
      [
        debit && debit.amount_ccoin === -AMOUNT && debit.ref_type === "user" && debit.ref_id === creator.id,
        "debit row -50 ref=user/creator",
      ],
      [
        credit && credit.amount_ccoin === AMOUNT && credit.ref_type === "user" && credit.ref_id === sender.id,
        "credit row +50 ref=user/sender",
      ],
      [debit && credit && debit.idem !== credit.idem, "idempotency keys distinct"],
      [
        res.transactionId === (debit?.id ?? null),
        `transactionId ${JSON.stringify(res.transactionId)} vs debit ${JSON.stringify(debit?.id)}`,
      ],
      [res.balanceCcoin === 1000 - AMOUNT, `balanceCcoin ${res.balanceCcoin}`],
      [senderXp.rows[0].total_xp === AMOUNT, `sender total_xp ${senderXp.rows[0].total_xp}`],
      [senderXp.rows[0].cumulative_spend_ccoin === AMOUNT, `sender cumulative_spend ${senderXp.rows[0].cumulative_spend_ccoin}`],
      [senderXp.rows[0].level === 6, `sender level ${senderXp.rows[0].level}`],
      [creatorXp.rows[0].total_xp === 0, `creator total_xp ${creatorXp.rows[0].total_xp}`],
    ];
    const failed = checks.filter(([ok]) => !ok).map(([, d]) => d);
    report("S1", failed.length === 0, failed.join("; ") || "full transfer + XP sender-only");
  }
}

// ── S2: dukungan diri sendiri -> SELF_SUPPORT ───────────────────────────────
{
  const err = await asUser(creator.id, (c) =>
    c.query("select public.send_support($1, 10)", [creator.id]).then(
      () => null,
      (e) => e,
    ),
  );
  const code = err ? errCode(err) : "no-error";
  report("S2", code === "SELF_SUPPORT", code);
}

// ── S3: amount 0 -> INVALID_AMOUNT ──────────────────────────────────────────
{
  const err = await asUser(sender.id, (c) =>
    c.query("select public.send_support($1, 0)", [creator.id]).then(
      () => null,
      (e) => e,
    ),
  );
  const code = err ? errCode(err) : "no-error";
  report("S3", code === "INVALID_AMOUNT", code);
}

// ── S4: kreator tidak ada (uuid acak) -> CREATOR_NOT_FOUND ──────────────────
{
  const ghost = "c9999999-9999-4999-8999-999999999999";
  const err = await asUser(sender.id, (c) =>
    c.query("select public.send_support($1, 10)", [ghost]).then(
      () => null,
      (e) => e,
    ),
  );
  const code = err ? errCode(err) : "no-error";
  report("S4", code === "CREATOR_NOT_FOUND", code);
}

// ── S5: target role 'user' -> CREATOR_NOT_FOUND ─────────────────────────────
{
  const err = await asUser(sender.id, (c) =>
    c.query("select public.send_support($1, 10)", [plainUser.id]).then(
      () => null,
      (e) => e,
    ),
  );
  const code = err ? errCode(err) : "no-error";
  report("S5", code === "CREATOR_NOT_FOUND", code);
}

// ── S6: kreator suspended (flag_reason) -> CREATOR_NOT_FOUND ────────────────
{
  const err = await asUser(sender.id, (c) =>
    c.query("select public.send_support($1, 10)", [suspendedCreator.id]).then(
      () => null,
      (e) => e,
    ),
  );
  const code = err ? errCode(err) : "no-error";
  report("S6", code === "CREATOR_NOT_FOUND", code);
}

// ── Cleanup ─────────────────────────────────────────────────────────────────
await admin.query("set role postgres");
await admin.query("begin");
await admin.query("alter table public.wallet_transactions disable trigger trg_wtx_immutable");
await admin.query("delete from public.wallet_transactions where user_id = any($1)", [allUsers]);
await admin.query("alter table public.wallet_transactions enable trigger trg_wtx_immutable");
await admin.query("delete from public.wallets where user_id = any($1)", [allUsers]);
await admin.query("delete from public.users where id = any($1)", [allUsers]);
await admin.query("commit");
console.log("CLEANUP OK");
await admin.end();

const failed = results.filter((r) => !r.pass).length;
if (failed > 0) process.exit(1);

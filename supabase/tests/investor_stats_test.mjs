// C.Verse — get_investor_stats: RPC agregat Investor Data Pack (ADM-10) untuk
// admin SPA (Lane D 2026-08-31). Menggantikan aproksimasi client-side
// Investor.tsx (limit 1000 → undercount).
// Jalankan against Supabase lokal (disposable — db reset bebas):
//   node supabase/tests/investor_stats_test.mjs postgresql://postgres:postgres@127.0.0.1:54322/postgres
// Skenario:
//   i1 normal user  -> PERMISSION_DENIED (guard is_admin() di body RPC)
//   i2 anon         -> 42501 (revoke execute eksplisit)
//   i3 admin        -> angka RPC = SQL ground truth (users/gmv/secondary/txCount)
//   i4 no-JWT authenticated -> PERMISSION_DENIED (auth.uid() null -> bukan admin)
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

const PERMISSION_DENIED_SQLSTATE = "42501";

const admin = new Client({ connectionString: url });
await admin.connect();
await admin.query("set role service_role");

async function asRole(userId, role) {
  const c = new Client({ connectionString: url });
  await c.connect();
  await c.query(`set role ${role}`);
  if (userId) await c.query(`set request.jwt.claims to '{"sub":"${userId}","role":"${role}"}'`);
  return c;
}

const stamp = Date.now().toString(16);
const adminUid = `7e${stamp.slice(0, 6).padEnd(6, "0")}-0000-4000-8000-00000000d001`;
const userUid = `7e${stamp.slice(0, 6).padEnd(6, "0")}-0000-4000-8000-00000000d002`;

try {
  // ── Fixture: admin + user biasa + beberapa wallet_transactions ─────────────
  await admin.query("insert into public.users (id, email, display_name, role) values ($1, $2, 'Inv Admin', 'admin')", [
    adminUid,
    `inv-admin-${stamp}@inv.test`,
  ]);
  await admin.query("insert into public.users (id, email, display_name) values ($1, $2, 'Inv User')", [
    userUid,
    `inv-user-${stamp}@inv.test`,
  ]);
  await admin.query("insert into public.wallets (user_id, balance_ccoin) values ($1, 0), ($2, 0)", [adminUid, userUid]);
  // GMV: checkout -30 + platform_buy -20 + escrow_hold(card) -10 = 60;
  // secondary (dual-token: dari platform_revenue gross secondary_*): 40 + 20 = 60.
  // payout/royalty di wallet_transactions BUKAN secondary (payout = dana keluar
  // ke IDR, royalty tidak lagi ditulis ke ledger C-Coin). top_up/escrow_hold(bid)
  // di luar keduanya. txCount = 6.
  const txs = [
    ["checkout", -30, "drop", "inv-drop-1"],
    ["platform_buy", -20, "card", "inv-card-1"],
    ["escrow_hold", -10, "card", "inv-card-2"],
    ["escrow_hold", -99, "bid", "inv-bid-1"], // escrow_hold ref bid -> BUKAN GMV
    ["refund", 30, "drop_entry", "inv-ref-1"],
    ["refund", 12, "order", "inv-ref-2"],
  ];
  for (const [type, amount, refType, refId] of txs) {
    await admin.query(
      `insert into public.wallet_transactions (id, user_id, type, amount_ccoin, balance_after_ccoin, ref_type, ref_id, metadata)
       values ($1, $2, $3::wallet_tx_type, $4, 0, $5, $6, '{}'::jsonb)`,
      [`inv-tx-${refId}`, userUid, type, amount, refType, refId],
    );
  }
  // Secondary volume (dual-token): gross settlement di platform_revenue.
  await admin.query(
    `insert into public.platform_revenue (source, ref_type, ref_id, gross_ccoin, platform_ccoin, royalty_ccoin, seller_ccoin)
     values ('secondary_buyout', 'buyout', 'inv-buyout-1', 40, 3, 3, 34),
            ('secondary_bid', 'bid', 'inv-bid-2', 20, 2, 2, 16)`,
  );

  // ══ i1: normal user -> PERMISSION_DENIED ═══════════════════════════════════
  {
    const c = await asRole(userUid, "authenticated");
    const err = await c.query("select public.get_investor_stats()").then(
      () => null,
      (e) => e,
    );
    const code = err ? errCode(err) : "no-error";
    report("i1 user get_investor_stats PERMISSION_DENIED", code === "PERMISSION_DENIED", code);
    await c.end();
  }

  // ══ i2: anon -> 42501 (grant revoked) ══════════════════════════════════════
  {
    const c = await asRole(null, "anon");
    const denied = await c.query("select public.get_investor_stats()").then(
      () => ({ ok: false, detail: "call succeeded" }),
      (e) => ({ ok: e.code === PERMISSION_DENIED_SQLSTATE, detail: errCode(e) }),
    );
    report("i2 anon get_investor_stats 42501", denied.ok, denied.detail);
    await c.end();
  }

  // ══ i3: admin -> angka = SQL ground truth ══════════════════════════════════
  {
    const truth = await admin.query(`
      select
        (select count(*)::int from public.users) as users,
        (select coalesce(sum(abs(amount_ccoin)), 0)::int from public.wallet_transactions
          where type in ('checkout','platform_buy') or (type = 'escrow_hold' and ref_type = 'card')) as gmv,
        (select coalesce(sum(gross_ccoin), 0)::int from public.platform_revenue
          where source in ('secondary_buyout','secondary_bid')) as secondary,
        (select count(*)::int from public.wallet_transactions) as tx_count
    `);
    const expected = truth.rows[0];

    const c = await asRole(adminUid, "authenticated");
    const res = await c.query("select public.get_investor_stats() as stats");
    await c.end();
    const s = res.rows[0]?.stats ?? {};
    const ok =
      Number(s.users) === expected.users &&
      Number(s.gmvCcoin) === expected.gmv &&
      Number(s.secondaryVolCcoin) === expected.secondary &&
      Number(s.txCount) === expected.tx_count;
    report("i3 admin get_investor_stats = ground truth", ok, `rpc=${JSON.stringify(s)} truth=${JSON.stringify(expected)}`);
  }

  // ══ i4: authenticated tanpa JWT (auth.uid() null) -> PERMISSION_DENIED ═════
  {
    const c = await asRole(null, "authenticated");
    const err = await c.query("select public.get_investor_stats()").then(
      () => null,
      (e) => e,
    );
    const code = err ? errCode(err) : "no-error";
    report("i4 no-JWT get_investor_stats PERMISSION_DENIED", code === "PERMISSION_DENIED", code);
    await c.end();
  }
} finally {
  // ── Cleanup fixture ─────────────────────────────────────────────────────────
  try {
    await admin.query("begin");
    await admin.query("alter table public.wallet_transactions disable trigger trg_wtx_immutable");
    await admin.query("delete from public.wallet_transactions where ref_id like 'inv-%'");
    await admin.query("delete from public.platform_revenue where ref_id like 'inv-%'");
    await admin.query("alter table public.wallet_transactions enable trigger trg_wtx_immutable");
    await admin.query("delete from public.wallets where user_id = any($1)", [[adminUid, userUid]]);
    await admin.query("delete from public.users where id = any($1)", [[adminUid, userUid]]);
    await admin.query("commit");
  } catch {
    /* fixture mungkin belum sempat dibuat */
  }
  await admin.end();
}

const failed = results.filter((r) => !r.pass).length;
console.log(`\n${results.length - failed}/${results.length} PASS`);
process.exit(failed > 0 ? 1 : 0);

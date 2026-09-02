// C.Verse — admin_audit_log DB-level guarantees (gap P2-4).
// Jalankan against Supabase lokal (disposable — db reset bebas):
//   node supabase/tests/rpc_audit_log_test.mjs postgresql://postgres:***@127.0.0.1:54322/postgres
//
// TEMUAN STRUKTURAL (assert REALITAS, jangan diadaptasi): TIDAK ADA RPC di
// supabase/migrations/04_rpc.sql yang menulis admin_audit_log — append audit
// dilakukan di API layer (apps/api/src/lib/reads/kyc.ts::logAuditDb, dipanggil
// admin routes; cancel_seed_sale / admin_fulfill_shipment / payout_refund /
// release_seed_sale murni fungsi DB tanpa leg audit). Yang bisa dibuktikan di
// level DB:
//   A1: insert oleh service_role (meniru bentuk insert logAuditDb) → baris
//       terbaca lengkap (actor/action/target/payload); RLS: authenticated
//       tidak bisa baca (0 baris) dan tidak bisa insert (42501 RLS violation).
//   A2: append-only absolut — UPDATE dan DELETE diblokir trigger
//       trg_audit_immutable, bahkan sebagai service_role maupun table owner.
//   A3: bukti negatif — payout_refund happy path (settlement jalan, wallet
//       terkredit) TIDAK menambah baris admin_audit_log manapun.
//
// CATATAN CLEANUP: baris audit fixture SENGAJA tidak dihapus — tabel
// append-only by design (menghapus via cascade FK user juga sengaja dihindari,
// itu celah mutasi). Id memakai prefix unik 'audit-w2b-<stamp>' agar
// akumulasi lintas run tidak saling bertabrakan.
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
await admin.query("set role service_role"); // bypass RLS on cloud transaction pooler
// Cloud transaction pooler occasionally rotates role; wrap to re-assert before each query.
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

const stamp = Date.now().toString(36);
// UUID hanya menerima hex — bangun 30 karakter hex unik per-run.
const hex = (Date.now().toString(16) + Math.random().toString(16).slice(2, 14))
  .replace(/[^0-9a-f]/g, "")
  .padEnd(30, "0")
  .slice(0, 30);
const mkUuid = () => `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(12, 15)}-8${hex.slice(15, 18)}-${hex.slice(18, 30)}`;
// Fixture unik per-run: user admin + user payout, drops/cards tidak diperlukan.
const adminUserId = mkUuid();
const payoutUserId = mkUuid();
const auditRowId = `audit-w2b-${stamp}-1`;
const auditTargetId = `w2b-tgt-${stamp}`;
const payoutId = `w2b-pay-${stamp}`;

// ── Fixture dasar ──────────────────────────────────────────────────────────
await admin.query("begin");
await admin.query("insert into public.users (id, email, display_name) values ($1, $2, 'W2B Admin') on conflict (id) do nothing", [
  adminUserId,
  `${adminUserId}@audit.test`,
]);
await admin.query("insert into public.users (id, email, display_name) values ($1, $2, 'W2B Payee') on conflict (id) do nothing", [
  payoutUserId,
  `${payoutUserId}@audit.test`,
]);
await admin.query("insert into public.wallets (user_id, balance_ccoin) values ($1, 0) on conflict (user_id) do nothing", [payoutUserId]);
await admin.query("commit");

// ── A1: insert service_role (paritas logAuditDb) + RLS read/insert ────────
{
  // Insert meniru apps/api/src/lib/reads/kyc.ts::logAuditDb (service-role client).
  await admin.query(
    `insert into public.admin_audit_log (id, admin_user_id, action, target_table, target_id, payload_summary, ip, session_id)
     values ($1, $2, 'update', 'payouts', $3, $4::jsonb, '127.0.0.1', 'w2b-session')`,
    [auditRowId, adminUserId, auditTargetId, JSON.stringify({ status: "disbursed", batch: "w2b" })],
  );
  const row = (
    await admin.query(
      "select admin_user_id, action::text as action, target_table, target_id, payload_summary, ip, session_id from public.admin_audit_log where id = $1",
      [auditRowId],
    )
  ).rows[0];

  // RLS read: authenticated tanpa policy -> 0 baris (bukan error).
  const u = await asUser(payoutUserId);
  const uRows = await u.query("select id from public.admin_audit_log where target_id = $1", [auditTargetId]);
  // RLS write: insert langsung oleh authenticated -> diblokir policy.
  const uInsert = await u
    .query(
      `insert into public.admin_audit_log (id, admin_user_id, action, target_table, target_id)
       values ($1, $2, 'update', 'payouts', 'hack')`,
      [`audit-w2b-hack-${stamp}`, payoutUserId],
    )
    .then(
      () => "UNEXPECTED_OK",
      (e) => errCode(e),
    );
  await u.end();

  const ok =
    row?.admin_user_id === adminUserId &&
    row?.action === "update" &&
    row?.target_table === "payouts" &&
    row?.target_id === auditTargetId &&
    row?.payload_summary?.status === "disbursed" &&
    row?.ip === "127.0.0.1" &&
    row?.session_id === "w2b-session" &&
    uRows.rows.length === 0 &&
    uInsert.includes("row-level security");
  report(
    "A1 service_role append audit (paritas logAuditDb) + RLS: authenticated tanpa read/insert",
    ok,
    `row=${JSON.stringify(row ?? {})} authReadRows=${uRows.rows.length} authInsert=${uInsert}`,
  );
}

// ── A2: append-only absolut (UPDATE/DELETE diblokir, owner pun) ───────────
{
  const updSvc = await admin
    .query("update public.admin_audit_log set payload_summary = '{\"tampered\":true}' where id = $1", [auditRowId])
    .then(
      () => "UNEXPECTED_OK",
      (e) => errCode(e),
    );
  const delSvc = await admin.query("delete from public.admin_audit_log where id = $1", [auditRowId]).then(
    () => "UNEXPECTED_OK",
    (e) => errCode(e),
  );
  // Sebagai table owner (postgres) pun guard trigger tidak mengecualikan siapa pun.
  // Multi-statement TANPA params (pg menolak multiple commands dengan params);
  // wrapper me-assert service_role lagi di query berikutnya.
  const delOwner = await admin.query(`reset role; delete from public.admin_audit_log where id = '${auditRowId}'`).then(
    () => "UNEXPECTED_OK",
    (e) => errCode(e),
  );
  const stillThere = (await admin.query("select count(*)::int as n from public.admin_audit_log where id = $1", [auditRowId])).rows[0].n;
  const ok =
    updSvc.includes("admin_audit_log is append-only") &&
    delSvc.includes("admin_audit_log is append-only") &&
    delOwner.includes("admin_audit_log is append-only") &&
    stillThere === 1;
  report(
    "A2 append-only absolut: UPDATE/DELETE diblokir service_role + table owner",
    ok,
    `upd=${updSvc} del=${delSvc} delOwner=${delOwner} rowCount=${stillThere}`,
  );
}

// ── A3: payout_refund happy path TIDAK menambah baris audit (TEMUAN) ──────
{
  await admin.query("begin");
  await admin.query(
    "insert into public.payouts (id, user_id, type, ccoin_amount, idr_amount, status) values ($1, $2, 'creator_share', 100, 0, 'pending')",
    [payoutId, payoutUserId],
  );
  await admin.query("commit");

  const auditBefore = (await admin.query("select count(*)::int as n from public.admin_audit_log where target_id = $1", [payoutId])).rows[0]
    .n;
  const refunded = (await admin.query("select status::text as st from public.payout_refund($1) as p", [payoutId])).rows[0].st;
  // Dual-token 2026-09-03: refund payout kredit balik GEMS (lot langsung
  // matured), bukan wallet_transactions C-Coin.
  const credit = (
    await admin.query(
      "select amount::int as amt from public.gem_transactions where user_id = $1 and ref_type = 'payout_refund' and idem_key = $2",
      [payoutUserId, `payout-refund-${payoutId}`],
    )
  ).rows[0];
  const gemWallet = (await admin.query("select balance_gems::int as g from public.wallets where user_id = $1", [payoutUserId])).rows[0];
  const refundLot = (
    await admin.query(
      "select mature_at <= now() as matured from public.gem_lots where user_id = $1 and ref_type = 'payout_refund' and ref_id = $2",
      [payoutUserId, payoutId],
    )
  ).rows[0];
  const auditAfter = (await admin.query("select count(*)::int as n from public.admin_audit_log where target_id = $1", [payoutId])).rows[0]
    .n;

  const ok =
    auditBefore === 0 &&
    refunded === "refunded" &&
    credit?.amt === 100 &&
    gemWallet?.g === 100 &&
    refundLot?.matured === true &&
    auditAfter === 0;
  report(
    "A3 payout_refund sukses (refund 100 -> gems lot matured, status refunded) TANPA leg admin_audit_log (TEMUAN: audit hanya di API layer)",
    ok,
    `auditBefore=${auditBefore} payoutStatus=${refunded} gemsCredit=${credit?.amt} gemsBalance=${gemWallet?.g} lotMatured=${refundLot?.matured} auditAfter=${auditAfter}`,
  );
}

await admin.end();

const failed = results.filter((r) => !r.pass).length;
console.log(`\n${results.length - failed}/${results.length} PASS (fixture audit rows sengaja ditinggal — append-only)`);
process.exit(failed > 0 ? 1 : 0);

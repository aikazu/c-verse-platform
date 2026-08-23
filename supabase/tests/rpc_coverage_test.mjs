// C.Verse — RPC coverage tests (menambal yang belum dieksekusi rpc_race_test).
// Jalankan against Supabase lokal (disposable — db reset bebas):
//   node supabase/tests/rpc_coverage_test.mjs postgresql://postgres:postgres@127.0.0.1:54322/postgres
// X1 (probe PostgREST anon) butuh anon key via env — jangan pernah hardcode key:
//   set SUPABASE_ANON_KEY & SUPABASE_URL_REST=http://127.0.0.1:54321
//   (ambil nilainya dari `npx supabase status -o env`)
// Cakupan:
//   S1-S5 : place_bid / cancel_bid / accept_bid (outbid release, fee 7.5/7.5/85,
//           XP buyer, transfer kepemilikan, race 2 bid concurrent amount sama)
//   M1-M5 : set_buyout / buyout_card (MAX 20 listing, fee split, cooling period
//           24h, creator self-dealing 30d, race 2 buyout, re-sale pasca-cooling)
//   C1-C3 : escrow_auto_release / draw_pending_drops / payout_batch_run (cron)
//   W1-W2 : wallet_credit idempotency + INVALID_AMOUNT
//   X1-X3 : lockdown EXECUTE RPC (anon denied, wallet_debit self-only, dsb.)
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

const stamp = Date.now().toString(36);
const U = {
  seller: "e1000000-0000-4000-8000-000000000001",
  a: "e2000000-0000-4000-8000-000000000001",
  b1: "e3000000-0000-4000-8000-000000000001",
  b2: "e4000000-0000-4000-8000-000000000001",
  creator: "e5000000-0000-4000-8000-000000000001",
  p1: "e6000000-0000-4000-8000-000000000001",
  p2: "e6000000-0000-4000-8000-000000000002",
  p3: "e6000000-0000-4000-8000-000000000003",
  p4: "e6000000-0000-4000-8000-000000000004",
};
let c3BatchId = null;

async function userClient(sub) {
  const c = new Client({ connectionString: url });
  await c.connect();
  await c.query("set role authenticated");
  await c.query(`set request.jwt.claims to '{"sub":"${sub}","role":"authenticated"}'`);
  return c;
}
function expectCode(promise) {
  return promise.then(
    () => "UNEXPECTED_OK",
    (e) => errCode(e),
  );
}
async function balance(userId) {
  const { rows } = await admin.query("select balance_ccoin::int as b from public.wallets where user_id = $1", [userId]);
  return rows[0]?.b;
}

// ── Fixture ────────────────────────────────────────────────────────────────
const POST_DRAW = "now() - interval '25 hours', now() - interval '24 hours'";
await admin.query("begin");
for (const [key, id] of Object.entries(U)) {
  await admin.query("insert into public.users (id, email, display_name) values ($1, $2, $3) on conflict (id) do nothing", [
    id,
    `cov-${key}@test`,
    `Cov ${key}`,
  ]);
  await admin.query("insert into public.wallets (user_id, balance_ccoin) values ($1, 1000) on conflict (user_id) do nothing", [id]);
}
await admin.query(
  `insert into public.drops (id, title, series, narrative, artwork_url, total_units, signed_count, unsigned_count,
     price_unsigned_ccoin, price_signed_ccoin, price_ccoin, status, drop_start_at, creator_id, creator_name, sold_count, raffle_end_at, drawn_at)
   values ('cov-drop-main', 'Cov Drop', 'Cov', 'cov', '/x.jpg', 33, 0, 33, 10, 20, 10, 'live', now() - interval '26 hours',
     $1, 'Cov Creator', 0, ${POST_DRAW})`,
  [U.creator],
);
let unit = 0;
async function insertCard(id, ownerId) {
  unit += 1;
  await admin.query(
    `insert into public.cards (id, drop_id, unit_number, variant, status, owner_id, nfc_uid, nfc_short_id, verify_status, location, nfc_configured, qc_status)
     values ($1, 'cov-drop-main', $2, 'unsigned', $3, $4, $5, $6, $7, $8, true, $9)`,
    ownerId
      ? [id, unit, "sold", ownerId, `COV${stamp}${unit}`, `cv-${stamp}-${unit}`, "verified", "with_owner", "passed"]
      : [id, unit, "inventory", null, `COV${stamp}${unit}`, `cv-${stamp}-${unit}`, "unknown", "platform_stock", "pending"],
  );
}
for (const id of ["cov-card-s1", "cov-card-m1", "cov-card-m3", "cov-card-m4", "cov-card-m5", "cov-card-m6", "cov-card-m7"]) {
  await insertCard(id, U.seller);
}
for (let i = 1; i <= 21; i++) {
  await insertCard(`cov-card-max-${String(i).padStart(2, "0")}`, U.seller);
}
// stok untuk checkout (C1)
for (const id of ["cov-card-stock-1", "cov-card-stock-2", "cov-card-stock-3"]) {
  await insertCard(id, null);
}
await admin.query("commit");

// ── S1: place_bid + outbid release ─────────────────────────────────────────
{
  const a = await userClient(U.a);
  const b1 = await userClient(U.b1);
  await a.query("select public.place_bid('cov-card-s1', 100)");
  const midA = await balance(U.a);
  await b1.query("select public.place_bid('cov-card-s1', 150)");
  const endA = await balance(U.a);
  const endB1 = await balance(U.b1);
  const bids = await admin.query("select status, count(*)::int as n from public.bids where card_id = 'cov-card-s1' group by status");
  const statuses = Object.fromEntries(bids.rows.map((r) => [r.status, r.n]));
  const txA = await admin.query(
    `select type, amount_ccoin::int as amt from public.wallet_transactions
     where user_id = $1 and ((type = 'escrow_hold' and ref_id = 'cov-card-s1')
       or (type = 'escrow_release' and ref_id in (select id from public.bids where card_id = 'cov-card-s1' and bidder_id = $1)))`,
    [U.a],
  );
  const hasHold = txA.rows.some((r) => r.type === "escrow_hold" && r.amt === -100);
  const hasRelease = txA.rows.some((r) => r.type === "escrow_release" && r.amt === 100);
  report(
    "S1",
    midA === 900 && endA === 1000 && endB1 === 850 && statuses.active === 1 && statuses.outbid === 1 && hasHold && hasRelease,
    `midA=${midA} endA=${endA} endB1=${endB1} bids=${JSON.stringify(statuses)} hold_tx=${hasHold} release_tx=${hasRelease}`,
  );
  await a.end();
  await b1.end();
}

// ── S2: guard place_bid ────────────────────────────────────────────────────
{
  const a = await userClient(U.a);
  const b1 = await userClient(U.b1);
  const s = await userClient(U.seller);
  const r1 = await expectCode(b1.query("select public.place_bid('cov-card-s1', 150)"));
  const r2 = await expectCode(b1.query("select public.place_bid('cov-card-s1', 100)"));
  const r3 = await expectCode(s.query("select public.place_bid('cov-card-s1', 200)"));
  const r4 = await expectCode(a.query("select public.place_bid('cov-card-s1', 0)"));
  const r5 = await expectCode(a.query("select public.place_bid('cov-card-nope', 50)"));
  report(
    "S2",
    r1 === "BID_TOO_LOW" && r2 === "BID_TOO_LOW" && r3 === "OWN_CARD" && r4 === "INVALID_AMOUNT" && r5 === "CARD_NOT_FOUND",
    `${r1},${r2},${r3},${r4},${r5}`,
  );
  await a.end();
  await b1.end();
  await s.end();
}

// ── S3: cancel_bid ─────────────────────────────────────────────────────────
{
  const a = await userClient(U.a);
  const b1 = await userClient(U.b1);
  const activeBid = await admin.query("select id from public.bids where card_id = 'cov-card-s1' and status = 'active'");
  const bidId = activeBid.rows[0].id;
  const forbidden = await expectCode(a.query("select public.cancel_bid($1)", [bidId]));
  await b1.query("select public.cancel_bid($1)", [bidId]);
  const afterCancel = await balance(U.b1);
  const notActive = await expectCode(b1.query("select public.cancel_bid($1)", [bidId]));
  report(
    "S3",
    forbidden === "FORBIDDEN" && afterCancel === 1000 && notActive === "NOT_ACTIVE",
    `forbidden=${forbidden} saldo=${afterCancel} re-cancel=${notActive}`,
  );
  await a.end();
  await b1.end();
}

// ── S4: accept_bid (fee 7.5/7.5/85, XP, transfer) ──────────────────────────
{
  const a = await userClient(U.a);
  const s = await userClient(U.seller);
  // pre-award badge first_drop agar delta XP murni spend (badge trigger ownership
  // pertama memang menambah XP — bukan bagian yang diuji di sini)
  await admin.query("select public.award_badge_if_eligible($1, 'first_drop')", [U.a]);
  const xpBefore = await admin.query("select total_xp::int as xp from public.users where id = $1", [U.a]);
  await a.query("select public.place_bid('cov-card-s1', 100)");
  const sellerBefore = await balance(U.seller);
  const creatorBefore = await balance(U.creator);
  await s.query("select public.accept_bid('cov-card-s1', 'buyer_address')");
  const sellerAfter = await balance(U.seller);
  const creatorAfter = await balance(U.creator);
  const xpAfter = await admin.query("select total_xp::int as xp from public.users where id = $1", [U.a]);
  const card = await admin.query(
    "select owner_id, buyout_price_ccoin, status::text as st, location::text as loc from public.cards where id = 'cov-card-s1'",
  );
  const history = await admin.query(
    "select count(*)::int as n from public.ownership_history where card_id = 'cov-card-s1' and acquired_via = 'secondary_bid'",
  );
  // fee = round(100 * 0.075) = 8 -> seller 100 - 16 = 84, royalty 8, buyer XP +100
  const c = card.rows[0];
  report(
    "S4",
    sellerAfter - sellerBefore === 84 &&
      creatorAfter - creatorBefore === 8 &&
      c.owner_id === U.a &&
      c.buyout_price_ccoin === null &&
      c.st === "sold" &&
      c.loc === "with_owner" &&
      xpAfter.rows[0].xp - xpBefore.rows[0].xp === 100 &&
      history.rows[0].n === 1,
    `seller+=${sellerAfter - sellerBefore} royalty+=${creatorAfter - creatorBefore} owner_ok=${c.owner_id === U.a} xp+=${xpAfter.rows[0].xp - xpBefore.rows[0].xp} history=${history.rows[0].n}`,
  );
  await a.end();
  await s.end();
}

// ── S5: race 2 place_bid concurrent amount sama ────────────────────────────
{
  const a = await userClient(U.a);
  const b1 = await userClient(U.b1);
  const outcomes = await Promise.all(
    [a, b1].map((c) =>
      c
        .query("select public.place_bid('cov-card-m4', 120) as bid")
        .then(() => ({ ok: true }))
        .catch((e) => ({ ok: false, code: errCode(e) })),
    ),
  );
  const ok = outcomes.filter((o) => o.ok);
  const tooLow = outcomes.filter((o) => !o.ok && o.code === "BID_TOO_LOW");
  const activeCount = await admin.query("select count(*)::int as n from public.bids where card_id = 'cov-card-m4' and status = 'active'");
  report(
    "S5",
    ok.length === 1 && tooLow.length === 1 && activeCount.rows[0].n === 1,
    `sukses=${ok.length} too_low=${tooLow.length} active=${activeCount.rows[0].n}`,
  );
  await a.end();
  await b1.end();
}

// ── M1: set_buyout list/unlist + MAX 20 ────────────────────────────────────
{
  const s = await userClient(U.seller);
  await s.query("select public.set_buyout('cov-card-m1', 45)");
  const listed = await admin.query("select buyout_price_ccoin::int as p, status::text as st from public.cards where id = 'cov-card-m1'");
  await s.query("select public.set_buyout('cov-card-m1', null)");
  const unlisted = await admin.query("select buyout_price_ccoin, status::text as st from public.cards where id = 'cov-card-m1'");
  for (let i = 1; i <= 20; i++) {
    await s.query("select public.set_buyout($1, 10)", [`cov-card-max-${String(i).padStart(2, "0")}`]);
  }
  const max21 = await expectCode(s.query("select public.set_buyout('cov-card-max-21', 10)"));
  for (let i = 1; i <= 20; i++) {
    await s.query("select public.set_buyout($1, null)", [`cov-card-max-${String(i).padStart(2, "0")}`]);
  }
  report(
    "M1",
    listed.rows[0].p === 45 &&
      listed.rows[0].st === "listed_buyout" &&
      unlisted.rows[0].buyout_price_ccoin === null &&
      unlisted.rows[0].st === "sold" &&
      max21 === "MAX_BUYOUT_ACTIVE",
    `listed=${listed.rows[0].p}/${listed.rows[0].st} unlisted=${unlisted.rows[0].buyout_price_ccoin}/${unlisted.rows[0].st} max21=${max21}`,
  );
  await s.end();
}

// ── M2: buyout_card happy path (fee + release bid aktif) ───────────────────
{
  const s = await userClient(U.seller);
  const b1 = await userClient(U.b1);
  const b2 = await userClient(U.b2);
  await s.query("select public.set_buyout('cov-card-m3', 50)");
  await b2.query("select public.place_bid('cov-card-m3', 30)");
  const sellerBefore = await balance(U.seller);
  const creatorBefore = await balance(U.creator);
  const b1Before = await balance(U.b1);
  const b2Before = await balance(U.b2);
  await b1.query("select public.buyout_card('cov-card-m3')");
  const sellerAfter = await balance(U.seller);
  const creatorAfter = await balance(U.creator);
  const b1After = await balance(U.b1);
  const b2After = await balance(U.b2);
  const card = await admin.query("select owner_id, buyout_price_ccoin, status::text as st from public.cards where id = 'cov-card-m3'");
  const bidStatus = await admin.query("select status from public.bids where card_id = 'cov-card-m3' order by created_at desc limit 1");
  const history = await admin.query(
    "select count(*)::int as n from public.ownership_history where card_id = 'cov-card-m3' and acquired_via = 'secondary_buyout'",
  );
  // price 50: fee = round(50*0.075) = 4 -> seller 42, royalty 4; bid 30 direlease
  const c = card.rows[0];
  report(
    "M2",
    b1Before - b1After === 50 &&
      sellerAfter - sellerBefore === 42 &&
      creatorAfter - creatorBefore === 4 &&
      b2After - b2Before === 30 &&
      c.owner_id === U.b1 &&
      c.buyout_price_ccoin === null &&
      c.st === "sold" &&
      bidStatus.rows[0].status === "outbid" &&
      history.rows[0].n === 1,
    `buyer_debit=${b1Before - b1After} seller+=${sellerAfter - sellerBefore} royalty+=${creatorAfter - creatorBefore} bid_release=${b2After - b2Before} bid=${bidStatus.rows[0].status}`,
  );
  await s.end();
  await b1.end();
  await b2.end();
}

// ── M3: guard buyout (NOT_FOR_SALE / OWN_CARD / COOLING_24H / SELF_DEALING) ─
{
  const s = await userClient(U.seller);
  const b1 = await userClient(U.b1);
  const b2 = await userClient(U.b2);
  const creator = await userClient(U.creator);
  const notForSale = await expectCode(b1.query("select public.buyout_card('cov-card-m1')"));
  await s.query("select public.set_buyout('cov-card-m5', 60)");
  const ownCard = await expectCode(s.query("select public.buyout_card('cov-card-m5')"));
  // cooling 24h: b1 beli -> jual ke b2 -> b2 re-list -> b1 (pemilik lama <24 jam) coba beli lagi
  await b1.query("select public.buyout_card('cov-card-m5')");
  await b1.query("select public.set_buyout('cov-card-m5', 70)");
  await b2.query("select public.buyout_card('cov-card-m5')");
  await b2.query("select public.set_buyout('cov-card-m5', 80)");
  const cooling = await expectCode(b1.query("select public.buyout_card('cov-card-m5')"));
  // creator self-dealing: creator beli kartu dari drop-nya sendiri (<30 hari)
  await s.query("select public.set_buyout('cov-card-m6', 20)");
  const selfDealing = await expectCode(creator.query("select public.buyout_card('cov-card-m6')"));
  report(
    "M3",
    notForSale === "NOT_FOR_SALE" &&
      ownCard === "OWN_CARD" &&
      cooling === "COOLING_PERIOD_24H" &&
      selfDealing === "CREATOR_SELF_DEALING_30D",
    `${notForSale},${ownCard},${cooling},${selfDealing}`,
  );
  await s.end();
  await b1.end();
  await b2.end();
  await creator.end();
}

// ── M4: race 2 buyout_card concurrent ──────────────────────────────────────
{
  const s = await userClient(U.seller);
  const b1 = await userClient(U.b1);
  const b2 = await userClient(U.b2);
  await s.query("select public.set_buyout('cov-card-m6', 40)");
  await s.end();
  const before = (await balance(U.b1)) + (await balance(U.b2));
  const outcomes = await Promise.all(
    [b1, b2].map((c) =>
      c
        .query("select public.buyout_card('cov-card-m6') as card")
        .then(() => ({ ok: true }))
        .catch((e) => ({ ok: false, code: errCode(e) })),
    ),
  );
  const after = (await balance(U.b1)) + (await balance(U.b2));
  const ok = outcomes.filter((o) => o.ok);
  const notForSale = outcomes.filter((o) => !o.ok && o.code === "NOT_FOR_SALE");
  report(
    "M4",
    ok.length === 1 && notForSale.length === 1 && before - after === 40,
    `sukses=${ok.length} not_for_sale=${notForSale.length} total_debit=${before - after}`,
  );
  await b1.end();
  await b2.end();
}

// ── M5: re-sale kartu yang sama pasca cooling period — uang harus tetap jalan
//    (idempotency key buyout/settle/royalty per kartu tidak boleh replay) ───
{
  const s = await userClient(U.seller);
  const b1 = await userClient(U.b1);
  const b2 = await userClient(U.b2);
  await s.query("select public.set_buyout('cov-card-m7', 20)");
  await b1.query("select public.buyout_card('cov-card-m7')"); // b1 owner ke-1
  await b1.query("select public.set_buyout('cov-card-m7', 25)");
  const b1Before2 = await balance(U.b1);
  await b2.query("select public.buyout_card('cov-card-m7')"); // b2 beli dari b1
  const b1After2 = await balance(U.b1);
  await b2.query("select public.set_buyout('cov-card-m7', 30)");
  // lewati cooling period 24 jam
  await admin.query("update public.ownership_history set transferred_at = now() - interval '15 days' where card_id = 'cov-card-m7'");
  const b1Before3 = await balance(U.b1);
  const b2Before3 = await balance(U.b2);
  await b1.query("select public.buyout_card('cov-card-m7')"); // b1 beli LAGI
  const b1After3 = await balance(U.b1);
  const b2After3 = await balance(U.b2);
  const owner = await admin.query("select owner_id from public.cards where id = 'cov-card-m7'");
  // sale ke-2 (harga 25): b1 harus terima 25 - 2*round(1.875)=21
  // sale ke-3 (harga 30): b1 harus debet 30, b2 terima 30 - 2*round(2.25)=26
  report(
    "M5",
    b1After2 - b1Before2 === 21 && b1Before3 - b1After3 === 30 && b2After3 - b2Before3 === 26 && owner.rows[0].owner_id === U.b1,
    `sale2_seller+=${b1After2 - b1Before2} (harus 21) sale3_buyer_debit=${b1Before3 - b1After3} (harus 30) sale3_seller+=${b2After3 - b2Before3} (harus 26)`,
  );
  await s.end();
  await b1.end();
  await b2.end();
}

// ── C1: escrow_auto_release (checkout shipping → held → 7 hari → released) ─
{
  const a = await userClient(U.a);
  const b1 = await userClient(U.b1);
  await admin.query("update public.wallets set balance_ccoin = 100 where user_id = $1", [U.a]);
  await admin.query("update public.wallets set balance_ccoin = 100 where user_id = $1", [U.b1]);
  const ord1 = await a.query(
    "select (public.checkout('cov-drop-main', 'regular', 'shipping', 'Jl. Testing No. 123, Jakarta', 5)).id as oid",
  );
  await b1.query("select public.checkout('cov-drop-main', 'regular', 'shipping', 'Jl. Testing No. 123, Jakarta', 5) as o");
  const agedId = ord1.rows[0].oid;
  const freshCheck = await admin.query("select escrow_status::text as e, status::text as s from public.orders where id = $1", [agedId]);
  // docs I6: shipping release saat DELIVERED + H+7
  await admin.query(
    "update public.orders set created_at = now() - interval '20 days', delivered_at = now() - interval '8 days' where id = $1",
    [agedId],
  );
  const released = await admin.query("select public.escrow_auto_release() as n");
  const aged = await admin.query("select escrow_status::text as e, status::text as s from public.orders where id = $1", [agedId]);
  const fresh = await admin.query(
    "select escrow_status::text as e, status::text as s from public.orders where user_id = $1 order by created_at desc limit 1",
    [U.b1],
  );
  report(
    "C1",
    freshCheck.rows[0].e === "held" &&
      freshCheck.rows[0].s === "paid" &&
      aged.rows[0].e === "released" &&
      aged.rows[0].s === "settled" &&
      fresh.rows[0].e === "held" &&
      released.rows[0].n >= 1,
    `sebelum=${freshCheck.rows[0].e}/${freshCheck.rows[0].s} sesudah=${aged.rows[0].e}/${aged.rows[0].s} order_baru=${fresh.rows[0].e} released_n=${released.rows[0].n}`,
  );
  await a.end();
  await b1.end();
}

// ── C2: draw_pending_drops (cron wrapper) ──────────────────────────────────
{
  await admin.query("begin");
  await admin.query(
    `insert into public.drops (id, title, series, narrative, artwork_url, total_units, signed_count, unsigned_count,
       price_unsigned_ccoin, price_signed_ccoin, price_ccoin, status, drop_start_at, creator_id, creator_name, sold_count, raffle_end_at)
     values ('cov-drop-draw', 'Cov Draw', 'Cov', 'cov', '/x.jpg', 1, 0, 1, 10, 20, 10, 'live', now() - interval '26 hours',
       $1, 'Cov Creator', 0, now() - interval '1 hour')`,
    [U.creator],
  );
  await admin.query(
    `insert into public.cards (id, drop_id, unit_number, variant, status, nfc_uid, nfc_short_id, verify_status, location, nfc_configured, qc_status)
     values ('cov-card-draw-01', 'cov-drop-draw', 1, 'unsigned', 'inventory', 'COVDRAW1', 'cvd-1', 'unknown', 'platform_stock', false, 'pending')`,
  );
  await admin.query(
    "insert into public.drop_entries (id, drop_id, user_id, pool, hold_ccoin, status) values (gen_random_uuid()::text, 'cov-drop-draw', $1, 'regular', 10, 'held')",
    [U.p1],
  );
  await admin.query("commit");

  const n1 = await admin.query("select public.draw_pending_drops() as n");
  const n2 = await admin.query("select public.draw_pending_drops() as n");
  const drawn = await admin.query("select drawn_at is not null as ok from public.drops where id = 'cov-drop-draw'");
  const raffleOrder = await admin.query(
    "select count(*)::int as n from public.orders where drop_id = 'cov-drop-draw' and source = 'raffle'",
  );
  report(
    "C2",
    n1.rows[0].n === 1 && n2.rows[0].n === 0 && drawn.rows[0].ok === true && raffleOrder.rows[0].n === 1,
    `run1=${n1.rows[0].n} run2=${n2.rows[0].n} drawn=${drawn.rows[0].ok} order_raffle=${raffleOrder.rows[0].n}`,
  );
}

// ── C3: payout_batch_run (eligible vs ineligible, totals) ──────────────────
{
  await admin.query("begin");
  await admin.query(
    `insert into public.kyc_records (id, user_id, full_name, nik, address, status) values
     ('cov-kyc-1', $1, 'P Satu', '1234567890123456', 'Jl. Test 1', 'approved'),
     ('cov-kyc-3', $2, 'P Tiga', '1234567890123457', 'Jl. Test 3', 'approved'),
     ('cov-kyc-4', $3, 'P Empat', '1234567890123458', 'Jl. Test 4', 'approved')`,
    [U.p1, U.p3, U.p4],
  );
  await admin.query("update public.wallets set hold_payout_until = now() + interval '30 days' where user_id = $1", [U.p3]);
  await admin.query(
    `insert into public.payouts (id, user_id, type, ccoin_amount, idr_amount, status) values
     ('cov-pay-1', $1, 'creator_share', 100, 0, 'pending'),
     ('cov-pay-2', $2, 'creator_share', 100, 0, 'pending'),
     ('cov-pay-3', $3, 'creator_share', 100, 0, 'pending'),
     ('cov-pay-4', $4, 'creator_share', 5, 0, 'pending')`,
    [U.p1, U.p2, U.p3, U.p4],
  );
  await admin.query("commit");

  const batch1 = await admin.query("select public.payout_batch_run(10) as id");
  c3BatchId = batch1.rows[0].id;
  const batch2 = await admin.query("select public.payout_batch_run(10) as id");
  const rows = await admin.query("select id, batch_id, idr_amount::int as idr from public.payouts where id like 'cov-pay-%' order by id");
  const byId = Object.fromEntries(rows.rows.map((r) => [r.id, r]));
  const batch = await admin.query(
    "select total_ccoin::int as ccoin, total_idr::int as idr, fee_1pct_idr::int as fee from public.payout_batches where id = $1",
    [c3BatchId],
  );
  // hanya cov-pay-1 eligible: 100 C -> net (100-1)*10000 = 990.000, fee 1*10000 = 10.000
  const b = batch.rows[0];
  report(
    "C3",
    c3BatchId !== null &&
      batch2.rows[0].id === null &&
      byId["cov-pay-1"].batch_id === c3BatchId &&
      byId["cov-pay-1"].idr === 990000 &&
      byId["cov-pay-2"].batch_id === null &&
      byId["cov-pay-3"].batch_id === null &&
      byId["cov-pay-4"].batch_id === null &&
      b.ccoin === 100 &&
      b.idr === 990000 &&
      b.fee === 10000,
    `batch=${c3BatchId ? "ok" : "null"} eligible=${byId["cov-pay-1"].batch_id === c3BatchId} no_kyc=${byId["cov-pay-2"].batch_id === null} hold=${byId["cov-pay-3"].batch_id === null} below_min=${byId["cov-pay-4"].batch_id === null} totals=${b.ccoin}C/${b.idr}/${b.fee}`,
  );
}

// ── W1: wallet_credit idempotent ───────────────────────────────────────────
{
  await admin.query("update public.wallets set balance_ccoin = 500, total_topup_ccoin = 0 where user_id = $1", [U.p2]);
  await admin.query("select public.wallet_credit($1, 50, 'top_up', 'test', 'w1', 'cov-idem-w1')", [U.p2]);
  await admin.query("select public.wallet_credit($1, 50, 'top_up', 'test', 'w1', 'cov-idem-w1')", [U.p2]);
  const w = await admin.query("select balance_ccoin::int as b, total_topup_ccoin::int as t from public.wallets where user_id = $1", [U.p2]);
  const txCount = await admin.query(
    "select count(*)::int as n from public.wallet_transactions where metadata->>'idempotency_key' = 'cov-idem-w1'",
  );
  report(
    "W1",
    w.rows[0].b === 550 && w.rows[0].t === 50 && txCount.rows[0].n === 1,
    `saldo=${w.rows[0].b} topup_total=${w.rows[0].t} tx=${txCount.rows[0].n}`,
  );
}

// ── W2: INVALID_AMOUNT ─────────────────────────────────────────────────────
{
  const r1 = await expectCode(admin.query("select public.wallet_credit($1, 0, 'top_up', 'test', 'w2', null)", [U.p2]));
  const r2 = await expectCode(admin.query("select public.wallet_debit($1, -5, 'checkout', 'test', 'w2', null)", [U.p2]));
  report("W2", r1 === "INVALID_AMOUNT" && r2 === "INVALID_AMOUNT", `${r1},${r2}`);
}

// ── X1-X3: lockdown EXECUTE RPC (regresi celah mint via PostgREST) ─────────
// X1 butuh anon key via env (JANGAN hardcode key di script):
//   SUPABASE_ANON_KEY=$(npx supabase status -o json | jq -r .ANON_KEY) \
//   node supabase/tests/rpc_coverage_test.mjs <db-url>
{
  const anonKey = process.env.SUPABASE_ANON_KEY;
  const restUrl = process.env.SUPABASE_URL_REST ?? "http://127.0.0.1:54321";
  async function restRpc(fn, body) {
    const res = await fetch(`${restUrl}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return res.status;
  }
  if (!anonKey) {
    report("X1", true, "SKIP — set env SUPABASE_ANON_KEY (lihat header file) untuk mengaktifkan probe PostgREST anon");
  } else {
    const s1 = await restRpc("wallet_credit", {
      p_user: U.p1,
      p_amount: 999999,
      p_type: "top_up",
      p_ref_type: "hack",
      p_ref_id: "x",
      p_idem: "x-mint",
    });
    const s2 = await restRpc("wallet_debit", {
      p_user: U.p1,
      p_amount: 1,
      p_type: "top_up",
      p_ref_type: "hack",
      p_ref_id: "x",
      p_idem: "x-drain",
    });
    const s3 = await restRpc("award_badge_if_eligible", { p_user: U.p1, p_code: "whale" });
    const s4 = await restRpc("payout_batch_run", {});
    report(
      "X1",
      s1 !== 200 && s2 !== 200 && s3 !== 200 && s4 !== 200,
      `anon rpc wallet_credit=${s1} wallet_debit=${s2} badge=${s3} payout=${s4} (semua harus bukan 200)`,
    );
  }

  // authenticated: debit orang lain FORBIDDEN, debit diri sendiri OK (orders.ts ongkir vault)
  const p2 = await userClient(U.p2);
  const drain = await expectCode(p2.query("select public.wallet_debit($1, 1, 'checkout', 'test', 'x3', 'x3-drain')", [U.p1]));
  const balBefore = await balance(U.p2);
  await p2.query("select public.wallet_debit($1, 10, 'checkout', 'test', 'x4', 'x4-self')", [U.p2]);
  const balAfter = await balance(U.p2);
  report(
    "X2",
    drain === "FORBIDDEN" && balBefore - balAfter === 10,
    `debit_orang_lain=${drain} debit_sendiri=${balBefore - balAfter === 10 ? "ok" : "GAGAL"}`,
  );
  await p2.end();

  // checkout tetap bisa dieksekusi authenticated (auth.uid()-based RPC)
  const p1 = await userClient(U.p1);
  const exec = await expectCode(p1.query("select public.checkout('cov-drop-nope', 'regular')"));
  report("X3", exec === "DROP_NOT_LIVE", `checkout_authenticated=${exec} (harus DROP_NOT_LIVE, bukan permission denied)`);
  await p1.end();
}

// ── X4-X5: guard tulis langsung via PostgREST (audit pass 2) ────────────────
{
  // X4: KYC self-approve via insert langsung harus diblokir trigger
  const b2 = await userClient(U.b2);
  const selfApprove = await expectCode(
    b2.query(
      "insert into public.kyc_records (id, user_id, full_name, nik, address, status) values ('cov-kyc-hack', $1, 'Hack', '1234567890123459', 'Jl. Hack 1', 'approved')",
      [U.b2],
    ),
  );
  const pendingOk = await b2
    .query(
      "insert into public.kyc_records (id, user_id, full_name, nik, address) values ('cov-kyc-pending', $1, 'Ok', '1234567890123460', 'Jl. Ok 1')",
      [U.b2],
    )
    .then(() => true)
    .catch((e) => errCode(e));
  report(
    "X4",
    selfApprove.includes("service-role") && pendingOk === true,
    `self_approve=${selfApprove} pending=${pendingOk === true ? "ok" : pendingOk}`,
  );
  await b2.end();

  // X5: owner set verify_status/qc_status kartu langsung harus diblokir;
  // listing via update langsung tetap terikat MAX 20
  const s = await userClient(U.seller);
  const cardHack = await expectCode(
    s.query(
      "update public.cards set verify_status = 'tamper_detected', qc_status = 'defect', nfc_configured = true where id = 'cov-card-m4'",
    ),
  );
  let maxOk = true;
  let max21 = "";
  for (let i = 1; i <= 20; i++) {
    const r = await expectCode(
      s.query("update public.cards set buyout_price_ccoin = 10 where id = $1", [`cov-card-max-${String(i).padStart(2, "0")}`]),
    );
    if (r !== "UNEXPECTED_OK") maxOk = false;
  }
  max21 = await expectCode(s.query("update public.cards set buyout_price_ccoin = 10 where id = 'cov-card-max-21'"));
  report(
    "X5",
    cardHack.includes("hanya buyout_price") && maxOk && max21 === "MAX_BUYOUT_ACTIVE",
    `card_field_hack=${cardHack} list20=${maxOk ? "ok" : "GAGAL"} max21=${max21}`,
  );
  await s.end();
}

// ── Cleanup ────────────────────────────────────────────────────────────────
await admin.query("begin");
await admin.query("alter table public.wallet_transactions disable trigger trg_wtx_immutable");
await admin.query("delete from public.wallet_transactions where user_id = any($1)", [Object.values(U)]);
await admin.query("alter table public.wallet_transactions enable trigger trg_wtx_immutable");
await admin.query("delete from public.kyc_records where id like 'cov-kyc-%'");
await admin.query("delete from public.payouts where id like 'cov-pay-%'");
if (c3BatchId) await admin.query("delete from public.payout_batches where id = $1", [c3BatchId]);
await admin.query("delete from public.bids where card_id like 'cov-card-%'");
await admin.query("delete from public.ownership_history where card_id like 'cov-card-%'");
await admin.query("delete from public.orders where drop_id like 'cov-%'");
await admin.query("delete from public.drop_entries where drop_id like 'cov-%'");
await admin.query("delete from public.cards where id like 'cov-card-%'");
await admin.query("delete from public.drops where id like 'cov-%'");
await admin.query("delete from public.wallets where user_id = any($1)", [Object.values(U)]);
await admin.query("delete from public.users where id = any($1)", [Object.values(U)]);
await admin.query("commit");
console.log("CLEANUP OK");
await admin.end();

const failed = results.filter((r) => !r.pass).length;
console.log(failed === 0 ? "ALL PASS" : `${failed} FAILED`);
if (failed > 0) process.exit(1);

// C.Verse — Creator Seed C.Card TWO-PHASE SETTLEMENT tests
// (04_rpc.sql::accept_bid/buyout_card/release_seed_sale — sebelumnya
// 20260821020000_seed_two_phase, keputusan user 2026-08-21).
// Jalankan against Supabase lokal (disposable — db reset bebas):
//   node supabase/tests/seed_card_test.mjs postgresql://postgres:***@127.0.0.1:54322/postgres
// Prasyarat: `npx supabase db reset` (04_rpc.sql ter-apply).
// Skenario (FASE C — menggantikan gate-paksa FASE B):
//   T-SEED-1: accept_bid kartu seed saat location<>platform_vault ATAU
//             verify<>verified -> PHASE-1 LOCK (bukan tolak): bid->accepted,
//             kartu 'bid_pending', bid lain di-release, seller BELUM dibayar,
//             ownership BELUM pindah, uang buyer tetap di escrow.
//   T-SEED-1b: selama 'bid_pending' place_bid & set_buyout -> SALE_IN_PROGRESS
//   T-SEED-2b: release_seed_sale SEBELUM vault-in + NFC verified
//             -> SEED_VAULT_IN_REQUIRED; authenticated TIDAK punya akses
//             (grants release = service_role HANYA)
//   T-SEED-2: vault-in (location=platform_vault) + NFC verified
//             + release_seed_sale -> settle SUKSES split 85/7,5/7,5,
//             royalti ke kreator, platform_revenue tercatat, ownership &
//             shipment benar; release kedua -> NO_PENDING_SALE (idempotent)
//   T-SEED-3: kartu NON-seed TIDAK kena gate — accept langsung settle walau
//             with_owner/unknown
//   T-SEED-4: C-13 seed — kreator coba buyout balik kartu seed-nya dalam
//             30 hari (seed drop di-age >30 hari agar guard lama COALESCED
//             created_at miss; anchor = ownership_history 'gift' ke kreator
//             yang baru) -> CREATOR_SELF_DEALING_30D
//   T-SEED-5: buyer normal tetap bisa beli kartu seed vaulted verified
//             langsung (gate tidak over-block)
//   T-SEED-6: buyout seed NOT vaulted -> PHASE-1 (order 'paid'/'held' +
//             kartu 'bid_pending', uang buyer terdebit, seller belum dibayar)
//             -> vault-in + verified + release -> order 'settled', escrow
//             'released', seller 85% + royalti kreator, ownership + shipment
import pgModule from "../../apps/api/node_modules/pg/lib/index.js";

const { Client } = pgModule;

const url = process.argv[2] ?? "postgresql://postgres:***@127.0.0.1:54322/postgres";

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

const stamp = Date.now().toString(16);
function uuid(slot) {
  const s = stamp.slice(0, 12).padEnd(12, "0");
  return `3${String(slot).padStart(7, "0")}-${s.slice(0, 4)}-4000-8000-${s}`;
}
const U = {
  creator: uuid(0),
  buyer: uuid(1),
  normalSeller: uuid(2),
};

async function mkUser(id, name, balance) {
  await admin.query("insert into public.users (id, email, display_name) values ($1, $2, $3) on conflict (id) do nothing", [
    id,
    `${id}@seed.test`,
    name,
  ]);
  await admin.query(
    "insert into public.wallets (user_id, balance_ccoin) values ($1, $2) on conflict (user_id) do update set balance_ccoin = $2",
    [id, balance],
  );
}

/** Seed drop 1-of-1: is_seed=true, creator_id = kreator target (keputusan 2026-08-20). */
async function mkSeedDrop(dropId, cardId, opts = {}) {
  const createdSql = opts.createdAtExpr ? `, created_at` : "";
  const createdVal = opts.createdAtExpr ? `, ${opts.createdAtExpr}` : "";
  await admin.query(
    `insert into public.drops (id, title, series, narrative, artwork_url, total_units, signed_count, unsigned_count,
       price_unsigned_ccoin, price_signed_ccoin, price_ccoin, status, creator_id, creator_name, sold_count, is_seed${createdSql})
     values ($1,'Seed 1-of-1','SEED','narrative','/x.jpg',1,1,0,120,120,120,'live',$2,'Creator Seed',0,true${createdVal})
     on conflict (id) do nothing`,
    [dropId, U.creator],
  );
  await admin.query(
    `insert into public.cards (id, drop_id, unit_number, variant, status, owner_id, nfc_uid, nfc_short_id, verify_status, location, nfc_configured, qc_status)
     values ($1, $2, 1, 'signed', 'sold', $3, $4, $5, 'unknown', 'with_owner', true, 'passed')
     on conflict (id) do nothing`,
    [cardId, dropId, U.creator, `${stamp}-uid-${cardId}`, `sd-${cardId}`],
  );
}

/** Kartu NON-seed untuk T-SEED-3: is_seed=false (default), owner seller biasa. */
async function mkNormalCard(dropId, cardId) {
  await admin.query(
    `insert into public.drops (id, title, series, narrative, artwork_url, total_units, signed_count, unsigned_count,
       price_unsigned_ccoin, price_signed_ccoin, price_ccoin, status, creator_id, creator_name, sold_count)
     values ($1,'Normal Drop','Normal Drop Series','narrative','/x.jpg',1,0,1,10,10,10,'live',$2,'Creator N',0)
     on conflict (id) do nothing`,
    [dropId, U.creator],
  );
  await admin.query(
    `insert into public.cards (id, drop_id, unit_number, variant, status, owner_id, nfc_uid, nfc_short_id, verify_status, location, nfc_configured, qc_status)
     values ($1, $2, 1, 'unsigned', 'sold', $3, $4, $5, 'unknown', 'with_owner', true, 'passed')
     on conflict (id) do nothing`,
    [cardId, dropId, U.normalSeller, `${stamp}-uid-${cardId}`, `nc-${cardId}`],
  );
}

async function walletBalance(userId) {
  const r = await admin.query("select balance_ccoin from public.wallets where user_id = $1", [userId]);
  return r.rows[0]?.balance_ccoin ?? 0;
}

// Dual-token 2026-09-03: settle seller/royalty seed sale masuk balance_gems.
async function gemsBalance(userId) {
  const r = await admin.query("select balance_gems from public.wallets where user_id = $1", [userId]);
  return r.rows[0]?.balance_gems ?? 0;
}

// ── Fixture dasar ──────────────────────────────────────────────────────────
await mkUser(U.creator, "Seed Creator", 0);
await mkUser(U.buyer, "Seed Buyer", 5000);
await mkUser(U.normalSeller, "Normal Seller", 0);

const BID_AMOUNT = 150; // split: ceil(7,5%)=12 platform + 12 royalti + 126 seller (Lane D ceil)

// ── T-SEED-1: accept seed not-vaulted -> PHASE-1 LOCK (bukan tolak) ───────
// ── T-SEED-1b: place_bid/set_buyout saat bid_pending -> SALE_IN_PROGRESS ──
{
  const drop = `seed-t1-${stamp}`;
  const card = `seed-card-t1-${stamp}`;
  await mkSeedDrop(drop, card);

  // Buyer bid (kartu di tangan kreator — GATE LAMA TIDAK ADA: bid BOLEH)
  const cBuyer = await asUser(U.buyer);
  await cBuyer.query("select public.place_bid($1, $2)", [card, BID_AMOUNT]);
  const buyerBalanceAfterBid = await walletBalance(U.buyer); // 5000 - 150 (escrow hold)

  // Owner ACCEPT -> PHASE-1: LOCK, bukan tolak
  const cCreator = await asUser(U.creator);
  let phase1Ok = false;
  try {
    await cCreator.query("select public.accept_bid($1, 'buyer_address', 'Jl. Seed Test No. 1 Jakarta')", [card]);
    phase1Ok = true; // tidak raise SEED_VAULT_IN_REQUIRED
  } catch (e) {
    console.log(`T-SEED-1 unexpected error: ${errCode(e)}`);
  }
  const cardRow = (
    await admin.query("select status, owner_id, location, verify_status, buyout_price_ccoin from public.cards where id = $1", [card])
  ).rows[0];
  const bidRow = (
    await admin.query(
      "select id, status, accepted_at, destination, shipping_address from public.bids where card_id = $1 and status = 'accepted' order by accepted_at desc limit 1",
      [card],
    )
  ).rows[0];
  const creatorBal = await walletBalance(U.creator);

  // SALE_IN_PROGRESS: bid/buyout/pasang buyout ditolak selama bid_pending
  let bidBlocked = false;
  let setBuyoutBlocked = false;
  const cB = await asUser(U.buyer);
  try {
    await cB.query("select public.place_bid($1, 999)", [card]);
  } catch (e) {
    bidBlocked = errCode(e) === "SALE_IN_PROGRESS";
  }
  const cC = await asUser(U.creator);
  try {
    await cC.query("select public.set_buyout($1, 500)", [card]);
  } catch (e) {
    setBuyoutBlocked = errCode(e) === "SALE_IN_PROGRESS";
  }
  await cC.end();

  const ok =
    phase1Ok &&
    cardRow?.status === "bid_pending" &&
    cardRow?.owner_id === U.creator && // ownership BELUM pindah
    cardRow?.location === "with_owner" &&
    cardRow?.verify_status === "unknown" &&
    cardRow?.buyout_price_ccoin === null &&
    bidRow?.status === "accepted" &&
    bidRow?.accepted_at !== null &&
    bidRow?.destination === "buyer_address" &&
    bidRow?.shipping_address === "Jl. Seed Test No. 1 Jakarta" &&
    creatorBal === 0 && // seller BELUM dibayar di PHASE-1
    buyerBalanceAfterBid === 4850 && // uang buyer tetap escrow (5000-150)
    bidBlocked &&
    setBuyoutBlocked;
  report(
    "T-SEED-1 accept owner -> PHASE-1 LOCK (bid accepted, kartu bid_pending, tanpa uang/ownership)",
    ok,
    `phase1=${phase1Ok} status=${cardRow?.status} owner=${cardRow?.owner_id === U.creator ? "creator" : cardRow?.owner_id} bidDest=${bidRow?.destination} sellerBal=${creatorBal} buyerBalAfterBid=${buyerBalanceAfterBid} bidBlocked=${bidBlocked} setBuyoutBlocked=${setBuyoutBlocked}`,
  );
  await cB.end();
}

// ── T-SEED-2b: release SEBELUM vault-in -> SEED_VAULT_IN_REQUIRED + mock ──
// ── T-SEED-2: vault-in + NFC verified -> release SUKSES + idempotent ──────
{
  const drop = `seed-t2-${stamp}`;
  const card = `seed-card-t2-${stamp}`;
  await mkSeedDrop(drop, card);
  const creatorBalBase = await gemsBalance(U.creator);
  const buyerXpBefore = (await admin.query("select total_xp from public.users where id = $1", [U.buyer])).rows[0].total_xp;
  const cBuyer = await asUser(U.buyer);
  await cBuyer.query("select public.place_bid($1, $2)", [card, BID_AMOUNT]);
  const cCreator = await asUser(U.creator);
  await cCreator.query("select public.accept_bid($1, 'buyer_address', 'Jl. Seed Test No. 2 Jakarta')", [card]);
  await cCreator.end();
  await cBuyer.end();

  // (a) authenticated TIDAK punya akses release_seed_sale (grant service_role HANYA)
  let userReleaseDenied = false;
  const cU = await asUser(U.buyer);
  try {
    await cU.query("select public.release_seed_sale($1)", [card]);
  } catch (e) {
    userReleaseDenied = String(e.message).toLowerCase().includes("permission denied");
  }
  await cU.end();

  // (b) release SEBELUM kartu masuk vault + verified -> SEED_VAULT_IN_REQUIRED
  let preVaultBlocked = false;
  try {
    await admin.query("select public.release_seed_sale($1)", [card]);
  } catch (e) {
    preVaultBlocked = errCode(e) === "SEED_VAULT_IN_REQUIRED";
  }
  const creatorBalBefore = await gemsBalance(U.creator);
  const creatorSettled = creatorBalBefore - creatorBalBase; // 0 — belum settle

  // (c) vault-in (lokasi saja — meniru admin PATCH vault-in) + tap NFC
  await admin.query("update public.cards set location = 'platform_vault' where id = $1", [card]);
  await admin.query("update public.cards set verify_status = 'verified' where id = $1", [card]);

  // (d) release -> settle SUKSES
  await admin.query("select public.release_seed_sale($1)", [card]);
  const creatorBal = await gemsBalance(U.creator); // 126 seller + 12 royalti sama akun (gems)
  const rev = await admin.query(
    "select platform_ccoin, royalty_ccoin, seller_ccoin from public.platform_revenue where ref_type = 'bid' and ref_id = (select id from public.bids where card_id = $1 and status = 'accepted' order by accepted_at desc limit 1)",
    [card],
  );
  const ship = await admin.query("select type, from_location, status from public.shipments where card_id = $1 and type = 'secondary_bid'", [
    card,
  ]);
  const cardRow = (await admin.query("select owner_id, location, status from public.cards where id = $1", [card])).rows[0];
  const oh = await admin.query("select acquired_via from public.ownership_history where card_id = $1 and acquired_via = 'secondary_bid'", [
    card,
  ]);
  const buyerXp = (await admin.query("select total_xp from public.users where id = $1", [U.buyer])).rows[0].total_xp;
  const buyerXpDelta = buyerXp - buyerXpBefore;

  // (e) idempotent: release kedua -> NO_PENDING_SALE
  let secondReleaseBlocked = false;
  try {
    await admin.query("select public.release_seed_sale($1)", [card]);
  } catch (e) {
    secondReleaseBlocked = errCode(e) === "NO_PENDING_SALE";
  }

  const ok =
    userReleaseDenied &&
    preVaultBlocked &&
    creatorSettled === 0 && // seller BELUM dibayar sebelum release
    creatorBal - creatorBalBase === 138 && // 126 seller (85%) + 12 royalti (7,5% ceil) GEMS — kreator-owner efektif 92,5%
    Number(rev.rows[0]?.platform_ccoin) === 12 &&
    Number(rev.rows[0]?.royalty_ccoin) === 12 &&
    Number(rev.rows[0]?.seller_ccoin) === 126 &&
    ship.rows[0]?.type === "secondary_bid" &&
    ship.rows[0]?.from_location === "platform" && // kartu release dari vault
    ship.rows[0]?.status === "requested" &&
    cardRow?.owner_id === U.buyer &&
    cardRow?.status === "sold" &&
    cardRow?.location === "with_owner" &&
    oh.rows.length === 1 &&
    buyerXpDelta >= BID_AMOUNT && // spend = amount, plus badge XP (first_drop +100 via ownership trigger)
    secondReleaseBlocked;
  report(
    "T-SEED-2 vault-in+verified -> release 85/7,5/7,5 gems (idempotent, service_role only)",
    ok,
    `userDenied=${userReleaseDenied} preVault=${preVaultBlocked} creatorDelta=${creatorBal - creatorBalBase} rev=${JSON.stringify(rev.rows[0] ?? {})} shipFrom=${ship.rows[0]?.from_location} loc=${cardRow?.location} xpDelta=${buyerXpDelta} secondRelease=${secondReleaseBlocked}`,
  );
}

// ── T-SEED-3: kartu NON-seed TIDAK kena gate (accept langsung settle) ─────
{
  const drop = `seed-t3-${stamp}`;
  const card = `seed-card-t3-${stamp}`;
  await mkNormalCard(drop, card);
  const sellerBalBase = await gemsBalance(U.normalSeller);
  const cBuyer = await asUser(U.buyer);
  await cBuyer.query("select public.place_bid($1, 100)", [card]);
  await cBuyer.end();
  const cSeller = await asUser(U.normalSeller);
  let settled = false;
  try {
    await cSeller.query("select public.accept_bid($1, 'buyer_address', 'Jl. Seed Test No. 3 Semarang')", [card]);
    settled = true; // tidak raise SEED_VAULT_IN_REQUIRED walau with_owner/unknown
  } catch (e) {
    console.log(`T-SEED-3 unexpected error: ${errCode(e)}`);
  }
  await cSeller.end();
  const sellerBal = await gemsBalance(U.normalSeller);
  const cardRow = (await admin.query("select owner_id, status from public.cards where id = $1", [card])).rows[0];
  // split 100 -> round(7,5)=8 platform + 8 royalti + 84 seller GEMS (round half up)
  const sellerDelta = sellerBal - sellerBalBase;
  const ok = settled && sellerDelta === 84 && cardRow?.owner_id === U.buyer && cardRow?.status === "sold";
  report(
    "T-SEED-3 non-seed tanpa gate (accept langsung settle, seller gems)",
    ok,
    `settled=${settled} sellerDelta=${sellerDelta} owner=${cardRow?.owner_id ?? null}`,
  );
}

// ── T-SEED-4: C-13 seed — kreator dilarang buyout balik kartu seed-nya ────
{
  const drop = `seed-t4-${stamp}`;
  const card = `seed-card-t4-${stamp}`;
  // Seed drop di-age 40 hari: guard C-13 LAMA (coalesce drop_start_at/drop_at/
  // created_at) jadi MISS — hanya extension C-13 seed (anchor ownership_history
  // kreator) yang bisa memblok. Serah hadiah [3] = transfer 'gift' ke kreator
  // baru saja (5 hari lalu).
  await mkSeedDrop(drop, card, { createdAtExpr: "now() - interval '40 days'" });
  await admin.query(
    `insert into public.ownership_history (id, card_id, owner_id, acquired_via, transferred_at)
     values ('oh-sd-t4-' || $1::text, $2::text, $3::uuid, 'gift', now() - interval '5 days')
     on conflict (id) do nothing`,
    [stamp, card, U.creator],
  );
  await admin.query(
    "update public.cards set location = 'platform_vault', verify_status = 'verified', buyout_price_ccoin = 300 where id = $1",
    [card],
  );
  // Seller normal membeli dulu (path vaulted settle langsung) -> kartu pindah ke seller
  const cBuyer = await asUser(U.buyer);
  await cBuyer.query("select public.buyout_card($1, 'platform_vault')", [card]);
  await cBuyer.end();
  await admin.query("update public.cards set buyout_price_ccoin = 300 where id = $1", [card]);
  // Kreator coba buyout balik dalam 30 hari sejak serah hadiah -> harus ditolak
  const cCreator = await asUser(U.creator);
  let blocked = false;
  try {
    await cCreator.query("select public.buyout_card($1, 'platform_vault')", [card]);
  } catch (e) {
    blocked = errCode(e) === "CREATOR_SELF_DEALING_30D";
  }
  await cCreator.end();
  const ownerAfter = (await admin.query("select owner_id from public.cards where id = $1", [card])).rows[0].owner_id;
  const ok = blocked && ownerAfter === U.buyer;
  report(
    "T-SEED-4 C-13 seed rebuy blok kreator 30 hari",
    ok,
    `blocked=${blocked} owner=${ownerAfter === U.buyer ? "buyer (aman)" : ownerAfter}`,
  );
}

// ── T-SEED-5: buyer normal tetap bisa beli kartu seed vaulted verified ────
{
  const drop = `seed-t5-${stamp}`;
  const card = `seed-card-t5-${stamp}`;
  await mkSeedDrop(drop, card);
  await admin.query(
    "update public.cards set location = 'platform_vault', verify_status = 'verified', buyout_price_ccoin = 100 where id = $1",
    [card],
  );
  const c = await asUser(U.buyer);
  let bought = false;
  try {
    await c.query("select public.buyout_card($1, 'platform_vault')", [card]);
    bought = true;
  } catch (e) {
    console.log(`T-SEED-5 unexpected error: ${errCode(e)}`);
  }
  await c.end();
  const ownerAfter = (await admin.query("select owner_id from public.cards where id = $1", [card])).rows[0].owner_id;
  report(
    "T-SEED-5 buyer normal bisa beli seed (vault-in verified)",
    bought && ownerAfter === U.buyer,
    `bought=${bought} owner=${ownerAfter === U.buyer ? "buyer" : ownerAfter}`,
  );
}

// ── T-SEED-6: buyout seed NOT vaulted -> PHASE-1 order -> release settle ──
{
  const drop = `seed-t6-${stamp}`;
  const card = `seed-card-t6-${stamp}`;
  await mkSeedDrop(drop, card);
  const creatorBalBase = await gemsBalance(U.creator);
  const buyerBalBefore = await walletBalance(U.buyer);
  await admin.query("update public.cards set buyout_price_ccoin = 200 where id = $1", [card]);
  const c = await asUser(U.buyer);
  let phase1 = false;
  try {
    await c.query("select public.buyout_card($1, 'buyer_address', 'Jl. Seed Test No. 6 Surabaya')", [card]);
    phase1 = true; // PHASE-1: order dibuat, bukan settle
  } catch (e) {
    console.log(`T-SEED-6 unexpected error: ${errCode(e)}`);
  }
  await c.end();
  const orderRow = (
    await admin.query(
      "select id, status, escrow_status, source, delivery_option, shipping_address, total_ccoin from public.orders where card_id = $1 and source = 'secondary_buyout' order by created_at desc limit 1",
      [card],
    )
  ).rows[0];
  const cardPhase1 = (await admin.query("select status, owner_id, buyout_price_ccoin from public.cards where id = $1", [card])).rows[0];
  const creatorBeforeRelease = await gemsBalance(U.creator);
  const buyerAfterPhase1 = await walletBalance(U.buyer);
  const buyerDebit = buyerBalBefore - buyerAfterPhase1; // 200 — debit PHASE-1 (ccoin)

  // SALE_IN_PROGRESS juga berlaku saat order buyout pending
  let bidBlocked = false;
  const cB = await asUser(U.buyer);
  try {
    await cB.query("select public.place_bid($1, 999)", [card]);
  } catch (e) {
    bidBlocked = errCode(e) === "SALE_IN_PROGRESS";
  }
  await cB.end();

  // release SEBELUM vault -> SEED_VAULT_IN_REQUIRED
  let preVaultBlocked = false;
  try {
    await admin.query("select public.release_seed_sale($1)", [card]);
  } catch (e) {
    preVaultBlocked = errCode(e) === "SEED_VAULT_IN_REQUIRED";
  }
  // vault-in + verified -> release (path B: order pending)
  await admin.query("update public.cards set location = 'platform_vault' where id = $1", [card]);
  await admin.query("update public.cards set verify_status = 'verified' where id = $1", [card]);
  await admin.query("select public.release_seed_sale($1)", [card]);

  const creatorBal = await gemsBalance(U.creator); // 170 seller + 15 royalti (gems)
  const rev = await admin.query(
    "select platform_ccoin, royalty_ccoin, seller_ccoin from public.platform_revenue where ref_type = 'order' and ref_id = $1",
    [orderRow?.id],
  );
  const orderAfter = (await admin.query("select status, escrow_status from public.orders where id = $1", [orderRow?.id])).rows[0];
  const cardAfter = (await admin.query("select status, owner_id, location from public.cards where id = $1", [card])).rows[0];
  const ship = await admin.query(
    "select type, from_location, status from public.shipments where card_id = $1 and type = 'secondary_buyout'",
    [card],
  );
  const oh = await admin.query(
    "select acquired_via, order_id from public.ownership_history where card_id = $1 and acquired_via = 'secondary_buyout'",
    [card],
  );

  const ok =
    phase1 &&
    orderRow?.status === "paid" &&
    orderRow?.escrow_status === "held" &&
    orderRow?.source === "secondary_buyout" &&
    orderRow?.delivery_option === "shipping" &&
    orderRow?.total_ccoin === 200 &&
    cardPhase1?.status === "bid_pending" &&
    cardPhase1?.owner_id === U.creator &&
    cardPhase1?.buyout_price_ccoin === null &&
    buyerDebit === 200 && // uang buyer terdebit DI PHASE-1 (escrow_hold)
    creatorBeforeRelease - creatorBalBase === 0 && // seller BELUM dibayar
    bidBlocked &&
    preVaultBlocked &&
    creatorBal - creatorBalBase === 185 && // 170 (85%) + 15 (7,5%) GEMS
    Number(rev.rows[0]?.platform_ccoin) === 15 &&
    Number(rev.rows[0]?.royalty_ccoin) === 15 &&
    Number(rev.rows[0]?.seller_ccoin) === 170 &&
    orderAfter?.status === "settled" &&
    orderAfter?.escrow_status === "released" &&
    cardAfter?.status === "sold" &&
    cardAfter?.owner_id === U.buyer &&
    cardAfter?.location === "with_owner" &&
    ship.rows[0]?.type === "secondary_buyout" &&
    ship.rows[0]?.from_location === "platform" &&
    ship.rows[0]?.status === "requested" &&
    oh.rows.length === 1 &&
    oh.rows[0]?.order_id === orderRow?.id;
  report(
    "T-SEED-6 buyout seed -> PHASE-1 order held -> release settle (path B)",
    ok,
    `phase1=${phase1} order=${orderRow?.status}/${orderRow?.escrow_status} card=${cardPhase1?.status} preVault=${preVaultBlocked} creatorDelta=${creatorBal - creatorBalBase} buyerDebit=${buyerDebit} rev=${JSON.stringify(rev.rows[0] ?? {})} orderAfter=${orderAfter?.status}/${orderAfter?.escrow_status}`,
  );
}

// ── T-SEED-7 (P2-2): cancel_seed_sale — admin abort PHASE-1 (path bid) ────
// Refund penuh escrow buyer, bid -> 'cancelled', kartu -> 'inventory'
// (tradable lagi), seller tidak pernah dibayar, XP TIDAK di-grant di PHASE-1
// (release belum terjadi — tidak ada yang perlu di-revoke), dan RPC INI
// TIDAK menulis admin_audit_log (append audit ada di API layer).
{
  const drop = `seed-t7-${stamp}`;
  const card = `seed-card-t7-${stamp}`;
  await mkSeedDrop(drop, card);
  const buyerBalBase = await walletBalance(U.buyer);
  const creatorBalBase = await walletBalance(U.creator);
  const buyerXpBase = (
    await admin.query("select total_xp::int as xp, cumulative_spend_ccoin::int as spend from public.users where id = $1", [U.buyer])
  ).rows[0];
  const auditBase = (await admin.query("select count(*)::int as n from public.admin_audit_log where target_id = $1", [card])).rows[0].n;

  const cBuyer = await asUser(U.buyer);
  await cBuyer.query("select public.place_bid($1, $2)", [card, BID_AMOUNT]);
  await cBuyer.end();
  const cCreator = await asUser(U.creator);
  await cCreator.query("select public.accept_bid($1, 'buyer_address', 'Jl. Seed Test No. 7 Jakarta')", [card]);
  await cCreator.end();
  const escrowBal = await walletBalance(U.buyer); // base - 150 (escrow hold)
  const creatorPhase1 = await walletBalance(U.creator); // 0 delta — belum dibayar

  const res = await admin.query("select public.cancel_seed_sale($1) as r", [card]);
  const r = res.rows[0].r;
  const buyerBalAfter = await walletBalance(U.buyer);
  const buyerXpAfter = (
    await admin.query("select total_xp::int as xp, cumulative_spend_ccoin::int as spend from public.users where id = $1", [U.buyer])
  ).rows[0];
  const bidRow = (
    await admin.query("select status, cancelled_at from public.bids where card_id = $1 order by created_at desc limit 1", [card])
  ).rows[0];
  const cardRow = (await admin.query("select status, owner_id from public.cards where id = $1", [card])).rows[0];
  const abortTx = (
    await admin.query(
      "select amount_ccoin::int as amt from public.wallet_transactions where user_id = $1 and type = 'seed_abort' and metadata->>'idempotency_key' = $2",
      [U.buyer, `seed-abort-${card}`],
    )
  ).rows[0];
  const auditAfter = (await admin.query("select count(*)::int as n from public.admin_audit_log where target_id = $1", [card])).rows[0].n;

  // idempotent: panggilan kedua -> alreadyAborted tanpa double-credit
  const r2 = (await admin.query("select public.cancel_seed_sale($1) as r", [card])).rows[0].r;
  const buyerBalFinal = await walletBalance(U.buyer);

  // guard: kartu non-seed -> NOT_SEED_CARD
  const notSeed = await admin.query("select public.cancel_seed_sale($1)", [`seed-card-t3-${stamp}`]).then(
    () => "UNEXPECTED_OK",
    (e) => errCode(e),
  );

  const ok =
    r?.refundedCcoin === BID_AMOUNT &&
    r?.buyerId === U.buyer &&
    r?.path === "bid" &&
    escrowBal === buyerBalBase - BID_AMOUNT && // escrow terpotong PHASE-1
    creatorPhase1 === creatorBalBase && // seller tidak pernah dibayar
    buyerBalAfter - buyerBalBase === 0 && // refund penuh
    abortTx?.amt === BID_AMOUNT && // tx seed_abort +150, idem key per kartu
    buyerXpAfter.xp === buyerXpBase.xp && // XP: tidak di-grant di PHASE-1, tidak di-revoke
    buyerXpAfter.spend === buyerXpBase.spend && // cumulative_spend juga tak tersentuh
    bidRow?.status === "cancelled" &&
    bidRow?.cancelled_at !== null &&
    cardRow?.status === "inventory" && // tradable lagi
    cardRow?.owner_id === U.creator && // ownership tidak pernah pindah
    auditBase === 0 &&
    auditAfter === 0 && // RPC TIDAK menulis admin_audit_log
    r2?.alreadyAborted === true &&
    r2?.refundedCcoin === BID_AMOUNT &&
    buyerBalFinal === buyerBalAfter && // tanpa double-credit
    notSeed === "NOT_SEED_CARD";
  report(
    "T-SEED-7 cancel_seed_sale abort PHASE-1 (refund penuh, bid cancelled, kartu inventory, idempotent)",
    ok,
    `refund=${r?.refundedCcoin}/${r?.path} escrow=${escrowBal} refundDelta=${buyerBalAfter - buyerBalBase} abortTx=${abortTx?.amt} xpDelta=${buyerXpAfter.xp - buyerXpBase.xp} bid=${bidRow?.status} card=${cardRow?.status}/${cardRow?.owner_id === U.creator ? "creator" : cardRow?.owner_id} auditRows=${auditAfter} alreadyAborted=${r2?.alreadyAborted ?? false} second=${buyerBalFinal === buyerBalAfter ? "no-double-credit" : "DOUBLE-CREDIT"} notSeed=${notSeed}`,
  );
}

await admin.end();

const failed = results.filter((r) => !r.pass).length;
console.log(`\n${results.length - failed}/${results.length} PASS`);
process.exit(failed > 0 ? 1 : 0);

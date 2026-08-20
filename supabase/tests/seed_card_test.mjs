// C.Verse — Creator Seed C.Card vault-in gate tests (migration 20260821000000).
// Jalankan against Supabase lokal (disposable — db reset bebas):
//   node supabase/tests/seed_card_test.mjs postgresql://postgres:***@127.0.0.1:54322/postgres
// Prasyarat: `npx supabase db reset` (migration 20260821000000_seed_card ter-apply).
// Skenario (FASE B, keputusan 2026-08-20):
//   T-SEED-1: accept_bid/buyout_card kartu seed saat location<>platform_vault
//             ATAU verify_status<>verified -> SEED_VAULT_IN_REQUIRED
//   T-SEED-2: setelah vault-in (location=platform_vault) + NFC verified
//             -> settle SUKSES, split 85/7,5/7,5, royalti ke kreator,
//             platform_revenue tercatat
//   T-SEED-3: kartu NON-seed TIDAK terkena gate (settle normal walau
//             location<>vault) — pastikan gate tidak bocor ke kartu biasa
//   T-SEED-4: C-13 seed — kreator coba buyout balik kartu seed-nya dalam
//             30 hari (seed drop di-age >30 hari agar guard lama COALESCED
//             created_at miss; anchor = ownership_history 'gift' ke kreator
//             yang baru) -> CREATOR_SELF_DEALING_30D
//   T-SEED-5: buyer normal tetap bisa beli kartu seed setelah vault-in
//             verified (gate tidak over-block)
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

// ── Fixture dasar ──────────────────────────────────────────────────────────
await mkUser(U.creator, "Seed Creator", 0);
await mkUser(U.buyer, "Seed Buyer", 5000);
await mkUser(U.normalSeller, "Normal Seller", 0);

// ── T-SEED-1: gate menolak settle sebelum vault-in + NFC verified ─────────
{
  const drop = `seed-t1-${stamp}`;
  const card = `seed-card-t1-${stamp}`;
  await mkSeedDrop(drop, card);
  const cCreator = await asUser(U.creator);
  await cCreator.query("select public.set_buyout($1, 200)", [card]); // listing kreator
  await cCreator.end();
  const c = await asUser(U.buyer);
  let buyoutBlocked = false;
  try {
    await c.query("select public.buyout_card($1, 'buyer_address', 'Jl. Seed Test No. 1 Jakarta')", [card]);
  } catch (e) {
    buyoutBlocked = errCode(e) === "SEED_VAULT_IN_REQUIRED";
  }
  let bidAcceptBlocked = false;
  try {
    await c.query("select public.place_bid($1, 150)", [card]);
    const cs = await asUser(U.creator);
    await cs.query("select public.accept_bid($1, 'buyer_address', 'Jl. Seed Test No. 2 Jakarta')", [card]);
    await cs.end();
  } catch (e) {
    bidAcceptBlocked = errCode(e) === "SEED_VAULT_IN_REQUIRED";
  }
  await c.end();
  const cardRow = (await admin.query("select status, owner_id, location, verify_status from public.cards where id = $1", [card])).rows[0];
  const acceptedRows = (await admin.query("select count(*)::int as n from public.bids where card_id = $1 and status = 'accepted'", [card]))
    .rows[0].n;
  // Gate menolak SETTLE — bid boleh tetap aktif menunggu vault-in (perilaku
  // benar: buyer boleh bid sejak listing; hanya settle yang di-gate).
  const ok =
    buyoutBlocked &&
    bidAcceptBlocked &&
    cardRow?.status === "listed_buyout" &&
    cardRow?.owner_id === U.creator &&
    cardRow?.location === "with_owner" &&
    cardRow?.verify_status === "unknown" &&
    acceptedRows === 0;
  report(
    "T-SEED-1 gate vault-in blok settle",
    ok,
    `buyout=${buyoutBlocked} acceptBid=${bidAcceptBlocked} loc=${cardRow?.location} vs=${cardRow?.verify_status} status=${cardRow?.status} acceptedBids=${acceptedRows}`,
  );
}

// ── T-SEED-2: vault-in (location=vault) + NFC verified -> settle SUKSES ───
{
  const drop = `seed-t2-${stamp}`;
  const card = `seed-card-t2-${stamp}`;
  await mkSeedDrop(drop, card);
  // Meniru path admin vault-in (apps/api PATCH /cards/:id/vault-in: lokasi saja)
  // + tap NFC (nfc.ts — satu-satunya jalur verify_status='verified', crypto CMAC).
  await admin.query("update public.cards set location = 'platform_vault' where id = $1", [card]);
  await admin.query("update public.cards set verify_status = 'verified' where id = $1", [card]);
  await admin.query("update public.cards set buyout_price_ccoin = 200 where id = $1", [card]);
  const c = await asUser(U.buyer);
  let settled = false;
  try {
    await c.query("select public.buyout_card($1, 'buyer_address', 'Jl. Seed Test No. 3 Bandung')", [card]);
    settled = true;
  } catch (e) {
    console.log(`T-SEED-2 unexpected error: ${errCode(e)}`);
  }
  await c.end();
  const creatorBal = await walletBalance(U.creator);
  const rev = await admin.query(
    "select platform_ccoin, royalty_ccoin, seller_ccoin from public.platform_revenue where ref_type = 'buyout' and ref_id in (select id from public.wallet_transactions where ref_id = $1 and type = 'platform_buy')",
    [card],
  );
  const ship = await admin.query("select type, status from public.shipments where card_id = $1", [card]);
  const cardRow = (await admin.query("select owner_id, location, status from public.cards where id = $1", [card])).rows[0];
  const ok =
    settled &&
    creatorBal === 185 && // seller 85% (170) + royalti kreator 7,5% (15) — kreator-owner efektif 92,5%
    Number(rev.rows[0]?.platform_ccoin) === 15 &&
    Number(rev.rows[0]?.royalty_ccoin) === 15 &&
    Number(rev.rows[0]?.seller_ccoin) === 170 &&
    ship.rows[0]?.type === "secondary_buyout" &&
    ship.rows[0]?.status === "requested" &&
    cardRow?.owner_id === U.buyer &&
    cardRow?.location === "with_owner" &&
    cardRow?.status === "sold";
  report(
    "T-SEED-2 vault-in + verified -> settle 85/7,5/7,5",
    ok,
    `creatorBal=${creatorBal} rev=${JSON.stringify(rev.rows[0] ?? {})} ship=${ship.rows[0]?.type} loc=${cardRow?.location}`,
  );
}

// ── T-SEED-3: kartu NON-seed TIDAK kena gate ───────────────────────────────
{
  const drop = `seed-t3-${stamp}`;
  const card = `seed-card-t3-${stamp}`;
  await mkNormalCard(drop, card);
  await admin.query("update public.cards set buyout_price_ccoin = 100 where id = $1", [card]);
  const c = await asUser(U.buyer);
  let settled = false;
  try {
    await c.query("select public.buyout_card($1, 'buyer_address', 'Jl. Seed Test No. 4 Semarang')", [card]);
    settled = true; // tidak raise SEED_VAULT_IN_REQUIRED
  } catch (e) {
    console.log(`T-SEED-3 unexpected error: ${errCode(e)}`);
  }
  await c.end();
  const sellerBal = await walletBalance(U.normalSeller);
  const cardRow = (await admin.query("select owner_id, status from public.cards where id = $1", [card])).rows[0];
  // split 100 -> round(7,5)=8 platform + 8 royalti + 84 seller (round half up)
  const ok = settled && sellerBal === 84 && cardRow?.owner_id === U.buyer && cardRow?.status === "sold";
  report("T-SEED-3 non-seed tanpa gate", ok, `settled=${settled} seller=${sellerBal} owner=${cardRow?.owner_id ?? null}`);
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
  // Seller normal membeli dulu (path T-SEED-2 sukses) -> kartu pindah ke seller
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

// ── T-SEED-5: buyer normal masih bisa beli kartu seed (gate tidak over-block) ──
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

await admin.end();

const failed = results.filter((r) => !r.pass).length;
console.log(`\n${results.length - failed}/${results.length} PASS`);
process.exit(failed > 0 ? 1 : 0);

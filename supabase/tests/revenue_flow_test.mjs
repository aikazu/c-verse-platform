// C.Verse — Revenue & flow hardening tests (04_rpc.sql — sebelumnya phase 7).
// Jalankan against Supabase lokal (disposable — db reset bebas):
//   node supabase/tests/revenue_flow_test.mjs postgresql://postgres:postgres@127.0.0.1:54322/postgres
// Prasyarat: `npx supabase db reset` (04_rpc.sql + seed).
// Skenario:
//   T1 checkout FCFS vault-only (founder 2026-08-28) -> order settled + kartu
//      platform_vault + platform_revenue 70/30 + kredit treasury + royalty creator
//   T2 draw_drop: pool premium jatuh ke regular -> refund selisih hold - price
//   T3 place_bid: maks 3 bid aktif per user -> BID_LIMIT pada bid ke-4
//   T4 wallet_credit top_up: cap 500 non-KYC; KYC approved tanpa cap
//   T5 payout_request: KYC_REQUIRED / MIN_PAYOUT / happy path (debit + payouts row) / PAYOUT_HELD
//   T6 buyout_card vault-only settle -> kartu platform_vault, TANPA shipment, split 8/8/84
//   T7 accept_bid vault-only settle -> kartu platform_vault, TANPA shipment, split 5/5/50
//   T8 vault_shipout: fee debit + treasury + platform_revenue 'shipment' +
//      shipment requested; repeat shipout aktif -> SHIPMENT_ACTIVE; non-owner -> FORBIDDEN
//   T9 activate_scheduled_drops: scheduled lewat start -> live; live lewat end -> closed
//   T10 checkout pool='premium': harga = price_signed_ccoin (kolom; +20 flat
//      dihitung app-level via calcSignedPrice), split 70/30 atas harga signed
//   T11 accept_bid harga kecil — split CEIL (Lane D 2026-08-31): price 6 ->
//      platform 1 + royalty 1 + seller 4 (round lama 0/0/6 = revenue evaporation)
import pgModule from "../../apps/api/node_modules/pg/lib/index.js";

const { Client } = pgModule;

const url = process.argv[2] ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const TREASURY = "00000000-0000-4000-8000-0000000000c0";

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

const stamp = Date.now().toString(16); // hex-only agar aman untuk uuid
// uuid deterministik per-run (hex-only; bentrok antar-run dihindari via stamp)
function uuid(slot) {
  const s = stamp.slice(0, 12).padEnd(12, "0");
  return `2${String(slot).padStart(7, "0")}-${s.slice(0, 4)}-4000-8000-${s}`;
}
const U = { creator: uuid(0) };

async function mkUser(id, name, balance) {
  await admin.query("insert into public.users (id, email, display_name) values ($1, $2, $3) on conflict (id) do nothing", [
    id,
    `${id}@flow.test`,
    name,
  ]);
  await admin.query(
    "insert into public.wallets (user_id, balance_ccoin) values ($1, $2) on conflict (user_id) do update set balance_ccoin = $2",
    [id, balance],
  );
}

async function mkDrop(id, opts) {
  const {
    units = 1,
    signed = 0,
    priceU = 100,
    priceS = 120,
    status = "live",
    raffleEnd = "now() + interval '1 hour'",
    drawn = null,
    start = "now() - interval '26 hours'",
    end = null,
  } = opts;
  await admin.query(
    `insert into public.drops (id, title, series, narrative, artwork_url, total_units, signed_count, unsigned_count,
       price_unsigned_ccoin, price_signed_ccoin, price_ccoin, status, drop_start_at, drop_end_at, raffle_end_at, drawn_at, creator_id, creator_name, sold_count)
     values ($1,'Flow Test','FTS','fixture','/x.jpg',$2,$3,$4,$5,$6,$5,'${status}',${start},${end ?? "null"},${raffleEnd},${drawn ?? "null"},$7,'Creator FT',0)
     on conflict (id) do nothing`,
    [id, units, signed, units - signed, priceU, priceS, U.creator],
  );
  await admin.query(
    `insert into public.cards (id, drop_id, unit_number, variant, status, owner_id, nfc_uid, nfc_short_id, verify_status, location, nfc_configured, qc_status)
     select 'card-' || $1 || '-' || lpad(i::text, 2, '0'), $1, i,
       case when i <= $2 then 'signed' else 'unsigned' end::card_variant, 'inventory', null,
       md5($1 || i::text), left(md5($1), 4) || '-' || lpad(i::text, 3, '0'),
       'unknown', 'platform_stock', false, 'pending'
     from generate_series(1, $3::int) i
     on conflict (id) do nothing`,
    [id, signed, units],
  );
}

async function walletBalance(userId) {
  const r = await admin.query("select balance_ccoin from public.wallets where user_id = $1", [userId]);
  return r.rows[0]?.balance_ccoin ?? 0;
}

// Dual-token 2026-09-03: pendapatan settlement (royalty/seller/support) masuk
// balance_gems — helper terpisah agar asersi tidak menuang keduanya.
async function gemsBalance(userId) {
  const r = await admin.query("select balance_gems from public.wallets where user_id = $1", [userId]);
  return r.rows[0]?.balance_gems ?? 0;
}

try {
  // ── Fixture dasar ──────────────────────────────────────────────────────────
  await mkUser(U.creator, "Flow Creator", 0);

  // ══ T1: checkout FCFS vault-only -> revenue 70/30 + treasury + settled ════
  {
    const buyer = uuid(1);
    const drop = `flow-t1-${stamp}`;
    await mkUser(buyer, "T1 Buyer", 500);
    await mkDrop(drop, {
      units: 1,
      signed: 0,
      priceU: 100,
      raffleEnd: "now() - interval '25 hours'",
      drawn: "now() - interval '24 hours'",
    });
    const c = await asUser(buyer);
    const treasuryBefore = await walletBalance(TREASURY);
    // guard pool (dipulihkan 2026-08-28): INVALID_POOL sebelum checkout sah,
    // tanpa side effect (guard berada sebelum kartu dipilih)
    let invalidPool = false;
    try {
      await c.query("select public.checkout($1, 'both')", [drop]);
    } catch (e) {
      invalidPool = errCode(e) === "INVALID_POOL";
    }
    await c.query("select public.checkout($1, 'regular')", [drop]); // vault-only settle
    await c.end();
    const order = await admin.query(
      "select status::text as s, escrow_status::text as e, delivery_option::text as d, shipping_fee_ccoin, shipping_address from public.orders where drop_id = $1",
      [drop],
    );
    const cardLoc = await admin.query(
      "select location::text as l from public.cards where id = (select card_id from public.orders where drop_id = $1)",
      [drop],
    );
    const rev = await admin.query(
      "select gross_ccoin, platform_ccoin, royalty_ccoin, fee_snapshot->>'platform_pct' as pct from public.platform_revenue where ref_type = 'order' and ref_id in (select id from public.orders where drop_id = $1)",
      [drop],
    );
    const creatorBal = await gemsBalance(U.creator);
    const treasuryDelta = (await walletBalance(TREASURY)) - treasuryBefore;
    const vaultOk =
      order.rows.length === 1 &&
      order.rows[0].s === "settled" &&
      order.rows[0].e === "released" &&
      order.rows[0].d === "vault" &&
      order.rows[0].shipping_fee_ccoin === null &&
      order.rows[0].shipping_address === null &&
      cardLoc.rows[0].l === "platform_vault";
    const ok =
      invalidPool &&
      vaultOk &&
      rev.rows.length === 1 &&
      Number(rev.rows[0].gross_ccoin) === 100 &&
      Number(rev.rows[0].platform_ccoin) === 70 &&
      Number(rev.rows[0].royalty_ccoin) === 30 &&
      rev.rows[0].pct === "0.7" &&
      creatorBal === 30 &&
      treasuryDelta === 70;
    report(
      "T1 checkout revenue 70/30 (vault-only, royalty -> gems)",
      ok,
      `pool_guard=${invalidPool} order=${order.rows[0]?.s}/${order.rows[0]?.e}/${order.rows[0]?.d} loc=${cardLoc.rows[0]?.l} rev=${JSON.stringify(rev.rows[0] ?? {})} creator=${creatorBal} treasuryΔ=${treasuryDelta}`,
    );
  }

  // ══ T2: premium jatuh ke regular -> refund selisih ════════════════════════
  {
    const entrant = uuid(2);
    const drop = `flow-t2-${stamp}`;
    await mkUser(entrant, "T2 Entrant", 200);
    await mkDrop(drop, { units: 1, signed: 0, priceU: 100, priceS: 120, raffleEnd: "now() + interval '2 hours'" });
    const c = await asUser(entrant);
    await c.query("select public.drop_entry($1, 'premium')", [drop]); // hold 120 (signed)
    await c.end();
    await admin.query(`update public.drops set raffle_end_at = now() - interval '1 minute' where id = $1`, [drop]);
    await admin.query("select public.draw_drop($1)", [drop]);
    const entry = await admin.query("select status, hold_ccoin from public.drop_entries where drop_id = $1 and user_id = $2", [
      drop,
      entrant,
    ]);
    const refunds = await admin.query(
      "select coalesce(sum(amount_ccoin), 0) as total from public.wallet_transactions where user_id = $1 and type = 'refund' and ref_type = 'drop_entry'",
      [entrant],
    );
    const bal = await walletBalance(entrant);
    // hold 120, menang regular 100 -> refund 20, sisa saldo 100
    const ok = entry.rows[0]?.status === "won_regular" && Number(refunds.rows[0].total) === 20 && bal === 100;
    report("T2 premium->regular refund selisih", ok, `status=${entry.rows[0]?.status} refund=${refunds.rows[0].total} bal=${bal}`);
  }

  // ══ T3: maks 3 bid aktif per user ═════════════════════════════════════════
  {
    const bidder = uuid(3);
    const owner = uuid(31);
    await mkUser(bidder, "T3 Bidder", 1000);
    await mkUser(owner, "T3 Owner", 0);
    const drop = `flow-t3-${stamp}`;
    await mkDrop(drop, { units: 4, signed: 0, priceU: 10, raffleEnd: "now() - interval '25 hours'", drawn: "now() - interval '24 hours'" });
    await admin.query(`update public.cards set owner_id = $2, status = 'bound' where drop_id = $1`, [drop, owner]);
    const c = await asUser(bidder);
    let limited = false;
    const cards = (await admin.query("select id from public.cards where drop_id = $1 order by unit_number", [drop])).rows;
    for (let i = 0; i < cards.length; i++) {
      try {
        await c.query("select public.place_bid($1, $2)", [cards[i].id, 10 + i]);
      } catch (e) {
        limited = errCode(e) === "BID_LIMIT" && i === 3;
      }
    }
    await c.end();
    const active = await admin.query("select count(*)::int as n from public.bids where bidder_id = $1 and status = 'active'", [bidder]);
    report("T3 bid limit 3 aktif", limited && active.rows[0].n === 3, `active=${active.rows[0].n} limitedOn4th=${limited}`);
  }

  // ══ T4: cap top-up 500 non-KYC; KYC tanpa cap ═════════════════════════════
  {
    const noKyc = uuid(4);
    const kycUser = uuid(41);
    await mkUser(noKyc, "T4 NoKyc", 499);
    await mkUser(kycUser, "T4 Kyc", 0);
    await admin.query(
      "insert into public.kyc_records (id, user_id, full_name, nik, address, status) values ($1, $2, 'Kyc', '3201234567890123', 'Jl. Test No. 1 Jakarta', 'approved') on conflict (user_id) do nothing",
      [`kyc-${stamp}`, kycUser],
    );
    let capped = false;
    try {
      await admin.query("select public.wallet_credit($1, 2, 'top_up', 'topup', 'flow-t4-cap', $2)", [noKyc, `cap-${stamp}`]);
    } catch (e) {
      capped = errCode(e) === "TOPUP_CAP_EXCEEDED";
    }
    let kycOk = true;
    try {
      await admin.query("select public.wallet_credit($1, 600, 'top_up', 'topup', 'flow-t4-nocap', $2)", [kycUser, `nocap-${stamp}`]);
    } catch {
      kycOk = false;
    }
    report("T4 topup cap 500 (KYC-gated)", capped && kycOk, `capped=${capped} kycNoCap=${kycOk}`);
  }

  // ══ T5: payout_request gate + happy path (dual-token: debit gems matured) ═
  {
    const p5 = uuid(5);
    await mkUser(p5, "T5 Payout", 100);
    const c = await asUser(p5);
    let kycRequired = false;
    try {
      await c.query("select public.payout_request(50)");
    } catch (e) {
      kycRequired = errCode(e) === "KYC_REQUIRED";
    }
    let minPayout = false;
    await admin.query(
      "insert into public.kyc_records (id, user_id, full_name, nik, address, status) values ($1, $2, 'Kyc5', '3201234567890134', 'Jl. Test No. 2 Jakarta', 'approved') on conflict (user_id) do nothing",
      [`kyc5-${stamp}`, p5],
    );
    try {
      await c.query("select public.payout_request(5)");
    } catch (e) {
      minPayout = errCode(e) === "MIN_PAYOUT";
    }
    // Dual-token: payout debit GEMS matured — fixture 60 gems lalu lot di-
    // backdate supaya matured (payout_request(50) sah, sisa 10 gems).
    await admin.query("select public.wallet_credit_gems($1, 60, 'settlement', 'test', $2, $3)", [
      p5,
      `t5-lot-${stamp}`,
      `t5-gems-${stamp}`,
    ]);
    await admin.query("update public.gem_lots set mature_at = now() - interval '1 hour' where ref_id = $1", [`t5-lot-${stamp}`]);
    await c.query("select public.payout_request(50)");
    // Node-postgres mengembalikan composite type sebagai string "(...)" —
    // baca status langsung dari tabel (admin role) untuk asersi.
    const payout = await admin.query(
      "select status, ccoin_amount from public.payouts where user_id = $1 order by requested_at desc limit 1",
      [p5],
    );
    await admin.query("update public.wallets set hold_payout_until = now() + interval '7 days' where user_id = $1", [p5]);
    let held = false;
    try {
      await c.query("select public.payout_request(10)");
    } catch (e) {
      held = errCode(e) === "PAYOUT_HELD";
    }
    await c.end();
    const row = payout.rows[0];
    const bal = await walletBalance(p5);
    const gems = await gemsBalance(p5);
    report(
      "T5 payout_request (debit gems matured)",
      kycRequired && minPayout && held && row?.status === "pending" && Number(row?.ccoin_amount) === 50 && bal === 100 && gems === 10,
      `kycReq=${kycRequired} min=${minPayout} held=${held} status=${row?.status} ccoin=${bal} gems=${gems}`,
    );
  }

  // ══ T6: buyout_card vault-only settle (tanpa alamat/shipment) ═════════════
  {
    const seller = uuid(6);
    const buyer = uuid(61);
    const drop = `flow-t6-${stamp}`;
    await mkUser(seller, "T6 Seller", 0);
    await mkUser(buyer, "T6 Buyer", 500);
    await mkDrop(drop, { units: 1, signed: 0, priceU: 10, raffleEnd: "now() - interval '25 hours'", drawn: "now() - interval '24 hours'" });
    const card = (await admin.query("select id from public.cards where drop_id = $1", [drop])).rows[0].id;
    await admin.query("update public.cards set owner_id = $2, status = 'sold', buyout_price_ccoin = 100 where id = $1", [card, seller]);
    const before = await walletBalance(TREASURY);
    const c = await asUser(buyer);
    await c.query("select public.buyout_card($1)", [card]); // settle non-seed: tanpa alamat
    await c.end();
    const ship = await admin.query("select count(*)::int as n from public.shipments where card_id = $1", [card]);
    const cardRow = await admin.query("select location::text as l from public.cards where id = $1", [card]);
    const rev = await admin.query(
      "select platform_ccoin, royalty_ccoin, seller_ccoin from public.platform_revenue where ref_type = 'buyout' and ref_id in (select id from public.wallet_transactions where ref_id = $1 and type = 'platform_buy')",
      [card],
    );
    const sellerBal = await gemsBalance(seller);
    const treasuryDelta = (await walletBalance(TREASURY)) - before;
    const ok =
      ship.rows[0].n === 0 &&
      cardRow.rows[0].l === "platform_vault" &&
      Number(rev.rows[0]?.seller_ccoin) === 84 &&
      sellerBal === 84 &&
      treasuryDelta === 8;
    report(
      "T6 buyout vault-only + split 8/8/84 (seller -> gems)",
      ok,
      `ship_n=${ship.rows[0].n} loc=${cardRow.rows[0].l} seller=${sellerBal} treasuryΔ=${treasuryDelta} rev=${JSON.stringify(rev.rows[0] ?? {})}`,
    );
  }

  // ══ T7: accept_bid vault-only settle (tanpa alamat/shipment) ══════════════
  {
    const seller = uuid(7);
    const bidder = uuid(71);
    const drop = `flow-t7-${stamp}`;
    await mkUser(seller, "T7 Seller", 0);
    await mkUser(bidder, "T7 Bidder", 100);
    await mkDrop(drop, { units: 1, signed: 0, priceU: 10, raffleEnd: "now() - interval '25 hours'", drawn: "now() - interval '24 hours'" });
    const card = (await admin.query("select id from public.cards where drop_id = $1", [drop])).rows[0].id;
    await admin.query("update public.cards set owner_id = $2, status = 'sold' where id = $1", [card, seller]);
    const cb = await asUser(bidder);
    await cb.query("select public.place_bid($1, 60)", [card]);
    await cb.end();
    const cs = await asUser(seller);
    await cs.query("select public.accept_bid($1)", [card]); // settle non-seed: tanpa alamat
    await cs.end();
    const ship = await admin.query("select count(*)::int as n from public.shipments where card_id = $1", [card]);
    const cardRow = await admin.query("select location::text as l from public.cards where id = $1", [card]);
    const sellerBal = await gemsBalance(seller);
    report(
      "T7 accept_bid vault-only (tanpa shipment, seller -> gems)",
      ship.rows[0].n === 0 && cardRow.rows[0].l === "platform_vault" && sellerBal === 50,
      `ship_n=${ship.rows[0].n} loc=${cardRow.rows[0].l} seller=${sellerBal} (ekspektasi 50)`,
    );
  }

  // ══ T8: vault_shipout — fee + treasury + revenue 'shipment' + guards ══════
  {
    const owner = uuid(8);
    const other = uuid(81);
    await mkUser(owner, "T8 Owner", 100);
    await mkUser(other, "T8 Other", 100);
    const drop = `flow-t8-${stamp}`;
    await mkDrop(drop, { units: 2, signed: 0, priceU: 10, raffleEnd: "now() - interval '25 hours'", drawn: "now() - interval '24 hours'" });
    const cards = (await admin.query("select id from public.cards where drop_id = $1 order by unit_number", [drop])).rows;
    await admin.query("update public.cards set owner_id = $2, status = 'sold', location = 'platform_vault' where id in ($1, $3)", [
      cards[0].id,
      owner,
      cards[1].id,
    ]);
    const treasuryBefore = await walletBalance(TREASURY);
    const c = await asUser(owner);
    // Fee = konstanta server (SHIPMENT_FEE_CCOIN = 2) — bukan argumen RPC lagi.
    const SHIPMENT_FEE = 2;
    await c.query("select public.vault_shipout($1, 'Jl. Shipout No. 8 Jakarta')", [cards[0].id]);
    await c.end();
    const ship = await admin.query(
      "select type::text as t, status::text as s, fee_ccoin::int as fee, address->>'street' as street from public.shipments where card_id = $1 and type = 'vault_shipout' order by created_at desc limit 1",
      [cards[0].id],
    );
    const rev = await admin.query(
      "select gross_ccoin::int as g, platform_ccoin::int as p, royalty_ccoin::int as r, seller_ccoin::int as s, fee_snapshot->>'platform_pct' as pct from public.platform_revenue where ref_type = 'shipment' and ref_id in (select id from public.shipments where card_id = $1 and type = 'vault_shipout')",
      [cards[0].id],
    );
    const debit = await admin.query(
      "select count(*)::int as n from public.wallet_transactions where user_id = $1 and type = 'vault_shipout' and amount_ccoin = $2",
      [owner, -SHIPMENT_FEE],
    );
    const ownerBal = await walletBalance(owner);
    const treasuryDelta = (await walletBalance(TREASURY)) - treasuryBefore;
    // (iii) repeat shipout kartu dengan shipment aktif ditolak
    const c2 = await asUser(owner);
    let repeatRejected = false;
    try {
      await c2.query("select public.vault_shipout($1, 'Jl. Shipout No. 8 Jakarta')", [cards[0].id]);
    } catch (e) {
      repeatRejected = errCode(e) === "SHIPMENT_ACTIVE";
    }
    // (iv) non-owner ditolak — the call must come from a different user
    // (`other`), not the owner itself (cards[1] is also owned by owner).
    let nonOwnerRejected = false;
    const c3 = await asUser(other);
    try {
      await c3.query("select public.vault_shipout($1, 'Jl. Intruder No. 9 Jakarta')", [cards[1].id]);
    } catch (e) {
      nonOwnerRejected = errCode(e) === "FORBIDDEN";
    }
    await c3.end();
    await c2.end();
    const ok =
      ship.rows[0]?.t === "vault_shipout" &&
      ship.rows[0]?.s === "requested" &&
      Number(ship.rows[0]?.fee) === SHIPMENT_FEE &&
      ship.rows[0]?.street === "Jl. Shipout No. 8 Jakarta" &&
      Number(rev.rows[0]?.g) === SHIPMENT_FEE &&
      Number(rev.rows[0]?.p) === SHIPMENT_FEE &&
      Number(rev.rows[0]?.r) === 0 &&
      Number(rev.rows[0]?.s) === 0 &&
      rev.rows[0]?.pct === "1.0" &&
      debit.rows[0].n === 1 &&
      ownerBal === 100 - SHIPMENT_FEE &&
      treasuryDelta === SHIPMENT_FEE &&
      repeatRejected &&
      nonOwnerRejected;
    report(
      "T8 vault_shipout fee ledger + guards",
      ok,
      `ship=${ship.rows[0]?.t}/${ship.rows[0]?.s} fee=${ship.rows[0]?.fee} owner=${ownerBal} treasuryΔ=${treasuryDelta} rev=${JSON.stringify(rev.rows[0] ?? {})} repeat=${repeatRejected} nonOwner=${nonOwnerRejected}`,
    );
  }

  // ══ T9: activate_scheduled_drops ══════════════════════════════════════════
  {
    const dSched = `flow-t9a-${stamp}`;
    const dEnded = `flow-t9b-${stamp}`;
    await mkDrop(dSched, {
      units: 1,
      signed: 0,
      status: "scheduled",
      raffleEnd: "now() + interval '23 hours'",
      start: "now() - interval '1 hour'",
    });
    await mkDrop(dEnded, {
      units: 1,
      signed: 0,
      status: "live",
      raffleEnd: "now() - interval '25 hours'",
      drawn: "now() - interval '24 hours'",
      start: "now() - interval '30 hours'",
      end: "now() - interval '1 hour'",
    });
    await admin.query("select public.activate_scheduled_drops()");
    const a = await admin.query("select status from public.drops where id = $1", [dSched]);
    const b = await admin.query("select status from public.drops where id = $1", [dEnded]);
    report(
      "T9 activate_scheduled_drops",
      a.rows[0]?.status === "live" && b.rows[0]?.status === "closed",
      `sched=${a.rows[0]?.status} ended=${b.rows[0]?.status}`,
    );
  }
  // ══ T10: checkout pool='premium' — harga signed + split 70/30 di atasnya ══
  {
    const buyer = uuid(9);
    const drop = `flow-t10-${stamp}`;
    await mkUser(buyer, "T10 Premium Buyer", 500);
    await mkDrop(drop, {
      units: 1,
      signed: 1,
      priceU: 100,
      priceS: 120,
      raffleEnd: "now() - interval '25 hours'",
      drawn: "now() - interval '24 hours'",
    });
    const c = await asUser(buyer);
    const treasuryBefore = await walletBalance(TREASURY);
    const creatorBefore = await gemsBalance(U.creator);
    await c.query("select public.checkout($1, 'premium')", [drop]);
    await c.end();
    const order = await admin.query(
      "select status::text as s, escrow_status::text as e, delivery_option::text as d, total_ccoin, shipping_fee_ccoin, shipping_address from public.orders where drop_id = $1",
      [drop],
    );
    const card = await admin.query(
      "select location::text as l, owner_id, variant::text as v from public.cards where id = (select card_id from public.orders where drop_id = $1)",
      [drop],
    );
    const rev = await admin.query(
      "select gross_ccoin, platform_ccoin, royalty_ccoin, fee_snapshot->>'platform_pct' as pct from public.platform_revenue where ref_type = 'order' and ref_id in (select id from public.orders where drop_id = $1)",
      [drop],
    );
    const creatorDelta = (await gemsBalance(U.creator)) - creatorBefore;
    const buyerBal = await walletBalance(buyer);
    const treasuryDelta = (await walletBalance(TREASURY)) - treasuryBefore;
    // RPC membaca price_signed_ccoin apa adanya (premium fee TIDAK diarahkan ke
    // pihak ketiga — seluruh harga masuk split 70/30 primary yang sama dengan
    // regular: royalty creator floor(30%), platform sisanya ke treasury).
    const vaultOk =
      order.rows.length === 1 &&
      order.rows[0].s === "settled" &&
      order.rows[0].e === "released" &&
      order.rows[0].d === "vault" &&
      Number(order.rows[0].total_ccoin) === 120 &&
      order.rows[0].shipping_fee_ccoin === null &&
      order.rows[0].shipping_address === null;
    const ok =
      vaultOk &&
      card.rows[0].v === "signed" &&
      card.rows[0].l === "platform_vault" &&
      String(card.rows[0].owner_id) === buyer &&
      rev.rows.length === 1 &&
      Number(rev.rows[0].gross_ccoin) === 120 &&
      Number(rev.rows[0].platform_ccoin) === 84 &&
      Number(rev.rows[0].royalty_ccoin) === 36 &&
      rev.rows[0].pct === "0.7" &&
      creatorDelta === 36 &&
      buyerBal === 380 &&
      treasuryDelta === 84;
    report(
      "T10 checkout premium (signed) revenue 70/30 atas harga signed",
      ok,
      `order=${order.rows[0]?.s}/${order.rows[0]?.e}/${order.rows[0]?.d} total=${order.rows[0]?.total_ccoin} variant=${card.rows[0]?.v} loc=${card.rows[0]?.l} rev=${JSON.stringify(rev.rows[0] ?? {})} creatorΔ=${creatorDelta} buyer=${buyerBal} treasuryΔ=${treasuryDelta}`,
    );
  }

  // ══ T11: accept_bid price 6 — split ceil 1/1/4 (bukan 0/0/6) ══════════════
  {
    const seller = uuid(11);
    const bidder = uuid(111);
    const drop = `flow-t11-${stamp}`;
    await mkUser(seller, "T11 Seller", 0);
    await mkUser(bidder, "T11 Bidder", 100);
    await mkDrop(drop, { units: 1, signed: 0, priceU: 6, raffleEnd: "now() - interval '25 hours'", drawn: "now() - interval '24 hours'" });
    const card = (await admin.query("select id from public.cards where drop_id = $1", [drop])).rows[0].id;
    await admin.query("update public.cards set owner_id = $2, status = 'sold' where id = $1", [card, seller]);
    const cb = await asUser(bidder);
    await cb.query("select public.place_bid($1, 6)", [card]);
    await cb.end();
    const cs = await asUser(seller);
    await cs.query("select public.accept_bid($1)", [card]);
    await cs.end();
    const rev = await admin.query(
      "select platform_ccoin, royalty_ccoin, seller_ccoin from public.platform_revenue where ref_type = 'bid' and ref_id in (select id from public.bids where card_id = $1)",
      [card],
    );
    const sellerBal = await gemsBalance(seller);
    const ok =
      Number(rev.rows[0]?.platform_ccoin) === 1 &&
      Number(rev.rows[0]?.royalty_ccoin) === 1 &&
      Number(rev.rows[0]?.seller_ccoin) === 4 &&
      sellerBal === 4;
    report(
      "T11 accept_bid ceil split 1/1/4 @ price 6 (seller -> gems)",
      ok,
      `rev=${JSON.stringify(rev.rows[0] ?? {})} seller=${sellerBal} (ekspektasi 4)`,
    );
  }

  // ══ T12: accept_bid harga kecil — guard SECONDARY_PRICE_TOO_SMALL ═════════
  // Split ceil membuat price 1/2 -> seller <= 0 (wallet_credit INVALID_AMOUNT,
  // settlement abort). Guard first-class menolak SEBELUM wallet writes dengan
  // kode kurasi; price 3 = batas aman (1/1/1).
  {
    const seller = uuid(12);
    const bidder = uuid(121);
    const results12 = {};
    for (const price of [1, 2, 3]) {
      const drop = `flow-t12p${price}-${stamp}`;
      await mkUser(seller, "T12 Seller", 0);
      await mkUser(bidder, "T12 Bidder", 100);
      await mkDrop(drop, {
        units: 1,
        signed: 0,
        priceU: price,
        raffleEnd: "now() - interval '25 hours'",
        drawn: "now() - interval '24 hours'",
      });
      const card = (await admin.query("select id from public.cards where drop_id = $1", [drop])).rows[0].id;
      await admin.query("update public.cards set owner_id = $2, status = 'sold' where id = $1", [card, seller]);
      const cb = await asUser(bidder);
      await cb.query("select public.place_bid($1, $2)", [card, price]);
      await cb.end();
      const cs = await asUser(seller);
      let raised = null;
      try {
        await cs.query("select public.accept_bid($1)", [card]);
      } catch (e) {
        raised = errCode(e);
      }
      await cs.end();
      results12[price] = { raised, sellerBal: await gemsBalance(seller) };
    }
    const okT12 =
      results12[1].raised === "SECONDARY_PRICE_TOO_SMALL" &&
      results12[2].raised === "SECONDARY_PRICE_TOO_SMALL" &&
      results12[3].raised === null &&
      results12[3].sellerBal === 1;
    const revT12 = await admin.query(
      "select platform_ccoin, royalty_ccoin, seller_ccoin from public.platform_revenue where ref_type = 'bid' and ref_id in (select id from public.bids where card_id like 'card-flow-t12p3-%')",
    );
    const ok =
      okT12 &&
      Number(revT12.rows[0]?.platform_ccoin) === 1 &&
      Number(revT12.rows[0]?.royalty_ccoin) === 1 &&
      Number(revT12.rows[0]?.seller_ccoin) === 1;
    report(
      "T12 accept_bid guard SECONDARY_PRICE_TOO_SMALL (1/2 raise, 3 settles 1/1/1)",
      ok,
      `p1=${results12[1].raised} p2=${results12[2].raised} p3=${results12[3].raised ?? "settled"} seller=${results12[3].sellerBal} rev=${JSON.stringify(revT12.rows[0] ?? {})}`,
    );
  }

  // ══ T13: buyout_card harga kecil — guard + happy price 3 (1/1/1) ══════════
  {
    const seller = uuid(13);
    const buyer = uuid(131);
    await mkUser(seller, "T13 Seller", 0);
    await mkUser(buyer, "T13 Buyer", 100);
    const results13 = {};
    for (const price of [1, 3]) {
      const drop = `flow-t13p${price}-${stamp}`;
      await mkDrop(drop, {
        units: 1,
        signed: 0,
        priceU: price,
        raffleEnd: "now() - interval '25 hours'",
        drawn: "now() - interval '24 hours'",
      });
      const card = (await admin.query("select id from public.cards where drop_id = $1", [drop])).rows[0].id;
      await admin.query("update public.cards set owner_id = $2, status = 'sold', buyout_price_ccoin = $3 where id = $1", [
        card,
        seller,
        price,
      ]);
      const c = await asUser(buyer);
      let raised = null;
      try {
        await c.query("select public.buyout_card($1)", [card]);
      } catch (e) {
        raised = errCode(e);
      }
      await c.end();
      results13[price] = { raised, sellerBal: await gemsBalance(seller) };
    }
    const revT13 = await admin.query(
      "select platform_ccoin, royalty_ccoin, seller_ccoin from public.platform_revenue where ref_type = 'buyout' and ref_id in (select id from public.wallet_transactions where ref_id in (select id from public.cards where drop_id = $1) and type = 'platform_buy')",
      [`flow-t13p3-${stamp}`],
    );
    const ok =
      results13[1].raised === "SECONDARY_PRICE_TOO_SMALL" &&
      results13[3].raised === null &&
      results13[3].sellerBal === 1 &&
      Number(revT13.rows[0]?.platform_ccoin) === 1 &&
      Number(revT13.rows[0]?.royalty_ccoin) === 1 &&
      Number(revT13.rows[0]?.seller_ccoin) === 1;
    report(
      "T13 buyout_card guard SECONDARY_PRICE_TOO_SMALL (1 raise, 3 settles 1/1/1)",
      ok,
      `p1=${results13[1].raised} p3=${results13[3].raised ?? "settled"} seller=${results13[3].sellerBal} rev=${JSON.stringify(revT13.rows[0] ?? {})}`,
    );
  }
} finally {
  await admin.end();
}

const failed = results.filter((r) => !r.pass).length;
console.log(`\n${results.length - failed}/${results.length} PASS`);
process.exit(failed > 0 ? 1 : 0);

// C.Verse — transactional email queue (2026-09-02).
// Jalankan against Supabase lokal (disposable — db reset bebas):
//   node supabase/tests/notification_email_queue_test.mjs postgresql://postgres:postgres@127.0.0.1:54322/postgres
// Skenario (lane email = low volume, high value — keputusan owner 2026-09-02):
//   S1: bid accepted      -> in_app 'sent' + email 'pending' untuk bidder
//   S2: bid outbid        -> in_app SAJA (tanpa baris email — anti-spam)
//   S3: card sold         -> email 'card_bought' untuk seller lama
//   S4: payout paid/failed-> email 'payout_disbursed' / 'payout_failed'
//   S5: shipment shipped  -> email dengan payload trackingNumber (+ delivered)
//   S6: kyc approved/rejected -> email masing-masing
//   S7: top-up credit     -> in_app + email 'topup_settled'; replay idempotent
//                            TIDAK menduplikasi notifikasi
//   S8: draw_drop         -> winner: in_app + email 'drop_won'; loser: in_app
//                            'drop_lost' SAJA (tanpa email — volume control)
//   S9: notify_user       -> EXECUTE di-revoke dari anon + authenticated
//   S10: royalty credit   -> TIDAK memicu notifikasi apa pun (bukan top_up)
import pgModule from "../../apps/api/node_modules/pg/lib/index.js";

const { Client } = pgModule;

const url = process.argv[2] ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const results = [];
function report(id, pass, detail) {
  results.push({ id, pass });
  console.log(`${id} ${pass ? "PASS" : "FAIL"}${detail ? ` (${detail})` : ""}`);
}

const admin = new Client({ connectionString: url });
await admin.connect();
await admin.query("set role service_role");

// ── Fixture ─────────────────────────────────────────────────────────────────
const stamp = Date.now().toString(36);
const seller = { id: "c3000000-0000-4000-8000-000000000001", email: `notif-seller-${stamp}@race.test` };
const bidder = { id: "c3000000-0000-4000-8000-000000000002", email: `notif-bidder-${stamp}@race.test` };
const outbidder = { id: "c3000000-0000-4000-8000-000000000003", email: `notif-outbidder-${stamp}@race.test` };
const buyer = { id: "c3000000-0000-4000-8000-000000000004", email: `notif-buyer-${stamp}@race.test` };
const winner = { id: "c3000000-0000-4000-8000-000000000005", email: `notif-winner-${stamp}@race.test` };
const loser = { id: "c3000000-0000-4000-8000-000000000006", email: `notif-loser-${stamp}@race.test` };
const creator = { id: "c3000000-0000-4000-8000-000000000007", email: `notif-creator-${stamp}@race.test` };
const allUsers = [seller, bidder, outbidder, buyer, winner, loser, creator];

const dropId = `notif-drop-${stamp}`;
const cardId = `notif-card-${stamp}`;
const drawDropId = `notif-draw-drop-${stamp}`;
const drawCardId = `notif-draw-card-${stamp}`;

await admin.query("begin");
for (const u of allUsers) {
  await admin.query("insert into public.users (id, email, display_name) values ($1, $2, 'Notif')", [u.id, u.email]);
  await admin.query("insert into public.wallets (user_id, balance_ccoin) values ($1, 0)", [u.id]);
}
await admin.query("update public.users set role = 'creator' where id = $1", [creator.id]);
// Drop + card milik seller (secondary market trigger tests)
await admin.query(
  `insert into public.drops (id, title, series, narrative, artwork_url, total_units, signed_count, unsigned_count,
     price_unsigned_ccoin, price_signed_ccoin, price_ccoin, status, creator_id, creator_name, sold_count)
   values ($1, 'Notif Drop', 'Notif', 'notif', '/x.jpg', 1, 0, 1, 10, 20, 10, 'live', $2, 'Karina Aespa', 1)`,
  [dropId, creator.id],
);
await admin.query(
  `insert into public.cards (id, drop_id, owner_id, unit_number, variant, status, nfc_uid, nfc_short_id,
     verify_status, location, nfc_configured, qc_status)
   values ($1, $2, $3, 1, 'unsigned', 'bound', $4, $5, 'unknown', 'with_owner', false, 'pending')`,
  [cardId, dropId, seller.id, `NFQ${stamp}`, `nfq-${stamp}`],
);
// Drop raffle (draw test): 1 unit unsigned, belum digambar, window lewat
await admin.query(
  `insert into public.drops (id, title, series, narrative, artwork_url, total_units, signed_count, unsigned_count,
     price_unsigned_ccoin, price_signed_ccoin, price_ccoin, status, creator_id, creator_name, sold_count,
     raffle_end_at)
   values ($1, 'Notif Draw', 'Notif', 'notif', '/x.jpg', 1, 0, 1, 10, 20, 10, 'live', $2, 'Karina Aespa', 0,
     now() - interval '1 hour')`,
  [drawDropId, creator.id],
);
await admin.query(
  `insert into public.cards (id, drop_id, unit_number, variant, status, nfc_uid, nfc_short_id,
     verify_status, location, nfc_configured, qc_status)
   values ($1, $2, 1, 'unsigned', 'inventory', $3, $4, 'unknown', 'platform_vault', false, 'pending')`,
  [drawCardId, drawDropId, `NFD${stamp}`, `nfd-${stamp}`],
);
await admin.query(
  "insert into public.drop_entries (id, drop_id, user_id, pool, hold_ccoin, status) values ($1,$2,$3,'regular',10,'held'), ($4,$5,$6,'regular',10,'held')",
  [`ne-w-${stamp}`, drawDropId, winner.id, `ne-l-${stamp}`, drawDropId, loser.id],
);
await admin.query("commit");

async function notifRows(userId, channel, templateKey) {
  const { rows } = await admin.query(
    "select payload, status from public.notifications where user_id = $1 and channel = $2 and template_key = $3 order by created_at",
    [userId, channel, templateKey],
  );
  return rows;
}

// ── S1: bid accepted -> in_app + email untuk bidder ────────────────────────
await admin.query(
  "insert into public.bids (id, card_id, bidder_id, bidder_name, amount_ccoin, status) values ($1,$2,$3,'Bidder',50,'active')",
  [`nb-1-${stamp}`, cardId, bidder.id],
);
await admin.query("update public.bids set status = 'accepted', accepted_at = now() where id = $1", [`nb-1-${stamp}`]);
{
  const inApp = await notifRows(bidder.id, "in_app", "bid_accepted");
  const email = await notifRows(bidder.id, "email", "bid_accepted");
  report(
    "S1",
    inApp.length === 1 && inApp[0].status === "sent" && email.length === 1 && email[0].status === "pending",
    `in_app=${inApp.length}(${inApp[0]?.status}) email=${email.length}(${email[0]?.status})`,
  );
}

// ── S2: bid outbid -> in_app SAJA ───────────────────────────────────────────
{
  await admin.query(
    "insert into public.bids (id, card_id, bidder_id, bidder_name, amount_ccoin, status) values ($1,$2,$3,'Outbidder',60,'active')",
    [`nb-2-${stamp}`, cardId, outbidder.id],
  );
  await admin.query("update public.bids set status = 'outbid', outbid_at = now() where id = $1", [`nb-2-${stamp}`]);
  const inApp = await notifRows(outbidder.id, "in_app", "bid_outbid");
  const email = await notifRows(outbidder.id, "email", "bid_outbid");
  report("S2", inApp.length === 1 && email.length === 0, `in_app=${inApp.length} email=${email.length}`);
}

// ── S3: card sold (owner change) -> email card_bought untuk seller ─────────
await admin.query("update public.cards set buyout_price_ccoin = 50 where id = $1", [cardId]);
await admin.query("update public.cards set owner_id = $1 where id = $2", [buyer.id, cardId]);
{
  const inApp = await notifRows(seller.id, "in_app", "card_bought");
  const email = await notifRows(seller.id, "email", "card_bought");
  report(
    "S3",
    inApp.length === 1 && email.length === 1 && String(email[0].payload?.amount) === "50" && email[0].payload?.dropTitle === "Notif Drop",
    `in_app=${inApp.length} email=${email.length} amount=${email[0]?.payload?.amount} title=${email[0]?.payload?.dropTitle}`,
  );
}

// ── S4: payout paid + failed -> email ───────────────────────────────────────
await admin.query(
  "insert into public.payouts (id, user_id, type, ccoin_amount, idr_amount, status) values ($1,$2,'creator_share',40,400000,'pending'), ($3,$4,'creator_share',30,300000,'pending')",
  [`np-1-${stamp}`, winner.id, `np-2-${stamp}`, loser.id],
);
await admin.query("update public.payouts set status = 'disbursed' where id = $1", [`np-1-${stamp}`]);
await admin.query("update public.payouts set status = 'failed' where id = $1", [`np-2-${stamp}`]);
{
  const paidEmail = await notifRows(winner.id, "email", "payout_disbursed");
  const failEmail = await notifRows(loser.id, "email", "payout_failed");
  report("S4", paidEmail.length === 1 && failEmail.length === 1, `paid=${paidEmail.length} failed=${failEmail.length}`);
}

// ── S5: shipment shipped (tracking) + delivered -> email ───────────────────
await admin.query(
  "insert into public.shipments (id, card_id, requester_id, type, to_dest, status) values ($1,$2,$3,'vault_shipout','buyer_address','packed')",
  [`ns-1-${stamp}`, cardId, buyer.id],
);
await admin.query("update public.shipments set status = 'shipped', tracking_number = 'JX1234567890' where id = $1", [`ns-1-${stamp}`]);
await admin.query("update public.shipments set status = 'delivered' where id = $1", [`ns-1-${stamp}`]);
{
  const shipped = await notifRows(buyer.id, "email", "shipment_shipped");
  const delivered = await notifRows(buyer.id, "email", "shipment_delivered");
  report(
    "S5",
    shipped.length === 1 && shipped[0].payload?.trackingNumber === "JX1234567890" && delivered.length === 1,
    `shipped=${shipped.length}(resi=${shipped[0]?.payload?.trackingNumber}) delivered=${delivered.length}`,
  );
}

// ── S6: kyc approved + rejected -> email ────────────────────────────────────
await admin.query(
  "insert into public.kyc_records (id, user_id, full_name, nik, address, status) values ($1,$2,'Winner Test','3201234567890001','Jl. Test 1','pending'), ($3,$4,'Loser Test','3201234567890002','Jl. Test 2','pending')",
  [`nk-1-${stamp}`, winner.id, `nk-2-${stamp}`, loser.id],
);
await admin.query("update public.kyc_records set status = 'approved' where id = $1", [`nk-1-${stamp}`]);
await admin.query("update public.kyc_records set status = 'rejected' where id = $1", [`nk-2-${stamp}`]);
{
  const approved = await notifRows(winner.id, "email", "kyc_approved");
  const rejected = await notifRows(loser.id, "email", "kyc_rejected");
  report("S6", approved.length === 1 && rejected.length === 1, `approved=${approved.length} rejected=${rejected.length}`);
}

// ── S7: top-up credit -> in_app + email; replay idempotent tanpa duplikat ──
await admin.query("select public.wallet_credit($1, 100, 'top_up', 'top_up', $2, $2)", [winner.id, `ntx-${stamp}`]);
const topupCount = async () => {
  const emailRows = await notifRows(winner.id, "email", "topup_settled");
  const inAppRows = await notifRows(winner.id, "in_app", "topup_settled");
  return { email: emailRows.length, inApp: inAppRows.length, payload: emailRows[0]?.payload };
};
{
  const first = await topupCount();
  await admin.query("select public.wallet_credit($1, 100, 'top_up', 'top_up', $2, $2)", [winner.id, `ntx-${stamp}`]); // replay idempotent
  const replay = await topupCount();
  report(
    "S7",
    first.email === 1 && first.inApp === 1 && replay.email === 1 && replay.inApp === 1 && String(first.payload?.amount) === "100",
    `first=${first.email}/${first.inApp} replay=${replay.email}/${replay.inApp} amount=${first.payload?.amount}`,
  );
}

// ── S8: draw_drop -> winner email + loser in-app saja ──────────────────────
await admin.query("select public.draw_drop($1)", [drawDropId]);
{
  // Raffle acak: pemenang dibaca dari status entry final, bukan asumsi urutan.
  const finalEntries = await admin.query("select user_id, status from public.drop_entries where drop_id = $1", [drawDropId]);
  const wonUser = finalEntries.rows.find((r) => r.status === "won_regular")?.user_id;
  const lostUser = finalEntries.rows.find((r) => r.status === "refunded")?.user_id;
  const wonEmail = wonUser ? await notifRows(wonUser, "email", "drop_won") : [];
  const wonInApp = wonUser ? await notifRows(wonUser, "in_app", "drop_won") : [];
  const lostInApp = lostUser ? await notifRows(lostUser, "in_app", "drop_lost") : [];
  const lostEmail = lostUser ? await notifRows(lostUser, "email", "drop_lost") : [];
  report(
    "S8",
    wonEmail.length === 1 && wonInApp.length === 1 && lostInApp.length === 1 && lostEmail.length === 0,
    `winner=${wonInApp.length}/${wonEmail.length} loser=${lostInApp.length}/${lostEmail.length}`,
  );
}

// ── S10: royalty credit TIDAK menimbulkan notifikasi ───────────────────────
{
  const before = await admin.query("select count(*)::int as n from public.notifications where user_id = $1", [creator.id]);
  await admin.query("select public.wallet_credit($1, 3, 'royalty', 'order', $2, $2)", [creator.id, `nroy-${stamp}`]);
  const after = await admin.query("select count(*)::int as n from public.notifications where user_id = $1", [creator.id]);
  report("S10", before.rows[0].n === after.rows[0].n, `before=${before.rows[0].n} after=${after.rows[0].n}`);
}

// ── S9: notify_user di-revoke dari authenticated (dan anon) ────────────────
{
  const conn = await new Client({ connectionString: url }).connect();
  const client = conn.client ?? conn;
  await client.query("set role authenticated");
  await client.query(`set request.jwt.claims to '{"sub":"${bidder.id}","role":"authenticated"}'`);
  let denied = false;
  try {
    await client.query("select public.notify_user($1, 'test', '{}', false)", [bidder.id]);
  } catch {
    denied = true;
  }
  await client.end();
  report("S9", denied, denied ? "permission denied (benar)" : "EXECUTE lolos (harusnya direvoke)");
}

await admin.end();
const failed = results.filter((r) => !r.pass).length;
console.log(`\n${results.length - failed}/${results.length} PASS`);
if (failed > 0) process.exit(1);

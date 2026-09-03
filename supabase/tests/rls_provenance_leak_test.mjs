// C.Verse — RLS least-privilege provenance & bids (audit 2026-09-04: H-1, M-1, M-2 + bids mint).
// Jalankan against Supabase lokal (disposable — db reset bebas):
//   node supabase/tests/rls_provenance_leak_test.mjs postgresql://postgres:postgres@127.0.0.1:54322/postgres
// Skenario (semua asersi independen, satu report line each):
//   p1 authenticated INSERT bids langsung       -> 42501 (bids mint: bid asli hanya via place_bid RPC)
//   p2 authenticated SELECT bids mentah         -> 42501 (bidder_name/bidder_id hanya via API masking)
//   p3 anon SELECT ownership_history            -> 42501 (graf kepemilikan hanya via API /cards/:id)
//   p4 authenticated SELECT ownership_history   -> 42501 (sama — deanonymisasi lintas-listing)
//   p5 anon SELECT cards                        -> 42501 (read kartu publik hanya via API service-role)
//   p6 authenticated SELECT creators.bank_account/notes -> 42501 (PII finansial — admin via service-role)
//   p7 place_bid user anonim -> bidder_name 'Anonim' (denormalisasi ikut aturan masking)
//   p8 sanity: place_bid user biasa            -> bidder_name = display_name (tidak over-mask)
//   p9 sanity: anon masih SELECT drops publik   -> OK (tidak over-block)
import pgModule from "../../apps/api/node_modules/pg/lib/index.js";

const { Client } = pgModule;

const url = process.argv[2] ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const results = [];
function report(id, pass, detail) {
  results.push({ id, pass });
  console.log(`${id} ${pass ? "PASS" : "FAIL"}${detail ? ` (${detail})` : ""}`);
}

const PERMISSION_DENIED = "42501";
function isPermissionDenied(e) {
  return e?.code === PERMISSION_DENIED || String(e?.message ?? "").includes("permission denied");
}

const clients = [];
async function newClient(role, sub) {
  const c = new Client({ connectionString: url });
  await c.connect();
  if (role) await c.query(`set role ${role}`);
  if (sub) await c.query(`set request.jwt.claims to '{"sub":"${sub}","role":"authenticated"}'`);
  clients.push(c);
  return c;
}
async function expectPermissionDenied(c, sql, params) {
  try {
    await c.query(sql, params);
    return { denied: false, detail: "no error (call succeeded)" };
  } catch (e) {
    return { denied: isPermissionDenied(e), detail: String(e.message).trim().split("\n")[0].slice(0, 90) };
  }
}

try {
  const admin = await newClient(null);
  const anon = await newClient("anon");

  const stamp = Date.now().toString(36);
  // ── Fixture ───────────────────────────────────────────────────────────────
  // UUID fixture hex-only (base36 stamp mengandung g-z yang bukan hex —
  // bangkitkan suffix acak dari md5 agar valid untuk kolom uuid).
  const { createHash } = await import("node:crypto");
  const hex12 = (salt) => createHash("md5").update(`${salt}-${stamp}`).digest("hex").slice(0, 12);
  const anonBidder = { id: `c0000000-0000-4000-8000-${hex12("anon")}`, email: `prov-anon-${stamp}@race.test` };
  const plainBidder = { id: `c0000001-0000-4000-8000-${hex12("plain")}`, email: `prov-user-${stamp}@race.test` };
  const owner = { id: `c0000002-0000-4000-8000-${hex12("owner")}`, email: `prov-owner-${stamp}@race.test` };
  const dropId = `prov-drop-${stamp}`;
  const cardId = `prov-card-${stamp}`;

  await admin.query("begin");
  for (const u of [anonBidder, plainBidder, owner]) {
    await admin.query("insert into public.users (id, email, display_name) values ($1, $2, $3) on conflict (id) do nothing", [
      u.id,
      u.email,
      u === anonBidder ? "Anon Tester" : "Plain Tester",
    ]);
    await admin.query("insert into public.wallets (user_id, balance_ccoin) values ($1, $2) on conflict (user_id) do nothing", [u.id, 1000]);
  }
  await admin.query("update public.users set is_anonymous = true where id = $1", [anonBidder.id]);
  await admin.query(
    `insert into public.drops (id, title, series, narrative, artwork_url, total_units, signed_count, unsigned_count,
       price_unsigned_ccoin, price_signed_ccoin, price_ccoin, status, drop_start_at, creator_id, creator_name, sold_count)
     values ($1, 'Prov Drop', 'Prov', 'prov', '/x.jpg', 1, 0, 1, 10, 20, 10, 'live', now() - interval '26 hours',
       '00000000-0000-4000-8000-000000000003', 'Karina Aespa', 0)`,
    [dropId],
  );
  await admin.query(
    `insert into public.cards (id, drop_id, owner_id, unit_number, variant, status, nfc_uid, nfc_short_id, verify_status, location, nfc_configured, qc_status)
     values ($1, $2, $3, 1, 'unsigned', 'sold', $4, $5, 'unknown', 'with_owner', false, 'pending')`,
    [cardId, dropId, owner.id, `PR${stamp.slice(0, 10).toUpperCase()}`, `prov-${stamp}`],
  );
  await admin.query("commit");

  const authed = await newClient("authenticated", plainBidder.id);

  // ── p1: authenticated INSERT bids langsung = 42501 (bids mint) ────────────
  {
    const mintId = `prov-mint-${stamp}`;
    const r = await expectPermissionDenied(
      authed,
      "insert into public.bids (id, card_id, bidder_id, bidder_name, amount_ccoin, status) values ($1, $2, $3, 'Mint', 50, 'active')",
      [mintId, cardId, plainBidder.id],
    );
    report("p1 authenticated INSERT bids 42501", r.denied, r.detail);
    // Pre-fix insert lolos (itulah buktinya) — bersihkan agar tidak mengganggu p7/p8.
    await admin.query("delete from public.bids where id = $1", [mintId]);
  }

  // ── p2: authenticated SELECT bids mentah = 42501 ──────────────────────────
  {
    const r = await expectPermissionDenied(authed, "select bidder_name, bidder_id from public.bids limit 1");
    report("p2 authenticated SELECT bids 42501", r.denied, r.detail);
  }

  // ── p3: anon SELECT ownership_history = 42501 ──────────────────────────────
  {
    const r = await expectPermissionDenied(anon, "select card_id, owner_id from public.ownership_history limit 1");
    report("p3 anon SELECT ownership_history 42501", r.denied, r.detail);
  }

  // ── p4: authenticated SELECT ownership_history = 42501 ────────────────────
  {
    const r = await expectPermissionDenied(authed, "select card_id, owner_id from public.ownership_history limit 1");
    report("p4 authenticated SELECT ownership_history 42501", r.denied, r.detail);
  }

  // ── p5: anon SELECT cards = 42501 ──────────────────────────────────────────
  {
    const r = await expectPermissionDenied(anon, "select id, nfc_uid, owner_id from public.cards limit 1");
    report("p5 anon SELECT cards 42501", r.denied, r.detail);
  }

  // ── p6: authenticated SELECT creators.bank_account = 42501 ────────────────
  // bank_account (rekening) HANYA service-role. notes tetap di-grant
  // (dibaca admin SPA langsung — Creators.tsx:31) hingga read admin pindah API.
  {
    const r = await expectPermissionDenied(authed, "select bank_account from public.creators limit 1");
    report("p6 authenticated SELECT creators.bank_account 42501", r.denied, r.detail);
  }

  // ── p7: place_bid user anonim -> bidder_name 'Anonim' ──────────────────────
  // Row RPC composite: ambil via SELECT * FROM agar kolom bidder_name utuh.
  {
    const conn = await newClient("authenticated", anonBidder.id);
    let name = null;
    let detail = "";
    try {
      const r = await conn.query("select * from public.place_bid($1, 10)", [cardId]);
      name = r.rows[0]?.bidder_name ?? null;
    } catch (e) {
      detail = String(e.message).trim().split("\n")[0].slice(0, 90);
    }
    report("p7 place_bid anonim writes 'Anonim'", name === "Anonim", detail || `bidder_name=${name}`);
  }

  // ── p8 sanity: place_bid user biasa -> display_name asli ───────────────────
  {
    const conn2 = await newClient("authenticated", plainBidder.id);
    let name = null;
    let detail = "";
    try {
      const r = await conn2.query("select * from public.place_bid($1, 20)", [cardId]);
      name = r.rows[0]?.bidder_name ?? null;
    } catch (e) {
      detail = String(e.message).trim().split("\n")[0].slice(0, 90);
    }
    report("p8 place_bid biasa writes display_name", name === "Plain Tester", detail || `bidder_name=${name}`);
  }

  // ── p9 sanity: anon SELECT drops publik tetap OK ───────────────────────────
  {
    let ok = false;
    let detail = "";
    try {
      await anon.query("select id from public.drops limit 1");
      ok = true;
    } catch (e) {
      detail = String(e.message).trim().split("\n")[0].slice(0, 90);
    }
    report("p9 anon SELECT drops still allowed", ok, detail || "ok");
  }

  // ── Cleanup ───────────────────────────────────────────────────────────────
  // Pola rpc_c12_bid_test: disable trigger append-only butuh owner tabel —
  // kembali ke postgres (service_role tidak boleh). Lalu hapus anak→induk.
  await admin.query("set role postgres");
  await admin.query("begin");
  await admin.query("alter table public.wallet_transactions disable trigger trg_wtx_immutable");
  await admin.query("delete from public.wallet_transactions where user_id = any($1)", [[anonBidder.id, plainBidder.id, owner.id]]);
  await admin.query("alter table public.wallet_transactions enable trigger trg_wtx_immutable");
  await admin.query("delete from public.gem_transactions where user_id = any($1)", [[anonBidder.id, plainBidder.id, owner.id]]);
  await admin.query("delete from public.gem_lots where user_id = any($1)", [[anonBidder.id, plainBidder.id, owner.id]]);
  await admin.query("delete from public.bids where card_id = $1", [cardId]);
  await admin.query("delete from public.ownership_history where card_id = $1", [cardId]);
  await admin.query("delete from public.cards where id = $1", [cardId]);
  await admin.query("delete from public.drops where id = $1", [dropId]);
  await admin.query("delete from public.wallets where user_id = any($1)", [[anonBidder.id, plainBidder.id, owner.id]]);
  await admin.query("delete from public.users where id = any($1)", [[anonBidder.id, plainBidder.id, owner.id]]);
  await admin.query("commit");
  console.log("CLEANUP OK");
} finally {
  for (const c of clients) await c.end().catch(() => {});
}

const failed = results.filter((r) => !r.pass).length;
console.log(`\n${results.length - failed}/${results.length} PASS`);
process.exit(failed > 0 ? 1 : 0);

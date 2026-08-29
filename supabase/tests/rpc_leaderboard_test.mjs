// C.Verse — get_leaderboard RPC tests (04_rpc.sql — gap P2-1, coverage nol).
// Jalankan against Supabase lokal (disposable — db reset bebas):
//   node supabase/tests/rpc_leaderboard_test.mjs postgresql://postgres:postgres@127.0.0.1:54322/postgres
// Skenario:
//   L1 ranking per type (xp/cards/badges) sesuai fixture + skor benar
//   L2 determinism: tie-break reached_at ASC lalu username ASC (dua langkah
//      rantai tie-break diuji terpisah, urutan insert dikontrol)
//   L3 suspended (flag_reason non-null) + is_anonymous di-exclude
//   L4 limit clamp dua arah: p_limit=1 -> 5 baris; p_limit=9999 -> <= 50
//   L5 type='creator': hanya owner kartu dari drop creator tsb; tanpa
//      creator_id -> error; type invalid -> INVALID_LEADERBOARD_TYPE
//   G1 grant: authenticated + anon boleh EXECUTE (grant eksplisit 04_rpc.sql)
// Catatan: fixture sengaja tidak dibersihkan — bench di-reset lane lain;
// semua id di-prefix stamp agar tidak bentrok antar test file konkuren.
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
function uuid(slot) {
  const s = stamp.slice(0, 12).padEnd(12, "0");
  return `3${String(slot).padStart(7, "0")}-${s.slice(0, 4)}-4000-8000-${s}`;
}

const U = {
  high: uuid(1), // xp 300, 3 kartu, 2 badge
  mid: uuid(2), // xp 200, 2 kartu, 1 badge
  low: uuid(3), // xp 100, 1 kartu, 0 badge
  tieEarly: uuid(4), // xp 50, username 'zzz…', inserted LEBIH DULU
  tieLate: uuid(5), // xp 50, username 'aaa…', inserted BELAKANGAN
  tieA: uuid(6), // xp 50, username 'lb-tie-aaa…', satu statement dgn tieB
  tieB: uuid(7), // xp 50, username 'lb-tie-zzz…', satu statement dgn tieA
  susp: uuid(8), // xp 999 (harusnya rank 1), 2 kartu, 1 badge — SUSPENDED
  anon: uuid(9), // xp 998 — is_anonymous
  creator: uuid(10),
  creator2: uuid(11),
};

async function mkUser(slot, name, opts = {}) {
  const id = U[slot];
  const cols = ["id", "email", "display_name", "username", "total_xp", "is_anonymous", "flag_reason"];
  const vals = [
    id,
    `lb-${slot}-${stamp}@test`,
    name,
    opts.username ?? `lb-${slot}-${stamp}`,
    opts.xp ?? 0,
    opts.anonymous ?? false,
    opts.flagReason ?? null,
  ];
  const ph = cols.map((_, i) => `$${i + 1}`).join(",");
  await admin.query(`insert into public.users (${cols.join(",")}) values (${ph})`, vals);
  return id;
}

// Drop + kartu owned minimal (owner_since di-set trigger; leaderboard cards
// menghitung SEMUA cards.owner_id — fixture mengontrol count per user).
async function mkOwnedCards(dropId, creatorId, units, assignments) {
  await admin.query(
    `insert into public.drops (id, title, series, narrative, artwork_url, total_units, signed_count, unsigned_count,
       price_unsigned_ccoin, price_signed_ccoin, price_ccoin, status, drop_start_at, drop_end_at, raffle_end_at, drawn_at, creator_id, creator_name, sold_count)
     values ($1,'LB Test','LBS','fixture','/x.jpg',$2,0,$2,10,12,10,'live',now() - interval '26 hours',null,
       now() + interval '2 hours',null,$3,'Creator LB',0)
     on conflict (id) do nothing`,
    [dropId, units, creatorId],
  );
  for (const [unit, ownerId] of assignments) {
    await admin.query(
      `insert into public.cards (id, drop_id, unit_number, variant, status, owner_id, nfc_uid, nfc_short_id, verify_status, location, nfc_configured, qc_status)
       values ($1, $2, $3, 'unsigned', 'bound', $4, md5($1), left(md5($1), 4) || '-001', 'unknown', 'with_owner', false, 'pending')
       on conflict (id) do nothing`,
      [`${dropId}-c${unit}`, dropId, unit, ownerId],
    );
  }
}

try {
  // ── Fixture ────────────────────────────────────────────────────────────────
  // Urutan insert PENTING untuk tie-break reached_at: tieEarly -> tieLate ->
  // (tieA + tieB satu statement, reached_at identik).
  await mkUser("creator", "LB Creator");
  await mkUser("creator2", "LB Creator 2");
  await mkUser("high", "LB High", { xp: 300 });
  await mkUser("mid", "LB Mid", { xp: 200 });
  await mkUser("low", "LB Low", { xp: 100 });
  await mkUser("tieEarly", "LB Tie Early", { xp: 50, username: `zzz-early-${stamp}` });
  await mkUser("tieLate", "LB Tie Late", { xp: 50, username: `aaa-late-${stamp}` });
  // Satu statement = satu transaksi = xp_reached_at identik -> username ASC.
  await admin.query(
    `insert into public.users (id, email, display_name, username, total_xp) values
       ($1, $3, 'LB Tie A', $5, 50),
       ($2, $4, 'LB Tie B', $6, 50)`,
    [U.tieA, U.tieB, `lb-tiea-${stamp}@test`, `lb-tieb-${stamp}@test`, `lb-tie-aaa-${stamp}`, `lb-tie-zzz-${stamp}`],
  );
  await mkUser("susp", "LB Suspended", { xp: 999, flagReason: "lb_test_suspended" });
  await mkUser("anon", "LB Anonymous", { xp: 998, anonymous: true });

  const dropA = `lb-a-${stamp}`;
  const dropB = `lb-b-${stamp}`;
  await mkOwnedCards(dropA, U.creator, 6, [
    [1, U.high],
    [2, U.high],
    [3, U.high],
    [4, U.low],
    [5, U.susp],
    [6, U.susp],
  ]);
  await mkOwnedCards(dropB, U.creator2, 4, [
    [1, U.mid],
    [2, U.mid],
    [3, null],
    [4, null],
  ]);
  const b1 = `lb-b1-${stamp}`;
  const b2 = `lb-b2-${stamp}`;
  await admin.query(
    `insert into public.badges (id, code, name, description, icon, xp, xp_reward, is_active)
     values ($1, $3, 'LB Badge 1', 'fixture', 'star', 0, 0, true),
            ($2, $4, 'LB Badge 2', 'fixture', 'star', 0, 0, true)
     on conflict (id) do nothing`,
    [b1, b2, `lb_b1_${stamp}`, `lb_b2_${stamp}`],
  );
  await admin.query("insert into public.user_badges (user_id, badge_id) values ($1,$3),($1,$4),($2,$3),($5,$4)", [
    U.high,
    U.mid,
    b1,
    b2,
    U.susp,
  ]);

  const c = await asUser(U.low); // RPC read-only — identitas pemanggil tak mempengaruhi hasil
  async function board(type, creatorId, limit) {
    if (creatorId) {
      const { rows } = await c.query("select * from public.get_leaderboard($1, $2, $3)", [type, creatorId, limit ?? 50]);
      return rows;
    }
    if (limit !== undefined) {
      const { rows } = await c.query("select * from public.get_leaderboard($1, null, $2)", [type, limit]);
      return rows;
    }
    const { rows } = await c.query("select * from public.get_leaderboard($1)", [type]);
    return rows;
  }
  // Filter fixture: username fixture-mu semua mengandung stamp (prefix unik per
  // run). JANGAN pernah exact-match list global — bench dipakai bersama lane
  // lain, user luar bisa interleaves di antara fixture.
  const mine = (rows) => rows.filter((r) => String(r.username).includes(stamp));
  const idxOf = (rows, key) => rows.findIndex((r) => String(r.user_id) === U[key]);

  // ══ L1: ranking + skor per type sesuai fixture (scoped) ══════════════════
  {
    // Presence WAJIB hanya untuk 7 fixture xp>=50 (seed users punya XP besar dan
    // leftover run lain menambah populasi — saat eligible > 50, user xp-0 SAH
    // terpotong clamp limit 50; itu perilaku RPC yang benar, bukan kegagalan).
    const REQUIRED = { [U.high]: 300, [U.mid]: 200, [U.low]: 100, [U.tieEarly]: 50, [U.tieLate]: 50, [U.tieA]: 50, [U.tieB]: 50 };
    const OPTIONAL = { [U.creator]: 0, [U.creator2]: 0 };
    const ALL = { ...REQUIRED, ...OPTIONAL };
    const CARDS = { [U.high]: 3, [U.mid]: 2, [U.low]: 1 };
    const BADGES = { [U.high]: 2, [U.mid]: 1 };
    const xp = mine(await board("xp", null, 50));
    const cards = mine(await board("cards", null, 50));
    const badges = mine(await board("badges", null, 50));
    // (a) 7 fixture xp>=50 hadir; (b) skor tiap row fixture tepat (opsional xp-0
    // divalidasi 0 jika ikut masuk); (c) urutan non-increasing pada subset saya.
    const present = new Set(xp.map((r) => String(r.user_id)));
    const requiredOk = Object.keys(REQUIRED).every((id) => present.has(id));
    const scoresOk = xp.every((r) => ALL[String(r.user_id)] === Number(r.score));
    const xpOk = requiredOk && scoresOk && xp.length >= 7 && xp.every((r, i) => i === 0 || Number(xp[i - 1].score) >= Number(r.score));
    const cardsOk =
      cards.length === 3 &&
      cards.every((r, i) => CARDS[String(r.user_id)] === Number(r.score) && (i === 0 || Number(cards[i - 1].score) >= Number(r.score)));
    const badgesOk =
      badges.length === 2 &&
      badges.every((r, i) => BADGES[String(r.user_id)] === Number(r.score) && (i === 0 || Number(badges[i - 1].score) >= Number(r.score)));
    report(
      "L1 ranking+skor xp/cards/badges sesuai fixture (scoped)",
      xpOk && cardsOk && badgesOk,
      `xp=${JSON.stringify(xp.map((r) => [r.username, Number(r.score)]))} cards=${JSON.stringify(cards.map((r) => [r.username, Number(r.score)]))} badges=${JSON.stringify(badges.map((r) => [r.username, Number(r.score)]))}`,
    );
  }

  // ══ L2: determinism — reached_at ASC, lalu username ASC ══════════════════
  {
    // Indeks dihitung dalam list hasil FILTER fixture (bukan indeks global) —
    // user luar di antara fixture tidak mempengaruhi urutan relatif.
    const xp = mine(await board("xp", null, 50));
    // tieEarly ('zzz-…', reached_at lebih awal) HARUS di atas tieLate ('aaa-…')
    // -> membuktikan reached_at ASC diprioritaskan di atas username ASC.
    const earlyIdx = idxOf(xp, "tieEarly");
    const lateIdx = idxOf(xp, "tieLate");
    const aIdx = idxOf(xp, "tieA");
    const bIdx = idxOf(xp, "tieB");
    const reachedFirst = earlyIdx >= 0 && earlyIdx < lateIdx;
    // tieA/tieB: reached_at identik (satu statement) -> username ASC memutus.
    const usernameBreaks = aIdx >= 0 && aIdx < bIdx;
    report(
      "L2 tie-break deterministik (reached_at ASC, lalu username ASC)",
      reachedFirst && usernameBreaks,
      `earlyIdx=${earlyIdx} lateIdx=${lateIdx} aIdx=${aIdx} bIdx=${bIdx}`,
    );
  }

  // ══ L3: suspended + anonymous di-exclude dari semua board ════════════════
  {
    const xp = await board("xp", null, 50);
    const cards = await board("cards", null, 50);
    const badges = await board("badges", null, 50);
    const suspendedGone = [xp, cards, badges].every((rows) => !rows.some((r) => String(r.user_id) === U.susp));
    const anonGone = !xp.some((r) => String(r.user_id) === U.anon);
    report(
      "L3 suspended (flag_reason) + is_anonymous di-exclude",
      suspendedGone && anonGone,
      `suspGone=${suspendedGone} anonGone=${anonGone}`,
    );
  }

  // ══ L4: limit clamp dua arah (greatest(5, least(p_limit, 50))) ═══════════
  {
    const floorClamp = await board("xp", null, 1); // 1 -> clamp ke 5 baris
    const ceilClamp = await board("xp", null, 9999); // 9999 -> clamp ke 50
    const floorOk = floorClamp.length === 5; // >=7 user eligible (fixture) -> pasti penuh 5
    const ceilOk = ceilClamp.length <= 50;
    const sorted = ceilClamp.every((r, i) => i === 0 || Number(ceilClamp[i - 1].score) >= Number(r.score));
    report(
      "L4 limit clamp (1->5 baris; 9999-><=50, skor non-increasing)",
      floorOk && ceilOk && sorted,
      `floor=${floorClamp.length} ceil=${ceilClamp.length} sorted=${sorted}`,
    );
  }

  // ══ L5: type='creator' — hanya owner kartu dari drop creator tsb ═════════
  {
    const rows = mine(await board("creator", U.creator, 50)).map((r) => [String(r.user_id), Number(r.score)]);
    const okRows =
      JSON.stringify(rows) ===
      JSON.stringify([
        [U.high, 3],
        [U.low, 1],
      ]);
    let creatorIdRequired = false;
    try {
      await c.query("select * from public.get_leaderboard('creator')");
    } catch (e) {
      creatorIdRequired = errCode(e).includes("creator_id is required");
    }
    let invalidType = false;
    try {
      await c.query("select * from public.get_leaderboard('nope')");
    } catch (e) {
      invalidType = errCode(e).startsWith("INVALID_LEADERBOARD_TYPE");
    }
    report(
      "L5 creator board per creator + guard argumen",
      okRows && creatorIdRequired && invalidType,
      `rows=${JSON.stringify(rows)} creatorIdReq=${creatorIdRequired} invalidType=${invalidType}`,
    );
  }

  // ══ G1: grant EXECUTE — authenticated (dipakai di atas) + anon ═══════════
  {
    // 04_rpc.sql meng-grant get_leaderboard ke anon + authenticated + service_role
    // (leaderboard publik read-only) — anon diharuskan BERHASIL, bukan ditolak.
    const anonClient = new Client({ connectionString: url });
    await anonClient.connect();
    await anonClient.query("set role anon");
    let anonOk = false;
    try {
      const { rows } = await anonClient.query("select count(*)::int as n from public.get_leaderboard('xp')");
      anonOk = rows[0].n >= 5;
    } catch {
      anonOk = false;
    }
    await anonClient.end();
    report("G1 grant: authenticated + anon boleh eksekusi", anonOk, `anonRows>=5=${anonOk}`);
  }

  await c.end();
} finally {
  await admin.end();
}

const failed = results.filter((r) => !r.pass).length;
console.log(`\n${results.length - failed}/${results.length} PASS`);
process.exit(failed > 0 ? 1 : 0);

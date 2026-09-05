// Tiered badge engine integration checks. Run against the local disposable DB:
// node supabase/tests/badge_engine_test.mjs postgresql://postgres:postgres@127.0.0.1:54322/postgres
import pgModule from "../../apps/api/node_modules/pg/lib/index.js";

const { Client } = pgModule;
const url = process.argv[2] ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname)) throw new Error("Badge fixture tests require a local database");
const stamp = Date.now().toString(16);
const prefix = `be-${stamp}`;
const uid = (n) => `7${String(n).padStart(7, "0")}-${stamp.slice(0, 4).padEnd(4, "0")}-4000-8000-${stamp.slice(0, 12).padEnd(12, "0")}`;
const U = uid(1);
const results = [];
const report = (name, pass) => {
  results.push(pass);
  console.log(`${name} ${pass ? "PASS" : "FAIL"}`);
};

const admin = new Client({ connectionString: url });
await admin.connect();
await admin.query("set role service_role");
const query = admin.query.bind(admin);
admin.query = async (...args) => {
  await query("set role service_role");
  return query(...args);
};

try {
  const catalog = await admin.query(
    "select count(*)::int as total, count(distinct code)::int as unique_codes from public.badges where criteria->>'family' in ('collector','devotee','explorer','archivist','autograph','pioneer','trader','patron','special')",
  );
  report("catalog has exactly 43 distinct badge codes", catalog.rows[0].total === 43 && catalog.rows[0].unique_codes === 43);
  const malformed = await admin.query(
    `select public.badge_criteria_matches(value, '{"collect_count":99}'::jsonb) as matches
     from jsonb_array_elements($1::jsonb) value`,
    [
      JSON.stringify([
        { min: 1 },
        { type: "collect_count", min: "1" },
        { type: "collect_count", min: 1.5 },
        { type: "collect_count", min: 9999999999 },
        { type: "unknown", min: 1 },
        null,
      ]),
    ],
  );
  report(
    "malformed badge criteria return false without aborting",
    malformed.rows.every((row) => row.matches === false),
  );
  await admin.query("insert into public.users (id,email,display_name,username) values ($1,$2,'Badge Engine',$3)", [
    U,
    `${prefix}@test.invalid`,
    prefix,
  ]);
  const creatorA = uid(2);
  const creatorB = uid(3);
  await admin.query("insert into public.users (id,email,display_name,username) values ($1,$3,'Creator A',$4),($2,$5,'Creator B',$6)", [
    creatorA,
    creatorB,
    `${prefix}-a@test.invalid`,
    `${prefix}-a`,
    `${prefix}-b@test.invalid`,
    `${prefix}-b`,
  ]);
  await admin.query(
    `insert into public.drops (id,title,series,narrative,artwork_url,total_units,signed_count,unsigned_count,price_unsigned_ccoin,price_signed_ccoin,price_ccoin,status,creator_id,creator_name)
     values ($1,'Badge A','BES','fixture','/x',2,1,1,10,30,10,'live',$3,'Creator A'),($2,'Badge B','BES','fixture','/x',1,0,1,10,30,10,'live',$4,'Creator B')`,
    [`${prefix}-drop-a`, `${prefix}-drop-b`, creatorA, creatorB],
  );
  await admin.query(
    `insert into public.cards (id,drop_id,unit_number,variant,status,owner_id,nfc_uid,nfc_short_id,verify_status,location,nfc_configured,qc_status)
     values ($1,$4,1,'signed','sold',$3,$5,$6,'verified','platform_vault',true,'passed'),($2,$4,2,'unsigned','sold',$3,$7,$8,'registered','platform_vault',true,'passed'),($9,$10,1,'unsigned','sold',$3,$11,$12,'registered','platform_vault',true,'passed')`,
    [
      `${prefix}-c1`,
      `${prefix}-c2`,
      U,
      `${prefix}-drop-a`,
      `${prefix}-n1`,
      `${prefix}-s1`,
      `${prefix}-n2`,
      `${prefix}-s2`,
      `${prefix}-c3`,
      `${prefix}-drop-b`,
      `${prefix}-n3`,
      `${prefix}-s3`,
    ],
  );
  await admin.query(
    `insert into public.ownership_history (id,card_id,owner_id,acquired_via) values
     ($1,$4,$3,'primary'),($2,$5,$3,'secondary_buyout'),($6,$7,$3,'secondary_bid'),($8,$4,$3,'primary')`,
    [`${prefix}-oh1`, `${prefix}-oh2`, U, `${prefix}-c1`, `${prefix}-c2`, `${prefix}-oh3`, `${prefix}-c3`, `${prefix}-oh-rebuy`],
  );
  await admin.query(
    `insert into public.badges (id,code,name,description,icon,xp_reward,criteria,is_active) values
     ($1,$1,'BE collect','fixture','star',7,$3,true),($2,$2,'BE strict','fixture','star',9,$4,true)`,
    [
      `${prefix}-collect`,
      `${prefix}-whale`,
      JSON.stringify({ type: "collect_count", min: 3, family: "test", tier: 1 }),
      JSON.stringify({ type: "single_bid_gt", min: 100, family: "test", tier: 1 }),
    ],
  );
  const progress = (await admin.query("select public.badge_progress($1) as value", [U])).rows[0].value;
  report(
    "metrics count distinct historical cards and sources",
    progress.collect_count === 3 &&
      progress.primary_count === 1 &&
      progress.secondary_count === 2 &&
      progress.creator_count === 2 &&
      progress.signed_count === 1,
  );

  const xpBefore = (await admin.query("select total_xp from public.users where id=$1", [U])).rows[0].total_xp;
  await admin.query("select public.evaluate_badges_for_user($1)", [U]);
  const once = await admin.query(
    "select u.total_xp, count(*)::int as badges from public.users u join public.user_badges ub on ub.user_id=u.id where u.id=$1 and ub.badge_id=$2 group by u.total_xp",
    [U, `${prefix}-collect`],
  );
  await admin.query("select public.evaluate_badges_for_user($1)", [U]);
  const twice = await admin.query(
    "select u.total_xp, count(*)::int as badges from public.users u join public.user_badges ub on ub.user_id=u.id where u.id=$1 and ub.badge_id=$2 group by u.total_xp",
    [U, `${prefix}-collect`],
  );
  report(
    "award is idempotent and snapshots XP once",
    once.rows[0].total_xp === xpBefore + 7 && once.rows[0].badges === 1 && JSON.stringify(once.rows) === JSON.stringify(twice.rows),
  );
  await admin.query("update public.badges set xp_reward=99 where id=$1", [`${prefix}-collect`]);
  await admin.query("select public.evaluate_badges_for_user($1)", [U]);
  const preserved = await admin.query(
    "select u.total_xp, ub.xp_reward_snapshot from public.users u join public.user_badges ub on ub.user_id=u.id where u.id=$1 and ub.badge_id=$2",
    [U, `${prefix}-collect`],
  );
  report(
    "earned snapshot and XP survive a future reward change",
    preserved.rows[0].total_xp === xpBefore + 7 && preserved.rows[0].xp_reward_snapshot === 7,
  );

  await admin.query(
    "insert into public.bids (id,card_id,bidder_id,bidder_name,amount_ccoin,status) values ($1,$2,$3,'Badge Engine',100,'cancelled')",
    [`${prefix}-bid-a`, `${prefix}-c1`, U],
  );
  await admin.query("select public.evaluate_badges_for_user($1)", [U]);
  const beforeStrict = await admin.query("select count(*)::int as n from public.user_badges where user_id=$1 and badge_id=$2", [
    U,
    `${prefix}-whale`,
  ]);
  await admin.query(
    "insert into public.bids (id,card_id,bidder_id,bidder_name,amount_ccoin,status) values ($1,$2,$3,'Badge Engine',101,'cancelled')",
    [`${prefix}-bid-b`, `${prefix}-c2`, U],
  );
  await admin.query("select public.evaluate_badges_for_user($1)", [U]);
  const afterStrict = await admin.query("select count(*)::int as n from public.user_badges where user_id=$1 and badge_id=$2", [
    U,
    `${prefix}-whale`,
  ]);
  report(
    "single_bid_gt is strict and cancel does not count as a volume metric",
    beforeStrict.rows[0].n === 0 && afterStrict.rows[0].n === 1,
  );
  const supportBadge = `${prefix}-support`;
  await admin.query("begin");
  try {
    await admin.query(
      "insert into public.wallet_transactions (id,user_id,type,amount_ccoin,balance_after_ccoin,ref_type,ref_id,metadata) values ($1,$4,'support',-1,0,'user',$2,'{}'),($3,$4,'support',-1,0,'user',$2,'{}'),($5,$4,'support',-1,0,'user',$6,'{}')",
      [`${prefix}-support-1`, creatorA, `${prefix}-support-2`, U, `${prefix}-support-3`, creatorB],
    );
    await admin.query(
      "insert into public.badges (id,code,name,description,icon,xp_reward,criteria,is_active) values ($1,$1,'Support','fixture','star',13,$2,true)",
      [supportBadge, JSON.stringify({ type: "support_creators", min: 2, family: "test", tier: 1 })],
    );
    const supportProgress = (await admin.query("select public.badge_progress($1) as value", [U])).rows[0].value;
    await admin.query("select public.evaluate_badges_for_user($1)", [U]);
    const supportAward = await admin.query("select count(*)::int as n from public.user_badges where user_id=$1 and badge_id=$2", [
      U,
      supportBadge,
    ]);
    report(
      "support counts distinct completed recipients, not repeated support",
      supportProgress.support_creators === 2 && supportAward.rows[0].n === 1,
    );
  } finally {
    await admin.query("rollback");
  }

  const rollbackUser = uid(20);
  await admin.query("insert into public.users (id,email,display_name,username) values ($1,$2,'Rollback',$3)", [
    rollbackUser,
    `${prefix}-rollback@test.invalid`,
    `${prefix}-rollback`,
  ]);
  await admin.query("begin");
  await admin.query("insert into public.ownership_history (id,card_id,owner_id,acquired_via) values ($1,$2,$3,'primary')", [
    `${prefix}-rollback-oh`,
    `${prefix}-c1`,
    rollbackUser,
  ]);
  await admin.query("rollback");
  const rolledBack = await admin.query(
    "select u.total_xp, count(ub.badge_id)::int as badges from public.users u left join public.user_badges ub on ub.user_id=u.id where u.id=$1 group by u.total_xp",
    [rollbackUser],
  );
  report(
    "triggered awards roll back with an uncommitted acquisition",
    rolledBack.rows[0].total_xp === 0 && rolledBack.rows[0].badges === 0,
  );
  await admin.query("update public.users set flag_reason='fixture suspended' where id=$1", [rollbackUser]);
  const excluded = await admin.query(
    "select public.badge_user_is_eligible($1) as suspended, public.badge_user_is_eligible('00000000-0000-4000-8000-0000000000c0'::uuid) as treasury",
    [rollbackUser],
  );
  report("suspended users and treasury are excluded", excluded.rows[0].suspended === false && excluded.rows[0].treasury === false);

  const concurrentUser = uid(21);
  const concurrentBadge = `${prefix}-concurrent`;
  await admin.query("insert into public.users (id,email,display_name,username) values ($1,$2,'Concurrent',$3)", [
    concurrentUser,
    `${prefix}-concurrent@test.invalid`,
    `${prefix}-concurrent`,
  ]);
  await admin.query("insert into public.ownership_history (id,card_id,owner_id,acquired_via) values ($1,$2,$3,'primary')", [
    `${prefix}-concurrent-oh`,
    `${prefix}-c1`,
    concurrentUser,
  ]);
  await admin.query(
    "insert into public.badges (id,code,name,description,icon,xp_reward,criteria,is_active) values ($1,$1,'Concurrent','fixture','star',11,$2,true)",
    [concurrentBadge, JSON.stringify({ type: "collect_count", min: 1, family: "test", tier: 1 })],
  );
  const makeService = async () => {
    const client = new Client({ connectionString: url });
    await client.connect();
    await client.query("set role service_role");
    return client;
  };
  const [left, right] = await Promise.all([makeService(), makeService()]);
  const concurrentXpBefore = (await admin.query("select total_xp from public.users where id=$1", [concurrentUser])).rows[0].total_xp;
  await Promise.all([
    left.query("select public.evaluate_badges_for_user($1)", [concurrentUser]),
    right.query("select public.evaluate_badges_for_user($1)", [concurrentUser]),
  ]);
  await Promise.all([left.end(), right.end()]);
  const concurrent = await admin.query(
    "select count(*)::int as badges, max(xp_reward_snapshot)::int as reward, (select total_xp from public.users where id=$1)::int as total_xp from public.user_badges where user_id=$1 and badge_id=$2",
    [concurrentUser, concurrentBadge],
  );
  report(
    "concurrent evaluators award one row and one XP snapshot",
    concurrent.rows[0].badges === 1 && concurrent.rows[0].reward === 11 && concurrent.rows[0].total_xp === concurrentXpBefore + 11,
  );
  const triggerUser = uid(22);
  await admin.query("insert into public.users (id,email,display_name,username) values ($1,$2,'Concurrent trigger',$3)", [
    triggerUser,
    `${prefix}-trigger@test.invalid`,
    `${prefix}-trigger`,
  ]);
  const [triggerLeft, triggerRight] = await Promise.all([makeService(), makeService()]);
  await Promise.all([
    triggerLeft.query("insert into public.ownership_history (id,card_id,owner_id,acquired_via) values ($1,$2,$3,'primary')", [
      `${prefix}-trigger-a`,
      `${prefix}-c1`,
      triggerUser,
    ]),
    triggerRight.query("insert into public.ownership_history (id,card_id,owner_id,acquired_via) values ($1,$2,$3,'secondary_buyout')", [
      `${prefix}-trigger-b`,
      `${prefix}-c2`,
      triggerUser,
    ]),
  ]);
  await Promise.all([triggerLeft.end(), triggerRight.end()]);
  const triggerRows = await admin.query("select count(*)::int as n from public.ownership_history where owner_id=$1", [triggerUser]);
  report("concurrent acquisition triggers complete without a user-lock deadlock", triggerRows.rows[0].n === 2);

  const anon = new Client({ connectionString: url });
  await anon.connect();
  await anon.query("set role anon");
  let denied = false;
  try {
    await anon.query("select public.evaluate_badges_for_user($1)", [U]);
  } catch {
    denied = true;
  }
  await anon.end();
  report("privileged evaluator is denied to anon", denied);
  const authenticated = new Client({ connectionString: url });
  await authenticated.connect();
  await authenticated.query("set role authenticated");
  let authenticatedDenied = false;
  try {
    await authenticated.query("select public.evaluate_badges_for_user($1)", [U]);
  } catch {
    authenticatedDenied = true;
  }
  await authenticated.end();
  report("privileged evaluator is denied to authenticated", authenticatedDenied);
} finally {
  await admin.query("begin");
  await admin.query("delete from public.badges where id like $1", [`${prefix}-%`]);
  await admin.query("delete from public.drops where id like $1", [`${prefix}-%`]);
  await admin.query("delete from public.users where email = $1 or email like $2", [`${prefix}@test.invalid`, `${prefix}-%@test.invalid`]);
  await admin.query("commit");
  const leftovers = await admin.query(
    "select (select count(*)::int from public.badges where id like $1) + (select count(*)::int from public.drops where id like $1) + (select count(*)::int from public.users where email like $2) as n",
    [`${prefix}-%`, `${prefix}%@test.invalid`],
  );
  report("test-owned fixtures are removed", leftovers.rows[0].n === 0);
  await admin.end();
}

const failed = results.filter((ok) => !ok).length;
console.log(`${results.length - failed}/${results.length} PASS`);
process.exit(failed ? 1 : 0);

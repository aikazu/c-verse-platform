-- ══════════════════════════════════════════════════════════════════════════
-- C.Verse — 05_indexes: Performance indexes (hot-path query optimization).
-- Additive — tidak menghapus index lain. Constraint/unique indexes sudah
-- di 01_schema. Idempotency indexes sudah di 04_rpc (function-coupled).
--
-- Sumber (FINAL, tanpa patch intermediate):
--   - 20260817050000_perf_indexes.sql
--
-- (Predicate tidak bisa pakai cast enum `status::text` — ditolak 42P17;
-- filter defect diterapkan planner sebagai filter biasa di atas index.)
-- ══════════════════════════════════════════════════════════════════════════

-- checkout/draw_drop: pick kartu tersedia per drop+variant (worker-side)
create index if not exists idx_cards_available_drop_variant
  on public.cards(drop_id, variant, unit_number)
  where owner_id is null;

-- place_bid/accept_bid: top active bid per kartu
create index if not exists idx_bids_card_active_amount
  on public.bids(card_id, amount_ccoin desc)
  where status = 'active';

-- set_buyout / cards_buyout_guard: count active listing per owner
create index if not exists idx_cards_owner_buyout
  on public.cards(owner_id)
  where buyout_price_ccoin is not null;

-- Badge trigger: index-only scan user_badges
create index if not exists idx_user_badges_user_earned
  on public.user_badges(user_id, earned_at);

-- Leaderboard: top users by XP desc
create index if not exists idx_users_total_xp_desc
  on public.users(total_xp desc);

-- Creator list / admin view: filter by role
create index if not exists idx_users_role_created
  on public.users(role, created_at);

-- Admin KYC list: newest-first
create index if not exists idx_kyc_created
  on public.kyc_records(created_at desc);

-- payout_batch_run: eligible pending payouts
create index if not exists idx_payouts_pending
  on public.payouts(ccoin_amount)
  where status = 'pending' and batch_id is null;

-- ══════════════════════════════════════════════════════════════════════════
-- Leaderboard (get_leaderboard, keputusan 2026-08-27): TIDAK ada index baru.
-- Audit access-path vs index existing di 01_schema/05_indexes:
--   xp:       idx_users_total_xp_desc (total_xp desc) sudah cover sort primer;
--             tie-break xp_reached_at/username hanya untuk baris kecil (limit
--             5..50) — cost in-memory negligible.
--   cards:    idx_cards_owner (owner_id) sudah cukup untuk GROUP BY owner_id.
--             Partial index tambahan pada (owner_id) WHERE owner_id IS NOT
--             NULL tidak menambah nilai (btree existing sudah selective).
--   badges:   idx_user_badges_user_earned (user_id, earned_at) sudah cover
--             GROUP BY user_id + MAX(earned_at).
--   creator:  idx_cards_owner + idx_drops_creator sudah cukup untuk
--             join cards->drops filter creator_id.
-- Tidak ada gap performance genuine — index dekoratif dilarang (audit 2026-08-24).
-- ══════════════════════════════════════════════════════════════════════════

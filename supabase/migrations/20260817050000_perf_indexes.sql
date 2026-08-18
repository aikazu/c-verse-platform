-- C.Verse — Performance indexes (squashed phase 6/6)
-- Index hot-path: checkout/draw_drop (pick kartu tersedia), place_bid/accept_bid
-- (top bid aktif per kartu), set_buyout/cards guard (count listing aktif/owner),
-- badge trigger (index-only scan), leaderboard / creator list / admin KYC /
-- payout_batch_run. Additive — tak menghapus index lain.
-- (Predicate tidak bisa pakai cast enum `status::text` — ditolak 42P17;
--  filter defect diterapkan planner sebagai filter biasa di atas index.)

create index if not exists idx_cards_available_drop_variant
  on public.cards(drop_id, variant, unit_number)
  where owner_id is null;

create index if not exists idx_bids_card_active_amount
  on public.bids(card_id, amount_ccoin desc)
  where status = 'active';

create index if not exists idx_cards_owner_buyout
  on public.cards(owner_id)
  where buyout_price_ccoin is not null;

create index if not exists idx_user_badges_user_earned
  on public.user_badges(user_id, earned_at);

create index if not exists idx_users_total_xp_desc
  on public.users(total_xp desc);

create index if not exists idx_users_role_created
  on public.users(role, created_at);

create index if not exists idx_kyc_created
  on public.kyc_records(created_at desc);

create index if not exists idx_payouts_pending
  on public.payouts(ccoin_amount)
  where status = 'pending' and batch_id is null;
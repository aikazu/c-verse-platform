-- ── Performance: index untuk hot path (audit performance 2026-08-15) ─────────
-- checkout/draw_drop: pick kartu tersedia (drop_id + owner_id IS NULL + variant)
-- place_bid/accept_bid: lock & top bid aktif per kartu
-- set_buyout + cards_buyout_guard: count listing aktif per owner
-- badge trigger: count(distinct card_id) per owner (index-only scan)
-- leaderboard / creator list / admin KYC list / payout_batch_run

-- catatan: predicate tidak bisa memakai cast enum (`card_status_new::text` — STABLE,
-- ditolak 42P17); filter defect diterapkan planner sebagai filter biasa di atas index.
create index if not exists idx_cards_available_drop_variant
  on public.cards(drop_id, variant, unit_number)
  where owner_id is null;

create index if not exists idx_bids_card_active_amount
  on public.bids(card_id, amount_ccoin desc)
  where status = 'active';

create index if not exists idx_cards_owner_buyout
  on public.cards(owner_id)
  where buyout_price_ccoin is not null;

-- upgrade composite (prefix kompatibel dengan pemakaian lama)
drop index if exists idx_ownership_owner;
create index if not exists idx_ownership_owner_card
  on public.ownership_history(owner_id, card_id);

drop index if exists idx_user_badges_user;
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

-- redundan dengan uq_wtx_idempotency_key (unique, predikat identik) — overhead tulis doang
drop index if exists idx_wtx_metadata_idem;

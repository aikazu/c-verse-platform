-- ══════════════════════════════════════════════════════════════════════════
-- C.Verse — 03_schema_grants: index basis + unique/partial-unique dan
-- table-level grants/revokes (least-privilege — row tetap difilter RLS).
-- Lanjutan 01_schema / 02_schema_tables.
-- ══════════════════════════════════════════════════════════════════════════

-- ══════════════════════════════════════════════════════════════════════════
-- Index basis (access-path + uniqueness) — sumber: foundation.sql
-- ══════════════════════════════════════════════════════════════════════════
create index if not exists idx_drops_status on public.drops(status);
create index if not exists idx_drops_creator on public.drops(creator_id);
create index if not exists idx_cards_drop on public.cards(drop_id);
create index if not exists idx_cards_owner on public.cards(owner_id);
create index if not exists idx_cards_nfc_uid on public.cards(nfc_uid);
create index if not exists idx_cards_nfc_short on public.cards(nfc_short_id);
create index if not exists idx_cards_location on public.cards(location);
create index if not exists idx_cards_buyout on public.cards(buyout_price_ccoin) where buyout_price_ccoin is not null;
create index if not exists idx_cards_unit on public.cards(drop_id, unit_number);
create index if not exists idx_wtx_user_created on public.wallet_transactions(user_id, created_at desc);
create index if not exists idx_wtx_ref on public.wallet_transactions(ref_type, ref_id);
create index if not exists idx_orders_user on public.orders(user_id, created_at desc);
create index if not exists idx_orders_drop on public.orders(drop_id);
create index if not exists idx_bids_bidder on public.bids(bidder_id);
create index if not exists idx_bids_card on public.bids(card_id, status, amount_ccoin desc);
create unique index if not exists idx_bids_one_active_per_card on public.bids(card_id) where status = 'active';
create index if not exists idx_kyc_status on public.kyc_records(status);
create index if not exists idx_creators_user on public.creators(user_id);
create index if not exists idx_shipments_card on public.shipments(card_id);
create index if not exists idx_shipments_requester on public.shipments(requester_id);
create index if not exists idx_ownership_card on public.ownership_history(card_id, transferred_at desc);
create index if not exists idx_ownership_owner_card on public.ownership_history(owner_id, card_id);
create index if not exists idx_disputes_reporter on public.disputes(reporter_id);
create index if not exists idx_audit_admin on public.admin_audit_log(admin_user_id, created_at desc);
create index if not exists idx_audit_action on public.admin_audit_log(action);
create index if not exists idx_audit_target on public.admin_audit_log(target_table, target_id);
create index if not exists idx_notifications_user on public.notifications(user_id, created_at desc);
create index if not exists idx_payouts_user on public.payouts(user_id);
create index if not exists idx_payouts_batch on public.payouts(batch_id);
create index if not exists idx_cpv_creator on public.creator_page_views(creator_id, viewed_at desc);
create index if not exists idx_cpv_viewed on public.creator_page_views(viewed_at desc);
create index if not exists idx_qc_card on public.qc_defects(card_id);
create unique index if not exists idx_drop_entries_unique on public.drop_entries(drop_id, user_id);
create index if not exists idx_drop_entries_drop on public.drop_entries(drop_id, status);

-- ══════════════════════════════════════════════════════════════════════════
-- Constraint indexes (unique/partial-unique untuk integritas data)
-- ══════════════════════════════════════════════════════════════════════════
-- Idempotency ledger untuk wallet_debit/credit (RPC atomic layer).
create unique index if not exists uq_wtx_idempotency_key
  on public.wallet_transactions((metadata->>'idempotency_key'))
  where metadata->>'idempotency_key' is not null;

-- platform_revenue idempotent per (ref_type, ref_id).
create unique index if not exists uq_platform_revenue_ref on public.platform_revenue(ref_type, ref_id);

-- M7 (audit 2026-08-24): vault-shipout duplicate-insert guard.
-- Final terminal statuses (delivered/cancelled) dikecualikan supaya kartu bisa
-- di-ship ulang setelah transaksi sebelumnya selesai.
create unique index if not exists uq_shipments_active_per_card
  on public.shipments (card_id)
  where status not in ('delivered', 'cancelled');

-- ══════════════════════════════════════════════════════════════════════════
-- GRANT tabel (least-privilege — row tetap difilter RLS)
-- ══════════════════════════════════════════════════════════════════════════
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

-- Anon read publik yang aman. users, bids, creators, cards, dan provenance
-- sensitif hanya dibaca lewat API service-role atau RPC yang memproyeksikan
-- payload aman.
revoke all on public.users from anon;
revoke select on public.bids from anon;
revoke select on public.creators from anon;
revoke select on public.cards from anon;
revoke select on public.ownership_history from anon;
revoke select on public.bids from authenticated;
revoke select on public.ownership_history from authenticated;
revoke select on public.creators from authenticated;
revoke insert on public.bids from authenticated;
grant select on public.drops, public.badges to anon;

-- Authenticated read mengikuti matriks RLS. Bid hanya melalui SECURITY
-- DEFINER RPC; ownership provenance hanya melalui API service-role.
grant select on
  public.users, public.drops, public.cards, public.orders,
  public.wallets, public.wallet_transactions, public.shipments,
  public.badges, public.user_badges, public.kyc_records,
  public.payouts, public.notifications, public.disputes, public.creator_page_views,
  public.gem_lots, public.gem_transactions
to authenticated;
grant select (
  id, user_id, handle, total_followers_combined, status,
  kyc_completed, notes, created_at, updated_at
) on public.creators to authenticated;
grant insert on public.kyc_records, public.disputes to authenticated;
grant update on public.users, public.cards, public.notifications to authenticated;

-- C-Gems tables (dual-token 2026-09-03): anon DITUTUP total (lesson audit
-- 2026-08-30 — default privileges Supabase memberi ALL ke anon pada tabel
-- baru; revoke eksplisit wajib). Tulis HANYA via RPC SECURITY DEFINER
-- (wallet_credit_gems/wallet_debit_gems); read owner-only via RLS (05_rls).
-- Review 2026-09-02: authenticated juga menerima ALL dari default privileges —
-- write di-revoke eksplisit (SELECT di atas tetap; JANGAN revoke all —
-- getWallet membaca gem_lots via user-scoped client, dilindungi RLS own-row).
revoke all on public.gem_lots, public.gem_transactions from anon;
revoke insert, update, delete, truncate, references, trigger
  on public.gem_lots, public.gem_transactions from authenticated;

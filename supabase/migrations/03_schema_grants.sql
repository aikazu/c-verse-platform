-- ══════════════════════════════════════════════════════════════════════════
-- C.Verse — 01c_indexes_grants: index basis + unique/partial-unique dan
-- table-level grants/revokes (least-privilege — row tetap difilter RLS).
-- Lanjutan 01_schema / 01b_schema_tables (urutan leksikal: 01_ < 01b_ < 01c_).
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

-- anon: read publik. creator_page_views is write-via-RPC-only
-- (record_creator_page_view SECURITY DEFINER; RLS default-deny, no direct INSERT).
-- F4 (pentest 2026-08-30): public.users ditutup untuk anon — email terekspos
-- via policy `not is_anonymous` lama. revoke eksplisit WAJIB: default
-- privileges Supabase memberi ALL ke anon pada tabel baru, jadi cukup tidak
-- me-grant tidak menutup apa pun. Akses admin lewat grant authenticated +
-- policy users_select (public.is_admin) di 03_rls.
-- Lane D (2026-08-31): bids (bidder_name raw) + creators (bank_account/notes)
-- ditutup untuk anon — read publik hanya via API service-role / RPC
-- (buktinya: anon key bisa POSTGREST-read bank_account kreator sebelum revoke).
revoke all on public.users from anon;
revoke select on public.bids from anon;
revoke select on public.creators from anon;
grant select on public.drops, public.cards, public.ownership_history, public.badges to anon;

-- authenticated: read sesuai matriks RLS + write minimum (guard trigger).
-- creators TETAP di-grant ke authenticated (Lane D 2026-08-31): admin SPA
-- (Creators.tsx/Dashboard.tsx) membaca creators langsung via supabase-js —
-- revoke authenticated menunggu read tersebut pindah ke API.
grant select on
  public.users, public.creators, public.drops, public.cards, public.orders,
  public.wallets, public.wallet_transactions, public.bids, public.shipments,
  public.ownership_history, public.badges, public.user_badges, public.kyc_records,
  public.payouts, public.notifications, public.disputes, public.creator_page_views,
  public.gem_lots, public.gem_transactions
to authenticated;
grant insert on public.bids, public.kyc_records, public.disputes to authenticated;
grant update on public.users, public.cards, public.notifications to authenticated;

-- C-Gems tables (dual-token 2026-09-03): anon DITUTUP total (lesson audit
-- 2026-08-30 — default privileges Supabase memberi ALL ke anon pada tabel
-- baru; revoke eksplisit wajib). Tulis HANYA via RPC SECURITY DEFINER
-- (wallet_credit_gems/wallet_debit_gems); read owner-only via RLS (03_rls).
-- Review 2026-09-02: authenticated juga menerima ALL dari default privileges —
-- write di-revoke eksplisit (SELECT di atas tetap; JANGAN revoke all —
-- getWallet membaca gem_lots via user-scoped client, dilindungi RLS own-row).
revoke all on public.gem_lots, public.gem_transactions from anon;
revoke insert, update, delete, truncate, references, trigger
  on public.gem_lots, public.gem_transactions from authenticated;

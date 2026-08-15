-- ── Table privileges per docs/11 §3.3 (grant minimal, jangan `grant all` ke anon) ─
-- Gap ditemukan via local `supabase db reset` + rls_test.sql: RLS policy saja tidak
-- cukup — role anon/authenticated butuh GRANT DML; Supabase cloud memberi ini via
-- default privileges platform, tapi environment segar (CLI lokal / project baru)
-- tidak. Baris tetap difilter RLS; service_role bypass RLS.

-- service_role: full DML (admin app + provisioning; RLS bypass)
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

-- anon: read publik saja (row tetap difilter policy select masing-masing)
grant select on public.users, public.creators, public.drops, public.cards, public.bids, public.ownership_history, public.badges to anon;
-- log kunjungan halaman kreator dari web anonim (policy insert with check true, tanpa select)
grant insert on public.creator_page_views to anon;

-- authenticated: select sesuai matriks + write minimum
grant select on
  public.users, public.creators, public.drops, public.cards, public.orders,
  public.wallets, public.wallet_transactions, public.bids, public.shipments,
  public.ownership_history, public.badges, public.user_badges, public.kyc_records,
  public.payouts, public.notifications, public.disputes
to authenticated;
-- insert: bid langsung, submit KYC sendiri, dispute, page view
grant insert on public.bids, public.kyc_records, public.disputes, public.creator_page_views to authenticated;
-- update: profil sendiri (non-role field via policy), buyout price kartu sendiri
-- (kolom lain diblok guard trigger), flag notifikasi sendiri
grant update on public.users, public.cards, public.notifications to authenticated;

-- Tabel TANPA grant anon/authenticated (service only): payout_batches, nfc_batches,
-- qc_defects, admin_audit_log. wallet_transactions append-only dijaga guard trigger.

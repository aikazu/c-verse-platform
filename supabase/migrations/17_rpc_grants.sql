-- 17: EXECUTE grants per role.

-- Wallet operations (X1 audit 2026-08-29: default privileges Supabase memberi
-- EXECUTE ke anon/authenticated saat CREATE FUNCTION — revoke from public saja
-- tidak menghapusnya; revoke eksplisit per-role, pola payout_batch_run).
-- debit: authenticated self-only (guard auth.uid() in-body); credit: service_role
-- only (top-up mint via Midtrans webhook).
revoke execute on function public.wallet_debit(uuid, integer, text, text, text, text) from public;
revoke execute on function public.wallet_debit(uuid, integer, text, text, text, text) from anon;
grant execute on function public.wallet_debit(uuid, integer, text, text, text, text) to service_role;
grant execute on function public.wallet_debit(uuid, integer, text, text, text, text) to authenticated;

revoke execute on function public.wallet_credit(uuid, integer, text, text, text, text) from public;
revoke execute on function public.wallet_credit(uuid, integer, text, text, text, text) from anon;
revoke execute on function public.wallet_credit(uuid, integer, text, text, text, text) from authenticated;
grant execute on function public.wallet_credit(uuid, integer, text, text, text, text) to service_role;

-- C-Gems kernel (dual-token 2026-09-03) — internal only: dipanggil RPC
-- SECURITY DEFINER lain (checkout/draw_drop/accept_bid/buyout_card/
-- release_seed_sale/send_support/payout_request/payout_refund/convert_gems).
-- Lesson audit 2026-08-30: revoke eksplisit per-role (bukan cuma public).
revoke execute on function public.wallet_credit_gems(uuid, integer, text, text, text, text, boolean) from public;
revoke execute on function public.wallet_credit_gems(uuid, integer, text, text, text, text, boolean) from anon;
revoke execute on function public.wallet_credit_gems(uuid, integer, text, text, text, text, boolean) from authenticated;
grant execute on function public.wallet_credit_gems(uuid, integer, text, text, text, text, boolean) to service_role;

revoke execute on function public.wallet_debit_gems(uuid, integer, text, text, text, text, boolean) from public;
revoke execute on function public.wallet_debit_gems(uuid, integer, text, text, text, text, boolean) from anon;
revoke execute on function public.wallet_debit_gems(uuid, integer, text, text, text, text, boolean) from authenticated;
grant execute on function public.wallet_debit_gems(uuid, integer, text, text, text, text, boolean) to service_role;

-- convert_gems — user-facing (authenticated): Gems→C-Coin 1:1.
revoke execute on function public.convert_gems(integer) from public;
revoke execute on function public.convert_gems(integer) from anon;
grant execute on function public.convert_gems(integer) to authenticated;

-- Checkout / bid / marketplace — user-facing.
-- Lane D (2026-08-31): revoke EKSPLISIT anon pada SEMUA RPC user-facing
-- (pola send_support): default-privileges Supabase memberi EXECUTE ke anon
-- saat CREATE FUNCTION, dan `revoke from public` saja tidak menghapusnya —
-- tanpa ini anon key bisa mengeksekusi RPC (bukti: pentest t10..t18).
revoke execute on function public.checkout(text, text) from public;
revoke execute on function public.checkout(text, text) from anon;
grant execute on function public.checkout(text, text) to authenticated;

revoke execute on function public.vault_shipout(text, text) from public;
revoke execute on function public.vault_shipout(text, text) from anon;
grant execute on function public.vault_shipout(text, text) to authenticated;

revoke execute on function public.drop_entry(text, text) from public;
revoke execute on function public.drop_entry(text, text) from anon;
grant execute on function public.drop_entry(text, text) to authenticated;

revoke execute on function public.place_bid(text, integer) from public;
revoke execute on function public.place_bid(text, integer) from anon;
grant execute on function public.place_bid(text, integer) to authenticated;

revoke execute on function public.cancel_bid(text) from public;
revoke execute on function public.cancel_bid(text) from anon;
grant execute on function public.cancel_bid(text) to authenticated;

revoke execute on function public.accept_bid(text, public.shipment_to_dest, text) from public;
revoke execute on function public.accept_bid(text, public.shipment_to_dest, text) from anon;
grant execute on function public.accept_bid(text, public.shipment_to_dest, text) to authenticated;

revoke execute on function public.set_buyout(text, integer) from public;
revoke execute on function public.set_buyout(text, integer) from anon;
grant execute on function public.set_buyout(text, integer) to authenticated;

revoke execute on function public.buyout_card(text, public.shipment_to_dest, text) from public;
revoke execute on function public.buyout_card(text, public.shipment_to_dest, text) from anon;
grant execute on function public.buyout_card(text, public.shipment_to_dest, text) to authenticated;

-- send_support (A1 2026-08-31) — user-facing. Pentest lesson: revoke eksplisit
-- anon + public (default-privileges Supabase memberi EXECUTE saat CREATE FUNCTION).
revoke execute on function public.send_support(uuid, integer) from public;
revoke execute on function public.send_support(uuid, integer) from anon;
grant execute on function public.send_support(uuid, integer) to authenticated;

-- Badges + XP — internal/service (X1 audit 2026-08-29: trigger-invoked only
-- via perform; tidak ada path end-user — revoke anon+authenticated).
revoke execute on function public.award_badge_if_eligible(uuid, text) from public;
revoke execute on function public.award_badge_if_eligible(uuid, text) from anon;
revoke execute on function public.award_badge_if_eligible(uuid, text) from authenticated;
grant execute on function public.award_badge_if_eligible(uuid, text) to service_role;

-- F1 (pentest 2026-08-30): tanpa revoke eksplisit, default-privileges Supabase
-- memberi EXECUTE ke anon/authenticated — JWT apa pun bisa mint XP + insert
-- wallet_transactions palsu via PostgREST. Internal `perform` only.
revoke execute on function public.record_spend_conversion(uuid, integer, text) from public;
revoke execute on function public.record_spend_conversion(uuid, integer, text) from anon;
revoke execute on function public.record_spend_conversion(uuid, integer, text) from authenticated;
grant execute on function public.record_spend_conversion(uuid, integer, text) to service_role;

-- Cron — service_role only. P2a (pentest 2026-08-30): revoke eksplisit
-- anon+authenticated — caller tunggal apps/api/src/lib/cron.ts via
-- service-role client (bypass grants), jadi revoke ini aman.
revoke execute on function public.draw_drop(text) from public;
revoke execute on function public.draw_drop(text) from anon;
revoke execute on function public.draw_drop(text) from authenticated;
grant execute on function public.draw_drop(text) to service_role;

revoke execute on function public.draw_pending_drops() from public;
revoke execute on function public.draw_pending_drops() from anon;
revoke execute on function public.draw_pending_drops() from authenticated;
grant execute on function public.draw_pending_drops() to service_role;

revoke execute on function public.activate_scheduled_drops() from public;
revoke execute on function public.activate_scheduled_drops() from anon;
revoke execute on function public.activate_scheduled_drops() from authenticated;
grant execute on function public.activate_scheduled_drops() to service_role;

revoke execute on function public.payout_batch_run(integer) from public;
revoke execute on function public.payout_batch_run(integer) from anon;
revoke execute on function public.payout_batch_run(integer) from authenticated;
grant execute on function public.payout_batch_run(integer) to service_role;

-- Payout + seed admin — service_role only + revoke from public/anon/authenticated
revoke execute on function public.payout_request(integer) from public;
revoke execute on function public.payout_request(integer) from anon;
grant execute on function public.payout_request(integer) to authenticated;

revoke execute on function public.payout_refund(text) from public;
revoke execute on function public.payout_refund(text) from anon;
revoke execute on function public.payout_refund(text) from authenticated;
grant execute on function public.payout_refund(text) to service_role;

-- F2 (pentest 2026-08-30): anon bisa fabrikasi revenue row + kredit treasury —
-- revoke eksplisit (pola payout_batch_run); internal `perform` only.
revoke execute on function public.record_platform_revenue(text, text, text, integer, integer, integer, integer) from public;
revoke execute on function public.record_platform_revenue(text, text, text, integer, integer, integer, integer) from anon;
revoke execute on function public.record_platform_revenue(text, text, text, integer, integer, integer, integer) from authenticated;
grant execute on function public.record_platform_revenue(text, text, text, integer, integer, integer, integer) to service_role;

revoke execute on function public.release_seed_sale(text) from public;
revoke execute on function public.release_seed_sale(text) from anon;
revoke execute on function public.release_seed_sale(text) from authenticated;
grant execute on function public.release_seed_sale(text) to service_role;

revoke execute on function public.cancel_seed_sale(text) from public;
revoke execute on function public.cancel_seed_sale(text) from anon;
revoke execute on function public.cancel_seed_sale(text) from authenticated;
grant execute on function public.cancel_seed_sale(text) to service_role;

revoke execute on function public.admin_fulfill_shipment(text, text, text) from public;
revoke execute on function public.admin_fulfill_shipment(text, text, text) from anon;
revoke execute on function public.admin_fulfill_shipment(text, text, text) from authenticated;
grant execute on function public.admin_fulfill_shipment(text, text, text) to service_role;

-- Leaderboard: read-only publik (anon + authenticated) + service_role
revoke execute on function public.get_leaderboard(text, uuid, integer) from public;
grant execute on function public.get_leaderboard(text, uuid, integer) to anon;
grant execute on function public.get_leaderboard(text, uuid, integer) to authenticated;
grant execute on function public.get_leaderboard(text, uuid, integer) to service_role;

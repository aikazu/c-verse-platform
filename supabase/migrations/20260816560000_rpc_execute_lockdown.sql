-- ── CRITICAL fix: EXECUTE default ke PUBLIC membuat semua RPC security definer
-- bisa dipanggil siapa pun via PostgREST (anon key saja cukup):
--   wallet_credit  -> mint C-Coin tak terbatas ke wallet mana pun
--   wallet_debit   -> sedot saldo user lain
--   award_badge_if_eligible / record_spend_conversion -> XP & badge gratis
--   draw_drop / cron RPC -> trigger draw & batch payout
-- Terkonfirmasi dieksploitasi di lokal: POST /rest/v1/rpc/wallet_credit dengan
-- anon key mengkredit 999.999 C-Coin tanpa login.
--
-- Kebijakan least-privilege:
--   * auth.uid()-based RPC (checkout, bids, buyout) -> authenticated saja
--   * wallet_credit + RPC internal/cron                 -> service_role saja
--   * wallet_debit -> authenticated (self-only guard baru) + service_role

-- 1) Cabut execute default PUBLIC dari SEMUA RPC sensitif
revoke execute on function public.checkout(text, text, public.delivery_option, text, integer) from public;
revoke execute on function public.drop_entry(text, text) from public;
revoke execute on function public.place_bid(text, integer) from public;
revoke execute on function public.cancel_bid(text) from public;
revoke execute on function public.accept_bid(text, public.shipment_to_dest) from public;
revoke execute on function public.set_buyout(text, integer) from public;
revoke execute on function public.buyout_card(text) from public;
revoke execute on function public.wallet_debit(uuid, integer, text, text, text, text) from public;
revoke execute on function public.wallet_credit(uuid, integer, text, text, text, text) from public;
revoke execute on function public.award_badge_if_eligible(uuid, text) from public;
revoke execute on function public.record_spend_conversion(uuid, integer, text) from public;
revoke execute on function public.draw_drop(text) from public;
revoke execute on function public.draw_pending_drops() from public;
revoke execute on function public.escrow_auto_release() from public;
revoke execute on function public.payout_batch_run(integer) from public;

-- (is_service_role sengaja TIDAK dicabut — dipanggil dalam ekspresi policy RLS
--  milik anon/authenticated; mencabut execute-nya mematahkan evaluasi policy.)

-- 2) Grant least-privilege
-- user-facing (security definer, identitas dari auth.uid()):
grant execute on function public.checkout(text, text, public.delivery_option, text, integer) to authenticated;
grant execute on function public.drop_entry(text, text) to authenticated;
grant execute on function public.place_bid(text, integer) to authenticated;
grant execute on function public.cancel_bid(text) to authenticated;
grant execute on function public.accept_bid(text, public.shipment_to_dest) to authenticated;
grant execute on function public.set_buyout(text, integer) to authenticated;
grant execute on function public.buyout_card(text) to authenticated;
-- internal (cron/admin) + webhook payments:
grant execute on function public.wallet_debit(uuid, integer, text, text, text, text) to service_role;
grant execute on function public.wallet_credit(uuid, integer, text, text, text, text) to service_role;
grant execute on function public.award_badge_if_eligible(uuid, text) to service_role;
grant execute on function public.record_spend_conversion(uuid, integer, text) to service_role;
grant execute on function public.draw_drop(text) to service_role;
grant execute on function public.draw_pending_drops() to service_role;
grant execute on function public.escrow_auto_release() to service_role;
grant execute on function public.payout_batch_run(integer) to service_role;

-- wallet_debit juga dipanggil API dengan JWT user (ongkir ship-from-vault,
-- orders.ts) — authenticated boleh, TAPI hanya untuk mendebet diri sendiri.
grant execute on function public.wallet_debit(uuid, integer, text, text, text, text) to authenticated;

-- 3) Guard self-only pada wallet_debit untuk pemanggil non-service.
-- PENTING: deteksi pakai GUC `role`, BUKAN is_service_role()/current_user —
-- di dalam fungsi SECURITY DEFINER, current_user selalu = owner (postgres)
-- sehingga cek berbasis current_user selalu lolos. GUC `role` tetap
-- merefleksikan role pemanggil terluar (PostgREST: anon/authenticated/
-- service_role). GUC kosong/'none' = koneksi admin langsung (seed/psql).
create or replace function public.wallet_debit(
  p_user uuid,
  p_amount integer,
  p_type text,
  p_ref_type text,
  p_ref_id text,
  p_idem text
) returns public.wallet_transactions
language plpgsql security definer set search_path = public as $$
declare
  v_wallet public.wallets;
  v_tx public.wallet_transactions;
begin
  if p_amount is null or p_amount < 1 then raise exception 'INVALID_AMOUNT'; end if;
  if coalesce(current_setting('role', true), '') in ('authenticated', 'anon') and p_user is distinct from auth.uid() then
    raise exception 'FORBIDDEN';
  end if;
  if p_idem is not null then
    select * into v_tx from wallet_transactions where metadata->>'idempotency_key' = p_idem;
    if found then return v_tx; end if; -- idempotent replay
  end if;

  select * into v_wallet from wallets where user_id = p_user for update;
  if not found then
    insert into wallets (user_id) values (p_user);
    select * into v_wallet from wallets where user_id = p_user for update;
  end if;
  if v_wallet.balance_ccoin < p_amount then raise exception 'INSUFFICIENT'; end if;

  update wallets set balance_ccoin = balance_ccoin - p_amount,
    total_spent_ccoin = total_spent_ccoin + p_amount
  where user_id = p_user
  returning * into v_wallet;

  -- spend 1 C-Coin = 1 XP (checkout/platform_buy); hold & payout bukan spend XP
  if p_type in ('checkout','platform_buy') then
    update users set total_xp = total_xp + p_amount,
      level = least(100, greatest(1, floor((total_xp + p_amount) / 10) + 1))
    where id = p_user;
  end if;

  insert into wallet_transactions (id, user_id, type, amount_ccoin, balance_after_ccoin, ref_type, ref_id, note, metadata)
  values (gen_random_uuid()::text, p_user, p_type::wallet_tx_type, -p_amount, v_wallet.balance_ccoin, p_ref_type, p_ref_id,
          null, jsonb_build_object('idempotency_key', coalesce(p_idem, gen_random_uuid()::text)))
  returning * into v_tx;
  return v_tx;
end $$;

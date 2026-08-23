-- C.Verse — Payout refund RPC (admin path) + status enum extension
-- Founder decision 2026-08-23: payout disbursement = manual (admin transfers
-- via IRIS dashboard / other channel by hand). Automatic IRIS wiring = post-MVP.
-- What is needed now is a clean, audited refund path so an admin can return
-- locked funds to a creator when a payout will not / did not disburse.

-- ══════════════════════════════════════════════════════════════════════════
-- 1. Extend payouts.status check to allow 'processing' (batch run) and
--    'refunded' (admin refund). Webhook already writes 'disbursed'/'failed'.
-- ══════════════════════════════════════════════════════════════════════════
alter table public.payouts
  drop constraint if exists payouts_status_check;
alter table public.payouts
  add constraint payouts_status_check
    check (status in ('pending','processing','disbursed','failed','refunded'));

-- ══════════════════════════════════════════════════════════════════════════
-- 2. payout_refund(p_payout_id) — admin-only refund path
--    Locks the row, rejects terminal states ('disbursed','refunded'),
--    credits the owner's wallet via wallet_credit (idempotent), and flips
--    the payout row to 'refunded' in a single transaction. SECURITY DEFINER
--    + grant restricted to service_role (caller is admin API).
-- ══════════════════════════════════════════════════════════════════════════
create or replace function public.payout_refund(p_payout_id text) returns public.payouts
language plpgsql security definer set search_path = public as $$
declare
  v_payout public.payouts;
begin
  if p_payout_id is null or p_payout_id = '' then
    raise exception 'INVALID_ARG';
  end if;

  select * into v_payout from payouts where id = p_payout_id for update;
  if not found then
    raise exception 'NOT_FOUND';
  end if;

  if v_payout.status in ('disbursed','refunded') then
    raise exception 'INVALID_STATE: payout status % tidak bisa di-refund', v_payout.status;
  end if;

  -- Return locked funds to creator wallet. wallet_credit is idempotent by
  -- p_idem — replay (admin retries, cron double-call) is safe.
  perform public.wallet_credit(
    v_payout.user_id,
    v_payout.ccoin_amount,
    'payout_refund',
    'payout',
    v_payout.id,
    'payout-refund-' || v_payout.id
  );

  update payouts set status = 'refunded' where id = v_payout.id returning * into v_payout;
  return v_payout;
end $$;

-- ══════════════════════════════════════════════════════════════════════════
-- 3. EXECUTE grants (least-privilege, paritas phase 5/7). Admin API routes
--    call via service_role Supabase client.
-- ══════════════════════════════════════════════════════════════════════════
revoke execute on function public.payout_refund(text) from public;
grant execute on function public.payout_refund(text) to service_role;

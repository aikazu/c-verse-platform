-- C.Verse — Privileges + payout batch (squashed phase 5/7)
-- GRANT minimal per role (jangan `grant all` ke anon/auth — baris tetap difilter RLS)
-- + revoke/grant EXECUTE RPC (least-privilege, cegah eksploit PostgREST anon)
-- + RPC cron payout_batch_run.

-- ══════════════════════════════════════════════════════════════════════════
-- GRANT tabel (rheiseter version of 20260816400000_rls_grants.sql)
-- ══════════════════════════════════════════════════════════════════════════
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

-- anon: read publik saja (row tetap difilter policy select masing-masing)
grant select on public.users, public.creators, public.drops, public.cards, public.bids, public.ownership_history, public.badges to anon;
grant insert on public.creator_page_views to anon;

-- authenticated: select sesuai matriks + write minimum
grant select on
  public.users, public.creators, public.drops, public.cards, public.orders,
  public.wallets, public.wallet_transactions, public.bids, public.shipments,
  public.ownership_history, public.badges, public.user_badges, public.kyc_records,
  public.payouts, public.notifications, public.disputes
to authenticated;
grant insert on public.bids, public.kyc_records, public.disputes, public.creator_page_views to authenticated;
grant update on public.users, public.cards, public.notifications to authenticated;

-- ══════════════════════════════════════════════════════════════════════════
-- payout_batch_run: cron Workers (Selasa 06:00 WIB). Handler RPC, bukan
-- disbursement (pembayaran nyata via Midtrans). Grup payout pending eligible.
-- Dibuat dulu agar revoke/grant execute di bawah valid.
-- ══════════════════════════════════════════════════════════════════════════
create or replace function public.payout_batch_run(p_min_ccoin integer default 10) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_batch_id text;
  v_count integer;
begin
  select count(*) into v_count
  from payouts p
  join users u on u.id = p.user_id
  join kyc_records k on k.user_id = p.user_id and k.status = 'approved'
  left join wallets w on w.user_id = p.user_id
  where p.status = 'pending'
    and p.batch_id is null
    and p.ccoin_amount >= p_min_ccoin
    and coalesce(w.hold_payout_until, now()) <= now();
  if v_count = 0 then
    return null;
  end if;

  insert into payout_batches (id, batch_code, status, total_ccoin, total_idr, fee_1pct_idr)
  values (
    gen_random_uuid()::text,
    'PB-' || to_char(now(), 'YYYYMMDD-HH24MISS'),
    'processing',
    0,
    0,
    0
  )
  returning id into v_batch_id;

  -- net_idr = (ccoin - ceil(ccoin x 0.01)) x 10.000 (100 C -> 99 C -> Rp 990.000)
  update payouts p
  set batch_id = v_batch_id,
      idr_amount = (p.ccoin_amount - ceil(p.ccoin_amount * 0.01)) * 10000
  where p.status = 'pending'
    and p.batch_id is null
    and p.ccoin_amount >= p_min_ccoin
    and p.user_id in (select user_id from kyc_records where status = 'approved')
    and not exists (
      select 1 from wallets w
      where w.user_id = p.user_id and w.hold_payout_until > now()
    );

  update payout_batches b
  set total_ccoin = s.gross_ccoin,
      total_idr = s.net_idr,
      fee_1pct_idr = s.fee_idr
  from (
    select
      coalesce(sum(ccoin_amount), 0) as gross_ccoin,
      coalesce(sum(idr_amount), 0) as net_idr,
      coalesce(sum(ceil(ccoin_amount * 0.01)) * 10000, 0) as fee_idr
    from payouts where batch_id = v_batch_id
  ) s
  where b.id = v_batch_id;

  return v_batch_id;
end $$;

-- ══════════════════════════════════════════════════════════════════════════
-- RPC EXECUTE lockdown (least-privilege; cegah mint/sedot lewat anon)
--   * auth.uid()-based (checkout, bids, buyout, set_buyout) -> authenticated
--   * wallet_credit + internal/cron/webhook               -> service_role
--   * wallet_debit -> authenticated (self-only guard) + service_role
-- (is_service_role sengaja TIDAK dicabut public — dipakai evaluasi policy RLS anon/auth.)
-- ══════════════════════════════════════════════════════════════════════════
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

grant execute on function public.checkout(text, text, public.delivery_option, text, integer) to authenticated;
grant execute on function public.drop_entry(text, text) to authenticated;
grant execute on function public.place_bid(text, integer) to authenticated;
grant execute on function public.cancel_bid(text) to authenticated;
grant execute on function public.accept_bid(text, public.shipment_to_dest) to authenticated;
grant execute on function public.set_buyout(text, integer) to authenticated;
grant execute on function public.buyout_card(text) to authenticated;

grant execute on function public.wallet_debit(uuid, integer, text, text, text, text) to service_role;
grant execute on function public.wallet_credit(uuid, integer, text, text, text, text) to service_role;
grant execute on function public.award_badge_if_eligible(uuid, text) to service_role;
grant execute on function public.record_spend_conversion(uuid, integer, text) to service_role;
grant execute on function public.draw_drop(text) to service_role;
grant execute on function public.draw_pending_drops() to service_role;
grant execute on function public.escrow_auto_release() to service_role;
grant execute on function public.payout_batch_run(integer) to service_role;
-- wallet_debit juga dipanggil API dengan JWT user (ongkir ship-from-vault)
grant execute on function public.wallet_debit(uuid, integer, text, text, text, text) to authenticated;
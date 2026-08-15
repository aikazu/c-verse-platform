-- ── Cron RPC payout_batch_run (docs/14 §3.2 + docs/08 §3.3) ──────────────────
-- Dipanggil Workers cron Selasa 06:00 WIB (Mon 23:00 UTC) dan/atau trigger admin
-- ADM-05. Hanya mengelompokkan payouts pending yang eligible ke satu batch
-- (fee 1%, net IDR); disbursement nyata via Midtrans API loop dan status final
-- via POST /api/payments/midtrans/payout-webhook.
-- Eligible (docs/14): KYC approved, >= min 10 C-Coin, hold_payout_until lewat.

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

  -- net_idr = (ccoin - ceil(ccoin x 0.01)) x 10.000 (docs/14 §3.2: 100 C -> 99 C -> Rp 990.000)
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

-- Match the API suspension gate at user-callable PostgREST RPC boundaries.
create or replace function public.convert_gems(p_amount integer) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
begin
  perform public.assert_active_actor();
  if p_amount is null or p_amount < 1 then raise exception 'INVALID_AMOUNT'; end if;

  perform public.wallet_debit_gems(v_user, p_amount, 'convert', 'user', v_user::text,
          'gems-convert-' || v_user || '-' || gen_random_uuid()::text, false);
  perform public.wallet_credit(v_user, p_amount, 'convert', 'user', v_user::text,
          'cc-convert-' || v_user || '-' || gen_random_uuid()::text);
end $$;

create or replace function public.cancel_bid(p_bid_id text) returns public.bids
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_bid public.bids;
begin
  perform public.assert_active_actor();
  select * into v_bid from bids where id = p_bid_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if v_bid.bidder_id <> v_user then raise exception 'FORBIDDEN'; end if;
  if v_bid.status <> 'active' then raise exception 'NOT_ACTIVE'; end if;
  -- BID_CANCEL_COOLDOWN (BID_CANCEL_COOLDOWN_HOURS = 24): tolak sebelum wallet
  -- write apa pun. Boundary strict `>`: created_at tepat now()-24h sudah boleh.
  if v_bid.created_at > now() - interval '24 hours' then
    raise exception 'BID_CANCEL_COOLDOWN';
  end if;

  perform public.wallet_credit(v_user, v_bid.amount_ccoin, 'escrow_release', 'bid', v_bid.id, 'release-' || v_bid.id);
  update bids set status = 'cancelled', cancelled_at = now() where id = p_bid_id returning * into v_bid;
  return v_bid;
end $$;

create or replace function public.send_support(
  p_creator uuid,
  p_amount integer
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_debit_tx public.wallet_transactions;
begin
  perform public.assert_active_actor();
  if p_amount is null or p_amount < 1 then raise exception 'INVALID_AMOUNT'; end if;
  if p_creator = v_user then raise exception 'SELF_SUPPORT'; end if;
  if not exists (select 1 from users where id = p_creator and role = 'creator' and flag_reason is null) then
    raise exception 'CREATOR_NOT_FOUND';
  end if;
  -- Lane D (2026-08-31): creators.status wajib 'active' — baris users bisa
  -- lolos (role creator, flag null) sementara page kreator sudah di-suspend.
  if not exists (select 1 from creators where user_id = p_creator and status = 'active') then
    raise exception 'CREATOR_NOT_ACTIVE';
  end if;

  v_debit_tx := public.wallet_debit(v_user, p_amount, 'support', 'user', p_creator::text,
          'support-debit-' || gen_random_uuid()::text);
  -- Dual-token 2026-09-03: dukungan yang DITERIMA kreator = gems (lot 24h);
  -- sender debit + XP C-Coin tidak berubah.
  perform public.wallet_credit_gems(p_creator, p_amount, 'support', 'user', v_user::text,
          'support-credit-' || gen_random_uuid()::text);

  return jsonb_build_object(
    'transactionId', v_debit_tx.id,
    'balanceCcoin', v_debit_tx.balance_after_ccoin
  );
end $$;

create or replace function public.payout_request(p_amount integer) returns public.payouts
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_wallet public.wallets;
  v_payout public.payouts;
begin
  perform public.assert_active_actor();
  if p_amount is null or p_amount < 10 then raise exception 'MIN_PAYOUT'; end if;
  if not exists (select 1 from kyc_records k where k.user_id = v_user and k.status = 'approved') then
    raise exception 'KYC_REQUIRED';
  end if;

  select * into v_wallet from wallets where user_id = v_user for update;
  if v_wallet.hold_payout_until is not null and v_wallet.hold_payout_until > now() then
    raise exception 'PAYOUT_HELD';
  end if;

  -- Dana dikunci (debit GEMS matured saja) sampai batch disbursed; gagal batch
  -- -> payout_refund kredit balik gems sebagai lot langsung matured.
  perform public.wallet_debit_gems(v_user, p_amount, 'payout', 'payout_request', null,
          'payout-req-' || v_user || '-' || gen_random_uuid()::text, true);

  -- idr_amount diisi payout_batch_run (net setelah fee 1%); 0 = placeholder.
  insert into payouts (id, user_id, type, ccoin_amount, idr_amount, status, requested_at)
  values (gen_random_uuid()::text, v_user, 'seller_proceeds', p_amount, 0, 'pending', now())
  returning * into v_payout;
  return v_payout;
end $$;

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
  if coalesce(current_setting('role',true),'') in ('authenticated','anon') then
    perform public.assert_active_actor();
  end if;
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

  -- spend 1 C-Coin = 1 XP (checkout/platform_buy/support); hold & payout bukan spend XP.
  -- cumulative_spend_ccoin mirrors spend-derived XP only (badge rewards excluded);
  -- top-up never reaches here. Used by gamification leaderboards/leveling.
  -- support (A1 2026-08-31): pengirim dukungan tetap dapat XP 1:1 (aturan spend);
  -- kredit kreator lewat wallet_credit TIDAK memberi XP.
  if p_type in ('checkout','platform_buy','support') then
    update users set total_xp = total_xp + p_amount,
      cumulative_spend_ccoin = cumulative_spend_ccoin + p_amount,
      level = least(100, greatest(1, floor((total_xp + p_amount) / 10) + 1))
    where id = p_user;
  end if;

  insert into wallet_transactions (id, user_id, type, amount_ccoin, balance_after_ccoin, ref_type, ref_id, note, metadata)
  values (gen_random_uuid()::text, p_user, p_type::wallet_tx_type, -p_amount, v_wallet.balance_ccoin, p_ref_type, p_ref_id,
          null, jsonb_build_object('idempotency_key', coalesce(p_idem, gen_random_uuid()::text)))
  returning * into v_tx;
  return v_tx;
end $$;

-- 04a: RPC kernel wallet + gems + notify_user (part of consolidated RPC set; apply in lexical order).
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

create or replace function public.wallet_credit(
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
  if p_idem is not null then
    select * into v_tx from wallet_transactions where metadata->>'idempotency_key' = p_idem;
    if found then return v_tx; end if;
  end if;

  insert into wallets (user_id) values (p_user) on conflict (user_id) do nothing;
  select * into v_wallet from wallets where user_id = p_user for update;

  -- Cap saldo top-up (docs 07 C-08, keputusan founder 2026-08-16):
  -- non-KYC maks 500 C-Coin; KYC approved tanpa cap.
  if p_type = 'top_up'
     and v_wallet.balance_ccoin + p_amount > 500
     and not exists (select 1 from kyc_records k where k.user_id = p_user and k.status = 'approved') then
    raise exception 'TOPUP_CAP_EXCEEDED';
  end if;

  update wallets set balance_ccoin = balance_ccoin + p_amount,
    total_topup_ccoin = total_topup_ccoin + case when p_type = 'top_up' then p_amount else 0 end
  where user_id = p_user
  returning * into v_wallet;

  insert into wallet_transactions (id, user_id, type, amount_ccoin, balance_after_ccoin, ref_type, ref_id, note, metadata)
  values (gen_random_uuid()::text, p_user, p_type::wallet_tx_type, p_amount, v_wallet.balance_ccoin, p_ref_type, p_ref_id,
          null, jsonb_build_object('idempotency_key', coalesce(p_idem, gen_random_uuid()::text)))
  returning * into v_tx;

  -- Top-up berhasil = uang nyata masuk (Midtrans settle) -> in_app + email ✉.
  -- Jalur non-top_up (royalty/refund/credit internal) TIDAK menimbulkan notif.
  -- Letaknya setelah insert wallet_transactions: replay idempotent early-return
  -- di atas tidak pernah menduplikasi notifikasi.
  if p_type = 'top_up' then
    perform public.notify_user(
      p_user,
      'topup_settled',
      jsonb_build_object('amount', p_amount, 'balance', v_wallet.balance_ccoin, 'refId', p_ref_id),
      true
    );
  end if;
  return v_tx;
end $$;

create or replace function public.wallet_credit_gems(
  p_user uuid,
  p_amount integer,
  p_ref_type text,
  p_ref_table text,
  p_ref_id text,
  p_idem text,
  p_matured boolean default false
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_balance integer;
begin
  if p_amount is null or p_amount < 1 then raise exception 'INVALID_AMOUNT'; end if;
  if p_idem is not null then
    if exists (select 1 from gem_transactions where idem_key = p_idem) then
      return; -- idempotent replay
    end if;
  end if;

  insert into wallets (user_id) values (p_user) on conflict (user_id) do nothing;
  select balance_gems into v_balance from wallets where user_id = p_user for update;

  update wallets set balance_gems = balance_gems + p_amount
  where user_id = p_user
  returning balance_gems into v_balance;

  -- Lot normal terkunci 24 jam; lot payout-refund langsung matured.
  insert into gem_lots (user_id, amount, remaining, ref_type, ref_id, created_at, mature_at)
  values (p_user, p_amount, p_amount, p_ref_type, p_ref_id, now(),
          case when coalesce(p_matured, false) then now() else now() + interval '24 hours' end);

  insert into gem_transactions (user_id, amount, balance_after_gems, ref_type, ref_table, ref_id, idem_key)
  values (p_user, p_amount, v_balance, p_ref_type, p_ref_table, p_ref_id,
          coalesce(p_idem, gen_random_uuid()::text));
end $$;

create or replace function public.wallet_debit_gems(
  p_user uuid,
  p_amount integer,
  p_ref_type text,
  p_ref_table text,
  p_ref_id text,
  p_idem text,
  p_require_matured boolean
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_balance integer;
  v_lot record;
  v_remaining integer;
begin
  if p_amount is null or p_amount < 1 then raise exception 'INVALID_AMOUNT'; end if;
  if p_idem is not null then
    if exists (select 1 from gem_transactions where idem_key = p_idem) then
      return; -- idempotent replay
    end if;
  end if;

  insert into wallets (user_id) values (p_user) on conflict (user_id) do nothing;
  select balance_gems into v_balance from wallets where user_id = p_user for update;
  if v_balance < p_amount then raise exception 'INSUFFICIENT_GEMS'; end if;

  if coalesce(p_require_matured, false) then
    if coalesce((
      select sum(remaining) from gem_lots
      where user_id = p_user and remaining > 0 and mature_at <= now()
    ), 0) < p_amount then
      raise exception 'PAYOUT_GEMS_LOCKED';
    end if;
  end if;

  v_remaining := p_amount;
  for v_lot in
    select id, remaining from gem_lots
    where user_id = p_user and remaining > 0
      and (not coalesce(p_require_matured, false) or mature_at <= now())
    order by mature_at asc, created_at asc, id asc
    for update
  loop
    exit when v_remaining <= 0;
    update gem_lots
    set remaining = remaining - least(remaining, v_remaining)
    where id = v_lot.id;
    v_remaining := v_remaining - least(v_lot.remaining, v_remaining);
  end loop;

  -- Backstop: loop FIFO wajib menutup penuh (unreachable selama invariant
  -- balance = SUM(remaining) + for update locking berlaku) — gagal keras,
  -- jangan debit parsial.
  if v_remaining > 0 then raise exception 'INSUFFICIENT_GEMS'; end if;

  update wallets set balance_gems = balance_gems - p_amount
  where user_id = p_user
  returning balance_gems into v_balance;

  insert into gem_transactions (user_id, amount, balance_after_gems, ref_type, ref_table, ref_id, idem_key)
  values (p_user, -p_amount, v_balance, p_ref_type, p_ref_table, p_ref_id,
          coalesce(p_idem, gen_random_uuid()::text));
end $$;

create or replace function public.convert_gems(p_amount integer) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_amount is null or p_amount < 1 then raise exception 'INVALID_AMOUNT'; end if;

  perform public.wallet_debit_gems(v_user, p_amount, 'convert', 'user', v_user::text,
          'gems-convert-' || v_user || '-' || gen_random_uuid()::text, false);
  perform public.wallet_credit(v_user, p_amount, 'convert', 'user', v_user::text,
          'cc-convert-' || v_user || '-' || gen_random_uuid()::text);
end $$;

create or replace function public.notify_user(
  p_user uuid,
  p_template text,
  p_payload jsonb,
  p_email boolean
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.notifications(id, user_id, channel, template_key, payload, status)
  values ('nfy-' || gen_random_uuid()::text, p_user, 'in_app', p_template, p_payload, 'sent');
  if p_email then
    insert into public.notifications(id, user_id, channel, template_key, payload, status, attempts)
    values ('nfy-' || gen_random_uuid()::text, p_user, 'email', p_template, p_payload, 'pending', 0);
  end if;
end;
$$;
revoke execute on function public.notify_user(uuid, text, jsonb, boolean) from public;
revoke execute on function public.notify_user(uuid, text, jsonb, boolean) from anon;
revoke execute on function public.notify_user(uuid, text, jsonb, boolean) from authenticated;

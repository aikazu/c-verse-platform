-- Run against the confirmed linked development project. All fixtures roll back.
begin;
set local role postgres;
create temporary table flow_results (scenario text, passed boolean);

do $$
declare
  seller uuid := 'fa110000-0000-4000-8000-000000000001';
  buyer uuid := 'fa110000-0000-4000-8000-000000000002';
  creator uuid := 'fa110000-0000-4000-8000-000000000003';
  before_balance integer;
  shipment public.shipments;
  result_code text;
begin
  insert into flow_results values ('direct card PATCH cannot bypass listing RPC guards',
    not has_table_privilege('authenticated','public.cards','UPDATE'));
  insert into public.users (id, email, display_name, role) values
    (seller, 'seller@flow-evaluation.invalid', 'Flow Seller', 'user'),
    (buyer, 'buyer@flow-evaluation.invalid', 'Flow Buyer', 'user'),
    (creator, 'creator@flow-evaluation.invalid', 'Flow Creator', 'creator');
  perform public.wallet_credit(seller, 100, 'refund', 'test', 'flow-evaluation', 'flow-seller-credit');
  perform public.wallet_credit(buyer, 100, 'refund', 'test', 'flow-evaluation', 'flow-buyer-credit');
  insert into public.drops (id, title, series, narrative, artwork_url, total_units, signed_count, unsigned_count,
    price_unsigned_ccoin, price_signed_ccoin, price_ccoin, status, drop_start_at, creator_id, creator_name,
    raffle_end_at, drawn_at)
  values ('flow-evaluation', 'Flow Evaluation', 'Test', 'Test fixture', '/test.png', 5, 1, 4,
    10, 30, 10, 'live', now()-interval '40 days', creator, 'Flow Creator', now()-interval '39 days', now()-interval '39 days');
  insert into public.cards (id, drop_id, unit_number, variant, status, owner_id, nfc_uid, nfc_short_id, location)
  values ('flow-card', 'flow-evaluation', 1, 'unsigned', 'bound', seller, 'FLOW0001', 'flow-card', 'with_owner'),
    ('flow-unowned', 'flow-evaluation', 2, 'unsigned', 'inventory', null, 'FLOW0002', 'flow-unowned', 'platform_stock');

  perform set_config('request.jwt.claim.sub', seller::text, true);
  begin
    perform public.set_buyout('flow-card', 2);
    insert into flow_results values ('listing rejects un-settleable price', false);
  exception when others then
    insert into flow_results values ('listing rejects un-settleable price', sqlerrm='SECONDARY_PRICE_TOO_SMALL');
  end;
  perform public.set_buyout('flow-card', 20);
  perform set_config('request.jwt.claim.sub', buyer::text, true);
  begin
    perform public.buyout_card('flow-card', 'platform_vault', null);
    raise exception 'UNSAFE_CUSTODY';
  exception when others then
    insert into flow_results values ('buyout requires physical vault custody', sqlerrm='CARD_NOT_IN_VAULT');
  end;
  begin
    perform public.place_bid('flow-unowned', 10);
    raise exception 'UNOWNED_BID_ACCEPTED';
  exception when others then
    insert into flow_results values ('unowned inventory cannot hold bids', sqlerrm='CARD_NOT_TRADABLE');
  end;
  begin
    perform public.place_bid('flow-card', 2);
    raise exception 'SMALL_BID_ACCEPTED';
  exception when others then
    insert into flow_results values ('bid rejects un-settleable price', sqlerrm='SECONDARY_PRICE_TOO_SMALL');
  end;

  update public.cards set location='platform_vault' where id='flow-card';
  perform set_config('request.jwt.claim.sub', seller::text, true);
  shipment := public.vault_shipout('flow-card', 'Synthetic destination address');
  perform set_config('request.jwt.claim.sub', buyer::text, true);
  begin
    perform public.buyout_card('flow-card', 'platform_vault', null);
    raise exception 'SOLD_DURING_SHIPPING';
  exception when others then
    insert into flow_results values ('buyout rejects active shipment', sqlerrm in ('SHIPMENT_ACTIVE','NOT_FOR_SALE'));
  end;

  shipment := public.admin_fulfill_shipment(shipment.id, 'cancelled', null);
  perform set_config('request.jwt.claim.sub', buyer::text, true);
  perform public.place_bid('flow-card', 20);
  perform set_config('request.jwt.claim.sub', seller::text, true);
  shipment := public.vault_shipout('flow-card', 'Synthetic destination address');
  begin
    perform public.accept_bid('flow-card', 'platform_vault', null);
    raise exception 'ACCEPTED_DURING_SHIPPING';
  exception when others then
    insert into flow_results values ('accept bid rejects active shipment', sqlerrm='SHIPMENT_ACTIVE');
  end;
  shipment := public.admin_fulfill_shipment(shipment.id, 'shipped', 'TEST-OUT');
  shipment := public.admin_fulfill_shipment(shipment.id, 'delivered', null);
  insert into flow_results select 'outbound delivery records physical owner custody', location='with_owner'
    from public.cards where id='flow-card';
  begin
    perform public.accept_bid('flow-card', 'platform_vault', null);
    raise exception 'ACCEPTED_OUTSIDE_VAULT';
  exception when others then
    insert into flow_results values ('accept bid requires physical vault custody', sqlerrm='CARD_NOT_IN_VAULT');
  end;

  shipment := public.seller_to_vault('flow-card', 'Synthetic origin address', 'TEST-IN');
  shipment := public.admin_fulfill_shipment(shipment.id, 'shipped', null);
  shipment := public.admin_fulfill_shipment(shipment.id, 'delivered', null);
  insert into flow_results select 'inbound delivery records physical vault custody', location='platform_vault'
    from public.cards where id='flow-card';

  -- Settlement is now safe: card stays in the vault and buyer receives title.
  update public.cards set location='platform_vault' where id='flow-card';
  perform public.accept_bid('flow-card', 'platform_vault', null);
  insert into flow_results select 'vault bid settlement transfers title once', owner_id=buyer and location='platform_vault'
    from public.cards where id='flow-card';
  insert into flow_results select 'secondary settlement preserves wallet ledger', not exists (
    select 1 from public.wallets w where w.user_id in (seller,buyer,creator)
      and w.balance_ccoin <> coalesce((select sum(t.amount_ccoin) from public.wallet_transactions t where t.user_id=w.user_id),0));
  insert into flow_results select 'secondary settlement preserves Gems ledger and lots', not exists (
    select 1 from public.wallets w where w.user_id in (seller,buyer,creator) and
      (w.balance_gems <> coalesce((select sum(t.amount) from public.gem_transactions t where t.user_id=w.user_id),0)
      or w.balance_gems <> coalesce((select sum(l.remaining) from public.gem_lots l where l.user_id=w.user_id),0)));

  -- A pending seed sale must be returnable; even a legacy address cannot ship it automatically.
  update public.drops set is_seed=true where id='flow-evaluation';
  insert into public.cards (id,drop_id,unit_number,variant,status,owner_id,nfc_uid,nfc_short_id,location)
    values ('flow-seed','flow-evaluation',3,'unsigned','bound',creator,'FLOW0003','flow-seed','with_owner');
  perform set_config('request.jwt.claim.sub', creator::text, true);
  perform public.set_buyout('flow-seed',30);
  perform set_config('request.jwt.claim.sub', buyer::text, true);
  perform public.buyout_card('flow-seed','buyer_address','Legacy synthetic destination');
  insert into flow_results select 'seed phase one holds title and proceeds',owner_id=creator and status='bid_pending'
    from public.cards where id='flow-seed';
  perform set_config('request.jwt.claim.sub', creator::text, true);
  shipment:=public.seller_to_vault('flow-seed','Synthetic creator origin','SEED-IN');
  begin
    perform public.release_seed_sale('flow-seed');
    raise exception 'RELEASED_IN_TRANSIT';
  exception when others then
    insert into flow_results values ('seed release rejects active inbound shipment',sqlerrm='SHIPMENT_ACTIVE');
  end;
  shipment:=public.admin_fulfill_shipment(shipment.id,'shipped',null);
  shipment:=public.admin_fulfill_shipment(shipment.id,'delivered',null);
  begin
    perform public.release_seed_sale('flow-seed');
    raise exception 'RELEASED_UNVERIFIED';
  exception when others then
    insert into flow_results values ('seed release still requires NFC verification',sqlerrm='SEED_VAULT_IN_REQUIRED');
  end;
  update public.cards set verify_status='verified' where id='flow-seed'; -- Synthetic test only; rolled back.
  perform public.release_seed_sale('flow-seed');
  insert into flow_results select 'seed phase two settles title to vault',owner_id=buyer and location='platform_vault'
    from public.cards where id='flow-seed';
  insert into flow_results select 'seed settlement never creates legacy purchase shipping',not exists
    (select 1 from public.shipments where card_id='flow-seed' and requester_id=buyer);

  -- The original accepted bid on flow-card is historical, not this new sale.
  update public.ownership_history set transferred_at=now()-interval '25 hours' where card_id='flow-card';
  perform set_config('request.jwt.claim.sub',buyer::text,true);
  perform public.set_buyout('flow-card',10);
  perform set_config('request.jwt.claim.sub',seller::text,true);
  perform public.buyout_card('flow-card','platform_vault',null);
  update public.cards set verify_status='verified' where id='flow-card'; -- Rolled back synthetic proof.
  perform public.release_seed_sale('flow-card');
  insert into flow_results select 'seed resale ignores previously settled accepted bids',owner_id=seller
    and exists(select 1 from public.orders where card_id='flow-card' and user_id=seller and status='settled')
    from public.cards where id='flow-card';

  shipment:=public.vault_shipout('flow-card','Synthetic seller destination');
  shipment:=public.admin_fulfill_shipment(shipment.id,'shipped','RESALE-OUT');
  shipment:=public.admin_fulfill_shipment(shipment.id,'delivered',null);
  perform public.set_buyout('flow-card',10);
  perform set_config('request.jwt.claim.sub',buyer::text,true);
  select balance_ccoin into before_balance from public.wallets where user_id=buyer;
  perform public.buyout_card('flow-card','platform_vault',null);
  perform public.cancel_seed_sale('flow-card');
  perform public.cancel_seed_sale('flow-card');
  insert into flow_results select 'seed abort ignores old bid and refunds once',balance_ccoin=before_balance
    from public.wallets where user_id=buyer;
  perform set_config('request.jwt.claim.sub',seller::text,true);
  perform public.set_buyout('flow-card',15);
  perform set_config('request.jwt.claim.sub',buyer::text,true);
  perform public.buyout_card('flow-card','platform_vault',null);
  perform public.cancel_seed_sale('flow-card');
  insert into flow_results select 'a later seed abort uses its own transaction key',balance_ccoin=before_balance
    and (select count(*) from public.orders where card_id='flow-card' and status='refunded' and escrow_status='released')=2
    from public.wallets where user_id=buyer;
  perform public.place_bid('flow-card',12);
  perform set_config('request.jwt.claim.sub',seller::text,true);
  perform public.accept_bid('flow-card','platform_vault',null);
  perform public.cancel_seed_sale('flow-card');
  perform public.cancel_seed_sale('flow-card');
  insert into flow_results select 'later accepted bid abort refunds the new buyer once',balance_ccoin=before_balance
    from public.wallets where user_id=buyer;

  insert into public.drops (id,title,series,narrative,artwork_url,total_units,signed_count,unsigned_count,
    price_unsigned_ccoin,price_signed_ccoin,price_ccoin,status,drop_start_at,creator_id,creator_name,raffle_end_at)
    values ('flow-raffle','Raffle','Test','Test fixture','/test.png',2,1,1,10,30,10,'live',
      now()-interval '1 hour',creator,'Flow Creator',now()+interval '1 hour');
  insert into public.cards (id,drop_id,unit_number,variant,status,nfc_uid,nfc_short_id,location) values
    ('flow-regular','flow-raffle',1,'unsigned','inventory','FLOW0004','flow-regular','platform_stock'),
    ('flow-defect','flow-raffle',2,'signed','defect','FLOW0005','flow-defect','platform_stock');
  perform set_config('request.jwt.claim.sub',buyer::text,true);
  update public.drops set drop_start_at=now()+interval '1 hour' where id='flow-raffle';
  begin
    perform public.drop_entry('flow-raffle','regular');
    raise exception 'EARLY_ENTRY';
  exception when others then
    insert into flow_results values ('raffle rejects entry before drop start',sqlerrm='ENTRY_CLOSED');
  end;
  update public.drops set drop_start_at=now()-interval '1 hour',drop_end_at=now()-interval '1 minute' where id='flow-raffle';
  begin
    perform public.drop_entry('flow-raffle','regular');
    raise exception 'LATE_ENTRY';
  exception when others then
    insert into flow_results values ('raffle rejects entry after drop end',sqlerrm='ENTRY_CLOSED');
  end;
  update public.drops set drop_end_at=null where id='flow-raffle';
  select balance_ccoin into before_balance from public.wallets where user_id=buyer;
  perform public.drop_entry('flow-raffle','premium');
  perform set_config('request.jwt.claim.sub',seller::text,true);
  perform public.drop_entry('flow-raffle','both');
  update public.drops set raffle_end_at=now()-interval '1 minute' where id='flow-raffle';
  perform public.draw_drop('flow-raffle');
  insert into flow_results select 'premium-only entrant gets full refund when premium is unavailable',
    balance_ccoin=before_balance and exists(select 1 from public.drop_entries where drop_id='flow-raffle' and user_id=buyer and status='refunded')
    from public.wallets where user_id=buyer;
  insert into flow_results select 'both entrant may win regular with price difference refunded',
    owner_id=seller from public.cards where id='flow-regular';
  insert into flow_results select 'raffle never allocates defect stock',owner_id is null and status='defect'
    from public.cards where id='flow-defect';
  insert into flow_results values ('raffle draw is idempotent',public.draw_drop('flow-raffle')=0);
  perform set_config('request.jwt.claim.sub',buyer::text,true);
  begin
    perform public.checkout('flow-raffle','premium');
    raise exception 'DEFECT_PURCHASED';
  exception when others then
    insert into flow_results values ('FCFS cannot purchase defect stock',sqlerrm='SOLD_OUT');
  end;
  update public.drops set total_units=3,unsigned_count=2 where id='flow-raffle';
  insert into public.cards (id,drop_id,unit_number,variant,status,nfc_uid,nfc_short_id,location)
    values ('flow-fcfs','flow-raffle',3,'unsigned','inventory','FLOW0006','flow-fcfs','platform_stock');
  perform public.checkout('flow-raffle','regular');
  insert into flow_results select 'raffle loser can complete FCFS into vault',owner_id=buyer and location='platform_vault'
    and exists(select 1 from public.orders where card_id='flow-fcfs' and status='settled') from public.cards where id='flow-fcfs';
  begin
    perform public.checkout('flow-raffle','regular');
    raise exception 'SECOND_PURCHASE';
  exception when others then
    insert into flow_results values ('FCFS still enforces one allocation per drop',sqlerrm='LIMIT_1_PER_DROP');
  end;
  update public.users set flag_reason='flow-evaluation' where id=buyer;
  perform set_config('request.jwt.claim.sub',buyer::text,true);
  begin
    perform public.set_buyout('flow-card',30);
    raise exception 'SUSPENDED_LISTED';
  exception when others then
    insert into flow_results values ('suspended accounts cannot list through direct RPC',sqlerrm='ACCOUNT_SUSPENDED');
  end;
  begin
    perform public.convert_gems(1);
    raise exception 'SUSPENDED_CONVERTED';
  exception when others then
    insert into flow_results values ('suspended accounts cannot convert through direct RPC',sqlerrm='ACCOUNT_SUSPENDED');
  end;
end $$;

-- Exercise the actual client role, rather than only service-role impersonation.
grant insert on flow_results to authenticated;
set local role authenticated;
set local "request.jwt.claim.sub"='fa110000-0000-4000-8000-000000000002';
do $$
begin
  begin
    perform public.set_buyout('flow-seed',30);
    raise exception 'SUSPENSION_BYPASSED';
  exception when others then
    insert into flow_results values ('authenticated role cannot bypass account suspension',sqlerrm='ACCOUNT_SUSPENDED');
  end;
  begin
    update public.cards set buyout_price_ccoin=1 where id='flow-seed';
    raise exception 'RPC_BYPASSED';
  exception when insufficient_privilege then
    insert into flow_results values ('direct PostgREST card update lacks write privilege',true);
  end;
end $$;
reset role;

do $$
declare failures text;
begin
  select string_agg(scenario, '; ') into failures from flow_results where not passed;
  if failures is not null then raise exception 'FLOW_REGRESSION: %', failures; end if;
end $$;
select count(*) as passed_flow_assertions from flow_results where passed;
rollback;

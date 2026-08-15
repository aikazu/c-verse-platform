-- C.Verse — RLS policy matrix + write guards (squashed phase 3/6)
-- Default deny: RLS enable semua tabel publik, policy per-operation per matriks.
-- service_role bypass otomatis. Guard function prevent tulis langsung kolom
-- sensitif oleh role authenticated/anon (hanya lewat RPC security definer).

-- ══════════════════════════════════════════════════════════════════════════
-- Enable RLS semua tabel publik
-- ══════════════════════════════════════════════════════════════════════════
alter table public.users enable row level security;
alter table public.wallets enable row level security;
alter table public.drops enable row level security;
alter table public.cards enable row level security;
alter table public.cards force row level security;
alter table public.wallet_transactions enable row level security;
alter table public.orders enable row level security;
alter table public.bids enable row level security;
alter table public.badges enable row level security;
alter table public.user_badges enable row level security;
alter table public.kyc_records enable row level security;
alter table public.creators enable row level security;
alter table public.shipments enable row level security;
alter table public.ownership_history enable row level security;
alter table public.nfc_batches enable row level security;
alter table public.disputes enable row level security;
alter table public.admin_audit_log enable row level security;
alter table public.notifications enable row level security;
alter table public.payout_batches enable row level security;
alter table public.payouts enable row level security;
alter table public.creator_page_views enable row level security;
alter table public.qc_defects enable row level security;
alter table public.drop_entries enable row level security;

-- ══════════════════════════════════════════════════════════════════════════
-- Helper is_service_role (versi FINAL)
-- ══════════════════════════════════════════════════════════════════════════
create or replace function public.is_service_role() returns boolean
language sql stable as $$
  select coalesce(current_setting('role', true), '') in ('service_role','supabase_admin','postgres')
     or current_user in ('postgres','supabase_admin','service_role');
$$;

-- ══════════════════════════════════════════════════════════════════════════
-- users
-- ══════════════════════════════════════════════════════════════════════════
create policy users_select on public.users for select
  using (id = auth.uid() or not is_anonymous);
create policy users_update_own on public.users for update
  using (id = auth.uid()) with check (id = auth.uid());

create or replace function public.users_fields_guard() returns trigger
language plpgsql as $$
begin
  if public.is_service_role() then return new; end if;
  if new.role is distinct from old.role or new.flag_reason is distinct from old.flag_reason
     or new.total_xp is distinct from old.total_xp or new.level is distinct from old.level then
    raise exception 'users.role/flag_reason/xp hanya boleh diubah service-role';
  end if;
  return new;
end $$;
create trigger trg_users_fields_guard before update on public.users
  for each row execute function public.users_fields_guard();

-- ══════════════════════════════════════════════════════════════════════════
-- creators
-- ══════════════════════════════════════════════════════════════════════════
create policy creators_select on public.creators for select
  using (status = 'active' or user_id = auth.uid());

-- ══════════════════════════════════════════════════════════════════════════
-- drops
-- ══════════════════════════════════════════════════════════════════════════
create policy drops_select_public on public.drops for select
  using (status in ('live','published','sold_out','closed','ended','scheduled'));

-- ══════════════════════════════════════════════════════════════════════════
-- cards (guard versi FINAL: 10 kolom terlindungi + paritas MAX 20 listing)
-- ══════════════════════════════════════════════════════════════════════════
create policy cards_select on public.cards for select
  using (
    owner_id = auth.uid()
    or coalesce(card_status_new::text, status::text) not in ('inventory','available')
  );
create policy cards_update_owner_buyout on public.cards for update
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create or replace function public.cards_buyout_guard() returns trigger
language plpgsql as $$
begin
  if public.is_service_role() then return new; end if;
  if new.owner_id is distinct from old.owner_id
     or new.status is distinct from old.status
     or new.card_status_new is distinct from old.card_status_new
     or new.nfc_uid is distinct from old.nfc_uid
     or new.nfc_short_id is distinct from old.nfc_short_id
     or new.verify_status is distinct from old.verify_status
     or new.qc_status is distinct from old.qc_status
     or new.nfc_configured is distinct from old.nfc_configured
     or new.location is distinct from old.location
     or new.last_ctr is distinct from old.last_ctr then
    raise exception 'cards: hanya buyout_price_ccoin yang boleh diubah owner';
  end if;
  -- listing langsung (null -> harga) tetap terikat MAX 20 aktif, paritas set_buyout
  if new.buyout_price_ccoin is not null and old.buyout_price_ccoin is null then
    if (select count(*) from public.cards c
        where c.owner_id = new.owner_id and c.buyout_price_ccoin is not null and c.id <> new.id) >= 20 then
      raise exception 'MAX_BUYOUT_ACTIVE';
    end if;
  end if;
  return new;
end $$;
create trigger trg_cards_buyout_guard before update on public.cards
  for each row execute function public.cards_buyout_guard();

-- ══════════════════════════════════════════════════════════════════════════
-- wallets / ledger
-- ══════════════════════════════════════════════════════════════════════════
create policy wallets_select_own on public.wallets for select
  using (user_id = auth.uid());
create policy wtx_select_own on public.wallet_transactions for select
  using (user_id = auth.uid());

create or replace function public.wallet_tx_immutable_guard() returns trigger
language plpgsql as $$
begin
  raise exception 'wallet_transactions is append-only';
end $$;
create trigger trg_wtx_immutable before update or delete on public.wallet_transactions
  for each row execute function public.wallet_tx_immutable_guard();

-- ══════════════════════════════════════════════════════════════════════════
-- orders / shipments
-- ══════════════════════════════════════════════════════════════════════════
create policy orders_select_own on public.orders for select
  using (user_id = auth.uid());
create policy shipments_select_own on public.shipments for select
  using (requester_id = auth.uid());

-- ══════════════════════════════════════════════════════════════════════════
-- bids
-- ══════════════════════════════════════════════════════════════════════════
create policy bids_select on public.bids for select
  using (
    bidder_id = auth.uid()
    or status = 'accepted'
    or created_at > now() - interval '90 days'
  );
create policy bids_insert_own on public.bids for insert
  with check (bidder_id = auth.uid());

-- ══════════════════════════════════════════════════════════════════════════
-- provenance
-- ══════════════════════════════════════════════════════════════════════════
create policy ownership_history_select_public on public.ownership_history for select
  using (true);

-- ══════════════════════════════════════════════════════════════════════════
-- badges
-- ══════════════════════════════════════════════════════════════════════════
create policy badges_select_active on public.badges for select
  using (is_active);
create policy user_badges_select_own on public.user_badges for select
  using (user_id = auth.uid());

-- ══════════════════════════════════════════════════════════════════════════
-- KYC (guard: non-service hanya boleh status 'pending')
-- ══════════════════════════════════════════════════════════════════════════
create policy kyc_select_own on public.kyc_records for select
  using (user_id = auth.uid());
create policy kyc_insert_own on public.kyc_records for insert
  with check (user_id = auth.uid());

create or replace function public.kyc_status_guard() returns trigger
language plpgsql as $$
begin
  if public.is_service_role() then return new; end if;
  if new.status is distinct from 'pending' then
    raise exception 'kyc_records.status hanya boleh diubah service-role';
  end if;
  return new;
end $$;
create trigger trg_kyc_status_guard before insert or update on public.kyc_records
  for each row execute function public.kyc_status_guard();

-- ══════════════════════════════════════════════════════════════════════════
-- payouts
-- ══════════════════════════════════════════════════════════════════════════
create policy payouts_select_own on public.payouts for select
  using (user_id = auth.uid());

-- ══════════════════════════════════════════════════════════════════════════
-- disputes
-- ══════════════════════════════════════════════════════════════════════════
create policy disputes_select_own on public.disputes for select
  using (reporter_id = auth.uid());
create policy disputes_insert_own on public.disputes for insert
  with check (reporter_id = auth.uid());

-- ══════════════════════════════════════════════════════════════════════════
-- notifications
-- ══════════════════════════════════════════════════════════════════════════
create policy notifications_select_own on public.notifications for select
  using (user_id = auth.uid());
create policy notifications_update_own on public.notifications for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ══════════════════════════════════════════════════════════════════════════
-- creator_page_views: insert-only anon (tidak bisa dibaca)
-- ══════════════════════════════════════════════════════════════════════════
create policy creator_page_views_insert on public.creator_page_views for insert
  with check (true);

-- ══════════════════════════════════════════════════════════════════════════
-- drop_entries: seleksi milik sendiri
-- ══════════════════════════════════════════════════════════════════════════
create policy drop_entries_select_own on public.drop_entries for select
  using (user_id = auth.uid());

-- ══════════════════════════════════════════════════════════════════════════
-- admin_audit_log: append-only absolut (tidak ada policy read/write non-service)
-- ══════════════════════════════════════════════════════════════════════════
create or replace function public.audit_log_immutable_guard() returns trigger
language plpgsql as $$
begin
  raise exception 'admin_audit_log is append-only';
end $$;
create trigger trg_audit_immutable before update or delete on public.admin_audit_log
  for each row execute function public.audit_log_immutable_guard();
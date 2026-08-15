-- C.Verse — Auth migration (docs/10_auth_migration.md)
-- users.id -> uuid references auth.users(id); password_hash & sessions dropped;
-- signup creates public.users row automatically via trigger.
--
-- NOTE (prod data; idempotent via `supabase db reset`): pada database dengan data existing, jalankan dulu migrasi akun
-- via service-role authAdmin.createUser lalu remap id (docs/10 §3.4.2).
-- Migration ini bersih untuk `supabase db reset` (fresh DB).

-- 1) user_role enum: 'user' adalah nama role canonical (legacy 'collector' dipertahankan)
do $$ begin alter type public.user_role add value if not exists 'user'; exception when others then null; end $$;

-- 2) Drop FK constraints menuju users(id) sebelum ubah tipe kolom
alter table public.sessions drop constraint if exists sessions_user_id_fkey;
drop table if exists public.sessions;
alter table public.wallets drop constraint if exists wallets_user_id_fkey;
alter table public.drops drop constraint if exists drops_creator_id_fkey;
alter table public.drops drop constraint if exists drops_created_by_fkey;
alter table public.cards drop constraint if exists cards_owner_id_fkey;
alter table public.wallet_transactions drop constraint if exists wallet_transactions_user_id_fkey;
alter table public.orders drop constraint if exists orders_user_id_fkey;
alter table public.bids drop constraint if exists bids_bidder_id_fkey;
alter table public.badges drop constraint if exists badges_created_by_fkey;
alter table public.user_badges drop constraint if exists user_badges_user_id_fkey;
alter table public.kyc_records drop constraint if exists kyc_records_user_id_fkey;
alter table public.creators drop constraint if exists creators_user_id_fkey;
alter table public.shipments drop constraint if exists shipments_requester_id_fkey;
alter table public.ownership_history drop constraint if exists ownership_history_owner_id_fkey;
alter table public.disputes drop constraint if exists disputes_reporter_id_fkey;
alter table public.admin_audit_log drop constraint if exists admin_audit_log_admin_user_id_fkey;
alter table public.notifications drop constraint if exists notifications_user_id_fkey;
alter table public.payouts drop constraint if exists payouts_user_id_fkey;
alter table public.creator_page_views drop constraint if exists creator_page_views_user_id_fkey;

-- 3) users: uuid PK + drop password
alter table public.users drop constraint if exists users_pkey;
alter table public.users alter column id type uuid using id::uuid;
alter table public.users add primary key (id);
alter table public.users drop column if exists password_hash;

-- 4) Kolom-kolom FK ikut uuid
alter table public.wallets alter column user_id type uuid using user_id::uuid;
alter table public.drops alter column creator_id type uuid using creator_id::uuid;
alter table public.drops alter column created_by type uuid using created_by::uuid;
alter table public.cards alter column owner_id type uuid using owner_id::uuid;
alter table public.wallet_transactions alter column user_id type uuid using user_id::uuid;
alter table public.orders alter column user_id type uuid using user_id::uuid;
alter table public.bids alter column bidder_id type uuid using bidder_id::uuid;
alter table public.badges alter column created_by type uuid using created_by::uuid;
alter table public.user_badges alter column user_id type uuid using user_id::uuid;
alter table public.kyc_records alter column user_id type uuid using user_id::uuid;
alter table public.creators alter column user_id type uuid using user_id::uuid;
alter table public.shipments alter column requester_id type uuid using requester_id::uuid;
alter table public.ownership_history alter column owner_id type uuid using owner_id::uuid;
alter table public.disputes alter column reporter_id type uuid using reporter_id::uuid;
alter table public.admin_audit_log alter column admin_user_id type uuid using admin_user_id::uuid;
alter table public.notifications alter column user_id type uuid using user_id::uuid;
alter table public.payouts alter column user_id type uuid using user_id::uuid;
alter table public.creator_page_views alter column user_id type uuid using user_id::uuid;

-- 5) Pasang ulang FK (on delete serupa skema awal)
alter table public.wallets add constraint wallets_user_id_fkey foreign key (user_id) references public.users(id) on delete cascade;
alter table public.drops add constraint drops_creator_id_fkey foreign key (creator_id) references public.users(id) on delete restrict;
alter table public.drops add constraint drops_created_by_fkey foreign key (created_by) references public.users(id) on delete set null;
alter table public.cards add constraint cards_owner_id_fkey foreign key (owner_id) references public.users(id) on delete set null;
alter table public.wallet_transactions add constraint wallet_transactions_user_id_fkey foreign key (user_id) references public.users(id) on delete cascade;
alter table public.orders add constraint orders_user_id_fkey foreign key (user_id) references public.users(id) on delete cascade;
alter table public.bids add constraint bids_bidder_id_fkey foreign key (bidder_id) references public.users(id) on delete cascade;
alter table public.badges add constraint badges_created_by_fkey foreign key (created_by) references public.users(id) on delete set null;
alter table public.user_badges add constraint user_badges_user_id_fkey foreign key (user_id) references public.users(id) on delete cascade;
alter table public.kyc_records add constraint kyc_records_user_id_fkey foreign key (user_id) references public.users(id) on delete cascade;
alter table public.creators add constraint creators_user_id_fkey foreign key (user_id) references public.users(id) on delete set null;
alter table public.shipments add constraint shipments_requester_id_fkey foreign key (requester_id) references public.users(id) on delete cascade;
alter table public.ownership_history add constraint ownership_history_owner_id_fkey foreign key (owner_id) references public.users(id) on delete cascade;
alter table public.disputes add constraint disputes_reporter_id_fkey foreign key (reporter_id) references public.users(id) on delete cascade;
alter table public.admin_audit_log add constraint admin_audit_log_admin_user_id_fkey foreign key (admin_user_id) references public.users(id) on delete cascade;
alter table public.notifications add constraint notifications_user_id_fkey foreign key (user_id) references public.users(id) on delete cascade;
alter table public.payouts add constraint payouts_user_id_fkey foreign key (user_id) references public.users(id) on delete cascade;
alter table public.creator_page_views add constraint creator_page_views_user_id_fkey foreign key (user_id) references public.users(id) on delete set null;

-- 6) Trigger: signup Supabase Auth -> row public.users otomatis
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, email, display_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)),
    'user'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

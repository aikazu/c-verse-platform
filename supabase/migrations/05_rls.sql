-- ══════════════════════════════════════════════════════════════════════════
-- C.Verse — 05_rls: Row Level Security policies + helper function +
-- trigger guards. Default deny: RLS enable semua tabel publik, policy per
-- operation per matriks. service_role bypass otomatis. Guard function
-- prevent tulis langsung kolom sensitif oleh role authenticated/anon (hanya
-- lewat RPC security definer).
--
-- Sumber (FINAL, tanpa patch intermediate):
--   - 20260817020000_rls_policies.sql — enable + policies + 4 guard triggers
--   - 20260823020000_seed_xp_unify.sql — unlist_card_if_non_tradable trigger
--
-- Catatan konsolidasi:
--   - cards force row level security (force RLS for table owner too)
--     dipertahankan dari foundation/RLS.
--   - is_service_role() juga dipakai oleh guard trigger dan beberapa RPC
--     sebagai pagar kedua — definisi tunggal di sini.
-- Baseline maksimum 500 baris fisik per file; kebijakan lanjutan ada di
-- 06_rls_policies.sql — payouts, disputes, notifications, creator_page_views,
-- drop_entries, audit log immutable guard, dan unlist trigger. No dependency
-- on helpers here; 05_ < 06_.
-- ══════════════════════════════════════════════════════════════════════════

-- ══════════════════════════════════════════════════════════════════════════
-- Enable RLS semua tabel publik
-- ══════════════════════════════════════════════════════════════════════════
alter table public.users enable row level security;
alter table public.wallets enable row level security;
alter table public.drops enable row level security;
alter table public.cards enable row level security;
alter table public.cards force row level security;
alter table public.wallet_transactions enable row level security;
-- C-Gems (dual-token 2026-09-03): default-deny, read owner-only via policy di bawah.
alter table public.gem_lots enable row level security;
alter table public.gem_transactions enable row level security;
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
-- platform_revenue: internal ledger pendapatan — default-deny tanpa policy user
-- (tulis hanya via RPC ledger SECURITY DEFINER; baca service-role only).
-- Linter 0013 rls_disabled_in_public.
alter table public.platform_revenue enable row level security;

-- ══════════════════════════════════════════════════════════════════════════
-- Helper is_service_role (versi FINAL)
-- ══════════════════════════════════════════════════════════════════════════
create or replace function public.is_service_role() returns boolean
language sql stable as $$
  select coalesce(current_setting('role', true), '') in ('service_role','supabase_admin','postgres')
     or current_user in ('postgres','supabase_admin','service_role');
$$;

-- ══════════════════════════════════════════════════════════════════════════
-- Helper is_admin (F4 pentest hardening 2026-08-30): true hanya jika caller
-- auth.uid() punya role 'admin' di public.users. SECURITY DEFINER supaya
-- select internal tidak merekursi lewat RLS users; auth.uid() null → false.
-- Tanpa revoke: EXECUTE default (public) disengaja — policy users_select
-- dievaluasi sebagai caller, anon/authenticated butuh EXECUTE ini.
-- Didefinisikan di sini (bukan migration RPC) karena users_select di bawah
-- memanggilnya dan 05_rls di-apply lebih dulu — CREATE POLICY memvalidasi
-- fungsi saat DDL.
-- ══════════════════════════════════════════════════════════════════════════
create or replace function public.is_admin() returns boolean
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then return false; end if;
  return exists (select 1 from users where id = v_uid and role = 'admin');
end $$;

-- ══════════════════════════════════════════════════════════════════════════
-- users
-- ══════════════════════════════════════════════════════════════════════════
-- F4 (pentest 2026-08-30): `not is_anonymous` mengekspos email semua user
-- non-anon ke role mana pun — own row atau admin (is_admin) saja.
create policy users_select on public.users for select
  using (id = auth.uid() or public.is_admin());
create policy users_update_own on public.users for update
  using (id = auth.uid()) with check (id = auth.uid());

create or replace function public.users_fields_guard() returns trigger
language plpgsql as $$
begin
  if public.is_service_role() then return new; end if;
  -- Lane D (2026-08-31): + cumulative_spend_ccoin (spend-derived XP mirror,
  -- dasar leaderboard) — wallet/uang tidak boleh di-PATCH pemiliknya, hanya
  -- via RPC SECURITY DEFINER service-role.
  if new.role is distinct from old.role or new.flag_reason is distinct from old.flag_reason
     or new.total_xp is distinct from old.total_xp or new.level is distinct from old.level
     or new.xp_reached_at is distinct from old.xp_reached_at
     or new.cumulative_spend_ccoin is distinct from old.cumulative_spend_ccoin then
    raise exception 'users.role/flag_reason/total_xp/level hanya boleh diubah service-role';
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
  using (status in ('live','published','sold_out','closed','scheduled'));

-- ══════════════════════════════════════════════════════════════════════════
-- cards (guard versi FINAL: 10 kolom terlindungi + paritas MAX 20 listing)
-- ══════════════════════════════════════════════════════════════════════════
create policy cards_select on public.cards for select
  using (
    owner_id = auth.uid()
    or coalesce(status::text, '') <> 'inventory'
  );
create policy cards_update_owner_buyout on public.cards for update
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create or replace function public.cards_buyout_guard() returns trigger
language plpgsql as $$
begin
  if public.is_service_role() then return new; end if;
  if new.owner_id is distinct from old.owner_id
     or new.status is distinct from old.status
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
-- wallets / ledger (append-only wallet_transactions)
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
-- C-Gems (dual-token 2026-09-03): read owner-only; tulis HANYA via RPC
-- SECURITY DEFINER (wallet_credit_gems/wallet_debit_gems — tidak ada
-- INSERT/UPDATE/DELETE grant untuk client di 01_schema). Ledger gems
-- append-only (guard parity wallet_tx_immutable_guard).
-- ══════════════════════════════════════════════════════════════════════════
create policy gem_lots_select_own on public.gem_lots for select
  using (user_id = auth.uid());
create policy gem_tx_select_own on public.gem_transactions for select
  using (user_id = auth.uid());

create or replace function public.gem_tx_immutable_guard() returns trigger
language plpgsql as $$
begin
  raise exception 'gem_transactions is append-only';
end $$;
create trigger trg_gem_tx_immutable before update or delete on public.gem_transactions
  for each row execute function public.gem_tx_immutable_guard();

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

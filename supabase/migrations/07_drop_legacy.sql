-- ══════════════════════════════════════════════════════════════════════════
-- C.Verse — 07_drop_legacy: buang kolom legacy yang sudah digantikan kanonis.
--
--   - users.xp            → total_xp (mapper selalu baca total_xp; xp tidak
--                           pernah dipakai logika mana pun)
--   - drops.drop_at       → drop_start_at (acuan cron activate_scheduled_drops,
--                           guard CREATOR_SELF_DEALING_30D, dan semua UI)
--   - orders.card_ids     → card_id (MVP 1 kartu = 1 order)
--
-- Masih dev, tanpa data riil — drop langsung tanpa migrasi data/backfill.
-- ══════════════════════════════════════════════════════════════════════════

alter table public.users drop column if exists xp;

alter table public.drops drop column if exists drop_at;

alter table public.orders drop column if exists card_ids;

-- users_fields_guard tanpa klausa new.xp (paritas 03_rls versi baru).
-- Dibundel di sini (bukan hanya di 03_rls) karena `db push` tidak pernah
-- me-re-apply edit ke file migrasi yang sudah applied: DB lama yang push 07
-- tanpa ini akan menyimpan body guard lama yang mereferensi kolom xp yang
-- baru di-drop — setiap UPDATE users non-service-role gagal runtime
-- (record "new" has no field "xp"). create or replace = aman di semua jalur
-- (reset fresh maupun push).
create or replace function public.users_fields_guard() returns trigger
language plpgsql as $$
begin
  if public.is_service_role() then return new; end if;
  if new.role is distinct from old.role or new.flag_reason is distinct from old.flag_reason
     or new.total_xp is distinct from old.total_xp or new.level is distinct from old.level
     or new.xp_reached_at is distinct from old.xp_reached_at
     or new.cumulative_spend_ccoin is distinct from old.cumulative_spend_ccoin then
    raise exception 'users.role/flag_reason/total_xp/level hanya boleh diubah service-role';
  end if;
  return new;
end $$;

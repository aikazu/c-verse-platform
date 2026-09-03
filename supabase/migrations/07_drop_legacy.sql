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

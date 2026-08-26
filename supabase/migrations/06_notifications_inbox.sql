-- P0-3 (audit 2026-08-24): inbox kolom read_at di notifications + index untuk
-- unread-count. Tabel notifications sudah ada di 01_schema.sql; hanya tambah
-- kolom read_at (nullable, diisi user saat klik notifikasi).
alter table public.notifications
  add column if not exists read_at timestamptz;

-- Index untuk unread-count query (user_id + read_at IS NULL + channel='in_app')
create index if not exists idx_notifications_unread
  on public.notifications(user_id, read_at)
  where channel = 'in_app' and status = 'sent';

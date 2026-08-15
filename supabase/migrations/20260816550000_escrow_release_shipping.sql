-- ── Fix escrow_auto_release: filter & anchor salah arah ─────────────────────
-- Bug: cron hanya me-update order `delivery_option = 'vault'` ber-escrow
-- `held` — kombinasi yang tidak pernah ada (checkout vault insert langsung
-- `released`). Yang `held` adalah order shipping. Per docs I6 / docs/03
-- (F-06): shipping release saat DELIVERED + H+7 (window komplain), jadi
-- anchor-nya delivered_at, bukan created_at.

create or replace function public.escrow_auto_release() returns integer
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update orders set escrow_status = 'released'::escrow_status, status = 'settled'::order_status
  where escrow_status = 'held'::escrow_status
    and delivery_option = 'shipping'::delivery_option
    and delivered_at is not null
    and delivered_at < now() - interval '7 days';
  get diagnostics n = row_count;
  return n;
end $$;

-- C.Verse — M7 (audit 2026-08-24): vault-shipout duplicate-insert guard.
-- apps/api/src/routes/orders.ts::POST /orders/vault-shipout used to enforce
-- "one active shipment per card" with a JS read-check-then-write, leaving a race
-- window between listShipmentsByCards(...) and db.from('shipments').insert(...).
-- Add a partial unique index that lets the DB reject duplicate active rows
-- atomically; the route catches the unique violation and returns 409.
--
-- Final terminal statuses are excluded so a card can be re-shipped after
-- delivery/cancellation without needing to clean up history.

create unique index if not exists uq_shipments_active_per_card
  on public.shipments (card_id)
  where status not in ('delivered', 'cancelled');

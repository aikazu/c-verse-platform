-- ── Audit pass 2: dua celah tulis via PostgREST langsung (role authenticated) ──
-- 1. KYC self-approve: policy insert hanya cek user_id, TIDAK cek status —
--    user bisa insert kyc_records status='approved' untuk dirinya sebelum
--    pernah submit (terverifikasi live) → unlock eligibility payout.
-- 2. cards guard bocor: cards_buyout_guard hanya melindungi owner_id/status/
--    nfc_uid/nfc_short_id — owner bisa set qc_status/verify_status/nfc_configured/
--    location/card_status_new/last_ctr langsung (terverifikasi live):
--    kartu "verified" TANPA CMAC, bypass NFC provisioning. Juga buyout_price
--    via update langsung membypass limit MAX 20 aktif (set_buyout RPC).
-- Catatan konteks trigger: is_service_role() mengecek current_user — di dalam
-- RPC security definer & klien service-role, current_user = postgres/service,
-- jalu operasi sah tetap lolos; hanya tulis-d langsung oleh authenticated
-- (PostgREST anon/anon+JWT) yang diblokir.

-- 1) KYC: status 'pending' satu-satunya nilai yang boleh ditulis non-service
create or replace function public.kyc_status_guard() returns trigger
language plpgsql as $$
begin
  if public.is_service_role() then return new; end if;
  if new.status is distinct from 'pending' then
    raise exception 'kyc_records.status hanya boleh diubah service-role';
  end if;
  return new;
end $$;
drop trigger if exists trg_kyc_status_guard on public.kyc_records;
create trigger trg_kyc_status_guard before insert or update on public.kyc_records
  for each row execute function public.kyc_status_guard();

-- 2) cards: perluas kolom terlindungi + paritas MAX 20 listing
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

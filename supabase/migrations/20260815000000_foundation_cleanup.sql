-- C.Verse — Foundation cleanup (docs/16_foundation_cleanup.md)
-- F-01: vault default (C-10 FINAL) + F-02: drop legacy auction/listing path (C-07 FINAL)

-- F-01: orders default delivery = vault (shipping = opt-in eksplisit)
alter table public.orders alter column delivery_option set default 'vault';

-- F-02: bids.listing_id FK + column, lalu drop table listings (bids langsung ke card)
alter table public.bids drop constraint if exists bids_listing_id_fkey;
alter table public.bids drop column if exists listing_id;

drop table if exists public.listings;

-- F-02: drop legacy listing enums (tidak lagi dipakai)
drop type if exists listing_status;
drop type if exists listing_type;

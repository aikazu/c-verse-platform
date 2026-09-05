-- Badge icon delivery: serve family emblems from the public R2 origin.
-- Forward-only: preserves ids, codes, criteria, XP snapshots and activation
-- choices; only rewrites icon_url from the retired bundled path to the
-- verified immutable R2 object uploaded 2026-09-06 (SHA-256 matched locally
-- and over HTTPS before this mapping). New badges must store an absolute
-- HTTPS icon_url under badges/v1/.
update public.badges set icon_url = 'https://assets.c-verse.co/badges/v1/collector.webp'
where icon_url = '/badges/collector.webp';
update public.badges set icon_url = 'https://assets.c-verse.co/badges/v1/devotee.webp'
where icon_url = '/badges/devotee.webp';
update public.badges set icon_url = 'https://assets.c-verse.co/badges/v1/explorer.webp'
where icon_url = '/badges/explorer.webp';
update public.badges set icon_url = 'https://assets.c-verse.co/badges/v1/archivist.webp'
where icon_url = '/badges/archivist.webp';
update public.badges set icon_url = 'https://assets.c-verse.co/badges/v1/autograph.webp'
where icon_url = '/badges/autograph.webp';
update public.badges set icon_url = 'https://assets.c-verse.co/badges/v1/pioneer.webp'
where icon_url = '/badges/pioneer.webp';
update public.badges set icon_url = 'https://assets.c-verse.co/badges/v1/trader.webp'
where icon_url = '/badges/trader.webp';
update public.badges set icon_url = 'https://assets.c-verse.co/badges/v1/patron.webp'
where icon_url = '/badges/patron.webp';

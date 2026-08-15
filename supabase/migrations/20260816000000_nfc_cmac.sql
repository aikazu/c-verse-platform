-- C.Verse — NFC CMAC verify (docs/12_nfc_cmac_verify.md)
-- Anti-replay counter + verify_status semantics (tap=verified, QR=registered, default unknown).

alter table public.cards add column if not exists last_ctr integer not null default 0;

-- New cards start unverified; only a valid CMAC tap may set 'verified' (app-enforced).
alter table public.cards alter column verify_status set default 'unknown';

-- Ensure lookups by UID / short id use the existing unique indexes (they exist since
-- initial schema: idx_cards_nfc_uid, idx_cards_nfc_short on unique columns).

-- KYC binaries now live in the private Cloudflare R2 bucket `cverse-kyc`.
-- Postgres keeps only caller-scoped object keys and KYC workflow metadata.
alter table public.kyc_records rename column ktp_url to ktp_object_key;
alter table public.kyc_records rename column npwp_url to npwp_object_key;
alter table public.kyc_records rename column selfie_url to selfie_object_key;

alter table public.kyc_records
  add constraint kyc_ktp_object_key_owner_check
    check (ktp_object_key is null or ktp_object_key like user_id::text || '/ktp-%'),
  add constraint kyc_npwp_object_key_owner_check
    check (npwp_object_key is null or npwp_object_key like user_id::text || '/npwp-%'),
  add constraint kyc_selfie_object_key_owner_check
    check (selfie_object_key is null or selfie_object_key like user_id::text || '/selfie-%');

comment on column public.kyc_records.ktp_object_key is 'Private Cloudflare R2 object key; never a public URL.';
comment on column public.kyc_records.npwp_object_key is 'Private Cloudflare R2 object key; never a public URL.';
comment on column public.kyc_records.selfie_object_key is 'Private Cloudflare R2 object key; never a public URL.';

-- Browser clients can no longer write KYC documents directly to Supabase
-- Storage. Existing bucket metadata is intentionally preserved because direct
-- SQL deletion from the managed `storage` schema is forbidden; operators can
-- remove an empty legacy bucket later through the Storage API.
drop policy if exists kyc_files_owner_insert on storage.objects;
drop policy if exists kyc_files_owner_update on storage.objects;
drop policy if exists kyc_files_owner_select on storage.objects;

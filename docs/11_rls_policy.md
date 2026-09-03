# 11 — RLS Policy Matrix (ganti `allow all using(true)`)

> Status: [IMPLEMENTED 2026-08-16]
> Created: 2026-08-15; updated: 2026-08-31 (creator_page_views:
> insert langsung dihapus — tulis hanya via RPC
> `record_creator_page_view`, SELECT owner-only)
> Basis audit awal: semua policy `for all using (true) with check (true)`.
> Migration `03_rls.sql` (sebelumnya `20260817020000_rls_policies.sql`,
> dilebur saat konsolidasi 2026-08-24) sudah mengimplementasikan
> matriks policy penuh — enable RLS semua tabel, policy per-operation,
> guard function immutable.
> Estimasi: 2-3 hari AI-assisted. Dependency: `10_auth_migration.md`
> selesai (butuh `auth.uid()`).

## 1. Prinsip

1. **Enable RLS di SEMUA tabel** + **default deny** (tabel tanpa policy =
   tidak bisa diakses role non-service).
2. **service-role bypass otomatis** — admin app + provisioning tool pakai
   `SUPABASE_SERVICE_ROLE_KEY` (di belakang Cloudflare Access), tidak perlu
   policy.
3. Web pakai **anon key** (read publik) + **user JWT** (data milik sendiri).
   API Workers meneruskan user JWT untuk aksi tulis.
4. Satu tabel boleh punya beberapa policy per operation — jangan satu
   policy `for all`.

## 2. Matriks Policy (SQL target)

Helper: `create policy ... for select using (...)`, dst.
`auth.uid()` return `uuid` = `users.id` (setelah migrasi 10).

| Tabel | anon SELECT | user SELECT (owner) | INSERT | UPDATE | DELETE | Catatan |
|---|---|---|---|---|---|---|
| `users` (profiles) | - (revoke all from anon) | own row; admin = semua baris via `public.is_admin()` | trigger only | own (non-role field) | tidak | role & flag_reason: service only; hardening 2026-08-30 |
| `creators` | publish (handle/bio) | own | service | service | service | `status='active'` saja anon |
| `drops` | `status in ('live','published','sold_out','closed')` | - | service | service | service | draft tidak bocor |
| `cards` | baris ter-own ATAU status terjual publik | own cards | service | owner kolom buyout saja | service | lihat policy khusus |
| `orders` | - | `user_id = auth.uid()` | RPC only | RPC/status only | tidak | |
| `wallets` | - | `user_id = auth.uid()` | service | RPC only | tidak | |
| `wallet_transactions` | - | `user_id = auth.uid()` | RPC only | **TIDAK ADA (immutable)** | **TIDAK ADA** | append-only |
| `bids` | 90 hari terakhir + accepted | own bids | `bidder_id = auth.uid()` | status transition via RPC | tidak | |
| `shipments` | - | requester own | RPC | service | tidak | |
| `ownership_history` | read publik (provenance) | - | RPC only | tidak | tidak | |
| `badges` (definitions) | all active | - | service | service | service | |
| `user_badges` | - | `user_id = auth.uid()` | service (event) | tidak | tidak | |
| `kyc_records` | - | own (mask NIK) | own (submit) | service (approve/reject) | tidak | **tidak pernah anon** |
| `payout_batches` / `payouts` | - | own payouts | service | service | tidak | |
| `disputes` | - | reporter own | own | service | tidak | |
| `notifications` | - | `user_id = auth.uid()` | service | own (read flag) | tidak | |
| `nfc_batches` | - | - | service | service | service | service only |
| `qc_defects` | - | - | service | service | service | service only |
| `creator_page_views` | - | owner only (creator halaman sendiri) | RPC only** | - | - | **lihat catatan |
| `admin_audit_log` | - | - | service | **TIDAK ADA** | **TIDAK ADA** | append-only, tidak ada update/delete |

`creator_page_views`: INSERT langsung DITOLAK untuk semua role non-service —
tulis HANYA via SECURITY DEFINER RPC `record_creator_page_view` (RPC `07`–`17`,
di-grant ke anon+authenticated; berjalan sebagai table owner sehingga tidak
terkena RLS; guard suspended/unknown/no-creator). Policy INSERT terbuka
`with check (true)` dihapus (audit 2026-08-29 — anon bisa inject baris
creator_id apa pun melewati guard RPC). SELECT owner-only: policy
`creator_page_views_select_own` (`03_rls.sql`) — kreator hanya boleh baca
page view halamannya sendiri; agregat untuk dashboard via RPC
`get_creator_page_stats` (owner-fenced).

### Policy khusus `cards`
- SELECT publik: kartu yang sudah sold/bind (`status <> 'inventory'`)
  atau yang di-miliki user — `inventory` (belum terjual) tidak tampil.
- UPDATE buyout: `current_owner_id = auth.uid()` hanya boleh SET
  kolom `buyout_price_ccoin` — pakai trigger guard kolom lain ditolak
  (`raise exception` jika `cards.*` lain berubah dari sesi non-service).

### Policy khusus `users`
- SELECT: `(id = auth.uid()) or public.is_admin()` — hardening 2026-08-30
  (pentest F4): `revoke all on public.users from anon` (`01_schema.sql`);
  `is_anonymous` tidak lagi gate SELECT di RLS — profil publik dilayani
  API service-role dengan filter `is_anonymous`.
- Profil anonymous tetap bisa muncul sebagai "owner kartu" via API
  service-role yang strip display name — jangan bocorkan username di RLS.

## 3. Langkah Eksekusi

1. Migration RLS `03_rls.sql` (sebelumnya `20260817020000_rls_policies.sql`,
   fase 3 dari rantai 7 file — sekarang dilebur di konsolidasi 2026-08-24):
   `enable row level security` ulang semua tabel, `force row level
   security` pada `cards`, buat policy matriks di atas + 5 guard function
   (`users_fields_guard`, `cards_buyout_guard`, `wallet_tx_immutable_guard`,
   `audit_log_immutable_guard`, `kyc_status_guard`) + trigger-nya.
2. Hapus akses tulis langsung web: semua tulis via RPC (`13_atomic_checkout_rpc.md`)
   atau API endpoint yang pakai JWT user.
3. Grant minimal: `anon` hanya SELECT tabel publik; `authenticated` select/insert
   sesuai matriks. Jangan `grant all`.
4. Trigger guard: `cards_buyout_guard`, `wallet_tx_immutable_guard`
   (`before update or delete on wallet_transactions → raise exception`).

## 4. Test Verifikasi (wajib sebelum merge)

SQL test per kombinasi (jalankan sebagai `anon`, `authenticated` dgn
`request.jwt.claims`, dan service):

| # | Percobaan | Harus |
|---|---|---|
| T1 | anon `select * from wallets` | 0 rows |
| T2 | anon `select * from kyc_records` | 0 rows |
| T3 | anon `select * from drops where status='draft'` | 0 rows |
| T4 | user A `select * from wallet_transactions` | hanya row A |
| T5 | user A `update wallet_transactions set amount_ccoin=999` | exception |
| T6 | user A `update cards set buyout_price_ccoin=50` milik B | 0 row affected |
| T7 | user A `update cards set status='sold'` milik A | exception (guard kolom) |
| T8 | anon `insert into creator_page_views` | DITOLAK (0 row) — tulis hanya via RPC `record_creator_page_view` → OK |
| T9 | anon `select * from creator_page_views` | 0 rows |
| T10 | service-role insert user_badges | OK |

## 5. Jangan Dilakukan

- Jangan tinggalkan SATU policy `using(true)` pun di tabel user data.
- Jangan pakai service-role di web/api untuk aksi user biasa
  (hanya admin app + provisioning + agregat publik).
- Jangan rely pada API-layer check saja — RLS adalah lapis terakhir.

## 6. Acceptance Criteria

- [ ] Migration jalan bersih di `supabase db reset` + seed tetap load.
- [ ] 10 test T1-T10 pass (simpan sebagai `supabase/tests/rls_test.sql`).
- [ ] Web demo flow (browse → login → top-up sandbox → checkout) tetap jalan
      pasca policy (tidak ada regression read publik).
- [ ] `grep -r "using (true)" supabase/migrations/` → nol hasil
      (policy INSERT terbuka `creator_page_views` sudah dihapus —
      tulis via RPC `record_creator_page_view`).

## 7. Sumber

- `dev-strategy/05_data_model.md` section RLS (matriks asli).
- Audit Platform 2026-08-15: kebocoran allow-all pada migration lama di-squash;
  kini dijaga di `03_rls.sql` (sebelumnya fase 3
  `20260817020000_rls_policies.sql`) + EXECUTE lockdown di `17_rpc_grants`
  (sebelumnya fase 5 `20260817040000_grants_payout.sql`).
- Supabase docs: Row Level Security, `auth.uid()`, JWT claims.

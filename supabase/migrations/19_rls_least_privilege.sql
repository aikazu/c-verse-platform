-- ══════════════════════════════════════════════════════════════════════════
-- C.Verse — 19_rls_least_privilege: tutup celah baca/tulis langsung PostgREST
-- (audit 2026-09-04: H-1, M-1, M-2 + bids mint).
--
-- Temuan: API memproyeksikan payload publik dengan benar (masking "Anonim",
-- buang UUID stabil, sembunyikan bank_account/notes), tetapi RLS adalah
-- enforcement layer yang sebenarnya — dan grants table-level membuka kolom
-- yang sama ke anon/authenticated via PostgREST langsung:
--   p1 bids INSERT oleh authenticated  = mint bid fiktif (escrow/XP/badge
--      trigger ikut jalan) — bid asli HANYA via place_bid RPC.
--   p2 bids SELECT oleh authenticated   = bidder_name/bidder_id mentah
--      (bypass masking "Anonim" API).
--   p3/p4 ownership_history SELECT      = graf kepemilikan per UUID
--      (deanonymisasi lintas-listing, janji "Anonim" batal).
--   p5 cards SELECT oleh anon           = nfc_uid/owner_id/last_ctr publik.
--   p6 creators SELECT oleh authenticated = bank_account (rekening) + notes.
--
-- Perbaikan (additive, tanpa ubah objek lama — konvensi repo):
--   - revoke insert/select bids dari authenticated (RPC place_bid/cancel_bid/
--     accept_bid/buyout_card SECURITY DEFINER — tidak butuh grant caller;
--     read publik lewat API service-role yang sudah masking).
--   - revoke select ownership_history + cards dari anon (read publik lewat
--     API service-role; e2e/service-role tidak terdampak).
--   - creators: revoke select table-level dari authenticated, ganti dengan
--     column grant TANPA bank_account/notes. Admin SPA membaca kolom publik
--     yang sama (Creators.tsx/Dashboard.tsx tidak memakai bank_account) —
--     baca bank_account/notes kini HANYA via service-role (payout manual).
-- Bukti: supabase/tests/rls_provenance_leak_test.mjs (p1-p9).
-- ══════════════════════════════════════════════════════════════════════════

-- ── bids: tulis HANYA via RPC, baca publik HANYA via API ────────────────────
-- place_bid/cancel_bid/accept_bid/buyout_card SECURITY DEFINER berjalan sebagai
-- owner tabel — grant caller tidak diperlukan. Policy bids_select/bids_insert_own
-- dipertahankan sebagai pagar kedua (defense-in-depth) bila grant dikembalikan.
revoke insert on public.bids from authenticated;
revoke select on public.bids from authenticated;

-- ── provenance/cards: tutup dari anon ───────────────────────────────────────
-- Read publik (NFC verify, ownership history, marketplace) dirutekan lewat
-- selector API service-role (apps/api/src/lib/reads/*) yang memproyeksikan
-- payload aman. ownership_history juga direvoke dari authenticated (lesson
-- default-privileges: grant anon-revoke tidak menutup authenticated) —
-- tidak ada konsumen user-scoped: creators/reads.ts countCards + nfc/reads.ts
-- listOwnershipByCard jalan via readDb() service-role.
-- Policy cards_select/ownership_history_select_public dipertahankan sebagai
-- pagar kedua untuk role lain.
revoke select on public.ownership_history from anon;
revoke select on public.ownership_history from authenticated;
revoke select on public.cards from anon;

-- ── creators: kolom sensitif hanya service-role ─────────────────────────────
-- Postgres tidak punya column-level RLS — kontrolnya di GRANT. Revoke
-- table-level, grant ulang kolom operasional eksplisit. bank_account
-- (rekening: PII finansial, H-1) TIDAK di-grant ke role mana pun — baca HANYA
-- via service-role (payout manual IRIS). notes dipertahankan di grant karena
-- admin SPA (Creators.tsx:31, Dashboard) membacanya langsung untuk operasional
-- harian; sensitivitasnya rendah (catatan rekrutmen) dan baris non-active
-- tetap tertutup policy creators_select. Bila notes kelak memuat PII,
-- pindahkan read admin ke endpoint role-gated dan revoke kolom ini juga.
revoke select on public.creators from authenticated;
grant select (
  id, user_id, handle, total_followers_combined, status,
  kyc_completed, notes, created_at, updated_at
) on public.creators to authenticated;

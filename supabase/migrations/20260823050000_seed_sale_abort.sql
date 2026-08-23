-- ══════════════════════════════════════════════════════════════════════════
-- C.Verse — ADMIN ABORT PATH untuk stuck Creator Seed PHASE-1 sales
-- (keputusan 2026-08-23, audit-verified)
--
-- LATAR BELAKANG (audit):
--   PHASE-1 LOCK seed two-phase settlement (migrasi
--   20260821020000_seed_two_phase.sql + 20260823020000_seed_xp_unify.sql)
--   mengunci uang buyer / escrow pending:
--
--     PATH A (accept_bid PHASE-1, 20260821020000 L96-112):
--       1) bid.status: 'active' -> 'accepted' (+accepted_at, destination,
--          shipping_address)
--       2) bid lain 'active' -> 'outbid' (escrow di-release — uang buyer
--          non-pemenang SUDAH kembali via wallet_credit 'escrow_release')
--       3) cards.status -> 'bid_pending', cards.buyout_price_ccoin -> NULL
--       4) Buyer PEMENANG tidak di-debit di PHASE-1 (uang sudah di-escrow
--          dari place_bid dengan type='escrow_hold' — bukan 'platform_buy')
--
--     PATH B (buyout_card PHASE-1, 20260823020000 L121-147):
--       1) wallet_debit buyer dengan p_type='escrow_hold' (amount=price,
--          p_idem='buyout-seed-'||uuid) — saldo buyer TURUN, TETAP
--          tersimpan sebagai escrow 'held' (orders.escrow_status='held')
--       2) Insert orders row: status='paid', escrow_status='held',
--          source='secondary_buyout', delivery_option=shipping/vault,
--          shipping_address
--       3) bid 'active' -> 'outbid' (escrow di-release)
--       4) cards.status -> 'bid_pending', cards.buyout_price_ccoin -> NULL
--
--   PHASE-2 (release_seed_sale) butuh kartu fisik masuk vault + NFC
--   verified (verified HANYA via tap crypto nfc.ts — admin tidak bisa
--   memalsukan). Jika kartu hilang/dispute/tidak pernah di-vault,
--   release TIDAK PERNAH terjadi -> uang buyer/escrow terkunci selamanya
--   (buyer tidak bisa refund sendiri karena route admin tidak ada).
--   XP buyer NOT granted at PHASE-1 (keputusan founder 2026-08-23,
--   migration 20260823020000) -> abort tidak butuh XP reversal.
--
-- FIX (audit-fix, defense-in-depth):
--   1. RPC cancel_seed_sale(p_card_id) — service_role ONLY, mirror
--      guard pattern dari 20260823030000_release_seed_grant_lock.sql
--      (in-body is_service_role() + explicit REVOKE/GRANT).
--   2. Revert PHASE-1 state per path:
--        PATH A (accepted-bid):
--          - bid 'accepted' -> 'cancelled' (audit: aborted, refund via
--            wallet_credit p_type='seed_abort' p_ref_type='bid' p_ref_id=bid.id)
--          - wallet_credit buyer amount=bid.amount_ccoin (idempotent
--            p_idem='seed-abort-'||card_id)
--          - cards.status -> 'inventory' (pre-lock tradable state;
--            buyout_price_ccoin TIDAK dipulihkan — PHASE-1 hapus nilainya
--            dan pre-PHASE-1 value tidak recoverable; owner bisa set
--            ulang lewat set_buyout)
--        PATH B (order pending):
--          - orders.status -> 'refunded' (terminal state order_status
--            enum), orders.escrow_status tetap 'held' (audit jejak;
--            tidak perlu flip ke 'released' karena dana SUDAH kembali
--            ke buyer via wallet_credit — orders.escrow_status mencerminkan
--            state escrow legal di orders, refund = wallet_credit sukses)
--          - wallet_credit buyer amount=order.total_ccoin (idempotent
--            p_idem='seed-abort-'||card_id)
--          - cards.status -> 'inventory'
--   3. NEVER touch treasury/platform_revenue — PHASE-1 menulis TIDAK ada
--      revenue leg (settlement 85/7,5/7,5 HANYA di PHASE-2 release). Verify:
--      buyout_card PHASE-1 hanya wallet_debit (type='escrow_hold', bukan
--      'platform_buy') + insert orders — TIDAK ADA revenue snapshot,
--      wallet_credit settlement, royalty, atau ownership_history. Sama
--      untuk accept_bid PHASE-1. Jadi refund full aman tanpa offset revenue.
--   4. Idempotent: p_idem='seed-abort-'||card_id -> wallet_credit replay
--      return existing row (no double credit).
--   5. NO XP reversal: XP buyer granted TEPAT SEKALI di PHASE-2 release,
--      PHASE-1 tidak grant XP (trigger wallet_debit type='escrow_hold'
--      tidak masuk list 'checkout'/'platform_buy' di
--      20260817030000_rpc_atomic.sql L51-55). Abort = refund saldo saja.
-- ══════════════════════════════════════════════════════════════════════════

-- ══════════════════════════════════════════════════════════════════════════
-- 1. cancel_seed_sale(p_card_id) — service_role ONLY.
--    Returns json {cardId, refundedCcoin, buyerId, path} untuk audit/UI.
-- ══════════════════════════════════════════════════════════════════════════
create or replace function public.cancel_seed_sale(p_card_id text)
returns json
language plpgsql security definer set search_path = public as $$
declare
  v_card public.cards;
  v_is_seed boolean;
  v_bid public.bids;
  v_order public.orders;
  v_buyer uuid;
  v_refund_amount integer;
  v_path text;
begin
  -- SECURITY GUARD (pola 20260823030000_release_seed_grant_lock.sql):
  -- service_role ONLY — dipanggil admin via API di belakang requireAdmin +
  -- admin_audit_log. Pagar kedua jika EXECUTE grant bocor lagi.
  if not public.is_service_role() then
    raise exception 'PERMISSION_DENIED: cancel_seed_sale requires service_role';
  end if;

  -- Idempotent: kalau sudah pernah refund (idempotency_key tercatat),
  -- return ringkasan tanpa double-credit.
  if exists (
    select 1 from wallet_transactions
    where metadata->>'idempotency_key' = 'seed-abort-' || p_card_id
  ) then
    select * into v_card from cards where id = p_card_id;
    select c.user_id, c.amount_ccoin into v_buyer, v_refund_amount
      from wallet_transactions c
      where c.metadata->>'idempotency_key' = 'seed-abort-' || p_card_id
      limit 1;
    return json_build_object(
      'cardId', p_card_id,
      'refundedCcoin', v_refund_amount,
      'buyerId', v_buyer,
      'path', coalesce(v_path, 'unknown'),
      'alreadyAborted', true
    );
  end if;

  -- Lock card FOR UPDATE — serialize dengan release_seed_sale (kompetisi
  -- admin abort vs admin release di detik yang sama ditolak salah satu).
  select * into v_card from cards where id = p_card_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;

  -- Reject NOT_FOUND lebih awal — sama dengan release_seed_sale (CARD_NOT_FOUND).
  -- Di route kita map ke 404. Pakai NOT_FOUND untuk konsistensi.

  select true into v_is_seed from drops d where d.id = v_card.drop_id and d.is_seed;
  if not coalesce(v_is_seed, false) then raise exception 'NOT_SEED_CARD'; end if;

  -- Reject NO_PENDING_SALE kalau kartu BUKAN dalam PHASE-1 locked state
  -- (sama gate dengan release_seed_sale 20260823030000 L73-75).
  if v_card.status::text <> 'bid_pending' then
    raise exception 'NO_PENDING_SALE';
  end if;

  -- ── Path A: accepted bid (owner accept -> PHASE-1 LOCK) ───────────────
  -- Cari bid 'accepted' terbaru untuk kartu ini. wallet_credit ke bidder
  -- dengan amount = bid.amount_ccoin. Mark bid 'cancelled' (terminal,
  -- consistent dengan bid status enum — 'cancelled' sudah dipakai
  -- 20260817030000_rpc_atomic.sql L490 untuk cancel_bid user-side).
  select * into v_bid from bids where card_id = p_card_id and status = 'accepted'
  order by accepted_at desc nulls last limit 1;
  if found then
    v_buyer := v_bid.bidder_id;
    v_refund_amount := v_bid.amount_ccoin;
    v_path := 'bid';

    perform public.wallet_credit(v_buyer, v_refund_amount, 'seed_abort', 'bid', v_bid.id,
            'seed-abort-' || p_card_id);

    update bids set status = 'cancelled', cancelled_at = now() where id = v_bid.id;

    update cards set status = 'inventory'::card_status where id = p_card_id;

    return json_build_object(
      'cardId', p_card_id,
      'refundedCcoin', v_refund_amount,
      'buyerId', v_buyer,
      'path', v_path
    );
  end if;

  -- ── Path B: order pending (buyout PHASE-1 — escrow 'held') ─────────────
  -- Cari order 'paid' + escrow 'held' + source 'secondary_buyout' terbaru.
  -- wallet_credit ke buyer dengan amount = order.total_ccoin. Mark order
  -- 'refunded' (terminal order_status — sudah ada di enum foundation
  -- 20260817000000 L12).
  select * into v_order from orders
  where card_id = p_card_id and status = 'paid'::order_status
    and escrow_status = 'held'::escrow_status and source = 'secondary_buyout'
  order by created_at desc limit 1;
  if not found then
    -- Tidak ada bid 'accepted' DAN tidak ada order pending -> state
    -- 'bid_pending' tanpa PHASE-1 artifacts (kemungkinan drift data,
    -- bukan path normal). Tolak NO_PENDING_SALE (sama dengan release).
    raise exception 'NO_PENDING_SALE';
  end if;

  v_buyer := v_order.user_id;
  v_refund_amount := v_order.total_ccoin;
  v_path := 'buyout';

  perform public.wallet_credit(v_buyer, v_refund_amount, 'seed_abort', 'order', v_order.id,
          'seed-abort-' || p_card_id);

  -- orders.status -> 'refunded' (terminal state; enum ada sejak
  -- 20260817000000 L12). orders.escrow_status TETAP 'held' sebagai audit
  -- jejak (escrow flow record legal; refund sukses ditandai via status).
  update orders set status = 'refunded'::order_status where id = v_order.id;

  update cards set status = 'inventory'::card_status where id = p_card_id;

  return json_build_object(
    'cardId', p_card_id,
    'refundedCcoin', v_refund_amount,
    'buyerId', v_buyer,
    'path', v_path
  );
end $$;

-- ══════════════════════════════════════════════════════════════════════════
-- 2. GRANTS — explicit REVOKE/GRANT idempotent (pola
--    20260823030000_release_seed_grant_lock.sql L384-402). service_role
--    ONLY — release_seed_sale sibling.
-- ══════════════════════════════════════════════════════════════════════════
revoke execute on function public.cancel_seed_sale(text) from public;
revoke execute on function public.cancel_seed_sale(text) from anon;
revoke execute on function public.cancel_seed_sale(text) from authenticated;
grant execute on function public.cancel_seed_sale(text) to service_role;

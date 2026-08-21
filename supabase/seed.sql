-- C.Verse — Seed (auth rework 2026-08-15) — fixed UUID ids = auth.users.id (docs/10)
-- Idempotent: ON CONFLICT DO NOTHING.
-- Akun demo dibuat di auth.users TANPA password (login platform = OTP/Google, admin = OTP magic link).

-- ── auth.users (jalankan sebelum public.users — FK) ──
-- Token columns WAJIB string kosong (bukan NULL): GoTrue gagal scan NULL
-- ("converting NULL to string is unsupported") sehingga login lokal 500.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change, email_change_token_new)
values
 ('00000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'demo@cverse.id', null, now(), now(), now(), '{}'::jsonb, '{}'::jsonb, '', '', '', ''),
 ('00000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@cverse.id', null, now(), now(), now(), '{}'::jsonb, '{}'::jsonb, '', '', '', ''),
 ('00000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'karina@creator.id', null, now(), now(), now(), '{}'::jsonb, '{}'::jsonb, '', '', '', ''),
 ('00000000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'hype@creator.id', null, now(), now(), now(), '{}'::jsonb, '{}'::jsonb, '', '', '', ''),
 ('00000000-0000-4000-8000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'nova@creator.id', null, now(), now(), now(), '{}'::jsonb, '{}'::jsonb, '', '', '', '')
on conflict (id) do nothing;

-- ── public.users (mirror profile; trigger on_auth_user_created menangani signup baru) ──
-- Trigger handle_new_created membuat baris ini duluan (display_name = prefix email, username NULL)
-- saat auth.users di-seed — maka di sini WAJIB do update, bukan do nothing, agar nilai seed menimpa.
insert into public.users (id, email, display_name, username, role, xp, is_anonymous, total_xp, level) values
 ('00000000-0000-4000-8000-000000000001', 'demo@cverse.id', 'Demo Kolektor', 'demo_kolektor', 'user', 45, false, 45, 5),
 ('00000000-0000-4000-8000-000000000002', 'admin@cverse.id', 'Admin C.Verse', 'admin', 'admin', 0, false, 0, 1),
 ('00000000-0000-4000-8000-000000000003', 'karina@creator.id', 'Karina Aespa', 'karina_aespa', 'creator', 120, false, 120, 13),
 ('00000000-0000-4000-8000-000000000004', 'hype@creator.id', 'HypeCreator', 'hypecreator', 'creator', 90, false, 90, 10),
 ('00000000-0000-4000-8000-000000000005', 'nova@creator.id', 'Nova Studio', 'nova_studio', 'creator', 60, false, 60, 7)
on conflict (id) do update set
  display_name = excluded.display_name,
  username = excluded.username,
  username_is_auto = false,
  role = excluded.role,
  xp = excluded.xp,
  is_anonymous = excluded.is_anonymous,
  total_xp = excluded.total_xp,
  level = excluded.level;

-- ── badges (katalog; award badge lewat jalur DB butuh definisi ini) ──
insert into public.badges (id, code, name, description, icon, icon_url, xp, xp_reward, criteria, is_active) values
 ('b1', 'first_drop', 'First Drop', 'Beli pertama kali', '🎴', '🎴', 100, 100, '{"type":"collect_count","min":1}', true),
 ('b2', 'first_bid', 'First Bid', 'Bid pertama', '🔨', '🔨', 50, 50, '{"type":"first_bid"}', true),
 ('b3', 'collector_5', 'Collector', 'Koleksi 5 kartu', '🌟', '🌟', 200, 200, '{"type":"collect_count","min":5}', true),
 ('b4', 'curator', 'Curator', '10 kartu kreator sama', '🎨', '🎨', 300, 300, '{"type":"creator_cards","min":10}', true),
 ('b5', 'whale', 'Whale', 'Single bid > 100 C-Coin', '🐋', '🐋', 500, 500, '{"type":"single_bid_gt","min":100}', true),
 ('b6', 'verified', 'Verified', 'KYC terverifikasi', '✅', '✅', 50, 50, '{"type":"kyc_verified"}', true)
on conflict (id) do nothing;

-- ── creators ──
insert into public.creators (id, user_id, handle, total_followers_combined, status, bank_account, notes) values
 ('cr-karina', '00000000-0000-4000-8000-000000000003', 'karina_aespa', 185000, 'active', '{"bank":"BCA","account_no":"1234567890","holder":"Karina"}', 'Rekrut via DM IG'),
 ('cr-hype',   '00000000-0000-4000-8000-000000000004', 'hypecreator', 320000, 'active', '{"bank":"Mandiri","account_no":"9876543210","holder":"HypeCreator"}', 'Referral founder'),
 ('cr-nova',   '00000000-0000-4000-8000-000000000005', 'nova_studio', 110000, 'active', '{"bank":"BCA","account_no":"1122334455","holder":"Nova Studio"}', 'Found via search')
on conflict (id) do nothing;

-- ── drops (70/30 platform-produced, priceCcoin canonical) ──
-- raffle_end_at = drop_start_at + 24 jam (drop baru selalu raffle, docs 03 Flow 5).
insert into public.drops (id, title, series, narrative, artwork_url, total_units, signed_count, unsigned_count, price_unsigned_ccoin, price_signed_ccoin, price_ccoin, status, drop_at, drop_start_at, raffle_end_at, drawn_at, creator_id, creator_name, sold_count) values
 ('drop-aespa-2025', 'Karina — Limited Genesis', 'HypeCreator X Aespa (2025 Limited Series)', 'Kolaborasi eksklusif Karina Aespa dengan HypeCreator. Acrylic hardcase premium + NFC anti-tamper cryptographic. Hanya 15 unit di dunia.', '/textures/karina.jpg', 15, 2, 13, 30, 50, 30, 'live', now() - interval '1 hour', now() - interval '1 hour', now() + interval '23 hours', null, '00000000-0000-4000-8000-000000000003', 'Karina Aespa', 6),
 ('drop-genesis-alpha', 'Genesis Alpha', 'Creator X — Alpha Series', 'Genesis drop dari Creator X. Desain bold, holo foil, acrylic tebal 3mm. Koleksi pembuka C.Verse.', '/textures/genesis.jpg', 20, 2, 18, 25, 45, 25, 'live', now() - interval '2 hours', now() - interval '2 hours', now() + interval '22 hours', null, '00000000-0000-4000-8000-000000000004', 'HypeCreator', 12),
 ('drop-nova-01', 'Neon Bloom #01', 'Nova Studio — Neon Bloom', 'Neon Bloom mengeksplor gradien neon & organic shapes. Tiap kartu punya nomor seri & sertifikat digital.', '/textures/neon.jpg', 12, 2, 10, 20, 40, 20, 'scheduled', now() + interval '2 days', now() + interval '2 days', now() + interval '3 days', null, '00000000-0000-4000-8000-000000000005', 'Nova Studio', 0),
 ('drop-aespa-signed', 'Karina — Signed Vault', 'HypeCreator X Aespa — Signed Vault', 'Signed edition — ditandatangani kreator, insert premium, hanya 1 per 10 kartu.', '/textures/karina-signed.jpg', 10, 1, 9, 30, 50, 30, 'closed', now() - interval '7 days', now() - interval '7 days', now() - interval '6 days', now() - interval '6 days', '00000000-0000-4000-8000-000000000003', 'Karina Aespa', 10)
on conflict (id) do nothing;

-- ── cards (generate_series: unit <= sold_count terjual;
--    owner: i%3=0 demo, i%2=0 admin, selain itu hype; unit 3 aespa listed buyout 45)
--    verify_status: 'verified' HANYA via tap CMAC — seed 'registered' (sold) / 'unknown'. ──
insert into public.cards (id, drop_id, unit_number, variant, status, owner_id, nfc_uid, nfc_short_id, verify_status, location, buyout_price_ccoin, nfc_configured, qc_status)
select
  'card-' || d.id || '-' || lpad(i::text, 2, '0'),
  d.id,
  i,
  case when i <= d.signed_count then 'signed' else 'unsigned' end::card_variant,
  case
    when d.id = 'drop-aespa-2025' and i = 3 then 'listed_buyout'::card_status
    when i <= d.sold_count then 'bound'::card_status
    else 'inventory'::card_status
  end,
  case when i <= d.sold_count then
    case when i % 3 = 0 then '00000000-0000-4000-8000-000000000001'
         when i % 2 = 0 then '00000000-0000-4000-8000-000000000002'
         else '00000000-0000-4000-8000-000000000004' end::uuid
  else null end,
  upper(md5(d.id || i::text || random()::text)),
  right(regexp_replace(d.id, '[^a-z0-9]', '', 'g'), 4) || '-' || lpad(i::text, 3, '0'),
  case when i <= d.sold_count then 'registered' else 'unknown' end::verify_status,
  case when i <= d.sold_count then 'with_owner' else 'platform_stock' end::card_location,
  case when d.id = 'drop-aespa-2025' and i = 3 then 45 else null end,
  true,
  case when i <= d.sold_count then 'passed' else 'pending' end
from public.drops d
cross join generate_series(1, 100) i
where i <= d.total_units
on conflict (id) do nothing;



-- ── Creator Seed C.Card (Flow 10, is_seed) ──
-- Fixture seed 1-of-1: drop khusus is_seed=true milik Karina (creator_id = Karina,
-- royalti otomatis ke dia). Kartu 1-of-1 di-hadiahkan ke Karina (ownership_history gift),
-- status listed_buyout, lokasi with_owner, verify_status unknown → badge "Seed 1-of-1"
-- nyala di Marketplace. TWO-PHASE (keputusan 2026-08-21): bid/accept/checkout BOLEH
-- sekarang (PHASE-1 LOCK → card 'bid_pending'); RELEASE (release_seed_sale, admin) yang
-- wajib menunggu kartu masuk platform_vault + NFC verified (SEED_VAULT_IN_REQUIRED).
-- Seed drop BUKAN raffle: raffle_end_at/drawn_at = null (kolom nullable).
insert into public.drops (id, title, series, narrative, artwork_url, total_units, signed_count, unsigned_count, price_unsigned_ccoin, price_signed_ccoin, price_ccoin, status, drop_at, drop_start_at, raffle_end_at, drawn_at, creator_id, creator_name, sold_count, is_seed) values
 ('drop-seed-karina-01', 'Karina — Seed 1-of-1 (Genesis Creator Card)', 'Creator Seed C.Card', 'Kartu seed 1-of-1 tentang Karina Aespa — hadiah perdana C.Verse untuk kreator (Creator Seed C.Card, Flow 10, keputusan 2026-08-20). Bukan raffle: dijual di secondary normal; dua-fase (keputusan 2026-08-21): accept/checkout = PHASE-1 LOCK, RELEASE wajib vault-in + NFC verified.', '/textures/karina-seed.jpg', 1, 1, 0, 60, 60, 60, 'live', now() - interval '1 hour', now() - interval '1 hour', null, null, '00000000-0000-4000-8000-000000000003', 'Karina Aespa', 0, true)
on conflict (id) do nothing;

-- Kartu seed: dimiliki Karina, listed_buyout (muncul di Marketplace), masih di tangan
-- kreator (with_owner) & belum diverifikasi (unknown) → PHASE-1 LOCK aktif:
-- accept/checkout mengunci deal (bid_pending), release butuh vault-in + verified.
insert into public.cards (id, drop_id, unit_number, variant, status, owner_id, nfc_uid, nfc_short_id, verify_status, location, buyout_price_ccoin, nfc_configured, qc_status) values
 ('card-seed-karina-01', 'drop-seed-karina-01', 1, 'signed', 'listed_buyout', '00000000-0000-4000-8000-000000000003', upper(md5('seed-karina-01')), 'seedk-001', 'unknown', 'with_owner', 60, true, 'passed')
on conflict (id) do nothing;

-- Provenance: Karina menerima kartu seed via GIFT (bukan pembelian) — anchor C-13 (30 hari).
insert into public.ownership_history (id, card_id, owner_id, acquired_via, order_id, transferred_at) values
 ('oh-seed-karina-01', 'card-seed-karina-01', '00000000-0000-4000-8000-000000000003', 'gift', null, now() - interval '2 hours')
on conflict (id) do nothing;

-- Bid demo aktif di kartu seed (wallet demo 120 >= 60) — memperlihatkan flow accept bid
-- dua-fase: accept = PHASE-1 LOCK (bid_pending), release admin setelah vault-in + NFC.
insert into public.bids (id, card_id, bidder_id, bidder_name, amount_ccoin, status, created_at, outbid_at) values
 ('bid-seed-karina-01', 'card-seed-karina-01', '00000000-0000-4000-8000-000000000001', 'Demo Kolektor', 60, 'active', now() - interval '30 minutes', null)
on conflict (id) do nothing;

-- ── wallets (demo 120 / karina 0 / lainnya 50) ──
insert into public.wallets (user_id, balance_ccoin, total_topup_ccoin, total_spent_ccoin) values
 ('00000000-0000-4000-8000-000000000001', 120, 150, 30),
 ('00000000-0000-4000-8000-000000000002', 50, 0, 0),
 ('00000000-0000-4000-8000-000000000003', 0, 0, 0),
 ('00000000-0000-4000-8000-000000000004', 50, 0, 0),
 ('00000000-0000-4000-8000-000000000005', 50, 0, 0)
on conflict (user_id) do nothing;

-- ── wallet_transactions demo ──
insert into public.wallet_transactions (id, user_id, type, amount_ccoin, balance_after_ccoin, ref_type, ref_id, note, created_at) values
 ('wtx-seed-1', '00000000-0000-4000-8000-000000000001', 'top_up', 100, 100, 'topup', 'top-1', 'Top-up via QRIS', now() - interval '3 days'),
 ('wtx-seed-2', '00000000-0000-4000-8000-000000000001', 'top_up', 50, 150, 'topup', 'top-2', 'Top-up via VA BCA', now() - interval '1 day'),
 ('wtx-seed-3', '00000000-0000-4000-8000-000000000001', 'checkout', -30, 120, 'order', 'ord-demo', 'Checkout Karina #03', now() - interval '1 hour')
on conflict (id) do nothing;

-- ── orders demo (shipping escrow held + vault settled) ──
insert into public.orders (id, user_id, drop_id, card_id, card_ids, total_ccoin, total_idr, status, delivery_option, shipping_fee_ccoin, escrow_status, shipping_address, tracking_number, shipped_at, created_at) values
 ('ord-demo', '00000000-0000-4000-8000-000000000001', 'drop-aespa-2025', 'card-drop-aespa-2025-03', array['card-drop-aespa-2025-03'], 30, 300000, 'shipped', 'shipping', 2, 'held', 'Jl. Demo No. 1, Jakarta Selatan', 'JNE-881200334455', now() - interval '30 minutes', now() - interval '1 hour'),
 ('ord-vault-demo', '00000000-0000-4000-8000-000000000001', 'drop-genesis-alpha', 'card-drop-genesis-alpha-02', array['card-drop-genesis-alpha-02'], 25, 250000, 'settled', 'vault', null, 'released', null, null, null, now() - interval '5 days')
on conflict (id) do nothing;

-- ── shipments demo ──
insert into public.shipments (id, card_id, requester_id, type, from_location, to_dest, address, fee_ccoin, status, tracking_number, created_at) values
 ('ship-demo-1', 'card-drop-aespa-2025-03', '00000000-0000-4000-8000-000000000001', 'primary_shipping', 'platform', 'buyer_address', '{"street":"Jl. Demo No. 1, Jakarta Selatan"}', 2, 'shipped', 'JNE-881200334455', now() - interval '1 hour'),
 ('ship-vault-1', 'card-drop-genesis-alpha-02', '00000000-0000-4000-8000-000000000001', 'primary_vault', 'platform', 'platform_vault', null, null, 'delivered', null, now() - interval '5 days')
on conflict (id) do nothing;

-- ── ownership history demo ──
insert into public.ownership_history (id, card_id, owner_id, acquired_via, order_id, transferred_at) values
 ('oh-seed-1', 'card-drop-aespa-2025-03', '00000000-0000-4000-8000-000000000001', 'primary', 'ord-demo', now() - interval '1 hour'),
 ('oh-seed-2', 'card-drop-genesis-alpha-02', '00000000-0000-4000-8000-000000000001', 'primary', 'ord-vault-demo', now() - interval '5 days')
on conflict (id) do nothing;

-- ── bids demo (outbid 38 admin, active 42 hype) ──
insert into public.bids (id, card_id, bidder_id, bidder_name, amount_ccoin, status, created_at, outbid_at) values
 ('bid-seed-1', 'card-drop-aespa-2025-03', '00000000-0000-4000-8000-000000000002', 'Admin C.Verse', 38, 'outbid', now() - interval '5 hours', now() - interval '1 hour'),
 ('bid-seed-2', 'card-drop-aespa-2025-03', '00000000-0000-4000-8000-000000000004', 'HypeCreator', 42, 'active', now() - interval '1 hour', null)
on conflict (id) do nothing;

-- ── user badges demo ──
insert into public.user_badges (user_id, badge_id, earned_at, awarded_at, xp_reward_snapshot) values
 ('00000000-0000-4000-8000-000000000001', 'b1', now() - interval '2 days', now() - interval '2 days', 100)
on conflict (user_id, badge_id) do nothing;

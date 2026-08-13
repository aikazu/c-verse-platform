-- C.Verse — Seed (rework 2026-08-13) — matches store.ts ensureSeed + 05-data-model
-- Idempotent: ON CONFLICT DO NOTHING
-- Covers: users (is_anonymous/level), creators, drops (price_ccoin), cards (location/buyout), wallets, badges, sessions, shipments stub, ownership_history

-- Users (add is_anonymous + level bookkeeping)
insert into public.users (id, email, password_hash, display_name, role, xp, is_anonymous, total_xp, level) values
 ('u_demo', 'demo@cverse.id', 'demo123', 'Demo Kolektor', 'collector', 45, false, 45, 5),
 ('u_admin', 'admin@cverse.id', 'admin123', 'Admin C.Verse', 'admin', 0, false, 0, 1),
 ('cr_karina', 'karina@creator.id', 'x', 'Karina Aespa', 'creator', 120, false, 120, 13),
 ('cr_hype', 'hype@creator.id', 'x', 'HypeCreator', 'creator', 90, false, 90, 10),
 ('cr_nova', 'nova@creator.id', 'x', 'Nova Studio', 'creator', 60, false, 60, 7)
on conflict (id) do nothing;

-- Creators (off-platform rekrut; threshold 100rb+ combined — manual)
insert into public.creators (id, user_id, handle, total_followers_combined, status, bank_account, notes) values
 ('cr-karina', 'cr_karina', 'karina_aespa', 185000, 'active', '{"bank":"BCA","account_no":"1234567890","holder":"Karina"}', 'Rekrut via DM IG — threshold ok'),
 ('cr-hype', 'cr_hype', 'hypecreator', 320000, 'active', '{"bank":"Mandiri","account_no":"9876543210","holder":"HypeCreator"}', 'Referral founder'),
 ('cr-nova', 'cr_nova', 'nova_studio', 110000, 'active', '{"bank":"BCA","account_no":"1122334455","holder":"Nova Studio"}', 'Found via search — combined 110k')
on conflict (id) do nothing;

-- Wallets
insert into public.wallets (user_id, balance_ccoin, total_topup_ccoin, total_spent_ccoin) values
 ('u_demo', 120, 150, 30),
 ('u_admin', 50, 0, 0),
 ('cr_karina', 0, 0, 0),
 ('cr_hype', 50, 0, 0),
 ('cr_nova', 50, 0, 0)
on conflict (user_id) do nothing;

-- Badges (now with criteria + icon_url + xp_reward)
insert into public.badges (id, code, name, description, icon, icon_url, xp, xp_reward, criteria, is_active) values
 ('b1', 'first_drop', 'First Drop', 'Beli pertama kali', '🎴', '🎴', 100, 100, '{"type":"collect_count","min":1}', true),
 ('b2', 'first_bid', 'First Bid', 'Bid pertama', '🔨', '🔨', 50, 50, '{"type":"first_bid"}', true),
 ('b3', 'collector_5', 'Collector', 'Koleksi 5 kartu', '🌟', '🌟', 200, 200, '{"type":"collect_count","min":5}', true),
 ('b4', 'curator', 'Curator', '10 kartu kreator sama', '🎨', '🎨', 300, 300, '{"type":"creator_cards","min":10}', true),
 ('b5', 'whale', 'Whale', 'Single bid > 100 C-Coin', '🐋', '🐋', 500, 500, '{"type":"single_bid_gt","min":100}', true),
 ('b6', 'verified', 'Verified', 'KYC terverifikasi', '✅', '✅', 50, 50, '{"type":"kyc_verified"}', true)
on conflict (id) do nothing;

-- Drops (price_ccoin canonical + drop_start_at; legacy price_* kept for UI)
insert into public.drops (id, title, series, narrative, artwork_url, total_units, signed_count, unsigned_count, price_unsigned_ccoin, price_signed_ccoin, price_ccoin, status, drop_at, drop_start_at, creator_id, creator_name, sold_count) values
 ('drop-aespa-2025', 'Karina — Limited Genesis', 'HypeCreator X Aespa (2025 Limited Series)', 'Kolaborasi eksklusif Karina Aespa dengan HypeCreator. Acrylic hardcase premium + NFC anti-tamper cryptographic. Hanya 15 unit di dunia.', '/textures/karina.jpg', 15, 2, 13, 30, 50, 30, 'live', now() - interval '1 hour', now() - interval '1 hour', 'cr_karina', 'Karina Aespa', 6),
 ('drop-genesis-alpha', 'Genesis Alpha', 'Creator X — Alpha Series', 'Genesis drop dari Creator X. Desain bold, holo foil, acrylic tebal 3mm. Koleksi pembuka C.Verse.', '/textures/genesis.jpg', 20, 2, 18, 25, 45, 25, 'live', now() - interval '2 hours', now() - interval '2 hours', 'cr_hype', 'HypeCreator', 12),
 ('drop-nova-01', 'Neon Bloom #01', 'Nova Studio — Neon Bloom', 'Neon Bloom mengeksplor gradien neon & organic shapes. Tiap kartu punya nomor seri & sertifikat digital.', '/textures/neon.jpg', 12, 2, 10, 20, 40, 20, 'scheduled', now() + interval '2 days', now() + interval '2 days', 'cr_nova', 'Nova Studio', 0),
 ('drop-aespa-signed', 'Karina — Signed Vault', 'HypeCreator X Aespa — Signed Vault', 'Signed edition — ditandatangani kreator, insert premium, hanya 1 per 10 kartu.', '/textures/karina-signed.jpg', 10, 1, 9, 30, 55, 30, 'ended', now() - interval '7 days', now() - interval '7 days', 'cr_karina', 'Karina Aespa', 10)
on conflict (id) do nothing;

-- Sessions
insert into public.sessions (token, user_id) values
 ('demo-token', 'u_demo'),
 ('admin-token', 'u_admin')
on conflict (token) do nothing;

-- Cards + ownership + extras (location = with_owner vs platform_stock; one listed buyout)
do $$
declare
 d record;
 i int;
 _short text;
 _uid text;
 _owner text;
 _status text;
 _loc text;
 _card_id text;
 _buyout int;
begin
 for d in select * from public.drops loop
 for i in 1..d.total_units loop
 _short := left(d.id, 4) || '-' || lpad(i::text, 3, '0');
 _uid := '04A1' || upper(substring(md5(random()::text) from 1 for 8)) || lpad(i::text, 2, '0');
 _buyout := null;
 if i <= d.sold_count then
   if i % 3 = 0 then _owner := 'u_demo';
   elsif i % 2 = 0 then _owner := 'u_admin';
   else _owner := 'cr_hype';
   end if;
   -- demo: one buyout-listed card for Marketplace
   if d.id = 'drop-aespa-2025' and i = 3 then _status := 'listed'; _loc := 'with_owner'; _buyout := 45;
   -- demo: one vault-held card for ship-from-vault
   elsif d.id = 'drop-genesis-alpha' and i = 2 then _status := 'sold'; _loc := 'platform_vault';
   else _status := 'sold'; _loc := 'with_owner';
   end if;
 else
   _owner := null; _status := 'available'; _loc := 'platform_stock';
 end if;
 _card_id := 'card-' || d.id || '-' || lpad(i::text, 2, '0');
 insert into public.cards (id, drop_id, unit_number, variant, status, owner_id, nfc_uid, nfc_short_id, verify_status, location, buyout_price_ccoin, nfc_configured, qc_status)
 values (_card_id, d.id, i, case when i <= d.signed_count then 'signed'::card_variant else 'unsigned'::card_variant end, _status::card_status, _owner, _uid, _short, 'verified'::verify_status, _loc::card_location, _buyout, true, case when _status='available' then 'pending' else 'passed' end)
 on conflict (id) do nothing;
 end loop;
 end loop;
end $$;

-- Wallet transactions
insert into public.wallet_transactions (id, user_id, type, amount_ccoin, balance_after_ccoin, ref_type, ref_id, note, created_at) values
 ('wtx-seed-1', 'u_demo', 'topup', 100, 100, 'topup', 'top-1', 'Top-up via QRIS', now() - interval '3 days'),
 ('wtx-seed-2', 'u_demo', 'topup', 50, 150, 'topup', 'top-2', 'Top-up via VA BCA', now() - interval '1 day'),
 ('wtx-seed-3', 'u_demo', 'checkout', -30, 120, 'order', 'ord-demo', 'Checkout Karina #03', now() - interval '1 hour')
on conflict (id) do nothing;

-- Orders (now with delivery_option + escrow_status + card_id; ord-demo is shipping)
insert into public.orders (id, user_id, drop_id, card_id, card_ids, total_ccoin, total_idr, status, delivery_option, shipping_fee_ccoin, escrow_status, shipping_address, tracking_number, created_at, shipped_at) values
 ('ord-demo', 'u_demo', 'drop-aespa-2025', 'card-drop-aespa-2025-03', array['card-drop-aespa-2025-03'], 30, 300000, 'shipped', 'shipping', 2, 'held', 'Jl. Demo No. 1, Jakarta Selatan', 'JNE-881200334455', now() - interval '1 hour', now() - interval '30 minutes')
on conflict (id) do nothing;

-- One vault order demo (primary vault — no shipping)
insert into public.orders (id, user_id, drop_id, card_id, card_ids, total_ccoin, total_idr, status, delivery_option, escrow_status, shipping_address, created_at) values
 ('ord-vault-demo', 'u_demo', 'drop-genesis-alpha', 'card-drop-genesis-alpha-02', array['card-drop-genesis-alpha-02'], 25, 250000, 'settled', 'vault', 'released', null, now() - interval '5 days')
on conflict (id) do nothing;

-- Ownership history (primary provenance)
insert into public.ownership_history (id, card_id, owner_id, acquired_via, order_id, transferred_at) values
 ('oh-demo-1', 'card-drop-aespa-2025-03', 'u_demo', 'primary', 'ord-demo', now() - interval '1 hour'),
 ('oh-vault-1', 'card-drop-genesis-alpha-02', 'u_demo', 'primary', 'ord-vault-demo', now() - interval '5 days')
on conflict (id) do nothing;

-- Listings kept for backwards compat (Marketplace buyout is now cards.buyout_price_ccoin)
insert into public.listings (id, card_id, seller_id, type, price_ccoin, reserve_ccoin, current_bid_ccoin, current_bidder_id, status, ends_at, created_at) values
 ('lst-001', 'card-drop-aespa-2025-03', 'u_demo', 'auction', 45, 35, 42, 'u_admin', 'bidding', now() + interval '2 days', now() - interval '1 day')
on conflict (id) do nothing;

-- Bids: direct on card + on listing (both populated for compat)
insert into public.bids (id, listing_id, card_id, bidder_id, bidder_name, amount_ccoin, status, created_at) values
 ('bid-seed-1', 'lst-001', 'card-drop-aespa-2025-03', 'u_admin', 'Admin C.Verse', 38, 'outbid', now() - interval '5 hours'),
 ('bid-seed-2', 'lst-001', 'card-drop-aespa-2025-03', 'cr_hype', 'HypeCreator', 42, 'active', now() - interval '1 hour')
on conflict (id) do nothing;

-- Shipments demo (primary shipping + vault)
insert into public.shipments (id, card_id, requester_id, type, from_location, to_dest, address, fee_ccoin, status, tracking_number, created_at) values
 ('ship-demo-1', 'card-drop-aespa-2025-03', 'u_demo', 'primary_shipping', 'platform', 'buyer_address', '{"street":"Jl. Demo No. 1, Jakarta Selatan"}', 2, 'shipped', 'JNE-881200334455', now() - interval '1 hour'),
 ('ship-vault-1', 'card-drop-genesis-alpha-02', 'u_demo', 'primary_vault', 'platform', 'platform_vault', null, null, 'delivered', null, now() - interval '5 days')
on conflict (id) do nothing;

-- User badges
insert into public.user_badges (user_id, badge_id, earned_at, awarded_at, xp_reward_snapshot) values
 ('u_demo', 'b1', now() - interval '2 days', now() - interval '2 days', 100)
on conflict (user_id, badge_id) do nothing;

-- NFC batch demo
insert into public.nfc_batches (id, batch_code, vendor, qty, status) values
 ('nfc-batch-001', 'BATCH-2026-001', 'Vendor NFC SG', 100, 'provisioned')
on conflict (id) do nothing;

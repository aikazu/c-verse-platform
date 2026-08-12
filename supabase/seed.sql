-- C.Verse — Seed (preview branches only; never merged to production per Supabase docs)
-- Matches apps/api/src/lib/store.ts ensureSeed() exactly
-- Idempotent: uses ON CONFLICT DO NOTHING

-- Users
insert into public.users (id, email, password_hash, display_name, role, xp) values
  ('u_demo', 'demo@cverse.id', 'demo123', 'Demo Kolektor', 'collector', 450),
  ('u_admin', 'admin@cverse.id', 'admin123', 'Admin C.Verse', 'admin', 0),
  ('cr_karina', 'karina@creator.id', 'x', 'Karina Aespa', 'creator', 1200),
  ('cr_hype', 'hype@creator.id', 'x', 'HypeCreator', 'creator', 900),
  ('cr_nova', 'nova@creator.id', 'x', 'Nova Studio', 'creator', 600)
on conflict (id) do nothing;

-- Wallets
insert into public.wallets (user_id, balance_ccoin, total_topup_ccoin, total_spent_ccoin) values
  ('u_demo', 120, 150, 30),
  ('u_admin', 50, 0, 0),
  ('cr_karina', 0, 0, 0),
  ('cr_hype', 50, 0, 0),
  ('cr_nova', 50, 0, 0)
on conflict (user_id) do nothing;

-- Badges
insert into public.badges (id, code, name, description, icon, xp) values
  ('b1', 'first_drop', 'First Drop', 'Beli pertama kali', '🎴', 100),
  ('b2', 'first_bid', 'First Bid', 'Bid pertama', '🔨', 50),
  ('b3', 'collector_5', 'Collector', 'Koleksi 5 kartu', '🌟', 200),
  ('b4', 'curator', 'Curator', '10 kartu kreator sama', '🎨', 300),
  ('b5', 'whale', 'Whale', 'Single bid > 100 C-Coin', '🐋', 500),
  ('b6', 'verified', 'Verified', 'KYC terverifikasi', '✅', 50)
on conflict (id) do nothing;

-- Drops
insert into public.drops (id, title, series, narrative, artwork_url, total_units, signed_count, unsigned_count, price_unsigned_ccoin, price_signed_ccoin, status, drop_at, creator_id, creator_name, sold_count) values
  ('drop-aespa-2025', 'Karina — Limited Genesis', 'HypeCreator X Aespa (2025 Limited Series)', 'Kolaborasi eksklusif Karina Aespa dengan HypeCreator. Acrylic hardcase premium + NFC TagTamper cryptographic. Hanya 15 unit di dunia.', '/textures/karina.jpg', 15, 2, 13, 30, 50, 'live', now() - interval '1 hour', 'cr_karina', 'Karina Aespa', 6),
  ('drop-genesis-alpha', 'Genesis Alpha', 'Creator X — Alpha Series', 'Genesis drop dari Creator X. Desain bold, holo foil, acrylic tebal 3mm. Koleksi pembuka C.Verse.', '/textures/genesis.jpg', 20, 2, 18, 25, 45, 'live', now() - interval '2 hours', 'cr_hype', 'HypeCreator', 12),
  ('drop-nova-01', 'Neon Bloom #01', 'Nova Studio — Neon Bloom', 'Neon Bloom mengeksplor gradien neon & organic shapes. Tiap kartu punya nomor seri & sertifikat digital.', '/textures/neon.jpg', 12, 2, 10, 20, 40, 'scheduled', now() + interval '2 days', 'cr_nova', 'Nova Studio', 0),
  ('drop-aespa-signed', 'Karina — Signed Vault', 'HypeCreator X Aespa — Signed Vault', 'Signed edition — ditandatangani kreator, insert premium, hanya 1 per 10 kartu.', '/textures/karina-signed.jpg', 10, 1, 9, 30, 55, 'ended', now() - interval '7 days', 'cr_karina', 'Karina Aespa', 10)
on conflict (id) do nothing;

-- Sessions
insert into public.sessions (token, user_id) values
  ('demo-token', 'u_demo'),
  ('admin-token', 'u_admin')
on conflict (token) do nothing;

-- Cards + wallet transactions + orders + listings + bids + user_badges
-- Keep JSON logic deterministic; use plpgsql to generate cards
do $$
declare
  d record;
  i int;
  _short text;
  _uid text;
  _owner text;
  _status text;
  _card_id text;
begin
  for d in select * from public.drops loop
    for i in 1..d.total_units loop
      _short := left(d.id, 4) || '-' || lpad(i::text, 3, '0');
      _uid := '04A1' || upper(substring(md5(random()::text) from 1 for 8)) || lpad(i::text, 2, '0');
      if i <= d.sold_count then
        if i % 3 = 0 then _owner := 'u_demo';
        elsif i % 2 = 0 then _owner := 'u_admin';
        else _owner := 'cr_hype';
        end if;
        if i = 3 and d.id = 'drop-aespa-2025' then _status := 'listed'; else _status := 'sold'; end if;
      else
        _owner := null; _status := 'available';
      end if;
      _card_id := 'card-' || d.id || '-' || lpad(i::text, 2, '0');
      insert into public.cards (id, drop_id, unit_number, variant, status, owner_id, nfc_uid, nfc_short_id, verify_status)
      values (_card_id, d.id, i, case when i <= d.signed_count then 'signed'::card_variant else 'unsigned'::card_variant end, _status::card_status, _owner, _uid, _short, 'verified'::verify_status)
      on conflict (id) do nothing;
    end loop;
  end loop;
end $$;

-- Wallet transactions (demo ledger)
insert into public.wallet_transactions (id, user_id, type, amount_ccoin, balance_after_ccoin, ref_type, ref_id, note, created_at) values
  ('wtx-seed-1', 'u_demo', 'topup', 100, 100, 'topup', 'top-1', 'Top-up via QRIS', now() - interval '3 days'),
  ('wtx-seed-2', 'u_demo', 'topup', 50, 150, 'topup', 'top-2', 'Top-up via VA BCA', now() - interval '1 day'),
  ('wtx-seed-3', 'u_demo', 'checkout', -30, 120, 'order', 'ord-demo', 'Checkout Karina #03', now() - interval '1 hour')
on conflict (id) do nothing;

-- Orders
insert into public.orders (id, user_id, drop_id, card_ids, total_ccoin, total_idr, status, shipping_address, tracking_number, created_at) values
  ('ord-demo', 'u_demo', 'drop-aespa-2025', array['card-drop-aespa-2025-03'], 30, 300000, 'shipped', 'Jl. Demo No. 1, Jakarta Selatan', 'JNE-881200334455', now() - interval '1 hour')
on conflict (id) do nothing;

-- Listings
insert into public.listings (id, card_id, seller_id, type, price_ccoin, reserve_ccoin, current_bid_ccoin, current_bidder_id, status, ends_at, created_at) values
  ('lst-001', 'card-drop-aespa-2025-03', 'u_demo', 'auction', 45, 35, 42, 'u_admin', 'bidding', now() + interval '2 days', now() - interval '1 day')
on conflict (id) do nothing;

-- Bids
insert into public.bids (id, listing_id, bidder_id, bidder_name, amount_ccoin, created_at) values
  ('bid-seed-1', 'lst-001', 'u_admin', 'Admin C.Verse', 38, now() - interval '5 hours'),
  ('bid-seed-2', 'lst-001', 'cr_hype', 'HypeCreator', 42, now() - interval '1 hour')
on conflict (id) do nothing;

-- User badges
insert into public.user_badges (user_id, badge_id, earned_at) values
  ('u_demo', 'b1', now() - interval '2 days')
on conflict (user_id, badge_id) do nothing;

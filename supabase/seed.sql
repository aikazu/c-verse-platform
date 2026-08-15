-- C.Verse — Seed (auth rework 2026-08-15) — fixed UUID ids = auth.users.id (docs/10)
-- Idempotent: ON CONFLICT DO NOTHING.
-- Akun demo dibuat di auth.users (password bcrypt) supaya login OTP/Google dev bisa dipakai.

-- ── auth.users (jalankan sebelum public.users — FK) ──
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
values
 ('00000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'demo@cverse.id', crypt('demo123', gen_salt('bf')), now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
 ('00000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@cverse.id', crypt('admin123', gen_salt('bf')), now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
 ('00000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'karina@creator.id', crypt('karina123', gen_salt('bf')), now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
 ('00000000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'hype@creator.id', crypt('hype123', gen_salt('bf')), now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
 ('00000000-0000-4000-8000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'nova@creator.id', crypt('nova123', gen_salt('bf')), now(), now(), now(), '{}'::jsonb, '{}'::jsonb)
on conflict (id) do nothing;

-- ── public.users (mirror profile; trigger on_auth_user_created menangani signup baru) ──
insert into public.users (id, email, display_name, username, role, xp, is_anonymous, total_xp, level) values
 ('00000000-0000-4000-8000-000000000001', 'demo@cverse.id', 'Demo Kolektor', 'demo_kolektor', 'user', 45, false, 45, 5),
 ('00000000-0000-4000-8000-000000000002', 'admin@cverse.id', 'Admin C.Verse', 'admin', 'admin', 0, false, 0, 1),
 ('00000000-0000-4000-8000-000000000003', 'karina@creator.id', 'Karina Aespa', 'karina_aespa', 'creator', 120, false, 120, 13),
 ('00000000-0000-4000-8000-000000000004', 'hype@creator.id', 'HypeCreator', 'hypecreator', 'creator', 90, false, 90, 10),
 ('00000000-0000-4000-8000-000000000005', 'nova@creator.id', 'Nova Studio', 'nova_studio', 'creator', 60, false, 60, 7)
on conflict (id) do nothing;



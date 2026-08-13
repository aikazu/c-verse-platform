import React, { useState, useEffect } from "react";
import { Routes, Route, NavLink, useNavigate, Link } from "react-router-dom";
import { supabase, hasSupabase } from "./lib/supabase";

function useAdminAuth(){
  const [session, setSession] = useState<any>(null);
  const [aal2, setAal2] = useState(false);
  useEffect(()=>{
    if(!hasSupabase) return;
    supabase.auth.getSession().then(({ data }: any)=> setSession(data.session ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_e: any, s: any)=> setSession(s));
    return ()=> sub.subscription.unsubscribe();
  }, []);
  useEffect(()=>{
    if(!session || !hasSupabase) { setAal2(false); return; }
    supabase.auth.mfa.getAuthenticatorAssuranceLevel().then(({ data }: any)=>{
      setAal2(data?.currentLevel === "aal2");
    }).catch(()=> setAal2(false));
  }, [session]);
  return { session, aal2, hasSupabase };
}

function LoginPage(){
  const nav = useNavigate();
  const [email,setEmail]=useState("admin@cverse.id");
  const [password,setPassword]=useState("admin123");
  const [msg,setMsg]=useState<string|null>(null);
  async function onLogin(e: React.FormEvent){
    e.preventDefault();
    if(!hasSupabase){
      setMsg("Supabase belum dikonfigurasi — isi VITE_SUPABASE_URL/ANON_KEY di .env lalu restart. Untuk demo lokal, Admin panel web (apps/web) tetap bisa dipakai.");
      return;
    }
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if(error) setMsg(error.message);
    else nav("/");
  }
  async function onEnroll(){
    if(!hasSupabase) return;
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp" });
    if(error) setMsg(error.message);
    else setMsg("TOTP enrolled — scan QR: " + (data as any)?.totp?.qr_code + " — simpan recovery codes!");
  }
  async function onChallenge(){
    if(!hasSupabase) return;
    const code = prompt("Masukkan kode TOTP dari authenticator:") ?? "";
    if(!code) return;
    const { data: factors } = await supabase.auth.mfa.listFactors();
    const factor = (factors as any)?.totp?.[0] ?? (factors as any)?.all?.[0];
    if(!factor){ setMsg("Belum ada factor TOTP — enroll dulu."); return; }
    const { data: ch } = await supabase.auth.mfa.challenge({ factorId: factor.id });
    const { error } = await supabase.auth.mfa.verify({ factorId: factor.id, challengeId: (ch as any).id, code });
    if(error) setMsg(error.message); else { setMsg("2FA OK — aal2 tercapai"); location.reload(); }
  }
  return <div className="card card-pad" style={{maxWidth:480, margin:"40px auto"}}>
    <h2 style={{fontWeight:800}}>Admin Login — 2FA TOTP wajib (ADM-09)</h2>
    <p className="muted" style={{fontSize:12, marginTop:8}}>Cloudflare Access (lapis jaringan) + Supabase MFA TOTP (lapis aplikasi). Enrollment scan QR saat pertama login, lalu challenge TOTP tiap login sebelum UI privileged terbuka (sesi aal2).</p>
    <form onSubmit={onLogin} style={{display:"flex", flexDirection:"column", gap:10, marginTop:16}}>
      <input className="input" value={email} onChange={e=> setEmail(e.target.value)} placeholder="Email" />
      <input className="input" type="password" value={password} onChange={e=> setPassword(e.target.value)} placeholder="Password" />
      <button className="btn-gold" type="submit">Login</button>
    </form>
    <div style={{display:"flex", gap:8, marginTop:12}}>
      <button className="btn-ghost" onClick={onEnroll} style={{flex:1}}>Enroll TOTP (scan QR)</button>
      <button className="btn-ghost" onClick={onChallenge} style={{flex:1}}>Challenge TOTP</button>
    </div>
    {msg && <div className="pill pill-info" style={{marginTop:12}}>{msg}</div>}
    <div className="muted" style={{fontSize:11, marginTop:12}}>Break-glass: admin lain (aal2) bisa reset enrollment yang hilang — tercatat di audit log.</div>
  </div>;
}

function Guard({ children }: { children: React.ReactNode }){
  const { session, aal2, hasSupabase } = useAdminAuth();
  if(!hasSupabase) return <div className="card card-pad" style={{maxWidth:640, margin:"32px auto"}}><h3>Supabase belum dikonfigurasi</h3><p className="muted" style={{fontSize:12}}>Isi VITE_SUPABASE_URL / ANON_KEY di apps/admin/.env untuk menjalankan admin app dengan RLS + MFA. Tanpa itu, gunakan panel ringkas di apps/web (/admin) untuk demo.</p></div>;
  if(!session) return <LoginPage />;
  if(!aal2) return <div style={{maxWidth:640, margin:"32px auto", display:"flex", flexDirection:"column", gap:12}}>
    <div className="card card-pad" style={{borderLeft:"4px solid #eab308"}}><b>2FA belum aal2</b><p className="muted" style={{fontSize:12, marginTop:8}}>Sesi saat ini aal1 — UI privileged (CRUD ADM-01..09) terkunci sampai TOTP challenge berhasil. Enroll TOTP jika belum, lalu Challenge.</p></div>
    <LoginPage />
  </div>;
  return <>{children}</>;
}

function Nav(){
  return <nav className="navbar">
    <Link to="/" className="nav-brand">C<span>.</span>Verse Admin</Link>
    <div className="nav-links">
      <NavLink to="/" className={({isActive})=> isActive?"active":""}>Dashboard</NavLink>
      <NavLink to="/creators" className={({isActive})=> isActive?"active":""}>Kreator</NavLink>
      <NavLink to="/drops" className={({isActive})=> isActive?"active":""}>Drops</NavLink>
      <NavLink to="/orders" className={({isActive})=> isActive?"active":""}>Orders</NavLink>
      <NavLink to="/nfc" className={({isActive})=> isActive?"active":""}>NFC</NavLink>
      <NavLink to="/payouts" className={({isActive})=> isActive?"active":""}>Payouts</NavLink>
      <NavLink to="/badges" className={({isActive})=> isActive?"active":""}>Badges</NavLink>
      <NavLink to="/disputes" className={({isActive})=> isActive?"active":""}>Disputes</NavLink>
      <NavLink to="/audit" className={({isActive})=> isActive?"active":""}>Audit Log</NavLink>
    </div>
    <div className="nav-actions">
      <button className="btn-ghost" onClick={async()=>{ if(hasSupabase) await supabase.auth.signOut(); location.href="/"; }}>Keluar</button>
    </div>
  </nav>;
}

function Placeholder({ title, hint }: { title: string; hint: string }){
  return <div className="card card-pad"><h2 style={{fontWeight:800}}>{title}</h2><p className="muted" style={{fontSize:12, marginTop:8}}>{hint}</p></div>;
}

function Dashboard(){
  return <div style={{display:"flex", flexDirection:"column", gap:12}}>
    <div className="card card-pad"><span className="eyebrow">ADM-01..06</span><h2 className="h2" style={{marginTop:6}}>Admin Dashboard</h2><p className="muted" style={{fontSize:12, marginTop:6}}>Ringkasan: drop aktif, order, escrow, payout due. Semua mutasi via service function terpusat - log otomatis ke admin_audit_log (append-only, retensi 1 tahun).</p></div>
    <div className="grid-3">
      <div className="card card-pad"><div style={{fontSize:11, color:"var(--dim)", fontWeight:700}}>DROPS</div><div style={{fontWeight:700, marginTop:4}}>Kelola di /drops</div><div className="muted" style={{fontSize:11, marginTop:4}}>Buat drop: artwork final (approve off-platform), harga C-Coin, unit, signed=ceil/10, schedule & publish (H-7).</div></div>
      <div className="card card-pad"><div style={{fontSize:11, color:"var(--dim)", fontWeight:700}}>ORDERS</div><div style={{fontWeight:700, marginTop:4}}>Kelola di /orders</div><div className="muted" style={{fontSize:11, marginTop:4}}>Update PAID-QC-SHIPPED-DELIVERED-SETTLED (vault tanpa shipped). Input no resi.</div></div>
      <div className="card card-pad"><div style={{fontSize:11, color:"var(--dim)", fontWeight:700}}>PAYOUTS</div><div style={{fontSize:11, color:"var(--muted)", marginTop:4}}>ADM-05 - escrow/settlement, trigger payout batch H+1 Selasa, fee 1%, withholding, rekonsiliasi harian top-up vs ledger vs float.</div></div>
    </div>
  </div>;
}

export default function App(){
  return <div className="app-shell">
    <Nav />
    <main className="main-content">
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={<Guard><Dashboard /></Guard>} />
        <Route path="/creators" element={<Guard><Placeholder title="Kelola Kreator (ADM-01)" hint="CRUD data kreator hasil rekrutan off-platform (bukan approval) - threshold 100rb+ combined - status akun & payment info. Data lewat Supabase service-role (bypass RLS)." /></Guard>} />
        <Route path="/drops" element={<Guard><Placeholder title="Kelola Drop (ADM-02)" hint="Buat drop (artwork, harga C-Coin, unit, signed_count, waktu), schedule, publish, tutup drop." /></Guard>} />
        <Route path="/orders" element={<Guard><Placeholder title="Kelola Order / Fulfillment (ADM-03)" hint="Semua order - update status (paid - QC - shipped - delivered), handle return, input no resi." /></Guard>} />
        <Route path="/nfc" element={<Guard><Placeholder title="NFC Provisioning & QC (ADM-04)" hint="Register batch tag (assign UUID - UID), konfigurasi NDEF/SDM, catat hasil QC + defect." /></Guard>} />
        <Route path="/payouts" element={<Guard><Placeholder title="Payout & Rekonsiliasi (ADM-05)" hint="Escrow/settlement, trigger payout batch, rekonsiliasi harian top-up vs ledger." /></Guard>} />
        <Route path="/disputes" element={<Guard><Placeholder title="Dispute Resolution (ADM-06)" hint="Lihat dispute, mediasi, keputusan (refund / strike / suspend)." /></Guard>} />
        <Route path="/badges" element={<Guard><Placeholder title="Kelola Badge - Definisi (ADM-07)" hint="CRUD definisi badge: kriteria + logo/ikon + XP reward (experience, bukan masa berlaku). Evaluasi berkala atau event-driven saat transaksi." /></Guard>} />
        <Route path="/audit" element={<Guard><Placeholder title="Audit Log Admin (ADM-08)" hint="Semua aksi admin (siapa, aksi, target, payload ringkas, IP/session, waktu) - append-only, tidak bisa edit/hapus. Filter via /audit. Retensi minimal 1 tahun." /></Guard>} />
      </Routes>
    </main>
    <footer style={{textAlign:"center",padding:"18px 24px",fontSize:11,color:"var(--dim)",borderTop:"1px solid var(--border)", marginTop:40}}>C.Verse Admin - Lokal / VPS + Cloudflare Access (Zero Trust) - TIDAK di Pages publik - 2FA TOTP wajib (aal2) + audit log append-only</footer>
  </div>;
}

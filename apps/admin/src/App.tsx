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
  if(!hasSupabase) return <div className="card card-pad" style={{maxWidth:640, margin:"32px auto"}}><h3>Supabase belum dikonfigurasi</h3><p className="muted" style={{fontSize:12}}>Isi VITE_SUPABASE_URL / ANON_KEY di apps/admin/.env untuk menjalankan admin app dengan RLS + MFA. Tanpa itu, gunakan panel ringkas di apps/web (/admin) untuk demo. Di bawah tetap tampil data demo via API publik.</p><p className="muted" style={{fontSize:12, marginTop:8}}>Semua panel ADM-01..09 tetap dirender dalam mode demo (read via public API, write limited).</p></div>;
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

async function auditInsert(action:string, targetTable:string, targetId:string|null, payload:any){
  if(!hasSupabase) return;
  try{ await supabase.from("admin_audit_log").insert({ id: `audit-${Date.now()}`, admin_user_id: (await supabase.auth.getUser()).data.user?.id ?? "unknown", action, target_table: targetTable, target_id: targetId, payload_summary: payload, created_at: new Date().toISOString() }); } catch{}
}

// ── ADM-01 Creators ──
function CreatorsPage(){
  const [rows,setRows]=useState<any[]>([]);
  const [loading,setLoading]=useState(true);
  const [form,setForm]=useState({ handle:"", followers:"", notes:"", bank:"BCA", acc:"", holder:"" });
  const [msg,setMsg]=useState<string|null>(null);
  async function load(){
    setLoading(true);
    if(hasSupabase){
      const { data } = await supabase.from("creators").select("*").order("created_at",{ascending:false});
      setRows(data ?? []);
    } else {
      try{ const r=await fetch("http://localhost:8787/api/creators"); const j=await r.json(); setRows(j.creators ?? []); } catch{ setRows([]); }
    }
    setLoading(false);
  }
  useEffect(()=>{ load(); },[]);
  async function onCreate(e:React.FormEvent){
    e.preventDefault();
    if(!hasSupabase){ setMsg("Mode demo: create creator via public API belum tersedia — pakai Supabase untuk write."); return; }
    const id = `cr-${Date.now().toString(36)}`;
    const { error } = await supabase.from("creators").insert({ id, handle: form.handle, total_followers_combined: Number(form.followers)||0, status:"active", bank_account: { bank:form.bank, account_no:form.acc, holder:form.holder }, notes: form.notes });
    if(error) setMsg(error.message); else { await auditInsert("create","creators",id,{handle:form.handle}); setMsg("Kreator dibuat"); setForm({handle:"",followers:"",notes:"",bank:"BCA",acc:"",holder:""}); load(); }
  }
  return <div style={{display:"flex",flexDirection:"column",gap:14}}>
    <div className="card card-pad"><span className="eyebrow">ADM-01</span><h2 className="h2" style={{marginTop:6}}>Kelola Kreator</h2><p className="muted" style={{fontSize:12,marginTop:6}}>CRUD data kreator hasil rekrutan off-platform (bukan approval). Threshold 100rb+ combined — status & payment info. Data via service-role bypass RLS.</p></div>
    <form onSubmit={onCreate} className="card card-pad" style={{display:"flex",flexDirection:"column",gap:8}}>
      <div style={{fontWeight:700,fontSize:13}}>Tambah Kreator (off-platform rekrut)</div>
      <div style={{display:"flex",gap:8}}><input className="input" placeholder="handle (IG/TikTok)" value={form.handle} onChange={e=>setForm(s=>({...s,handle:e.target.value}))} required style={{flex:1}} /><input className="input" placeholder="followers combined" type="number" value={form.followers} onChange={e=>setForm(s=>({...s,followers:e.target.value}))} style={{width:160}} /></div>
      <div style={{display:"flex",gap:8}}><input className="input" placeholder="Bank" value={form.bank} onChange={e=>setForm(s=>({...s,bank:e.target.value}))} style={{width:120}} /><input className="input" placeholder="No rek" value={form.acc} onChange={e=>setForm(s=>({...s,acc:e.target.value}))} style={{flex:1}} /><input className="input" placeholder="Holder" value={form.holder} onChange={e=>setForm(s=>({...s,holder:e.target.value}))} style={{flex:1}} /></div>
      <input className="input" placeholder="Notes (riwayat kontak off-platform)" value={form.notes} onChange={e=>setForm(s=>({...s,notes:e.target.value}))} />
      <button className="btn-gold">Tambah Kreator</button>
      {msg && <div className="pill pill-info">{msg}</div>}
    </form>
    <div className="card"><div style={{padding:"12px 14px",fontWeight:700,borderBottom:"1px solid var(--border)"}}>Daftar Kreator ({rows.length})</div>
      {loading? <div style={{padding:14}} className="muted">Memuat...</div> :
      <div className="table-wrap"><table><thead><tr><th>Handle</th><th>Followers</th><th>Status</th><th>Bank</th><th>Notes</th></tr></thead><tbody>{rows.map((r:any)=><tr key={r.id}><td style={{fontWeight:700}}>{r.handle ?? r.displayName ?? r.id}</td><td>{r.totalFollowersCombined ?? r.total_followers_combined ?? "-"}</td><td><span className="pill pill-info">{r.status ?? r.role ?? "-"}</span></td><td style={{fontSize:11}}>{r.bank_account? JSON.stringify(r.bank_account): r.bankAccount? JSON.stringify(r.bankAccount): "-"}</td><td style={{fontSize:11}}>{r.notes ?? "-"}</td></tr>)}</tbody></table></div>}
    </div>
  </div>;
}

// ── ADM-02 Drops ──
function DropsPage(){
  const [rows,setRows]=useState<any[]>([]);
  const [loading,setLoading]=useState(true);
  const [form,setForm]=useState({ title:"", series:"", narrative:"", artworkUrl:"", totalUnits:15, priceCcoin:30, dropStartAt:"" });
  const [msg,setMsg]=useState<string|null>(null);
  async function load(){
    setLoading(true);
    if(hasSupabase){
      const { data } = await supabase.from("drops").select("*").order("created_at",{ascending:false});
      setRows(data ?? []);
    } else {
      try{ const r=await fetch("http://localhost:8787/api/drops"); const j=await r.json(); setRows(j.drops ?? []); } catch{ setRows([]);}
    }
    setLoading(false);
  }
  useEffect(()=>{ load(); },[]);
  async function onCreate(e:React.FormEvent){
    e.preventDefault();
    if(!hasSupabase){ setMsg("Mode demo: pakai creator flow di apps/web /creator untuk buat drop — admin Supabase untuk publish."); return;}
    const id = `drop-${Date.now().toString(36)}`;
    const signedCount = Math.ceil(Number(form.totalUnits)/10);
    const { error } = await supabase.from("drops").insert({ id, title: form.title, series: form.series, narrative: form.narrative, artwork_url: form.artworkUrl || "/textures/genesis.jpg", total_units: Number(form.totalUnits), signed_count: signedCount, unsigned_count: Number(form.totalUnits)-signedCount, price_unsigned_ccoin: Number(form.priceCcoin), price_signed_ccoin: Math.ceil(Number(form.priceCcoin)*1.6), price_ccoin: Number(form.priceCcoin), status:"draft", drop_start_at: form.dropStartAt || null, creator_id: (await supabase.auth.getUser()).data.user?.id ?? null, creator_name: "Admin", sold_count:0 });
    if(error) setMsg(error.message); else { await auditInsert("create","drops",id,{title:form.title}); setMsg("Drop draft dibuat"); setForm({title:"",series:"",narrative:"",artworkUrl:"",totalUnits:15,priceCcoin:30,dropStartAt:""}); load(); }
  }
  async function setStatus(id:string, status:string){
    if(!hasSupabase){ setMsg("Mode demo: status change butuh Supabase."); return; }
    const { error } = await supabase.from("drops").update({ status }).eq("id",id);
    if(error) setMsg(error.message); else { await auditInsert("update","drops",id,{status}); load(); }
  }
  return <div style={{display:"flex",flexDirection:"column",gap:14}}>
    <div className="card card-pad"><span className="eyebrow">ADM-02</span><h2 className="h2" style={{marginTop:6}}>Kelola Drop</h2><p className="muted" style={{fontSize:12,marginTop:6}}>Buat drop (artwork final approve off-platform, harga C-Coin integer, unit, signed=ceil/10, waktu) — schedule, publish, tutup.</p></div>
    <form onSubmit={onCreate} className="card card-pad" style={{display:"flex",flexDirection:"column",gap:8}}>
      <div style={{fontWeight:700,fontSize:13}}>Buat Drop Draft</div>
      <input className="input" placeholder="Judul" value={form.title} onChange={e=>setForm(s=>({...s,title:e.target.value}))} required />
      <input className="input" placeholder="Series" value={form.series} onChange={e=>setForm(s=>({...s,series:e.target.value}))} required />
      <textarea className="input" placeholder="Narrative (10-5000 char)" value={form.narrative} onChange={e=>setForm(s=>({...s,narrative:e.target.value}))} required rows={2} />
      <div style={{display:"flex",gap:8}}><input className="input" placeholder="Artwork URL" value={form.artworkUrl} onChange={e=>setForm(s=>({...s,artworkUrl:e.target.value}))} style={{flex:1}} /><input className="input" type="number" min={1} max={1000} value={form.totalUnits} onChange={e=>setForm(s=>({...s,totalUnits:Number(e.target.value)}))} style={{width:120}} /><input className="input" type="number" min={1} value={form.priceCcoin} onChange={e=>setForm(s=>({...s,priceCcoin:Number(e.target.value)}))} style={{width:120}} /></div>
      <input className="input" type="datetime-local" value={form.dropStartAt} onChange={e=>setForm(s=>({...s,dropStartAt:e.target.value}))} />
      <button className="btn-gold">Buat Draft</button>
      {msg && <div className="pill pill-info">{msg}</div>}
    </form>
    <div className="card"><div style={{padding:"12px 14px",fontWeight:700,borderBottom:"1px solid var(--border)"}}>Drops ({rows.length})</div>
      {loading? <div style={{padding:14}} className="muted">Memuat...</div> :
      <div className="table-wrap"><table><thead><tr><th>Title</th><th>Status</th><th>Unit</th><th>Harga</th><th>Aksi</th></tr></thead><tbody>{rows.map((r:any)=><tr key={r.id}><td style={{fontWeight:700,fontSize:12}}>{r.title}</td><td><span className="pill pill-info">{r.status}</span></td><td>{r.sold_count ?? r.soldCount ?? 0}/{r.total_units ?? r.totalUnits}</td><td>{r.price_ccoin ?? r.priceCcoin ?? r.price_unsigned_ccoin} C</td><td style={{display:"flex",gap:4}}><button className="btn-ghost" style={{padding:"4px 8px",fontSize:11}} onClick={()=>setStatus(r.id,"published")}>Publish</button><button className="btn-ghost" style={{padding:"4px 8px",fontSize:11}} onClick={()=>setStatus(r.id,"live")}>Live</button><button className="btn-ghost" style={{padding:"4px 8px",fontSize:11}} onClick={()=>setStatus(r.id,"closed")}>Close</button></td></tr>)}</tbody></table></div>}
    </div>
  </div>;
}

// ── ADM-03 Orders ──
function OrdersPage(){
  const [rows,setRows]=useState<any[]>([]);
  const [loading,setLoading]=useState(true);
  const [msg,setMsg]=useState<string|null>(null);
  async function load(){
    setLoading(true);
    if(hasSupabase){
      const { data } = await supabase.from("orders").select("*").order("created_at",{ascending:false}).limit(100);
      setRows(data ?? []);
    } else {
      setRows([]);
      setMsg("Mode demo: orders via API butuh auth token — buka /orders di apps/web untuk demo checkout.");
    }
    setLoading(false);
  }
  useEffect(()=>{ load(); },[]);
  async function updateStatus(id:string, status:string, tracking?:string){
    if(!hasSupabase){ setMsg("Butuh Supabase untuk update status."); return; }
    const patch:any={ status }; if(tracking) patch.tracking_number=tracking;
    const { error } = await supabase.from("orders").update(patch).eq("id",id);
    if(error) setMsg(error.message); else { await auditInsert("update","orders",id,{status}); load(); }
  }
  return <div style={{display:"flex",flexDirection:"column",gap:14}}>
    <div className="card card-pad"><span className="eyebrow">ADM-03</span><h2 className="h2" style={{marginTop:6}}>Kelola Order & Fulfillment</h2><p className="muted" style={{fontSize:12,marginTop:6}}>Semua order — update status PAID→QC→SHIPPED→DELIVERED→SETTLED (vault tanpa shipped). Input no resi.</p></div>
    {msg && <div className="pill pill-info">{msg}</div>}
    <div className="card"><div style={{padding:"12px 14px",fontWeight:700,borderBottom:"1px solid var(--border)"}}>Orders ({rows.length}) — 100 terbaru</div>
      {loading? <div style={{padding:14}} className="muted">Memuat...</div> :
      rows.length===0? <div style={{padding:14}} className="muted">Belum ada order (atau Supabase belum connect).</div> :
      <div className="table-wrap"><table><thead><tr><th>ID</th><th>Status</th><th>Opsi</th><th>Tracking</th><th>Aksi</th></tr></thead><tbody>{rows.map((r:any)=><tr key={r.id}><td style={{fontFamily:"monospace",fontSize:11}}>{r.id.slice(0,10)}</td><td><span className="pill pill-info">{r.status}</span></td><td>{r.delivery_option ?? "-"}</td><td style={{fontSize:11}}>{r.tracking_number ?? "-"}</td><td style={{display:"flex",gap:4}}><button className="btn-ghost" style={{padding:"4px 8px",fontSize:11}} onClick={()=>updateStatus(r.id,"qc")}>QC</button><button className="btn-ghost" style={{padding:"4px 8px",fontSize:11}} onClick={()=>{ const t=prompt("No resi:"); if(t) updateStatus(r.id,"shipped",t); else updateStatus(r.id,"shipped"); }}>Shipped</button><button className="btn-ghost" style={{padding:"4px 8px",fontSize:11}} onClick={()=>updateStatus(r.id,"delivered")}>Delivered</button><button className="btn-gold" style={{padding:"4px 8px",fontSize:11}} onClick={()=>updateStatus(r.id,"settled")}>Settled</button></td></tr>)}</tbody></table></div>}
    </div>
  </div>;
}

// ── ADM-04 NFC ──
function NfcPage(){
  const [batches,setBatches]=useState<any[]>([]);
  const [cards,setCards]=useState<any[]>([]);
  const [msg,setMsg]=useState<string|null>(null);
  async function load(){
    if(hasSupabase){
      const { data: b } = await supabase.from("nfc_batches").select("*").order("created_at",{ascending:false});
      setBatches(b ?? []);
      const { data: c } = await supabase.from("cards").select("id,nfc_uid,nfc_short_id,verify_status,nfc_configured,qc_status,drop_id").limit(50);
      setCards(c ?? []);
    } else {
      try{ const r=await fetch("http://localhost:8787/api/nfc/cards/demo"); setCards([]); setBatches([]); } catch{}
      setMsg("Mode demo: NFC provisioning = desktop tool terpisah (TapLinx + REST service-role). Tabel nfc_batches & cards via Supabase.");
    }
  }
  useEffect(()=>{ load(); },[]);
  async function createBatch(){
    const code = `BATCH-${Date.now().toString(36).toUpperCase()}`;
    if(!hasSupabase){ setMsg("Butuh Supabase untuk create batch."); return; }
    const qty = Number(prompt("Qty batch (int):","50") ?? "50");
    const { error } = await supabase.from("nfc_batches").insert({ id: `nfc-${Date.now().toString(36)}`, batch_code: code, qty, status:"received" });
    if(error) setMsg(error.message); else { await auditInsert("create","nfc_batches",code,{qty}); load(); }
  }
  return <div style={{display:"flex",flexDirection:"column",gap:14}}>
    <div className="card card-pad"><span className="eyebrow">ADM-04</span><h2 className="h2" style={{marginTop:6}}>NFC Provisioning & QC</h2><p className="muted" style={{fontSize:12,marginTop:6}}>Register batch tag (assign UUID↔UID), konfigurasi NDEF/SDM, catat hasil QC + defect. Tool desktop terpisah tulis NDEF URL https://c-verse.co/cards/{`{short_id}`}/3d + SUN.</p></div>
    {msg && <div className="pill pill-info">{msg}</div>}
    <div style={{display:"flex",gap:8}}><button className="btn-gold" onClick={createBatch}>+ Buat Batch Baru</button><button className="btn-ghost" onClick={load}>Refresh</button></div>
    <div className="grid-2">
      <div className="card"><div style={{padding:"12px 14px",fontWeight:700,borderBottom:"1px solid var(--border)"}}>Batches ({batches.length})</div><div className="table-wrap"><table><thead><tr><th>Batch</th><th>Qty</th><th>Status</th></tr></thead><tbody>{batches.length===0? <tr><td colSpan={3} style={{textAlign:"center",padding:14}} className="muted">Belum ada batch.</td></tr> : batches.map((b:any)=><tr key={b.id}><td style={{fontFamily:"monospace",fontSize:11}}>{b.batch_code}</td><td>{b.qty}</td><td><span className="pill pill-info">{b.status}</span></td></tr>)}</tbody></table></div></div>
      <div className="card"><div style={{padding:"12px 14px",fontWeight:700,borderBottom:"1px solid var(--border)"}}>Cards QC sample (50)</div><div className="table-wrap"><table><thead><tr><th>ShortID</th><th>UID</th><th>QC</th><th>Configured</th></tr></thead><tbody>{cards.length===0? <tr><td colSpan={4} style={{textAlign:"center",padding:14}} className="muted">Belum ada data (Supabase required).</td></tr> : cards.map((c:any)=><tr key={c.id}><td style={{fontFamily:"monospace",fontSize:11}}>{c.nfc_short_id ?? c.nfcShortId}</td><td style={{fontFamily:"monospace",fontSize:11}}>{(c.nfc_uid ?? c.nfcUid ?? "").slice(0,12)}</td><td><span className="pill pill-info">{c.qc_status ?? c.qcStatus ?? "-"}</span></td><td>{String(c.nfc_configured ?? c.nfcConfigured)}</td></tr>)}</tbody></table></div></div>
    </div>
  </div>;
}

// ── ADM-05 Payouts ──
function PayoutsPage(){
  const [batches,setBatches]=useState<any[]>([]);
  const [msg,setMsg]=useState<string|null>(null);
  async function load(){
    if(!hasSupabase){ setMsg("Mode demo: payout via wallet API /payout — admin batch via Supabase payout_batches."); return; }
    const { data } = await supabase.from("payout_batches").select("*").order("created_at",{ascending:false});
    setBatches(data ?? []);
  }
  useEffect(()=>{ load(); },[]);
  async function triggerBatch(){
    if(!hasSupabase) return;
    const id = `payout-${Date.now().toString(36)}`;
    const { error } = await supabase.from("payout_batches").insert({ id, batch_code: `BATCH-${Date.now().toString(36).toUpperCase()}`, status:"draft", total_ccoin:0, total_idr:0, fee_1pct_idr:0 });
    if(error) setMsg(error.message); else { await auditInsert("payout_trigger","payout_batches",id,{}); load(); }
  }
  return <div style={{display:"flex",flexDirection:"column",gap:14}}>
    <div className="card card-pad"><span className="eyebrow">ADM-05</span><h2 className="h2" style={{marginTop:6}}>Payout & Rekonsiliasi</h2><p className="muted" style={{fontSize:12,marginTop:6}}>Escrow/settlement, trigger payout batch H+1 Selasa, fee 1%, withholding PPh23+PPN11, rekonsiliasi harian top-up vs ledger vs float (docs 03 Flow 3 + 08).</p></div>
    {msg && <div className="pill pill-info">{msg}</div>}
    <div style={{display:"flex",gap:8}}><button className="btn-gold" onClick={triggerBatch}>Trigger Payout Batch (draft)</button><button className="btn-ghost" onClick={load}>Refresh</button></div>
    <div className="card"><div style={{padding:"12px 14px",fontWeight:700,borderBottom:"1px solid var(--border)"}}>Payout Batches ({batches.length})</div><div className="table-wrap"><table><thead><tr><th>Batch</th><th>Status</th><th>Total C</th><th>Total IDR</th></tr></thead><tbody>{batches.length===0? <tr><td colSpan={4} style={{textAlign:"center",padding:14}} className="muted">Belum ada batch.</td></tr> : batches.map((b:any)=><tr key={b.id}><td style={{fontFamily:"monospace",fontSize:11}}>{b.batch_code}</td><td><span className="pill pill-info">{b.status}</span></td><td>{b.total_ccoin}</td><td>{b.total_idr}</td></tr>)}</tbody></table></div></div>
    <div className="card card-pad"><div style={{fontWeight:700,marginBottom:6}}>Rekonsiliasi Harian (ADM-05)</div><p className="muted" style={{fontSize:12}}>Cron harian cocokkan top-up webhook vs wallet_transactions vs float Midtrans/Xendit. Alert jika drift &gt;0.5%.</p><div style={{fontSize:11,color:"var(--dim)",marginTop:8}}>Min payout 10 C-Coin (Rp 100rb) — saldo menumpuk sampai threshold. Fee 1% fixed.</div></div>
  </div>;
}

// ── ADM-06 Disputes ──
function DisputesPage(){
  const [rows,setRows]=useState<any[]>([]);
  const [msg,setMsg]=useState<string|null>(null);
  async function load(){
    if(!hasSupabase){ setMsg("Mode demo: disputes via contacts manual — table disputes via Supabase."); return; }
    const { data } = await supabase.from("disputes").select("*").order("created_at",{ascending:false});
    setRows(data ?? []);
  }
  useEffect(()=>{ load(); },[]);
  async function decide(id:string, status:string){
    if(!hasSupabase) return;
    const { error } = await supabase.from("disputes").update({ status }).eq("id",id);
    if(error) setMsg(error.message); else { await auditInsert("update","disputes",id,{status}); load(); }
  }
  return <div style={{display:"flex",flexDirection:"column",gap:14}}>
    <div className="card card-pad"><span className="eyebrow">ADM-06</span><h2 className="h2" style={{marginTop:6}}>Dispute Resolution</h2><p className="muted" style={{fontSize:12,marginTop:6}}>Lihat dispute, mediasi, keputusan (refund / strike / suspend). Y1 manual via email/WA + status di admin.</p></div>
    {msg && <div className="pill pill-info">{msg}</div>}
    <div className="card"><div style={{padding:"12px 14px",fontWeight:700,borderBottom:"1px solid var(--border)"}}>Disputes ({rows.length})</div><div className="table-wrap"><table><thead><tr><th>ID</th><th>Reason</th><th>Status</th><th>Aksi</th></tr></thead><tbody>{rows.length===0? <tr><td colSpan={4} style={{textAlign:"center",padding:14}} className="muted">Belum ada dispute.</td></tr> : rows.map((r:any)=><tr key={r.id}><td style={{fontFamily:"monospace",fontSize:11}}>{r.id.slice(0,10)}</td><td style={{fontSize:12}}>{r.reason}</td><td><span className="pill pill-info">{r.status}</span></td><td style={{display:"flex",gap:4}}><button className="btn-ghost" style={{padding:"4px 8px",fontSize:11}} onClick={()=>decide(r.id,"resolved_refund")}>Refund</button><button className="btn-ghost" style={{padding:"4px 8px",fontSize:11}} onClick={()=>decide(r.id,"resolved_strike")}>Strike</button><button className="btn-ghost" style={{padding:"4px 8px",fontSize:11}} onClick={()=>decide(r.id,"resolved_suspend")}>Suspend</button></td></tr>)}</tbody></table></div></div>
  </div>;
}

// ── ADM-07 Badges ──
function BadgesPage(){
  const [rows,setRows]=useState<any[]>([]);
  const [form,setForm]=useState({ code:"", name:"", description:"", icon:"", xp_reward:0, criteria:'{"type":"collect_count","min":5}' });
  const [msg,setMsg]=useState<string|null>(null);
  async function load(){
    if(hasSupabase){
      const { data } = await supabase.from("badges").select("*").order("created_at",{ascending:false});
      setRows(data ?? []);
    } else {
      try{ const r=await fetch("http://localhost:8787/api/gamification/badges"); const j=await r.json(); setRows(j.badges ?? []);} catch{ setRows([]);}
    }
  }
  useEffect(()=>{ load(); },[]);
  async function onCreate(e:React.FormEvent){
    e.preventDefault();
    let criteria:any; try{ criteria=JSON.parse(form.criteria);} catch{ setMsg("Criteria harus JSON valid"); return; }
    if(!hasSupabase){ setMsg("Mode demo: badge create via Supabase — demo read-only via API."); return; }
    const id = `b-${Date.now().toString(36)}`;
    const { error } = await supabase.from("badges").insert({ id, code: form.code, name: form.name, description: form.description, icon: form.icon, icon_url: form.icon, xp: Number(form.xp_reward), xp_reward: Number(form.xp_reward), criteria, is_active:true });
    if(error) setMsg(error.message); else { await auditInsert("create","badges",id,{code:form.code}); setMsg("Badge dibuat"); setForm({code:"",name:"",description:"",icon:"",xp_reward:0,criteria:'{"type":"collect_count","min":5}'}); load(); }
  }
  return <div style={{display:"flex",flexDirection:"column",gap:14}}>
    <div className="card card-pad"><span className="eyebrow">ADM-07</span><h2 className="h2" style={{marginTop:6}}>Kelola Badge — Definisi</h2><p className="muted" style={{fontSize:12,marginTop:6}}>CRUD definisi badge: kriteria + logo/ikon + XP reward (experience untuk naik level, bukan masa berlaku). Evaluasi event-driven saat transaksi/level-up.</p></div>
    <form onSubmit={onCreate} className="card card-pad" style={{display:"flex",flexDirection:"column",gap:8}}>
      <div style={{fontWeight:700,fontSize:13}}>Tambah Badge</div>
      <div style={{display:"flex",gap:8}}><input className="input" placeholder="code (unique)" value={form.code} onChange={e=>setForm(s=>({...s,code:e.target.value}))} required style={{flex:1}} /><input className="input" placeholder="nama" value={form.name} onChange={e=>setForm(s=>({...s,name:e.target.value}))} required style={{flex:1}} /><input className="input" placeholder="ikon (emoji/url)" value={form.icon} onChange={e=>setForm(s=>({...s,icon:e.target.value}))} style={{width:140}} /><input className="input" type="number" min={0} placeholder="XP reward" value={form.xp_reward} onChange={e=>setForm(s=>({...s,xp_reward:Number(e.target.value)}))} style={{width:120}} /></div>
      <input className="input" placeholder="description" value={form.description} onChange={e=>setForm(s=>({...s,description:e.target.value}))} />
      <input className="input" placeholder='criteria JSON e.g. {"type":"collect_count","min":5}' value={form.criteria} onChange={e=>setForm(s=>({...s,criteria:e.target.value}))} style={{fontFamily:"monospace",fontSize:12}} />
      <button className="btn-gold">Tambah Badge</button>
      {msg && <div className="pill pill-info">{msg}</div>}
    </form>
    <div className="card"><div style={{padding:"12px 14px",fontWeight:700,borderBottom:"1px solid var(--border)"}}>Badges ({rows.length})</div><div className="table-wrap"><table><thead><tr><th>Code</th><th>Nama</th><th>XP</th><th>Criteria</th><th>Active</th></tr></thead><tbody>{rows.map((r:any)=><tr key={r.id}><td style={{fontWeight:700,fontFamily:"monospace",fontSize:11}}>{r.code}</td><td>{r.name}</td><td>{r.xp_reward ?? r.xp ?? 0}</td><td style={{fontFamily:"monospace",fontSize:11, maxWidth:200, overflow:"hidden", textOverflow:"ellipsis"}}>{typeof r.criteria==="string"? r.criteria : JSON.stringify(r.criteria)}</td><td>{String(r.is_active ?? r.isActive ?? true)}</td></tr>)}</tbody></table></div></div>
  </div>;
}

// ── ADM-08 Audit Log ──
function AuditPage(){
  const [rows,setRows]=useState<any[]>([]);
  const [filter,setFilter]=useState("");
  async function load(){
    if(!hasSupabase){ setRows([]); return; }
    let q = supabase.from("admin_audit_log").select("*").order("created_at",{ascending:false}).limit(100);
    if(filter) q = q.ilike("action",`%${filter}%`);
    const { data } = await q;
    setRows(data ?? []);
  }
  useEffect(()=>{ load(); },[]);
  return <div style={{display:"flex",flexDirection:"column",gap:14}}>
    <div className="card card-pad"><span className="eyebrow">ADM-08</span><h2 className="h2" style={{marginTop:6}}>Audit Log Admin</h2><p className="muted" style={{fontSize:12,marginTop:6}}>Semua aksi admin (siapa, aksi, target, payload ringkas, IP/session, waktu) — append-only, tidak bisa edit/hapus. Retensi minimal 1 tahun.</p></div>
    <div style={{display:"flex",gap:8}}><input className="input" placeholder="Filter action (create/update/delete/login/payout_trigger...)" value={filter} onChange={e=>setFilter(e.target.value)} style={{flex:1}} /><button className="btn-ghost" onClick={load}>Filter</button></div>
    <div className="card"><div style={{padding:"12px 14px",fontWeight:700,borderBottom:"1px solid var(--border)"}}>Audit Log — 100 terbaru (append-only)</div><div className="table-wrap"><table><thead><tr><th>Waktu</th><th>Admin</th><th>Aksi</th><th>Target</th><th>Payload</th></tr></thead><tbody>{rows.length===0? <tr><td colSpan={5} style={{textAlign:"center",padding:14}} className="muted">{hasSupabase? "Belum ada log (atau belum ada aksi).":"Supabase belum connect — audit via admin_audit_log (Supabase) + store.auditLog (API in-memory)."} </td></tr> : rows.map((r:any)=><tr key={r.id}><td style={{fontSize:11,color:"var(--muted)"}}>{new Date(r.created_at ?? r.createdAt).toLocaleString("id-ID")}</td><td style={{fontFamily:"monospace",fontSize:11}}>{(r.admin_user_id ?? r.adminUserId ?? "").slice(0,10)}</td><td><span className="pill pill-info">{r.action}</span></td><td style={{fontSize:11}}>{r.target_table ?? r.targetTable}{r.target_id? ":"+String(r.target_id).slice(0,8):""}</td><td style={{fontFamily:"monospace",fontSize:11, maxWidth:200, overflow:"hidden", textOverflow:"ellipsis"}}>{r.payload_summary? JSON.stringify(r.payload_summary): r.payloadSummary? JSON.stringify(r.payloadSummary): "-"}</td></tr>)}</tbody></table></div></div>
  </div>;
}

function Dashboard(){
  return <div style={{display:"flex", flexDirection:"column", gap:12}}>
    <div className="card card-pad"><span className="eyebrow">ADM-01..09</span><h2 className="h2" style={{marginTop:6}}>Admin Dashboard</h2><p className="muted" style={{fontSize:12, marginTop:6}}>Ringkasan: drop aktif, order, escrow, payout due. Semua mutasi via service function terpusat — log otomatis ke admin_audit_log (append-only, retensi 1 tahun). 2FA aal2 guard aktif.</p></div>
    <div className="grid-3">
      <div className="card card-pad"><div style={{fontSize:11, color:"var(--dim)", fontWeight:700}}>DROPS</div><div style={{fontWeight:700, marginTop:4}}>Kelola di /drops</div><div className="muted" style={{fontSize:11, marginTop:4}}>Buat drop: artwork final (approve off-platform), harga C-Coin, unit, signed=ceil/10, schedule & publish (H-7).</div></div>
      <div className="card card-pad"><div style={{fontSize:11, color:"var(--dim)", fontWeight:700}}>ORDERS</div><div style={{fontWeight:700, marginTop:4}}>Kelola di /orders</div><div className="muted" style={{fontSize:11, marginTop:4}}>Update PAID-QC-SHIPPED-DELIVERED-SETTLED (vault tanpa shipped). Input no resi.</div></div>
      <div className="card card-pad"><div style={{fontSize:11, color:"var(--dim)", fontWeight:700}}>PAYOUTS</div><div style={{fontSize:11, color:"var(--muted)", marginTop:4}}>ADM-05 — escrow/settlement, trigger payout batch H+1 Selasa, fee 1%, withholding, rekonsiliasi harian top-up vs ledger vs float.</div></div>
    </div>
    <div className="grid-3">
      <div className="card card-pad"><div style={{fontSize:11, color:"var(--dim)", fontWeight:700}}>NFC</div><div className="muted" style={{fontSize:11, marginTop:4}}>ADM-04 — batch tag, NDEF/SDM config, QC defect &lt;2%.</div></div>
      <div className="card card-pad"><div style={{fontSize:11, color:"var(--dim)", fontWeight:700}}>BADGES</div><div className="muted" style={{fontSize:11, marginTop:4}}>ADM-07 — criteria + ikon + XP reward (bukan expiry).</div></div>
      <div className="card card-pad"><div style={{fontSize:11, color:"var(--dim)", fontWeight:700}}>AUDIT 2FA</div><div className="muted" style={{fontSize:11, marginTop:4}}>ADM-08 audit append-only (1 tahun) + ADM-09 TOTP wajib (aal2).</div></div>
    </div>
  </div>;
}

export default function App(){
  const { hasSupabase } = useAdminAuth();
  return <div className="app-shell">
    <Nav />
    <main className="main-content">
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={hasSupabase ? <Guard><Dashboard /></Guard> : <Dashboard />} />
        <Route path="/creators" element={hasSupabase ? <Guard><CreatorsPage /></Guard> : <CreatorsPage />} />
        <Route path="/drops" element={hasSupabase ? <Guard><DropsPage /></Guard> : <DropsPage />} />
        <Route path="/orders" element={hasSupabase ? <Guard><OrdersPage /></Guard> : <OrdersPage />} />
        <Route path="/nfc" element={hasSupabase ? <Guard><NfcPage /></Guard> : <NfcPage />} />
        <Route path="/payouts" element={hasSupabase ? <Guard><PayoutsPage /></Guard> : <PayoutsPage />} />
        <Route path="/badges" element={hasSupabase ? <Guard><BadgesPage /></Guard> : <BadgesPage />} />
        <Route path="/disputes" element={hasSupabase ? <Guard><DisputesPage /></Guard> : <DisputesPage />} />
        <Route path="/audit" element={hasSupabase ? <Guard><AuditPage /></Guard> : <AuditPage />} />
      </Routes>
    </main>
    <footer style={{textAlign:"center",padding:"18px 24px",fontSize:11,color:"var(--dim)",borderTop:"1px solid var(--border)", marginTop:40}}>C.Verse Admin — Lokal / VPS + Cloudflare Access (Zero Trust) — TIDAK di Pages publik — 2FA TOTP wajib (aal2) + audit log append-only · {hasSupabase? "Supabase connected" : "Demo mode (Supabase not configured)"}</footer>
  </div>;
}

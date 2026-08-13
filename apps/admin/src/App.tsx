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
      setMsg("Konfigurasi belum lengkap. Hubungkan database untuk masuk.");
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
    else setMsg("Authenticator terdaftar — pindai QR: " + (data as any)?.totp?.qr_code);
  }
  async function onChallenge(){
    if(!hasSupabase) return;
    const code = prompt("Masukkan kode dari authenticator:") ?? "";
    if(!code) return;
    const { data: factors } = await supabase.auth.mfa.listFactors();
    const factor = (factors as any)?.totp?.[0] ?? (factors as any)?.all?.[0];
    if(!factor){ setMsg("Belum ada authenticator — daftar dulu."); return; }
    const { data: ch } = await supabase.auth.mfa.challenge({ factorId: factor.id });
    const { error } = await supabase.auth.mfa.verify({ factorId: factor.id, challengeId: (ch as any).id, code });
    if(error) setMsg(error.message); else { setMsg("Verifikasi berhasil"); location.reload(); }
  }
  return <div className="card card-pad" style={{maxWidth:440, margin:"40px auto"}}>
    <h2 style={{fontWeight:800}}>Masuk Admin</h2>
    <p className="muted" style={{fontSize:12, marginTop:6}}>Akses terbatas untuk pengelola platform</p>
    <form onSubmit={onLogin} style={{display:"flex", flexDirection:"column", gap:10, marginTop:16}}>
      <input className="input" value={email} onChange={e=> setEmail(e.target.value)} placeholder="Email" />
      <input className="input" type="password" value={password} onChange={e=> setPassword(e.target.value)} placeholder="Password" />
      <button className="btn-gold" type="submit">Masuk</button>
    </form>
    <div style={{display:"flex", gap:8, marginTop:12}}>
      <button className="btn-ghost" onClick={onEnroll} style={{flex:1}}>Daftar Authenticator</button>
      <button className="btn-ghost" onClick={onChallenge} style={{flex:1}}>Verifikasi Kode</button>
    </div>
    {msg && <div className="pill pill-info" style={{marginTop:12}}>{msg}</div>}
  </div>;
}

function Guard({ children }: { children: React.ReactNode }){
  const { session, aal2, hasSupabase } = useAdminAuth();
  if(!hasSupabase) return <div className="card card-pad" style={{maxWidth:560, margin:"32px auto"}}><h3>Belum terhubung</h3><p className="muted" style={{fontSize:12, marginTop:6}}>Database belum dikonfigurasi. Panel menampilkan data baca saja.</p></div>;
  if(!session) return <LoginPage />;
  if(!aal2) return <div style={{maxWidth:560, margin:"32px auto", display:"flex", flexDirection:"column", gap:12}}>
    <div className="card card-pad" style={{borderLeft:"4px solid #eab308"}}><b>Verifikasi diperlukan</b><p className="muted" style={{fontSize:12, marginTop:6}}>Selesaikan verifikasi dua langkah untuk melanjutkan.</p></div>
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
      <NavLink to="/orders" className={({isActive})=> isActive?"active":""}>Pesanan</NavLink>
      <NavLink to="/nfc" className={({isActive})=> isActive?"active":""}>NFC</NavLink>
      <NavLink to="/payouts" className={({isActive})=> isActive?"active":""}>Payout</NavLink>
      <NavLink to="/badges" className={({isActive})=> isActive?"active":""}>Lencana</NavLink>
      <NavLink to="/disputes" className={({isActive})=> isActive?"active":""}>Sengketa</NavLink>
      <NavLink to="/audit" className={({isActive})=> isActive?"active":""}>Audit</NavLink>
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

// ── Kreator ──
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
    if(!hasSupabase){ setMsg("Mode demo — penyimpanan memerlukan koneksi database."); return; }
    const id = `cr-${Date.now().toString(36)}`;
    const { error } = await supabase.from("creators").insert({ id, handle: form.handle, total_followers_combined: Number(form.followers)||0, status:"active", bank_account: { bank:form.bank, account_no:form.acc, holder:form.holder }, notes: form.notes });
    if(error) setMsg(error.message); else { await auditInsert("create","creators",id,{handle:form.handle}); setMsg("Kreator ditambahkan"); setForm({handle:"",followers:"",notes:"",bank:"BCA",acc:"",holder:""}); load(); }
  }
  return <div style={{display:"flex",flexDirection:"column",gap:14}}>
    <div className="card card-pad"><h2 className="h2">Kreator</h2><p className="muted" style={{fontSize:12,marginTop:6}}>Daftar kreator terdaftar</p></div>
    <form onSubmit={onCreate} className="card card-pad" style={{display:"flex",flexDirection:"column",gap:8}}>
      <div style={{fontWeight:700,fontSize:13}}>Tambah Kreator</div>
      <div style={{display:"flex",gap:8}}><input className="input" placeholder="Handle" value={form.handle} onChange={e=>setForm(s=>({...s,handle:e.target.value}))} required style={{flex:1}} /><input className="input" placeholder="Followers" type="number" value={form.followers} onChange={e=>setForm(s=>({...s,followers:e.target.value}))} style={{width:160}} /></div>
      <div style={{display:"flex",gap:8}}><input className="input" placeholder="Bank" value={form.bank} onChange={e=>setForm(s=>({...s,bank:e.target.value}))} style={{width:120}} /><input className="input" placeholder="No. rekening" value={form.acc} onChange={e=>setForm(s=>({...s,acc:e.target.value}))} style={{flex:1}} /><input className="input" placeholder="Nama pemilik" value={form.holder} onChange={e=>setForm(s=>({...s,holder:e.target.value}))} style={{flex:1}} /></div>
      <input className="input" placeholder="Catatan" value={form.notes} onChange={e=>setForm(s=>({...s,notes:e.target.value}))} />
      <button className="btn-gold">Tambah</button>
      {msg && <div className="pill pill-info">{msg}</div>}
    </form>
    <div className="card"><div style={{padding:"12px 14px",fontWeight:700,borderBottom:"1px solid var(--border)"}}>Daftar ({rows.length})</div>
      {loading? <div style={{padding:14}} className="muted">Memuat...</div> :
      <div className="table-wrap"><table><thead><tr><th>Handle</th><th>Followers</th><th>Status</th><th>Bank</th><th>Catatan</th></tr></thead><tbody>{rows.map((r:any)=><tr key={r.id}><td style={{fontWeight:700}}>{r.handle ?? r.displayName ?? r.id}</td><td>{r.totalFollowersCombined ?? r.total_followers_combined ?? "-"}</td><td><span className="pill pill-info">{r.status ?? r.role ?? "-"}</span></td><td style={{fontSize:11}}>{r.bank_account? JSON.stringify(r.bank_account): r.bankAccount? JSON.stringify(r.bankAccount): "-"}</td><td style={{fontSize:11}}>{r.notes ?? "-"}</td></tr>)}</tbody></table></div>}
    </div>
  </div>;
}

// ── Drops ──
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
    if(!hasSupabase){ setMsg("Mode demo — gunakan dashboard kreator untuk membuat drop."); return;}
    const id = `drop-${Date.now().toString(36)}`;
    const signedCount = Math.ceil(Number(form.totalUnits)/10);
    const { error } = await supabase.from("drops").insert({ id, title: form.title, series: form.series, narrative: form.narrative, artwork_url: form.artworkUrl || "/textures/genesis.jpg", total_units: Number(form.totalUnits), signed_count: signedCount, unsigned_count: Number(form.totalUnits)-signedCount, price_unsigned_ccoin: Number(form.priceCcoin), price_signed_ccoin: Math.ceil(Number(form.priceCcoin)*1.6), price_ccoin: Number(form.priceCcoin), status:"draft", drop_start_at: form.dropStartAt || null, creator_id: (await supabase.auth.getUser()).data.user?.id ?? null, creator_name: "Admin", sold_count:0 });
    if(error) setMsg(error.message); else { await auditInsert("create","drops",id,{title:form.title}); setMsg("Drop dibuat"); setForm({title:"",series:"",narrative:"",artworkUrl:"",totalUnits:15,priceCcoin:30,dropStartAt:""}); load(); }
  }
  async function setStatus(id:string, status:string){
    if(!hasSupabase){ setMsg("Memerlukan koneksi database."); return; }
    const { error } = await supabase.from("drops").update({ status }).eq("id",id);
    if(error) setMsg(error.message); else { await auditInsert("update","drops",id,{status}); load(); }
  }
  return <div style={{display:"flex",flexDirection:"column",gap:14}}>
    <div className="card card-pad"><h2 className="h2">Drops</h2><p className="muted" style={{fontSize:12,marginTop:6}}>Kelola koleksi dan jadwal rilis</p></div>
    <form onSubmit={onCreate} className="card card-pad" style={{display:"flex",flexDirection:"column",gap:8}}>
      <div style={{fontWeight:700,fontSize:13}}>Buat Drop</div>
      <input className="input" placeholder="Judul" value={form.title} onChange={e=>setForm(s=>({...s,title:e.target.value}))} required />
      <input className="input" placeholder="Seri" value={form.series} onChange={e=>setForm(s=>({...s,series:e.target.value}))} required />
      <textarea className="input" placeholder="Deskripsi" value={form.narrative} onChange={e=>setForm(s=>({...s,narrative:e.target.value}))} required rows={2} />
      <div style={{display:"flex",gap:8}}><input className="input" placeholder="URL artwork" value={form.artworkUrl} onChange={e=>setForm(s=>({...s,artworkUrl:e.target.value}))} style={{flex:1}} /><input className="input" type="number" min={1} max={1000} value={form.totalUnits} onChange={e=>setForm(s=>({...s,totalUnits:Number(e.target.value)}))} style={{width:120}} /><input className="input" type="number" min={1} value={form.priceCcoin} onChange={e=>setForm(s=>({...s,priceCcoin:Number(e.target.value)}))} style={{width:120}} /></div>
      <input className="input" type="datetime-local" value={form.dropStartAt} onChange={e=>setForm(s=>({...s,dropStartAt:e.target.value}))} />
      <button className="btn-gold">Buat</button>
      {msg && <div className="pill pill-info">{msg}</div>}
    </form>
    <div className="card"><div style={{padding:"12px 14px",fontWeight:700,borderBottom:"1px solid var(--border)"}}>Daftar ({rows.length})</div>
      {loading? <div style={{padding:14}} className="muted">Memuat...</div> :
      <div className="table-wrap"><table><thead><tr><th>Judul</th><th>Status</th><th>Unit</th><th>Harga</th><th>Aksi</th></tr></thead><tbody>{rows.map((r:any)=><tr key={r.id}><td style={{fontWeight:700,fontSize:12}}>{r.title}</td><td><span className="pill pill-info">{r.status}</span></td><td>{r.sold_count ?? r.soldCount ?? 0}/{r.total_units ?? r.totalUnits}</td><td>{r.price_ccoin ?? r.priceCcoin ?? r.price_unsigned_ccoin} C</td><td style={{display:"flex",gap:4}}><button className="btn-ghost" style={{padding:"4px 8px",fontSize:11}} onClick={()=>setStatus(r.id,"published")}>Publish</button><button className="btn-ghost" style={{padding:"4px 8px",fontSize:11}} onClick={()=>setStatus(r.id,"live")}>Live</button><button className="btn-ghost" style={{padding:"4px 8px",fontSize:11}} onClick={()=>setStatus(r.id,"closed")}>Tutup</button></td></tr>)}</tbody></table></div>}
    </div>
  </div>;
}

// ── Orders ──
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
      setMsg("Mode demo — data pesanan tersedia di aplikasi utama.");
    }
    setLoading(false);
  }
  useEffect(()=>{ load(); },[]);
  async function updateStatus(id:string, status:string, tracking?:string){
    if(!hasSupabase){ setMsg("Memerlukan koneksi database."); return; }
    const patch:any={ status }; if(tracking) patch.tracking_number=tracking;
    const { error } = await supabase.from("orders").update(patch).eq("id",id);
    if(error) setMsg(error.message); else { await auditInsert("update","orders",id,{status}); load(); }
  }
  return <div style={{display:"flex",flexDirection:"column",gap:14}}>
    <div className="card card-pad"><h2 className="h2">Pesanan</h2><p className="muted" style={{fontSize:12,marginTop:6}}>Kelola pesanan dan pengiriman</p></div>
    {msg && <div className="pill pill-info">{msg}</div>}
    <div className="card"><div style={{padding:"12px 14px",fontWeight:700,borderBottom:"1px solid var(--border)"}}>Daftar — 100 terbaru</div>
      {loading? <div style={{padding:14}} className="muted">Memuat...</div> :
      rows.length===0? <div style={{padding:14}} className="muted">Belum ada pesanan</div> :
      <div className="table-wrap"><table><thead><tr><th>ID</th><th>Status</th><th>Opsi</th><th>Resi</th><th>Aksi</th></tr></thead><tbody>{rows.map((r:any)=><tr key={r.id}><td style={{fontFamily:"monospace",fontSize:11}}>{r.id.slice(0,10)}</td><td><span className="pill pill-info">{r.status}</span></td><td>{r.delivery_option ?? "-"}</td><td style={{fontSize:11}}>{r.tracking_number ?? "-"}</td><td style={{display:"flex",gap:4}}><button className="btn-ghost" style={{padding:"4px 8px",fontSize:11}} onClick={()=>updateStatus(r.id,"qc")}>QC</button><button className="btn-ghost" style={{padding:"4px 8px",fontSize:11}} onClick={()=>{ const t=prompt("No resi:"); if(t) updateStatus(r.id,"shipped",t); else updateStatus(r.id,"shipped"); }}>Kirim</button><button className="btn-ghost" style={{padding:"4px 8px",fontSize:11}} onClick={()=>updateStatus(r.id,"delivered")}>Selesai</button><button className="btn-gold" style={{padding:"4px 8px",fontSize:11}} onClick={()=>updateStatus(r.id,"settled")}>Settled</button></td></tr>)}</tbody></table></div>}
    </div>
  </div>;
}

// ── NFC ──
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
      setMsg("Mode demo — pengelolaan NFC via database.");
    }
  }
  useEffect(()=>{ load(); },[]);
  async function createBatch(){
    const code = `BATCH-${Date.now().toString(36).toUpperCase()}`;
    if(!hasSupabase){ setMsg("Memerlukan koneksi database."); return; }
    const qty = Number(prompt("Jumlah batch:","50") ?? "50");
    const { error } = await supabase.from("nfc_batches").insert({ id: `nfc-${Date.now().toString(36)}`, batch_code: code, qty, status:"received" });
    if(error) setMsg(error.message); else { await auditInsert("create","nfc_batches",code,{qty}); load(); }
  }
  return <div style={{display:"flex",flexDirection:"column",gap:14}}>
    <div className="card card-pad"><h2 className="h2">NFC</h2><p className="muted" style={{fontSize:12,marginTop:6}}>Kelola batch dan verifikasi kartu</p></div>
    {msg && <div className="pill pill-info">{msg}</div>}
    <div style={{display:"flex",gap:8}}><button className="btn-gold" onClick={createBatch}>Buat Batch</button><button className="btn-ghost" onClick={load}>Refresh</button></div>
    <div className="grid-2">
      <div className="card"><div style={{padding:"12px 14px",fontWeight:700,borderBottom:"1px solid var(--border)"}}>Batch ({batches.length})</div><div className="table-wrap"><table><thead><tr><th>Batch</th><th>Qty</th><th>Status</th></tr></thead><tbody>{batches.length===0? <tr><td colSpan={3} style={{textAlign:"center",padding:14}} className="muted">Belum ada batch</td></tr> : batches.map((b:any)=><tr key={b.id}><td style={{fontFamily:"monospace",fontSize:11}}>{b.batch_code}</td><td>{b.qty}</td><td><span className="pill pill-info">{b.status}</span></td></tr>)}</tbody></table></div></div>
      <div className="card"><div style={{padding:"12px 14px",fontWeight:700,borderBottom:"1px solid var(--border)"}}>Kartu — sampel 50</div><div className="table-wrap"><table><thead><tr><th>Kode</th><th>UID</th><th>QC</th><th>Siap</th></tr></thead><tbody>{cards.length===0? <tr><td colSpan={4} style={{textAlign:"center",padding:14}} className="muted">Belum ada data</td></tr> : cards.map((c:any)=><tr key={c.id}><td style={{fontFamily:"monospace",fontSize:11}}>{c.nfc_short_id ?? c.nfcShortId}</td><td style={{fontFamily:"monospace",fontSize:11}}>{(c.nfc_uid ?? c.nfcUid ?? "").slice(0,12)}</td><td><span className="pill pill-info">{c.qc_status ?? c.qcStatus ?? "-"}</span></td><td>{String(c.nfc_configured ?? c.nfcConfigured)}</td></tr>)}</tbody></table></div></div>
    </div>
  </div>;
}

// ── Payout ──
function PayoutsPage(){
  const [batches,setBatches]=useState<any[]>([]);
  const [msg,setMsg]=useState<string|null>(null);
  async function load(){
    if(!hasSupabase){ setMsg("Mode demo — payout via database."); return; }
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
    <div className="card card-pad"><h2 className="h2">Payout</h2><p className="muted" style={{fontSize:12,marginTop:6}}>Kelola pencairan dan rekonsiliasi</p></div>
    {msg && <div className="pill pill-info">{msg}</div>}
    <div style={{display:"flex",gap:8}}><button className="btn-gold" onClick={triggerBatch}>Buat Batch Payout</button><button className="btn-ghost" onClick={load}>Refresh</button></div>
    <div className="card"><div style={{padding:"12px 14px",fontWeight:700,borderBottom:"1px solid var(--border)"}}>Batch Payout ({batches.length})</div><div className="table-wrap"><table><thead><tr><th>Batch</th><th>Status</th><th>Total C</th><th>Total IDR</th></tr></thead><tbody>{batches.length===0? <tr><td colSpan={4} style={{textAlign:"center",padding:14}} className="muted">Belum ada batch</td></tr> : batches.map((b:any)=><tr key={b.id}><td style={{fontFamily:"monospace",fontSize:11}}>{b.batch_code}</td><td><span className="pill pill-info">{b.status}</span></td><td>{b.total_ccoin}</td><td>{b.total_idr}</td></tr>)}</tbody></table></div></div>
  </div>;
}

// ── Sengketa ──
function DisputesPage(){
  const [rows,setRows]=useState<any[]>([]);
  const [msg,setMsg]=useState<string|null>(null);
  async function load(){
    if(!hasSupabase){ setMsg("Mode demo — sengketa via database."); return; }
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
    <div className="card card-pad"><h2 className="h2">Sengketa</h2><p className="muted" style={{fontSize:12,marginTop:6}}>Tinjau dan selesaikan laporan</p></div>
    {msg && <div className="pill pill-info">{msg}</div>}
    <div className="card"><div style={{padding:"12px 14px",fontWeight:700,borderBottom:"1px solid var(--border)"}}>Daftar ({rows.length})</div><div className="table-wrap"><table><thead><tr><th>ID</th><th>Alasan</th><th>Status</th><th>Aksi</th></tr></thead><tbody>{rows.length===0? <tr><td colSpan={4} style={{textAlign:"center",padding:14}} className="muted">Belum ada laporan</td></tr> : rows.map((r:any)=><tr key={r.id}><td style={{fontFamily:"monospace",fontSize:11}}>{r.id.slice(0,10)}</td><td style={{fontSize:12}}>{r.reason}</td><td><span className="pill pill-info">{r.status}</span></td><td style={{display:"flex",gap:4}}><button className="btn-ghost" style={{padding:"4px 8px",fontSize:11}} onClick={()=>decide(r.id,"resolved_refund")}>Refund</button><button className="btn-ghost" style={{padding:"4px 8px",fontSize:11}} onClick={()=>decide(r.id,"resolved_strike")}>Strike</button><button className="btn-ghost" style={{padding:"4px 8px",fontSize:11}} onClick={()=>decide(r.id,"resolved_suspend")}>Suspend</button></td></tr>)}</tbody></table></div></div>
  </div>;
}

// ── Lencana ──
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
    let criteria:any; try{ criteria=JSON.parse(form.criteria);} catch{ setMsg("Format kriteria tidak valid"); return; }
    if(!hasSupabase){ setMsg("Mode demo — penyimpanan lencana memerlukan database."); return; }
    const id = `b-${Date.now().toString(36)}`;
    const { error } = await supabase.from("badges").insert({ id, code: form.code, name: form.name, description: form.description, icon: form.icon, icon_url: form.icon, xp: Number(form.xp_reward), xp_reward: Number(form.xp_reward), criteria, is_active:true });
    if(error) setMsg(error.message); else { await auditInsert("create","badges",id,{code:form.code}); setMsg("Lencana dibuat"); setForm({code:"",name:"",description:"",icon:"",xp_reward:0,criteria:'{"type":"collect_count","min":5}'}); load(); }
  }
  return <div style={{display:"flex",flexDirection:"column",gap:14}}>
    <div className="card card-pad"><h2 className="h2">Lencana</h2><p className="muted" style={{fontSize:12,marginTop:6}}>Kelola lencana dan penghargaan</p></div>
    <form onSubmit={onCreate} className="card card-pad" style={{display:"flex",flexDirection:"column",gap:8}}>
      <div style={{fontWeight:700,fontSize:13}}>Tambah Lencana</div>
      <div style={{display:"flex",gap:8}}><input className="input" placeholder="Kode" value={form.code} onChange={e=>setForm(s=>({...s,code:e.target.value}))} required style={{flex:1}} /><input className="input" placeholder="Nama" value={form.name} onChange={e=>setForm(s=>({...s,name:e.target.value}))} required style={{flex:1}} /><input className="input" placeholder="Ikon" value={form.icon} onChange={e=>setForm(s=>({...s,icon:e.target.value}))} style={{width:140}} /><input className="input" type="number" min={0} placeholder="XP" value={form.xp_reward} onChange={e=>setForm(s=>({...s,xp_reward:Number(e.target.value)}))} style={{width:100}} /></div>
      <input className="input" placeholder="Deskripsi" value={form.description} onChange={e=>setForm(s=>({...s,description:e.target.value}))} />
      <input className="input" placeholder='Kriteria JSON' value={form.criteria} onChange={e=>setForm(s=>({...s,criteria:e.target.value}))} style={{fontFamily:"monospace",fontSize:12}} />
      <button className="btn-gold">Tambah</button>
      {msg && <div className="pill pill-info">{msg}</div>}
    </form>
    <div className="card"><div style={{padding:"12px 14px",fontWeight:700,borderBottom:"1px solid var(--border)"}}>Daftar ({rows.length})</div><div className="table-wrap"><table><thead><tr><th>Kode</th><th>Nama</th><th>XP</th><th>Kriteria</th><th>Aktif</th></tr></thead><tbody>{rows.map((r:any)=><tr key={r.id}><td style={{fontWeight:700,fontFamily:"monospace",fontSize:11}}>{r.code}</td><td>{r.name}</td><td>{r.xp_reward ?? r.xp ?? 0}</td><td style={{fontFamily:"monospace",fontSize:11, maxWidth:200, overflow:"hidden", textOverflow:"ellipsis"}}>{typeof r.criteria==="string"? r.criteria : JSON.stringify(r.criteria)}</td><td>{String(r.is_active ?? r.isActive ?? true)}</td></tr>)}</tbody></table></div></div>
  </div>;
}

// ── Audit ──
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
    <div className="card card-pad"><h2 className="h2">Audit Log</h2><p className="muted" style={{fontSize:12,marginTop:6}}>Riwayat aktivitas admin</p></div>
    <div style={{display:"flex",gap:8}}><input className="input" placeholder="Cari aksi..." value={filter} onChange={e=>setFilter(e.target.value)} style={{flex:1}} /><button className="btn-ghost" onClick={load}>Cari</button></div>
    <div className="card"><div style={{padding:"12px 14px",fontWeight:700,borderBottom:"1px solid var(--border)"}}>100 terbaru</div><div className="table-wrap"><table><thead><tr><th>Waktu</th><th>Admin</th><th>Aksi</th><th>Target</th><th>Detail</th></tr></thead><tbody>{rows.length===0? <tr><td colSpan={5} style={{textAlign:"center",padding:14}} className="muted">{hasSupabase? "Belum ada aktivitas":"Memerlukan koneksi database"} </td></tr> : rows.map((r:any)=><tr key={r.id}><td style={{fontSize:11,color:"var(--muted)"}}>{new Date(r.created_at ?? r.createdAt).toLocaleString("id-ID")}</td><td style={{fontFamily:"monospace",fontSize:11}}>{(r.admin_user_id ?? r.adminUserId ?? "").slice(0,10)}</td><td><span className="pill pill-info">{r.action}</span></td><td style={{fontSize:11}}>{r.target_table ?? r.targetTable}{r.target_id? ":"+String(r.target_id).slice(0,8):""}</td><td style={{fontFamily:"monospace",fontSize:11, maxWidth:200, overflow:"hidden", textOverflow:"ellipsis"}}>{r.payload_summary? JSON.stringify(r.payload_summary): r.payloadSummary? JSON.stringify(r.payloadSummary): "-"}</td></tr>)}</tbody></table></div></div>
  </div>;
}

function Dashboard(){
  return <div style={{display:"flex", flexDirection:"column", gap:14}}>
    <div className="card card-pad"><h2 className="h2">Dashboard</h2><p className="muted" style={{fontSize:12, marginTop:6}}>Ringkasan operasional</p></div>
    <div className="grid-3">
      <div className="card card-pad"><div style={{fontSize:11, color:"var(--dim)", fontWeight:700}}>DROPS</div><div style={{fontWeight:700, marginTop:6}}>Kelola koleksi</div><div className="muted" style={{fontSize:11, marginTop:4}}>Buat dan atur jadwal rilis</div></div>
      <div className="card card-pad"><div style={{fontSize:11, color:"var(--dim)", fontWeight:700}}>PESANAN</div><div style={{fontWeight:700, marginTop:6}}>Kelola pesanan</div><div className="muted" style={{fontSize:11, marginTop:4}}>Proses hingga selesai</div></div>
      <div className="card card-pad"><div style={{fontSize:11, color:"var(--dim)", fontWeight:700}}>PAYOUT</div><div style={{fontWeight:700, marginTop:6}}>Kelola pencairan</div><div className="muted" style={{fontSize:11, marginTop:4}}>Batch dan rekonsiliasi</div></div>
    </div>
    <div className="grid-3">
      <div className="card card-pad"><div style={{fontSize:11, color:"var(--dim)", fontWeight:700}}>NFC</div><div style={{fontWeight:700, marginTop:6}}>Verifikasi</div><div className="muted" style={{fontSize:11, marginTop:4}}>Batch dan QC kartu</div></div>
      <div className="card card-pad"><div style={{fontSize:11, color:"var(--dim)", fontWeight:700}}>LENCANA</div><div style={{fontWeight:700, marginTop:6}}>Penghargaan</div><div className="muted" style={{fontSize:11, marginTop:4}}>Atur lencana kolektor</div></div>
      <div className="card card-pad"><div style={{fontSize:11, color:"var(--dim)", fontWeight:700}}>AUDIT</div><div style={{fontWeight:700, marginTop:6}}>Aktivitas</div><div className="muted" style={{fontSize:11, marginTop:4}}>Riwayat perubahan sistem</div></div>
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
    <footer style={{textAlign:"center",padding:"18px 24px",fontSize:11,color:"var(--dim)",borderTop:"1px solid var(--border)", marginTop:40}}>C.Verse Admin</footer>
  </div>;
}

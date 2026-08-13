import React from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";

export default function Verify(){
  const [shortId,setShortId]=React.useState("");
  const [uid,setUid]=React.useState("");
  const [result,setResult]=React.useState<any>(null);
  const [loading,setLoading]=React.useState(false);
  const [msg,setMsg]=React.useState<string|null>(null);
  async function onQr(){
    if(!shortId.trim()){ setMsg("Masukkan short ID / scan QR di dus"); return; }
    setLoading(true); setMsg(null);
    try{ const r=await api.verifyShortId(shortId.trim()); setResult({...r, _method:"qr", _redirect: r.redirectTo ?? "/cards/"+(r.card?.id ?? shortId.trim())}); setMsg("Registered (QR) — status lebih lemah; tap NFC untuk Verified."); }
    catch(e:any){ setMsg(e.message ?? String(e)); setResult(null); } finally{ setLoading(false); }
  }
  async function onNfc(){
    if(!uid.trim()){ setMsg("Masukkan UID NFC"); return; }
    setLoading(true); setMsg(null);
    try{ const r=await api.verifyNfc({ uid: uid.trim(), shortId: shortId.trim()||undefined }); setResult({...r,_method:"nfc", _redirect: r.redirectTo ?? "/cards/"+(r.card?.id ?? uid.trim())+"/3d"}); setMsg(r.message ?? "Terverifikasi"); }
    catch(e:any){ setMsg(e.message ?? String(e)); setResult(null); } finally{ setLoading(false); }
  }
  async function onScan(){
    const nav:any = navigator;
    if(!("NDEFReader" in window)){ setMsg("Web NFC hanya Chrome Android 89+"); return; }
    try{ const reader=new nav.NDEFReader(); setMsg("Dekatkan kartu..."); await reader.scan(); reader.onreading=async(ev:any)=>{ const d=new TextDecoder(); let t=""; for(const r of ev.message.records) try{ t+=d.decode(r.data);}catch{} const m=t.match(/[0-9A-Fa-f]{10,16}/); const id=m?m[0]: uid||shortId||""; if(id){ setUid(id); try{ const r=await api.verifyNfc({uid:id}); setResult({...r,_method:"nfc", _redirect: r.redirectTo}); setMsg(r.message);}catch(e:any){ setMsg(e.message);} } }; }catch(e:any){ setMsg(e.message ?? String(e)); }
  }
  return <div style={{maxWidth:720, margin:"0 auto", display:"flex", flexDirection:"column", gap:16}}>
    <div className="card card-pad">
      <span className="eyebrow">Verify — melekat di halaman kartu</span>
      <h1 className="h2" style={{marginTop:6}}>Verifikasi Kartu</h1>
      <p className="muted" style={{fontSize:13, marginTop:8}}>Tidak ada halaman verifikasi terpisah (docs 02 §4): tap NFC → langsung <b>halaman 3D</b> (<code>/cards/:id/3d</code> + badge <i>Verified Card</i>). QR di dus → halaman <b>info kartu</b> (<code>/cards/:id</code> + <i>Registered</i>). Input serial manual tidak ada.</p>
      {msg && <div className="pill pill-info" style={{marginTop:10, justifyContent:"center"}}>{msg}</div>}
    </div>
    <div className="card card-pad" style={{display:"flex", flexDirection:"column", gap:12}}>
      <label style={{fontSize:12, fontWeight:700, color:"var(--dim)"}}>SHORT ID (QR di dus)</label>
      <div style={{display:"flex", gap:8}}><input className="input" value={shortId} onChange={e=> setShortId(e.target.value)} placeholder="contoh: drop-001" style={{flex:1}} /><button className="btn-ghost" onClick={onQr} disabled={loading}>Verify QR</button></div>
      <label style={{fontSize:12, fontWeight:700, color:"var(--dim)"}}>UID NFC (HEX)</label>
      <div style={{display:"flex", gap:8}}><input className="input" value={uid} onChange={e=> setUid(e.target.value)} placeholder="04A1..." style={{flex:1}} /><button className="btn-ghost" onClick={onNfc} disabled={loading}>Verify NFC</button><button className="btn-gold" onClick={onScan}>Scan (Web NFC)</button></div>
    </div>
    {result && <div className="card card-pad">
      <div style={{display:"flex", gap:8, flexWrap:"wrap"}}>
        <span className={"pill "+(result.verifyStatus==="verified"?"pill-success": result.verifyStatus==="tamper_detected"?"pill-danger":"pill-warn")}>{result.verifyStatus}</span>
        <span className="pill pill-info">{result.verifyMethod ?? result._method}</span>
      </div>
      <div className="muted" style={{fontSize:12, marginTop:8}}>{result.message ?? ""}</div>
      {result.card && <div style={{marginTop:10}}>
        <Link to={result._redirect ?? "/cards/"+result.card.id} className="btn-gold" style={{textDecoration:"none", display:"inline-block", padding:"8px 14px"}}>{result.verifyStatus==="verified" ? "Buka Halaman 3D →" : "Buka Halaman Info →"}</Link>
      </div>}
    </div>}
    <div className="muted" style={{fontSize:11, textAlign:"center"}}>iOS: tap background → SUN URL di Safari → server verify CMAC (tanpa Web NFC) — wajib validasi device nyata (Sprint 0, C-03).</div>
  </div>;
}

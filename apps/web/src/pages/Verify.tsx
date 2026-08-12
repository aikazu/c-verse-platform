import React, { useState, useRef } from "react";
import { useParams } from "react-router-dom";
import { api } from "../lib/api";
import { useToast } from "../lib/toast";
import { useCardViewer } from "../lib/viewer";

export default function Verify(){
  const { shortId: paramShortId } = useParams();
  const { push } = useToast();
  const [shortId,setShortId]=useState(paramShortId||"");
  const [uid,setUid]=useState("");
  const [result,setResult]=useState<any>(null);
  const [loading,setLoading]=useState(false);
  const [nfcSupported,setNfcSupported]=useState<boolean|null>(null);
  const viewerRef = useRef<HTMLDivElement>(null);
  const artwork = result?.drop?.artworkUrl || null;
  useCardViewer(viewerRef, artwork);

  async function onVerifyShortId(){
    if(!shortId.trim()){ push("Masukkan short ID / scan QR","info"); return; }
    setLoading(true);
    try{ const r=await api.verifyShortId(shortId.trim()); setResult({...r, _method:"qr"}); push("Verifikasi QR/shortId selesai","success"); }
    catch(e:any){ push(e.message,"error"); setResult(null); } finally{ setLoading(false); }
  }
  async function onVerifyNfc(){
    if(!uid.trim()){ push("Masukkan UID NFC (atau tap via Web NFC)","info"); return; }
    setLoading(true);
    try{ const r=await api.verifyNfc({uid: uid.trim(), shortId: shortId.trim()||undefined}); setResult({...r,_method:"nfc"}); push(r.verifyStatus==="verified"?"✅ Kartu terverifikasi":"⚠️ "+r.message,"success"); }
    catch(e:any){ push(e.message,"error"); setResult(null); } finally{ setLoading(false); }
  }
  async function onTapNfc(){
    // Web NFC API (Chrome Android 89+ only)
    const nav:any = navigator;
    if(!("NDEFReader" in window)){
      setNfcSupported(false);
      push("Web NFC tidak didukung di browser ini. Gunakan Chrome Android 89+ atau pakai QR fallback.","info");
      return;
    }
    setNfcSupported(true);
    try{
      const reader = new nav.NDEFReader();
      push("Dekatkan kartu ke HP...","info");
      await reader.scan();
      reader.onreading = async (ev:any)=>{
        const decoder = new TextDecoder();
        let text="";
        for(const rec of ev.message.records){ try{ text+= decoder.decode(rec.data);}catch{} }
        // Try to extract UID-like hex from record
        const m = text.match(/[0-9A-Fa-f]{10,16}/);
        const detectedUid = m ? m[0] : uid || shortId || "";
        push(`NDEF terbaca: ${text.slice(0,80)} — UID: ${detectedUid}`,"success");
        if(detectedUid){ setUid(detectedUid); try{ const r=await api.verifyNfc({uid: detectedUid}); setResult({...r,_method:"nfc"});}catch(e:any){ push(e.message,"error"); } }
      };
      reader.onreadingerror = ()=> push("Gagal baca NFC — coba lagi, pastikan posisi tag di tengah HP.","error");
    }catch(e:any){ push("Gagal scan NFC: "+(e.message||e),"error"); }
  }

  const badge = result?.verifyStatus==="verified" ? {label:"✅ Verified",cls:"pill-success"}
    : result?.verifyStatus==="tamper_detected" ? {label:"⚠️ Tamper Detected",cls:"pill-danger"}
    : result?.verifyStatus==="registered" ? {label:"❓ Registered (QR — weaker)",cls:"pill-warn"}
    : result ? {label:"Unknown",cls:"pill-danger"} : null;

  return <div style={{display:"flex",flexDirection:"column",gap:18}}>
    <div>
      <span className="eyebrow">NTAG 424 DNA TagTamper — Verify</span>
      <h1 className="h2">Verify Kartu</h1>
      <p className="muted">Web NFC: Chrome Android 89+ ONLY. iOS / desktop pakai QR fallback (short_id di dus).</p>
    </div>

    <div className="grid-2">
      <div className="card card-pad" style={{display:"flex",flexDirection:"column",gap:14}}>
        <div style={{fontWeight:700}}>Scan / Input</div>

        <div style={{background:"var(--bg-elevated)",border:"1px solid var(--border)",borderRadius:10,padding:12,display:"flex",flexDirection:"column",gap:10}}>
          <div style={{fontSize:11,fontWeight:700,color:"var(--gold)",letterSpacing:"0.06em"}}>A. WEB NFC (Android Chrome)</div>
          <button className="btn-gold" onClick={onTapNfc} disabled={loading} style={{padding:"12px",fontSize:14}}>📡 Tap NFC Card</button>
          {nfcSupported===false && <div style={{fontSize:11,color:"var(--error)"}}>Browser ini tidak support Web NFC — pakai QR fallback di bawah.</div>}
          <div style={{display:"flex",gap:8}}>
            <input className="input" placeholder="UID hex (contoh: 04A1B2C3D4...)" value={uid} onChange={e=> setUid(e.target.value)} />
            <button className="btn-ghost" onClick={onVerifyNfc} disabled={loading}>Verify UID</button>
          </div>
        </div>

        <div style={{background:"var(--bg-elevated)",border:"1px solid var(--border)",borderRadius:10,padding:12,display:"flex",flexDirection:"column",gap:10}}>
          <div style={{fontSize:11,fontWeight:700,color:"var(--info)",letterSpacing:"0.06em"}}>B. QR / SHORT ID FALLBACK (iOS & semua device)</div>
          <div style={{display:"flex",gap:8}}>
            <input className="input" placeholder="Short ID (contoh: drop-...-003 atau scan QR)" value={shortId} onChange={e=> setShortId(e.target.value)} onKeyDown={e=> e.key==="Enter" && onVerifyShortId()}/>
            <button className="btn-gold" onClick={onVerifyShortId} disabled={loading}>Verify</button>
          </div>
          <div style={{fontSize:11,color:"var(--dim)"}}>QR ada di dus premium & belakang kartu (printed fallback).</div>
        </div>

        {result && <div className="card" style={{borderColor: result.verifyStatus==="verified"? "rgba(46,204,113,0.4)": result.verifyStatus==="tamper_detected"?"rgba(255,71,87,0.4)":"var(--border)",overflow:"hidden"}}>
          <div style={{padding:12,display:"flex",justifyContent:"space-between",alignItems:"center",background:"var(--bg-elevated)",borderBottom:"1px solid var(--border)"}}>
            <span style={{fontWeight:700,fontSize:13}}>Hasil Verifikasi</span>
            {badge && <span className={`pill ${badge.cls}`}>{badge.label}</span>}
          </div>
          <div style={{padding:12,display:"flex",flexDirection:"column",gap:8,fontSize:13}}>
            <div><b>Series:</b> {result.drop?.series ?? result.drop?.title ?? "-"}</div>
            <div><b>Card:</b> {result.drop?.title ?? "-"} · Unit #{result.card?.unitNumber ?? "-"} · Variant: {result.card?.variant ?? "-"}</div>
            <div><b>Owner:</b> {result.owner?.displayName ?? "— (belum terikat)"}</div>
            <div><b>Method:</b> {result.verifyMethod ?? result._method ?? "-"} {result.verifyStatus==="registered" && <span style={{color:"var(--gold)"}}>— weaker (DB match, tanpa CMAC)</span>}</div>
            {result.message && <div style={{fontSize:12,color:"var(--muted)",background:"var(--bg-elevated)",padding:8,borderRadius:8}}>{result.message}</div>}
            <div style={{fontSize:11,color:"var(--dim)"}}>Card ID: {result.card?.id ?? "-"} · Short ID: {result.card?.nfcShortId ?? shortId} {result.card?.nfcUid ? `· UID: ${result.card.nfcUid}`:""}</div>
          </div>
        </div>}
      </div>

      <div style={{display:"flex",flexDirection:"column",gap:12}}>
        <div ref={viewerRef} className="viewer-wrap">
          <div className="viewer-overlay" style={{display: result ? "none" : "flex"}}>
            <div style={{fontSize:28}}>🎴</div>
            <div style={{fontWeight:700}}>3D Card Viewer</div>
            <div style={{fontSize:12,color:"var(--muted)",textAlign:"center",maxWidth:260}}>Drag untuk putar 360° · Auto-rotate saat idle · Verify kartu untuk load artwork</div>
          </div>
        </div>
        <div className="muted" style={{fontSize:11}}>3D viewer: three.js · drag/swipe untuk orbit · bukan AR (AR = Y2+). Fallback 2D jika WebGL tidak tersedia.</div>
        {result?.verifyStatus==="verified" && <div className="card card-pad" style={{background:"rgba(46,204,113,0.08)",borderColor:"rgba(46,204,113,0.25)"}}>
          <div style={{fontWeight:700,fontSize:13}}>✅ Tamper Check: Aman</div>
          <div style={{fontSize:12,color:"var(--muted)",marginTop:4}}>Loop TagTamper intact · CMAC match (NTAG 424 DNA SUN) · Sertifikat on-platform valid.</div>
        </div>}
        {result?.verifyStatus==="tamper_detected" && <div className="card card-pad" style={{background:"rgba(255,71,87,0.08)",borderColor:"rgba(255,71,87,0.25)"}}>
          <div style={{fontWeight:700,color:"var(--error)"}}>⚠️ Tamper Detected</div>
          <div style={{fontSize:12,color:"var(--muted)",marginTop:4}}>TagTamper loop putus — status once-opened irreversibel. Hubungi support dengan foto dus & kartu.</div>
        </div>}
      </div>
    </div>
  </div>;
}

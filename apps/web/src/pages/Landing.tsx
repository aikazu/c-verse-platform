import React, { useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { useToast } from "../lib/toast";

export default function Landing(){
  const { user, demoLogin } = useAuth();
  const { push } = useToast();
  const [loading,setLoading]=useState(false);
  async function onDemo(){ setLoading(true); try{ await demoLogin(); push("Masuk sebagai Demo Kolektor — 120 C-Coin ✓","success"); }catch(e:any){ push(e.message,"error"); } finally{ setLoading(false); } }
  return <div style={{display:"flex",flexDirection:"column",gap:28}}>
    <div style={{background:"linear-gradient(135deg,#0f0f1a 0%,#1a1030 50%,#0f1a2e 100%)",border:"1px solid var(--border)",borderRadius:16,padding:"40px 28px", display:"flex",gap:32,alignItems:"center",flexWrap:"wrap"}}>
      <div style={{flex:"1 1 380px"}}>
        <span className="eyebrow">C.Verse — Creator Verse</span>
        <h1 className="h1" style={{marginTop:8}}>Revolusi<br/><span style={{color:"var(--gold)"}}>Ekonomi Kreator</span></h1>
        <p className="muted" style={{marginTop:14,maxWidth:520}}>
          Kartu kolaborasi edisi terbatas dalam acrylic hardcase premium. Tiap kartu = 1 NFC terverifikasi = 1 sertifikat digital.
          Primary <b style={{color:"var(--text)"}}>siapa cepat dia dapat</b> (limit 1 kartu/user/drop) · Secondary <b style={{color:"var(--text)"}}>Marketplace (buyout)</b> + <b style={{color:"var(--text)"}}>Browse (bid langsung di kartu)</b>.
        </p>
        <div style={{display:"flex",gap:10,marginTop:20,flexWrap:"wrap"}}>
          <Link to="/drops" className="btn-gold" style={{padding:"11px 22px",borderRadius:99,fontWeight:700,display:"inline-flex", textDecoration:"none"}}>Lihat Drops →</Link>
          <Link to="/marketplace" className="btn-ghost" style={{padding:"11px 22px",display:"inline-flex", textDecoration:"none"}}>Marketplace</Link>
          <Link to="/browse" className="btn-ghost" style={{padding:"11px 22px",display:"inline-flex", textDecoration:"none"}}>Browse</Link>
          {!user && <button className="btn-ghost" onClick={onDemo} disabled={loading} style={{padding:"11px 22px"}}>{loading?"Memuat...":"Coba Demo Login"}</button>}
        </div>
        <div style={{display:"flex",gap:18,marginTop:22,fontSize:12,color:"var(--muted)"}}>
          <span>1 C-Coin = Rp 10.000</span><span>· NFC Terverifikasi</span><span>· Pengiriman vault / kirim fisik</span>
        </div>
      </div>
      <div style={{flex:"0 0 300px",background:"var(--bg-card)",border:"1px solid var(--border)",borderRadius:14,padding:18}}>
        <div style={{fontSize:11,fontWeight:700,letterSpacing:"0.06em",color:"var(--dim)",textTransform:"uppercase",marginBottom:12}}>Alur MVP (9 Flow)</div>
        {[
          ["1","Primary Drop","1 kartu/user/drop — kirim fisik / simpan vault"],
          ["2","Fulfillment","NFC provisioning + QC + dus"],
          ["3","Settlement","70/30 split + vault/ship"],
          ["4","NFC Tap","Tap → halaman 3D + Verified badge"],
          ["5","QR Fallback","QR di dus → info kartu (Registered)"],
          ["6","Marketplace","Kartu dengan buyout price"],
          ["7","Browse (bid)","Bid langsung di kartu, 1 active"],
          ["8","C-Coin","Closed-loop · payout seller H+1"],
          ["9","Gamifikasi","Level via XP + badge (admin-config)"],
        ].map(([n,t,d])=> <div key={n} style={{display:"flex",gap:10,padding:"7px 0",borderBottom:"1px solid rgba(42,42,62,0.4)"}}>
          <span style={{width:22,height:22,borderRadius:99,background:"var(--gold-bg)",color:"var(--gold)",display:"inline-flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:800,flexShrink:0}}>{n}</span>
          <div><div style={{fontSize:12,fontWeight:700}}>{t}</div><div style={{fontSize:11,color:"var(--dim)"}}>{d}</div></div>
        </div>)}
        <div style={{display:"flex",gap:8,marginTop:12}}>
          <Link to="/verify" style={{fontSize:12,fontWeight:700,color:"var(--gold)"}}>Coba Verify →</Link>
          <span style={{color:"var(--dim)"}}>·</span>
          <Link to="/wallet" style={{fontSize:12,fontWeight:700,color:"var(--gold)"}}>Wallet →</Link>
        </div>
      </div>
    </div>
    <div className="grid-3">
      {[
        { icon:"🎴", title:"Physical-first", desc:"Acrylic hardcase 63×88mm, holo, dus premium. Koleksi yang bisa dipegang." },
        { icon:"🔐", title:"Verifiable Scarcity", desc:"NFC terverifikasi — tap → halaman 3D (Verified Card)." },
        { icon:"📦", title:"Vault atau Kirim Fisik", desc:"Checkout pilih simpan di inventory (tanpa kirim) atau kirim fisik (ongkir C-Coin)." },
        { icon:"🪙", title:"C-Coin Opsi A", desc:"Buyer closed-loop · seller/kreator auto-disburse IDR. Integer ≥1." },
        { icon:"🏪", title:"Marketplace + Browse", desc:"Buyout di Marketplace · Bid bebas di Browse (tanpa harga pun bisa)." },
        { icon:"🏆", title:"Gamifikasi via XP", desc:"Spend 1 C = 1 XP · 10 XP = 1 level · Badge (ikon + XP reward) config di admin." },
      ].map(c=> <div key={c.title} className="card card-pad">
        <div style={{fontSize:22}}>{c.icon}</div>
        <div style={{fontWeight:700,marginTop:8,fontSize:14}}>{c.title}</div>
        <div className="muted" style={{marginTop:6}}>{c.desc}</div>
      </div>)}
    </div>
    <div className="card card-pad" style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:12}}>
      <div><div style={{fontWeight:700}}>Siap lihat koleksi?</div><div className="muted">Drops live + Marketplace & Browse secondary.</div></div>
      <div style={{display:"flex",gap:10}}><Link to="/drops" className="btn-gold">Masuk Drops</Link><Link to="/collection" className="btn-ghost">Koleksiku</Link></div>
    </div>
  </div>;
}

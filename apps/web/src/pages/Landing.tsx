import React from "react";
import { Link } from "react-router-dom";

export default function Landing(){
  return <div style={{display:"flex",flexDirection:"column",gap:28}}>
    <div style={{background:"linear-gradient(135deg,#0f0f1a 0%,#1a1030 50%,#0f1a2e 100%)",border:"1px solid var(--border)",borderRadius:16,padding:"40px 28px", display:"flex",gap:32,alignItems:"center",flexWrap:"wrap"}}>
      <div style={{flex:"1 1 420px"}}>
        <span className="eyebrow">C.Verse — Creator Verse</span>
        <h1 className="h1" style={{marginTop:8}}>Koleksi<br/><span style={{color:"var(--gold)"}}>Kreator Favoritmu</span></h1>
        <p className="muted" style={{marginTop:14,maxWidth:520}}>
          Kartu edisi terbatas dalam acrylic premium. Setiap kartu terverifikasi lewat NFC.
        </p>
        <div style={{display:"flex",gap:10,marginTop:20,flexWrap:"wrap"}}>
          <Link to="/drops" className="btn-gold" style={{padding:"11px 22px",borderRadius:99,fontWeight:700,display:"inline-flex", textDecoration:"none"}}>Jelajahi Drops</Link>
          <Link to="/marketplace" className="btn-ghost" style={{padding:"11px 22px",display:"inline-flex", textDecoration:"none"}}>Marketplace</Link>
        </div>
      </div>
      <div style={{flex:"0 0 280px",background:"var(--bg-card)",border:"1px solid var(--border)",borderRadius:14,padding:18, display:"flex", alignItems:"center", justifyContent:"center", minHeight:220}}>
        <div style={{width:160, height:220, borderRadius:12, background:"linear-gradient(135deg,#1a1a2e,#2a2040)", border:"1px solid rgba(212,168,67,0.25)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:56}}>🎴</div>
      </div>
    </div>
    <div className="grid-3">
      {[
        { icon:"🎴", title:"Fisik Premium", desc:"Acrylic hardcase 63×88mm, holo — koleksi yang bisa dipegang." },
        { icon:"🔐", title:"Terverifikasi", desc:"Tap NFC untuk keaslian kartu." },
        { icon:"🪙", title:"C-Coin", desc:"Transaksi mudah dengan C-Coin. 1 C-Coin = Rp 10.000." },
      ].map(c=> <div key={c.title} className="card card-pad">
        <div style={{fontSize:22}}>{c.icon}</div>
        <div style={{fontWeight:700,marginTop:8,fontSize:14}}>{c.title}</div>
        <div className="muted" style={{marginTop:6}}>{c.desc}</div>
      </div>)}
    </div>
    <div className="card card-pad" style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:12}}>
      <div><div style={{fontWeight:700}}>Mulai koleksimu</div><div className="muted">Drops terbaru dan koleksi kreator menantimu.</div></div>
      <div style={{display:"flex",gap:10}}><Link to="/drops" className="btn-gold">Lihat Drops</Link><Link to="/collection" className="btn-ghost">Koleksiku</Link></div>
    </div>
  </div>;
}

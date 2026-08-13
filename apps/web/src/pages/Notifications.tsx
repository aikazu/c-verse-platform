import React from "react";
import { Link } from "react-router-dom";
export default function Notifications(){
  return <div style={{maxWidth:560, margin:"0 auto", display:"flex", flexDirection:"column", gap:18}}>
    <div>
      <span className="eyebrow">Notifikasi</span>
      <h1 className="h2" style={{marginTop:4}}>Notifikasi</h1>
      <p className="muted" style={{marginTop:6}}>Belum ada notifikasi</p>
    </div>
    <div className="card card-pad" style={{textAlign:"center", padding:28}}>
      <div style={{fontSize:28, opacity:0.5}}>◷</div>
      <p className="muted" style={{marginTop:10, fontFamily:"var(--font-mono)", fontSize:12}}>Penawaran dan aktivitas akan muncul di sini</p>
    </div>
    <div style={{display:"flex", gap:8, justifyContent:"center"}}>
      <Link to="/browse" className="btn-ghost" style={{fontFamily:"var(--font-mono)", fontSize:12}}>Jelajahi</Link>
      <Link to="/marketplace" className="btn-ghost" style={{fontFamily:"var(--font-mono)", fontSize:12}}>Marketplace</Link>
    </div>
  </div>;
}

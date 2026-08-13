import React from "react";
import { Link } from "react-router-dom";
export default function Notifications(){
  return <div style={{maxWidth:640, margin:"0 auto", display:"flex", flexDirection:"column", gap:18}}>
    <div className="card card-pad">
      <h1 className="h2">Notifikasi</h1>
      <p className="muted" style={{fontSize:13, marginTop:8}}>Belum ada notifikasi</p>
    </div>
    <div style={{display:"flex", gap:8}}>
      <Link to="/browse" className="btn-ghost">Jelajahi</Link>
      <Link to="/marketplace" className="btn-ghost">Marketplace</Link>
    </div>
  </div>;
}

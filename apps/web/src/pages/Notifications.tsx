import React from "react";
import { Link } from "react-router-dom";
export default function Notifications(){
  return <div style={{maxWidth:640, margin:"0 auto", display:"flex", flexDirection:"column", gap:18}}>
    <div className="card card-pad">
      <span className="eyebrow">Notifikasi</span>
      <h1 className="h2" style={{marginTop:6}}>Notifikasi</h1>
      <p className="muted" style={{fontSize:13, marginTop:8}}>Email (SumoPod SMTP) + FCM push — anti-snipe manual: notif ke owner saat bid masuk; ke bidder saat buyout terambil (F013).</p>
    </div>
    <div className="card card-pad muted" style={{fontSize:13}}>Belum ada notifikasi. Notifikasi bid & buyout akan tampil di sini (serta email).</div>
    <div style={{display:"flex", gap:8}}>
      <Link to="/browse" className="btn-ghost">Browse →</Link>
      <Link to="/marketplace" className="btn-ghost">Marketplace →</Link>
    </div>
  </div>;
}

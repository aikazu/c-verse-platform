import React from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../lib/auth";

export default function Admin(){
  const { user } = useAuth();
  if(!user) return <div className="card card-pad" style={{textAlign:"center", padding:32}}><span className="eyebrow">Admin</span><p className="muted" style={{marginTop:8}}>Masuk untuk melanjutkan</p><Link to="/login" style={{color:"var(--gold)", fontSize:13, fontWeight:600, marginTop:10, display:"inline-block"}}>Masuk →</Link></div>;
  if((user.role as string)!=="admin") return <div className="card card-pad" style={{textAlign:"center", padding:32}}><p className="muted">Hanya admin yang bisa mengakses halaman ini</p></div>;
  return <div style={{display:"flex", flexDirection:"column", gap:20}}>
    <div>
      <span className="eyebrow">Admin</span>
      <h1 className="h2" style={{marginTop:4}}>Admin</h1>
      <p className="muted" style={{marginTop:6}}>Panel admin berjalan terpisah di admin.c-verse.co</p>
    </div>
    <div className="card card-pad">
      <div style={{display:"flex", gap:8, flexWrap:"wrap"}}>
        <Link to="/creator" className="btn-ghost" style={{fontFamily:"var(--font-mono)", fontSize:12}}>Kreator</Link>
        <Link to="/drops" className="btn-ghost" style={{fontFamily:"var(--font-mono)", fontSize:12}}>Drops</Link>
      </div>
    </div>
  </div>;
}

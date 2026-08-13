import React from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../lib/auth";

export default function Admin(){
  const { user } = useAuth();
  if(!user) return <div className="card card-pad">Masuk untuk melanjutkan.</div>;
  if((user.role as string)!=="admin") return <div className="card card-pad">Hanya admin yang bisa mengakses halaman ini.</div>;
  return <div style={{display:"flex", flexDirection:"column", gap:18}}>
    <div className="card card-pad">
      <h1 className="h2">Admin</h1>
      <p className="muted" style={{fontSize:13, marginTop:8}}>Panel admin berjalan terpisah di admin.c-verse.co</p>
      <div style={{display:"flex", gap:8, flexWrap:"wrap", marginTop:14}}>
        <Link to="/creator" className="btn-ghost">Kreator</Link>
        <Link to="/drops" className="btn-ghost">Drops</Link>
      </div>
    </div>
  </div>;
}

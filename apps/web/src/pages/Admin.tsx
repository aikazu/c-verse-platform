import React from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../lib/auth";

export default function Admin(){
  const { user } = useAuth();
  if(!user) return <div className="card card-pad" style={{textAlign:"center", padding:32}}><span className="eyebrow">Admin</span><p className="muted" style={{marginTop:8}}>Masuk untuk melanjutkan</p><Link to="/login" style={{color:"var(--gold)", fontSize:13, fontWeight:600, marginTop:10, display:"inline-block"}}>Masuk →</Link></div>;
  if(((user as unknown as { role:string }).role)!=="admin") return <div className="card card-pad" style={{textAlign:"center", padding:32}}><p className="muted">Hanya admin yang bisa mengakses halaman ini</p></div>;
  return <div style={{display:"flex", flexDirection:"column", gap:20}}>
    <div>
      <span className="eyebrow">Admin</span>
      <h1 className="h2" style={{marginTop:4}}>Admin</h1>
      <p className="muted" style={{marginTop:6}}>Tidak ada route admin di app publik. Admin berjalan terpisah di <code style={{fontFamily:"var(--font-mono)", color:"var(--gold)"}}>admin.c-verse.co</code> (VPS + Cloudflare Tunnel + Access + 2FA TOTP aal2) — lihat <code style={{fontFamily:"var(--font-mono)", fontSize:11}}>apps/admin/README.md</code>.</p>
    </div>
    <div className="card card-pad" style={{borderLeft:"4px solid rgba(201,163,82,0.35)"}}>
      <div style={{fontWeight:700, fontSize:13}}>Akses Admin</div>
      <p className="muted" style={{fontSize:12, marginTop:6, lineHeight:1.6}}>Admin app terpisah — tidak di Pages/Workers publik (<code>docs/06-tech-decisions.md</code> D1). Jalankan <code style={{fontFamily:"var(--font-mono)"}}>pnpm --filter @c-verse/admin dev</code> di VPS/mesin admin (port 3000) + Tunnel <code>admin.c-verse.co</code> + Cloudflare Access. Service-role HANYA di admin; anon + RLS di app publik.</p>
      <div style={{display:"flex", gap:8, flexWrap:"wrap", marginTop:12}}>
        <span className="pill pill-info" style={{fontSize:10}}>2FA TOTP wajib (aal2)</span>
        <span className="pill pill-warn" style={{fontSize:10}}>audit log append-only ≥1 thn</span>
      </div>
    </div>
    <div className="card card-pad">
      <div style={{fontFamily:"var(--font-mono)", fontSize:11, color:"var(--text-dim)", letterSpacing:"0.08em", textTransform:"uppercase", marginBottom:10}}>Pintasan (publik)</div>
      <div style={{display:"flex", gap:8, flexWrap:"wrap"}}>
        <Link to="/creator" className="btn-ghost" style={{fontFamily:"var(--font-mono)", fontSize:12}}>Kreator</Link>
        <Link to="/drops" className="btn-ghost" style={{fontFamily:"var(--font-mono)", fontSize:12}}>Drops</Link>
      </div>
    </div>
  </div>;
}

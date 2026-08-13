import React from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../lib/auth";

export default function Admin(){
  const { user } = useAuth();
  if(!user) return <div className="card card-pad">Login dulu.</div>;
  if((user.role as string)!=="admin") return <div className="card card-pad">Hanya admin. Role kamu: {user.role}. Login sebagai <code>admin@cverse.id / admin123</code>.</div>;
  return <div style={{display:"flex", flexDirection:"column", gap:18}}>
    <div className="card card-pad" style={{borderLeft:"4px solid var(--gold)"}}>
      <span className="eyebrow">Admin - App Terpisah</span>
      <h1 className="h2" style={{marginTop:6}}>Admin Panel (Public App - Ringkas)</h1>
      <p className="muted" style={{fontSize:13, marginTop:8}}>
        Admin dashboard canonical adalah <b>app terpisah</b> (<code>apps/admin</code> — lokal / VPS + Cloudflare Access + 2FA TOTP wajib + audit log append-only, lihat <code>docs/06-tech-decisions.md</code> D1 & <code>docs/08-deployment.md</code> section 3.5).
        Halaman ini hanya pintasan ringkas di <code>apps/web</code> untuk demo - tidak ada route admin di API publik.
      </p>
      <div style={{display:"flex", gap:8, flexWrap:"wrap", marginTop:14}}>
        <Link to="/creator" className="btn-ghost">Creator Dashboard</Link>
        <Link to="/drops" className="btn-ghost">Drops</Link>
        <Link to="/me/kyc" className="btn-ghost">KYC Queue</Link>
      </div>
    </div>
    <div className="card card-pad">
      <div style={{fontWeight:700, marginBottom:8}}>Menjalankan admin app terpisah</div>
      <pre style={{background:"var(--bg-elevated)", padding:12, borderRadius:8, fontSize:11, overflow:"auto"}}>{"pnpm --filter @c-verse/admin dev   # :3000\n# .env: VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY (anon - RLS), admin service-role HANYA di server/VPS\n# Cloudflare Tunnel + Access di depan admin.c-verse.co"}</pre>
      <div className="muted" style={{fontSize:11, marginTop:8}}>App <code>apps/admin</code> dibuat di task iterasi ini - lihat <code>apps/admin/README.md</code> untuk setup Access + 2FA + audit log.</div>
    </div>
  </div>;
}

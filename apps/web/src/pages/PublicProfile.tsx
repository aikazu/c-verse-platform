import React from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";

function LevelBar({ level, tier, pct }:{ level:number; tier:string; pct:number }){
  return <div style={{marginTop:10}}>
    <div style={{display:"flex", justifyContent:"space-between", alignItems:"baseline"}}>
      <div style={{fontWeight:700, fontSize:13}}>Level {level} <span style={{fontWeight:400, fontSize:11, color:"var(--muted)"}}>· {tier}</span></div>
      <div style={{fontSize:11, color:"var(--muted)"}}>10 XP = 1 Level</div>
    </div>
    <div className="progress" style={{height:8, marginTop:6}}><div className="progress-fill" style={{width: pct+"%"}} /></div>
  </div>;
}

export default function PublicProfile(){
  const { username } = useParams();
  const { data, isLoading } = useQuery({ queryKey:["public-profile", username], queryFn:()=> api.publicProfile(username!), enabled: !!username });
  if(isLoading) return <div className="muted">Memuat profil...</div>;
  if(!data) return <div className="card card-pad">Profil tidak ditemukan.</div>;
  const d:any = data as any;
  if(d.hidden){ return <div className="card card-pad" style={{textAlign:"center"}}><div style={{fontSize:40, marginBottom:8}}>🙈</div><div style={{fontWeight:700}}>Profil disembunyikan</div><div className="muted" style={{fontSize:13, marginTop:6}}>Pemilik mengaktifkan privacy anonymous.</div><div className="muted" style={{fontSize:12, marginTop:4}}>@{d.user?.username ?? username}</div></div>; }
  const user = d.user;
  const cards:any[] = d.cards ?? [];
  const badges:any[] = d.badges ?? [];
  return <div style={{display:"flex", flexDirection:"column", gap:18}}>
    <div className="card card-pad">
      <h1 className="h2">@{user.username ?? username} — {user.displayName}</h1>
      <LevelBar level={user.level} tier={user.tier} pct={user.levelProgressPct ?? 0} />
      <div className="muted" style={{fontSize:11, marginTop:6}}>Ranking #{user.rank} · {cards.length} kartu · {badges.length} badge</div>
      {badges.length>0 && <div style={{display:"flex", gap:6, flexWrap:"wrap", marginTop:10}}>{badges.map((ub:any)=> <span key={ub.badgeId} className="pill pill-warn" style={{fontSize:11}}>{ub.badge?.icon} {ub.badge?.name}</span>)}</div>}
    </div>
    {cards.length===0 ? <div className="card card-pad muted">Belum ada kartu di koleksi publik.</div> :
      <div className="grid-3">
        {cards.map((c:any)=> <Link key={c.id} to={"/cards/"+c.id} className="card" style={{overflow:"hidden", textDecoration:"none", color:"inherit"}}>
          <div style={{height:120, background:"linear-gradient(135deg,#1a1a2e,#2a2040)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:28}}>🎴</div>
          <div style={{padding:10}}><div style={{fontWeight:700, fontSize:12}}>{c.drop?.title ?? c.dropId} · #{c.unitNumber}</div><div style={{fontSize:11, color:"var(--muted)"}}>{c.drop?.series}</div></div>
        </Link>)}
      </div>}
  </div>;
}

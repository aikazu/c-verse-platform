import React from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";

export default function CreatorPage(){
  const { username } = useParams();
  const { data, isLoading } = useQuery({ queryKey:["creator-pub", username], queryFn:()=> api.creatorPublic(username!), enabled: !!username });
  if(isLoading) return <div className="muted" style={{padding:24, textAlign:"center"}}>Memuat…</div>;
  if(!data) return <div className="card card-pad" style={{textAlign:"center", padding:32}}><p className="muted">Kreator tidak ditemukan</p></div>;
  const c:any = data as any;
  const creator = c.creator ?? c;
  const drops:any[] = c.drops ?? [];
  return <div style={{display:"flex", flexDirection:"column", gap:20}}>
    <div className="card card-pad">
      <span className="eyebrow">Kreator</span>
      <h1 className="h2" style={{marginTop:4}}>{creator.displayName}</h1>
      <div style={{fontFamily:"var(--font-mono)", fontSize:12, color:"var(--text-muted)", marginTop:4}}>@{creator.username ?? creator.handle ?? creator.id}</div>
    </div>
    <div>
      <div style={{fontFamily:"var(--font-mono)", fontSize:11, fontWeight:500, letterSpacing:"0.08em", textTransform:"uppercase", color:"var(--text-dim)", marginBottom:12}}>Koleksi — {drops.length}</div>
      {drops.length===0 ? <div className="card card-pad muted" style={{textAlign:"center", padding:24, fontFamily:"var(--font-mono)", fontSize:12}}>Belum ada koleksi</div> :
      <div className="grid-3">
        {drops.map((d:any)=> <Link key={d.id} to={"/drops/"+d.id} className="card" style={{overflow:"hidden", textDecoration:"none", color:"inherit"}}>
          <div style={{height:140, background:"linear-gradient(135deg,#14141a,#1e1e34)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:36}}>🎴</div>
          <div style={{padding:12}}>
            <div style={{fontWeight:600, fontSize:13}}>{d.title}</div>
            <div style={{fontFamily:"var(--font-mono)", fontSize:11, color:"var(--text-muted)"}}>{d.series}</div>
            <span className="pill pill-info" style={{marginTop:8, display:"inline-block", fontSize:10}}>{d.status}</span>
          </div>
        </Link>)}
      </div>}
    </div>
  </div>;
}

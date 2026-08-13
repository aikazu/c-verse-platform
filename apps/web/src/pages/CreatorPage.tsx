import React from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";

export default function CreatorPage(){
  const { username } = useParams();
  const { data, isLoading } = useQuery({ queryKey:["creator-pub", username], queryFn:()=> api.creatorPublic(username!), enabled: !!username });
  if(isLoading) return <div className="muted">Memuat kreator...</div>;
  if(!data) return <div className="card card-pad">Kreator tidak ditemukan.</div>;
  const c:any = data as any;
  const creator = c.creator ?? c;
  const drops:any[] = c.drops ?? [];
  return <div style={{display:"flex", flexDirection:"column", gap:18}}>
    <div className="card card-pad">
      <div style={{fontSize:12, color:"var(--gold)", fontWeight:700, letterSpacing:"0.06em"}}>KREATOR</div>
      <h1 className="h2" style={{marginTop:4}}>{creator.displayName}</h1>
      <div className="muted" style={{fontSize:13}}>@{creator.username ?? creator.handle ?? creator.id} {creator.handle ? "· handle: "+creator.handle : ""}</div>
      <div className="muted" style={{fontSize:12, marginTop:6}}>Jumlah follower TIDAK ditampilkan (privasi kreator = identitas publik; list drop saja — per docs/02 PG-CRT-PUB-01).</div>
    </div>
    <div>
      <div style={{fontWeight:700, marginBottom:10}}>Drops — {drops.length}</div>
      {drops.length===0 ? <div className="card card-pad muted">Belum ada drop.</div> :
      <div className="grid-3">
        {drops.map((d:any)=> <Link key={d.id} to={"/drops/"+d.id} className="card" style={{overflow:"hidden", textDecoration:"none", color:"inherit"}}>
          <div style={{height:140, background:"linear-gradient(135deg,#1a1a2e,#2a2040)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:36}}>🎴</div>
          <div style={{padding:12}}>
            <div style={{fontWeight:700, fontSize:13}}>{d.title}</div>
            <div style={{fontSize:11, color:"var(--muted)"}}>{d.series}</div>
            <span className="pill pill-info" style={{marginTop:6, display:"inline-block"}}>{d.status}</span>
          </div>
        </Link>)}
      </div>}
    </div>
  </div>;
}

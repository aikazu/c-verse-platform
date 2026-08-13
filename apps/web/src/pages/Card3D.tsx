import React, { useRef } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useCardViewer } from "../lib/viewer";

export default function Card3D(){
  const { cardId } = useParams();
  const viewerRef = useRef<HTMLDivElement>(null);
  const { data, isLoading } = useQuery({ queryKey:["card3d", cardId], queryFn:()=> api.card3d(cardId!), enabled: !!cardId });
  const artwork = (data as any)?.drop?.artwork3dUrl ?? (data as any)?.drop?.artworkUrl ?? null;
  useCardViewer(viewerRef as any, artwork);
  if(isLoading) return <div className="muted" style={{padding:24, textAlign:"center"}}>Memuat…</div>;
  if(!data) return <div className="card card-pad" style={{textAlign:"center", padding:32}}><span className="eyebrow">3D</span><p className="muted" style={{marginTop:8}}>Kartu tidak ditemukan</p></div>;
  const d:any = data as any;
  const card = d.card ?? d;
  return <div style={{display:"flex", flexDirection:"column", gap:16}}>
    <Link to={"/cards/"+(card.id ?? cardId)} style={{fontFamily:"var(--font-mono)", fontSize:12, color:"var(--text-muted)"}}>← Kembali</Link>
    <div className="card" style={{overflow:"hidden"}}>
      <div ref={viewerRef} style={{height:420, background:"#08080a"}} />
      <div className="card-pad">
        <div style={{display:"flex", gap:8, flexWrap:"wrap", alignItems:"center"}}>
          {d.verifiedBadge ? <span className="pill pill-success" style={{fontWeight:600}}>✓ {d.verifiedBadge}</span> : <span className="pill pill-warn">Terverifikasi via NFC</span>}
          <span className="pill pill-info" style={{fontFamily:"var(--font-mono)"}}>#{card.unitNumber ?? "?"}</span>
        </div>
        <div style={{marginTop:14, display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, fontSize:13}}>
          {d.drop && <div><span style={{fontFamily:"var(--font-mono)", fontSize:10, color:"var(--text-dim)", letterSpacing:"0.08em", textTransform:"uppercase"}}>Seri</span><br/><Link to={d.seriesLink ?? "/drops/"+d.drop.id} style={{color:"var(--gold)", fontWeight:500, fontSize:13}}>{d.drop.series ?? d.drop.title}</Link></div>}
          <div><span style={{fontFamily:"var(--font-mono)", fontSize:10, color:"var(--text-dim)", letterSpacing:"0.08em", textTransform:"uppercase"}}>Nomor</span><br/><span style={{fontWeight:500}}>#{card.unitNumber} dari {card.totalUnits ?? "?"}</span></div>
          {d.creator && <div><span style={{fontFamily:"var(--font-mono)", fontSize:10, color:"var(--text-dim)", letterSpacing:"0.08em", textTransform:"uppercase"}}>Kreator</span><br/><Link to={d.creator.link} style={{color:"var(--gold)", fontWeight:500}}>{d.creator.name}</Link></div>}
          {d.owner && <div><span style={{fontFamily:"var(--font-mono)", fontSize:10, color:"var(--text-dim)", letterSpacing:"0.08em", textTransform:"uppercase"}}>Pemilik</span><br/><Link to={d.owner.link} style={{color:"var(--gold)", fontWeight:500}}>{d.owner.name}</Link></div>}
        </div>
      </div>
    </div>
  </div>;
}

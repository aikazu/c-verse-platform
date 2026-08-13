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
  if(isLoading) return <div className="muted">Memuat...</div>;
  if(!data) return <div className="card card-pad">Kartu tidak ditemukan.</div>;
  const d:any = data as any;
  const card = d.card ?? d;
  return <div style={{display:"flex", flexDirection:"column", gap:16}}>
    <Link to={"/cards/"+(card.id ?? cardId)} style={{fontSize:13, color:"var(--muted)"}}>← Kembali</Link>
    <div className="card" style={{overflow:"hidden"}}>
      <div ref={viewerRef} style={{height:420, background:"#0b0b14"}} />
      <div className="card-pad">
        <div style={{display:"flex", gap:8, flexWrap:"wrap", alignItems:"center"}}>
          {d.verifiedBadge ? <span className="pill pill-success" style={{fontWeight:800}}>✓ {d.verifiedBadge}</span> : <span className="pill pill-warn">Terverifikasi via NFC</span>}
          <span className="pill pill-info">#{card.unitNumber ?? "?"}</span>
        </div>
        <div style={{marginTop:12, display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, fontSize:13}}>
          {d.drop && <div><span className="muted">Seri</span><br/><Link to={d.seriesLink ?? "/drops/"+d.drop.id} style={{color:"var(--gold)"}}>{d.drop.series ?? d.drop.title}</Link></div>}
          <div><span className="muted">Nomor</span><br/>#{card.unitNumber} dari {card.totalUnits ?? "?"}</div>
          {d.creator && <div><span className="muted">Kreator</span><br/><Link to={d.creator.link} style={{color:"var(--gold)"}}>{d.creator.name}</Link></div>}
          {d.owner && <div><span className="muted">Pemilik</span><br/><Link to={d.owner.link} style={{color:"var(--gold)"}}>{d.owner.name}</Link></div>}
        </div>
      </div>
    </div>
  </div>;
}

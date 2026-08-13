import React from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";

export default function CardInfo(){
  const { cardId } = useParams();
  const { data, isLoading } = useQuery({ queryKey:["card", cardId], queryFn:()=> api.card(cardId!), enabled: !!cardId });
  if(isLoading) return <div className="muted" style={{padding:24, textAlign:"center"}}>Memuat…</div>;
  if(!data) return <div className="card card-pad" style={{textAlign:"center", padding:32}}><span className="eyebrow">Kartu</span><p className="muted" style={{marginTop:8}}>Kartu tidak ditemukan</p></div>;
  const c:any = data as any;
  const card = c.card ?? c;
  const drop = c.drop;
  const owner = c.owner;
  const activeBid = c.activeBid;
  const history:any[] = c.ownershipHistory ?? [];
  const bids:any[] = c.bids ?? [];
  return <div style={{display:"flex", flexDirection:"column", gap:20}}>
    <Link to="/browse" style={{fontFamily:"var(--font-mono)", fontSize:12, color:"var(--text-muted)", letterSpacing:"0.04em"}}>← Jelajahi</Link>
    <div className="grid-2" style={{alignItems:"start"}}>
      <div className="card" style={{overflow:"hidden"}}>
        <div style={{aspectRatio:"4/3", background:"linear-gradient(135deg,#14141a,#1e1e34)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:64}}>🎴</div>
        <div className="card-pad">
          <span className="eyebrow">{drop?.series ?? "Kartu"}</span>
          <div style={{fontFamily:"var(--font-display)", fontSize:18, fontWeight:500, marginTop:4}}>#{card.unitNumber} <em style={{fontStyle:"italic", fontWeight:300, color:"var(--gold)"}}>· {card.variant}</em></div>
          <div className="muted" style={{fontSize:12, marginTop:2}}>{drop?.title ?? ""}</div>
          <Link to={"/cards/"+card.id+"/3d"} className="btn-gold" style={{display:"block", textAlign:"center", textDecoration:"none", marginTop:16, padding:"11px"}}>Lihat 3D →</Link>
        </div>
      </div>
      <div style={{display:"flex", flexDirection:"column", gap:14}}>
        <div className="card card-pad">
          <span className="eyebrow">Info</span>
          <div style={{display:"flex", flexDirection:"column", gap:8, marginTop:10}}>
            {drop && <div style={{fontSize:13}}><span style={{fontFamily:"var(--font-mono)", fontSize:11, color:"var(--text-dim)", letterSpacing:"0.06em", textTransform:"uppercase"}}>Seri</span><br/><Link to={"/drops/"+drop.id} style={{color:"var(--gold)", fontWeight:500, fontSize:13}}>{drop.series}</Link></div>}
            <div style={{fontFamily:"var(--font-mono)", fontSize:12, color:"var(--text-muted)"}}>Nomor #{card.unitNumber} · {card.variant}</div>
            {owner && <div style={{fontSize:13}}><span style={{fontFamily:"var(--font-mono)", fontSize:11, color:"var(--text-dim)"}}>Pemilik</span> <Link to={"/u/"+(owner.username ?? owner.id)} style={{color:"var(--gold)", fontWeight:500}}>{owner.displayName ?? owner.id}</Link></div>}
            {card.buyoutPriceCcoin ? <div style={{marginTop:6, padding:"10px 12px", background:"var(--surface-2)", borderRadius:8, border:"1px solid var(--border)"}}><span style={{fontFamily:"var(--font-mono)", fontSize:10, color:"var(--text-dim)", letterSpacing:"0.08em"}}>HARGA</span><div style={{fontWeight:700, fontSize:15, marginTop:2}}>{card.buyoutPriceCcoin} C</div></div> : null}
            {activeBid && <div style={{padding:"10px 12px", background:"rgba(201,163,82,0.08)", borderRadius:8, fontSize:13, border:"1px solid rgba(201,163,82,0.18)"}}><span style={{fontFamily:"var(--font-mono)", fontSize:10, color:"var(--gold)", letterSpacing:"0.06em"}}>TAWARAN TERTINGGI</span><div style={{fontWeight:600, marginTop:4}}>{activeBid.amountCCoin} C <span style={{fontWeight:400, color:"var(--text-muted)", fontSize:12}}>oleh {activeBid.bidderName}</span></div></div>}
          </div>
        </div>
        <div className="card">
          <div style={{padding:"14px 16px", borderBottom:"1px solid var(--border)", display:"flex", justifyContent:"space-between", alignItems:"center"}}>
            <span style={{fontWeight:600, fontSize:13}}>Riwayat Pemilik</span>
            <span style={{fontFamily:"var(--font-mono)", fontSize:11, color:"var(--text-dim)"}}>{history.length}</span>
          </div>
          {history.length===0 ? <div style={{padding:20, textAlign:"center", color:"var(--text-muted)", fontFamily:"var(--font-mono)", fontSize:12}}>Belum ada riwayat</div> :
            <div style={{padding:12, display:"flex", flexDirection:"column", gap:0}}>
              {history.map((h:any)=> <div key={h.id} style={{display:"flex", justifyContent:"space-between", padding:"8px 0", borderBottom:"1px solid var(--border)", fontSize:12}}><span style={{fontWeight:500}}>{h.ownerName ?? h.ownerId}</span><span style={{fontFamily:"var(--font-mono)", fontSize:11, color:"var(--text-muted)"}}>{new Date(h.transferredAt).toLocaleDateString("id-ID")}</span></div>)}
            </div>}
        </div>
        <div className="card">
          <div style={{padding:"14px 16px", borderBottom:"1px solid var(--border)", display:"flex", justifyContent:"space-between", alignItems:"center"}}>
            <span style={{fontWeight:600, fontSize:13}}>Riwayat Penawaran</span>
            <span style={{fontFamily:"var(--font-mono)", fontSize:11, color:"var(--text-dim)"}}>{bids.length}</span>
          </div>
          {bids.length===0 ? <div style={{padding:20, textAlign:"center", color:"var(--text-muted)", fontFamily:"var(--font-mono)", fontSize:12}}>Belum ada penawaran</div> :
            <div style={{padding:12, display:"flex", flexDirection:"column", gap:0}}>
              {bids.slice(0,10).map((b:any)=> <div key={b.id} style={{display:"flex", justifyContent:"space-between", padding:"8px 0", borderBottom:"1px solid var(--border)", fontSize:12}}><span>{b.bidderName} · <span style={{fontFamily:"var(--font-mono)", fontWeight:600}}>{b.amountCCoin} C</span></span><span style={{fontFamily:"var(--font-mono)", fontSize:11, color:"var(--text-muted)"}}>{new Date(b.createdAt).toLocaleDateString("id-ID")}</span></div>)}
            </div>}
        </div>
      </div>
    </div>
  </div>;
}

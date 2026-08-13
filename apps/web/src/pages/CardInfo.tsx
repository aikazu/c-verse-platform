import React from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";

export default function CardInfo(){
  const { cardId } = useParams();
  const { data, isLoading } = useQuery({ queryKey:["card", cardId], queryFn:()=> api.card(cardId!), enabled: !!cardId });
  if(isLoading) return <div className="muted">Memuat kartu...</div>;
  if(!data) return <div className="card card-pad">Kartu tidak ditemukan.</div>;
  const c:any = data as any;
  const card = c.card ?? c;
  const drop = c.drop;
  const owner = c.owner;
  const activeBid = c.activeBid;
  const history:any[] = c.ownershipHistory ?? [];
  const bids:any[] = c.bids ?? [];
  return <div style={{display:"flex", flexDirection:"column", gap:18}}>
    <Link to="/browse" style={{fontSize:13, color:"var(--muted)"}}>← Browse</Link>
    <div className="grid-2" style={{alignItems:"start"}}>
      <div className="card" style={{overflow:"hidden"}}>
        <div style={{aspectRatio:"4/3", background:"linear-gradient(135deg,#1a1a2e,#2a2040)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:64}}>🎴</div>
        <div className="card-pad">
          <div style={{display:"flex", gap:8, flexWrap:"wrap"}}>
            <span className={"pill "+(card.verifyStatus==="verified"?"pill-success": card.verifyStatus==="tamper_detected"?"pill-danger":"pill-warn")}>{card.verifyStatus}</span>
            {card.buyoutPriceCcoin ? <span className="pill pill-warn">Buyout {card.buyoutPriceCcoin} C</span> : null}
            <span className="pill pill-info">{card.location ?? card.status}</span>
          </div>
          <div style={{marginTop:12, fontWeight:700}}>{drop?.series ?? ""} · #{card.unitNumber} · {card.variant}</div>
          <div className="muted" style={{fontSize:12}}>{drop?.title ?? ""}</div>
          <div style={{display:"flex", gap:8, marginTop:12}}>
            <Link to={"/cards/"+card.id+"/3d"} className="btn-gold" style={{textDecoration:"none", textAlign:"center", flex:1}}>Buka Halaman 3D (Verified Badge)</Link>
          </div>
          <div className="muted" style={{fontSize:11, marginTop:8}}>ShortID: {card.nfcShortId} · QR di dus = Registered (tanpa CMAC, lebih lemah)</div>
        </div>
      </div>
      <div style={{display:"flex", flexDirection:"column", gap:14}}>
        <div className="card card-pad">
          <div style={{fontWeight:700, marginBottom:8}}>Info Kartu</div>
          {drop && <div className="muted" style={{fontSize:13}}>Series: <Link to={"/drops/"+drop.id} style={{color:"var(--gold)"}}>{drop.series}</Link></div>}
          <div className="muted" style={{fontSize:13}}>Unit: #{card.unitNumber} dari {c.drop?.totalUnits ?? "?"} · Variant: {card.variant}</div>
          {owner && <div className="muted" style={{fontSize:13}}>Owner: <Link to={"/u/"+(owner.username ?? owner.id)} style={{color:"var(--gold)"}}>{owner.displayName ?? owner.id}</Link></div>}
          {activeBid && <div style={{marginTop:10, padding:"10px 12px", background:"rgba(255,215,0,0.08)", borderRadius:8, fontSize:13}}><b>Bid tertinggi (active):</b> {activeBid.amountCCoin} C-Coin oleh {activeBid.bidderName} — 1 active per kartu; outbid/cancel release otomatis.</div>}
          {card.buyoutPriceCcoin && <div style={{marginTop:10, fontSize:13}}><b>Buyout price:</b> {card.buyoutPriceCcoin} C-Coin — tampil di Marketplace.</div>}
        </div>
        <div className="card">
          <div style={{padding:"12px 14px", fontWeight:700, borderBottom:"1px solid var(--border)"}}>Jejak Ownership (provenance)</div>
          {history.length===0 ? <div style={{padding:14, color:"var(--muted)", fontSize:13}}>Belum ada history.</div> :
            <div style={{padding:12, display:"flex", flexDirection:"column", gap:8}}>
              {history.map((h:any)=> <div key={h.id} style={{display:"flex", justifyContent:"space-between", fontSize:12}}><span>{h.ownerName ?? h.ownerId} — {h.acquiredVia}</span><span className="muted">{new Date(h.transferredAt).toLocaleDateString("id-ID")}</span></div>)}
            </div>}
          <div className="muted" style={{fontSize:11, padding:"0 14px 12px"}}>Ownership history TIDAK di halaman 3D — hanya di sini (PG-CARD-01).</div>
        </div>
        <div className="card">
          <div style={{padding:"12px 14px", fontWeight:700, borderBottom:"1px solid var(--border)"}}>Riwayat Bid (90 hari / accepted selamanya)</div>
          {bids.length===0 ? <div style={{padding:14, color:"var(--muted)", fontSize:13}}>Belum ada bid.</div> :
            <div style={{padding:12, display:"flex", flexDirection:"column", gap:6}}>
              {bids.slice(0,10).map((b:any)=> <div key={b.id} style={{display:"flex", justifyContent:"space-between", fontSize:12}}><span>{b.bidderName} — {b.amountCCoin} C — {b.status}</span><span className="muted">{new Date(b.createdAt).toLocaleDateString("id-ID")}</span></div>)}
            </div>}
        </div>
      </div>
    </div>
  </div>;
}

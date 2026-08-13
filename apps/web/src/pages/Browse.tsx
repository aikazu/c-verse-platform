import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api, formatIdr } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useToast } from "../lib/toast";

export default function Browse(){
  const { user } = useAuth();
  const { push } = useToast();
  const [q, setQ] = useState("");
  const [bidAmt, setBidAmt] = useState<Record<string,number>>({});
  const { data, refetch, isLoading } = useQuery({ queryKey:["browse", q], queryFn:()=> api.browse(q ? {q} : undefined) });
  const cards:any[] = (data as any)?.cards ?? (data as any)?.results ?? [];
  async function onBid(cardId:string){
    if(!user){ push("Login untuk bid","info"); return; }
    const amt = bidAmt[cardId] ?? 10;
    if(amt < 1){ push("Bid minimal 1 C-Coin","info"); return; }
    try{ await api.placeBid(cardId, amt); push(`Bid ${amt} C-Coin dikirim — C-Coin di-hold (outbid release otomatis)`, "success"); refetch(); }catch(e:any){ push(e.message,"error"); }
  }
  return <div style={{display:"flex", flexDirection:"column", gap:18}}>
    <div>
      <span className="eyebrow">Secondary — Browse</span>
      <h1 className="h2">Browse Kartu — Bid Langsung di Kartu</h1>
      <p className="muted">Cari kartu / kreator, bid walau owner tidak pasang harga. 1 active tertinggi per kartu; bid lebih tinggi outbid + C-Coin balik otomatis; cancel release; owner accept only (tanpa reject); tanpa expire.</p>
    </div>
    <div style={{display:"flex", gap:8}}>
      <input className="input" placeholder="Cari kartu, series, kreator..." value={q} onChange={e=> setQ(e.target.value)} style={{flex:1}} />
      <button className="btn-ghost" onClick={()=> refetch()}>Cari</button>
    </div>
    {isLoading ? <div className="muted">Memuat...</div> : cards.length===0 ? <div className="card card-pad muted">Tidak ada hasil. Coba kata kunci lain.</div> :
      <div className="grid-3">
        {cards.map((r:any)=> {
          const card = r.card ?? r;
          const drop = r.drop;
          const activeBid = r.activeBid;
          return <div key={card.id} className="card" style={{overflow:"hidden"}}>
            <div style={{height:140, background:"linear-gradient(135deg,#1a1a2e,#2a2040)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:36}}>🎴</div>
            <div style={{padding:12, display:"flex", flexDirection:"column", gap:6}}>
              <div style={{fontWeight:700, fontSize:13}}>{drop?.title ?? card.id} · #{card.unitNumber} {card.variant}</div>
              <div style={{fontSize:11, color:"var(--muted)"}}>{drop?.series} {card.buyoutPriceCcoin ? "· Buyout "+card.buyoutPriceCcoin+" C" : ""}</div>
              <div style={{display:"flex", gap:6, flexWrap:"wrap"}}>
                {card.buyoutPriceCcoin ? <span className="pill pill-warn">{card.buyoutPriceCcoin} C buyout</span> : <span className="pill pill-info">No buyout — bisa bid</span>}
                {activeBid ? <span className="pill pill-success">Active bid {activeBid.amountCCoin} C</span> : null}
              </div>
              <div style={{display:"flex", gap:6, marginTop:6}}>
                <Link to={"/cards/"+card.id} className="btn-ghost" style={{flex:1, textAlign:"center", textDecoration:"none", padding:"6px 8px", fontSize:12}}>Info</Link>
                <Link to={"/cards/"+card.id+"/3d"} className="btn-ghost" style={{flex:1, textAlign:"center", textDecoration:"none", padding:"6px 8px", fontSize:12}}>3D</Link>
              </div>
              <div style={{display:"flex", gap:6, marginTop:6}}>
                <input className="input" type="number" min={1} placeholder="C-Coin" value={bidAmt[card.id] ?? ""} onChange={e=> setBidAmt(s=> ({...s,[card.id]: Number(e.target.value)}))} style={{flex:1, fontSize:12}} />
                <button className="btn-gold" onClick={()=> onBid(card.id)} style={{padding:"6px 12px", fontSize:12}}>Bid</button>
              </div>
              {activeBid && <div style={{fontSize:11, color:"var(--muted)"}}>Active: {activeBid.amountCCoin} C oleh {activeBid.bidderName}</div>}
            </div>
          </div>;
        })}
      </div>}
  </div>;
}

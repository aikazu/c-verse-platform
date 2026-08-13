import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
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
    if(!user){ push("Masuk untuk menawar","info"); return; }
    const amt = bidAmt[cardId] ?? 10;
    if(amt < 1){ push("Minimal 1 C-Coin","info"); return; }
    try{ await api.placeBid(cardId, amt); push(`Penawaran ${amt} C-Coin terkirim`, "success"); refetch(); }catch(e:any){ push(e.message,"error"); }
  }
  return <div style={{display:"flex", flexDirection:"column", gap:18}}>
    <div>
      <h1 className="h2">Jelajahi Kartu</h1>
      <p className="muted">Temukan kartu dan ajukan penawaran</p>
    </div>
    <div style={{display:"flex", gap:8}}>
      <input className="input" placeholder="Cari kartu, seri, kreator..." value={q} onChange={e=> setQ(e.target.value)} style={{flex:1}} />
      <button className="btn-ghost" onClick={()=> refetch()}>Cari</button>
    </div>
    {isLoading ? <div className="muted">Memuat...</div> : cards.length===0 ? <div className="card card-pad muted">Tidak ada hasil</div> :
      <div className="grid-3">
        {cards.map((r:any)=> {
          const card = r.card ?? r;
          const drop = r.drop;
          const activeBid = r.activeBid;
          return <div key={card.id} className="card" style={{overflow:"hidden"}}>
            <div style={{height:140, background:"linear-gradient(135deg,#1a1a2e,#2a2040)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:36}}>🎴</div>
            <div style={{padding:12, display:"flex", flexDirection:"column", gap:6}}>
              <div style={{fontWeight:700, fontSize:13}}>{drop?.title ?? card.id} · #{card.unitNumber}</div>
              <div style={{fontSize:11, color:"var(--muted)"}}>{drop?.series}</div>
              {activeBid ? <span className="pill pill-success" style={{alignSelf:"start"}}>Tawaran tertinggi {activeBid.amountCCoin} C</span> : null}
              <div style={{display:"flex", gap:6, marginTop:6}}>
                <Link to={"/cards/"+card.id} className="btn-ghost" style={{flex:1, textAlign:"center", textDecoration:"none", padding:"6px 8px", fontSize:12}}>Detail</Link>
              </div>
              <div style={{display:"flex", gap:6, marginTop:6}}>
                <input className="input" type="number" min={1} placeholder="C-Coin" value={bidAmt[card.id] ?? ""} onChange={e=> setBidAmt(s=> ({...s,[card.id]: Number(e.target.value)}))} style={{flex:1, fontSize:12}} />
                <button className="btn-gold" onClick={()=> onBid(card.id)} style={{padding:"6px 12px", fontSize:12}}>Tawar</button>
              </div>
            </div>
          </div>;
        })}
      </div>}
  </div>;
}

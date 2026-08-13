import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api, formatIdr } from "../lib/api";

export default function Marketplace(){
  const { data, isLoading, refetch } = useQuery({ queryKey:["marketplace"], queryFn:()=> api.listings() });
  const marketplace:any[] = (data as any)?.marketplace ?? (data as any)?.cards ?? [];
  const listings:any[] = (data as any)?.listings ?? [];
  const cards = marketplace.length ? marketplace : listings.map((l:any)=> ({
    card: l.card, drop: l.drop, buyoutPriceCcoin: l.priceCCoin ?? l.buyoutPriceCcoin, idrPrice: l.idrPrice, sellerName: l.sellerName, listingId: l.id
  }));
  return <div style={{display:"flex",flexDirection:"column",gap:18}}>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-end",flexWrap:"wrap",gap:12}}>
      <div>
        <h1 className="h2">Marketplace</h1>
        <p className="muted">Kartu yang dijual pemiliknya</p>
      </div>
      <button className="btn-ghost" onClick={()=> refetch()}>Refresh</button>
    </div>
    {isLoading ? <div className="muted">Memuat...</div> : cards.length===0 ? <div className="card card-pad muted">Belum ada kartu dijual</div> :
    <div className="grid-3">
      {cards.map((r:any)=> {
        const card = r.card ?? r;
        const drop = r.drop;
        const price = r.buyoutPriceCcoin ?? card.buyoutPriceCcoin ?? r.priceCCoin ?? r.listing?.priceCCoin ?? 0;
        return <Link key={card?.id ?? r.listingId} to={card?.id ? `/cards/${card.id}` : `/marketplace/${r.listingId}`} className="card" style={{overflow:"hidden", textDecoration:"none", color:"inherit"}}>
          <div style={{height:140, background:"linear-gradient(135deg,#1a1a2e,#2a2040)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:36}}>🃏</div>
          <div style={{padding:12}}>
            <div style={{fontWeight:700, fontSize:13}}>{drop?.title ?? card?.id ?? r.listingId} · #{card?.unitNumber ?? "?"}</div>
            <div style={{fontSize:11, color:"var(--muted)"}}>{drop?.series ?? ""}</div>
            <div style={{marginTop:8, fontWeight:800}}>{price} C-Coin <span style={{fontSize:11, color:"var(--muted)"}}>({formatIdr(price*10000)})</span></div>
          </div>
        </Link>;
      })}
    </div>}
  </div>;
}

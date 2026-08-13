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
  return <div style={{display:"flex",flexDirection:"column",gap:20}}>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-end",flexWrap:"wrap",gap:12}}>
      <div>
        <span className="eyebrow">Pasar Sekunder</span>
        <h1 className="h2" style={{marginTop:4}}>Marketplace</h1>
        <p className="muted" style={{marginTop:6}}>Kartu yang dijual pemiliknya</p>
      </div>
      <button className="btn-ghost" onClick={()=> refetch()} style={{fontFamily:"var(--font-mono)", fontSize:12}}>Refresh</button>
    </div>
    {isLoading ? <div className="muted" style={{padding:24, textAlign:"center"}}>Memuat…</div> : cards.length===0 ? <div className="card card-pad muted" style={{textAlign:"center", padding:32}}>Belum ada kartu dijual — pasang harga dari <Link to="/me/manage" style={{color:"var(--gold)", fontWeight:600}}>Kelola Kartu</Link></div> :
    <div className="grid-3">
      {cards.map((r:any)=> {
        const card = r.card ?? r;
        const drop = r.drop;
        const price = r.buyoutPriceCcoin ?? card.buyoutPriceCcoin ?? r.priceCCoin ?? r.listing?.priceCCoin ?? 0;
        return <Link key={card?.id ?? r.listingId} to={card?.id ? `/cards/${card.id}` : `/marketplace/${r.listingId}`} className="card" style={{overflow:"hidden", textDecoration:"none", color:"inherit"}}>
          <div style={{height:140, background:"linear-gradient(135deg,#14141a,#1e1e34)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:36}}>🃏</div>
          <div style={{padding:14}}>
            <div style={{fontWeight:600, fontSize:13}}>{drop?.title ?? card?.id ?? r.listingId} · #{card?.unitNumber ?? "?"}</div>
            <div style={{fontFamily:"var(--font-mono)", fontSize:11, color:"var(--text-muted)"}}>{drop?.series ?? ""}</div>
            <div style={{marginTop:10, display:"flex", alignItems:"baseline", gap:6}}>
              <span style={{fontWeight:700, fontSize:15}}>{price} C</span>
              <span style={{fontFamily:"var(--font-mono)", fontSize:11, color:"var(--text-muted)"}}>· {formatIdr(price*10000)}</span>
            </div>
          </div>
        </Link>;
      })}
    </div>}
  </div>;
}

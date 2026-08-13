import React, { useState } from "react";
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
        <span className="eyebrow">Secondary — Marketplace (buyout)</span>
        <h1 className="h2">Marketplace</h1>
        <p className="muted">Kartu yang owner-nya pasang <b>buyout price</b> (integer ≥1 C-Coin). Fee 15% = 7.5% platform + 7.5% royalti kreator lifetime + 85% owner.</p>
      </div>
      <div style={{display:"flex",gap:8}}>
        <Link to="/browse" className="btn-ghost">Browse (bid tanpa harga) →</Link>
        <button className="btn-ghost" onClick={()=> refetch()}>Refresh</button>
      </div>
    </div>
    {isLoading ? <div className="muted">Memuat...</div> : cards.length===0 ? <div className="card card-pad muted">Belum ada kartu buyout. Pasang harga dari <Link to="/me/manage" style={{color:"var(--gold)"}}>Kelola Kartu →</Link> (KYC wajib).</div> :
    <div className="grid-3">
      {cards.map((r:any)=> {
        const card = r.card ?? r;
        const drop = r.drop;
        const price = r.buyoutPriceCcoin ?? card.buyoutPriceCcoin ?? r.priceCCoin ?? r.listing?.priceCCoin ?? 0;
        return <Link key={card?.id ?? r.listingId} to={card?.id ? `/cards/${card.id}` : `/marketplace/${r.listingId}`} className="card" style={{overflow:"hidden", textDecoration:"none", color:"inherit"}}>
          <div style={{height:140, background:"linear-gradient(135deg,#1a1a2e,#2a2040)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:36}}>🃏</div>
          <div style={{padding:12}}>
            <div style={{fontWeight:700, fontSize:13}}>{drop?.title ?? card?.id ?? r.listingId} · #{card?.unitNumber ?? "?"} · {card?.variant ?? ""}</div>
            <div style={{fontSize:11, color:"var(--muted)"}}>{drop?.series ?? ""}</div>
            <div style={{display:"flex", gap:6, marginTop:6}}><span className="pill pill-warn">{price} C buyout</span><span className="pill pill-info">{drop?.creatorName ?? ""}</span></div>
            <div style={{marginTop:8, fontWeight:800}}>{price} C-Coin <span style={{fontSize:11, color:"var(--muted)"}}>({formatIdr(price*10000)})</span></div>
            {r.sellerName && <div style={{fontSize:11, color:"var(--muted)"}}>by {r.sellerName}</div>}
          </div>
        </Link>;
      })}
    </div>}
  </div>;
}

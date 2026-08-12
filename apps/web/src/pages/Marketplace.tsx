import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api, formatIdr } from "../lib/api";

export default function Marketplace(){
  const [filter,setFilter]=useState("all");
  const [type,setType]=useState("all");
  const { data, isLoading, refetch } = useQuery({
    queryKey:["listings",filter,type],
    queryFn:()=> api.listings({ ...(filter!=="all"?{status:filter}:{}), ...(type!=="all"?{type}:{}) }),
  });
  return <div style={{display:"flex",flexDirection:"column",gap:18}}>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-end",flexWrap:"wrap",gap:12}}>
      <div>
        <span className="eyebrow">Secondary P2P — Bid Offer Bebas</span>
        <h1 className="h2">Marketplace</h1>
        <p className="muted">Fixed-price & English auction (reserve, anti-sniping +5m, fee 15% → 7.5% platform + 7.5% royalty + 85% seller).</p>
      </div>
      <div style={{display:"flex",gap:8}}>
        <select className="select" value={filter} onChange={e=> setFilter(e.target.value)} style={{width:140}}>
          <option value="all">Semua status</option><option value="listed">Listed</option><option value="bidding">Bidding</option><option value="settled">Settled</option>
        </select>
        <select className="select" value={type} onChange={e=> setType(e.target.value)} style={{width:130}}>
          <option value="all">Semua tipe</option><option value="fixed">Fixed</option><option value="auction">Auction</option>
        </select>
        <button className="btn-ghost" onClick={()=> refetch()}>Refresh</button>
      </div>
    </div>

    {isLoading ? <div className="muted">Memuat...</div> : !data?.listings.length ? <div className="card card-pad muted">Belum ada listing. Jual kartumu dari Koleksi → List di Marketplace.</div> :
    <div className="grid-3">
      {data.listings.map((l:any)=> <Link key={l.id} to={`/marketplace/${l.id}`} className="card drop-card">
        <div className="drop-thumb"><span style={{fontSize:36}}>🃏</span>
          <span className="drop-badge" style={{background: l.type==="auction"?"var(--info)":"var(--success)",color:"#fff"}}>{l.type.toUpperCase()}</span>
        </div>
        <div className="card-pad">
          <div style={{fontSize:11,fontWeight:700,color:"var(--gold)",letterSpacing:"0.06em",textTransform:"uppercase"}}>{l.drop?.series ?? l.card?.dropId}</div>
          <div style={{fontWeight:700,marginTop:4}}>{l.drop?.title ?? l.cardId} · #{l.card?.unitNumber ?? "?"}</div>
          <div style={{display:"flex",gap:8,marginTop:6,flexWrap:"wrap"}}>
            <span className={`pill ${l.status==="bidding"?"pill-info": l.status==="listed"?"pill-success":"pill-warn"}`}>{l.status}</span>
            {l.type==="auction" && l.currentBidCCoin && <span className="pill pill-warn">Bid: {l.currentBidCCoin} C</span>}
          </div>
          <div style={{display:"flex",justifyContent:"space-between",marginTop:12,alignItems:"flex-end"}}>
            <div>
              <div style={{fontSize:11,color:"var(--dim)",fontWeight:700}}>HARGA</div>
              <div style={{fontWeight:800}}>{l.priceCCoin} C <span style={{fontSize:11,color:"var(--muted)"}}>({formatIdr(l.idrPrice)})</span></div>
              {l.reserveCCoin && <div style={{fontSize:11,color:"var(--dim)"}}>Reserve {l.reserveCCoin} C</div>}
            </div>
            <div style={{textAlign:"right",fontSize:11,color:"var(--muted)"}}>
              <div>by {l.sellerName}</div>
              <div>Ends {new Date(l.endsAt).toLocaleDateString("id-ID")}</div>
            </div>
          </div>
        </div>
      </Link>)}
    </div>}
  </div>;
}

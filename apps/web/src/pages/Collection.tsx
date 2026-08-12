import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api, formatIdr } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useToast } from "../lib/toast";

export default function Collection(){
  const { user } = useAuth();
  const { push } = useToast();
  const [listPrice,setListPrice]=useState<Record<string,number>>({});
  const [listType,setListType]=useState<Record<string,string>>({});
  const { data, refetch, isLoading } = useQuery({ queryKey:["profile"], queryFn:()=> api.profile(), enabled: !!user });
  if(!user) return <div className="card card-pad">Silakan <a href="/login" style={{color:"var(--gold)"}}>login</a> untuk melihat koleksi.</div>;
  if(isLoading) return <div className="muted">Memuat koleksi...</div>;
  const p:any = data as any;
  const cards:any[] = p.cards ?? [];
  const orders:any[] = p.orders ?? [];
  const listings:any[] = p.listings ?? [];
  const badges:any[] = p.badges ?? [];

  async function onList(cardId:string){
    const price = listPrice[cardId] || 35;
    const type = (listType[cardId]||"fixed") as "fixed"|"auction";
    try{ await api.createListing({ cardId, type, priceCCoin: price, ...(type==="auction"?{reserveCCoin: Math.floor(price*0.8)}:{}) }); push(`Listing ${type} ${price} C-Coin dibuat!`, "success"); refetch(); }
    catch(e:any){ push(e.message,"error"); }
  }

  return <div style={{display:"flex",flexDirection:"column",gap:18}}>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-end",flexWrap:"wrap",gap:12}}>
      <div>
        <span className="eyebrow">My Collection & Orders</span>
        <h1 className="h2">Koleksi — {p.user.displayName}</h1>
        <p className="muted">Level {p.user.level} · {p.user.tier} · {p.user.xp} XP · {p.stats.totalCards} kartu · {p.wallet.balanceCCoin} C-Coin</p>
      </div>
      <button className="btn-ghost" onClick={()=> refetch()}>Refresh</button>
    </div>

    {badges.length>0 && <div className="card card-pad">
      <div style={{fontWeight:700,fontSize:13,marginBottom:10}}>Badges ({badges.length})</div>
      <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
        {badges.map((ub:any)=> <span key={ub.badgeId} className="pill pill-warn" title={ub.badge?.description} style={{padding:"6px 12px",fontSize:12}}>{ub.badge?.icon} {ub.badge?.name} +{ub.badge?.xp} XP</span>)}
      </div>
    </div>}

    <div className="card">
      <div style={{padding:"12px 14px",fontWeight:700,borderBottom:"1px solid var(--border)"}}>Kartu Milikmu ({cards.length})</div>
      {cards.length===0 ? <div style={{padding:20,textAlign:"center",color:"var(--muted)"}}>Belum punya kartu. <Link to="/drops" style={{color:"var(--gold)"}}>Beli di Drops →</Link></div> :
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(240px,1fr))",gap:12,padding:14}}>
        {cards.map((ca:any)=> <div key={ca.id} className="card" style={{overflow:"hidden"}}>
          <div style={{height:140, background:"linear-gradient(135deg,#1a1a2e,#2a2040)", display:"flex",alignItems:"center",justifyContent:"center",fontSize:36}}>🎴</div>
          <div style={{padding:12,display:"flex",flexDirection:"column",gap:6}}>
            <div style={{fontWeight:700,fontSize:13}}>{ca.drop?.title ?? ca.dropId} · #{ca.unitNumber} · {ca.variant}</div>
            <div style={{fontSize:11,color:"var(--muted)"}}>{ca.drop?.series}</div>
            <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
              <span className={`pill ${ca.status==="available"?"pill-info": ca.status==="listed"?"pill-warn":"pill-success"}`}>{ca.status}</span>
              <span className={`pill ${ca.verifyStatus==="verified"?"pill-success": ca.verifyStatus==="tamper_detected"?"pill-danger":"pill-warn"}`}>{ca.verifyStatus}</span>
            </div>
            <div style={{fontSize:11,color:"var(--dim)"}}>ShortID: {ca.nfcShortId} · <Link to={`/verify/${ca.nfcShortId}`} style={{color:"var(--gold)"}}>Verify →</Link></div>
            <div style={{display:"flex",gap:6,marginTop:6}}>
              <select value={listType[ca.id]||"fixed"} onChange={e=> setListType(s=> ({...s,[ca.id]: e.target.value}))} className="select" style={{flex:1,padding:"6px 8px",fontSize:12}}>
                <option value="fixed">Fixed</option><option value="auction">Auction</option>
              </select>
              <input className="input" type="number" placeholder="C-Coin" value={listPrice[ca.id]||""} onChange={e=> setListPrice(s=> ({...s,[ca.id]: Number(e.target.value)}))} style={{width:90,fontSize:12}}/>
              <button className="btn-gold" onClick={()=> onList(ca.id)} style={{padding:"6px 10px",fontSize:12}}>List</button>
            </div>
          </div>
        </div>)}
      </div>}
    </div>

    <div className="card">
      <div style={{padding:"12px 14px",fontWeight:700,borderBottom:"1px solid var(--border)"}}>Orders ({orders.length})</div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Order</th><th>Drop</th><th>Total</th><th>Status</th><th>Tracking</th></tr></thead>
          <tbody>
            {orders.length===0 ? <tr><td colSpan={5} style={{textAlign:"center",color:"var(--muted)",padding:16}}>Belum ada order.</td></tr> :
            orders.map((o:any)=> <tr key={o.id}>
              <td style={{fontSize:11,fontFamily:"JetBrains Mono"}}>{o.id}</td>
              <td>{o.dropId}</td>
              <td style={{fontWeight:700}}>{o.totalCCoin} C ({formatIdr(o.totalIdr)})</td>
              <td><span className={`pill ${o.status==="delivered"?"pill-success": o.status==="shipped"?"pill-info":"pill-warn"}`}>{o.status}</span></td>
              <td style={{fontSize:11,fontFamily:"JetBrains Mono"}}>{o.trackingNumber||"-"}</td>
            </tr>)}
          </tbody>
        </table>
      </div>
    </div>

    {listings.length>0 && <div className="card">
      <div style={{padding:"12px 14px",fontWeight:700,borderBottom:"1px solid var(--border)"}}>My Listings ({listings.length})</div>
      <div className="table-wrap">
        <table><thead><tr><th>Listing</th><th>Card</th><th>Tipe</th><th>Harga</th><th>Status</th></tr></thead>
        <tbody>{listings.map((l:any)=> <tr key={l.id}><td style={{fontSize:11,fontFamily:"JetBrains Mono"}}><Link to={`/marketplace/${l.id}`} style={{color:"var(--gold)"}}>{l.id}</Link></td><td style={{fontSize:11}}>{l.cardId}</td><td><span className="pill pill-info">{l.type}</span></td><td>{l.priceCCoin} C</td><td><span className="pill pill-warn">{l.status}</span></td></tr>)}</tbody>
        </table>
      </div>
    </div>}
  </div>;
}

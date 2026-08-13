import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api, formatIdr } from "../lib/api";
import { useAuth } from "../lib/auth";

// XP is internal; UI only shows Level + progress bar (10 XP = 1 level). Never show raw XP numbers.
function LevelBar({ level, tier, progressPct, hint }:{ level:number; tier:string; progressPct:number; hint:string }){
  return (
    <div style={{display:"flex", flexDirection:"column", gap:8}}>
      <div style={{display:"flex", justifyContent:"space-between", alignItems:"baseline"}}>
        <div style={{fontWeight:800}}>Level {level} <span style={{fontWeight:400, fontSize:12, color:"var(--muted)"}}>· {tier}</span></div>
        <div style={{fontSize:11, color:"var(--muted)"}}>{hint}</div>
      </div>
      <div className="progress" style={{height:10}}>
        <div className="progress-fill" style={{width: progressPct+"%"}} />
      </div>
    </div>
  );
}

export default function Collection(){
  const { user } = useAuth();
  const { data, refetch, isLoading } = useQuery({ queryKey:["profile"], queryFn:()=> api.profile(), enabled: !!user });
  if(!user) return <div className="card card-pad">Silakan <a href="/login" style={{color:"var(--gold)"}}>login</a> untuk melihat koleksi.</div>;
  if(isLoading) return <div className="muted">Memuat koleksi...</div>;
  const p:any = data as any;
  const cards:any[] = p.cards ?? [];
  const orders:any[] = p.orders ?? [];
  const badges:any[] = p.badges ?? [];
  // Backend provides level/tier/progress; if not, derive locally without showing raw XP
  const level:number = p.user?.level ?? p.level ?? 1;
  const tier:string = p.user?.tier ?? p.tier ?? "bronze";
  const progressPct:number = typeof p.user?.levelProgressPct === "number" ? p.user.levelProgressPct
    : typeof p.levelProgressPct === "number" ? p.levelProgressPct
    : 0;
  const progressLabel:string = p.user?.levelProgressLabel ?? p.levelProgressLabel ?? "Progress level berikutnya";
  return <div style={{display:"flex",flexDirection:"column",gap:18}}>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-end",flexWrap:"wrap",gap:12}}>
      <div style={{flex:"1 1 320px"}}>
        <h1 className="h2">Koleksi</h1>
        <p className="muted" style={{fontSize:12, marginTop:6}}>{p.stats.totalCards} kartu</p>
        <div className="card card-pad" style={{marginTop:12, background:"var(--bg-elevated)", border:"1px solid var(--border)"}}>
          <LevelBar level={level} tier={tier} progressPct={progressPct} hint={progressLabel} />
        </div>
      </div>
      <div style={{display:"flex", gap:8}}>
        <Link to="/me/manage" className="btn-gold">Kelola Kartu (Sell) →</Link>
        <button className="btn-ghost" onClick={()=> refetch()}>Refresh</button>
      </div>
    </div>
    {badges.length>0 && <div className="card card-pad">
      <div style={{fontWeight:700,fontSize:13,marginBottom:10}}>Badges ({badges.length})</div>
      <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
        {badges.map((ub:any)=> <span key={ub.badgeId} className="pill pill-warn" title={ub.badge?.description} style={{padding:"6px 12px",fontSize:12}}>{ub.badge?.icon} {ub.badge?.name}</span>)}
      </div>
    </div>}
    <div className="card">
      <div style={{padding:"12px 14px",fontWeight:700,borderBottom:"1px solid var(--border)"}}>Kartu ({cards.length}) <Link to="/me/manage" style={{fontSize:12, color:"var(--gold)", marginLeft:8}}>Kelola</Link></div>
      {cards.length===0 ? <div style={{padding:20,textAlign:"center",color:"var(--muted)"}}>Belum punya kartu. <Link to="/drops" style={{color:"var(--gold)"}}>Beli di Drops →</Link></div> :
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(220px,1fr))",gap:12,padding:14}}>
        {cards.map((ca:any)=> <Link key={ca.id} to={"/cards/"+ca.id} className="card" style={{overflow:"hidden", textDecoration:"none", color:"inherit"}}>
          <div style={{height:140, background:"linear-gradient(135deg,#1a1a2e,#2a2040)", display:"flex",alignItems:"center",justifyContent:"center",fontSize:36}}>🎴</div>
          <div style={{padding:12,display:"flex",flexDirection:"column",gap:6}}>
            <div style={{fontWeight:700,fontSize:13}}>{ca.drop?.title ?? ca.dropId} · #{ca.unitNumber} · {ca.variant}</div>
            <div style={{fontSize:11,color:"var(--muted)"}}>{ca.drop?.series} {ca.buyoutPriceCcoin ? "· "+ca.buyoutPriceCcoin+" C buyout" : ""}</div>
            <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
              <span className={"pill "+(ca.location==="platform_vault"?"pill-warn": ca.location==="with_owner"?"pill-success":"pill-info")}>{ca.location ?? ca.status}</span>
              {ca.buyoutPriceCcoin ? <span className="pill pill-warn">Buyout {ca.buyoutPriceCcoin} C</span> : null}
              {ca.activeBid ? <span className="pill pill-success">Bid {ca.activeBid.amountCCoin} C</span> : null}
              <span className={"pill "+(ca.verifyStatus==="verified"?"pill-success": ca.verifyStatus==="tamper_detected"?"pill-danger":"pill-warn")}>{ca.verifyStatus}</span>
            </div>
            <div style={{fontSize:11,color:"var(--dim)"}}><Link to={"/cards/"+ca.id} style={{color:"var(--gold)"}}>Detail →</Link></div>
          </div>
        </Link>)}
      </div>}
    </div>
    <div className="card">
      <div style={{padding:"12px 14px",fontWeight:700,borderBottom:"1px solid var(--border)"}}>Orders ({orders.length}) — <Link to="/orders" style={{color:"var(--gold)", fontSize:12}}>Lihat semua →</Link></div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Order</th><th>Drop</th><th>Total</th><th>Status</th><th>Opsi</th></tr></thead>
          <tbody>
            {orders.length===0 ? <tr><td colSpan={5} style={{textAlign:"center",color:"var(--muted)",padding:16}}>Belum ada order.</td></tr> :
            orders.map((o:any)=> <tr key={o.id}>
              <td style={{fontSize:11,fontFamily:"monospace"}}><Link to={"/orders/"+o.id} style={{color:"var(--gold)"}}>{o.id}</Link></td>
              <td style={{fontSize:12}}>{o.dropId}</td>
              <td style={{fontWeight:700}}>{o.totalCCoin} C ({formatIdr(o.totalIdr)})</td>
              <td><span className={"pill "+(o.status==="delivered"?"pill-success": o.status==="shipped"?"pill-info":"pill-warn")}>{o.status}</span></td>
              <td style={{fontSize:11}}>{o.deliveryOption ?? (o.shippingAddress? "shipping":"vault")}</td>
            </tr>)}
          </tbody>
        </table>
      </div>
    </div>
  </div>;
}

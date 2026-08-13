import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";

export default function Home(){
  const { user } = useAuth();
  const { data: wallet } = useQuery({ queryKey:["wallet"], queryFn:()=> api.wallet(), enabled: !!user });
  const { data: drops } = useQuery({ queryKey:["drops-home"], queryFn:()=> api.drops({status:"live"}) });
  if(!user) return <div className="card card-pad">Silakan <Link to="/login" style={{color:"var(--gold)"}}>login</Link> untuk melihat Home.</div>;
  const live:any[] = (drops as any)?.drops?.slice(0,6) ?? [];
  const w:any = (wallet as any)?.wallet;
  return <div style={{display:"flex", flexDirection:"column", gap:18}}>
    <div className="card card-pad" style={{background:"linear-gradient(135deg,#1a1a2e 0%, #2a2040 100%)"}}>
      <div style={{fontSize:12, color:"var(--gold)", fontWeight:700, letterSpacing:"0.06em"}}>HOME - Selamat datang, {user.displayName}</div>
      <h1 className="h2" style={{marginTop:6}}>Saldo {w ? w.balanceCCoin+" C-Coin" : "..."} <Link to="/wallet" style={{color:"var(--gold)", fontSize:14}}>Wallet</Link> <Link to="/orders" style={{color:"var(--gold)", fontSize:14}}>Orders</Link> <Link to="/me/manage" style={{color:"var(--gold)", fontSize:14}}>Kelola Kartu</Link></h1>
      <div className="muted" style={{fontSize:12, marginTop:6}}>Top-up di Wallet (area user - bukan publik) - KYC trigger jika kumulatif lebih dari 99 C-Coin / pasang buyout / accept bid.</div>
    </div>
    <div>
      <div style={{display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10}}>
        <div style={{fontWeight:700}}>Drop Trending</div><Link to="/drops" style={{fontSize:13, color:"var(--gold)"}}>Lihat semua</Link>
      </div>
      <div className="grid-3">
        {live.map((d:any)=> <Link key={d.id} to={"/drops/"+d.id} className="card" style={{overflow:"hidden", textDecoration:"none", color:"inherit"}}>
          <div style={{height:120, background:"linear-gradient(135deg,#1a1a2e,#2a2040)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:28}}>🎴</div>
          <div style={{padding:12}}><div style={{fontWeight:700, fontSize:13}}>{d.title}</div><div style={{fontSize:11, color:"var(--muted)"}}>{d.series} - {(d.priceCcoin ?? d.priceUnsignedCCoin)} C</div></div>
        </Link>)}
        {live.length===0 && <div className="muted">Belum ada drop live.</div>}
      </div>
    </div>
  </div>;
}

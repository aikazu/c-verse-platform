import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api, formatIdr } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useToast } from "../lib/toast";

export default function ManageCards(){
  const { user } = useAuth();
  const { push } = useToast();
  const [buyout, setBuyout] = useState<Record<string,number>>({});
  const [vaultAddr, setVaultAddr] = useState<Record<string,string>>({});
  const [vaultFee, setVaultFee] = useState<Record<string,number>>({});
  const { data, refetch } = useQuery({ queryKey:["profile-manage"], queryFn:()=> api.profile(), enabled: !!user });
  if(!user) return <div className="card card-pad">Login untuk kelola kartu.</div>;
  const cards:any[] = (data as any)?.cards ?? [];
  const bidsByCard:Record<string,any> = {};
  for(const c of cards){ if(c.activeBid) bidsByCard[c.id]=c.activeBid; }
  async function onSetBuyout(card:any){
    const v = buyout[card.id];
    if(v!=null && (isNaN(v) || v < 1)){ push("Buyout minimal 1 C-Coin","info"); return; }
    try{
      if(v==null || v===0){ await api.patchBuyout(card.id, null); push("Buyout dicabut","success"); }
      else { await api.setBuyout(card.id, v); push(`Buyout ${v} C-Coin dipasang — tampil di Marketplace (KYC wajib)`, "success"); }
      refetch();
    }catch(e:any){ push(e.message,"error"); }
  }
  async function onVaultShip(card:any){
    const addr = vaultAddr[card.id] ?? "";
    const fee = vaultFee[card.id] ?? 2;
    if(addr.length < 10){ push("Alamat minimal 10 karakter","info"); return; }
    try{ await api.vaultShipout(card.id, addr, fee); push("Shipment vault dibuat — tracking aktif","success"); refetch(); }catch(e:any){ push(e.message,"error"); }
  }
  async function onAccept(card:any){
    try{ await api.acceptBidOnCard(card.id); push("Bid accepted — ownership pindah + settlement","success"); refetch(); }catch(e:any){ push(e.message,"error"); }
  }
  return <div style={{display:"flex", flexDirection:"column", gap:18}}>
    <div style={{display:"flex", justifyContent:"space-between", alignItems:"flex-end"}}>
      <div><span className="eyebrow">Kelola Kartu (Sell)</span><h1 className="h2">Manage — {cards.length} kartu</h1><p className="muted" style={{fontSize:12}}>Buyout price → Marketplace · Bid active → accept only · Vault card → Kirim dari vault kapan saja (ongkir C-Coin)</p></div>
      <Link to="/collection" className="btn-ghost">← Koleksi</Link>
    </div>
    <div style={{display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(300px,1fr))", gap:12}}>
      {cards.map((card:any)=> <div key={card.id} className="card" style={{padding:14, display:"flex", flexDirection:"column", gap:10}}>
        <div style={{fontWeight:700, fontSize:13}}>{card.drop?.title ?? card.dropId} · #{card.unitNumber} · {card.variant}</div>
        <div style={{display:"flex", gap:6, flexWrap:"wrap"}}>
          <span className="pill pill-info">{card.location ?? card.status}</span>
          {card.buyoutPriceCcoin ? <span className="pill pill-warn">Buyout {card.buyoutPriceCcoin} C</span> : <span className="pill">No buyout</span>}
          {card.activeBid ? <span className="pill pill-success">Bid active {card.activeBid.amountCCoin} C</span> : null}
        </div>
        <div style={{fontSize:12}}>ShortID: {card.nfcShortId} · <Link to={"/cards/"+card.id} style={{color:"var(--gold)"}}>Info</Link> · <Link to={"/cards/"+card.id+"/3d"} style={{color:"var(--gold)"}}>3D</Link></div>
        <div style={{display:"flex", gap:6}}>
          <input className="input" type="number" min={1} placeholder="Buyout C-Coin (kosongkan untuk cabut)" value={buyout[card.id] ?? (card.buyoutPriceCcoin ?? "")} onChange={e=> setBuyout(s=> ({...s,[card.id]: e.target.value===""? 0 as any : Number(e.target.value)}))} style={{flex:1, fontSize:12}} />
          <button className="btn-gold" onClick={()=> onSetBuyout(card)} style={{fontSize:12, padding:"6px 10px"}}>Set</button>
        </div>
        {card.activeBid && <button className="btn-ghost" onClick={()=> onAccept(card)} style={{fontSize:12}}>Accept bid {card.activeBid.amountCCoin} C dari {card.activeBid.bidderName} (KYC wajib)</button>}
        {card.location==="platform_vault" && <div style={{borderTop:"1px solid var(--border)", paddingTop:10, display:"flex", flexDirection:"column", gap:6}}>
          <div style={{fontSize:12, fontWeight:700}}>Kirim dari vault ke alamat</div>
          <input className="input" placeholder="Alamat lengkap" value={vaultAddr[card.id] ?? ""} onChange={e=> setVaultAddr(s=> ({...s,[card.id]: e.target.value}))} style={{fontSize:12}} />
          <div style={{display:"flex", gap:6}}><input className="input" type="number" min={1} value={vaultFee[card.id] ?? 2} onChange={e=> setVaultFee(s=> ({...s,[card.id]: Number(e.target.value)}))} style={{width:100, fontSize:12}} /><button className="btn-gold" onClick={()=> onVaultShip(card)} style={{fontSize:12, flex:1}}>Kirim dari vault (ongkir C-Coin)</button></div>
        </div>}
      </div>)}
    </div>
    {cards.length===0 && <div className="card card-pad muted">Belum punya kartu.</div>}
  </div>;
}

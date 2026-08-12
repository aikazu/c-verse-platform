import React, { useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, formatIdr } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useToast } from "../lib/toast";

export default function DropDetail(){
  const { id } = useParams();
  const { user } = useAuth();
  const { push } = useToast();
  const nav = useNavigate();
  const [qty,setQty]=useState(1);
  const [variant,setVariant]=useState<"unsigned"|"signed">("unsigned");
  const [addr,setAddr]=useState("Jl. Contoh No. 123, Jakarta Selatan 12345");
  const [buying,setBuying]=useState(false);

  const { data, isLoading, refetch } = useQuery({ queryKey:["drop",id], queryFn:()=> api.drop(id!), enabled: !!id });
  if(isLoading) return <div className="muted">Memuat...</div>;
  if(!data) return <div className="card card-pad">Drop tidak ditemukan. <Link to="/drops" style={{color:"var(--gold)"}}>Kembali</Link></div>;
  const d:any = (data as any).title ? data as any : (data as any).drop ?? data;
  // normalize if nested
  const drop = (d as any).title ? d as any : d;
  const priceCCoin = variant==="signed" ? drop.priceSignedCCoin : drop.priceUnsignedCCoin;
  const totalCCoin = priceCCoin * qty;

  async function onBuy(){
    if(!user){ push("Silakan login dulu","info"); nav("/login"); return; }
    setBuying(true);
    try{
      const res = await api.checkout({ dropId: drop.id, quantity: qty, variant, shippingAddress: addr });
      push(`Checkout berhasil! Order ${res.order.id} — ${totalCCoin} C-Coin terpotong.`, "success");
      refetch();
    }catch(e:any){
      if(e.message?.includes("Saldo")){
        push(e.message + " — silakan Top-up di Wallet.", "error");
      } else push(e.message,"error");
    } finally{ setBuying(false); }
  }

  const pct = drop.totalUnits ? Math.round(drop.soldCount/drop.totalUnits*100) : 0;
  const isLive = drop.status==="live";
  return <div style={{display:"flex",flexDirection:"column",gap:18}}>
    <Link to="/drops" style={{fontSize:13,color:"var(--muted)"}}>← Kembali ke Drops</Link>
    <div className="grid-2" style={{alignItems:"start"}}>
      <div className="card" style={{overflow:"hidden"}}>
        <div style={{aspectRatio:"4/3", background:"linear-gradient(135deg,#1a1a2e,#2a2040)", display:"flex",alignItems:"center",justifyContent:"center",fontSize:64}}>🎴</div>
        <div className="card-pad">
          <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
            <span className={`pill ${isLive?"pill-success": drop.status==="scheduled"?"pill-info":"pill-warn"}`}>{drop.status.toUpperCase()}</span>
            <span className="pill pill-info">{drop.series}</span>
          </div>
          <p className="muted" style={{marginTop:12}}>{drop.narrative}</p>
          <div style={{display:"flex",gap:16,marginTop:14,flexWrap:"wrap"}}>
            <div><div style={{fontSize:11,color:"var(--dim)",fontWeight:700}}>TOTAL UNIT</div><div style={{fontWeight:700}}>{drop.totalUnits}</div></div>
            <div><div style={{fontSize:11,color:"var(--dim)",fontWeight:700}}>SIGNED</div><div style={{fontWeight:700}}>{drop.signedCount} × {drop.priceSignedCCoin} C</div></div>
            <div><div style={{fontSize:11,color:"var(--dim)",fontWeight:700}}>UNSIGNED</div><div style={{fontWeight:700}}>{drop.unsignedCount} × {drop.priceUnsignedCCoin} C</div></div>
            <div><div style={{fontSize:11,color:"var(--dim)",fontWeight:700}}>TERJUAL</div><div style={{fontWeight:700}}>{drop.soldCount}/{drop.totalUnits} ({pct}%)</div></div>
          </div>
          <div className="progress" style={{marginTop:12}}><div className="progress-fill" style={{width:`${pct}%`}}/></div>
          <div style={{fontSize:11,color:"var(--dim)",marginTop:8}}>by {drop.creatorName} · Drop ID: {drop.id}</div>
        </div>
      </div>

      <div className="card card-pad" style={{display:"flex",flexDirection:"column",gap:16}}>
        <div>
          <div style={{fontWeight:700,fontSize:16}}>Checkout — Siapa Cepat Dia Dapat</div>
          <div className="muted">Harga fixed. Limit max 2 kartu/user/drop. Potong saldo C-Coin.</div>
        </div>

        <div style={{display:"flex",gap:10}}>
          <button onClick={()=> setVariant("unsigned")} style={{flex:1,padding:"12px",borderRadius:10,border: variant==="unsigned"?"2px solid var(--gold)":"1px solid var(--border)",background: variant==="unsigned"?"var(--gold-bg)":"transparent",color:"var(--text)",fontWeight:700}}>
            Unsigned<br/><span style={{fontSize:18}}>{drop.priceUnsignedCCoin} C</span><br/><span style={{fontSize:11,color:"var(--muted)"}}>{formatIdr(drop.priceUnsignedCCoin*10000)}</span>
          </button>
          <button onClick={()=> setVariant("signed")} style={{flex:1,padding:"12px",borderRadius:10,border: variant==="signed"?"2px solid var(--gold)":"1px solid var(--border)",background: variant==="signed"?"var(--gold-bg)":"transparent",color:"var(--text)",fontWeight:700}}>
            Signed ✍️<br/><span style={{fontSize:18}}>{drop.priceSignedCCoin} C</span><br/><span style={{fontSize:11,color:"var(--muted)"}}>{formatIdr(drop.priceSignedCCoin*10000)}</span>
          </button>
        </div>

        <div className="form-row">
          <label className="label">Jumlah (max 2)</label>
          <select className="select" value={qty} onChange={e=> setQty(Number(e.target.value))}>
            <option value={1}>1 kartu</option><option value={2}>2 kartu</option>
          </select>
        </div>
        <div className="form-row">
          <label className="label">Alamat Pengiriman</label>
          <textarea className="textarea" value={addr} onChange={e=> setAddr(e.target.value)} rows={2}/>
        </div>

        <div style={{background:"var(--bg-elevated)",border:"1px solid var(--border)",borderRadius:10,padding:12,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div><div style={{fontSize:11,color:"var(--dim)",fontWeight:700}}>TOTAL</div><div style={{fontWeight:800,fontSize:18}}>{totalCCoin} C-Coin <span style={{fontSize:11,color:"var(--muted)",fontWeight:400}}>({formatIdr(totalCCoin*10000)})</span></div></div>
          <div style={{fontSize:11,color:"var(--muted)",textAlign:"right"}}>{qty}× {variant} @ {priceCCoin} C</div>
        </div>

        {!isLive ? <div className="pill pill-warn" style={{justifyContent:"center",padding:"10px"}}>Drop belum live (status: {drop.status}) — checkout disabled</div>
        : <button className="btn-gold" onClick={onBuy} disabled={buying} style={{padding:"14px",fontSize:15, width:"100%", opacity: buying?0.6:1}}>
          {buying ? "Memproses..." : `Beli Sekarang — ${totalCCoin} C-Coin`}
        </button>}

        <div style={{fontSize:11,color:"var(--dim)",lineHeight:"1.5"}}>
          Saldo kurang? <Link to="/wallet" style={{color:"var(--gold)",fontWeight:700}}>Top-up C-Coin di Wallet →</Link><br/>
          Setelah checkout: kartu diproduksi + NFC provisioning + dus premium + 3PL (max 3 hari kerja).
        </div>
      </div>
    </div>
  </div>;
}

import React from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, formatIdr } from "../lib/api";

export default function DropDetail(){
  const { id } = useParams();
  const { data, isLoading } = useQuery({ queryKey:["drop",id], queryFn:()=> api.drop(id!), enabled: !!id });
  if(isLoading) return <div className="muted">Memuat...</div>;
  if(!data) return <div className="card card-pad">Drop tidak ditemukan. <Link to="/drops" style={{color:"var(--gold)"}}>Kembali</Link></div>;
  const d:any = (data as any).title ? data as any : (data as any).drop ?? data;
  const drop = (d as any).title ? d as any : d;
  const price = drop.priceCcoin ?? drop.priceCcoin ?? drop.priceUnsignedCCoin ?? 30;
  const pct = drop.totalUnits ? Math.round(drop.soldCount/drop.totalUnits*100) : 0;
  const isLive = drop.status==="live" || drop.status==="published";
  const dropAt = drop.dropStartAt ?? drop.dropAt;
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
            <div><div style={{fontSize:11,color:"var(--dim)",fontWeight:700}}>SIGNED (1:10)</div><div style={{fontWeight:700}}>{drop.signedCount}</div></div>
            <div><div style={{fontSize:11,color:"var(--dim)",fontWeight:700}}>TERJUAL</div><div style={{fontWeight:700}}>{drop.soldCount}/{drop.totalUnits} ({pct}%)</div></div>
            <div><div style={{fontSize:11,color:"var(--dim)",fontWeight:700}}>HARGA (platform-produced)</div><div style={{fontWeight:800}}>{price} C-Coin · <span style={{fontSize:11,color:"var(--muted)"}}>{formatIdr(price*10000)}</span></div></div>
          </div>
          <div className="progress" style={{marginTop:12}}><div className="progress-fill" style={{width:`${pct}%`}}/></div>
          <div style={{fontSize:11,color:"var(--dim)",marginTop:8}}>by {drop.creatorName} · {dropAt ? new Date(dropAt).toLocaleString("id-ID") : ""} · Drop ID: {drop.id}</div>
          {drop.creatorId && <Link to={"/c/"+drop.creatorId} style={{fontSize:12, color:"var(--gold)", marginTop:8, display:"inline-block"}}>Lihat kreator →</Link>}
        </div>
      </div>
      <div className="card card-pad" style={{display:"flex",flexDirection:"column",gap:14}}>
        <div>
          <div style={{fontWeight:700,fontSize:16}}>Checkout — 1 kartu / user / drop</div>
          <div className="muted" style={{fontSize:12}}>Harga fixed · limit 1 kartu/user/drop · potong C-Coin · opsi kirim fisik (ongkir C-Coin) atau simpan di vault.</div>
        </div>
        <div style={{background:"var(--bg-elevated)",border:"1px solid var(--border)",borderRadius:10,padding:12,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div><div style={{fontSize:11,color:"var(--dim)",fontWeight:700}}>HARGA DROP</div><div style={{fontWeight:800,fontSize:18}}>{price} C-Coin <span style={{fontSize:11,color:"var(--muted)",fontWeight:400}}>({formatIdr(price*10000)})</span></div></div>
          <div style={{fontSize:11,color:"var(--muted)",textAlign:"right"}}>Platform-produced 70/30<br/>Kreator-produced defer Y2+</div>
        </div>
        {!isLive ? <div className="pill pill-warn" style={{justifyContent:"center",padding:"10px"}}>Drop belum live (status: {drop.status}) — checkout disabled</div>
        : <Link to={"/drops/"+drop.id+"/checkout"} className="btn-gold" style={{padding:"14px",fontSize:15, width:"100%", textAlign:"center", textDecoration:"none"}}>Checkout — pilih kirim fisik / vault →</Link>}
        <div style={{fontSize:11,color:"var(--dim)",lineHeight:"1.5"}}>
          Saldo kurang? <Link to="/wallet" style={{color:"var(--gold)",fontWeight:700}}>Top-up C-Coin di Wallet →</Link>
          <span style={{marginLeft:8}}>KYC: payout/disbursement ke IDR + akumulasi top-up besar (99 C-Coin). Tidak ada KYC untuk buyout/accept bid.</span>
        </div>
      </div>
    </div>
  </div>;
}

import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, formatIdr } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useToast } from "../lib/toast";

export default function Wallet(){
  const { user } = useAuth();
  const { push } = useToast();
  const [amount,setAmount]=useState(50);
  const [method,setMethod]=useState("qris");
  const [payoutAmt,setPayoutAmt]=useState(10);

  const { data, refetch, isLoading } = useQuery({ queryKey:["wallet"], queryFn:()=> api.wallet(), enabled: !!user });

  async function onTopup(){
    try{
      const r=await api.topup(amount,method);
      push(`Top-up ${amount} C-Coin berhasil! Saldo: ${r.wallet.balanceCCoin} C-Coin · Top-up tidak menambah XP.`, "success");
      refetch();
    }catch(e:any){ push(e.message || String(e), "error"); }
  }
  async function onPayout(){
    try{ const r=await api.payout(payoutAmt); push(`Payout ${payoutAmt} C → net ${r.netCCoin} C (${formatIdr(r.netIdr)}), fee ${r.feeCCoin} C`, "success"); refetch(); }
    catch(e:any){ push(e.message || String(e), "error"); }
  }

  if(!user) return <div className="card card-pad">Silakan <a href="/login" style={{color:"var(--gold)"}}>login</a> untuk membuka Wallet.</div>;
  if(isLoading) return <div className="muted">Memuat wallet...</div>;
  const w:any = (data as any).wallet;
  const txs:any[] = (data as any).transactions ?? [];
  const rate = (data as any).rate ?? 10000;
  return <div style={{display:"flex",flexDirection:"column",gap:18}}>
    <div>
      <span className="eyebrow">C-Coin Wallet — Opsi A (closed-loop)</span>
      <h1 className="h2">Wallet C-Coin</h1>
      <p className="muted">1 C-Coin = Rp 10.000 · Buyer closed-loop (tanpa withdraw) · Seller/creator auto-disburse IDR kena payout fee 1% · Semua nominal integer ≥1.</p>
    </div>

    <div className="grid-2">
      <div className="card card-pad" style={{background:"linear-gradient(135deg,#1a1a2e 0%,#2a2030 100%)"}}>
        <div style={{fontSize:11,fontWeight:700,letterSpacing:"0.08em",color:"var(--gold)",textTransform:"uppercase"}}>Saldo C-Coin</div>
        <div style={{fontSize:42,fontWeight:800,marginTop:6}}>{w.balanceCCoin} <span style={{fontSize:16,color:"var(--muted)",fontWeight:600}}>C-Coin</span></div>
        <div style={{fontSize:13,color:"var(--muted)"}}>≈ {formatIdr(w.balanceIdrEquiv ?? w.balanceCCoin*rate)} · Top-up total {w.totalTopupCCoin} C · Spent {w.totalSpentCCoin} C</div>
        <div style={{fontSize:11,color:"var(--dim)",marginTop:8}}>Closed-loop — saldo tidak dapat diuangkan (buyer). Payout hanya untuk seller/creator hasil jual (disburst IDR). KYC trigger: kumulatif &gt;99 C-Coin / pasang buyout / accept bid.</div>
        <div style={{fontSize:11,color:"var(--warn, #eab308)",marginTop:8}}>Level XP: top-up TIDAK menambah XP — hanya spending C-Coin (1 C = 1 XP) + reward badge yang menambah.</div>
      </div>

      <div className="card card-pad" style={{display:"flex",flexDirection:"column",gap:12}}>
        <div style={{fontWeight:700}}>Top-up C-Coin (area user — bukan publik)</div>
        <div className="muted" style={{fontSize:12}}>Via Midtrans Snap (sandbox) · Q026 gate go-live — build penuh, tombol disabled hanya saat menunggu legal (lihat docs/07 C-01).</div>
        <div style={{display:"flex",gap:8}}>
          <select className="select" value={method} onChange={e=> setMethod(e.target.value)} style={{flex:1}}>
            <option value="qris">QRIS</option><option value="va_bca">VA BCA</option><option value="va_mandiri">VA Mandiri</option><option value="ewallet_gopay">GoPay</option><option value="ewallet_ovo">OVO</option>
          </select>
          <select className="select" value={amount} onChange={e=> setAmount(Number(e.target.value))} style={{flex:1}}>
            {[10,20,30,50,100,200,500].map(v=> <option key={v} value={v}>{v} C-Coin ({formatIdr(v*10000)})</option>)}
          </select>
        </div>
        <button className="btn-gold" onClick={onTopup} style={{padding:"10px"}}>Top-up {amount} C-Coin</button>
        <div style={{borderTop:"1px solid var(--border)",marginTop:4,paddingTop:12,display:"flex",flexDirection:"column",gap:8}}>
          <div style={{fontWeight:700,fontSize:13}}>Payout ke IDR (seller/creator only) — KYC wajib</div>
          <div style={{display:"flex",gap:8}}>
            <input className="input" type="number" min={1} value={payoutAmt} onChange={e=> setPayoutAmt(Number(e.target.value))} style={{flex:1}}/>
            <button className="btn-ghost" onClick={onPayout}>Payout</button>
          </div>
          <div style={{fontSize:11,color:"var(--dim)"}}>Fee 1% fixed. Contoh: 85 C → fee 1 C → net 84 C = {formatIdr(840000)}. Buyer tidak bisa payout (closed-loop).</div>
        </div>
      </div>
    </div>

    <div className="card">
      <div style={{padding:"14px 16px",fontWeight:700,fontSize:13,borderBottom:"1px solid var(--border)",display:"flex",justifyContent:"space-between"}}>
        <span>Riwayat Transaksi (Ledger Immutable — append-only)</span>
        <button className="btn-ghost" style={{padding:"4px 10px",fontSize:11}} onClick={()=> refetch()}>Refresh</button>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Waktu</th><th>Tipe</th><th>Jumlah</th><th>Saldo Akhir</th><th>Catatan</th></tr></thead>
          <tbody>
            {txs.length===0 ? <tr><td colSpan={5} style={{textAlign:"center",color:"var(--muted)",padding:20}}>Belum ada transaksi.</td></tr> :
            txs.map((t:any)=> <tr key={t.id}>
              <td style={{fontSize:11,color:"var(--muted)"}}>{new Date(t.createdAt).toLocaleString("id-ID")}</td>
              <td><span className={`pill ${t.type==="topup"||t.type==="top_up"?"pill-success": t.type==="checkout"?"pill-warn": t.type==="payout"?"pill-info":"pill-warn"}`}>{t.type}</span></td>
              <td style={{fontWeight:700, color: t.amountCCoin>0?"var(--success)":"var(--error)"}}>{t.amountCCoin>0?"+":""}{t.amountCCoin} C</td>
              <td>{t.balanceAfterCCoin} C</td>
              <td style={{fontSize:11,color:"var(--muted)",maxWidth:260,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}} title={t.note}>{t.note}</td>
            </tr>)}
          </tbody>
        </table>
      </div>
    </div>
  </div>;
}

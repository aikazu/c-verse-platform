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
      push(`Isi ${amount} C berhasil — saldo ${r.wallet.balanceCCoin} C`, "success");
      refetch();
    }catch(e:any){ push(e.message || String(e), "error"); }
  }
  async function onPayout(){
    try{ const r=await api.payout(payoutAmt); push(`Tarik ${payoutAmt} C → ${r.netCCoin} C (${formatIdr(r.netIdr)})`, "success"); refetch(); }
    catch(e:any){ push(e.message || String(e), "error"); }
  }

  if(!user) return <div className="card card-pad" style={{textAlign:"center", padding:32}}><span className="eyebrow">Dompet</span><p className="muted" style={{marginTop:8}}>Masuk untuk membuka dompet</p><a href="/login" style={{color:"var(--gold)", fontSize:13, fontWeight:600, marginTop:10, display:"inline-block"}}>Masuk →</a></div>;
  if(isLoading) return <div className="muted" style={{padding:24, textAlign:"center"}}>Memuat…</div>;
  const w:any = (data as any).wallet;
  const txs:any[] = (data as any).transactions ?? [];
  const rate = (data as any).rate ?? 10000;
  return <div style={{display:"flex",flexDirection:"column",gap:20}}>
    <div>
      <span className="eyebrow">Dompet</span>
      <h1 className="h2" style={{marginTop:4}}>C<em style={{fontStyle:"italic", fontWeight:300, color:"var(--gold)"}}>-Coin</em></h1>
      <p className="muted" style={{marginTop:4}}>1 C = Rp 10.000</p>
    </div>

    <div className="grid-2">
      {/* Balance — spec-sheet style */}
      <div className="card card-pad" style={{background:"var(--surface-2)", padding:24}}>
        <div style={{fontFamily:"var(--font-mono)", fontSize:10, fontWeight:500, letterSpacing:"0.12em", textTransform:"uppercase", color:"var(--gold)"}}>Saldo</div>
        <div style={{display:"flex", alignItems:"baseline", gap:8, marginTop:10}}>
          <span style={{fontFamily:"var(--font-display)", fontSize:44, fontWeight:500, letterSpacing:"-0.02em"}}>{w.balanceCCoin}</span>
          <span style={{fontFamily:"var(--font-mono)", fontSize:13, color:"var(--text-muted)", fontWeight:500}}>C-Coin</span>
        </div>
        <div style={{fontFamily:"var(--font-mono)", fontSize:11, color:"var(--text-muted)", marginTop:6}}>≈ {formatIdr(w.balanceIdrEquiv ?? w.balanceCCoin*rate)}</div>
        <hr style={{border:"none", borderTop:"1px solid var(--border)", margin:"16px 0 0"}} />
        <div style={{display:"flex", gap:16, marginTop:12}}>
          <span style={{fontFamily:"var(--font-mono)", fontSize:11, color:"var(--text-dim)"}}>Total isi {w.totalTopupCCoin ?? 0} C</span>
          <span style={{fontFamily:"var(--font-mono)", fontSize:11, color:"var(--text-dim)"}}>Terpakai {w.totalSpentCCoin ?? 0} C</span>
        </div>
      </div>

      {/* Actions — operate surface */}
      <div className="card card-pad" style={{display:"flex",flexDirection:"column",gap:14}}>
        <div>
          <div style={{fontWeight:600, fontSize:14}}>Isi Saldo</div>
          <div className="muted" style={{fontSize:11, marginTop:2}}>Pilih metode dan nominal — 1 C = Rp 10.000 (Opsi A closed-loop)</div>
        </div>
        <div style={{background:"rgba(234,179,8,0.08)", border:"1px solid rgba(234,179,8,0.18)", borderRadius:10, padding:"10px 12px", fontSize:11, lineHeight:1.5, color:"var(--text-muted)"}}>
          Saldo <strong style={{color:"var(--text)"}}>tidak dapat diuangkan</strong> (Gamified Point — Opsi A). Refund hanya reversal ke metode asal atau penutupan akun bersaldo ke top-up terakhir. Cap saldo {((data as any)?.balanceCap ?? 1000)} C.
          <br/><span style={{fontFamily:"var(--font-mono)", fontSize:10}}>Isi saldo = kamu setuju T&C C-Coin.</span>
        </div>
        <div style={{display:"flex",gap:8}}>
          <select className="select" value={method} onChange={e=> setMethod(e.target.value)} style={{flex:1}}>
            <option value="qris">QRIS</option><option value="va_bca">VA BCA</option><option value="va_mandiri">VA Mandiri</option><option value="ewallet_gopay">GoPay</option><option value="ewallet_ovo">OVO</option>
          </select>
          <select className="select" value={amount} onChange={e=> setAmount(Number(e.target.value))} style={{flex:1}}>
            {[10,20,30,50,100,200,500].map(v=> <option key={v} value={v}>{v} C · {formatIdr(v*10000)}</option>)}
          </select>
        </div>
        <button className="btn-gold" onClick={onTopup} style={{padding:"11px", width:"100%"}}>Isi {amount} C →</button>

        <div style={{height:1, background:"var(--border)", margin:"4px 0"}} />

        <div style={{display:"flex", alignItems:"center", justifyContent:"space-between"}}>
          <span style={{fontWeight:600, fontSize:13}}>Tarik ke Rekening</span>
          <span style={{fontFamily:"var(--font-mono)", fontSize:10, color:"var(--text-dim)", letterSpacing:"0.06em"}}>MIN 10 C</span>
        </div>
        <div style={{display:"flex",gap:8}}>
          <input className="input" type="number" min={10} value={payoutAmt} onChange={e=> setPayoutAmt(Number(e.target.value))} style={{flex:1}} placeholder="Jumlah C" />
          <button className="btn-ghost" onClick={onPayout}>Tarik</button>
        </div>
        <div style={{fontFamily:"var(--font-mono)", fontSize:11, color:"var(--text-dim)"}}>Biaya 1% · minimal 10 C</div>
      </div>
    </div>

    {/* Ledger — monitor surface */}
    <div className="card">
      <div style={{padding:"14px 16px", display:"flex",justifyContent:"space-between", alignItems:"center", borderBottom:"1px solid var(--border)"}}>
        <span style={{fontWeight:600, fontSize:13}}>Riwayat</span>
        <button className="btn-ghost" style={{padding:"5px 12px",fontSize:11, fontFamily:"var(--font-mono)"}} onClick={()=> refetch()}>Refresh</button>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Waktu</th><th>Tipe</th><th>Jumlah</th><th>Saldo</th><th>Catatan</th></tr></thead>
          <tbody>
            {txs.length===0 ? <tr><td colSpan={5} style={{textAlign:"center",color:"var(--text-muted)",padding:24, fontSize:13}}>Belum ada transaksi</td></tr> :
            txs.map((t:any)=> <tr key={t.id}>
              <td style={{fontFamily:"var(--font-mono)", fontSize:11,color:"var(--text-muted)"}}>{new Date(t.createdAt).toLocaleString("id-ID")}</td>
              <td><span className={`pill ${t.type==="topup"||t.type==="top_up"?"pill-success": t.type==="checkout"?"pill-warn": t.type==="payout"?"pill-info":"pill-warn"}`} style={{fontSize:10}}>{t.type}</span></td>
              <td style={{fontWeight:700, fontFamily:"var(--font-mono)", fontSize:12, color: t.amountCCoin>0?"var(--signal)":"var(--alert)"}}>{t.amountCCoin>0?"+":""}{t.amountCCoin} C</td>
              <td style={{fontFamily:"var(--font-mono)", fontSize:12}}>{t.balanceAfterCCoin} C</td>
              <td style={{fontSize:11,color:"var(--text-muted)",maxWidth:220,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}} title={t.note}>{t.note}</td>
            </tr>)}
          </tbody>
        </table>
      </div>
    </div>
  </div>;
}

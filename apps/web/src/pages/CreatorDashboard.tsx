import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, formatIdr } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useToast } from "../lib/toast";

export default function CreatorDashboard(){
  const { user } = useAuth();
  const { push } = useToast();
  const [form,setForm]=useState({ title:"", series:"", narrative:"", totalUnits:15, priceCcoin:30 });

  const { data: creatorsData } = useQuery({ queryKey:["creators"], queryFn:()=> api.creators() });
  const { data: dropsData, refetch } = useQuery({ queryKey:["creator-drops"], queryFn:()=> api.drops({}) });

  if(!user) return <div className="card card-pad">Login dulu. <a href="/login" style={{color:"var(--gold)"}}>Masuk</a></div>;
  if((user.role as string)!=="creator" && (user.role as string)!=="admin") return <div className="card card-pad">Hanya kreator/admin yang bisa akses dashboard ini. Role kamu: {user.role}.</div>;

  const myDrops:any[] = (dropsData as any)?.drops?.filter((d:any)=> d.creatorId===user.id || (user.role as string)==="admin") ?? [];

  async function onCreate(e:React.FormEvent){
    e.preventDefault();
    try{
      await api.createDrop({ title: form.title, series: form.series, narrative: form.narrative, totalUnits: Number(form.totalUnits), priceCcoin: Number(form.priceCcoin) } as any);
      push("Drop draft dibuat! (createDropSchema: priceCcoin canonical)","success");
      refetch();
      setForm({ title:"", series:"", narrative:"", totalUnits:15, priceCcoin:30 });
    } catch(err:any){ push(err.message,"error"); }
  }

  return <div style={{display:"flex",flexDirection:"column",gap:18}}>
    <div>
      <span className="eyebrow">Creator Dashboard — Traffic & Pendapatan</span>
      <h1 className="h2">Dashboard Kreator</h1>
      <p className="muted">Artwork final di-upload ops (approve off-platform) — kreator hanya lihat trafik & pendapatan. Buat draft tetap bisa (ops flow). Primary platform-produced 70/30 only (creator-produced defer Y2+).</p>
      <p className="muted" style={{fontSize:11, marginTop:6}}>Threshold kreator MVP: 100rb+ followers <b>combined</b> (rekrut off-platform, bukan form aplikasi).</p>
    </div>

    <div className="card card-pad" style={{background:"linear-gradient(135deg,#1a1a2e,#2a2030)"}}>
      <div style={{display:"flex",gap:18,flexWrap:"wrap"}}>
        <div><div style={{fontSize:11,color:"var(--dim)",fontWeight:700}}>TOTAL DROPS</div><div style={{fontSize:22,fontWeight:800}}>{myDrops.length}</div></div>
        <div><div style={{fontSize:11,color:"var(--dim)",fontWeight:700}}>TOTAL TERJUAL</div><div style={{fontSize:22,fontWeight:800}}>{myDrops.reduce((n:any,d:any)=> n+d.soldCount,0)}</div></div>
        <div><div style={{fontSize:11,color:"var(--dim)",fontWeight:700}}>EST. GMV</div><div style={{fontSize:22,fontWeight:800}}>{formatIdr(myDrops.reduce((n:any,d:any)=> n+ d.soldCount*((d.priceCcoin??d.priceUnsignedCCoin)*10000),0))}</div></div>
        <div><div style={{fontSize:11,color:"var(--dim)",fontWeight:700}}>PAYOUT INFO</div><div style={{fontSize:11, color:"var(--muted)"}}>Royalti secondary 7.5% lifetime · Payout batch Selasa H+1 · Fee 1%</div></div>
      </div>
    </div>

    <div className="grid-2" style={{alignItems:"start"}}>
      <form onSubmit={onCreate} className="card card-pad" style={{display:"flex",flexDirection:"column",gap:12}}>
        <div style={{fontWeight:700}}>Buat Drop Draft (ops — artwork final approve off-platform)</div>
        <div style={{fontSize:11, color:"var(--muted)"}}>priceCcoin = canonical (MVP) — integer ≥1 C-Coin; signed = ceil(total/10).</div>
        <div className="form-row" style={{marginBottom:0}}><label className="label">Judul Kartu</label><input className="input" value={form.title} onChange={e=> setForm(s=>({...s,title:e.target.value}))} required placeholder="Karina — Limited Genesis"/></div>
        <div className="form-row" style={{marginBottom:0}}><label className="label">Series</label><input className="input" value={form.series} onChange={e=> setForm(s=>({...s,series:e.target.value}))} required placeholder="HypeCreator X Aespa"/></div>
        <div className="form-row" style={{marginBottom:0}}><label className="label">Narasi</label><textarea className="textarea" value={form.narrative} onChange={e=> setForm(s=>({...s,narrative:e.target.value}))} required placeholder="Cerita kolaborasi..."/></div>
        <div style={{display:"flex",gap:8}}>
          <div className="form-row" style={{flex:1,marginBottom:0}}><label className="label">Total Unit</label><input className="input" type="number" value={form.totalUnits} onChange={e=> setForm(s=>({...s,totalUnits:Number(e.target.value)}))} min={1} max={1000}/></div>
          <div className="form-row" style={{flex:1,marginBottom:0}}><label className="label">Harga (C-Coin)</label><input className="input" type="number" value={form.priceCcoin} onChange={e=> setForm(s=>({...s,priceCcoin:Number(e.target.value)}))} min={1}/></div>
        </div>
        <div style={{fontSize:11,color:"var(--dim)"}}>Signed count = ceil(total/10). Contoh 15 → 2 signed + 13 unsigned (dok 05).</div>
        <button className="btn-gold" style={{padding:11}}>Buat Draft</button>
      </form>

      <div className="card">
        <div style={{padding:"12px 14px",fontWeight:700,borderBottom:"1px solid var(--border)"}}>Drops Saya ({myDrops.length})</div>
        <div style={{display:"flex",flexDirection:"column"}}>
          {myDrops.length===0 ? <div style={{padding:20,textAlign:"center",color:"var(--muted)"}}>Belum ada drop.</div> :
          myDrops.map((d:any)=> <div key={d.id} style={{padding:"12px 14px",borderBottom:"1px solid rgba(42,42,62,0.4)",display:"flex",justifyContent:"space-between",alignItems:"center",gap:10}}>
            <div><div style={{fontWeight:700,fontSize:13}}>{d.title}</div><div style={{fontSize:11,color:"var(--muted)"}}>{d.series} · {d.soldCount}/{d.totalUnits} terjual · {(d.priceCcoin??d.priceUnsignedCCoin)} C</div></div>
            <span className={"pill "+(d.status==="live"?"pill-success": d.status==="draft"?"pill-warn":"pill-info")}>{d.status}</span>
          </div>)}
        </div>
      </div>
    </div>

    <div className="card card-pad">
      <div style={{fontWeight:700,marginBottom:8}}>Info Revenue (per docs/01 & 05)</div>
      <div className="muted" style={{fontSize:12,lineHeight:1.6}}>
        Primary (platform-produced, MVP): 70% platform / 30% kreator. Creator-produced 30/70 <b>defer Y2+</b>. Secondary royalty <b>7.5% ke kreator asal tiap resale lifetime</b> (dari fee secondary 15%).
      </div>
    </div>
  </div>;
}

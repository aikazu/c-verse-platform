import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, formatIdr } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useToast } from "../lib/toast";

export default function CreatorDashboard(){
  const { user } = useAuth();
  const { push } = useToast();
  const [form,setForm]=useState({ title:"", series:"", narrative:"", totalUnits:15, priceUnsignedCCoin:30, priceSignedCCoin:50 });

  const { data: creatorsData } = useQuery({ queryKey:["creators"], queryFn:()=> api.creators() });
  const { data: dropsData, refetch } = useQuery({ queryKey:["creator-drops"], queryFn:()=> api.drops({}) });

  if(!user) return <div className="card card-pad">Login dulu. <a href="/login" style={{color:"var(--gold)"}}>Masuk</a></div>;
  if(user.role!=="creator" && user.role!=="admin") return <div className="card card-pad">Hanya kreator/admin yang bisa akses dashboard ini. Role kamu: {user.role}.</div>;

  const myDrops:any[] = (dropsData as any)?.drops?.filter((d:any)=> d.creatorId===user.id || user.role==="admin") ?? [];

  async function onCreate(e:React.FormEvent){
    e.preventDefault();
    try{ await api.createDrop({ ...form, totalUnits: Number(form.totalUnits), priceUnsignedCCoin: Number(form.priceUnsignedCCoin), priceSignedCCoin: Number(form.priceSignedCCoin) }); push("Drop draft dibuat!","success"); refetch(); setForm({ title:"", series:"", narrative:"", totalUnits:15, priceUnsignedCCoin:30, priceSignedCCoin:50 }); }
    catch(err:any){ push(err.message,"error"); }
  }

  return <div style={{display:"flex",flexDirection:"column",gap:18}}>
    <div>
      <span className="eyebrow">Creator Dashboard — Sales Analytics</span>
      <h1 className="h2">Dashboard Kreator</h1>
      <p className="muted">Buat drop draft → admin review → live. Revenue share 70/30 (platform-produced) / 30/70 (creator-produced).</p>
    </div>

    <div className="card card-pad" style={{background:"linear-gradient(135deg,#1a1a2e,#2a2030)"}}>
      <div style={{display:"flex",gap:18,flexWrap:"wrap"}}>
        <div><div style={{fontSize:11,color:"var(--dim)",fontWeight:700}}>TOTAL DROPS</div><div style={{fontSize:22,fontWeight:800}}>{myDrops.length}</div></div>
        <div><div style={{fontSize:11,color:"var(--dim)",fontWeight:700}}>TOTAL TERJUAL</div><div style={{fontSize:22,fontWeight:800}}>{myDrops.reduce((n:any,d:any)=> n+d.soldCount,0)}</div></div>
        <div><div style={{fontSize:11,color:"var(--dim)",fontWeight:700}}>EST. GMV</div><div style={{fontSize:22,fontWeight:800}}>{formatIdr(myDrops.reduce((n:any,d:any)=> n+ d.soldCount*((d.priceUnsignedCCoin*10000+d.priceSignedCCoin*10000)/2),0))}</div></div>
      </div>
    </div>

    <div className="grid-2" style={{alignItems:"start"}}>
      <form onSubmit={onCreate} className="card card-pad" style={{display:"flex",flexDirection:"column",gap:12}}>
        <div style={{fontWeight:700}}>Buat Drop Baru (Draft)</div>
        <div className="form-row" style={{marginBottom:0}}><label className="label">Judul Kartu</label><input className="input" value={form.title} onChange={e=> setForm(s=>({...s,title:e.target.value}))} required placeholder="Karina — Limited Genesis"/></div>
        <div className="form-row" style={{marginBottom:0}}><label className="label">Series</label><input className="input" value={form.series} onChange={e=> setForm(s=>({...s,series:e.target.value}))} required placeholder="HypeCreator X Aespa"/></div>
        <div className="form-row" style={{marginBottom:0}}><label className="label">Narasi</label><textarea className="textarea" value={form.narrative} onChange={e=> setForm(s=>({...s,narrative:e.target.value}))} required placeholder="Cerita kolaborasi..."/></div>
        <div style={{display:"flex",gap:8}}>
          <div className="form-row" style={{flex:1,marginBottom:0}}><label className="label">Total Unit</label><input className="input" type="number" value={form.totalUnits} onChange={e=> setForm(s=>({...s,totalUnits:Number(e.target.value)}))} min={1} max={200}/></div>
          <div className="form-row" style={{flex:1,marginBottom:0}}><label className="label">Unsigned (C)</label><input className="input" type="number" value={form.priceUnsignedCCoin} onChange={e=> setForm(s=>({...s,priceUnsignedCCoin:Number(e.target.value)}))}/></div>
          <div className="form-row" style={{flex:1,marginBottom:0}}><label className="label">Signed (C)</label><input className="input" type="number" value={form.priceSignedCCoin} onChange={e=> setForm(s=>({...s,priceSignedCCoin:Number(e.target.value)}))}/></div>
        </div>
        <div style={{fontSize:11,color:"var(--dim)"}}>Signed count = ceil(total/10) (1 per 10). Contoh 15 → 1 signed + 14 unsigned.</div>
        <button className="btn-gold" style={{padding:11}}>Buat Draft</button>
      </form>

      <div className="card">
        <div style={{padding:"12px 14px",fontWeight:700,borderBottom:"1px solid var(--border)"}}>Drops Saya ({myDrops.length})</div>
        <div style={{display:"flex",flexDirection:"column"}}>
          {myDrops.length===0 ? <div style={{padding:20,textAlign:"center",color:"var(--muted)"}}>Belum ada drop.</div> :
          myDrops.map((d:any)=> <div key={d.id} style={{padding:"12px 14px",borderBottom:"1px solid rgba(42,42,62,0.4)",display:"flex",justifyContent:"space-between",alignItems:"center",gap:10}}>
            <div><div style={{fontWeight:700,fontSize:13}}>{d.title}</div><div style={{fontSize:11,color:"var(--muted)"}}>{d.series} · {d.soldCount}/{d.totalUnits} terjual · {d.priceUnsignedCCoin} C / {d.priceSignedCCoin} C</div></div>
            <span className={`pill ${d.status==="live"?"pill-success": d.status==="draft"?"pill-warn":"pill-info"}`}>{d.status}</span>
          </div>)}
        </div>
      </div>
    </div>

    <div className="card card-pad">
      <div style={{fontWeight:700,marginBottom:8}}>Info Revenue</div>
      <div className="muted" style={{fontSize:12,lineHeight:1.6}}>
        Platform-produced: 70% platform / 30% kreator · Creator-produced: 30/70 · Secondary royalty lifetime 7.5% ke kreator asal tiap resale.
        Payout mingguan Selasa — C-Coin → IDR kurs Rp 10.000/C, fee disbursement 1%.
      </div>
    </div>
  </div>;
}

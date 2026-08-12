import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useToast } from "../lib/toast";

export default function Admin(){
  const { user } = useAuth();
  const { push } = useToast();
  const [fullName,setFullName]=useState("");
  const [nik,setNik]=useState("");
  const [addr,setAddr]=useState("");
  const { data: kycAll, refetch: refetchKyc } = useQuery({ queryKey:["kyc-all"], queryFn:()=> api.kycAll(), enabled: user?.role==="admin" });
  const { data: dropsData, refetch: refetchDrops } = useQuery({ queryKey:["admin-drops"], queryFn:()=> api.drops({}), enabled: user?.role==="admin" });

  if(!user) return <div className="card card-pad">Login dulu.</div>;
  if(user.role!=="admin") return <div className="card card-pad">Hanya admin. Role kamu: {user.role}. Login sebagai admin@cverse.id / admin123.</div>;

  async function onApprove(id:string){ try{ await api.approveKyc(id); push("KYC approved + badge Verified","success"); refetchKyc(); }catch(e:any){ push(e.message,"error"); } }
  async function onSubmitKycForDemo(e:React.FormEvent){
    e.preventDefault();
    try{ await api.submitKyc({ fullName, nik, address: addr }); push("KYC submitted","success"); refetchKyc(); }
    catch(e:any){ push(e.message,"error"); }
  }
  async function setDropStatus(id:string, status:string){
    try{
      const headers:Record<string,string> = { "Content-Type":"application/json", Authorization: `Bearer ${localStorage.getItem("cverse_token")}` };
      const res = await fetch(`/api/drops/${id}/status`, { method:"PATCH", headers, body: JSON.stringify({status}) });
      const j = await res.json();
      if(!res.ok) throw new Error(j.error);
      push(`Drop ${id} → ${status}`,"success"); refetchDrops();
    }catch(e:any){ push(e.message,"error"); }
  }

  const kycList:any[] = (kycAll as any)?.kyc ?? [];
  const drops:any[] = (dropsData as any)?.drops ?? [];

  return <div style={{display:"flex",flexDirection:"column",gap:18}}>
    <div>
      <span className="eyebrow">Admin — Kurasi & KYC</span>
      <h1 className="h2">Admin Panel</h1>
    </div>

    <div className="grid-2" style={{alignItems:"start"}}>
      <div className="card card-pad" style={{display:"flex",flexDirection:"column",gap:12}}>
        <div style={{fontWeight:700}}>Submit KYC (demo — untuk user login)</div>
        <form onSubmit={onSubmitKycForDemo} style={{display:"flex",flexDirection:"column",gap:10}}>
          <input className="input" placeholder="Nama lengkap" value={fullName} onChange={e=> setFullName(e.target.value)} required/>
          <input className="input" placeholder="NIK 16 digit" value={nik} onChange={e=> setNik(e.target.value)} required maxLength={16}/>
          <textarea className="textarea" placeholder="Alamat" value={addr} onChange={e=> setAddr(e.target.value)} required/>
          <button className="btn-gold">Submit KYC (sebagai admin)</button>
        </form>
        <div className="card" style={{overflow:"hidden"}}>
          <div style={{padding:"10px 12px",fontWeight:700,fontSize:12,borderBottom:"1px solid var(--border)"}}>KYC Queue ({kycList.length})</div>
          {kycList.length===0 ? <div style={{padding:16,textAlign:"center",color:"var(--muted)",fontSize:12}}>Belum ada KYC.</div> :
          kycList.map((k:any)=> <div key={k.id} style={{padding:"10px 12px",borderBottom:"1px solid rgba(42,42,62,0.4)",display:"flex",justifyContent:"space-between",alignItems:"center",gap:8}}>
            <div><div style={{fontWeight:700,fontSize:12}}>{k.fullName} · {k.nik.slice(0,4)}****</div><div style={{fontSize:11,color:"var(--muted)"}}>{k.userId} · {k.status}</div></div>
            {k.status==="pending" && <button className="btn-gold" style={{padding:"6px 12px",fontSize:12}} onClick={()=> onApprove(k.id)}>Approve</button>}
            {k.status==="approved" && <span className="pill pill-success">approved</span>}
          </div>)}
        </div>
      </div>

      <div className="card">
        <div style={{padding:"12px 14px",fontWeight:700,borderBottom:"1px solid var(--border)",display:"flex",justifyContent:"space-between"}}>
          <span>Drops — Manage Status ({drops.length})</span>
          <button className="btn-ghost" style={{padding:"4px 10px",fontSize:11}} onClick={()=> refetchDrops()}>Refresh</button>
        </div>
        {drops.map((d:any)=> <div key={d.id} style={{padding:"10px 12px",borderBottom:"1px solid rgba(42,42,62,0.4)",display:"flex",justifyContent:"space-between",alignItems:"center",gap:8,flexWrap:"wrap"}}>
          <div><div style={{fontWeight:700,fontSize:12}}>{d.title} · {d.soldCount}/{d.totalUnits}</div><div style={{fontSize:11,color:"var(--muted)"}}>{d.series} · {d.id}</div></div>
          <div style={{display:"flex",gap:6,alignItems:"center"}}>
            <span className={`pill ${d.status==="live"?"pill-success": d.status==="draft"?"pill-warn":"pill-info"}`} style={{fontSize:10}}>{d.status}</span>
            <select value={d.status} onChange={e=> setDropStatus(d.id, e.target.value)} className="select" style={{width:120,padding:"6px 8px",fontSize:11}}>
              <option value="draft">draft</option><option value="review">review</option><option value="approved">approved</option><option value="production">production</option><option value="scheduled">scheduled</option><option value="live">live</option><option value="ended">ended</option><option value="cancelled">cancelled</option>
            </select>
          </div>
        </div>)}
      </div>
    </div>
  </div>;
}

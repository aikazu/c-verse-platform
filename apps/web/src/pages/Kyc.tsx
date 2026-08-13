import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useToast } from "../lib/toast";

export default function Kyc(){
  const { push } = useToast();
  const { data, refetch } = useQuery({ queryKey:["kyc"], queryFn:()=> api.kyc() });
  const kyc:any = (data as any)?.kyc;
  const [fullName, setFullName] = useState("");
  const [nik, setNik] = useState("");
  const [address, setAddress] = useState("");
  const [saving, setSaving] = useState(false);
  async function onSubmit(){
    if(fullName.length < 2 || nik.length!==16 || address.length < 10){ push("Lengkapi nama, NIK 16 digit, dan alamat min 10 karakter","info"); return; }
    setSaving(true);
    try{ await api.submitKyc({ fullName, nik, address }); push("KYC terkirim — status pending (verifikasi manual)","success"); refetch(); }catch(e:any){ push(e.message,"error"); } finally{ setSaving(false); }
  }
  return <div style={{maxWidth:640, margin:"0 auto", display:"flex", flexDirection:"column", gap:18}}>
    <div className="card card-pad">
      <span className="eyebrow">KYC — Trigger</span>
      <h1 className="h2" style={{marginTop:6}}>Verifikasi KYC</h1>
      <p className="muted" style={{fontSize:13, marginTop:8}}>Wajib sebelum: top-up kumulatif &gt; 99 C-Coin, pasang buyout price, atau accept bid (dok 07 C-05b). Verifikasi manual Y1.</p>
      {kyc ? <div style={{marginTop:12, padding:"12px 14px", borderRadius:10, background: kyc.status==="approved" ? "rgba(34,197,94,0.12)" : kyc.status==="rejected" ? "rgba(239,68,68,0.12)" : "rgba(234,179,8,0.12)"}}>
        <div style={{fontWeight:700, fontSize:13}}>Status: {kyc.status.toUpperCase()} — {kyc.fullName} · {kyc.nik}</div>
        {kyc.status==="approved" && <div className="muted" style={{fontSize:12, marginTop:4}}>KYC approved — badge Verified + XP. Kamu bisa pasang buyout / accept bid.</div>}
        {kyc.status==="pending" && <div className="muted" style={{fontSize:12, marginTop:4}}>Menunggu review admin.</div>}
        {kyc.status==="rejected" && <div className="muted" style={{fontSize:12, marginTop:4}}>Ditolak — silakan ajukan ulang.</div>}
      </div> : <div className="muted" style={{fontSize:13, marginTop:12}}>Belum ada KYC.</div>}
    </div>
    {(!kyc || kyc.status!=="approved") && <div className="card card-pad">
      <div style={{fontWeight:700, marginBottom:12}}>Ajukan KYC</div>
      <label style={{fontSize:12, fontWeight:700, color:"var(--dim)"}}>Nama Lengkap</label>
      <input className="input" value={fullName} onChange={e=> setFullName(e.target.value)} style={{marginTop:6, marginBottom:12}} />
      <label style={{fontSize:12, fontWeight:700, color:"var(--dim)"}}>NIK (16 digit)</label>
      <input className="input" value={nik} onChange={e=> setNik(e.target.value.replace(/\D/g,"").slice(0,16))} style={{marginTop:6, marginBottom:12}} />
      <label style={{fontSize:12, fontWeight:700, color:"var(--dim)"}}>Alamat</label>
      <textarea className="input" value={address} onChange={e=> setAddress(e.target.value)} rows={3} style={{marginTop:6, marginBottom:12}} />
      <button className="btn-gold" onClick={onSubmit} disabled={saving} style={{width:"100%"}}>{saving ? "Mengirim..." : "Kirim KYC"}</button>
    </div>}
  </div>;
}

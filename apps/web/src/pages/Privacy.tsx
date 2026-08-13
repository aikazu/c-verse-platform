import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useToast } from "../lib/toast";

export default function Privacy(){
  const { push } = useToast();
  const { data, refetch } = useQuery({ queryKey:["profile-privacy"], queryFn:()=> api.profile() });
  const isAnonymous = (data as any)?.user?.isAnonymous ?? false;
  const [saving, setSaving] = useState(false);
  async function toggle(){
    setSaving(true);
    try{ await api.patchPrivacy(!isAnonymous); push(!isAnonymous ? "Profil disembunyikan" : "Profil ditampilkan", "success"); refetch(); }catch(e:any){ push(e.message,"error"); } finally{ setSaving(false); }
  }
  return <div style={{maxWidth:640, margin:"0 auto", display:"flex", flexDirection:"column", gap:18}}>
    <div className="card card-pad">
      <h1 className="h2">Privasi</h1>
      <p className="muted" style={{fontSize:13, marginTop:8}}>Sembunyikan koleksi dan aktivitas dari publik</p>
      <div style={{display:"flex", alignItems:"center", gap:12, marginTop:16, padding:"12px 14px", background:"rgba(255,215,0,0.06)", borderRadius:10}}>
        <span style={{fontSize:13, flex:1}}><b>{isAnonymous ? "Disembunyikan" : "Ditampilkan"}</b></span>
        <button className={isAnonymous ? "btn-ghost" : "btn-gold"} onClick={toggle} disabled={saving} style={{padding:"8px 16px"}}>{saving ? "..." : isAnonymous ? "Tampilkan" : "Sembunyikan"}</button>
      </div>
    </div>
  </div>;
}

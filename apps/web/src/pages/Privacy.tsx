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
  return <div style={{maxWidth:560, margin:"0 auto", display:"flex", flexDirection:"column", gap:18}}>
    <div>
      <span className="eyebrow">Privasi</span>
      <h1 className="h2" style={{marginTop:4}}>Privasi</h1>
      <p className="muted" style={{marginTop:6}}>Kontrol visibilitas koleksi di profil publik</p>
    </div>
    <div className="card card-pad">
      <div style={{display:"flex", alignItems:"center", gap:14, flexWrap:"wrap"}}>
        <div style={{flex:1, minWidth:160}}>
          <div style={{fontWeight:600, fontSize:14}}>{isAnonymous ? "Disembunyikan" : "Ditampilkan"}</div>
          <div style={{fontFamily:"var(--font-mono)", fontSize:11, color:"var(--text-muted)", marginTop:2}}>{isAnonymous ? "Koleksi tidak terlihat publik" : "Koleksi terlihat di profil publik"}</div>
        </div>
        <button className={isAnonymous ? "btn-ghost" : "btn-gold"} onClick={toggle} disabled={saving} style={{padding:"10px 18px", fontFamily:"var(--font-mono)", fontSize:12}}>{saving ? "…" : isAnonymous ? "Tampilkan" : "Sembunyikan"}</button>
      </div>
    </div>
  </div>;
}

import React, { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { useToast } from "../lib/toast";

export default function Register(){
  const { register } = useAuth();
  const { push } = useToast();
  const nav = useNavigate();
  const [email,setEmail]=useState("");
  const [name,setName]=useState("");
  const [pass,setPass]=useState("");
  const [busy,setBusy]=useState(false);
  async function onSubmit(e:React.FormEvent){ e.preventDefault(); setBusy(true); try{ await register(email,pass,name); push("Registrasi berhasil","success"); nav("/drops"); }catch(err:any){ push(err.message,"error"); } finally{ setBusy(false); } }
  return <div style={{maxWidth:420,margin:"40px auto"}}>
    <div className="card card-pad" style={{display:"flex",flexDirection:"column",gap:16}}>
      <div><h1 className="h2">Daftar</h1><p className="muted">Buat akun kolektor C.Verse.</p></div>
      <form onSubmit={onSubmit} style={{display:"flex",flexDirection:"column",gap:12}}>
        <div className="form-row" style={{marginBottom:0}}><label className="label">Nama Tampilan</label><input className="input" value={name} onChange={e=> setName(e.target.value)} required/></div>
        <div className="form-row" style={{marginBottom:0}}><label className="label">Email</label><input className="input" value={email} onChange={e=> setEmail(e.target.value)} type="email" required/></div>
        <div className="form-row" style={{marginBottom:0}}><label className="label">Password (min 6)</label><input className="input" value={pass} onChange={e=> setPass(e.target.value)} type="password" required minLength={6}/></div>
        <button className="btn-gold" disabled={busy} style={{padding:11}}>{busy?"...":"Daftar"}</button>
      </form>
      <div style={{fontSize:12,color:"var(--muted)",textAlign:"center"}}>Sudah punya akun? <Link to="/login" style={{color:"var(--gold)",fontWeight:700}}>Masuk</Link></div>
    </div>
  </div>;
}

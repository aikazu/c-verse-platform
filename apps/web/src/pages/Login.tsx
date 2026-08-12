import React, { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { useToast } from "../lib/toast";

export default function Login(){
  const { login, demoLogin } = useAuth();
  const { push } = useToast();
  const nav = useNavigate();
  const [email,setEmail]=useState("demo@cverse.id");
  const [pass,setPass]=useState("demo123");
  const [busy,setBusy]=useState(false);
  async function onSubmit(e:React.FormEvent){ e.preventDefault(); setBusy(true); try{ await login(email,pass); push("Login berhasil","success"); nav("/drops"); }catch(err:any){ push(err.message,"error"); } finally{ setBusy(false); } }
  async function onDemo(){ setBusy(true); try{ await demoLogin(); push("Demo login berhasil","success"); nav("/drops"); }catch(err:any){ push(err.message,"error"); } finally{ setBusy(false); } }
  return <div style={{maxWidth:420,margin:"40px auto"}}>
    <div className="card card-pad" style={{display:"flex",flexDirection:"column",gap:16}}>
      <div><h1 className="h2">Masuk</h1><p className="muted">Masuk ke C.Verse · atau pakai demo login 1-klik.</p></div>
      <form onSubmit={onSubmit} style={{display:"flex",flexDirection:"column",gap:12}}>
        <div className="form-row" style={{marginBottom:0}}><label className="label">Email</label><input className="input" value={email} onChange={e=> setEmail(e.target.value)} type="email" required/></div>
        <div className="form-row" style={{marginBottom:0}}><label className="label">Password</label><input className="input" value={pass} onChange={e=> setPass(e.target.value)} type="password" required/></div>
        <button className="btn-gold" disabled={busy} style={{padding:11}}>{busy?"...":"Masuk"}</button>
      </form>
      <button className="btn-ghost" onClick={onDemo} disabled={busy} style={{padding:11}}>⚡ Demo Login (1-klik)</button>
      <div style={{fontSize:12,color:"var(--muted)",textAlign:"center"}}>Belum punya akun? <Link to="/register" style={{color:"var(--gold)",fontWeight:700}}>Daftar</Link> · Demo: demo@cverse.id / demo123</div>
    </div>
  </div>;
}

import React, { useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { useToast } from "../lib/toast";

export default function Landing(){
 const { user, demoLogin } = useAuth();
 const { push } = useToast();
 const [loading,setLoading]=useState(false);
 async function onDemo(){ setLoading(true); try{ await demoLogin(); push("Masuk sebagai Demo Kolektor ✓","success"); }catch(e:any){ push(e.message,"error"); } finally{ setLoading(false); } }
 return <div style={{display:"flex",flexDirection:"column",gap:28}}>
 <div style={{background:"linear-gradient(135deg,#0f0f1a 0%,#1a1030 50%,#0f1a2e 100%)",border:"1px solid var(--border)",borderRadius:16,padding:"40px 28px", display:"flex",gap:32,alignItems:"center",flexWrap:"wrap"}}>
 <div style={{flex:"1 1 380px"}}>
 <span className="eyebrow">C.Verse — Creator Verse</span>
 <h1 className="h1" style={{marginTop:8}}>Revolusi<br/><span style={{color:"var(--gold)"}}>Ekonomi Kreator</span></h1>
 <p className="muted" style={{marginTop:14,maxWidth:520}}>
 Kartu kolaborasi edisi terbatas dalam acrylic hardcase premium.
 Tiap kartu = 1 NFC terverifikasi = 1 sertifikat digital.
 Primary <b style={{color:"var(--text)"}}>siapa cepat dia dapat</b> · Secondary lelang P2P bebas.
 </p>
 <div style={{display:"flex",gap:10,marginTop:20,flexWrap:"wrap"}}>
 <Link to="/drops" className="btn-gold" style={{padding:"11px 22px",borderRadius:99,fontWeight:700,display:"inline-flex"}}>Lihat Drops →</Link>
 <Link to="/marketplace" className="btn-ghost" style={{padding:"11px 22px",display:"inline-flex"}}>Marketplace</Link>
 {!user && <button className="btn-ghost" onClick={onDemo} disabled={loading} style={{padding:"11px 22px"}}>{loading?"Memuat...":"Coba Demo Login"}</button>}
 </div>
 <div style={{display:"flex",gap:18,marginTop:22,fontSize:12,color:"var(--muted)"}}>
 <span>💳 1 C-Coin = Rp 10.000</span><span>🔐 NFC Terverifikasi</span><span>🏆 Gamifikasi</span>
 </div>
 </div>
 <div style={{flex:"0 0 300px",background:"var(--bg-card)",border:"1px solid var(--border)",borderRadius:14,padding:18}}>
 <div style={{fontSize:11,fontWeight:700,letterSpacing:"0.06em",color:"var(--dim)",textTransform:"uppercase",marginBottom:12}}>Alur MVP (9 Flow)</div>
 {[
 ["1","Primary Drop","Siapa cepat dia dapat, potong C-Coin"],
 ["2","Fulfillment","NFC provisioning + QC + dus premium"],
 ["3","Settlement","Escrow C-Coin → split 70/30"],
 ["4","NFC Tap","Tap NFC — verifikasi instan"],
 ["5","QR Fallback","iOS / non-Chrome via short_id"],
 ["6","Ownership","Transfer record on-platform"],
 ["7","Auction P2P","Bid 5% increment, anti-sniping"],
 ].map(([n,t,d])=> <div key={n} style={{display:"flex",gap:10,padding:"7px 0",borderBottom:"1px solid rgba(42,42,62,0.4)"}}>
 <span style={{width:22,height:22,borderRadius:99,background:"var(--gold-bg)",color:"var(--gold)",display:"inline-flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:800,flexShrink:0}}>{n}</span>
 <div><div style={{fontSize:12,fontWeight:700}}>{t}</div><div style={{fontSize:11,color:"var(--dim)"}}>{d}</div></div>
 </div>)}
 <div style={{display:"flex",gap:8,marginTop:12}}>
 <Link to="/verify" style={{fontSize:12,fontWeight:700,color:"var(--gold)"}}>Coba Verify →</Link>
 <span style={{color:"var(--dim)"}}>·</span>
 <Link to="/wallet" style={{fontSize:12,fontWeight:700,color:"var(--gold)"}}>Wallet C-Coin →</Link>
 </div>
 </div>
 </div>

 <div className="grid-3">
 {[
 { icon:"🎴", title:"Physical-first", desc:"Acrylic hardcase 63×88mm, dus custom premium. Koleksi yang bisa dipegang." },
 { icon:"🔐", title:"Verifiable Scarcity", desc:"NFC terverifikasi — anti-clone & deteksi tamper." },
 { icon:"⚡", title:"Fair + Free Market", desc:"Primary fixed & time-boxed. Secondary bid-offer bebas P2P." },
 { icon:"🪙", title:"C-Coin (Opsi A)", desc:"Medium tunggal semua transaksi. Buyer closed-loop, seller auto-disburse IDR." },
 { icon:"🏆", title:"Gamifikasi", desc:"Level 1-50, badge, leaderboard. XP dari spending & aktivitas." },
 { icon:"🛡️", title:"KYC & Anti-Fraud", desc:">100 C-Coin wajib KYC. Anti-sniping, anti-shill, rate-limit." },
 ].map(c=> <div key={c.title} className="card card-pad">
 <div style={{fontSize:22}}>{c.icon}</div>
 <div style={{fontWeight:700,marginTop:8,fontSize:14}}>{c.title}</div>
 <div className="muted" style={{marginTop:6}}>{c.desc}</div>
 </div>)}
 </div>

 <div className="card card-pad" style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:12}}>
 <div>
 <div style={{fontWeight:700}}>Siap lihat koleksi?</div>
 <div className="muted">Drops live sekarang + marketplace secondary.</div>
 </div>
 <div style={{display:"flex",gap:10}}>
 <Link to="/drops" className="btn-gold">Masuk Drops</Link>
 <Link to="/collection" className="btn-ghost">Koleksiku</Link>
 </div>
 </div>
 </div>;
}

import React, { useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, formatIdr } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useToast } from "../lib/toast";

export default function Checkout(){
  const { id } = useParams();
  const { user } = useAuth();
  const { push } = useToast();
  const nav = useNavigate();
  const [delivery, setDelivery] = useState<"shipping"|"vault">("vault");
  const [addr, setAddr] = useState("");
  const [fee, setFee] = useState(2);
  const [buying, setBuying] = useState(false);
  const { data, isLoading } = useQuery({ queryKey:["drop", id], queryFn:()=> api.drop(id!), enabled: !!id });
  if(isLoading) return <div className="muted">Memuat...</div>;
  if(!data) return <div className="card card-pad">Drop tidak ditemukan. <Link to="/drops" style={{color:"var(--gold)"}}>Kembali</Link></div>;
  const d:any = (data as any).title ? data as any : (data as any).drop ?? data;
  const drop = d.title ? d : d;
  const price = drop.priceCcoin ?? drop.priceCcoin ?? drop.priceUnsignedCCoin ?? 30;
  const total = price + (delivery==="shipping" ? fee : 0);
  async function onCheckout(){
    if(!user){ push("Silakan login dulu","info"); nav("/login"); return; }
    setBuying(true);
    try{
      const res = await api.checkout({ dropId: drop.id, deliveryOption: delivery, shippingAddress: delivery==="shipping"? addr : null, shippingFeeCcoin: delivery==="shipping"? fee : null } as any);
      push(`Checkout berhasil — ${total} C-Coin`, "success");
      nav("/orders/"+res.order.id);
    }catch(e:any){ push(e.message,"error"); } finally{ setBuying(false); }
  }
  return <div style={{maxWidth:720, margin:"0 auto", display:"flex", flexDirection:"column", gap:18}}>
    <Link to={"/drops/"+drop.id} style={{fontSize:13, color:"var(--muted)"}}>← Kembali</Link>
    <div className="card card-pad">
      <h2 className="h2">{drop.title}</h2>
      <p className="muted" style={{marginTop:6}}>{drop.series}</p>
      <div style={{display:"flex", gap:16, marginTop:14, flexWrap:"wrap"}}>
        <div><div style={{fontSize:11,color:"var(--dim)",fontWeight:700}}>HARGA</div><div style={{fontWeight:800}}>{price} C-Coin <span style={{fontWeight:400,color:"var(--muted)"}}>({formatIdr(price*10000)})</span></div></div>
        <div><div style={{fontSize:11,color:"var(--dim)",fontWeight:700}}>TERSEDIA</div><div style={{fontWeight:700}}>{drop.totalUnits - drop.soldCount} unit</div></div>
        <div><div style={{fontSize:11,color:"var(--dim)",fontWeight:700}}>TOTAL</div><div style={{fontWeight:800, color:"var(--gold)"}}>{total} C-Coin</div></div>
      </div>
    </div>
    <div className="card card-pad">
      <div style={{fontWeight:700, marginBottom:12}}>Pengiriman</div>
      <div style={{display:"flex", gap:12, marginBottom:14}}>
        <label style={{flex:1, display:"flex", gap:10, padding:"12px 14px", border:"1px solid "+(delivery==="vault"?"var(--gold)":"var(--border)"), borderRadius:10, cursor:"pointer"}}>
          <input type="radio" checked={delivery==="vault"} onChange={()=> setDelivery("vault")} /> <span><b>Simpan di vault</b><br/><span className="muted" style={{fontSize:12}}>Disimpan oleh platform, bisa dikirim kapan saja</span></span>
        </label>
        <label style={{flex:1, display:"flex", gap:10, padding:"12px 14px", border:"1px solid "+(delivery==="shipping"?"var(--gold)":"var(--border)"), borderRadius:10, cursor:"pointer"}}>
          <input type="radio" checked={delivery==="shipping"} onChange={()=> setDelivery("shipping")} /> <span><b>Kirim sekarang</b><br/><span className="muted" style={{fontSize:12}}>Masukkan alamat, bayar ongkir</span></span>
        </label>
      </div>
      {delivery==="shipping" && <>
        <label style={{fontSize:12, fontWeight:700, color:"var(--dim)"}}>ALAMAT</label>
        <textarea className="input" value={addr} onChange={e=> setAddr(e.target.value)} rows={3} style={{marginTop:6, marginBottom:12}} placeholder="Alamat lengkap" />
        <label style={{fontSize:12, fontWeight:700, color:"var(--dim)"}}>ONGKIR (C-Coin)</label>
        <input className="input" type="number" min={1} value={fee} onChange={e=> setFee(Math.max(1, Number(e.target.value)||1))} style={{marginTop:6, maxWidth:160}} />
      </>}
      <button className="btn-gold" onClick={onCheckout} disabled={buying} style={{marginTop:16, width:"100%"}}>{buying?"Memproses...":`Bayar ${total} C-Coin`}</button>
    </div>
  </div>;
}

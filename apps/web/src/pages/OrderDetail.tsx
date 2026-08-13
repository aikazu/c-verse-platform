import React from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useToast } from "../lib/toast";

export default function OrderDetail(){
  const { id } = useParams();
  const { push } = useToast();
  const { data, isLoading, refetch } = useQuery({ queryKey:["order", id], queryFn:()=> api.order(id!), enabled: !!id });
  if(isLoading) return <div className="muted">Memuat...</div>;
  if(!data) return <div className="card card-pad">Order tidak ditemukan.</div>;
  const o:any = (data as any).order ?? data;
  const drop:any = (data as any).drop;
  const cards:any[] = (data as any).cards ?? [];
  const shipments:any[] = (data as any).shipments ?? [];
  const isVault = o.deliveryOption==="vault" || (!o.shippingAddress && o.deliveryOption!=="shipping");
  async function onConfirm(){
    try{ await api.confirmDelivered(o.id); push("Terima kasih — order delivered!","success"); refetch(); }catch(e:any){ push(e.message,"error"); }
  }
  return <div style={{display:"flex", flexDirection:"column", gap:18}}>
    <Link to="/orders" style={{fontSize:13, color:"var(--muted)"}}>← Orders</Link>
    <div className="card card-pad">
      <div style={{display:"flex", justifyContent:"space-between", alignItems:"center"}}>
        <div><span className="eyebrow">Order {o.id}</span><h2 className="h2" style={{marginTop:6}}>{drop?.title ?? o.dropId} — {o.totalCCoin} C-Coin</h2></div>
        <span className={"pill "+(o.status==="delivered"?"pill-success":o.status==="shipped"?"pill-info":"pill-warn")} style={{height:"fit-content"}}>{o.status}</span>
      </div>
      <div style={{display:"flex", gap:16, marginTop:12, flexWrap:"wrap", fontSize:13}}>
        <div><span className="muted">Opsi</span><br/><b>{isVault ? "Vault (simpan di inventory)" : "Kirim fisik"}</b></div>
        {!isVault && <div><span className="muted">Ongkir</span><br/>{o.shippingFeeCcoin ?? "-"} C-Coin</div>}
        <div><span className="muted">Escrow</span><br/>{o.escrowStatus ?? "held"}</div>
        {!isVault && o.trackingNumber && <div><span className="muted">Resi</span><br/><b>{o.trackingNumber}</b></div>}
      </div>
      {!isVault ? <div style={{marginTop:12}}>
        <div style={{fontWeight:700, fontSize:12, marginBottom:6}}>Timeline</div>
        <div style={{display:"flex", gap:8, fontSize:12}}>
          {["paid","qc","shipped","delivered","settled"].map(s=> <span key={s} className={"pill "+(o.status===s?"pill-success":"")}>{s}</span>)}
        </div>
        {o.shippingAddress && <div className="muted" style={{fontSize:12, marginTop:8}}>Alamat: {o.shippingAddress}</div>}
        {o.status==="shipped" && <button className="btn-gold" onClick={onConfirm} style={{marginTop:12}}>Konfirmasi Diterima</button>}
      </div> : <div className="muted" style={{fontSize:12, marginTop:12}}>Vault order — tanpa tracking/alamat (PAID → QC → SETTLED). Kartu di vault: buka <Link to="/me/manage" style={{color:"var(--gold)"}}>Kelola Kartu → Kirim dari vault</Link> kapan saja (ongkir C-Coin).</div>}
      {cards.length>0 && <div style={{marginTop:16}}>
        <div style={{fontWeight:700, fontSize:12, marginBottom:8}}>Kartu</div>
        <div style={{display:"flex", gap:8, flexWrap:"wrap"}}>
          {cards.map((c:any)=> <Link key={c.id} to={"/cards/"+c.id} className="pill pill-info" style={{textDecoration:"none"}}>{c.nfcShortId} · #{c.unitNumber}</Link>)}
        </div>
      </div>}
      {shipments.length>0 && <div style={{marginTop:16}}>
        <div style={{fontWeight:700, fontSize:12, marginBottom:8}}>Shipments</div>
        <div style={{display:"flex", flexDirection:"column", gap:6}}>
          {shipments.map((s:any)=> <div key={s.id} style={{display:"flex", justifyContent:"space-between", fontSize:12}}><span>{s.type} → {s.toDest} · {s.status}</span><span className="muted">{s.trackingNumber ?? "-"}</span></div>)}
        </div>
      </div>}
    </div>
  </div>;
}

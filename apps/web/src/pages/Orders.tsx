import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";

export default function Orders(){
  const { user } = useAuth();
  const { data, isLoading } = useQuery({ queryKey:["orders"], queryFn:()=> api.orders(), enabled: !!user });
  if(!user) return <div className="card card-pad">Login untuk melihat orders.</div>;
  if(isLoading) return <div className="muted">Memuat orders...</div>;
  const orders:any[] = (data as any)?.orders ?? [];
  return <div style={{display:"flex", flexDirection:"column", gap:18}}>
    <div style={{display:"flex", justifyContent:"space-between", alignItems:"center"}}>
      <div><span className="eyebrow">Orders — Primary</span><h1 className="h2">Daftar Order</h1><p className="muted" style={{fontSize:12}}>Label kirim fisik vs inventory (vault) · tracking hanya untuk shipping</p></div>
      <Link to="/drops" className="btn-ghost">Drops →</Link>
    </div>
    <div className="card">
      <div className="table-wrap">
        <table>
          <thead><tr><th>Order</th><th>Drop</th><th>Total C-Coin</th><th>Status</th><th>Opsi</th></tr></thead>
          <tbody>
            {orders.length===0 ? <tr><td colSpan={5} style={{textAlign:"center", padding:16, color:"var(--muted)"}}>Belum ada order.</td></tr> :
              orders.map((o:any)=> <tr key={o.id}>
                <td><Link to={"/orders/"+o.id} style={{color:"var(--gold)", fontSize:12, fontFamily:"monospace"}}>{o.id}</Link></td>
                <td style={{fontSize:12}}>{o.dropId}</td>
                <td style={{fontWeight:700}}>{o.totalCCoin} C</td>
                <td><span className={"pill "+(o.status==="delivered"?"pill-success":o.status==="shipped"?"pill-info":"pill-warn")}>{o.status}</span></td>
                <td style={{fontSize:12}}>{o.deliveryOption ?? (o.shippingAddress? "shipping":"vault")}</td>
              </tr>)}
          </tbody>
        </table>
      </div>
    </div>
  </div>;
}

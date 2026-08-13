import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api, formatIdr } from "../lib/api";

function Badge({status}:{status:string}){
  const map:Record<string,string> = { live:"badge-live", scheduled:"badge-scheduled", ended:"badge-ended", draft:"badge-ended", published:"badge-live", sold_out:"badge-ended", closed:"badge-ended" };
  const label:Record<string,string> = { live:"Live", scheduled:"Segera", ended:"Ended", draft:"Draft", published:"Live", sold_out:"Habis", closed:"Closed" };
  return <span className={`drop-badge ${map[status]||"badge-ended"}`}>{label[status]||status}</span>;
}

export default function Drops(){
  const [filter,setFilter]=useState("all");
  const [search,setSearch]=useState("");
  const { data, isLoading, refetch } = useQuery({
    queryKey:["drops",filter,search],
    queryFn:()=> api.drops({ ...(filter!=="all"?{status:filter}:{}), ...(search?{search}:{}) }),
  });
  return <div style={{display:"flex",flexDirection:"column",gap:18}}>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-end",flexWrap:"wrap",gap:12}}>
      <div>
        <h1 className="h2">Drops</h1>
        <p className="muted" style={{marginTop:6}}>Koleksi terbatas dari kreator pilihan</p>
      </div>
      <div style={{display:"flex",gap:8,alignItems:"center"}}>
        <input className="input" placeholder="Cari..." value={search} onChange={e=> setSearch(e.target.value)} style={{width:200}}/>
        <select className="select" value={filter} onChange={e=> setFilter(e.target.value)} style={{width:150}}>
          <option value="all">Semua</option><option value="live">Live</option><option value="scheduled">Segera</option><option value="ended">Ended</option>
        </select>
        <button className="btn-ghost" onClick={()=> refetch()}>Refresh</button>
      </div>
    </div>

    {isLoading ? <div className="muted">Memuat...</div> : !data?.drops.length ? <div className="card card-pad muted">Belum ada drop</div> :
    <div className="grid-3">
      {data.drops.map((d:any)=> <Link key={d.id} to={`/drops/${d.id}`} className="card drop-card">
        <div className="drop-thumb">
          <Badge status={d.status}/>
          <span style={{fontSize:42}}>🎴</span>
        </div>
        <div className="card-pad">
          <div style={{fontSize:11,fontWeight:700,letterSpacing:"0.06em",color:"var(--gold)",textTransform:"uppercase"}}>{d.series}</div>
          <div style={{fontWeight:700,marginTop:4}}>{d.title}</div>
          <div className="muted" style={{fontSize:12,marginTop:6,display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical",overflow:"hidden"}}>{d.narrative}</div>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:12}}>
            <div>
              <div style={{fontSize:11,color:"var(--dim)",fontWeight:700}}>HARGA</div>
              <div style={{fontWeight:800}}>{d.priceCcoin ?? d.priceUnsignedCCoin} C <span style={{fontSize:11,color:"var(--muted)",fontWeight:400}}>({formatIdr(d.idrPrice ?? d.idrUnsigned)})</span></div>
            </div>
            <div style={{textAlign:"right"}}>
              <div style={{fontSize:11,color:"var(--dim)",fontWeight:700}}>TERJUAL</div>
              <div style={{fontWeight:700}}>{d.soldCount}/{d.totalUnits}</div>
              <div className="progress" style={{width:70,marginTop:4}}><div className="progress-fill" style={{width:`${Math.round(d.soldCount/d.totalUnits*100)}%`}}/></div>
            </div>
          </div>
          <div style={{fontSize:11,color:"var(--dim)",marginTop:10}}>oleh {d.creatorName}</div>
        </div>
      </Link>)}
    </div>}
  </div>;
}

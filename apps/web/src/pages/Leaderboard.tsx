import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../lib/api";

export default function Leaderboard(){
  const { data, isLoading } = useQuery({ queryKey:["leaderboard"], queryFn:()=> api.leaderboard(20) });
  const { data: badgesData } = useQuery({ queryKey:["badges"], queryFn:()=> api.badges() });
  if(isLoading) return <div className="muted">Memuat...</div>;
  const board:any[] = (data as any)?.leaderboard ?? [];
  const badges:any[] = (badgesData as any)?.badges ?? [];
  const tierColor:Record<string,string> = { bronze:"#cd7f32", silver:"#94a3b8", gold:"#d4a843", platinum:"#7dd3fc", diamond:"#a5b4fc" };
  return <div style={{display:"flex",flexDirection:"column",gap:18}}>
    <div>
      <h1 className="h2">Peringkat</h1>
      <p className="muted" style={{fontSize:12, marginTop:6}}>Peringkat berdasarkan aktivitas koleksi</p>
    </div>
    <div className="card">
      <div className="table-wrap">
        <table>
          <thead><tr><th>#</th><th>Kolektor</th><th>Tier</th><th>Level</th><th>Kartu</th></tr></thead>
          <tbody>
            {board.map((e:any)=> {
              const href = e.username ? `/u/${e.username}` : `/u/${e.userId}`;
              return (
                <tr key={e.userId} style={e.rank<=3?{background:"rgba(212,168,67,0.06)"}:{}}>
                  <td style={{fontWeight:800}}>{e.rank===1?"🥇": e.rank===2?"🥈": e.rank===3?"🥉": e.rank}</td>
                  <td>
                    <Link to={href} style={{fontWeight:700, color:"var(--gold)", textDecoration:"none"}}>
                      {e.displayName}
                    </Link>
                    <span style={{fontSize:11,color:"var(--dim)",fontFamily:"monospace"}}> · {e.username ? "@"+e.username : e.userId}</span>
                    <div style={{fontSize:11, color:"var(--muted)", marginTop:2}}>
                      <Link to={href} style={{color:"var(--muted)", textDecoration:"underline"}}>Lihat profil →</Link>
                    </div>
                  </td>
                  <td><span className="pill" style={{background: tierColor[e.tier]||"var(--bg-elevated)", color: e.tier==="bronze"||e.tier==="silver"?"#fff":"#111"}}>{e.tier}</span></td>
                  <td style={{fontWeight:800}}>Lv {e.level}</td>
                  <td>{e.totalCards}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

    </div>
    <div className="card card-pad">
      <div style={{fontWeight:700,marginBottom:10}}>Lencana</div>
      <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
        {badges.map((b:any)=> <span key={b.id} className="pill pill-warn" title={b.description + " · criteria: " + JSON.stringify(b.criteria ?? {})} style={{padding:"8px 12px"}}>{b.icon ?? b.icon_url} {b.name} — {b.description}</span>)}
      </div>

    </div>
  </div>;
}

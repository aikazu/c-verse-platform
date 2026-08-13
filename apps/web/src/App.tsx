import React from "react";
import { BrowserRouter, Routes, Route, NavLink, useNavigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider, useAuth } from "./lib/auth";
import { ToastProvider } from "./lib/toast";
import Landing from "./pages/Landing";
import Drops from "./pages/Drops";
import DropDetail from "./pages/DropDetail";
import Checkout from "./pages/Checkout";
import Wallet from "./pages/Wallet";
import CardInfo from "./pages/CardInfo";
import Card3D from "./pages/Card3D";
import Marketplace from "./pages/Marketplace";
import Browse from "./pages/Browse";
import ListingDetail from "./pages/ListingDetail";
import Collection from "./pages/Collection";
import ManageCards from "./pages/ManageCards";
import Leaderboard from "./pages/Leaderboard";
import Login from "./pages/Login";
import Register from "./pages/Register";
import CreatorDashboard from "./pages/CreatorDashboard";
import CreatorPage from "./pages/CreatorPage";
import PublicProfile from "./pages/PublicProfile";
import Home from "./pages/Home";
import Orders from "./pages/Orders";
import OrderDetail from "./pages/OrderDetail";
import Privacy from "./pages/Privacy";
import Kyc from "./pages/Kyc";
import Notifications from "./pages/Notifications";
import Admin from "./pages/Admin";
import "./styles.css";

const qc = new QueryClient();

function UserMenu(){
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(()=>{
    function onDoc(e: MouseEvent){
      if(ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("click", onDoc);
    return ()=> document.removeEventListener("click", onDoc);
  }, []);
  if(!user) return null;
  const initial = ((user as any).displayName || (user as any).username || user.email || "U").slice(0,1).toUpperCase();
  const isCreator = user.role === "creator" || user.role === "admin";
  const isAdmin = user.role === "admin";
  return (
    <div ref={ref} style={{position:"relative"}}>
      <button onClick={()=> setOpen(v=>!v)} aria-expanded={open} aria-haspopup="menu" style={{display:"flex", alignItems:"center", gap:10, background:"transparent", border:"1px solid var(--border)", borderRadius:99, padding:"6px 10px 6px 6px", color:"var(--text)"}}>
        <span style={{width:28, height:28, borderRadius:99, background:"var(--gold)", color:"#111", display:"inline-flex", alignItems:"center", justifyContent:"center", fontWeight:800, fontSize:13}}>{initial}</span>
        <span style={{fontSize:13, fontWeight:600, maxWidth:140, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap"}}>{(user as any).displayName ?? (user as any).username ?? user.email}</span>
        <span style={{fontSize:11, color:"var(--muted)"}}>{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div role="menu" style={{position:"absolute", right:0, top:"calc(100% + 10px)", minWidth:220, background:"var(--bg-card)", border:"1px solid var(--border)", borderRadius:14, overflow:"hidden", boxShadow:"0 16px 40px rgba(0,0,0,0.5)", zIndex:50}}>
          <div style={{padding:"12px 14px", borderBottom:"1px solid var(--border)"}}>
            <div style={{fontWeight:700, fontSize:13}}>{(user as any).displayName ?? user.email}</div>
            <div style={{fontSize:11, color:"var(--muted)"}}>{user.email} · {user.role === "user" ? "kolektor" : user.role}</div>
          </div>
          <div style={{padding:6, display:"flex", flexDirection:"column", gap:2}}>
            <MenuLink to="/home" label="Home" hint="Drop trending & saldo" onClick={()=> setOpen(false)} />
            <MenuLink to="/orders" label="Pesanan" hint="Order & shipping" onClick={()=> setOpen(false)} />
            <MenuLink to="/collection" label="Koleksi" hint="/me & ownership" onClick={()=> setOpen(false)} />
            <MenuLink to="/me/manage" label="Kelola kartu" hint="Sell / buyout / bid" onClick={()=> setOpen(false)} />
            <MenuLink to="/wallet" label="Dompet" hint="C-Coin" onClick={()=> setOpen(false)} />
            <MenuLink to="/notifications" label="Notifikasi" onClick={()=> setOpen(false)} />
            <MenuLink to="/me/kyc" label="KYC" onClick={()=> setOpen(false)} />
            <MenuLink to="/me/privacy" label="Privacy" onClick={()=> setOpen(false)} />
            {isCreator && <MenuLink to="/creator" label="Creator" hint="Traffic & pendapatan" onClick={()=> setOpen(false)} />}
            {isAdmin && <MenuLink to="/admin" label="Admin (placeholder)" hint="→ apps/admin terpisah" onClick={()=> setOpen(false)} />}
          </div>
          <div style={{padding:8, borderTop:"1px solid var(--border)"}}>
            <button onClick={async()=>{ await logout(); setOpen(false); nav("/"); }} style={{width:"100%", background:"transparent", border:"1px solid var(--border)", borderRadius:10, padding:"9px 12px", color:"var(--text)", fontWeight:600, fontSize:13}}>Keluar</button>
          </div>
        </div>
      )}
    </div>
  );
}
function MenuLink({to,label,hint,onClick}:{to:string;label:string;hint?:string;onClick?:()=>void}){
  return (
    <NavLink to={to} onClick={onClick} style={({isActive})=> ({display:"block", padding:"9px 10px", borderRadius:10, background: isActive? "var(--bg-elevated)" : "transparent", border:"1px solid transparent"})}>
      <div style={{fontSize:13, fontWeight:600}}>{label}</div>
      {hint && <div style={{fontSize:11, color:"var(--muted)"}}>{hint}</div>}
    </NavLink>
  );
}

function Navbar(){
  const { user } = useAuth();
  const nav = useNavigate();
  return (
    <nav className="navbar">
      <NavLink to="/" className="nav-brand">C<span>.</span>Verse</NavLink>
      <div className="nav-links" style={{gap:18}}>
        <NavLink to="/drops" className={({isActive})=> isActive?"active":""}>Drops</NavLink>
        <NavLink to="/marketplace" className={({isActive})=> isActive?"active":""}>Marketplace</NavLink>
        <NavLink to="/browse" className={({isActive})=> isActive?"active":""}>Browse</NavLink>
        <NavLink to="/leaderboard" className={({isActive})=> isActive?"active":""}>Leaderboard</NavLink>
      </div>
      <div className="nav-actions">
        {!user ? (
          <>
            <button className="btn-ghost" onClick={()=> nav("/login")}>Masuk</button>
            <button className="btn-gold" onClick={()=> nav("/register")}>Daftar</button>
          </>
        ) : <UserMenu />}
      </div>
    </nav>
  );
}

function AppRoutes(){
  return <div className="app-shell">
    <Navbar/>
    <main className="main-content">
      <Routes>
        <Route path="/" element={<Landing/>}/>
        <Route path="/drops" element={<Drops/>}/>
        <Route path="/drops/:id" element={<DropDetail/>}/>
        <Route path="/drops/:id/checkout" element={<Checkout/>}/>
        <Route path="/home" element={<Home/>}/>
        <Route path="/wallet" element={<Wallet/>}/>
        <Route path="/orders" element={<Orders/>}/>
        <Route path="/orders/:id" element={<OrderDetail/>}/>
        <Route path="/cards/:cardId" element={<CardInfo/>}/>
        <Route path="/cards/:cardId/3d" element={<Card3D/>}/>
        <Route path="/marketplace" element={<Marketplace/>}/>
        <Route path="/marketplace/:id" element={<ListingDetail/>}/>
        <Route path="/browse" element={<Browse/>}/>
        <Route path="/collection" element={<Collection/>}/>
        <Route path="/me" element={<Collection/>}/>
        <Route path="/me/manage" element={<ManageCards/>}/>
        <Route path="/me/privacy" element={<Privacy/>}/>
        <Route path="/me/kyc" element={<Kyc/>}/>
        <Route path="/notifications" element={<Notifications/>}/>
        <Route path="/leaderboard" element={<Leaderboard/>}/>
        <Route path="/c/:username" element={<CreatorPage/>}/>
        <Route path="/u/:username" element={<PublicProfile/>}/>
        <Route path="/login" element={<Login/>}/>
        <Route path="/register" element={<Register/>}/>
        <Route path="/creator" element={<CreatorDashboard/>}/>
        <Route path="/creator/drops" element={<CreatorDashboard/>}/>
        <Route path="/admin" element={<Admin/>}/>
        {/* legacy /verify deep-links: redirect to browse (no standalone verify page per docs 02 §4) */}
        <Route path="/verify" element={<Browse/>}/>
        <Route path="/verify/:shortId" element={<CardInfo/>}/>
      </Routes>
    </main>
    <footer style={{textAlign:"center",padding:"18px 24px",fontSize:12,color:"var(--dim)",borderTop:"1px solid var(--border)", marginTop:40}}>
      C.Verse — Koleksi Kreator Edisi Terbatas
    </footer>
  </div>;
}

export default function App(){
  return <QueryClientProvider client={qc}>
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <AppRoutes/>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  </QueryClientProvider>;
}

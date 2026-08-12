import React from "react";
import { BrowserRouter, Routes, Route, NavLink, useNavigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider, useAuth } from "./lib/auth";
import { ToastProvider } from "./lib/toast";
import Landing from "./pages/Landing";
import Drops from "./pages/Drops";
import DropDetail from "./pages/DropDetail";
import Wallet from "./pages/Wallet";
import Verify from "./pages/Verify";
import Marketplace from "./pages/Marketplace";
import ListingDetail from "./pages/ListingDetail";
import Collection from "./pages/Collection";
import Leaderboard from "./pages/Leaderboard";
import Login from "./pages/Login";
import Register from "./pages/Register";
import CreatorDashboard from "./pages/CreatorDashboard";
import Admin from "./pages/Admin";
import "./styles.css";

const qc = new QueryClient();

function Navbar(){
  const { user, logout } = useAuth();
  const nav = useNavigate();
  return <nav className="navbar">
    <NavLink to="/" className="nav-brand">C<span>.</span>Verse</NavLink>
    <div className="nav-links">
      <NavLink to="/drops" className={({isActive})=> isActive?"active":""}>Drops</NavLink>
      <NavLink to="/marketplace" className={({isActive})=> isActive?"active":""}>Marketplace</NavLink>
      <NavLink to="/verify" className={({isActive})=> isActive?"active":""}>Verify</NavLink>
      <NavLink to="/leaderboard" className={({isActive})=> isActive?"active":""}>Leaderboard</NavLink>
      {user && <NavLink to="/collection" className={({isActive})=> isActive?"active":""}>Koleksi</NavLink>}
      {user && <NavLink to="/wallet" className={({isActive})=> isActive?"active":""}>Wallet</NavLink>}
      {(user?.role==="creator"||user?.role==="admin") && <NavLink to="/creator" className={({isActive})=> isActive?"active":""}>Creator</NavLink>}
      {user?.role==="admin" && <NavLink to="/admin" className={({isActive})=> isActive?"active":""}>Admin</NavLink>}
    </div>
    <div className="nav-actions">
      {!user ? <>
        <button className="btn-ghost" onClick={()=> nav("/login")}>Masuk</button>
        <button className="btn-gold" onClick={()=> nav("/register")}>Daftar</button>
      </> : <>
        <span style={{fontSize:12,color:"var(--muted)"}}>{user.displayName} · {user.role}</span>
        <button className="btn-ghost" onClick={async()=>{ await logout(); nav("/"); }}>Keluar</button>
      </>}
    </div>
  </nav>;
}

function AppRoutes(){
  return <div className="app-shell">
    <Navbar/>
    <main className="main-content">
      <Routes>
        <Route path="/" element={<Landing/>}/>
        <Route path="/drops" element={<Drops/>}/>
        <Route path="/drops/:id" element={<DropDetail/>}/>
        <Route path="/wallet" element={<Wallet/>}/>
        <Route path="/verify" element={<Verify/>}/>
        <Route path="/verify/:shortId" element={<Verify/>}/>
        <Route path="/marketplace" element={<Marketplace/>}/>
        <Route path="/marketplace/:id" element={<ListingDetail/>}/>
        <Route path="/collection" element={<Collection/>}/>
        <Route path="/leaderboard" element={<Leaderboard/>}/>
        <Route path="/login" element={<Login/>}/>
        <Route path="/register" element={<Register/>}/>
        <Route path="/creator" element={<CreatorDashboard/>}/>
        <Route path="/admin" element={<Admin/>}/>
      </Routes>
    </main>
    <footer style={{textAlign:"center",padding:"18px 24px",fontSize:12,color:"var(--dim)",borderTop:"1px solid var(--border)", marginTop:40}}>
      C.Verse — Revolusi Ekonomi Kreator · C.Card MVP · 1 C-Coin = Rp 10.000 · NTAG 424 DNA TagTamper
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

import React from "react";
import { BrowserRouter, Routes, Route, NavLink, useNavigate, useParams } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider, useAuth } from "./lib/auth";
import { ToastProvider } from "./lib/toast";
import Landing from "./pages/Landing";
import Drops from "./pages/Drops";
import DropDetail from "./pages/DropDetail";
import Checkout from "./pages/Checkout";
import Wallet from "./pages/Wallet";
import Verify from "./pages/Verify";
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

function Navbar(){
  const { user, logout } = useAuth();
  const nav = useNavigate();
  // role "user" is collector; keep label Kolektor for display (backwards compat with old "collector")
  const roleLabel = (user?.role as string) === "user" ? "kolektor" : user?.role;
  return <nav className="navbar">
    <NavLink to="/" className="nav-brand">C<span>.</span>Verse</NavLink>
    <div className="nav-links">
      <NavLink to="/drops" className={({isActive})=> isActive?"active":""}>Drops</NavLink>
      <NavLink to="/marketplace" className={({isActive})=> isActive?"active":""}>Marketplace</NavLink>
      <NavLink to="/browse" className={({isActive})=> isActive?"active":""}>Browse</NavLink>
      <NavLink to="/verify" className={({isActive})=> isActive?"active":""}>Verify</NavLink>
      <NavLink to="/leaderboard" className={({isActive})=> isActive?"active":""}>Leaderboard</NavLink>
      {user && <NavLink to="/home" className={({isActive})=> isActive?"active":""}>Home</NavLink>}
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
        <span style={{fontSize:12,color:"var(--muted)"}}>{user.displayName} · {roleLabel}</span>
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
        <Route path="/drops/:id/checkout" element={<Checkout/>}/>
        <Route path="/home" element={<Home/>}/>
        <Route path="/wallet" element={<Wallet/>}/>
        <Route path="/orders" element={<Orders/>}/>
        <Route path="/orders/:id" element={<OrderDetail/>}/>
        <Route path="/verify" element={<Verify/>}/>
        <Route path="/verify/:shortId" element={<Verify/>}/>
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
      </Routes>
    </main>
    <footer style={{textAlign:"center",padding:"18px 24px",fontSize:12,color:"var(--dim)",borderTop:"1px solid var(--border)", marginTop:40}}>
      C.Verse — Revolusi Ekonomi Kreator · C.Card MVP · 1 C-Coin = Rp 10.000 · NFC Terverifikasi
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

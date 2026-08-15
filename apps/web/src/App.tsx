import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { lazy, Suspense } from "react";
import { BrowserRouter, NavLink, Route, Routes, useNavigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./lib/auth";
import { ToastProvider } from "./lib/toast";
import "./styles.css";

// Code-splitting: tiap halaman jadi chunk terpisah — visitor landing tidak
// mengunduh kode marketplace/wallet/creator dashboard (audit performance P0).
const Browse = lazy(() => import("./pages/Browse"));
const Card3D = lazy(() => import("./pages/Card3D"));
const CardInfo = lazy(() => import("./pages/CardInfo"));
const Checkout = lazy(() => import("./pages/Checkout"));
const Collection = lazy(() => import("./pages/Collection"));
const CreatorDashboard = lazy(() => import("./pages/CreatorDashboard"));
const CreatorPage = lazy(() => import("./pages/CreatorPage"));
const DropDetail = lazy(() => import("./pages/DropDetail"));
const Drops = lazy(() => import("./pages/Drops"));
const Home = lazy(() => import("./pages/Home"));
const Kyc = lazy(() => import("./pages/Kyc"));
const Landing = lazy(() => import("./pages/Landing"));
const Leaderboard = lazy(() => import("./pages/Leaderboard"));
const ListingDetail = lazy(() => import("./pages/ListingDetail"));
const Login = lazy(() => import("./pages/Login"));
const ManageCards = lazy(() => import("./pages/ManageCards"));
const Marketplace = lazy(() => import("./pages/Marketplace"));
const Notifications = lazy(() => import("./pages/Notifications"));
const OrderDetail = lazy(() => import("./pages/OrderDetail"));
const Orders = lazy(() => import("./pages/Orders"));
const Privacy = lazy(() => import("./pages/Privacy"));
const PublicProfile = lazy(() => import("./pages/PublicProfile"));
const Register = lazy(() => import("./pages/Register"));
const Wallet = lazy(() => import("./pages/Wallet"));

const qc = new QueryClient();

function UserMenu() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("click", onDoc);
    return () => document.removeEventListener("click", onDoc);
  }, []);
  if (!user) return null;
  const initial = ((user as any).displayName || (user as any).username || user.email || "U").slice(0, 1).toUpperCase();
  const isCreator = user.role === "creator" || user.role === "admin";
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          background: "var(--surface-2)",
          border: "1px solid var(--border)",
          borderRadius: 99,
          padding: "5px 10px 5px 5px",
          color: "var(--text)",
          transition: "border-color var(--motion-fast)",
        }}
      >
        <span
          style={{
            width: 28,
            height: 28,
            borderRadius: 99,
            background: "var(--gold)",
            color: "#0A0A0A",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            fontWeight: 800,
            fontSize: 12,
            fontFamily: "var(--font-mono)",
          }}
        >
          {initial}
        </span>
        <span style={{ fontSize: 13, fontWeight: 500, maxWidth: 130, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {(user as any).displayName ?? (user as any).username ?? user.email}
        </span>
        <span style={{ fontSize: 10, color: "var(--text-dim)" }}>{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div
          role="menu"
          style={{
            position: "absolute",
            right: 0,
            top: "calc(100% + 10px)",
            minWidth: 228,
            background: "var(--surface-1)",
            border: "1px solid var(--border)",
            borderRadius: 12,
            overflow: "hidden",
            boxShadow: "0 16px 40px rgba(0,0,0,0.6)",
            zIndex: 50,
          }}
        >
          <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--border)", background: "var(--surface-2)" }}>
            <div style={{ fontWeight: 700, fontSize: 13, fontFamily: "var(--font-display)" }}>
              {(user as any).displayName ?? user.email}
            </div>
            <div style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>{user.email}</div>
            <span
              className="pill"
              style={{
                marginTop: 8,
                background: "rgba(201,163,82,0.12)",
                color: "var(--gold)",
                border: "1px solid rgba(201,163,82,0.2)",
                fontSize: 10,
              }}
            >
              {user.role === "user" ? "kolektor" : user.role}
            </span>
          </div>
          <div style={{ padding: "6px", display: "flex", flexDirection: "column", gap: 1 }}>
            <MenuLink to="/home" label="Home" onClick={() => setOpen(false)} />
            <MenuLink to="/orders" label="Pesanan" onClick={() => setOpen(false)} />
            <MenuLink to="/collection" label="Koleksi" onClick={() => setOpen(false)} />
            <MenuLink to="/me/manage" label="Kelola kartu" onClick={() => setOpen(false)} />
            <MenuLink to="/wallet" label="Dompet" onClick={() => setOpen(false)} />
            <MenuLink to="/notifications" label="Notifikasi" onClick={() => setOpen(false)} />
            <div style={{ height: 1, background: "var(--border)", margin: "4px 8px" }} />
            <MenuLink to="/me/kyc" label="Verifikasi" onClick={() => setOpen(false)} />
            <MenuLink to="/me/privacy" label="Privasi" onClick={() => setOpen(false)} />
            {isCreator && <MenuLink to="/creator" label="Dashboard Kreator" onClick={() => setOpen(false)} />}
          </div>
          <div style={{ padding: "8px", borderTop: "1px solid var(--border)" }}>
            <button
              onClick={async () => {
                await logout();
                setOpen(false);
                nav("/");
              }}
              style={{
                width: "100%",
                background: "transparent",
                border: "1px solid var(--border)",
                borderRadius: 8,
                padding: "9px 12px",
                color: "var(--text)",
                fontWeight: 600,
                fontSize: 13,
                transition: "border-color var(--motion-fast)",
              }}
            >
              Keluar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
function MenuLink({ to, label, onClick }: { to: string; label: string; onClick?: () => void }) {
  return (
    <NavLink
      to={to}
      onClick={onClick}
      style={({ isActive }) => ({
        display: "block",
        padding: "8px 12px",
        borderRadius: 8,
        background: isActive ? "var(--surface-2)" : "transparent",
        color: isActive ? "var(--gold)" : "var(--text)",
        fontSize: 13,
        fontWeight: isActive ? 600 : 400,
      })}
    >
      {label}
    </NavLink>
  );
}

function Navbar() {
  const { user } = useAuth();
  const nav = useNavigate();
  return (
    <nav className="navbar">
      <NavLink to="/" className="nav-brand">
        C<span>.</span>Verse
      </NavLink>
      <div className="nav-links" style={{ gap: 18 }}>
        <NavLink to="/drops" className={({ isActive }) => (isActive ? "active" : "")}>
          Drops
        </NavLink>
        <NavLink to="/marketplace" className={({ isActive }) => (isActive ? "active" : "")}>
          Marketplace
        </NavLink>
        <NavLink to="/browse" className={({ isActive }) => (isActive ? "active" : "")}>
          Browse
        </NavLink>
        <NavLink to="/leaderboard" className={({ isActive }) => (isActive ? "active" : "")}>
          Peringkat
        </NavLink>
      </div>
      <div className="nav-actions">
        {!user ? (
          <>
            <button className="btn-ghost" onClick={() => nav("/login")}>
              Masuk
            </button>
            <button className="btn-gold" onClick={() => nav("/register")}>
              Daftar
            </button>
          </>
        ) : (
          <UserMenu />
        )}
      </div>
    </nav>
  );
}

function AppRoutes() {
  return (
    <div className="app-shell">
      <Navbar />
      <main className="main-content">
        <Suspense
          fallback={
            <div className="muted" style={{ padding: 32, textAlign: "center" }}>
              Memuat…
            </div>
          }
        >
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/drops" element={<Drops />} />
            <Route path="/drops/:id" element={<DropDetail />} />
            <Route path="/drops/:id/checkout" element={<Checkout />} />
            <Route path="/home" element={<Home />} />
            <Route path="/wallet" element={<Wallet />} />
            <Route path="/orders" element={<Orders />} />
            <Route path="/orders/:id" element={<OrderDetail />} />
            <Route path="/cards/:cardId" element={<CardInfo />} />
            <Route path="/cards/:cardId/3d" element={<Card3D />} />
            <Route path="/marketplace" element={<Marketplace />} />
            <Route path="/marketplace/:id" element={<ListingDetail />} />
            <Route path="/browse" element={<Browse />} />
            <Route path="/collection" element={<Collection />} />
            <Route path="/me" element={<Collection />} />
            <Route path="/me/manage" element={<ManageCards />} />
            <Route path="/me/privacy" element={<Privacy />} />
            <Route path="/me/kyc" element={<Kyc />} />
            <Route path="/notifications" element={<Notifications />} />
            <Route path="/leaderboard" element={<Leaderboard />} />
            <Route path="/c/:username" element={<CreatorPage />} />
            <Route path="/u/:username" element={<PublicProfile />} />
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/creator" element={<CreatorDashboard />} />
            <Route path="/creator/drops" element={<CreatorDashboard />} />
            {/* Compat: legacy /verify — Verify melekat di /cards/:id (QR→Registered) & /cards/:id/3d (NFC→Verified) per docs/02 */}
            <Route path="/verify" element={<Browse />} />
            <Route path="/verify/:shortId" element={<CardInfo />} />
          </Routes>
        </Suspense>
      </main>
      <footer
        style={{
          textAlign: "center",
          padding: "22px 24px",
          fontSize: 11,
          color: "var(--text-dim)",
          borderTop: "1px solid var(--border)",
          marginTop: 48,
          fontFamily: "var(--font-mono)",
          letterSpacing: "0.06em",
          textTransform: "uppercase",
        }}
      >
        C.Verse — Koleksi Kreator Edisi Terbatas ·{" "}
        <a href="/sitemap.xml" style={{ color: "var(--text-dim)", textDecoration: "none" }}>
          Sitemap
        </a>{" "}
        · c-verse.co
      </footer>
    </div>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <AuthProvider>
          <ToastProvider>
            <AppRoutes />
          </ToastProvider>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

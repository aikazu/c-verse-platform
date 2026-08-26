import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { lazy, Suspense, useState } from "react";
import { BrowserRouter, Navigate, NavLink, Route, Routes, useNavigate, useParams } from "react-router-dom";
import { api } from "./lib/api";
import { AuthProvider, useAuth } from "./lib/auth";
import { ErrorBoundary } from "./lib/ErrorBoundary";
import { ToastProvider } from "./lib/toast";
import { NotFoundPage } from "./pages/ErrorPage";
import UsernameSetupModal from "./pages/UsernameSetupModal";
import "./styles.css";

// Code-splitting: tiap halaman jadi chunk terpisah — visitor landing tidak
// mengunduh kode marketplace/wallet/creator dashboard (audit performance P0).
const Browse = lazy(() => import("./pages/Browse"));
const Card3D = lazy(() => import("./pages/Card3D"));
const CardInfo = lazy(() => import("./pages/CardInfo"));
const Checkout = lazy(() => import("./pages/Checkout"));
const Collection = lazy(() => import("./pages/Collection"));
const CreatorPayouts = lazy(() => import("./pages/CreatorPayouts"));
const CreatorDashboard = lazy(() => import("./pages/CreatorDashboard"));
const CreatorDropAnalytics = lazy(() => import("./pages/CreatorDropAnalytics"));
const CreatorPage = lazy(() => import("./pages/CreatorPage"));
const DropDetail = lazy(() => import("./pages/DropDetail"));
const Drops = lazy(() => import("./pages/Drops"));
const Home = lazy(() => import("./pages/Home"));
const Kyc = lazy(() => import("./pages/Kyc"));
const Landing = lazy(() => import("./pages/Landing"));
const Leaderboard = lazy(() => import("./pages/Leaderboard"));
const Login = lazy(() => import("./pages/Login"));
const ManageCards = lazy(() => import("./pages/ManageCards"));
const Marketplace = lazy(() => import("./pages/Marketplace"));
const Notifications = lazy(() => import("./pages/Notifications"));
const OrderDetail = lazy(() => import("./pages/OrderDetail"));
const Orders = lazy(() => import("./pages/Orders"));
const Privacy = lazy(() => import("./pages/Privacy"));
const PublicProfile = lazy(() => import("./pages/PublicProfile"));
const Register = lazy(() => import("./pages/Register"));
const VerifyShipment = lazy(() => import("./pages/VerifyShipment"));
const Wallet = lazy(() => import("./pages/Wallet"));

const qc = new QueryClient();

function UserMenu() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const [open, setOpen] = React.useState(false);
  const [unread, setUnread] = React.useState(0);
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("click", onDoc);
    return () => document.removeEventListener("click", onDoc);
  }, []);
  // P0-3 (audit 2026-08-24): unread badge di bell icon, refetch tiap 60 detik.
  React.useEffect(() => {
    if (!user) return;
    let cancelled = false;
    function poll() {
      api
        .unreadCount()
        .then((r) => {
          if (!cancelled) setUnread(r.unread ?? 0);
        })
        .catch(() => {
          // bell gangguan = ignore; tidak boleh block render
        });
    }
    poll();
    const t = setInterval(poll, 60_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [user]);
  if (!user) return null;
  const initial = (user.displayName || user.username || user.email || "U").slice(0, 1).toUpperCase();
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
          {user.displayName ?? user.username ?? user.email}
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
            <div style={{ fontWeight: 700, fontSize: 13, fontFamily: "var(--font-display)" }}>{user.displayName ?? user.email}</div>
            <div style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>{user.email}</div>
            <span
              className="pill"
              style={{
                marginTop: 8,
                background: "var(--gold-bg)",
                color: "var(--gold)",
                border: "1px solid var(--gold-border)",
                fontSize: 10,
              }}
            >
              {user.role === "user" ? "kolektor" : user.role}
            </span>
          </div>
          <div style={{ padding: "6px", display: "flex", flexDirection: "column", gap: 1 }}>
            <MenuLink to="/home" label="Home" onClick={() => setOpen(false)} />
            <MenuLink to="/notifications" label="Notifikasi" badge={unread} onClick={() => setOpen(false)} />
            <MenuLink to="/orders" label="Pesanan" onClick={() => setOpen(false)} />
            <MenuLink to="/collection" label="Koleksi" onClick={() => setOpen(false)} />
            <MenuLink to="/me/manage" label="Kelola C.Card" onClick={() => setOpen(false)} />
            <MenuLink to="/me/manage/verify-shipment" label="Kirim ke Vault" onClick={() => setOpen(false)} />
            <MenuLink to="/wallet" label="Dompet" onClick={() => setOpen(false)} />
            <div style={{ height: 1, background: "var(--border)", margin: "4px 8px" }} />
            <MenuLink to="/me/kyc" label="Verifikasi" onClick={() => setOpen(false)} />
            <MenuLink to="/me/privacy" label="Privasi" onClick={() => setOpen(false)} />
            {isCreator && (
              <>
                <MenuLink to="/creator" label="Dashboard Kreator" onClick={() => setOpen(false)} />
                <MenuLink to="/creator/payouts" label="Payout & Royalti" onClick={() => setOpen(false)} />
              </>
            )}
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
function MenuLink({ to, label, badge, onClick }: { to: string; label: string; badge?: number; onClick?: () => void }) {
  return (
    <NavLink
      to={to}
      onClick={onClick}
      style={({ isActive }) => ({
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
        padding: "8px 12px",
        borderRadius: 8,
        background: isActive ? "var(--surface-2)" : "transparent",
        color: isActive ? "var(--gold)" : "var(--text)",
        fontSize: 13,
        fontWeight: isActive ? 600 : 400,
      })}
    >
      <span>{label}</span>
      {badge != null && badge > 0 && (
        <span
          aria-label={`${badge} belum dibaca`}
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            fontWeight: 700,
            background: "var(--alert)",
            color: "#0A0A0A",
            padding: "1px 6px",
            borderRadius: 99,
            lineHeight: 1.4,
          }}
        >
          {badge > 99 ? "99+" : badge}
        </span>
      )}
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
          <button className="btn-gold" onClick={() => nav("/login")}>
            Masuk / Daftar
          </button>
        ) : (
          <UserMenu />
        )}
      </div>
    </nav>
  );
}

/**
 * Legacy /verify/:shortId → /cards/:shortId (atau /3d jika login) — verify melekat di halaman kartu
 * per docs/02 §4. Redirect permanen menjaga UX NFC tap (UID URL SUN) untuk visitor lama.
 */
function LegacyVerifyRedirect() {
  const shortId = useParams().shortId;
  if (!shortId) return <Navigate to="/cards" replace />;
  return <Navigate to={`/cards/${encodeURIComponent(shortId)}`} replace />;
}

function AppRoutes() {
  return (
    <div className="app-shell">
      <a href="#main-content" className="skip-link">
        Lompat ke konten
      </a>
      <Navbar />
      <main className="main-content" id="main-content">
        <Suspense
          fallback={
            <div className="now-loading">
              Now Loading<span className="blink">▮</span>
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
            <Route path="/browse" element={<Browse />} />
            <Route path="/collection" element={<Collection />} />
            <Route path="/me" element={<Collection />} />
            <Route path="/me/manage" element={<ManageCards />} />
            <Route path="/me/manage/verify-shipment" element={<VerifyShipment />} />
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
            <Route path="/creator/drops/:dropId" element={<CreatorDropAnalytics />} />
            <Route path="/creator/payouts" element={<CreatorPayouts />} />
            {/* /verify/:shortId DITIADAKAN per docs/02 §4 — verify melekat di halaman kartu.
                Redirect permanen ke /cards/:shortId (NFC → /3d jika login, info jika tidak).
                Footer/SO tidak lagi menautkan ke /verify. */}
            <Route path="/verify" element={<Navigate to="/cards" replace />} />
            <Route path="/verify/:shortId" element={<LegacyVerifyRedirect />} />
            {/* Catch-all: unknown path -> 404 informatif (bukan layar kosong) */}
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </Suspense>
      </main>
      <footer className="footer-arcade">
        <div className="footer-line">C.Verse — Koleksi Kreator Edisi Terbatas</div>
        <div className="footer-meta">
          © 2026 · <a href="/sitemap.xml">Sitemap</a> · c-verse.co · Insert Coin <span className="blink">▮</span>
        </div>
      </footer>
    </div>
  );
}

export default function App() {
  // Flag "nanti" dari UsernameSetupModal — dibaca sekali saat mount.
  const [usernameLater] = useState(() => {
    try {
      return localStorage.getItem("cverse_username_later") === "1";
    } catch {
      return false;
    }
  });
  return (
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <AuthProvider>
          <ToastProvider>
            <ErrorBoundary>
              <AppRoutes />
            </ErrorBoundary>
            {!usernameLater && <UsernameSetupModal />}
          </ToastProvider>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

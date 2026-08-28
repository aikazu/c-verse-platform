import { Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { ConfigErrorScreen } from "./components/ConfigErrorScreen";
import { LoginPage } from "./components/LoginPage";
import { Shell } from "./components/Shell";
import { TotpRequired } from "./components/TotpRequired";
import { useAdminAuth } from "./lib/hooks/useAdminAuth";
import { hasSupabase, supabase } from "./lib/supabase";
import { AuditPage } from "./pages/Audit";
import { BadgesPage } from "./pages/Badges";
import { CreatorsPage } from "./pages/Creators";
import { DashboardPage } from "./pages/Dashboard";
import { DisputesPage } from "./pages/Disputes";
import { DropsPage } from "./pages/Drops";
import { InvestorPage } from "./pages/Investor";
import { KycPage } from "./pages/Kyc";
import { NfcPage } from "./pages/Nfc";
import { OrdersPage } from "./pages/Orders";
import { PayoutsPage } from "./pages/Payouts";

export default function App() {
  const { session, aal2, loading, refreshAal2 } = useAdminAuth();
  const nav = useNavigate();

  if (!hasSupabase) return <ConfigErrorScreen />;
  if (loading)
    return (
      <div className="admin-auth-page">
        <div className="muted">Memuat…</div>
      </div>
    );
  if (!session) return <LoginPage />;
  // MFA aal2 wajib di production; di dev build demo login masuk sebagai aal1 —
  // biar seluruh flow admin bisa dites tanpa enrol TOTP. Compile-time: false di prod build.
  const isDemoDev = import.meta.env.DEV && !aal2;
  if (!isDemoDev && !aal2) return <TotpRequired onVerified={refreshAal2} />;

  async function onLogout() {
    await supabase.auth.signOut();
    localStorage.removeItem("admin_demo_session");
    nav("/");
  }

  return (
    <>
      {isDemoDev && (
        <div
          style={{
            position: "fixed",
            bottom: 10,
            right: 12,
            zIndex: 60,
            fontSize: 11,
            fontFamily: "var(--font-mono)",
            color: "var(--gold)",
            border: "1px solid color-mix(in srgb, var(--gold) 35%, transparent)",
            borderRadius: 999,
            padding: "3px 12px",
            background: "var(--surface-2, #14141d)",
            pointerEvents: "none",
          }}
        >
          DEMO · aal1 tanpa TOTP
        </div>
      )}
      <Shell email={session.user.email ?? "admin"} authLabel={isDemoDev ? "Supabase · aal1 (demo)" : "Supabase · aal2"} onLogout={onLogout}>
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/creators" element={<CreatorsPage />} />
          <Route path="/drops" element={<DropsPage />} />
          <Route path="/orders" element={<OrdersPage />} />
          <Route path="/nfc" element={<NfcPage />} />
          <Route path="/payouts" element={<PayoutsPage />} />
          <Route path="/badges" element={<BadgesPage />} />
          <Route path="/disputes" element={<DisputesPage />} />
          <Route path="/kyc" element={<KycPage />} />
          <Route path="/audit" element={<AuditPage />} />
          <Route path="/investor" element={<InvestorPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Shell>
    </>
  );
}

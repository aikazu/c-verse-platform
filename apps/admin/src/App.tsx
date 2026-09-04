import { Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { ConfigErrorScreen } from "./components/ConfigErrorScreen";
import { ConfirmProvider } from "./components/ConfirmProvider";
import { LoginPage } from "./components/LoginPage";
import { Shell } from "./components/Shell";
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
  const { session, loading } = useAdminAuth();
  const nav = useNavigate();

  if (!hasSupabase) return <ConfigErrorScreen />;
  if (loading)
    return (
      <div className="admin-auth-page">
        <div className="muted">Memuat…</div>
      </div>
    );
  if (!session) return <LoginPage />;

  async function onLogout() {
    await supabase.auth.signOut();
    nav("/");
  }

  return (
    <ConfirmProvider>
      <Shell email={session.user.email ?? "admin"} onLogout={onLogout}>
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
    </ConfirmProvider>
  );
}

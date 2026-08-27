import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { CardThumb } from "../components/CardThumb";
import { RequireAuth } from "../components/RequireAuth";
import { api } from "../lib/api";
import type { ApiDrop, ApiDropsResponse, ApiWalletResponse } from "../lib/api-types";
import { useAuth } from "../lib/auth";

export default function Home() {
  return (
    <RequireAuth>
      <HomeInner />
    </RequireAuth>
  );
}

function HomeInner() {
  const { user } = useAuth();
  const { data: wallet } = useQuery<ApiWalletResponse>({
    queryKey: ["wallet"],
    queryFn: () => api.wallet(),
    enabled: !!user,
  });
  const { data: drops, isLoading: dropsLoading } = useQuery<ApiDropsResponse>({
    queryKey: ["drops-home"],
    queryFn: () => api.drops({ status: "live" }),
  });
  const { data: profile, refetch: refetchProfile } = useQuery({
    queryKey: ["profile"],
    queryFn: () => api.profile(),
    enabled: !!user,
  });
  const { data: orders } = useQuery({
    queryKey: ["orders-home"],
    queryFn: () => api.orders(),
    enabled: !!user,
  });
  const live: ApiDrop[] = (drops?.drops ?? []).slice(0, 6);
  const w = wallet?.wallet;
  if (!user) return null;
  // P1-8 (audit 2026-08-24): density — "Butuh aksi" + "Aktivitas" untuk pengguna aktif.
  const myActiveBids = (profile?.bids ?? []).filter((b) => b.status === "active");
  const myCards = profile?.cards ?? [];
  const vaultCards = myCards.filter((c) => c.location === "platform_vault");
  const inTransitOrders = (orders?.orders ?? []).filter((o) => o.status === "shipped");
  const pendingBidCount = myActiveBids.length;
  const MAX_BIDS = 3;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div className="card card-pad" style={{ background: "var(--surface-2)" }}>
        <span className="eyebrow">Halo, {user.displayName}</span>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: 6 }}>
          <span style={{ fontFamily: "var(--font-display)", fontSize: 28, fontWeight: 500 }}>
            {w ? w.balanceCCoin : "—"}{" "}
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--text-muted)", fontWeight: 400 }}>C</span>
          </span>
          <Link
            to="/wallet"
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              color: "var(--gold)",
              fontWeight: 500,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
            }}
          >
            Dompet →
          </Link>
        </div>
      </div>

      {/* Butuh Aksi — pending input user */}
      {(pendingBidCount > 0 || vaultCards.length > 0 || inTransitOrders.length > 0) && (
        <div className="card card-pad" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              fontWeight: 500,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "var(--gold)",
            }}
          >
            Butuh Aksi
          </span>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {pendingBidCount > 0 && (
              <Link
                to="/me/manage"
                className="muted"
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "8px 12px",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  textDecoration: "none",
                  color: "var(--text)",
                }}
              >
                <span style={{ fontSize: 13 }}>
                  {pendingBidCount}/{MAX_BIDS} bid aktif — keluar/terima dari Kelola C.Card
                </span>
                <span style={{ color: "var(--gold)", fontFamily: "var(--font-mono)", fontSize: 11 }}>→</span>
              </Link>
            )}
            {vaultCards.length > 0 && (
              <Link
                to="/me/manage"
                className="muted"
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "8px 12px",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  textDecoration: "none",
                  color: "var(--text)",
                }}
              >
                <span style={{ fontSize: 13 }}>{vaultCards.length} kartu di vault — bisa dikirim kapan saja</span>
                <span style={{ color: "var(--gold)", fontFamily: "var(--font-mono)", fontSize: 11 }}>→</span>
              </Link>
            )}
            {inTransitOrders.length > 0 && (
              <Link
                to="/orders"
                className="muted"
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "8px 12px",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  textDecoration: "none",
                  color: "var(--text)",
                }}
              >
                <span style={{ fontSize: 13 }}>{inTransitOrders.length} pesanan dalam pengiriman</span>
                <span style={{ color: "var(--gold)", fontFamily: "var(--font-mono)", fontSize: 11 }}>→</span>
              </Link>
            )}
          </div>
        </div>
      )}

      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              fontWeight: 500,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "var(--text-dim)",
            }}
          >
            Terbaru
          </span>
          <Link to="/drops" style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--gold)", fontWeight: 500 }}>
            Lihat semua →
          </Link>
        </div>
        <div className="grid-3">
          {live.map((d) => (
            <Link
              key={d.id}
              to={`/drops/${d.id}`}
              className="card"
              style={{ overflow: "hidden", textDecoration: "none", color: "inherit" }}
            >
              <div style={{ height: 120 }}>
                <CardThumb artworkUrl={d.artworkUrl} series={d.series} title={d.title} />
              </div>
              <div style={{ padding: 12 }}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{d.title}</div>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-muted)" }}>
                  {d.series} · {d.priceCcoin ?? d.priceUnsignedCCoin} C
                </div>
              </div>
            </Link>
          ))}
          {dropsLoading ? (
            <div className="muted" style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>
              Memuat…
            </div>
          ) : (
            live.length === 0 && (
              <div className="muted" style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>
                Belum ada drop
              </div>
            )
          )}
        </div>
      </div>
      {/* refetchProfile retained untuk konsistensi cache */}
      {void refetchProfile}
    </div>
  );
}

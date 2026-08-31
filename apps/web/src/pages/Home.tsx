import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { CardThumb } from "../components/CardThumb";
import { RequireAuth } from "../components/RequireAuth";
import { api } from "../lib/api";
import type { ApiDrop, ApiDropsResponse, ApiWalletResponse } from "../lib/api-types";
import { useAuth } from "../lib/auth";
import "./home.css";

const CHANNEL = "CH:00 / COCKPIT";
const CHANNEL_EXTRA = "PILOT DECK";

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
    <div className="page-stack">
      <section className="page-hero" aria-label="Header halaman Cockpit">
        <div className="page-hero-rail">
          <span className="rail-channel">{CHANNEL}</span>
          <span className="rail-dot" aria-hidden="true" />
          <span className="rail-sep">·</span>
          <span className="rail-extra">{CHANNEL_EXTRA}</span>
          <span className="rail-time" aria-label="Siap">
            <span className="rail-cursor" aria-hidden="true" />
          </span>
        </div>
        <div className="page-hero-inner">
          <div className="page-hero-copy">
            <h1 className="page-hero-title">Cockpit</h1>
          </div>
        </div>
      </section>

      <div className="card card-pad hm-balance">
        <span className="eyebrow">Pilot: {user.displayName}</span>
        <div className="hm-balance-row">
          <span className="hm-balance-value">
            {w ? w.balanceCCoin : "—"} <span className="hm-balance-unit">C</span>
          </span>
          <Link to="/wallet" className="hm-balance-link">
            Dompet →
          </Link>
        </div>
      </div>

      {/* Butuh Aksi — pending input user */}
      {(pendingBidCount > 0 || vaultCards.length > 0 || inTransitOrders.length > 0) && (
        <div className="card card-pad hm-stack">
          <span className="label hm-label-gold">Butuh Aksi</span>
          <div className="hm-stack-list">
            {pendingBidCount > 0 && (
              <Link to="/me/manage" className="hm-action-link">
                <span className="hm-action-text">
                  {pendingBidCount}/{MAX_BIDS} bid aktif — keluar/terima dari Kelola C.Card
                </span>
                <span className="hm-action-arrow">→</span>
              </Link>
            )}
            {vaultCards.length > 0 && (
              <Link to="/me/manage" className="hm-action-link">
                <span className="hm-action-text">{vaultCards.length} C.Card di vault — bisa dikirim kapan saja</span>
                <span className="hm-action-arrow">→</span>
              </Link>
            )}
            {inTransitOrders.length > 0 && (
              <Link to="/orders" className="hm-action-link">
                <span className="hm-action-text">{inTransitOrders.length} pesanan dalam pengiriman</span>
                <span className="hm-action-arrow">→</span>
              </Link>
            )}
          </div>
        </div>
      )}

      <div>
        <div className="hm-section-row">
          <span className="label hm-label-dim">Terbaru</span>
          <Link to="/drops" className="hm-link">
            Lihat semua →
          </Link>
        </div>
        <div className="grid-3">
          {live.map((d) => (
            <Link key={d.id} to={`/drops/${d.id}`} className="card hm-card">
              <div className="hm-thumb">
                <CardThumb artworkUrl={d.artworkUrl} series={d.series} title={d.title} />
              </div>
              <div className="hm-card-body">
                <div className="hm-card-title">{d.title}</div>
                <div className="hm-card-meta">
                  {d.series} · {d.priceCcoin ?? d.priceUnsignedCCoin} C
                </div>
              </div>
            </Link>
          ))}
          {dropsLoading ? (
            <div className="muted hm-status">Memuat…</div>
          ) : (
            live.length === 0 && <div className="muted hm-status">Belum ada drop</div>
          )}
        </div>
      </div>
      {/* refetchProfile retained untuk konsistensi cache */}
      {void refetchProfile}
    </div>
  );
}

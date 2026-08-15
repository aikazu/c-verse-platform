import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, formatIdr } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useToast } from "../lib/toast";

export default function ListingDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const { push } = useToast();
  const [bidAmt, setBidAmt] = useState(0);
  const [busy, setBusy] = useState(false);
  const { data, refetch, isLoading } = useQuery({ queryKey: ["listing", id], queryFn: () => api.listing(id!), enabled: !!id });
  if (isLoading) return <div className="muted">Memuat...</div>;
  if (!data)
    return (
      <div className="card card-pad">
        Listing tidak ditemukan.{" "}
        <Link to="/marketplace" style={{ color: "var(--gold)" }}>
          Marketplace →
        </Link>
      </div>
    );
  const listing: any = (data as any).listing ?? data;
  const card: any = (data as any).card;
  const drop: any = (data as any).drop;
  const bids: any[] = (data as any).bids ?? [];
  const isAuction = listing?.type === "auction";
  // Compatibility: if this is actually a marketplace buyout card (no listing timer), show that path
  if (!listing || !isAuction) {
    const _buyoutCard = card ?? listing;
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <Link to="/marketplace" style={{ fontSize: 13, color: "var(--muted)" }}>
          ← Marketplace
        </Link>
        <div className="card card-pad">
          <div style={{ fontWeight: 700 }}>Marketplace — Buyout</div>
          <p className="muted" style={{ fontSize: 13, marginTop: 8 }}>
            Untuk membeli, buka halaman kartu.
          </p>
          {card && (
            <Link to={`/cards/${card.id}`} className="btn-gold" style={{ textDecoration: "none", display: "inline-block", marginTop: 12 }}>
              Buka Info Kartu →
            </Link>
          )}
        </div>
      </div>
    );
  }
  const minBid = listing.currentBidCCoin ? Math.ceil(listing.currentBidCCoin * 1.05) : listing.priceCCoin;
  const isSeller = user?.id === listing.sellerId;
  async function onBid() {
    if (!user) {
      push("Login dulu untuk bid", "info");
      return;
    }
    const amt = bidAmt || minBid;
    if (amt < minBid) {
      push(`Bid minimal ${minBid} C-Coin (5% increment)`, "error");
      return;
    }
    setBusy(true);
    try {
      await api.placeBidLegacy(listing.id, amt);
      push(`Bid ${amt} C-Coin berhasil!`, "success");
      setBidAmt(0);
      refetch();
    } catch (e: any) {
      push(e.message, "error");
    } finally {
      setBusy(false);
    }
  }
  async function onBuyNow() {
    if (!user) {
      push("Login dulu", "info");
      return;
    }
    setBusy(true);
    try {
      await api.buyNow(listing.id);
      push("Buy-now berhasil — kartu pindah ke koleksimu!", "success");
      refetch();
    } catch (e: any) {
      push(e.message, "error");
    } finally {
      setBusy(false);
    }
  }
  async function onAccept() {
    setBusy(true);
    try {
      await api.acceptBidLegacy(listing.id);
      push("Lelang di-settle — ownership pindah.", "success");
      refetch();
    } catch (e: any) {
      push(e.message, "error");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Link to="/marketplace" style={{ fontSize: 13, color: "var(--muted)" }}>
        ← Marketplace
      </Link>

      <div className="grid-2" style={{ alignItems: "start" }}>
        <div className="card card-pad" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span className={`pill ${isAuction ? "pill-info" : "pill-success"}`}>{listing.type.toUpperCase()}</span>
            <span
              className={`pill ${listing.status === "bidding" ? "pill-info" : listing.status === "settled" ? "pill-success" : "pill-warn"}`}
            >
              {listing.status}
            </span>
            {listing.reserveCCoin && <span className="pill pill-warn">Reserve {listing.reserveCCoin} C</span>}
          </div>
          <div style={{ fontSize: 18, fontWeight: 800 }}>
            {drop?.title ?? card?.id} · Unit #{card?.unitNumber} · {card?.variant}
          </div>
          <div className="muted">{drop?.series}</div>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 4 }}>
            <div>
              <div style={{ fontSize: 11, color: "var(--dim)", fontWeight: 700 }}>HARGA AWAL</div>
              <div style={{ fontWeight: 800, fontSize: 18 }}>
                {listing.priceCCoin} C{" "}
                <span style={{ fontSize: 11, color: "var(--muted)" }}>({formatIdr(listing.priceCCoin * 10000)})</span>
              </div>
            </div>
            {listing.currentBidCCoin && (
              <div>
                <div style={{ fontSize: 11, color: "var(--dim)", fontWeight: 700 }}>BID TERTINGGI</div>
                <div style={{ fontWeight: 800, fontSize: 18, color: "var(--gold)" }}>
                  {listing.currentBidCCoin} C{" "}
                  <span style={{ fontSize: 11, color: "var(--muted)" }}>({formatIdr(listing.currentBidCCoin * 10000)})</span>
                </div>
              </div>
            )}
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>
            Seller: {(data as any).seller?.displayName ?? "—"} · Card: {card?.id} · ShortID: {card?.nfcShortId}
          </div>
          <div
            style={{
              fontSize: 11,
              background: "var(--bg-elevated)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              padding: 8,
              color: "var(--muted)",
            }}
          >
            Fee secondary 15%: 7.5% platform + 7.5% royalty kreator lifetime + 85% seller.
          </div>
          {listing.status === "settled" ? (
            <div className="pill pill-success" style={{ justifyContent: "center", padding: 10 }}>
              ✓ Settled — ownership pindah
            </div>
          ) : !isAuction ? (
            <button
              className="btn-gold"
              onClick={onBuyNow}
              disabled={busy || isSeller || listing.status !== "listed"}
              style={{ padding: 12, opacity: busy || isSeller ? 0.5 : 1 }}
            >
              {isSeller ? "Ini listing kamu" : `Buy Now — ${listing.priceCCoin} C-Coin`}
            </button>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  className="input"
                  type="number"
                  placeholder={`Min ${minBid} C`}
                  value={bidAmt || ""}
                  onChange={(e) => setBidAmt(Number(e.target.value))}
                  style={{ flex: 1 }}
                />
                <button className="btn-gold" onClick={onBid} disabled={busy} style={{ padding: "10px 18px" }}>
                  {busy ? "..." : "Bid"}
                </button>
              </div>
              {isSeller && listing.currentBidCCoin && (
                <button className="btn-ghost" onClick={onAccept} disabled={busy} style={{ padding: 10 }}>
                  Accept Winning Bid — Settle
                </button>
              )}
              <Link to={card ? `/cards/${card.id}` : "/browse"} style={{ fontSize: 12, color: "var(--gold)" }}>
                Atau bid langsung di halaman kartu (Browse) →
              </Link>
            </div>
          )}
        </div>
        <div className="card">
          <div
            style={{
              padding: "12px 14px",
              fontWeight: 700,
              borderBottom: "1px solid var(--border)",
              display: "flex",
              justifyContent: "space-between",
            }}
          >
            <span>Bid History ({bids.length})</span>
            <button className="btn-ghost" style={{ padding: "4px 10px", fontSize: 11 }} onClick={() => refetch()}>
              Refresh
            </button>
          </div>
          {bids.length === 0 ? (
            <div style={{ padding: 20, textAlign: "center", color: "var(--muted)", fontSize: 13 }}>Belum ada bid.</div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Bidder</th>
                    <th>Jumlah</th>
                    <th>Waktu</th>
                  </tr>
                </thead>
                <tbody>
                  {bids.map((b: any) => (
                    <tr key={b.id}>
                      <td style={{ fontWeight: 600 }}>
                        {b.bidderName}{" "}
                        {b.bidderId === listing.currentBidderId && (
                          <span className="pill pill-success" style={{ marginLeft: 6, fontSize: 10 }}>
                            TOP
                          </span>
                        )}
                      </td>
                      <td style={{ fontWeight: 800 }}>{b.amountCCoin} C</td>
                      <td style={{ fontSize: 11, color: "var(--muted)" }}>{new Date(b.createdAt).toLocaleString("id-ID")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

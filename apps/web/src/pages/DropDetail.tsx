import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { StatusBadge } from "../components/StatusBadge";
import { api, formatIdr } from "../lib/api";

export default function DropDetail() {
  const { id } = useParams();
  const { data, isLoading } = useQuery({ queryKey: ["drop", id], queryFn: () => api.drop(id!), enabled: !!id });
  if (isLoading)
    return (
      <div className="muted" style={{ padding: 24, textAlign: "center" }}>
        Memuat…
      </div>
    );
  if (!data)
    return (
      <div className="card card-pad">
        Drop tidak ditemukan.{" "}
        <Link to="/drops" style={{ color: "var(--gold)" }}>
          Kembali
        </Link>
      </div>
    );
  const d: any = (data as any).title ? (data as any) : ((data as any).drop ?? data);
  const drop = (d as any).title ? (d as any) : d;
  const price = drop.priceCcoin ?? drop.priceCcoin ?? drop.priceUnsignedCCoin ?? 30;
  const pct = drop.totalUnits ? Math.round((drop.soldCount / drop.totalUnits) * 100) : 0;
  const isLive = drop.status === "live" || drop.status === "published";
  const dropAt = drop.dropStartAt ?? drop.dropAt;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <Link to="/drops" style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-muted)", letterSpacing: "0.04em" }}>
        ← Kembali ke Drops
      </Link>
      <div className="grid-2" style={{ alignItems: "start" }}>
        <div className="card" style={{ overflow: "hidden" }}>
          <div
            style={{
              aspectRatio: "4/3",
              background: "var(--thumb-grad)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 64,
            }}
          >
            🎴
          </div>
          <div className="card-pad">
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <StatusBadge status={drop.status} kind="drop" style={{ fontFamily: "var(--font-mono)" }} />
              <span className="pill pill-info" style={{ fontFamily: "var(--font-mono)" }}>
                {drop.series}
              </span>
            </div>
            <p className="muted" style={{ marginTop: 14, lineHeight: 1.7 }}>
              {drop.narrative}
            </p>
            <div style={{ display: "flex", gap: 20, marginTop: 16, flexWrap: "wrap" }}>
              <div>
                <div
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 10,
                    color: "var(--text-dim)",
                    fontWeight: 500,
                    letterSpacing: "0.08em",
                  }}
                >
                  TOTAL
                </div>
                <div style={{ fontWeight: 700, fontSize: 15, marginTop: 2 }}>{drop.totalUnits}</div>
              </div>
              <div>
                <div
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 10,
                    color: "var(--text-dim)",
                    fontWeight: 500,
                    letterSpacing: "0.08em",
                  }}
                >
                  TERJUAL
                </div>
                <div style={{ fontWeight: 700, fontSize: 15, marginTop: 2 }}>
                  {drop.soldCount}/{drop.totalUnits} · {pct}%
                </div>
              </div>
              <div>
                <div
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 10,
                    color: "var(--text-dim)",
                    fontWeight: 500,
                    letterSpacing: "0.08em",
                  }}
                >
                  HARGA
                </div>
                <div style={{ fontWeight: 700, fontSize: 15, marginTop: 2 }}>
                  {price} C <span style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 400 }}>· {formatIdr(price * 10000)}</span>
                </div>
              </div>
            </div>
            <div className="progress" style={{ marginTop: 14, height: 4 }}>
              <div className="progress-fill" style={{ width: `${pct}%` }} />
            </div>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-dim)", marginTop: 10 }}>
              oleh {drop.creatorName} {dropAt ? `· ${new Date(dropAt).toLocaleString("id-ID")}` : ""}
            </div>
            {(drop.creatorHandle ?? drop.creatorUsername ?? drop.creatorId) && (
              <Link
                to={`/c/${drop.creatorHandle ?? drop.creatorUsername ?? drop.creatorId}`}
                style={{ fontSize: 12, color: "var(--gold)", marginTop: 8, display: "inline-block", fontWeight: 500 }}
              >
                Lihat kreator →
              </Link>
            )}
          </div>
        </div>
        <div className="card card-pad" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <span className="eyebrow">Checkout</span>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 18, fontWeight: 500, marginTop: 4 }}>
              Beli <em style={{ fontStyle: "italic", fontWeight: 300, color: "var(--gold)" }}>C.Card</em>
            </div>
            <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
              Maksimal 1 C.Card per drop
            </div>
          </div>
          <div
            style={{
              background: "var(--surface-2)",
              border: "1px solid var(--border)",
              borderRadius: 10,
              padding: 14,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <div>
              <div
                style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-dim)", fontWeight: 500, letterSpacing: "0.08em" }}
              >
                HARGA
              </div>
              <div style={{ fontWeight: 700, fontSize: 18, marginTop: 2 }}>{price} C</div>
            </div>
            <div style={{ fontSize: 11, color: "var(--text-muted)", textAlign: "right" }}>1 C = Rp 10.000</div>
          </div>
          {!isLive ? (
            <div className="pill pill-warn" style={{ justifyContent: "center", padding: "10px", fontFamily: "var(--font-mono)" }}>
              Belum tersedia — {drop.status}
            </div>
          ) : (
            <Link
              to={`/drops/${drop.id}/checkout`}
              className="btn-gold"
              style={{ padding: "14px", fontSize: 14, width: "100%", textAlign: "center", textDecoration: "none", display: "block" }}
            >
              Beli Sekarang →
            </Link>
          )}
          <div style={{ fontSize: 11, color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}>
            Saldo kurang?{" "}
            <Link to="/wallet" style={{ color: "var(--gold)", fontWeight: 600 }}>
              Isi C-Coin →
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

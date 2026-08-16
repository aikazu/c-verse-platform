import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";

export default function Home() {
  const { user } = useAuth();
  const { data: wallet } = useQuery({ queryKey: ["wallet"], queryFn: () => api.wallet(), enabled: !!user });
  const { data: drops } = useQuery({ queryKey: ["drops-home"], queryFn: () => api.drops({ status: "live" }) });
  if (!user)
    return (
      <div className="card card-pad" style={{ textAlign: "center", padding: 32 }}>
        <span className="eyebrow">Home</span>
        <p className="muted" style={{ marginTop: 8 }}>
          Masuk untuk melihat home
        </p>
        <Link to="/login" style={{ color: "var(--gold)", fontSize: 13, fontWeight: 600, marginTop: 10, display: "inline-block" }}>
          Masuk →
        </Link>
      </div>
    );
  const live: any[] = (drops as any)?.drops?.slice(0, 6) ?? [];
  const w: any = (wallet as any)?.wallet;
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
          {live.map((d: any) => (
            <Link
              key={d.id}
              to={`/drops/${d.id}`}
              className="card"
              style={{ overflow: "hidden", textDecoration: "none", color: "inherit" }}
            >
              <div
                style={{
                  height: 120,
                  background: "var(--thumb-grad)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 28,
                }}
              >
                🎴
              </div>
              <div style={{ padding: 12 }}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{d.title}</div>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-muted)" }}>
                  {d.series} · {d.priceCcoin ?? d.priceUnsignedCCoin} C
                </div>
              </div>
            </Link>
          ))}
          {live.length === 0 && (
            <div className="muted" style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>
              Belum ada drop
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

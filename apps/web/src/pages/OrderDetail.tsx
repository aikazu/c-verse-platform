import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { api } from "../lib/api";
import { useToast } from "../lib/toast";

export default function OrderDetail() {
  const { id } = useParams();
  const { push } = useToast();
  const { data, isLoading, refetch } = useQuery({ queryKey: ["order", id], queryFn: () => api.order(id!), enabled: !!id });
  if (isLoading)
    return (
      <div className="muted" style={{ padding: 24, textAlign: "center" }}>
        Memuat…
      </div>
    );
  if (!data)
    return (
      <div className="card card-pad" style={{ textAlign: "center", padding: 32 }}>
        <p className="muted">Pesanan tidak ditemukan</p>
      </div>
    );
  const o: any = (data as any).order ?? data;
  const drop: any = (data as any).drop;
  const cards: any[] = (data as any).cards ?? [];
  const shipments: any[] = (data as any).shipments ?? [];
  const isVault = o.deliveryOption === "vault" || (!o.shippingAddress && o.deliveryOption !== "shipping");
  async function onConfirm() {
    try {
      await api.confirmDelivered(o.id);
      push("Pesanan diterima — terima kasih!", "success");
      refetch();
    } catch (e: any) {
      push(e.message, "error");
    }
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <Link to="/orders" style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-muted)" }}>
        ← Pesanan
      </Link>
      <div className="card card-pad">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
          <div>
            <span className="eyebrow">Pesanan · {o.id.slice(0, 10)}</span>
            <h2 className="h2" style={{ marginTop: 4 }}>
              {drop?.title ?? o.dropId}
            </h2>
            <div style={{ fontWeight: 600, fontSize: 14, marginTop: 4 }}>{o.totalCCoin} C</div>
          </div>
          <span
            className={`pill ${o.status === "delivered" ? "pill-success" : o.status === "shipped" ? "pill-info" : "pill-warn"}`}
            style={{ fontSize: 11, flexShrink: 0 }}
          >
            {o.status}
          </span>
        </div>
        <div style={{ display: "flex", gap: 20, marginTop: 16, flexWrap: "wrap", fontSize: 13 }}>
          <div>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-dim)", letterSpacing: "0.08em" }}>OPSI</span>
            <br />
            <span style={{ fontWeight: 600 }}>{isVault ? "Vault" : "Kirim fisik"}</span>
          </div>
          {!isVault && (
            <div>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-dim)", letterSpacing: "0.08em" }}>
                ONGKIR
              </span>
              <br />
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>{o.shippingFeeCcoin ?? "—"} C</span>
            </div>
          )}
          <div>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-dim)", letterSpacing: "0.08em" }}>ESCROW</span>
            <br />
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>{o.escrowStatus ?? "held"}</span>
          </div>
          {!isVault && o.trackingNumber && (
            <div>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-dim)", letterSpacing: "0.08em" }}>RESI</span>
              <br />
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 600 }}>{o.trackingNumber}</span>
            </div>
          )}
        </div>
        {!isVault ? (
          <div style={{ marginTop: 16 }}>
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                fontWeight: 500,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                color: "var(--text-muted)",
                marginBottom: 8,
              }}
            >
              Timeline
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {["paid", "qc", "shipped", "delivered", "settled"].map((s) => (
                <span
                  key={s}
                  className={`pill ${o.status === s ? "pill-success" : ""}`}
                  style={{ fontSize: 10, fontFamily: "var(--font-mono)" }}
                >
                  {s}
                </span>
              ))}
            </div>
            {o.shippingAddress && (
              <div className="muted" style={{ fontSize: 12, marginTop: 10, fontFamily: "var(--font-mono)" }}>
                Alamat: {o.shippingAddress}
              </div>
            )}
            {o.status === "shipped" && (
              <button className="btn-gold" onClick={onConfirm} style={{ marginTop: 14 }}>
                Konfirmasi Diterima
              </button>
            )}
          </div>
        ) : (
          <div className="muted" style={{ fontSize: 12, marginTop: 14, fontFamily: "var(--font-mono)", lineHeight: 1.6 }}>
            Disimpan di vault — tanpa tracking. Kelola di{" "}
            <Link to="/me/manage" style={{ color: "var(--gold)", fontWeight: 600 }}>
              Kelola Kartu →
            </Link>
          </div>
        )}
        {cards.length > 0 && (
          <div style={{ marginTop: 18 }}>
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                fontWeight: 500,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                color: "var(--text-muted)",
                marginBottom: 8,
              }}
            >
              Kartu
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {cards.map((c: any) => (
                <Link
                  key={c.id}
                  to={`/cards/${c.id}`}
                  className="pill pill-info"
                  style={{ textDecoration: "none", fontFamily: "var(--font-mono)", fontSize: 11 }}
                >
                  {c.nfcShortId} · #{c.unitNumber}
                </Link>
              ))}
            </div>
          </div>
        )}
        {shipments.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                fontWeight: 500,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                color: "var(--text-muted)",
                marginBottom: 8,
              }}
            >
              Pengiriman
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {shipments.map((s: any) => (
                <div key={s.id} style={{ display: "flex", justifyContent: "space-between", fontFamily: "var(--font-mono)", fontSize: 11 }}>
                  <span>
                    {s.type} → {s.toDest} · {s.status}
                  </span>
                  <span style={{ color: "var(--text-muted)" }}>{s.trackingNumber ?? "—"}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

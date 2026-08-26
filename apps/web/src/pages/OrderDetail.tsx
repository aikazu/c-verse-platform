import { orderStatusLabel, shipmentStatusLabel } from "@c-verse/shared";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { RequireAuth } from "../components/RequireAuth";
import { StatusBadge } from "../components/StatusBadge";
import { api } from "../lib/api";
import { useToast } from "../lib/toast";

const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export default function OrderDetail() {
  return (
    <RequireAuth>
      <OrderDetailInner />
    </RequireAuth>
  );
}

function OrderDetailInner() {
  const { id } = useParams();
  const { push } = useToast();
  const [busy, setBusy] = useState(false);
  const [disputeOpen, setDisputeOpen] = useState(false);
  const [disputeReason, setDisputeReason] = useState("");
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
  const o = data.order;
  const drop = data.drop;
  const cards = data.cards;
  const shipments = data.shipments ?? [];
  const isVault = o.deliveryOption === "vault" || (!o.shippingAddress && o.deliveryOption !== "shipping");
  const isShipped = o.status === "shipped";
  async function onConfirm() {
    setBusy(true);
    try {
      await api.confirmDelivered(o.id);
      push("Pesanan diterima — terima kasih!", "success");
      refetch();
    } catch (e: unknown) {
      push(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }
  async function onDispute() {
    if (disputeReason.trim().length < 10) {
      push("Alasan dispute minimal 10 karakter", "info");
      return;
    }
    setBusy(true);
    try {
      await api.openDispute(o.id, disputeReason.trim());
      push("Dispute dibuat — tim kami akan meninjau", "success");
      setDisputeOpen(false);
      refetch();
    } catch (e: unknown) {
      push(errorMessage(e), "error");
    } finally {
      setBusy(false);
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
          <StatusBadge status={o.status} kind="order" style={{ fontSize: 11, flexShrink: 0 }} />
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
                  {orderStatusLabel(s)}
                </span>
              ))}
            </div>
            {o.shippingAddress && (
              <div className="muted" style={{ fontSize: 12, marginTop: 10, fontFamily: "var(--font-mono)" }}>
                Alamat: {o.shippingAddress}
              </div>
            )}
            {isShipped && (
              <>
                <button className="btn-gold" onClick={onConfirm} disabled={busy} style={{ marginTop: 14 }}>
                  {busy ? "Memproses…" : "Konfirmasi Diterima"}
                </button>
                <div className="muted" style={{ fontSize: 11, marginTop: 8 }}>
                  Dana dilepas otomatis H+7 setelah diterima.
                </div>
              </>
            )}
          </div>
        ) : (
          <div className="muted" style={{ fontSize: 12, marginTop: 14, fontFamily: "var(--font-mono)", lineHeight: 1.6 }}>
            Disimpan di vault — tanpa tracking. Kelola di{" "}
            <Link to="/me/manage" style={{ color: "var(--gold)", fontWeight: 600 }}>
              Kelola C.Card →
            </Link>
          </div>
        )}
        {o.status !== "settled" && (
          <div style={{ marginTop: 16, borderTop: "1px solid var(--border)", paddingTop: 14 }}>
            {disputeOpen ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <label className="label" htmlFor="dispute-reason">
                  Alasan dispute (min 10 karakter)
                </label>
                <textarea
                  id="dispute-reason"
                  className="textarea"
                  rows={3}
                  value={disputeReason}
                  onChange={(e) => setDisputeReason(e.target.value)}
                  placeholder="Jelaskan masalah pada pesanan ini…"
                />
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    className="btn-ghost"
                    onClick={() => setDisputeOpen(false)}
                    disabled={busy}
                    style={{ padding: "8px 14px", fontSize: 12 }}
                  >
                    Batal
                  </button>
                  <button className="btn-gold" onClick={onDispute} disabled={busy} style={{ padding: "8px 14px", fontSize: 12 }}>
                    {busy ? "Mengirim…" : "Kirim dispute"}
                  </button>
                </div>
              </div>
            ) : (
              <button className="btn-ghost" onClick={() => setDisputeOpen(true)} style={{ fontSize: 12, fontFamily: "var(--font-mono)" }}>
                Lapor masalah (dispute)
              </button>
            )}
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
              C.Card
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {cards.map((c) => (
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
              {shipments.map((s) => (
                <div key={s.id} style={{ display: "flex", justifyContent: "space-between", fontFamily: "var(--font-mono)", fontSize: 11 }}>
                  <span>
                    {s.type} → {s.toDest} · {shipmentStatusLabel(s.status)}
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

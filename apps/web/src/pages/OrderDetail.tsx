import { escrowStatusLabel, orderStatusLabel, shipmentStatusLabel, shipmentToDestLabel, shipmentTypeLabel } from "@c-verse/shared";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useConfirm } from "../components/ConfirmProvider";
import { PesananVisual } from "../components/HeroVisuals";
import { PageHero } from "../components/PageHero";
import { RequireAuth } from "../components/RequireAuth";
import { StatusBadge } from "../components/StatusBadge";
import { api } from "../lib/api";
import { useToast } from "../lib/toast";
import "./orders.css";

// Fallback terakhir untuk error tanpa code-map — jangan render teks server mentah.
const GENERIC_ERROR = "Terjadi kesalahan, coba lagi";

function fmtDate(s: string | null | undefined): string {
  if (!s) return "—";
  return new Date(s).toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" });
}

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
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  const [disputeOpen, setDisputeOpen] = useState(false);
  const [disputeSent, setDisputeSent] = useState(false); // P1-5: hide tombol setelah submit
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
  async function onDispute() {
    if (disputeReason.trim().length < 10) {
      push("Alasan dispute minimal 10 karakter", "info");
      return;
    }
    // D8: submit dispute = aksi tidak bisa dibatalkan — wajib konfirmasi in-app.
    if (!(await confirm({ title: "Kirim dispute untuk pesanan ini?", confirmLabel: "Kirim" }))) return;
    setBusy(true);
    try {
      await api.openDispute(o.id, disputeReason.trim());
      push("Dispute dibuat", "success");
      setDisputeOpen(false);
      setDisputeSent(true); // P1-5: hide tombol setelah submit agar tidak double-submit
      refetch();
    } catch (e: unknown) {
      console.error("openDispute gagal", e);
      push(GENERIC_ERROR, "error");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="page-stack">
      <PageHero
        heroVisual={<PesananVisual />}
        channel="13B"
        channelLabel="PESANAN"
        title="Detail Pesanan"
        actions={
          <Link to="/orders" className="btn-ghost od-back">
            ← Pesanan
          </Link>
        }
      />
      <div className="card card-pad">
        <div className="od-card-head">
          <div>
            <span className="eyebrow">Ringkasan</span>
            <h2 className="h2 od-mt-4">{drop?.title ?? "Tanpa judul"}</h2>
            <div className="od-total">{o.totalCCoin} C</div>
          </div>
          <StatusBadge status={o.status} kind="order" style={{ fontSize: 11, flexShrink: 0 }} />
        </div>
        <div className="od-meta">
          <div>
            <span className="od-meta-label">OPSI</span>
            <br />
            <span className="od-meta-value">{isVault ? "Vault" : "Kirim fisik"}</span>
          </div>
          {!isVault && (
            <div>
              <span className="od-meta-label">ONGKIR</span>
              <br />
              <span className="od-meta-mono">{o.shippingFeeCcoin ?? "—"} C</span>
            </div>
          )}
          <div>
            <span className="od-meta-label">STATUS DANA</span>
            <br />
            <span className="od-meta-mono-sm">{escrowStatusLabel(o.escrowStatus ?? "held")}</span>
          </div>
          {!isVault && o.trackingNumber && (
            <div>
              <span className="od-meta-label">RESI</span>
              <br />
              <span className="od-meta-mono-strong">{o.trackingNumber}</span>
            </div>
          )}
        </div>
        {!isVault ? (
          <div className="od-timeline-block">
            <div className="od-section-label">Timeline</div>
            <div className="od-timeline" role="list">
              {["paid", "qc", "shipped", "delivered", "settled"].map((s) => {
                const isCurrent = o.status === s;
                const ts = s === "paid" ? o.paidAt : s === "shipped" ? o.shippedAt : s === "delivered" ? o.deliveredAt : null;
                return (
                  <div key={s} role="listitem" className={`od-step${isCurrent ? " is-current" : ""}`} title={ts ? fmtDate(ts) : undefined}>
                    <span className="od-step-dot" aria-hidden="true" />
                    <div className="od-step-body">
                      <span className="od-step-label">{orderStatusLabel(s)}</span>
                      {ts && <span className="od-step-time">{fmtDate(ts)}</span>}
                    </div>
                  </div>
                );
              })}
            </div>
            {o.shippingAddress && <div className="od-ship-address">Alamat: {o.shippingAddress}</div>}
          </div>
        ) : (
          <div className="od-vault-note">
            Disimpan di vault — tanpa tracking. Kelola di{" "}
            <Link to="/me/manage" className="od-link-gold">
              Kelola C.Card →
            </Link>
          </div>
        )}
        {/* Vault-only purchases (founder 2026-08-28) settle as "released":
            dispute stays available for settled orders too. */}
        {!disputeSent && (
          <div className="od-dispute-block">
            {disputeOpen ? (
              <div className="od-form-col">
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
                <div className="od-form-actions">
                  <button className="btn-ghost od-btn-sm" onClick={() => setDisputeOpen(false)} disabled={busy}>
                    Batal
                  </button>
                  <button className="btn-gold od-btn-sm" onClick={onDispute} disabled={busy}>
                    {busy ? "Mengirim…" : "Kirim dispute"}
                  </button>
                </div>
              </div>
            ) : (
              <button className="btn-ghost od-dispute-btn" onClick={() => setDisputeOpen(true)}>
                Lapor masalah (dispute)
              </button>
            )}
          </div>
        )}
        {disputeSent && (
          <div className="card card-pad od-dispute-sent" role="status">
            <strong className="od-dispute-strong">Dispute terkirim</strong>
          </div>
        )}
        {cards.length > 0 && (
          <div className="od-cards-block">
            <div className="od-section-label">C.Card</div>
            <div className="od-pill-row">
              {cards.map((c) => (
                <Link key={c.id} to={`/cards/${c.id}`} className="pill pill-info od-card-pill">
                  {c.nfcShortId} · #{c.unitNumber}
                </Link>
              ))}
            </div>
          </div>
        )}
        {shipments.length > 0 && (
          <div className="od-shipments-block">
            <div className="od-section-label">Pengiriman</div>
            <div className="od-shipment-list">
              {shipments.map((s) => (
                <div key={s.id} className="od-shipment-row">
                  <span>
                    {shipmentTypeLabel(s.type)} → {shipmentToDestLabel(s.toDest)} · {shipmentStatusLabel(s.status)}
                  </span>
                  <span className="od-shipment-track">{s.trackingNumber ?? "—"}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

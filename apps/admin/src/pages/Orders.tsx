import { useEffect, useState } from "react";
import { type ConfirmOptions, useConfirm } from "../components/ConfirmProvider";
import { StatusBadge } from "../components/StatusBadge";
import { apiFetch } from "../lib/api";
import { supabase } from "../lib/supabase";
import type { OrderRow, ShipmentRow } from "../lib/types";
import { errMessage } from "../lib/utils";

/**
 * Opsi konfirmasi D8 per transisi status pengiriman (pure — mudah diuji).
 * null = transisi tanpa konfirmasi (tidak ada saat ini). Kirim TANPA resi
 * irreversible/lacak-nol → danger.
 */
export function shipmentConfirmOptions(status: string, trackingNumber: string | undefined): ConfirmOptions | null {
  switch (status) {
    case "cancelled":
      return { title: "Batalkan pengiriman ini?", message: "Aksi ini tidak dapat dibatalkan.", confirmLabel: "Batalkan", danger: true };
    case "packed":
      return { title: "Tandai pengiriman ini sudah dipacking?", confirmLabel: "Packing" };
    case "shipped":
      return trackingNumber
        ? { title: "Tandai pengiriman ini dikirim?", confirmLabel: "Kirim" }
        : {
            title: "Kirim tanpa nomor resi?",
            message: "Pengiriman tanpa nomor resi tidak dapat dilacak.",
            confirmLabel: "Kirim",
            danger: true,
          };
    case "delivered":
      return { title: "Tandai pengiriman ini selesai (diterima)?", confirmLabel: "Selesai" };
    default:
      return null;
  }
}

export function OrdersPage() {
  const confirm = useConfirm();
  const [rows, setRows] = useState<OrderRow[]>([]);
  const [shipments, setShipments] = useState<ShipmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [trackInputs, setTrackInputs] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setLoadError(false);
    const [{ data: o, error: oErr }, { data: s, error: sErr }] = await Promise.all([
      supabase
        .from("orders")
        .select("id,card_id,status,delivery_option,tracking_number,created_at")
        .order("created_at", { ascending: false })
        .limit(100),
      supabase.from("shipments").select("id,card_id,status,tracking_number").order("created_at", { ascending: false }).limit(500),
    ]);
    if (oErr || sErr) {
      setLoadError(true);
      setLoading(false);
      return;
    }
    setRows((o ?? []) as OrderRow[]);
    setShipments((s ?? []) as ShipmentRow[]);
    setLoading(false);
  }
  useEffect(() => {
    load();
  }, []);

  function shipmentFor(order: OrderRow): ShipmentRow | null {
    if (!order.card_id) return null;
    return shipments.find((s) => s.card_id === order.card_id) ?? null;
  }

  async function updateShipment(shipmentId: string, status: string, trackingNumber?: string) {
    // D8: setiap aksi mutasi lewat konfirmasi in-app. Kirim TANPA resi =
    // tidak dapat dilacak → danger; transisi lain standar; Batal sudah danger.
    const options = shipmentConfirmOptions(status, trackingNumber);
    if (options && !(await confirm(options))) return;
    setMsg(null);
    setBusyId(shipmentId);
    try {
      await apiFetch(`/api/shipments/${shipmentId}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status, ...(trackingNumber ? { trackingNumber } : {}) }),
      });
      load();
    } catch (err) {
      setMsg(errMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  function actionsFor(order: OrderRow) {
    if (order.delivery_option === "vault") {
      return <span className="muted fs-11">Vault — settled otomatis</span>;
    }
    const shipment = shipmentFor(order);
    if (!shipment) {
      return <span className="muted fs-11">Tidak ada shipment — order shipping tanpa record pengiriman</span>;
    }
    const tracking = trackInputs[shipment.id] ?? "";
    const rowBusy = busyId === shipment.id;
    return (
      <div className="flex-gap-6 flex-wrap" style={{ alignItems: "center" }}>
        <StatusBadge status={shipment.status} kind="shipment" style={{ fontSize: 10 }} />
        {shipment.status === "requested" && (
          <>
            <button className="btn-ghost admin-mini" onClick={() => updateShipment(shipment.id, "packed")} disabled={rowBusy}>
              Packing
            </button>
            <button className="btn-ghost admin-mini" onClick={() => updateShipment(shipment.id, "cancelled")} disabled={rowBusy}>
              Batal
            </button>
          </>
        )}
        {(shipment.status === "requested" || shipment.status === "packed") && (
          <>
            <input
              className="input"
              aria-label="Nomor resi"
              placeholder="No. resi"
              value={tracking}
              onChange={(e) => setTrackInputs((prev) => ({ ...prev, [shipment.id]: e.target.value }))}
              style={{ width: 110, fontSize: 11, padding: "4px 8px" }}
            />
            <button
              className="btn-ghost admin-mini"
              onClick={() => updateShipment(shipment.id, "shipped", tracking || undefined)}
              disabled={rowBusy}
            >
              Kirim
            </button>
          </>
        )}
        {shipment.status === "shipped" && (
          <button className="btn-gold admin-mini" onClick={() => updateShipment(shipment.id, "delivered")} disabled={rowBusy}>
            Selesai
          </button>
        )}
        {shipment.status === "delivered" && <span className="muted fs-11">Selesai</span>}
        {shipment.status === "cancelled" && <span className="muted fs-11">Dibatalkan</span>}
      </div>
    );
  }

  return (
    <div className="admin-page">
      <div className="admin-page-head">
        <h2>Pesanan</h2>
        <p className="muted">Kelola pengiriman — transisi divalidasi server-side via /api/shipments</p>
      </div>
      {msg && (
        <div className="admin-msg" role="status" aria-live="polite">
          {msg}
        </div>
      )}
      <div className="card">
        <div className="admin-table-head">100 terbaru</div>
        {loading ? (
          <div style={{ padding: 20 }} className="muted">
            Memuat…
          </div>
        ) : loadError ? (
          <div className="admin-msg" role="alert" aria-live="polite" style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span>Gagal memuat data pesanan — periksa koneksi lalu coba lagi.</span>
            <button className="btn-ghost admin-mini" onClick={load}>
              Coba Lagi
            </button>
          </div>
        ) : rows.length === 0 ? (
          <div style={{ padding: 20 }} className="muted">
            Belum ada pesanan
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Status Order</th>
                  <th>Opsi</th>
                  <th>Resi</th>
                  <th>Pengiriman</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td style={{ fontFamily: "monospace", fontSize: 11 }}>{r.id.slice(0, 10)}</td>
                    <td>
                      <StatusBadge status={r.status} kind="order" />
                    </td>
                    <td style={{ fontSize: 12 }}>{r.delivery_option ?? "—"}</td>
                    <td style={{ fontSize: 11 }}>{r.tracking_number ?? "—"}</td>
                    <td>{actionsFor(r)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

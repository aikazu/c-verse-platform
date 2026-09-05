import { useEffect, useState } from "react";
import { type ConfirmOptions, useConfirm } from "../components/ConfirmProvider";
import { StatusBadge } from "../components/StatusBadge";
import { apiFetch } from "../lib/api";
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

export type ShipmentAction = "packed" | "cancelled" | "shipped" | "delivered";

/** Aksi ditentukan status shipment, bukan keberadaan order historis. */
export function shipmentActionsForStatus(status: string): ShipmentAction[] {
  switch (status) {
    case "requested":
      return ["packed", "cancelled", "shipped"];
    case "packed":
      return ["shipped", "cancelled"];
    case "shipped":
      return ["delivered"];
    default:
      return [];
  }
}

export function shipmentDestination(shipment: Pick<ShipmentRow, "to_dest" | "address">): string {
  const street = shipment.address?.street?.trim();
  return street ? `${shipment.to_dest} · ${street}` : shipment.to_dest;
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
    try {
      const result = await apiFetch<{ orders: OrderRow[]; shipments: ShipmentRow[] }>("/api/admin/orders");
      setRows(result.orders);
      setShipments(result.shipments);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

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

  function actionsForShipment(shipment: ShipmentRow) {
    const actions = shipmentActionsForStatus(shipment.status);
    const tracking = trackInputs[shipment.id] ?? shipment.tracking_number ?? "";
    const rowBusy = busyId === shipment.id;
    return (
      <div className="flex-gap-6 flex-wrap" style={{ alignItems: "center" }}>
        {actions.includes("packed") && (
          <button className="btn-ghost admin-mini" onClick={() => updateShipment(shipment.id, "packed")} disabled={rowBusy}>
            Packing
          </button>
        )}
        {actions.includes("cancelled") && (
          <button className="btn-ghost admin-mini" onClick={() => updateShipment(shipment.id, "cancelled")} disabled={rowBusy}>
            Batal
          </button>
        )}
        {actions.includes("shipped") && (
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
        {actions.includes("delivered") && (
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
        <p className="muted">Kelola riwayat pesanan dan antrean pengiriman.</p>
      </div>
      {msg && (
        <div className="admin-msg" role="status" aria-live="polite">
          {msg}
        </div>
      )}
      <div className="card">
        <div className="admin-table-head">Riwayat pesanan — 100 terbaru</div>
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
                  <th>Catatan</th>
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
                    <td className="muted fs-11">Status pengiriman dilacak di antrean shipment.</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {!loading && !loadError && (
        <div className="card" style={{ marginTop: 14 }}>
          <div className="admin-table-head">Antrean shipment — {shipments.length}</div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>C.Card</th>
                  <th>Pemohon</th>
                  <th>Jenis / rute</th>
                  <th>Tujuan</th>
                  <th>Status</th>
                  <th>Resi</th>
                  <th>Aksi</th>
                </tr>
              </thead>
              <tbody>
                {shipments.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="empty-state">
                      Tidak ada shipment
                    </td>
                  </tr>
                ) : (
                  shipments.map((shipment) => (
                    <tr key={shipment.id}>
                      <td className="mono fs-11">{shipment.id.slice(0, 10)}</td>
                      <td className="mono fs-11">{shipment.card_id.slice(0, 10)}</td>
                      <td className="mono fs-11">{shipment.requester_id.slice(0, 10)}</td>
                      <td style={{ fontSize: 11 }}>
                        <div>{shipment.type}</div>
                        <div className="muted">
                          {shipment.from_location} → {shipment.to_dest}
                        </div>
                      </td>
                      <td style={{ fontSize: 11 }}>{shipmentDestination(shipment)}</td>
                      <td>
                        <StatusBadge status={shipment.status} kind="shipment" style={{ fontSize: 10 }} />
                      </td>
                      <td className="mono fs-11">{shipment.tracking_number ?? "—"}</td>
                      <td>{actionsForShipment(shipment)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

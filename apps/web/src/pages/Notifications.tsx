import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { RequireAuth } from "../components/RequireAuth";
import { api } from "../lib/api";
import "./orders.css";

// P0-3 (audit 2026-08-24): inbox halaman. Server returns templateKey + payload;
// render label generik per templateKey sampai admin/kreator mengirim template
// riil. Tombol "Tandai semua" idempotent.
const TEMPLATE_LABEL: Record<string, (p: Record<string, unknown> | null) => string> = {
  bid_outbid: (p) => `Tawaranmu di-outbid. Tertinggi baru ${p?.newBid ?? "?"} C`,
  bid_accepted: (p) => `Tawaranmu diterima di ${p?.amount ?? "?"} C`,
  bid_received: (p) => `Tawaran baru ${p?.amount ?? "?"} C dari ${p?.bidderName ?? "?"}`,
  card_bought: (p) => `C.Card kamu dibeli di ${p?.amount ?? "?"} C`,
  draw_winner: () => "Kamu menang raffle — order dibuat",
  draw_loser: () => "Kamu kalah raffle — C-Coin dikembalikan",
  payout_disbursed: (p) => `Payout ${p?.amount ?? "?"} C diteruskan ke rekening`,
  payout_failed: (p) => `Payout gagal (${p?.status ?? "?"}) — cek menu Payout`,
  shipment_shipped: () => "C.Card dalam pengiriman",
  shipment_delivered: () => "C.Card sudah diterima",
  kyc_approved: () => "KYC disetujui — penarikan dana tanpa batas saldo",
  kyc_rejected: () => "KYC ditolak — ajukan ulang dengan dokumen valid",
};

function labelFor(templateKey: string, payload: Record<string, unknown> | null): string {
  const tpl = TEMPLATE_LABEL[templateKey];
  if (tpl) return tpl(payload);
  return `Aktivitas baru (${templateKey})`;
}

export default function Notifications() {
  return (
    <RequireAuth>
      <NotificationsInner />
    </RequireAuth>
  );
}

function NotificationsInner() {
  const qc = useQueryClient();
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["notifications"],
    queryFn: () => api.notifications(50),
    refetchInterval: 60_000,
  });
  const markAll = useMutation({
    mutationFn: () => api.markAllRead(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });
  const markOne = useMutation({
    mutationFn: (id: string) => api.markRead(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });
  if (isLoading)
    return (
      <div className="muted" style={{ padding: 24, textAlign: "center" }}>
        Memuat…
      </div>
    );
  if (isError)
    return (
      <div className="card card-pad">
        <span className="eyebrow">Notifikasi</span>
        <p className="muted od-mt-8">Gagal memuat notifikasi.</p>
        <button className="btn-ghost" onClick={() => refetch()}>
          Coba lagi
        </button>
      </div>
    );
  const list = data?.notifications ?? [];
  const unreadCount = list.filter((n) => n.readAt == null).length;
  return (
    <div className="page-stack">
      <section className="page-hero" aria-label="Header halaman Notifikasi">
        <div className="page-hero-rail">
          <span className="rail-channel">CH:15 / SIGNAL</span>
          <span className="rail-dot" aria-hidden="true" />
          <span className="rail-sep">·</span>
          <span className="rail-extra">INBOX FEED</span>
          <span className="rail-time" aria-label="Siap">
            <span className="rail-cursor" aria-hidden="true" />
          </span>
        </div>
        <div className="page-hero-inner">
          <div className="page-hero-copy">
            <div className="page-hero-sub">Notifikasi</div>
            <h1 className="page-hero-title">
              Inbox <em>{unreadCount > 0 ? `· ${unreadCount} belum dibaca` : ""}</em>
            </h1>
          </div>
          {unreadCount > 0 && (
            <button className="btn-ghost od-hero-cta" onClick={() => markAll.mutate()} disabled={markAll.isPending}>
              {markAll.isPending ? "Memproses…" : "Tandai semua dibaca"}
            </button>
          )}
        </div>
      </section>
      {list.length === 0 ? (
        <div className="card card-pad muted od-empty">Belum ada notifikasi. Update dari raffle, bid, dan order akan muncul di sini.</div>
      ) : (
        <div className="od-feed">
          {list.map((n) => {
            const unread = n.readAt == null;
            const link = deepLinkFor(n.templateKey, n.payload);
            const label = labelFor(n.templateKey, n.payload);
            // DOM benar: tombol mark-read tidak boleh nest di dalam <a> —
            // HTML invalid dan kliknya ikut navigasi. Kartu jadi container
            // polos; cover link stretch menutupi seluruh item (pola
            // "stretched link") sementara tombol jadi sibling ber-z-index
            // di atasnya, jadi klik tombol = mark read saja.
            return (
              <div key={n.id} className={`card card-pad od-item${unread ? " is-unread" : ""}`}>
                <div className="od-item-head">
                  <div className="od-item-title">{label}</div>
                  <div className="od-item-time">
                    {new Date(n.createdAt).toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" })}
                  </div>
                </div>
                {unread && (
                  <div className="od-item-actions">
                    <button
                      type="button"
                      className="od-mark-read"
                      style={{ position: "relative", zIndex: 1 }}
                      onClick={() => markOne.mutate(n.id)}
                    >
                      Tandai dibaca
                    </button>
                  </div>
                )}
                {link && (
                  <Link
                    to={link}
                    className="od-item-cover"
                    style={{ position: "absolute", inset: 0, borderRadius: "inherit" }}
                    aria-label={label}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function deepLinkFor(templateKey: string, payload: Record<string, unknown> | null): string | null {
  const cardId = (payload?.cardId ?? payload?.card_id) as string | undefined;
  const orderId = (payload?.orderId ?? payload?.order_id) as string | undefined;
  if (cardId) return `/cards/${cardId}`;
  if (orderId) return `/orders/${orderId}`;
  if (templateKey === "kyc_approved" || templateKey === "kyc_rejected") return "/me/kyc";
  if (templateKey === "payout_disbursed" || templateKey === "payout_failed") return "/wallet";
  if (templateKey === "draw_winner") return "/orders";
  if (templateKey === "shipment_shipped" || templateKey === "shipment_delivered") return "/orders";
  return null;
}

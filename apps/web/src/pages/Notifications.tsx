import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { PageHero } from "../components/PageHero";
import { RequireAuth } from "../components/RequireAuth";
import { api } from "../lib/api";
import "./orders.css";

// P0-3 (audit 2026-08-24): inbox halaman. Server returns templateKey + payload;
// render label generik per templateKey sampai admin/kreator mengirim template
// riil. Tombol "Tandai semua" idempotent.
const TEMPLATE_LABEL: Record<string, (p: Record<string, unknown> | null) => string> = {
  bid_outbid: (p) => `Ada penawaran yang lebih tinggi. Penawaran tertinggi sekarang ${p?.newBid ?? "?"} C`,
  bid_accepted: (p) => `Penawaranmu sebesar ${p?.amount ?? "?"} C diterima`,
  bid_received: (p) => `Penawaran baru ${p?.amount ?? "?"} C dari ${p?.bidderName ?? "?"}`,
  card_bought: (p) => `C.Card kamu dibeli di ${p?.amount ?? "?"} C`,
  draw_winner: () => "Kamu terpilih dalam Raffle — pesanan dibuat",
  draw_loser: () => "Kamu belum terpilih dalam Raffle — C-Coin dikembalikan",
  payout_disbursed: (p) => `Penarikan ${p?.amount ?? "?"} C diteruskan ke rekening`,
  payout_failed: (p) =>
    p?.status === "refunded" ? "C-Gems dari penarikan dikembalikan ke saldo — cek Dompet" : "Penarikan gagal — cek Dompet",
  shipment_shipped: () => "C.Card dalam pengiriman",
  shipment_delivered: () => "C.Card sudah diterima",
  kyc_approved: () => "Verifikasi identitas disetujui. Kamu bisa mengajukan penarikan C-Gems melalui Dompet.",
  kyc_rejected: () => "Verifikasi identitas ditolak — ajukan ulang dengan dokumen yang sesuai",
};

function labelFor(templateKey: string, payload: Record<string, unknown> | null): string {
  const tpl = TEMPLATE_LABEL[templateKey];
  if (tpl) return tpl(payload);
  return "Ada pembaruan pada akunmu";
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
      <PageHero
        channel="15"
        channelLabel="NOTIFIKASI"
        title="Notifikasi"
        desc={unreadCount > 0 ? `${unreadCount} belum dibaca` : undefined}
        actions={
          unreadCount > 0 ? (
            <button className="btn-ghost od-hero-cta" onClick={() => markAll.mutate()} disabled={markAll.isPending}>
              {markAll.isPending ? "Memproses…" : "Tandai semua dibaca"}
            </button>
          ) : null
        }
      />
      {list.length === 0 ? (
        <div className="card card-pad muted od-empty">
          Belum ada notifikasi. Pembaruan Raffle, penawaran, dan pesanan akan muncul di sini.
        </div>
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

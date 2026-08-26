import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { RequireAuth } from "../components/RequireAuth";
import { api } from "../lib/api";

// P0-3 (audit 2026-08-24): inbox halaman. Server returns templateKey + payload;
// render label generik per templateKey sampai admin/kreator mengirim template
// riil. Tombol "Tandai semua" idempotent.
const TEMPLATE_LABEL: Record<string, (p: Record<string, unknown> | null) => string> = {
  bid_outbid: (p) => `Tawaranmu di-outbid. Tertinggi baru ${p?.newBid ?? "?"} C`,
  bid_accepted: (p) => `Tawaranmu diterima di ${p?.amount ?? "?"} C`,
  card_bought: (p) => `C.Card kamu dibeli di ${p?.amount ?? "?"} C`,
  draw_winner: () => "Kamu menang raffle — order dibuat",
  draw_loser: () => "Kamu kalah raffle — C-Coin dikembalikan",
  payout_disbursed: (p) => `Payout ${p?.amount ?? "?"} C diteruskan ke rekening`,
  payout_failed: () => "Payout gagal — cek menu Payout di profil",
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
        <p className="muted" style={{ marginTop: 8 }}>
          Gagal memuat notifikasi.
        </p>
        <button className="btn-ghost" onClick={() => refetch()}>
          Coba lagi
        </button>
      </div>
    );
  const list = data?.notifications ?? [];
  const unreadCount = list.filter((n) => n.readAt == null).length;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 12 }}>
        <div>
          <span className="eyebrow">Notifikasi</span>
          <h1 className="h2" style={{ marginTop: 4 }}>
            Inbox{" "}
            <em style={{ fontStyle: "italic", fontWeight: 300, color: "var(--gold)" }}>
              {unreadCount > 0 ? `· ${unreadCount} belum dibaca` : ""}
            </em>
          </h1>
        </div>
        {unreadCount > 0 && (
          <button
            className="btn-ghost"
            onClick={() => markAll.mutate()}
            disabled={markAll.isPending}
            style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}
          >
            {markAll.isPending ? "Memproses…" : "Tandai semua dibaca"}
          </button>
        )}
      </div>
      {list.length === 0 ? (
        <div className="card card-pad muted" style={{ textAlign: "center", padding: 32 }}>
          Belum ada notifikasi. Update dari raffle, bid, dan order akan muncul di sini.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {list.map((n) => {
            const unread = n.readAt == null;
            const link = deepLinkFor(n.templateKey, n.payload);
            const Inner = (
              <div key={n.id} className="card card-pad" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                  <div style={{ fontWeight: unread ? 700 : 500, fontSize: 13 }}>{labelFor(n.templateKey, n.payload)}</div>
                  <div
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 11,
                      color: "var(--text-dim)",
                      flexShrink: 0,
                    }}
                  >
                    {new Date(n.createdAt).toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" })}
                  </div>
                </div>
                {unread && (
                  <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                    <button
                      onClick={() => markOne.mutate(n.id)}
                      style={{
                        background: "transparent",
                        border: "1px solid var(--border)",
                        borderRadius: 6,
                        padding: "4px 10px",
                        fontSize: 11,
                        fontFamily: "var(--font-mono)",
                        color: "var(--text-muted)",
                        cursor: "pointer",
                      }}
                    >
                      Tandai dibaca
                    </button>
                  </div>
                )}
              </div>
            );
            return link ? (
              <Link key={`link-${n.id}`} to={link} style={{ textDecoration: "none", color: "inherit" }}>
                {Inner}
              </Link>
            ) : (
              Inner
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

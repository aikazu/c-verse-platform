import type { Order } from "@c-verse/shared";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { StatusBadge } from "../components/StatusBadge";
import { api } from "../lib/api";
import type { ApiOrdersResponse } from "../lib/api-types";
import { useAuth } from "../lib/auth";
import { ErrorState, LoadingState } from "../lib/QueryStates";

export default function Orders() {
  const { user } = useAuth();
  const { data, isLoading, isError, refetch } = useQuery<ApiOrdersResponse>({
    queryKey: ["orders"],
    queryFn: () => api.orders(),
    enabled: !!user,
  });
  if (!user)
    return (
      <div className="card card-pad" style={{ textAlign: "center", padding: 32 }}>
        <span className="eyebrow">Pesanan</span>
        <p className="muted" style={{ marginTop: 8 }}>
          Masuk untuk melihat pesanan
        </p>
        <Link to="/login" style={{ color: "var(--gold)", fontSize: 13, fontWeight: 600, marginTop: 10, display: "inline-block" }}>
          Masuk →
        </Link>
      </div>
    );
  if (isLoading) return <LoadingState />;
  if (isError) return <ErrorState onRetry={() => refetch()} label="Gagal memuat pesanan" />;
  const orders: Order[] = data?.orders ?? [];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 12 }}>
        <div>
          <span className="eyebrow">Pesanan</span>
          <h1 className="h2" style={{ marginTop: 4 }}>
            Daftar <em style={{ fontStyle: "italic", fontWeight: 300, color: "var(--gold)" }}>Pesanan</em>
          </h1>
        </div>
        <Link to="/drops" className="btn-ghost" style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>
          Jelajahi Drops →
        </Link>
      </div>
      <div className="card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th style={{ fontFamily: "var(--font-mono)" }}>Order</th>
                <th>Drop</th>
                <th>Total</th>
                <th>Status</th>
                <th>Opsi</th>
              </tr>
            </thead>
            <tbody>
              {orders.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    style={{ textAlign: "center", padding: 24, color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: 12 }}
                  >
                    Belum ada pesanan
                  </td>
                </tr>
              ) : (
                orders.map((o) => (
                  <tr key={o.id}>
                    <td>
                      <Link
                        to={`/orders/${o.id}`}
                        style={{ color: "var(--gold)", fontSize: 12, fontFamily: "var(--font-mono)", fontWeight: 500 }}
                      >
                        {o.id.slice(0, 12)}
                      </Link>
                    </td>
                    <td style={{ fontSize: 12, color: "var(--text-muted)" }}>{o.dropId}</td>
                    <td style={{ fontWeight: 700, fontFamily: "var(--font-mono)", fontSize: 12 }}>{o.totalCCoin} C</td>
                    <td>
                      <StatusBadge status={o.status} kind="order" style={{ fontSize: 10 }} />
                    </td>
                    <td style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-muted)" }}>
                      {o.deliveryOption ?? (o.shippingAddress ? "kirim" : "vault")}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

import type { Order } from "@c-verse/shared";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { RequireAuth } from "../components/RequireAuth";
import { StatusBadge } from "../components/StatusBadge";
import { api } from "../lib/api";
import type { ApiOrdersResponse } from "../lib/api-types";
import { useAuth } from "../lib/auth";
import { ErrorState, LoadingState } from "../lib/QueryStates";
import "./orders.css";

export default function Orders() {
  return (
    <RequireAuth>
      <OrdersInner />
    </RequireAuth>
  );
}

function OrdersInner() {
  const { user } = useAuth();
  const { data, isLoading, isError, refetch } = useQuery<ApiOrdersResponse>({
    queryKey: ["orders"],
    queryFn: () => api.orders(),
    enabled: !!user,
  });
  if (isLoading) return <LoadingState />;
  if (isError) return <ErrorState onRetry={() => refetch()} label="Gagal memuat pesanan" />;
  const orders: Order[] = data?.orders ?? [];
  return (
    <div className="page-stack">
      <section className="page-hero" aria-label="Header halaman Pesanan">
        <div className="page-hero-rail">
          <span className="rail-channel">CH:13 / ORDERS</span>
          <span className="rail-dot" aria-hidden="true" />
          <span className="rail-sep">·</span>
          <span className="rail-extra">ORDER LOG</span>
          <span className="rail-time" aria-label="Siap">
            <span className="rail-cursor" aria-hidden="true" />
          </span>
        </div>
        <div className="page-hero-inner">
          <div className="page-hero-copy">
            <div className="page-hero-sub">Pesanan</div>
            <h1 className="page-hero-title">
              Daftar <em>Pesanan</em>
            </h1>
          </div>
          <Link to="/drops" className="btn-ghost od-hero-cta">
            Jelajahi Drops →
          </Link>
        </div>
      </section>
      <div className="card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Order</th>
                <th>Drop</th>
                <th>Total</th>
                <th>Status</th>
                <th>Opsi</th>
              </tr>
            </thead>
            <tbody>
              {orders.length === 0 ? (
                <tr>
                  <td colSpan={5} className="od-empty-cell">
                    Belum ada pesanan
                  </td>
                </tr>
              ) : (
                orders.map((o) => (
                  <tr key={o.id}>
                    <td>
                      <Link to={`/orders/${o.id}`} className="od-order-link">
                        {o.id.slice(0, 12)}
                      </Link>
                    </td>
                    <td className="od-td-muted">{o.dropId}</td>
                    <td className="od-td-total">{o.totalCCoin} C</td>
                    <td>
                      <StatusBadge status={o.status} kind="order" style={{ fontSize: 10 }} />
                    </td>
                    <td className="od-td-opt">{o.deliveryOption ?? (o.shippingAddress ? "kirim" : "vault")}</td>
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

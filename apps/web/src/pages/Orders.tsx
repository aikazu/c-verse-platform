import type { Order } from "@c-verse/shared";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { PageHero } from "../components/PageHero";
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
      <PageHero
        channel="13A"
        channelLabel="PESANAN"
        title="Pesanan"
        actions={
          <Link to="/drops" className="btn-ghost od-hero-cta">
            Jelajahi Drops →
          </Link>
        }
      />
      <div className="card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Pesanan</th>
                <th>Drops</th>
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
                        {/* Label manusiawi + tanggal — UUID tidak boleh tampil sebagai teks */}
                        Pesanan · {new Date(o.createdAt).toLocaleDateString("id-ID")}
                      </Link>
                    </td>
                    {/* Payload list tidak membawa judul drop — fallback netral, bukan dropId */}
                    <td className="od-td-muted">Tanpa judul</td>
                    <td className="od-td-total">{o.totalCCoin} C</td>
                    <td>
                      <StatusBadge status={o.status} kind="order" style={{ fontSize: 10 }} />
                    </td>
                    <td className="od-td-opt">{o.deliveryOption === "vault" || !o.shippingAddress ? "Vault" : "Kirim fisik"}</td>
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

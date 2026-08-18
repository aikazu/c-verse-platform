import { useInfiniteQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { api, formatIdr } from "../lib/api";

function Badge({ status }: { status: string }) {
  const map: Record<string, string> = {
    live: "badge-live",
    scheduled: "badge-scheduled",
    draft: "badge-ended",
    published: "badge-live",
    sold_out: "badge-ended",
    closed: "badge-ended",
  };
  const label: Record<string, string> = {
    live: "Live",
    scheduled: "Segera",
    draft: "Draft",
    published: "Live",
    sold_out: "Habis",
    closed: "Closed",
  };
  return <span className={`drop-badge ${map[status] || "badge-ended"}`}>{label[status] || status}</span>;
}

export default function Drops() {
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const { data, isLoading, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
    queryKey: ["drops", filter, search],
    queryFn: ({ pageParam }) =>
      api.drops({ ...(filter !== "all" ? { status: filter } : {}), ...(search ? { search } : {}), limit: "60", offset: String(pageParam) }),
    initialPageParam: 0,
    getNextPageParam: (last) => (last.hasMore ? last.offset + last.limit : undefined),
  });
  const drops: any[] = data?.pages.flatMap((p) => p.drops ?? []) ?? [];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 12 }}>
        <div>
          <span className="eyebrow">Koleksi</span>
          <h1 className="h2" style={{ marginTop: 4 }}>
            Drops
          </h1>
          <p className="muted" style={{ marginTop: 6 }}>
            Koleksi terbatas dari kreator pilihan
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input
            className="input"
            placeholder="Cari seri atau judul…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: 210 }}
          />
          <select className="select" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ width: 140 }}>
            <option value="all">Semua</option>
            <option value="live">Live</option>
            <option value="scheduled">Segera</option>
            <option value="closed">Ended</option>
          </select>
          <button className="btn-ghost" onClick={() => refetch()} style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>
            Refresh
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="muted" style={{ padding: 24, textAlign: "center" }}>
          Memuat…
        </div>
      ) : !drops.length ? (
        <div className="card card-pad muted" style={{ textAlign: "center", padding: 32 }}>
          Belum ada drop untuk filter ini
        </div>
      ) : (
        <div className="grid-3">
          {drops.map((d: any) => (
            <Link key={d.id} to={`/drops/${d.id}`} className="card drop-card">
              <div className="drop-thumb">
                <Badge status={d.status} />
                <span style={{ fontSize: 42 }}>🎴</span>
              </div>
              <div className="card-pad">
                <div
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 10,
                    fontWeight: 500,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    color: "var(--gold)",
                  }}
                >
                  {d.series}
                </div>
                <div style={{ fontWeight: 700, marginTop: 4, fontSize: 14 }}>{d.title}</div>
                <div
                  className="muted"
                  style={{
                    fontSize: 12,
                    marginTop: 6,
                    display: "-webkit-box",
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                    lineHeight: 1.6,
                  }}
                >
                  {d.narrative}
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 14, gap: 12 }}>
                  <div>
                    <div
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: 10,
                        color: "var(--text-dim)",
                        fontWeight: 500,
                        letterSpacing: "0.08em",
                      }}
                    >
                      HARGA
                    </div>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>
                      {d.priceCcoin ?? d.priceUnsignedCCoin} C{" "}
                      <span style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 400 }}>
                        · {formatIdr(d.idrPrice ?? d.idrUnsigned)}
                      </span>
                    </div>
                  </div>
                  <div style={{ textAlign: "right", minWidth: 80 }}>
                    <div
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: 10,
                        color: "var(--text-dim)",
                        fontWeight: 500,
                        letterSpacing: "0.08em",
                      }}
                    >
                      TERJUAL
                    </div>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>
                      {d.soldCount}/{d.totalUnits}
                    </div>
                    <div className="progress" style={{ width: 72, marginTop: 6, height: 4 }}>
                      <div className="progress-fill" style={{ width: `${Math.round((d.soldCount / d.totalUnits) * 100)}%` }} />
                    </div>
                  </div>
                </div>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-dim)", marginTop: 12 }}>
                  oleh {d.creatorName}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
      {hasNextPage && (
        <button className="btn-ghost" onClick={() => fetchNextPage()} disabled={isFetchingNextPage} style={{ alignSelf: "center" }}>
          {isFetchingNextPage ? "Memuat…" : "Muat lagi"}
        </button>
      )}
    </div>
  );
}

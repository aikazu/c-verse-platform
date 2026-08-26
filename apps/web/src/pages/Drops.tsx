import { useInfiniteQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, formatIdr } from "../lib/api";
import type { ApiDrop, ApiDropsResponse } from "../lib/api-types";
import { ErrorState, LoadingState } from "../lib/QueryStates";

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

/**
 * P1-9 (audit 2026-08-24): phase derivation dari backend fields.
 * Backend mengirim `dropStartAt`, `raffleEndAt`, `drawnAt`, `soldCount`,
 * `totalUnits`, `status` — combine untuk 5 fase UI:
 *   - upcoming : dropStart > now
 *   - raffle   : live (status) && now < raffleEndAt && !drawnAt
 *   - drawing  : live && raffleEnd elapsed && !drawnAt (cron belum jalan)
 *   - fcfs     : live && drawnAt && remaining > 0
 *   - ended    : status ended atau remaining = 0
 */
type Phase = "upcoming" | "raffle" | "drawing" | "fcfs" | "ended";

function phase(d: ApiDrop, now: number): Phase {
  const remaining = d.totalUnits - d.soldCount;
  const dropStart = d.dropStartAt ?? d.dropAt ?? null;
  if (dropStart && new Date(dropStart).getTime() > now) return "upcoming";
  if (d.drawnAt) {
    return remaining <= 0 || d.status === "sold_out" || d.status === "closed" || d.status === "cancelled" ? "ended" : "fcfs";
  }
  if (d.raffleEndAt && new Date(d.raffleEndAt).getTime() <= now) return "drawing";
  if (d.status === "live" || d.status === "published") return "raffle";
  return "ended";
}

const PHASE_LABEL: Record<Phase, string> = {
  upcoming: "Akan Datang",
  raffle: "Raffle",
  drawing: "Draw Soon",
  fcfs: "FCFS",
  ended: "Selesai",
};

const PHASE_PILL: Record<Phase, string> = {
  upcoming: "pill-info",
  raffle: "pill-warn",
  drawing: "pill-warn",
  fcfs: "pill-success",
  ended: "",
};

export default function Drops() {
  const [filter, setFilter] = useState<"all" | Phase>("all");
  const [search, setSearch] = useState("");
  // Refresh tiap 60 detik agar raffleEndAt / drawnAt ter-update → phase derivation akurat.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  const { data, isLoading, isError, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery<ApiDropsResponse>({
    queryKey: ["drops", search],
    queryFn: ({ pageParam }) => api.drops({ ...(search ? { search } : {}), limit: "60", offset: String(pageParam) }),
    initialPageParam: 0,
    getNextPageParam: (last) => (last.hasMore ? last.offset + last.limit : undefined),
    refetchInterval: 60_000,
  });
  const allDrops: ApiDrop[] = (data?.pages ?? []).flatMap((p) => p.drops ?? []);
  const drops: ApiDrop[] = filter === "all" ? allDrops : allDrops.filter((d) => phase(d, now) === filter);
  void now; // dipakai phase() + Refetch interval
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
            aria-label="Cari drop"
            placeholder="Cari seri atau judul…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: 210 }}
          />
          <select
            className="select"
            aria-label="Filter fase drop"
            value={filter}
            onChange={(e) => setFilter(e.target.value as Phase | "all")}
            style={{ width: 160 }}
          >
            <option value="all">Semua</option>
            <option value="upcoming">{PHASE_LABEL.upcoming}</option>
            <option value="raffle">{PHASE_LABEL.raffle}</option>
            <option value="drawing">{PHASE_LABEL.drawing}</option>
            <option value="fcfs">{PHASE_LABEL.fcfs}</option>
            <option value="ended">{PHASE_LABEL.ended}</option>
          </select>
          <button className="btn-ghost" onClick={() => refetch()} style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>
            Refresh
          </button>
        </div>
      </div>

      {isLoading ? (
        <LoadingState />
      ) : isError ? (
        <ErrorState onRetry={() => refetch()} label="Gagal memuat drop" />
      ) : !drops.length ? (
        <div className="card card-pad muted" style={{ textAlign: "center", padding: 32 }}>
          Belum ada drop untuk filter ini
        </div>
      ) : (
        <div className="grid-3">
          {drops.map((d) => {
            const ph = phase(d, now);
            return (
              <Link key={d.id} to={`/drops/${d.id}`} className="card drop-card">
                <div className="drop-thumb">
                  <Badge status={d.status} />
                  <span className={`pill ${PHASE_PILL[ph]}`} style={{ marginLeft: 6, fontSize: 10 }}>
                    {PHASE_LABEL[ph]}
                  </span>
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
                          · {formatIdr(d.idrPrice ?? d.idrUnsigned ?? 0)}
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
            );
          })}
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

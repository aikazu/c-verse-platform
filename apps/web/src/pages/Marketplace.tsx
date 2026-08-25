import { useInfiniteQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api, formatIdr } from "../lib/api";
import type { ApiListingsResponse, ApiMarketplaceEntry } from "../lib/api-types";
import { ErrorState, LoadingState } from "../lib/QueryStates";

export default function Marketplace() {
  const { data, isLoading, isError, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
    queryKey: ["marketplace"],
    queryFn: ({ pageParam }) => api.listings({ limit: "60", offset: String(pageParam) }),
    initialPageParam: 0,
    getNextPageParam: (last) => (last.hasMore ? last.offset + last.limit : undefined),
  });
  // Endpoint returns the same shape under `marketplace` / `cards` / `listings`
  // (compat aliases — see apps/api/src/routes/marketplace.ts:68). Read whichever
  // the server fills; first non-empty wins.
  const pages = data?.pages ?? [];
  const cards: ApiMarketplaceEntry[] = pages
    .flatMap((p: ApiListingsResponse) => p.marketplace ?? p.cards ?? p.listings ?? [])
    .filter((entry): entry is ApiMarketplaceEntry => entry?.kind === "buyout");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 12 }}>
        <div>
          <span className="eyebrow">Pasar Sekunder</span>
          <h1 className="h2" style={{ marginTop: 4 }}>
            Marketplace
          </h1>
          <p className="muted" style={{ marginTop: 6 }}>
            C.Card yang dijual pemiliknya
          </p>
        </div>
        <button className="btn-ghost" onClick={() => refetch()} style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>
          Refresh
        </button>
      </div>
      {isLoading ? (
        <LoadingState />
      ) : isError ? (
        <ErrorState onRetry={() => refetch()} label="Gagal memuat marketplace" />
      ) : cards.length === 0 ? (
        <div className="card card-pad muted" style={{ textAlign: "center", padding: 32 }}>
          Belum ada C.Card dijual — pasang harga dari{" "}
          <Link to="/me/manage" style={{ color: "var(--gold)", fontWeight: 600 }}>
            Kelola C.Card
          </Link>
        </div>
      ) : (
        <div className="grid-3">
          {cards.map((entry) => {
            const card = entry.card;
            const drop = entry.drop;
            const price = entry.buyoutPriceCcoin ?? 0;
            return (
              <Link
                key={card.id}
                to={card?.id ? `/cards/${card.id}` : "/browse"}
                className="card"
                style={{ overflow: "hidden", textDecoration: "none", color: "inherit" }}
              >
                <div
                  style={{
                    height: 140,
                    background: "var(--thumb-grad)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 36,
                  }}
                >
                  🃏
                </div>
                <div style={{ padding: 14 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>
                    {drop?.title ?? card.id} · #{card.unitNumber ?? "?"}
                  </div>
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-muted)" }}>{drop?.series ?? ""}</div>
                  {drop?.isSeed && (
                    <span className="badge-seed" style={{ alignSelf: "start", marginTop: 6 }}>
                      ✦ Seed 1-of-1
                    </span>
                  )}
                  <div style={{ marginTop: 10, display: "flex", alignItems: "baseline", gap: 6 }}>
                    <span style={{ fontWeight: 700, fontSize: 15 }}>{price} C</span>
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-muted)" }}>
                      · {formatIdr(price * 10000)}
                    </span>
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

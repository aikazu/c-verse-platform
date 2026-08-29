import { useInfiniteQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, ccoinToIdr, formatIdr } from "../lib/api";
import type { ApiListingsResponse, ApiMarketplaceEntry } from "../lib/api-types";
import { ErrorState, LoadingState } from "../lib/QueryStates";

type SortKey = "cheapest" | "expensive" | "unit";

function getInitials(source: string | null | undefined, fallback: string): string {
  const text = (source ?? "").trim();
  if (!text) return fallback.slice(0, 2).toUpperCase();
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return fallback.slice(0, 2).toUpperCase();
  const first = words[0]?.[0] ?? "";
  const last = words.length > 1 ? (words[words.length - 1]?.[0] ?? "") : (words[0]?.[1] ?? "");
  return `${first}${last}`.toUpperCase().slice(0, 2) || fallback.slice(0, 2).toUpperCase();
}

export default function Marketplace() {
  const [sort, setSort] = useState<SortKey>("cheapest");
  const [search, setSearch] = useState("");
  const { data, isLoading, isError, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery<ApiListingsResponse>({
    queryKey: ["marketplace", sort, search],
    queryFn: ({ pageParam }) =>
      api.listings({
        limit: "60",
        offset: String(pageParam),
        ...(search ? { search } : {}),
      }),
    initialPageParam: 0,
    getNextPageParam: (last) => (last.hasMore ? last.offset + last.limit : undefined),
  });
  // Endpoint returns the same shape under `marketplace` / `cards` / `listings`
  // (compat aliases — see apps/api/src/modules/marketplace/routes.ts:68). Read whichever
  // the server fills; first non-empty wins.
  const pages = data?.pages ?? [];
  const rawCards: ApiMarketplaceEntry[] = pages
    .flatMap((p: ApiListingsResponse) => p.marketplace ?? p.cards ?? p.listings ?? [])
    .filter((entry): entry is ApiMarketplaceEntry => entry?.kind === "buyout");

  // Floor rank is ALWAYS price-ascending regardless of the active sort.
  // Stable mapping: cardId -> 1-based floor position.
  const floorRank = useMemo(() => {
    const asc = [...rawCards].sort((a, b) => (a.buyoutPriceCcoin ?? 0) - (b.buyoutPriceCcoin ?? 0));
    const map = new Map<string, number>();
    asc.forEach((entry, i) => {
      map.set(entry.card.id, i + 1);
    });
    return map;
  }, [rawCards]);

  // Marketplace API tidak support sort param eksplisit — sort client-side setelah load.
  const cards = useMemo(() => {
    const arr = [...rawCards];
    if (sort === "expensive") {
      arr.sort((a, b) => (b.buyoutPriceCcoin ?? 0) - (a.buyoutPriceCcoin ?? 0));
    } else if (sort === "unit") {
      arr.sort((a, b) => (a.card.unitNumber ?? 0) - (b.card.unitNumber ?? 0));
    } else {
      arr.sort((a, b) => (a.buyoutPriceCcoin ?? 0) - (b.buyoutPriceCcoin ?? 0));
    }
    return arr;
  }, [rawCards, sort]);

  const totalListed = rawCards.length;
  const cheapest =
    rawCards.length > 0
      ? ([...rawCards].sort((a, b) => (a.buyoutPriceCcoin ?? 0) - (b.buyoutPriceCcoin ?? 0))[0]?.buyoutPriceCcoin ?? null)
      : null;
  const sortedByPrice = useMemo(() => [...rawCards].sort((a, b) => (a.buyoutPriceCcoin ?? 0) - (b.buyoutPriceCcoin ?? 0)), [rawCards]);
  const medianPrice = sortedByPrice.length > 0 ? (sortedByPrice[Math.floor(sortedByPrice.length / 2)]?.buyoutPriceCcoin ?? null) : null;
  const highest = sortedByPrice.length > 0 ? (sortedByPrice[sortedByPrice.length - 1]?.buyoutPriceCcoin ?? null) : null;
  const floorTitle = sortedByPrice[0]?.drop?.title ?? sortedByPrice[0]?.card.id ?? null;

  return (
    <div className="page-stack">
      <section className="page-hero" aria-label="Header halaman Marketplace">
        <div className="page-hero-rail">
          <span className="rail-channel">CH:02 / MARKET</span>
          <span className="rail-dot" aria-hidden="true" />
          <span className="rail-sep">·</span>
          <span className="rail-extra">TRADING FLOOR OPEN</span>
          <span className="rail-time" aria-label="Siap">
            <span className="rail-cursor" aria-hidden="true" />
          </span>
        </div>
        <div className="page-hero-inner">
          <div className="page-hero-copy">
            <h1 className="page-hero-title">Marketplace</h1>
          </div>
        </div>
        <div className="hero-ticker" aria-hidden="true">
          <span className="ticker-label">Order Book</span>
          <div className="ticker-track">
            <div className="ticker-scroll">
              <span className="ticker-item">
                <span className="tk-key">LISTING</span>
                <span className="tk-val cyan">{totalListed}</span>
              </span>
              <span className="ticker-item">
                <span className="tk-sep" aria-hidden="true" />
              </span>
              <span className="ticker-item">
                <span className="tk-key">TERMURAH</span>
                <span className="tk-val">{cheapest ?? "—"} C</span>
              </span>
              <span className="ticker-item">
                <span className="tk-sep" aria-hidden="true" />
              </span>
              <span className="ticker-item">
                <span className="tk-key">MEDIAN</span>
                <span className="tk-val magenta">{medianPrice ?? "—"} C</span>
              </span>
              <span className="ticker-item">
                <span className="tk-sep" aria-hidden="true" />
              </span>
              <span className="ticker-item">
                <span className="tk-key">TERMAHAL</span>
                <span className="tk-val">{highest ?? "—"} C</span>
              </span>
              <span className="ticker-item">
                <span className="tk-sep" aria-hidden="true" />
              </span>
              {floorTitle && (
                <span className="ticker-item">
                  <span className="tk-key">LANTAI</span>
                  <span className="tk-val magenta">{floorTitle}</span>
                </span>
              )}
              <span className="ticker-item">
                <span className="tk-sep" aria-hidden="true" />
              </span>
              {/* duplicate for seamless marquee loop */}
              <span className="ticker-item">
                <span className="tk-key">LISTING</span>
                <span className="tk-val cyan">{totalListed}</span>
              </span>
              <span className="ticker-item">
                <span className="tk-sep" aria-hidden="true" />
              </span>
              <span className="ticker-item">
                <span className="tk-key">TERMURAH</span>
                <span className="tk-val">{cheapest ?? "—"} C</span>
              </span>
              <span className="ticker-item">
                <span className="tk-sep" aria-hidden="true" />
              </span>
              <span className="ticker-item">
                <span className="tk-key">MEDIAN</span>
                <span className="tk-val magenta">{medianPrice ?? "—"} C</span>
              </span>
              <span className="ticker-item">
                <span className="tk-sep" aria-hidden="true" />
              </span>
              <span className="ticker-item">
                <span className="tk-key">TERMAHAL</span>
                <span className="tk-val">{highest ?? "—"} C</span>
              </span>
              {floorTitle && (
                <>
                  <span className="ticker-item">
                    <span className="tk-sep" aria-hidden="true" />
                  </span>
                  <span className="ticker-item">
                    <span className="tk-key">LANTAI</span>
                    <span className="tk-val magenta">{floorTitle}</span>
                  </span>
                </>
              )}
            </div>
          </div>
        </div>
      </section>

      <div className="toolbar" role="search">
        <input
          className="input"
          aria-label="Cari marketplace"
          placeholder="Cari judul atau seri…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select className="select" aria-label="Urutkan listing" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
          <option value="cheapest">Termurah</option>
          <option value="expensive">Termahal</option>
          <option value="unit">Unit #</option>
        </select>
        <div className="toolbar-right">
          <button className="refresh-btn" onClick={() => refetch()} aria-label="Refresh marketplace" type="button">
            <span className="dot" aria-hidden="true" />
            Refresh
          </button>
          <Link to="/me/manage" className="btn-ghost toolbar-sell">
            Jual C.Card
          </Link>
        </div>
      </div>

      {isLoading ? (
        <LoadingState />
      ) : isError ? (
        <ErrorState onRetry={() => refetch()} label="Gagal memuat marketplace" />
      ) : cards.length === 0 ? (
        <div className="empty-arcade">
          <div className="empty-icon" aria-hidden="true">
            NO_LISTINGS
          </div>
          <div className="empty-title">Belum ada C.Card dijual</div>
          <p className="empty-msg">Pasang harga dari Kelola C.Card untuk mulai menawarkan koleksimu.</p>
          <div className="empty-cta">
            <Link to="/me/manage" className="btn-gold">
              Pasang Listing →
            </Link>
          </div>
        </div>
      ) : (
        <div className="grid-3">
          {cards.map((entry) => {
            const card = entry.card;
            const drop = entry.drop;
            const price = entry.buyoutPriceCcoin ?? 0;
            const art = drop?.artworkUrl ? { backgroundImage: `url("${drop.artworkUrl.replace(/"/g, "%22")}")` } : null;
            const rank = floorRank.get(card.id) ?? null;
            const seriesLabel = drop?.series ?? "—";
            const init = getInitials(drop?.title ?? card.id, seriesLabel);
            const sellerName = entry.seller?.displayName ?? "—";
            const detailHref = card?.id ? `/cards/${card.id}#beli` : "/browse";
            const cardKey = `${card.id}-${entry.seller?.id ?? "anon"}`;
            return (
              <Link key={cardKey} to={detailHref} className="card market-card" aria-label={`Beli ${drop?.title ?? card.id}`}>
                <div className="market-art">
                  {art ? <div className="art" style={art} /> : null}
                  {!art && (
                    <div className="art-fallback" data-init={init}>
                      <span className="art-fallback-init" aria-hidden="true">
                        {init}
                      </span>
                    </div>
                  )}
                  {rank !== null && rank <= 3 && (
                    <span className="floor-rank" aria-label={`Peringkat lantai ${rank}`}>
                      LANTAI <span className="floor-num">#{rank}</span>
                    </span>
                  )}
                </div>
                <div className="market-body">
                  <div className="eyebrow">{seriesLabel}</div>
                  <div className="market-title">
                    {drop?.title ?? card.id} <span className="market-unit-suffix">· #{card.unitNumber ?? "?"}</span>
                  </div>
                  <div className="card-pills">
                    {drop?.isSeed && <span className="badge-seed">✦ Seed 1-of-1</span>}
                    {card.variant === "signed" && <span className="pill pill-info">✍ Signed</span>}
                  </div>
                  <div className="seller-row">
                    <span className="seller-dot" aria-hidden="true" />
                    <span className="seller-name">{sellerName}</span>
                  </div>
                  <div className="price-hero">
                    <span className="price-hero-val">
                      {price}
                      <span className="price-hero-unit">C</span>
                    </span>
                    <span className="price-hero-idr">{formatIdr(ccoinToIdr(price))}</span>
                  </div>
                </div>
                <div className="market-cta">
                  <span className="arrow">Beli sekarang →</span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
      {hasNextPage && (
        <button className="btn-ghost load-more" onClick={() => fetchNextPage()} disabled={isFetchingNextPage}>
          {isFetchingNextPage ? "Memuat…" : "Muat lagi"}
        </button>
      )}
    </div>
  );
}

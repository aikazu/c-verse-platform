import { useInfiniteQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { PageHero } from "../components/PageHero";
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

  // Rank loaded cards by ascending price, regardless of the active sort.
  const priceRank = useMemo(() => {
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
  const highest = sortedByPrice.length > 0 ? (sortedByPrice[sortedByPrice.length - 1]?.buyoutPriceCcoin ?? null) : null;

  const heroTicker = (
    <div className="hero-ticker" aria-hidden="true">
      <span className="ticker-label">Ditampilkan</span>
      <div className="ticker-track">
        <div className="ticker-scroll">
          <span className="ticker-item">
            <span className="tk-key">KARTU</span>
            <span className="tk-val cyan">{totalListed}</span>
          </span>
          <span className="ticker-item">
            <span className="tk-sep" aria-hidden="true" />
          </span>
          <span className="ticker-item">
            <span className="tk-key">HARGA TERENDAH</span>
            <span className="tk-val">{cheapest ?? "—"} C</span>
          </span>
          <span className="ticker-item">
            <span className="tk-sep" aria-hidden="true" />
          </span>
          <span className="ticker-item">
            <span className="tk-key">HARGA TERTINGGI</span>
            <span className="tk-val">{highest ?? "—"} C</span>
          </span>
          <span className="ticker-item">
            <span className="tk-sep" aria-hidden="true" />
          </span>
          <span className="ticker-item">
            <span className="tk-key">KARTU</span>
            <span className="tk-val cyan">{totalListed}</span>
          </span>
          <span className="ticker-item">
            <span className="tk-sep" aria-hidden="true" />
          </span>
          <span className="ticker-item">
            <span className="tk-key">HARGA TERENDAH</span>
            <span className="tk-val">{cheapest ?? "—"} C</span>
          </span>
          <span className="ticker-item">
            <span className="tk-sep" aria-hidden="true" />
          </span>
          <span className="ticker-item">
            <span className="tk-key">HARGA TERTINGGI</span>
            <span className="tk-val">{highest ?? "—"} C</span>
          </span>
        </div>
      </div>
    </div>
  );

  return (
    <div className="page-stack">
      <PageHero
        channel="02"
        channelLabel="MARKET"
        title="Marketplace"
        desc="Beli kartu dari kolektor lain dengan harga yang tertera."
        ticker={heroTicker}
      />

      <div className="toolbar" role="search">
        <input
          className="input"
          aria-label="Cari marketplace"
          placeholder="Cari judul atau seri…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select className="select" aria-label="Urutkan kartu" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
          <option value="cheapest">Termurah</option>
          <option value="expensive">Termahal</option>
          <option value="unit">Nomor kartu</option>
        </select>
        <div className="toolbar-right">
          <button className="refresh-btn" onClick={() => refetch()} aria-label="Muat ulang Marketplace" type="button">
            <span className="dot" aria-hidden="true" />
            Muat ulang
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
          <div className="empty-title">{search ? "Kartu tidak ditemukan" : "Belum ada kartu yang dijual"}</div>
          <p className="empty-msg">
            {search ? "Coba kata kunci lain untuk mencari kartu." : "Tentukan harga di Kelola C.Card untuk menjual kartumu."}
          </p>
          <div className="empty-cta">
            <Link to="/me/manage" className="btn-gold">
              Jual C.Card →
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
            const rank = priceRank.get(card.id) ?? null;
            const seriesLabel = drop?.series ?? "—";
            const init = getInitials(drop?.title, seriesLabel);
            const sellerName = entry.seller?.displayName ?? "—";
            const detailHref = card?.id ? `/cards/${card.id}#beli` : "/browse";
            // Lane C: seller.id tidak lagi ada di payload publik — card.id unik per listing.
            const cardKey = card.id;
            return (
              <Link key={cardKey} to={detailHref} className="card market-card" aria-label={`Beli ${drop?.title ?? "C.Card"}`}>
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
                    <span className="floor-rank" aria-label={`Urutan harga termurah dari kartu yang ditampilkan: ${rank}`}>
                      TERMURAH <span className="floor-num">#{rank}</span>
                    </span>
                  )}
                </div>
                <div className="market-body">
                  <div className="eyebrow">{seriesLabel}</div>
                  <div className="market-title">
                    {drop?.title ?? card.id} <span className="market-unit-suffix">· #{card.unitNumber ?? "?"}</span>
                  </div>
                  <div className="card-pills">
                    {drop?.isSeed && <span className="badge-seed">✦ Hanya 1 kartu</span>}
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

import { MAX_ACTIVE_BIDS_PER_USER } from "@c-verse/shared";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { useConfirm } from "../components/ConfirmProvider";
import { api } from "../lib/api";
import type { ApiBrowseEntry, ApiBrowseResponse } from "../lib/api-types";
import { useAuth } from "../lib/auth";
import { ErrorState, LoadingState } from "../lib/QueryStates";
import { useToast } from "../lib/toast";

const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

type SortKey = "default" | "unit_asc" | "unit_desc" | "creator";

export default function Browse() {
  const { user } = useAuth();
  const { push } = useToast();
  const confirm = useConfirm();
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<SortKey>("default");
  const [bidAmt, setBidAmt] = useState<Record<string, number>>({});
  const { data, refetch, isLoading, isError, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery<ApiBrowseResponse>({
    queryKey: ["browse", q, sort],
    queryFn: ({ pageParam }) => {
      const params: Record<string, string> = { limit: "60", offset: String(pageParam) };
      if (q) params.q = q;
      if (sort !== "default") {
        if (sort === "unit_asc") {
          params.sort = "unit_number";
          params.order = "asc";
        } else if (sort === "unit_desc") {
          params.sort = "unit_number";
          params.order = "desc";
        } else if (sort === "creator") {
          // sort by creator belum di-support API; sort client-side sebagai fallback.
        }
      }
      return api.browse(params);
    },
    initialPageParam: 0,
    getNextPageParam: (last) => (last.hasMore ? last.offset + last.limit : undefined),
  });
  // Bids ku — untuk cek batas 3/user (P1-2). profile() mengembalikan bids saya.
  const { data: profileData, refetch: refetchProfile } = useQuery({
    queryKey: ["profile"],
    queryFn: () => api.profile(),
    enabled: !!user,
  });
  const myActiveBidCount = (profileData?.bids ?? []).filter((b) => b.status === "active").length;
  const atBidLimit = myActiveBidCount >= MAX_ACTIVE_BIDS_PER_USER;
  const rawCards: ApiBrowseEntry[] = (data?.pages ?? []).flatMap((p) => p.cards ?? p.results ?? []);
  const cards =
    sort === "creator" ? [...rawCards].sort((a, b) => (a.drop?.creatorName ?? "").localeCompare(b.drop?.creatorName ?? "")) : rawCards;
  const [pendingBidCardIds, setPendingBidCardIds] = useState<string[]>([]);
  async function onBid(cardId: string, activeHighest: number | null) {
    if (!user) {
      push("Masuk untuk menawar", "info");
      return;
    }
    if (atBidLimit) {
      push(`Batas ${MAX_ACTIVE_BIDS_PER_USER} bid aktif — batalkan salah satu dulu`, "info");
      return;
    }
    const amt = bidAmt[cardId] ?? 10;
    if (amt < 1) {
      push("Minimal 1 C", "info");
      return;
    }
    // P1-7: hint minimum = tertinggi saat ini + 1, kalau ada active bid.
    if (activeHighest != null && amt <= activeHighest) {
      push(`Bid harus lebih tinggi dari ${activeHighest} C (saat ini aktif)`, "info");
      return;
    }
    // Konfirmasi sebelum C-Coin ditahan (founder 2026-08-29: aksi spend wajib confirm).
    if (!(await confirm({ title: `Tawar ${amt} C?`, message: "C-Coin ditahan sampai bid kalah atau dibatalkan.", confirmLabel: "Tawar" })))
      return;
    setPendingBidCardIds((current) => [...current, cardId]);
    try {
      await api.placeBid(cardId, amt);
      push(`Penawaran ${amt} C terkirim`, "success");
      refetch();
      refetchProfile();
    } catch (e: unknown) {
      push(errorMessage(e), "error");
    } finally {
      setPendingBidCardIds((current) => current.filter((id) => id !== cardId));
    }
  }

  // Quick stats
  const withBids = cards.filter((c) => c.activeBid).length;
  return (
    <div className="page-stack">
      <section className="page-hero" aria-label="Header halaman Browse">
        <div className="page-hero-rail">
          <span className="rail-channel">CH:03 / BROWSE</span>
          <span className="rail-dot" aria-hidden="true" />
          <span className="rail-sep">·</span>
          <span className="rail-extra">KANAL AKTIF</span>
          <span className="rail-time" aria-label="Siap">
            <span className="rail-cursor" aria-hidden="true" />
          </span>
        </div>
        <div className="page-hero-inner">
          <div className="page-hero-copy">
            <h1 className="page-hero-title">Browse</h1>
          </div>
        </div>
        <div className="hero-ticker" aria-hidden="true">
          <span className="ticker-label">Scan</span>
          <div className="ticker-track">
            <div className="ticker-scroll">
              <span className="ticker-item">
                <span className="tk-key">KARTU</span>
                <span className="tk-val cyan">{cards.length}</span>
              </span>
              <span className="ticker-item">
                <span className="tk-sep" aria-hidden="true" />
              </span>
              <span className="ticker-item">
                <span className="tk-key">DENGAN BID</span>
                <span className="tk-val signal">{withBids}</span>
              </span>
              <span className="ticker-item">
                <span className="tk-sep" aria-hidden="true" />
              </span>
              <span className="ticker-item">
                <span className="tk-key">TANPA BID</span>
                <span className="tk-val">{cards.length - withBids}</span>
              </span>
              <span className="ticker-item">
                <span className="tk-sep" aria-hidden="true" />
              </span>
              <span className="ticker-item">
                <span className="tk-key">UNIT</span>
                <span className="tk-val cyan">
                  {sort === "default" ? "DEFAULT" : sort === "creator" ? "KREATOR A-Z" : sort === "unit_asc" ? "UNIT ↑" : "UNIT ↓"}
                </span>
              </span>
              {user && (
                <>
                  <span className="ticker-item">
                    <span className="tk-sep" aria-hidden="true" />
                  </span>
                  <span className="ticker-item">
                    <span className="tk-key">SLOT</span>
                    <span className={`tk-val ${atBidLimit ? "magenta" : ""}`}>
                      {myActiveBidCount}/{MAX_ACTIVE_BIDS_PER_USER}
                    </span>
                  </span>
                </>
              )}
              <span className="ticker-item">
                <span className="tk-sep" aria-hidden="true" />
              </span>
              {/* duplicate for seamless marquee loop */}
              <span className="ticker-item">
                <span className="tk-key">KARTU</span>
                <span className="tk-val cyan">{cards.length}</span>
              </span>
              <span className="ticker-item">
                <span className="tk-sep" aria-hidden="true" />
              </span>
              <span className="ticker-item">
                <span className="tk-key">DENGAN BID</span>
                <span className="tk-val signal">{withBids}</span>
              </span>
              <span className="ticker-item">
                <span className="tk-sep" aria-hidden="true" />
              </span>
              <span className="ticker-item">
                <span className="tk-key">TANPA BID</span>
                <span className="tk-val">{cards.length - withBids}</span>
              </span>
              <span className="ticker-item">
                <span className="tk-sep" aria-hidden="true" />
              </span>
              <span className="ticker-item">
                <span className="tk-key">UNIT</span>
                <span className="tk-val cyan">
                  {sort === "default" ? "DEFAULT" : sort === "creator" ? "KREATOR A-Z" : sort === "unit_asc" ? "UNIT ↑" : "UNIT ↓"}
                </span>
              </span>
              {user && (
                <>
                  <span className="ticker-item">
                    <span className="tk-sep" aria-hidden="true" />
                  </span>
                  <span className="ticker-item">
                    <span className="tk-key">SLOT</span>
                    <span className={`tk-val ${atBidLimit ? "magenta" : ""}`}>
                      {myActiveBidCount}/{MAX_ACTIVE_BIDS_PER_USER}
                    </span>
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
          aria-label="Cari C.Card"
          placeholder="Cari C.Card, seri, kreator…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select className="select" aria-label="Urutkan C.Card" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
          <option value="default">Default</option>
          <option value="unit_asc">Unit ↑</option>
          <option value="unit_desc">Unit ↓</option>
          <option value="creator">Kreator A→Z</option>
        </select>
        <div className="toolbar-right">
          <button className="refresh-btn" onClick={() => refetch()} aria-label="Refresh daftar C.Card" type="button">
            <span className="dot" aria-hidden="true" />
            Refresh
          </button>
        </div>
      </div>

      {user && (
        <div
          className={`quota-hud${atBidLimit ? " is-full" : ""}`}
          aria-label={`Slot bid aktif ${myActiveBidCount} dari ${MAX_ACTIVE_BIDS_PER_USER}`}
        >
          <span className="quota-label">SLOT BID</span>
          <span className="quota-pips" aria-hidden="true">
            {Array.from({ length: MAX_ACTIVE_BIDS_PER_USER }, (_, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: fixed positional slot pips, not list data
              <span key={`bid-slot-${index}`} className={`quota-pip${index < myActiveBidCount ? " is-on" : ""}`} />
            ))}
          </span>
          <span className="quota-counter">
            {myActiveBidCount}/{MAX_ACTIVE_BIDS_PER_USER}
          </span>
        </div>
      )}

      {isLoading ? (
        <LoadingState />
      ) : isError ? (
        <ErrorState onRetry={() => refetch()} label="Gagal memuat C.Card" />
      ) : cards.length === 0 ? (
        <div className="empty-arcade">
          <div className="empty-icon" aria-hidden="true">
            NO_HITS
          </div>
          <div className="empty-title">Tidak ada hasil</div>
          <p className="empty-msg">Coba kata kunci lain, atau ubah pengurutan untuk eksplorasi lebih luas.</p>
        </div>
      ) : (
        <div className="grid-3">
          {cards.map((r) => {
            const card = r.card ?? r;
            const drop = r.drop;
            const activeBid = r.activeBid;
            const minNext = activeBid ? activeBid.amountCCoin + 1 : 1;
            const ownerName = r.owner?.displayName ?? "Tanpa pemilik";
            const creatorName = drop?.creatorName && drop.creatorName !== ownerName ? drop.creatorName : null;
            const isBidPending = pendingBidCardIds.includes(card.id);
            const isBidDisabled = isBidPending || atBidLimit || !r.canBid;
            const bidUnavailableReason = !r.canBid
              ? "Tidak bisa menawar"
              : atBidLimit
                ? `Batas ${MAX_ACTIVE_BIDS_PER_USER} bid aktif`
                : undefined;
            return (
              <article key={card.id} className="card browse-card">
                <Link to={`/cards/${card.id}`} aria-label={`Lihat ${drop?.title ?? card.id} #${card.unitNumber}`}>
                  <div className="browse-art">
                    {drop?.artworkUrl ? (
                      <div className="art" style={{ backgroundImage: `url("${drop.artworkUrl.replace(/"/g, "%22")}")` }} />
                    ) : (
                      <span className="art-fallback" data-init={drop?.title?.slice(0, 2).toUpperCase() ?? "C"} aria-hidden="true" />
                    )}
                    <span className="unit-tag" aria-label={`Unit ${card.unitNumber}`}>
                      #<strong>{card.unitNumber ?? "?"}</strong>
                    </span>
                  </div>
                  <div className="browse-body">
                    <div className="eyebrow">{drop?.series ?? "—"}</div>
                    <div className="browse-title">{drop?.title ?? card.id}</div>
                    <div className="card-pills">
                      {drop?.isSeed && <span className="badge-seed">✦ Seed 1-of-1</span>}
                      {card.variant === "signed" && <span className="pill pill-info">✍ Signed</span>}
                    </div>
                    <div className="browse-bid-status">
                      {activeBid ? (
                        <>
                          <span className="eyebrow">{user && activeBid.bidderId === user.id ? "BID KAMU — TERTINGGI" : "TERTINGGI"}</span>
                          <span className="bid-amount">{activeBid.amountCCoin} C</span>
                          <span className="bid-min">· min {minNext} C</span>
                        </>
                      ) : (
                        <span className="pill-muted">Belum ada penawar</span>
                      )}
                    </div>
                  </div>
                </Link>
                <div className="browse-panel">
                  <div className="browse-panel-meta">
                    <span className="seller-row">
                      <span className="seller-dot" aria-hidden="true" />
                      <span className="seller-name">{ownerName}</span>
                    </span>
                    {creatorName && (
                      <span className="seller-row">
                        <span className="seller-name">{creatorName}</span>
                      </span>
                    )}
                  </div>
                  {!user ? (
                    <div className="bid-locked">
                      <Link to="/login" state={{ from: "/browse" }}>
                        Masuk untuk menawar →
                      </Link>
                    </div>
                  ) : (
                    <div className="browse-bid-input-row">
                      <input
                        className="browse-bid-input"
                        type="number"
                        min={minNext}
                        aria-label={`Jumlah tawaran C-Coin untuk ${drop?.title ?? card.id}`}
                        placeholder={`min ${minNext} C`}
                        value={bidAmt[card.id] ?? ""}
                        onChange={(e) => setBidAmt((s) => ({ ...s, [card.id]: Number(e.target.value) }))}
                        disabled={isBidDisabled}
                      />
                      <button
                        className="bid-btn"
                        aria-busy={isBidPending}
                        onClick={() => onBid(card.id, activeBid?.amountCCoin ?? null)}
                        disabled={isBidDisabled}
                        title={bidUnavailableReason}
                        type="button"
                      >
                        <span className="bid-busy-text">{isBidPending ? "Mengirim" : "Tawar"}</span>
                      </button>
                    </div>
                  )}
                  <Link
                    to={`/cards/${card.id}`}
                    className="browse-detail-link"
                    aria-label={`Lihat detail lengkap ${drop?.title ?? card.id}`}
                  >
                    Detail lengkap →
                  </Link>
                </div>
              </article>
            );
          })}
        </div>
      )}
      {hasNextPage && (
        <button className="btn-ghost" onClick={() => fetchNextPage()} disabled={isFetchingNextPage}>
          {isFetchingNextPage ? "Memuat…" : "Muat lagi"}
        </button>
      )}
    </div>
  );
}

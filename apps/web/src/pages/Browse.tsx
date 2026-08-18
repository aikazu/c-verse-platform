import { useInfiniteQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { ErrorState, LoadingState } from "../lib/QueryStates";
import { useToast } from "../lib/toast";

export default function Browse() {
  const { user } = useAuth();
  const { push } = useToast();
  const [q, setQ] = useState("");
  const [bidAmt, setBidAmt] = useState<Record<string, number>>({});
  const { data, refetch, isLoading, isError, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
    queryKey: ["browse", q],
    queryFn: ({ pageParam }) => api.browse({ ...(q ? { q } : {}), limit: "60", offset: String(pageParam) }),
    initialPageParam: 0,
    getNextPageParam: (last) => (last.hasMore ? last.offset + last.limit : undefined),
  });
  const cards: any[] = data?.pages.flatMap((p) => p.cards ?? p.results ?? []) ?? [];
  const [bidBusy, setBidBusy] = useState<string | null>(null);
  async function onBid(cardId: string) {
    if (!user) {
      push("Masuk untuk menawar", "info");
      return;
    }
    const amt = bidAmt[cardId] ?? 10;
    if (amt < 1) {
      push("Minimal 1 C", "info");
      return;
    }
    setBidBusy(cardId);
    try {
      await api.placeBid(cardId, amt);
      push(`Penawaran ${amt} C terkirim`, "success");
      refetch();
    } catch (e: any) {
      push(e.message, "error");
    } finally {
      setBidBusy(null);
    }
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div>
        <span className="eyebrow">Jelajahi</span>
        <h1 className="h2" style={{ marginTop: 4 }}>
          Jelajahi <em style={{ fontStyle: "italic", fontWeight: 300, color: "var(--gold)" }}>C.Card</em>
        </h1>
        <p className="muted" style={{ marginTop: 6 }}>
          Temukan C.Card dan ajukan penawaran
        </p>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <input
          className="input"
          aria-label="Cari C.Card"
          placeholder="Cari C.Card, seri, kreator…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ flex: 1 }}
        />
        <button className="btn-ghost" onClick={() => refetch()} style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>
          Cari
        </button>
      </div>
      {isLoading ? (
        <LoadingState />
      ) : isError ? (
        <ErrorState onRetry={() => refetch()} label="Gagal memuat C.Card" />
      ) : cards.length === 0 ? (
        <div className="card card-pad muted" style={{ textAlign: "center", padding: 24 }}>
          Tidak ada hasil
        </div>
      ) : (
        <div className="grid-3">
          {cards.map((r: any) => {
            const card = r.card ?? r;
            const drop = r.drop;
            const activeBid = r.activeBid;
            return (
              <div key={card.id} className="card" style={{ overflow: "hidden" }}>
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
                  🎴
                </div>
                <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>
                    {drop?.title ?? card.id} · #{card.unitNumber}
                  </div>
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-muted)" }}>{drop?.series}</div>
                  {activeBid ? (
                    <span className="pill pill-success" style={{ alignSelf: "start", fontSize: 10 }}>
                      Tertinggi {activeBid.amountCCoin} C
                    </span>
                  ) : (
                    <span
                      className="pill"
                      style={{
                        alignSelf: "start",
                        fontSize: 10,
                        background: "var(--surface-2)",
                        color: "var(--text-dim)",
                        border: "1px solid var(--border)",
                      }}
                    >
                      Belum ada penawaran
                    </span>
                  )}
                  <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                    <Link
                      to={`/cards/${card.id}`}
                      className="btn-ghost"
                      style={{
                        flex: 1,
                        textAlign: "center",
                        textDecoration: "none",
                        padding: "7px 8px",
                        fontSize: 12,
                        fontFamily: "var(--font-mono)",
                      }}
                    >
                      Detail
                    </Link>
                  </div>
                  <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                    <input
                      className="input"
                      type="number"
                      min={1}
                      aria-label="Jumlah tawaran C-Coin"
                      placeholder="C"
                      value={bidAmt[card.id] ?? ""}
                      onChange={(e) => setBidAmt((s) => ({ ...s, [card.id]: Number(e.target.value) }))}
                      style={{ flex: 1, fontSize: 12, fontFamily: "var(--font-mono)" }}
                    />
                    <button
                      className="btn-gold"
                      onClick={() => onBid(card.id)}
                      disabled={bidBusy === card.id}
                      style={{ padding: "7px 14px", fontSize: 12 }}
                    >
                      {bidBusy === card.id ? "…" : "Tawar"}
                    </button>
                  </div>
                </div>
              </div>
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

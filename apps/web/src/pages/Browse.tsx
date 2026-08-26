import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import type { ApiBrowseEntry, ApiBrowseResponse } from "../lib/api-types";
import { useAuth } from "../lib/auth";
import { ErrorState, LoadingState } from "../lib/QueryStates";
import { useToast } from "../lib/toast";

const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

// P1-2 / docs/03_flows.md Flow 7: maksimum 3 bid aktif per user.
// Pakai konstanta yang sama dengan RPC BID_LIMIT (apps/api/src/lib/db.ts).
const MAX_ACTIVE_BIDS_PER_USER = 3;

export default function Browse() {
  const { user } = useAuth();
  const { push } = useToast();
  const [q, setQ] = useState("");
  const [bidAmt, setBidAmt] = useState<Record<string, number>>({});
  const { data, refetch, isLoading, isError, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery<ApiBrowseResponse>({
    queryKey: ["browse", q],
    queryFn: ({ pageParam }) => api.browse({ ...(q ? { q } : {}), limit: "60", offset: String(pageParam) }),
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
  const cards: ApiBrowseEntry[] = (data?.pages ?? []).flatMap((p) => p.cards ?? p.results ?? []);
  const [bidBusy, setBidBusy] = useState<string | null>(null);
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
    setBidBusy(cardId);
    try {
      await api.placeBid(cardId, amt);
      push(`Penawaran ${amt} C terkirim`, "success");
      refetch();
      refetchProfile();
    } catch (e: unknown) {
      push(errorMessage(e), "error");
    } finally {
      setBidBusy(null);
    }
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 12 }}>
        <div>
          <span className="eyebrow">Jelajahi</span>
          <h1 className="h2" style={{ marginTop: 4 }}>
            Jelajahi <em style={{ fontStyle: "italic", fontWeight: 300, color: "var(--gold)" }}>C.Card</em>
          </h1>
          <p className="muted" style={{ marginTop: 6 }}>
            Temukan C.Card dan ajukan penawaran
          </p>
        </div>
        {user && (
          <div
            className="card card-pad"
            style={{
              padding: "10px 14px",
              display: "flex",
              flexDirection: "column",
              gap: 4,
              minWidth: 200,
            }}
            aria-label="Kuota bid aktif"
          >
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 10,
                color: "var(--text-dim)",
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                fontWeight: 500,
              }}
            >
              Tawaran Aktif
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 20,
                  fontWeight: 700,
                  color: atBidLimit ? "var(--alert)" : "var(--gold)",
                }}
              >
                {myActiveBidCount}
              </span>
              <span className="muted" style={{ fontFamily: "var(--font-mono)", fontSize: 13 }}>
                / {MAX_ACTIVE_BIDS_PER_USER}
              </span>
            </div>
            <Link to="/me/manage" className="muted" style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--gold)" }}>
              Kelola bid →
            </Link>
          </div>
        )}
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
          {cards.map((r) => {
            const card = r.card ?? r;
            const drop = r.drop;
            const activeBid = r.activeBid;
            const minNext = activeBid ? activeBid.amountCCoin + 1 : 1;
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
                  {drop?.isSeed && (
                    <span className="badge-seed" style={{ alignSelf: "start" }}>
                      ✦ Seed 1-of-1
                    </span>
                  )}
                  {activeBid ? (
                    <span className="pill pill-success" style={{ alignSelf: "start", fontSize: 10 }}>
                      Tertinggi {activeBid.amountCCoin} C · min {minNext} C
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
                      min={minNext}
                      aria-label="Jumlah tawaran C-Coin"
                      placeholder={`min ${minNext} C`}
                      value={bidAmt[card.id] ?? ""}
                      onChange={(e) => setBidAmt((s) => ({ ...s, [card.id]: Number(e.target.value) }))}
                      style={{ flex: 1, fontSize: 12, fontFamily: "var(--font-mono)" }}
                      disabled={atBidLimit}
                    />
                    <button
                      className="btn-gold"
                      onClick={() => onBid(card.id, activeBid?.amountCCoin ?? null)}
                      disabled={bidBusy === card.id || atBidLimit}
                      title={atBidLimit ? `Batas ${MAX_ACTIVE_BIDS_PER_USER} bid aktif` : undefined}
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

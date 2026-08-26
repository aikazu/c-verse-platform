import type { LeaderboardEntry } from "@c-verse/shared";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { StatusBadge } from "../components/StatusBadge";
import { api } from "../lib/api";
import type { ApiCreatorPublicResponse, ApiDrop, ApiLeaderboardResponse } from "../lib/api-types";
import { ErrorState, LoadingState } from "../lib/QueryStates";

function avatarInitial(name: string | null | undefined): string {
  if (name && name.length > 0) return name.slice(0, 1).toUpperCase();
  return "◆";
}

export default function CreatorPage() {
  const { username } = useParams();
  const { data, isLoading } = useQuery<ApiCreatorPublicResponse>({
    queryKey: ["creator-pub", username],
    queryFn: () => api.creatorPublic(username!),
    enabled: !!username,
  });

  // The /api/creators/:id route returns `creator.id` = userId (creators.ts:115/129)
  // — that's the value the leaderboard RPC expects as `creatorId` for the
  // collector board. We only enable this query once we actually have it,
  // otherwise the request would 400 with missing-creatorId before navigation
  // resolves.
  const creatorUserId = data?.creator?.id;
  const {
    data: boardData,
    isLoading: boardLoading,
    isError: boardError,
    refetch: refetchBoard,
  } = useQuery<ApiLeaderboardResponse>({
    queryKey: ["leaderboard", "creator", creatorUserId],
    queryFn: () => api.leaderboard({ type: "creator", creatorId: creatorUserId as string, limit: 10 }),
    enabled: !!creatorUserId,
  });

  if (isLoading)
    return (
      <div className="muted" style={{ padding: 24, textAlign: "center" }}>
        Memuat…
      </div>
    );
  if (!data)
    return (
      <div className="card card-pad" style={{ textAlign: "center", padding: 32 }}>
        <p className="muted">Kreator tidak ditemukan</p>
      </div>
    );
  const creator = data.creator;
  const drops: ApiDrop[] = creator.drops ?? [];
  // doc 02 PG-CRT-PUB-01 hanya handle + drop list (tanpa follower count, tanpa bio / links
  // — API tidak mengembalikan field tersebut saat ini).
  const handle = creator.handle ?? creator.username ?? null;
  const board: LeaderboardEntry[] = boardData?.leaderboard ?? [];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div className="card card-pad">
        <span className="eyebrow">Kreator</span>
        <h1 className="h2" style={{ marginTop: 4 }}>
          {creator.displayName}
        </h1>
        {handle && <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>@{handle}</div>}
        {creator.handle && (
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-dim)", marginTop: 8 }}>
            Handle: {creator.handle}
          </div>
        )}
      </div>
      <div>
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            fontWeight: 500,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "var(--text-dim)",
            marginBottom: 12,
          }}
        >
          Koleksi — {drops.length}
        </div>
        {drops.length === 0 ? (
          <div className="card card-pad muted" style={{ textAlign: "center", padding: 24, fontFamily: "var(--font-mono)", fontSize: 12 }}>
            Belum ada koleksi
          </div>
        ) : (
          <div className="grid-3">
            {drops.map((d) => (
              <Link
                key={d.id}
                to={`/drops/${d.id}`}
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
                  🎴
                </div>
                <div style={{ padding: 12 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{d.title}</div>
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-muted)" }}>{d.series}</div>
                  <StatusBadge status={d.status} kind="drop" style={{ marginTop: 8, display: "inline-block", fontSize: 10 }} />
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
      <section aria-label="Papan Kolektor Kreator">
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            fontWeight: 500,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "var(--text-dim)",
            marginBottom: 12,
          }}
        >
          Papan Kolektor — {board.length}
        </div>
        {boardLoading ? (
          <LoadingState label="Memuat papan kolektor…" />
        ) : boardError ? (
          <ErrorState onRetry={() => refetchBoard()} label="Gagal memuat papan kolektor" />
        ) : board.length === 0 ? (
          <div className="card card-pad muted" style={{ textAlign: "center", padding: 24, fontFamily: "var(--font-mono)", fontSize: 12 }}>
            Belum ada kolektor untuk kreator ini.
          </div>
        ) : (
          <div className="lb-list" aria-label="Daftar kolektor kreator">
            {board.map((e) => (
              <Link
                key={e.userId}
                to={`/u/${e.username ?? e.userId}`}
                className="lb-row"
                aria-label={`Peringkat ${e.rank}: ${e.displayName}`}
              >
                <span className="lb-rank">{String(e.rank).padStart(2, "0")}</span>
                <span className="lb-player">
                  <span className="lb-avatar" aria-hidden="true">
                    {avatarInitial(e.displayName)}
                  </span>
                  <span className="lb-player-meta">
                    <span className="lb-player-name">{e.displayName}</span>
                    {e.username && <span className="lb-player-handle">@{e.username}</span>}
                  </span>
                </span>
                <span className="lb-level">
                  {e.level}
                  <span className="lb-level-of">LV</span>
                </span>
                <span className="lb-cards">
                  {e.score.toLocaleString("id-ID")}
                  <span className="lb-cards-label">kartu</span>
                </span>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

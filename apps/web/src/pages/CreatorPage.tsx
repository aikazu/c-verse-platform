import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { StatusBadge } from "../components/StatusBadge";
import { api } from "../lib/api";
import type { ApiCreatorPublicResponse, ApiDrop } from "../lib/api-types";

export default function CreatorPage() {
  const { username } = useParams();
  const { data, isLoading } = useQuery<ApiCreatorPublicResponse>({
    queryKey: ["creator-pub", username],
    queryFn: () => api.creatorPublic(username!),
    enabled: !!username,
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
    </div>
  );
}

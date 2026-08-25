import { useQuery } from "@tanstack/react-query";
import { useRef } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../lib/api";
import type { ApiCard3dResponse, ApiDrop } from "../lib/api-types";
import { useCardViewer } from "../lib/viewer";

export default function Card3D() {
  const { cardId } = useParams();
  const viewerRef = useRef<HTMLDivElement>(null);
  const { data, isLoading } = useQuery<ApiCard3dResponse>({
    queryKey: ["card3d", cardId],
    queryFn: () => api.card3d(cardId!),
    enabled: !!cardId,
  });
  const drop: ApiDrop | null = data?.drop ?? null;
  useCardViewer(viewerRef, drop?.artwork3dUrl ?? null, drop?.artworkUrl ?? null);
  if (isLoading)
    return (
      <div className="muted" style={{ padding: 24, textAlign: "center" }}>
        Memuat…
      </div>
    );
  if (!data)
    return (
      <div className="card card-pad" style={{ textAlign: "center", padding: 32 }}>
        <span className="eyebrow">3D</span>
        <p className="muted" style={{ marginTop: 8 }}>
          C.Card tidak ditemukan
        </p>
      </div>
    );
  const d = data;
  const card = d.card;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Link to={`/cards/${card.id ?? cardId}`} style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-muted)" }}>
        ← Kembali
      </Link>
      <div className="card" style={{ overflow: "hidden" }}>
        <div ref={viewerRef} style={{ height: 420, background: "var(--viewer-bg)" }} />
        <div className="card-pad">
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            {d.verifiedBadge ? (
              <span className="pill pill-success" style={{ fontWeight: 600 }}>
                ✓ {d.verifiedBadge}
              </span>
            ) : d.card?.verifyStatus === "registered" ? (
              <span className="pill pill-warn">Terdaftar via QR</span>
            ) : (
              <span className="pill pill-warn">Belum diverifikasi — tap NFC untuk verifikasi</span>
            )}
            <span className="pill pill-info" style={{ fontFamily: "var(--font-mono)" }}>
              #{card.unitNumber ?? "?"}
            </span>
            {d.drop?.isSeed && <span className="badge-seed">✦ Seed 1-of-1</span>}
          </div>
          <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, fontSize: 13 }}>
            {d.drop && (
              <div>
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 10,
                    color: "var(--text-dim)",
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                  }}
                >
                  Seri
                </span>
                <br />
                <Link to={d.seriesLink ?? `/drops/${d.drop.id}`} style={{ color: "var(--gold)", fontWeight: 500, fontSize: 13 }}>
                  {d.drop.series ?? d.drop.title}
                </Link>
              </div>
            )}
            <div>
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 10,
                  color: "var(--text-dim)",
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                }}
              >
                Nomor
              </span>
              <br />
              <span style={{ fontWeight: 500 }}>
                #{card.unitNumber} dari {card.totalUnits ?? "?"}
              </span>
            </div>
            {d.creator && (
              <div>
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 10,
                    color: "var(--text-dim)",
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                  }}
                >
                  Kreator
                </span>
                <br />
                <Link to={d.creator.link} style={{ color: "var(--gold)", fontWeight: 500 }}>
                  {d.creator.name}
                </Link>
              </div>
            )}
            {d.owner && (
              <div>
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 10,
                    color: "var(--text-dim)",
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                  }}
                >
                  Pemilik
                </span>
                <br />
                <Link to={d.owner.link} style={{ color: "var(--gold)", fontWeight: 500 }}>
                  {d.owner.name}
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

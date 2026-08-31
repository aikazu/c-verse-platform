import { useQuery } from "@tanstack/react-query";
import { useRef } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import type { ApiCard3dResponse, ApiDrop } from "../lib/api-types";
import { useCardViewer } from "../lib/viewer";
import "./cards.css";

export default function Card3D() {
  const { cardId } = useParams();
  const [searchParams] = useSearchParams();
  const viewerRef = useRef<HTMLDivElement>(null);
  // iOS SUN tap: the NDEF URL lands here with ?uid=&ctr=&c=&t= — forward them so
  // the backend runs real CMAC verification instead of capping at "registered".
  const tapParams = {
    uid: searchParams.get("uid") ?? undefined,
    ctr: searchParams.get("ctr") ?? undefined,
    cmac: searchParams.get("c") ?? searchParams.get("cmac") ?? undefined,
    t: searchParams.get("t") ?? undefined,
  };
  const { data, isLoading } = useQuery<ApiCard3dResponse>({
    queryKey: ["card3d", cardId, searchParams.toString()],
    queryFn: () => api.card3d(cardId!, tapParams),
    enabled: !!cardId,
  });
  const drop: ApiDrop | null = data?.drop ?? null;
  // isReady menutup kasus drop tanpa artwork3dUrl & artworkUrl sekaligus:
  // deps viewer tidak berubah saat loading→loaded, jadi butuh flag terpisah
  // agar jalur placeholder.obj tetap dieksekusi.
  useCardViewer(viewerRef, drop?.artwork3dUrl ?? null, drop?.artworkUrl ?? null, data != null);
  if (isLoading) return <div className="muted ci-note">Memuat…</div>;
  if (!data)
    return (
      <div className="card card-pad ci-empty-card">
        <span className="eyebrow">3D</span>
        <p className="muted" style={{ marginTop: 8 }}>
          C.Card tidak ditemukan
        </p>
      </div>
    );
  const d = data;
  const card = d.card;
  return (
    <div className="page-stack">
      <Link to={`/cards/${card.id ?? cardId}`} className="btn-ghost ci-back">
        ← Kembali
      </Link>
      <section className="page-hero" aria-label="Header halaman C.Card 3D">
        <div className="page-hero-rail">
          <span className="rail-channel">CH:07 / C.CARD</span>
          <span className="rail-dot" aria-hidden="true" />
          <span className="rail-sep">·</span>
          <span className="rail-extra">3D VIEWER ACTIVE</span>
          <span className="rail-time" aria-label="Siap">
            <span className="rail-cursor" aria-hidden="true" />
          </span>
        </div>
        <div className="page-hero-inner">
          <div className="page-hero-copy">
            <h1 className="page-hero-title">3D Viewer</h1>
          </div>
        </div>
      </section>
      <div className="card ci-clip">
        <div ref={viewerRef} className="ci-viewer-host" />
        <div className="card-pad">
          <div className="ci-pill-row">
            {d.verifiedBadge ? (
              <span className="pill pill-success">✓ {d.verifiedBadge}</span>
            ) : d.card?.verifyStatus === "registered" ? (
              <span className="pill pill-warn">Terdaftar via QR</span>
            ) : (
              <span className="pill pill-warn">Belum diverifikasi — tap NFC untuk verifikasi</span>
            )}
            <span className="pill pill-info">#{card.unitNumber ?? "?"}</span>
            {d.drop?.isSeed && <span className="badge-seed">✦ Seed 1-of-1</span>}
          </div>
          <div className="ci-stat-grid">
            {d.drop && (
              <div className="ci-stat">
                <span className="label">Seri</span>
                <Link to={d.seriesLink ?? `/drops/${d.drop.id}`} className="ci-link-gold ci-stat-value">
                  {d.drop.series ?? d.drop.title}
                </Link>
              </div>
            )}
            <div className="ci-stat">
              <span className="label">Nomor</span>
              <span className="ci-stat-value">
                #{card.unitNumber} dari {card.totalUnits ?? "?"}
              </span>
            </div>
            {d.creator && (
              <div className="ci-stat">
                <span className="label">Kreator</span>
                <Link to={d.creator.link} className="ci-link-gold ci-stat-value">
                  {d.creator.name}
                </Link>
              </div>
            )}
            {d.owner && (
              <div className="ci-stat">
                <span className="label">Pemilik</span>
                <Link to={d.owner.link} className="ci-link-gold ci-stat-value">
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

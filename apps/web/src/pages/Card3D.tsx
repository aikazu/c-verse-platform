import { useQuery } from "@tanstack/react-query";
import { type KeyboardEvent, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { ApiError, api } from "../lib/api";
import type { ApiCard3dResponse } from "../lib/api-types";
import { useCardViewer } from "../lib/viewer";
import "./card3d.css";

function ControlIcon({ name }: { name: "rotate" | "pause" | "reset" | "expand" | "shield" }) {
  const paths = {
    rotate: "M20 8a8 8 0 1 0 0 8M20 3v5h-5",
    pause: "M8 5v14M16 5v14",
    reset: "M4 9a8 8 0 1 1 0 6M4 4v5h5",
    expand: "M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5",
    shield: "M12 3 4 6v6c0 4 8 9 8 9s8-5 8-9V6l-8-3ZM8 12l3 3 5-6",
  };
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}

function verificationInfo(data: ApiCard3dResponse) {
  if (data.card.verifyStatus === "tamper_detected")
    return { tone: "danger", title: "Segel terindikasi berubah", detail: "Periksa kondisi fisik dan detail verifikasi kartu ini." };
  if (data.verifiedBadge)
    return { tone: "verified", title: data.verifiedBadge, detail: "Keaslian telah diperiksa melalui verifikasi NFC." };
  if (data.card.verifyStatus === "registered")
    return { tone: "registered", title: "Terdaftar via QR", detail: "Tap NFC pada kartu fisik untuk memverifikasi keasliannya." };
  return { tone: "pending", title: "Belum terverifikasi", detail: "Tap NFC pada kartu fisik untuk memverifikasi keasliannya." };
}

function CardInspection({ data }: { data: ApiCard3dResponse }) {
  const viewerRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const viewer = useCardViewer(viewerRef, data.drop?.artwork3dUrl ?? null, data.drop?.artworkUrl ?? null);
  const canControl = viewer.status === "ready" || viewer.status === "unavailable";
  const { card, drop, creator, owner } = data;
  const title = drop?.title ? `${drop.title} · #${card.unitNumber}` : `C.Card #${card.unitNumber}`;
  const verification = verificationInfo(data);
  const released = data.releaseDate ? new Date(data.releaseDate) : null;
  const releaseLabel =
    released && !Number.isNaN(released.getTime())
      ? new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Jakarta" }).format(released)
      : null;
  const viewLabel = viewer.autoRotate
    ? "ROTASI OTOMATIS"
    : viewer.view === "front"
      ? "SISI DEPAN"
      : viewer.view === "back"
        ? "SISI BELAKANG"
        : "SUDUT BEBAS";

  function onViewerKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!canControl || event.ctrlKey || event.altKey || event.metaKey) return;
    const actions: Record<string, () => void> = {
      ArrowLeft: () => viewer.rotateBy(-0.18, 0),
      ArrowRight: () => viewer.rotateBy(0.18, 0),
      ArrowUp: () => viewer.rotateBy(0, -0.12),
      ArrowDown: () => viewer.rotateBy(0, 0.12),
      "+": () => viewer.setZoom(viewer.zoom + 0.1),
      "=": () => viewer.setZoom(viewer.zoom + 0.1),
      "-": () => viewer.setZoom(viewer.zoom - 0.1),
      " ": viewer.toggleRotation,
      Home: viewer.reset,
    };
    if (actions[event.key]) {
      event.preventDefault();
      actions[event.key]();
    }
  }

  return (
    <div className={`c3d-page${expanded ? " c3d-expanded" : ""}`}>
      <div className="c3d-breadcrumb">
        <Link to={`/cards/${card.id}`}>← Detail kartu</Link>
        <span>
          CH:07B / C.CARD <i />
        </span>
      </div>
      <header className="c3d-header">
        <div>
          <p className="c3d-eyebrow">KOLEKSI DALAM DIMENSI BARU</p>
          <h1>{title}</h1>
          <p className="c3d-subtitle">Setiap sisi, setiap detail. Jelajahi kartu dari sudut Anda.</p>
        </div>
        <div className="c3d-dimension" aria-hidden="true">
          3D<span>360° VIEW</span>
        </div>
      </header>
      <div className="c3d-layout">
        <section className="c3d-stage" aria-label="Inspeksi kartu" data-status={viewer.status}>
          <div className="c3d-stage-rail">
            <h2>
              <span /> Inspeksi 360°
            </h2>
            <button type="button" aria-pressed={expanded} onClick={() => setExpanded(!expanded)}>
              <ControlIcon name="expand" />
              {expanded ? "Tutup mode fokus" : "Mode fokus"}
            </button>
          </div>
          <div className="c3d-viewport">
            <div
              ref={viewerRef}
              className="c3d-canvas"
              role="application"
              tabIndex={canControl ? 0 : -1}
              aria-label={`Viewer 3D interaktif ${title}`}
              aria-describedby="c3d-keyboard-help"
              onKeyDown={onViewerKeyDown}
            />
            <div className="c3d-corners" aria-hidden="true">
              <i />
              <i />
              <i />
              <i />
            </div>
            {canControl && (
              <>
                <div className="c3d-view-label">
                  <span />
                  {viewLabel}
                </div>
                <div className="c3d-drag-hint" aria-hidden="true">
                  ↔ GESER UNTUK MEMUTAR
                </div>
              </>
            )}
            {viewer.status === "loading" && (
              <div className="c3d-overlay" role="status">
                <span className="c3d-orbit" />
                <p>Memuat artwork C.Card…</p>
              </div>
            )}
            {viewer.status === "error" && (
              <div className="c3d-overlay" role="alert">
                <ControlIcon name="expand" />
                <h3>Viewer 3D tidak tersedia</h3>
                <p>WebGL tidak tersedia atau koneksi grafis terputus. Muat ulang halaman atau buka detail kartu.</p>
                <Link to={`/cards/${card.id}`}>Lihat detail kartu →</Link>
              </div>
            )}
          </div>
          {viewer.status === "unavailable" && (
            <p className="c3d-artwork-note" role="status">
              Artwork C.Card tidak dapat dimuat. Model 3D netral ditampilkan.
            </p>
          )}
          <div className="c3d-controls" role="group" aria-label="Kontrol viewer">
            <div className="c3d-face-controls">
              <button
                type="button"
                disabled={!canControl}
                aria-label="Sisi depan"
                aria-pressed={!viewer.autoRotate && viewer.view === "front"}
                onClick={() => viewer.setView("front")}
              >
                Depan
              </button>
              <button
                type="button"
                disabled={!canControl}
                aria-label="Sisi belakang"
                aria-pressed={!viewer.autoRotate && viewer.view === "back"}
                onClick={() => viewer.setView("back")}
              >
                Belakang
              </button>
            </div>
            <button
              className="c3d-rotation"
              type="button"
              disabled={!canControl}
              aria-label={viewer.autoRotate ? "Jeda rotasi" : "Putar otomatis"}
              aria-pressed={viewer.autoRotate}
              onClick={viewer.toggleRotation}
            >
              <ControlIcon name={viewer.autoRotate ? "pause" : "rotate"} />
              <span>{viewer.autoRotate ? "Jeda" : "Putar"}</span>
            </button>
            <div className="c3d-zoom">
              <label htmlFor="c3d-zoom">
                ZOOM <output>{Math.round(viewer.zoom * 100)}%</output>
              </label>
              <input
                id="c3d-zoom"
                aria-label="Zoom kartu"
                type="range"
                min="0.8"
                max="1.4"
                step="0.1"
                value={viewer.zoom}
                disabled={!canControl}
                onChange={(event) => viewer.setZoom(Number(event.target.value))}
              />
            </div>
            <button
              className="c3d-reset"
              type="button"
              disabled={!canControl}
              aria-label="Reset tampilan"
              title="Reset tampilan"
              onClick={viewer.reset}
            >
              <ControlIcon name="reset" />
            </button>
          </div>
          <p className="c3d-keyboard-help" id="c3d-keyboard-help">
            Keyboard: panah untuk memutar · + / − untuk zoom · spasi untuk jeda
          </p>
        </section>
        <aside className="c3d-dossier" aria-label="Identitas kartu">
          <div className="c3d-edition">
            <p className="c3d-eyebrow">LIMITED EDITION</p>
            <div className="c3d-serial">
              <span>#</span>
              {String(card.unitNumber).padStart(2, "0")}
              <small>/ {card.totalUnits ?? "?"}</small>
            </div>
            <div className="c3d-variants">
              <span>{card.variant === "signed" ? "Signed" : "Reguler"}</span>
              {drop?.isSeed && <span className="c3d-seed">Seed 1-of-1</span>}
            </div>
          </div>
          <dl className="c3d-metadata">
            {drop && (
              <div>
                <dt>SERI</dt>
                <dd>
                  <Link to={data.seriesLink ?? `/drops/${drop.id}`}>
                    {drop.series ?? drop.title}
                    <span aria-hidden="true">↗</span>
                  </Link>
                </dd>
              </div>
            )}
            {creator && (
              <div>
                <dt>KREATOR</dt>
                <dd>
                  <Link to={creator.link}>
                    {creator.name}
                    <span aria-hidden="true">↗</span>
                  </Link>
                </dd>
              </div>
            )}
            {releaseLabel && (
              <div>
                <dt>TANGGAL RILIS</dt>
                <dd>{releaseLabel}</dd>
              </div>
            )}
            {owner && (
              <div>
                <dt>KOLEKTOR</dt>
                <dd>
                  <Link to={owner.link}>
                    {owner.name}
                    <span aria-hidden="true">↗</span>
                  </Link>
                </dd>
              </div>
            )}
          </dl>
          <div className={`c3d-verification c3d-verification-${verification.tone}`}>
            <ControlIcon name="shield" />
            <div>
              <h3>{verification.title}</h3>
              <p>{verification.detail}</p>
            </div>
          </div>
          <div className="c3d-details">
            <Link to={`/cards/${card.id}`}>
              Detail & riwayat kartu <span aria-hidden="true">↗</span>
            </Link>
            <p>Visual 3D adalah representasi digital. Verifikasi keaslian melalui kartu fisik.</p>
          </div>
        </aside>
      </div>
    </div>
  );
}

export default function Card3D() {
  const { cardId } = useParams();
  const [searchParams] = useSearchParams();
  // Forward SUN parameters from NFC taps; loading artwork never verifies a card.
  const tapParams = {
    uid: searchParams.get("uid") ?? undefined,
    ctr: searchParams.get("ctr") ?? undefined,
    cmac: searchParams.get("c") ?? searchParams.get("cmac") ?? undefined,
    t: searchParams.get("t") ?? undefined,
  };
  const { data, isLoading, error, refetch } = useQuery<ApiCard3dResponse>({
    queryKey: ["card3d", cardId, searchParams.toString()],
    queryFn: () => api.card3d(cardId!, tapParams),
    enabled: !!cardId,
    retry: (count, failure) => !(failure instanceof ApiError && failure.status === 404) && count < 2,
  });
  if (isLoading)
    return (
      <section className="c3d-empty" role="status">
        <span className="c3d-orbit" />
        <p>Memuat C.Card…</p>
      </section>
    );
  if (!data) {
    const notFound = !cardId || (error instanceof ApiError && error.status === 404);
    return (
      <section className="c3d-empty">
        <p className="c3d-eyebrow">C.CARD / 3D</p>
        <h1>{notFound ? "C.Card tidak ditemukan" : "C.Card belum dapat dimuat"}</h1>
        <p>{notFound ? "Periksa tautan kartu atau jelajahi koleksi yang tersedia." : "Koneksi ke server terganggu. Coba muat kembali."}</p>
        {!notFound && (
          <button type="button" onClick={() => void refetch()}>
            Coba lagi
          </button>
        )}
        <Link to="/browse">Jelajahi kartu →</Link>
      </section>
    );
  }
  return <CardInspection key={data.card.id} data={data} />;
}

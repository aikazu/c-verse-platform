import { AOV_UNSIGNED_CCOIN, calcSignedPrice, dropEntryStatusLabel } from "@c-verse/shared";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { CardThumb } from "../components/CardThumb";
import { useConfirm } from "../components/ConfirmProvider";
import { LEGAL_CONSENTS } from "../components/LegalConsentCheckbox";
import { PageHero } from "../components/PageHero";
import { StatusBadge } from "../components/StatusBadge";
import type { ApiDropCardRow, ApiDropDetailWithWinners } from "../lib/api";
import { ApiError, api } from "../lib/api";
import type { ApiDrop } from "../lib/api-types";
import { useAuth } from "../lib/auth";
import { ErrorState, LoadingState } from "../lib/QueryStates";
import { useToast } from "../lib/toast";
import "./commerce.css";

// Fallback terakhir untuk error tanpa code-map — jangan render teks server mentah.
const GENERIC_ERROR = "Terjadi kesalahan, coba lagi";

/**
 * P0-1 (audit 2026-08-24): derive fase UI dari field backend.
 * Phase raffle hybrid (C-15 / docs/03_flows.md Flow 1):
 *   upcoming : dropStartAt > now
 *   raffle   : live && now < raffleEndAt && !drawnAt
 *   drawing  : live && raffleEnd elapsed && !drawnAt (cron delay)
 *   fcfs     : drawnAt && remaining > 0
 *   ended    : status ended atau sold out
 */
type Phase = "upcoming" | "raffle" | "drawing" | "fcfs" | "ended";

function derivePhase(d: ApiDrop, now: number): Phase {
  const remaining = d.totalUnits - d.soldCount;
  const dropStart = d.dropStartAt ?? null;
  if (dropStart && new Date(dropStart).getTime() > now) return "upcoming";
  if (d.drawnAt) {
    return remaining <= 0 || d.status === "sold_out" || d.status === "closed" || d.status === "cancelled" ? "ended" : "fcfs";
  }
  if (d.raffleEndAt && new Date(d.raffleEndAt).getTime() <= now) return "drawing";
  if (d.status === "live" || d.status === "published") return "raffle";
  return "ended";
}

/** Format detik tersisa jadi "23j 14m 03d" (Bahasa Indonesia). */
function fmtCountdown(ms: number): string {
  if (ms <= 0) return "Waktu habis";
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}j ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}d`;
  if (m > 0) return `${m}m ${String(s).padStart(2, "0")}d`;
  return `${s}d`;
}

export default function DropDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { user } = useAuth();
  const { push } = useToast();
  const { data, isLoading, refetch } = useQuery<ApiDropDetailWithWinners>({
    queryKey: ["drop", id],
    queryFn: () => api.drop(id!),
    enabled: !!id,
    refetchInterval: 60_000, // phase derivation akurat saat raffle window
  });
  // B2: seluruh unit drop untuk grid per-kartu (signed dulu, unitNumber asc —
  // urutan server). Terpisah dari detail drop agar payload tetap ringan.
  const cardsQuery = useQuery({
    queryKey: ["drop-cards", id],
    queryFn: () => api.dropCards(id!),
    enabled: !!id,
  });
  // Tick tiap detik untuk countdown yang akurat (bukan refetch tiap detik → hemat).
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  // Countdown target sesuai fase — dihitung sebelum early-return agar hooks order konsisten.
  const dropStartRaw = data?.dropStartAt ?? null;
  const raffleEndRaw = data?.raffleEndAt ?? null;
  const countdownTarget = useMemo(() => {
    if (!data) return null;
    const ph0 = derivePhase(data, now);
    if (ph0 === "upcoming" && dropStartRaw) return new Date(dropStartRaw).getTime();
    if (ph0 === "raffle" && raffleEndRaw) return new Date(raffleEndRaw).getTime();
    return null;
  }, [data, now, dropStartRaw, raffleEndRaw]);
  if (isLoading)
    return (
      <div className="muted" style={{ padding: 24, textAlign: "center" }}>
        Memuat…
      </div>
    );
  if (!data)
    return (
      <div className="card card-pad">
        Drop tidak ditemukan.{" "}
        <Link to="/drops" style={{ color: "var(--gold)" }}>
          Kembali
        </Link>
      </div>
    );
  const drop = data;
  const priceRegular = drop.priceCcoin ?? drop.priceUnsignedCCoin ?? AOV_UNSIGNED_CCOIN;
  const priceSigned = drop.priceSignedCCoin ?? calcSignedPrice(priceRegular);
  const ph = derivePhase(drop, now);
  const pct = drop.totalUnits ? Math.round((drop.soldCount / drop.totalUnits) * 100) : 0;
  const dropStart = dropStartRaw;
  // Grid per-kartu: dua group — Premium (Signed) dulu, lalu Regular (Unsigned).
  const allCards = cardsQuery.data?.cards ?? [];
  const signedUnits = allCards.filter((row) => row.variant === "signed");
  const unsignedUnits = allCards.filter((row) => row.variant === "unsigned");
  // Pemenang tersedia setelah draw, termasuk saat sisa unit masih FCFS.
  const winners = drop.drawnAt ? (data.winners ?? []) : [];
  return (
    <div className="page-stack">
      <PageHero
        channel="01"
        channelLabel="DROPS"
        title={drop.title}
        sub={drop.series ?? undefined}
        actions={
          <Link to="/drops" className="btn-ghost cm-back">
            ← Kembali ke Drops
          </Link>
        }
      />
      <div className="grid-2" style={{ alignItems: "start" }}>
        <div className="card" style={{ overflow: "hidden" }}>
          <div style={{ aspectRatio: "4/3" }}>
            <CardThumb artworkUrl={drop.artworkUrl} series={drop.series} title={drop.title} eager />
          </div>
          <div className="card-pad">
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <StatusBadge status={drop.status} kind="drop" style={{ fontFamily: "var(--font-mono)" }} />
              <span
                className="pill"
                style={{
                  background: "var(--surface-2)",
                  color: "var(--text-dim)",
                  border: "1px solid var(--border)",
                  fontFamily: "var(--font-mono)",
                  fontSize: 10,
                }}
              >
                {ph === "upcoming"
                  ? "Akan Datang"
                  : ph === "raffle"
                    ? "Raffle"
                    : ph === "drawing"
                      ? "Segera Diundi"
                      : ph === "fcfs"
                        ? "Beli Langsung"
                        : "Selesai"}
              </span>
              <span className="pill pill-info" style={{ fontFamily: "var(--font-mono)" }}>
                {drop.series}
              </span>
              <span
                className="pill"
                style={{
                  background: "var(--surface-2)",
                  color: "var(--text-dim)",
                  border: "1px solid var(--border)",
                  fontFamily: "var(--font-mono)",
                  fontSize: 10,
                }}
              >
                Reguler {priceRegular} C
              </span>
              <span className="pill pill-warn" style={{ fontFamily: "var(--font-mono)", fontSize: 10 }}>
                Signed {priceSigned} C
              </span>
            </div>
            <p className="muted" style={{ marginTop: 14, lineHeight: 1.7 }}>
              {drop.narrative}
            </p>
            <div className="cm-stat-row">
              <Stat label="TOTAL" value={String(drop.totalUnits)} />
              <Stat label="TERJUAL" value={`${drop.soldCount}/${drop.totalUnits} · ${pct}%`} />
              <Stat label="REGULER" value={`${priceRegular} C`} />
              <Stat label="SIGNED" value={`${priceSigned} C`} />
            </div>
            <div className="progress" style={{ marginTop: 14, height: 4 }}>
              <div className="progress-fill" style={{ width: `${pct}%` }} />
            </div>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-dim)", marginTop: 10 }}>
              oleh {drop.creatorName} {dropStart ? `· ${new Date(dropStart).toLocaleString("id-ID")}` : ""}
            </div>
            {(drop.creatorHandle ?? drop.creatorUsername ?? drop.creatorId) && (
              <Link
                to={`/c/${drop.creatorHandle ?? drop.creatorUsername ?? drop.creatorId}`}
                style={{ fontSize: 12, color: "var(--gold)", marginTop: 8, display: "inline-block", fontWeight: 500 }}
              >
                Lihat kreator →
              </Link>
            )}
          </div>
        </div>
        <ActionPanel
          drop={drop}
          phase={ph}
          countdownTarget={countdownTarget}
          countdownNow={now}
          priceRegular={priceRegular}
          priceSigned={priceSigned}
          userLoggedIn={!!user}
          myEntry={data.myEntry ?? null}
          onLoginRequired={() => nav("/login", { state: { from: `/drops/${id}` } })}
          onRefetchDrop={() => refetch()}
          onPush={(msg, kind) => push(msg, kind)}
          onNavHome={() => nav("/home")}
          onWalletRequired={() => nav("/wallet", { state: { returnTo: `/drops/${id}` } })}
        />
      </div>
      <section className="dd-units" aria-label="Semua C.Card dalam drop ini">
        {cardsQuery.isLoading ? (
          <LoadingState />
        ) : cardsQuery.isError ? (
          <ErrorState onRetry={() => cardsQuery.refetch()} label="Gagal memuat C.Card" />
        ) : (
          <>
            {signedUnits.length > 0 && (
              <div className="dd-group">
                <div className="dd-group-label">Signed</div>
                <div className="dd-grid">
                  {signedUnits.map((row) => (
                    <UnitCell key={row.id} row={row} drop={drop} />
                  ))}
                </div>
              </div>
            )}
            {unsignedUnits.length > 0 && (
              <div className="dd-group">
                <div className="dd-group-label">Reguler</div>
                <div className="dd-grid">
                  {unsignedUnits.map((row) => (
                    <UnitCell key={row.id} row={row} drop={drop} />
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </section>
      {winners.length > 0 && (
        <section className="dd-winners" aria-label="Pemenang drop">
          <h2 className="dd-section-heading">Pemenang</h2>
          <ul className="dd-winner-list">
            {winners.map((winner) => (
              <li key={`${winner.variant}-${winner.unitNumber}`} className="dd-winner-row">
                <span className="dd-winner-unit">#{winner.unitNumber}</span>
                <span className={`pill ${winner.variant === "signed" ? "pill-warn" : "pill-muted"}`}>
                  {winner.variant === "signed" ? "Signed" : "Reguler"}
                </span>
                <span className="dd-winner-name">{winner.displayName}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="cm-stat">
      <div className="label">{label}</div>
      <div className="cm-stat-value">{value}</div>
    </div>
  );
}

/** Sel grid per-kartu drop (B2): thumbnail artwork drop + nomor unit. */
function UnitCell({ row, drop }: { row: ApiDropCardRow; drop: ApiDrop }) {
  return (
    <Link to={`/cards/${row.id}`} className="dd-cell" aria-label={`Kartu nomor ${row.unitNumber}`}>
      <div className="dd-cell-art">
        <CardThumb artworkUrl={drop.artworkUrl} series={drop.series} title={drop.title} />
      </div>
      <span className="dd-cell-num" aria-hidden="true">
        #{row.unitNumber}
      </span>
    </Link>
  );
}

function ActionPanel(props: {
  drop: ApiDrop;
  phase: Phase;
  countdownTarget: number | null;
  countdownNow: number;
  priceRegular: number;
  priceSigned: number;
  userLoggedIn: boolean;
  myEntry: { pool: string; holdCcoin: number; status: string } | null;
  onLoginRequired: () => void;
  onRefetchDrop: () => void;
  onPush: (msg: string, kind: "info" | "error" | "success") => void;
  onNavHome: () => void;
  onWalletRequired: () => void;
}) {
  const [pool, setPool] = useState<"regular" | "premium" | "both">("regular");
  // Pool pembelian FCFS (post-draw) — terpisah dari pool raffle: checkout hanya
  // menerima regular/premium (checkoutSchema) dan diteruskan ke RPC checkout.
  const [buyPool, setBuyPool] = useState<"regular" | "premium">("regular");
  const [busy, setBusy] = useState(false);
  const confirm = useConfirm();

  async function onEnterRaffle() {
    if (!props.userLoggedIn) {
      props.onPush("Masuk untuk mengikuti raffle", "info");
      props.onLoginRequired();
      return;
    }
    const poolLabel = pool === "regular" ? "Reguler" : pool === "premium" ? "Signed" : "Reguler dan Signed";
    // Konfirmasi sebelum C-Coin ditahan (founder 2026-08-29: aksi spend wajib confirm)
    // + checklist entry irreversibel (founder 2026-09-01).
    if (
      !(await confirm({
        title: `Ikut raffle ${props.drop.title}?`,
        message: `Pilihan kartu: ${poolLabel}. Saldo ${holdAmount} C ditahan sementara dan dikembalikan otomatis jika tidak menang.`,
        confirmLabel: "Ikut",
        requireCheck: LEGAL_CONSENTS.raffle,
      }))
    )
      return;
    setBusy(true);
    try {
      await api.entryRaffle(props.drop.id, pool);
      props.onPush(`Berhasil ikut raffle (${poolLabel})`, "success");
      props.onNavHome();
    } catch (e: unknown) {
      console.error("entryRaffle gagal", e);
      const err = e instanceof ApiError ? e : null;
      if (err?.status === 402 || err?.code === "INSUFFICIENT") {
        props.onPush("C-Coin tidak cukup. Isi saldo untuk mengikuti raffle.", "info");
        props.onWalletRequired();
      } else {
        props.onPush(GENERIC_ERROR, "error");
      }
    } finally {
      setBusy(false);
    }
  }

  const remainingMs = props.countdownTarget != null ? Math.max(0, props.countdownTarget - props.countdownNow) : null;
  const countdownLabel = remainingMs != null ? fmtCountdown(remainingMs) : null;
  const holdAmount = pool === "regular" ? props.priceRegular : pool === "premium" ? props.priceSigned : props.priceSigned;
  const myEntryLabel = props.myEntry
    ? props.myEntry.pool === "regular"
      ? "Reguler"
      : props.myEntry.pool === "premium"
        ? "Signed"
        : "Keduanya"
    : "";

  return (
    <div className="card card-pad cm-panel">
      <div>
        <span className="eyebrow">
          {props.phase === "raffle"
            ? "Undian pembelian"
            : props.phase === "fcfs"
              ? "Beli Langsung"
              : props.phase === "upcoming"
                ? "Akan Datang"
                : props.phase === "drawing"
                  ? "Segera Diundi"
                  : "Status"}
        </span>
        <div className="cm-panel-title">
          {props.phase === "raffle" ? (
            <em style={{ fontStyle: "italic", fontWeight: 300, color: "var(--gold)" }}>Ikuti Raffle</em>
          ) : props.phase === "fcfs" ? (
            <em style={{ fontStyle: "italic", fontWeight: 300, color: "var(--gold)" }}>C.Card</em>
          ) : (
            <em style={{ fontStyle: "italic", fontWeight: 300, color: "var(--gold)" }}>Status Drop</em>
          )}
        </div>
        {props.phase === "upcoming" && props.countdownTarget && (
          <div className="muted cm-panel-note">Mulai: {new Date(props.countdownTarget).toLocaleString("id-ID")}</div>
        )}
        {props.phase === "drawing" && (
          <div className="muted cm-panel-note">Pendaftaran sudah ditutup. Hasil undian akan tampil setelah tersedia.</div>
        )}
      </div>

      {props.phase === "raffle" && (
        <div className="cm-countdown">
          <div>
            <div className="label">PENDAFTARAN DITUTUP DALAM</div>
            <div className="cm-countdown-value" aria-live="polite">
              {countdownLabel}
            </div>
          </div>
          <div className="cm-countdown-note">
            Saldo ditahan sementara. Jika menang, saldo dipakai untuk pembelian. Jika tidak, saldo dikembalikan.
          </div>
        </div>
      )}

      {/* Sudah ikut: entry unik per user/drop — tampilkan status, tanpa selector/CTA */}
      {props.phase === "raffle" && props.myEntry && (
        <div className="pill pill-success cm-phase-pill" role="status">
          ✓ Sudah ikut ({myEntryLabel}) — {props.myEntry.holdCcoin} C{" "}
          {props.myEntry.status === "held" ? "ditahan" : `· ${dropEntryStatusLabel(props.myEntry.status)}`}
        </div>
      )}

      {/* Pool selector hanya muncul saat raffle aktif dan belum ikut */}
      {props.phase === "raffle" && !props.myEntry && (
        <div className="cm-pool">
          <div className="label">Pilih jenis kartu</div>
          <div role="radiogroup" className="cm-pool-group">
            <PoolOption
              checked={pool === "regular"}
              onSelect={() => setPool("regular")}
              title="Reguler"
              hold={props.priceRegular}
              desc="Kartu tanpa tanda tangan kreator."
            />
            <PoolOption
              checked={pool === "premium"}
              onSelect={() => setPool("premium")}
              title="Signed"
              hold={props.priceSigned}
              desc="Kartu dengan tanda tangan kreator."
            />
            <PoolOption
              checked={pool === "both"}
              onSelect={() => setPool("both")}
              title="Keduanya"
              hold={props.priceSigned}
              desc={`Ikut undian Signed terlebih dahulu. Jika tidak menang, otomatis ikut undian Reguler dan selisih ${props.priceSigned - props.priceRegular} C dikembalikan.`}
            />
          </div>
        </div>
      )}

      {/* CTA per phase */}
      {props.phase === "raffle" && !props.myEntry && (
        <>
          <button className="btn-gold cm-cta" onClick={onEnterRaffle} disabled={busy}>
            {busy ? "Mengirim…" : `Ikuti Raffle · tahan ${holdAmount} C →`}
          </button>
          <div className="cm-footnote">Setiap akun hanya bisa mendaftar sekali per drop. Pendaftaran tidak bisa dibatalkan.</div>
        </>
      )}
      {/* Pool selector FCFS: signed unit hanya dibeli via pool premium
          (RPC checkout memetakan pool premium -> variant signed). */}
      {props.phase === "fcfs" && (
        <div className="cm-pool">
          <div className="label">Pilih jenis kartu</div>
          <div role="radiogroup" className="cm-pool-group">
            <PoolOption
              checked={buyPool === "regular"}
              onSelect={() => setBuyPool("regular")}
              title="Reguler"
              hold={props.priceRegular}
              desc="Kartu tanpa tanda tangan kreator."
            />
            <PoolOption
              checked={buyPool === "premium"}
              onSelect={() => setBuyPool("premium")}
              title="Signed"
              hold={props.priceSigned}
              desc="Kartu dengan tanda tangan kreator."
            />
          </div>
        </div>
      )}
      {props.phase === "fcfs" && (
        <>
          <Link to={`/drops/${props.drop.id}/checkout${buyPool === "premium" ? "?pool=premium" : ""}`} className="btn-gold cm-cta">
            Beli Sekarang →
          </Link>
          <div className="cm-footnote">
            Saldo kurang?{" "}
            <Link to="/wallet" className="cm-wallet-link">
              Isi C-Coin →
            </Link>
          </div>
        </>
      )}
      {props.phase === "upcoming" && <div className="pill pill-info cm-phase-pill">Mulai dalam {countdownLabel}</div>}
      {props.phase === "drawing" && <div className="pill pill-warn cm-phase-pill">Menunggu hasil undian</div>}
      {props.phase === "ended" && <div className="pill cm-phase-pill">Selesai</div>}
    </div>
  );
}

function PoolOption(props: { checked: boolean; onSelect: () => void; title: string; hold: number; desc: string }) {
  return (
    <label className={`cm-pool-option${props.checked ? " cm-pool-option-active" : ""}`}>
      <input type="radio" className="cm-radio" checked={props.checked} onChange={props.onSelect} />
      <span className="cm-pool-body">
        <div className="cm-pool-option-head">
          <span>{props.title}</span>
          <span className="cm-pool-option-hold">{props.hold} C</span>
        </div>
        <div className="muted cm-pool-option-desc">{props.desc}</div>
      </span>
    </label>
  );
}

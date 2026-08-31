import type { Bid } from "@c-verse/shared";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { CardThumb } from "../components/CardThumb";
import { useConfirm } from "../components/ConfirmProvider";
import { ApiError, api } from "../lib/api";
import type { ApiCardDetailResponse, ApiCardOwnershipRow } from "../lib/api-types";
import { useAuth } from "../lib/auth";
import { scanNfcTaps } from "../lib/nfc-web";
import { useToast } from "../lib/toast";
import "./cards.css";

const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

const VERIFY_BADGES: Record<string, { label: string; cls: string }> = {
  verified: { label: "✓ Verified", cls: "pill pill-success" },
  registered: { label: "Registered", cls: "pill pill-info" },
  tamper_detected: { label: "⚠ Tamper Detected", cls: "pill pill-warn" },
  unknown: { label: "Belum terverifikasi", cls: "pill" },
};

const BUYOUT_ERRORS: Record<string, string> = {
  INSUFFICIENT: "Saldo tidak cukup",
  OWN_CARD: "C.Card ini milikmu sendiri",
  COOLING_PERIOD_24H: "Blok rebuy 24 jam — C.Card yang baru kamu jual belum bisa dibeli kembali",
  CREATOR_SELF_DEALING_30D: "Kreator tidak boleh membeli C.Card sendiri (30 hari)",
  CARD_NOT_TRADABLE: "C.Card ini tidak dapat diperdagangkan",
};

// Lane C: payload publik tidak lagi membawa UUID (owner.id, bidderId) — server
// mengganti personalisasi dengan flag isOwner/isMine (viewer-scoped, aman).
type ApiCardOwnerPublic = { displayName: string; username?: string | null; isOwner?: boolean };
type ApiPublicBid = Bid & { isMine?: boolean };

export default function CardInfo() {
  const { cardId } = useParams();
  const { user } = useAuth();
  const { push } = useToast();
  const [buyoutOpen, setBuyoutOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [bidAmount, setBidAmount] = useState("");
  const confirm = useConfirm();
  const { data, isLoading, refetch } = useQuery<ApiCardDetailResponse>({
    queryKey: ["card", cardId],
    queryFn: () => api.card(cardId!),
    enabled: !!cardId,
  });
  // P1-6 (audit 2026-08-24): auto-buka panel buyout saat deep-link dari Marketplace
  // (#beli anchor) — kurangi friksi 2 klik jadi 1 untuk pembeli sekunder.
  // Hooks dulu sebelum early-return agar urutan konsisten.
  const buyoutPrice = data?.card?.buyoutPriceCcoin ?? null;
  const isOwnerDerived = (data?.owner as ApiCardOwnerPublic | null | undefined)?.isOwner === true;
  const canBuyoutDerived = buyoutPrice != null && !!user && !isOwnerDerived;
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (canBuyoutDerived && window.location.hash === "#beli") setBuyoutOpen(true);
  }, [canBuyoutDerived]);
  // QR visit (box QR / shared link): record the visit server-side so the physical
  // C.Card persists at most "registered" — the existing badge above reflects it
  // after refetch. Best-effort: a network error must never block the page.
  const nfcShortId = data?.card?.nfcShortId ?? null;
  useEffect(() => {
    if (!nfcShortId) return;
    let isCancelled = false;
    api
      .verifyShortId(nfcShortId)
      .then(() => {
        if (!isCancelled) refetch();
      })
      .catch(() => {
        // Silent failure — verification is never a render blocker.
      });
    return () => {
      isCancelled = true;
    };
  }, [nfcShortId, refetch]);
  // Android Web NFC: tapping the physical card on the phone relays the tag's own
  // payload (opaque pass-through) to /api/nfc/verify-nfc. Feature-detected
  // silently — no UI when 'NDEFReader' is unsupported.
  useEffect(() => {
    return scanNfcTaps((payload) => {
      api
        .verifyNfc(payload)
        .then((res) => {
          refetch();
          const badge = VERIFY_BADGES[res.verifyStatus] ?? VERIFY_BADGES.unknown;
          push(badge.label, res.verifyStatus === "verified" ? "success" : res.verifyStatus === "tamper_detected" ? "error" : "info");
        })
        .catch(() => {
          // Silent: unregistered UID / network error must not nag.
        });
    });
  }, [push, refetch]);
  if (isLoading) return <div className="muted ci-note">Memuat…</div>;
  if (!data)
    return (
      <div className="card card-pad ci-empty-card">
        <span className="eyebrow">C.Card</span>
        <p className="muted" style={{ marginTop: 8 }}>
          C.Card tidak ditemukan
        </p>
      </div>
    );
  // P1-6 (audit 2026-08-24): auto-buka panel buyout saat deep-link dari Marketplace
  // (#beli anchor) — kurangi friksi 2 klik jadi 1 untuk pembeli sekunder.
  const card = data.card;
  const drop = data.drop;
  const owner = data.owner;
  const activeBid = data.activeBid;
  const history: ApiCardOwnershipRow[] = data.ownershipHistory ?? [];
  const bids: Bid[] = data.bids ?? [];
  const verifyBadge = VERIFY_BADGES[card.verifyStatus ?? "unknown"] ?? VERIFY_BADGES.unknown;
  // isOwner / canBuyout dibaca oleh JSX di bawah; useEffect pakai derived.
  const canBuyout = canBuyoutDerived;
  const myActiveBid = (activeBid as ApiPublicBid | null)?.isMine ? activeBid : null;

  async function onBuyout() {
    if (
      !(await confirm({
        title: `Beli ${card.buyoutPriceCcoin} C?`,
        message: "C.Card masuk vault — kirim fisik nanti via Kelola C.Card.",
        confirmLabel: "Beli",
      }))
    )
      return;
    setBusy(true);
    try {
      // Vault-only purchase (founder 2026-08-28): settle straight to vault,
      // no destination/address at buy time — ship-out happens via ManageCards.
      await api.buyout(card.id, "platform_vault");
      push(`C.Card dibeli — fisik disimpan di vault (${card.buyoutPriceCcoin} C)`, "success");
      setBuyoutOpen(false);
      refetch();
    } catch (e) {
      const err = e instanceof ApiError ? e : null;
      const friendly = err?.code ? BUYOUT_ERRORS[err.code] : undefined;
      push(friendly ?? errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }

  async function onCancelBid() {
    if (!myActiveBid) return;
    // Konfirmasi sebelum penahanan C-Coin dilepas (founder 2026-08-31: cancel bid
    // wajib confirm — aksi destruktif & irreversible, aturan D8).
    const ok = await confirm({
      title: `Batalkan bid ${myActiveBid.amountCCoin} C?`,
      message: "C-Coin yang ditahan akan dikembalikan ke saldomu. Tindakan ini tidak bisa dibatalkan.",
      confirmLabel: "Batalkan bid",
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await api.cancelBid(myActiveBid.id);
      push("Bid dibatalkan", "success");
      refetch();
    } catch (e) {
      push(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }

  const nextMinBid = (activeBid?.amountCCoin ?? 0) + 1;

  async function onPlaceBid() {
    if (!user) {
      push("Masuk untuk menawar", "info");
      return;
    }
    const amt = Number(bidAmount);
    if (!Number.isFinite(amt) || amt < 1) {
      push("Minimal 1 C", "info");
      return;
    }
    if (activeBid && amt <= activeBid.amountCCoin) {
      push(`Bid harus lebih tinggi dari ${activeBid.amountCCoin} C`, "info");
      return;
    }
    // Konfirmasi sebelum C-Coin ditahan (founder 2026-08-29: aksi spend wajib confirm).
    if (!(await confirm({ title: `Tawar ${amt} C?`, message: "C-Coin ditahan sampai bid kalah atau dibatalkan.", confirmLabel: "Tawar" })))
      return;
    setBusy(true);
    try {
      await api.placeBid(card.id, amt);
      push(`Penawaran ${amt} C terkirim`, "success");
      setBidAmount("");
      refetch();
    } catch (e) {
      push(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page-stack">
      <Link to="/browse" className="btn-ghost ci-back">
        ← Jelajahi
      </Link>
      <section className="page-hero" aria-label="Header halaman C.Card">
        <div className="page-hero-rail">
          <span className="rail-channel">CH:07 / C.CARD</span>
          <span className="rail-dot" aria-hidden="true" />
          <span className="rail-sep">·</span>
          <span className="rail-extra">CARD DOSSIER</span>
          <span className="rail-time" aria-label="Siap">
            <span className="rail-cursor" aria-hidden="true" />
          </span>
        </div>
        <div className="page-hero-inner">
          <div className="page-hero-copy">
            <h1 className="page-hero-title">C.Card</h1>
          </div>
        </div>
      </section>
      <div className="grid-2 ci-align-start">
        <div className="card ci-clip">
          <div className="ci-thumb">
            <CardThumb artworkUrl={drop?.artworkUrl ?? null} series={drop?.series} title={drop?.title} eager />
          </div>
          <div className="card-pad">
            <span className="eyebrow">{drop?.series ?? "C.Card"}</span>
            <div className="ci-unit-row">
              <div className="ci-unit">
                #{card.unitNumber} <em>· {card.variant}</em>
              </div>
              <span className={`${verifyBadge.cls} ci-badge-sm`}>{verifyBadge.label}</span>
              {drop?.isSeed && <span className="badge-seed ci-badge-sm">✦ Seed 1-of-1</span>}
            </div>
            <div className="muted ci-sub">{drop?.title ?? ""}</div>
            <Link to={`/cards/${card.id}/3d`} className="btn-gold ci-view-3d">
              Lihat 3D →
            </Link>
          </div>
        </div>
        <div className="ci-col">
          <div className="card card-pad">
            <span className="eyebrow">Info</span>
            <div className="ci-info-list">
              {drop && (
                <div className="ci-stat-row">
                  <span className="label">Seri</span>
                  <Link to={`/drops/${drop.id}`} className="ci-link-gold">
                    {drop.series}
                  </Link>
                </div>
              )}
              <div className="ci-meta">
                Nomor #{card.unitNumber} · {card.variant}
              </div>
              {owner && (
                <div className="ci-stat-row">
                  <span className="label">Pemilik</span>
                  {owner.username ? (
                    <Link to={`/u/${owner.username}`} className="ci-link-gold">
                      {owner.displayName}
                    </Link>
                  ) : (
                    // owner anonim/flagged (masking server) → teks polos tanpa link
                    <span>{owner.displayName}</span>
                  )}
                </div>
              )}
              {card.buyoutPriceCcoin != null ? (
                <div className="ci-price-panel">
                  <span className="label">HARGA</span>
                  <div className="ci-price-val">{card.buyoutPriceCcoin} C</div>
                  {canBuyout && !buyoutOpen && (
                    <button className="btn-gold ci-buy-btn" onClick={() => setBuyoutOpen(true)}>
                      Beli di harga buyout
                    </button>
                  )}
                  {canBuyout && buyoutOpen && (
                    <div className="ci-form">
                      <div className="muted ci-note">C.Card masuk vault — kirim fisik nanti via Kelola C.Card.</div>
                      <div className="ci-actions">
                        <button className="btn-ghost ci-btn-sm" onClick={() => setBuyoutOpen(false)} disabled={busy}>
                          Batal
                        </button>
                        <button className="btn-gold ci-btn-sm" onClick={onBuyout} disabled={busy}>
                          {busy ? "Memproses…" : `Beli ${card.buyoutPriceCcoin} C`}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ) : null}
              {activeBid && (
                <div className="ci-bid-panel">
                  <span className="label ci-label-gold">{myActiveBid ? "BID KAMU — TERTINGGI" : "TAWARAN TERTINGGI"}</span>
                  <div className="ci-bid-amt">
                    {activeBid.amountCCoin} C <span className="ci-bid-by">oleh {activeBid.bidderName}</span>
                  </div>
                  {myActiveBid && (
                    <button className="btn-ghost ci-cancel-btn" onClick={onCancelBid} disabled={busy}>
                      {busy ? "Memproses…" : "Batalkan bid"}
                    </button>
                  )}
                </div>
              )}
              {user && !isOwnerDerived && (
                <div className="ci-form">
                  <div className="ci-actions">
                    <input
                      className="input"
                      type="number"
                      min={nextMinBid}
                      aria-label="Jumlah tawaran C-Coin"
                      placeholder={`min ${nextMinBid} C`}
                      value={bidAmount}
                      onChange={(e) => setBidAmount(e.target.value)}
                      disabled={busy}
                    />
                    <button className="btn-gold ci-btn-sm" onClick={onPlaceBid} disabled={busy || bidAmount === ""}>
                      Tawar
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
          <div className="card">
            <div className="ci-head-row">
              <span className="ci-head-title">Riwayat Pemilik</span>
              <span className="ci-head-count">{history.length}</span>
            </div>
            {history.length === 0 ? (
              <div className="ci-history-empty">Belum ada riwayat</div>
            ) : (
              <div className="ci-history-list">
                {history.map((h) => (
                  <div key={h.id} className="ci-history-row">
                    <span className="ci-history-owner">{h.ownerName ?? "—"}</span>
                    <span className="ci-history-date">{new Date(h.transferredAt).toLocaleDateString("id-ID")}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="card">
            <div className="ci-head-row">
              <span className="ci-head-title">Riwayat Penawaran</span>
              <span className="ci-head-count">{bids.length}</span>
            </div>
            {bids.length === 0 ? (
              <div className="ci-history-empty">Belum ada penawaran</div>
            ) : (
              <div className="ci-history-list">
                {bids.slice(0, 10).map((b) => (
                  <div key={b.id} className="ci-history-row">
                    <span>
                      {b.bidderName} · <span className="ci-bid-val">{b.amountCCoin} C</span>
                    </span>
                    <span className="ci-history-date">{new Date(b.createdAt).toLocaleDateString("id-ID")}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

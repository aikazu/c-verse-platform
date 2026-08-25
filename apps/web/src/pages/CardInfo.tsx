import type { Bid } from "@c-verse/shared";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ApiError, api } from "../lib/api";
import type { ApiCardDetailResponse, ApiCardOwnershipRow } from "../lib/api-types";
import { useAuth } from "../lib/auth";
import { useToast } from "../lib/toast";

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
  ADDRESS_REQUIRED: "Alamat wajib diisi (min 10 karakter)",
};

export default function CardInfo() {
  const { cardId } = useParams();
  const { user } = useAuth();
  const { push } = useToast();
  const [buyoutOpen, setBuyoutOpen] = useState(false);
  const [destination, setDestination] = useState<"buyer_address" | "platform_vault">("platform_vault");
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const { data, isLoading, refetch } = useQuery<ApiCardDetailResponse>({
    queryKey: ["card", cardId],
    queryFn: () => api.card(cardId!),
    enabled: !!cardId,
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
        <span className="eyebrow">C.Card</span>
        <p className="muted" style={{ marginTop: 8 }}>
          C.Card tidak ditemukan
        </p>
      </div>
    );
  const card = data.card;
  const drop = data.drop;
  const owner = data.owner;
  const activeBid = data.activeBid;
  const history: ApiCardOwnershipRow[] = data.ownershipHistory ?? [];
  const bids: Bid[] = data.bids ?? [];
  const verifyBadge = VERIFY_BADGES[card.verifyStatus ?? "unknown"] ?? VERIFY_BADGES.unknown;
  const isOwner = !!user && owner?.id === user.id;
  const canBuyout = card.buyoutPriceCcoin != null && !!user && !isOwner;
  const myActiveBid = activeBid?.bidderId && user && activeBid.bidderId === user.id ? activeBid : null;

  async function onBuyout() {
    if (destination === "buyer_address" && address.trim().length < 10) {
      push("Alamat minimal 10 karakter", "info");
      return;
    }
    setBusy(true);
    try {
      await api.buyout(card.id, destination, destination === "buyer_address" ? address.trim() : undefined);
      push(`C.Card dibeli — ${card.buyoutPriceCcoin} C`, "success");
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

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <Link to="/browse" style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-muted)", letterSpacing: "0.04em" }}>
        ← Jelajahi
      </Link>
      <div className="grid-2" style={{ alignItems: "start" }}>
        <div className="card" style={{ overflow: "hidden" }}>
          <div
            style={{
              aspectRatio: "4/3",
              background: "var(--thumb-grad)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 64,
            }}
          >
            🎴
          </div>
          <div className="card-pad">
            <span className="eyebrow">{drop?.series ?? "C.Card"}</span>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
              <div style={{ fontFamily: "var(--font-display)", fontSize: 18, fontWeight: 500 }}>
                #{card.unitNumber} <em style={{ fontStyle: "italic", fontWeight: 300, color: "var(--gold)" }}>· {card.variant}</em>
              </div>
              <span className={verifyBadge.cls} style={{ fontSize: 10, flexShrink: 0 }}>
                {verifyBadge.label}
              </span>
              {drop?.isSeed && (
                <span className="badge-seed" style={{ flexShrink: 0 }}>
                  ✦ Seed 1-of-1
                </span>
              )}
            </div>
            <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
              {drop?.title ?? ""}
            </div>
            <Link
              to={`/cards/${card.id}/3d`}
              className="btn-gold"
              style={{ display: "block", textAlign: "center", textDecoration: "none", marginTop: 16, padding: "11px" }}
            >
              Lihat 3D →
            </Link>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div className="card card-pad">
            <span className="eyebrow">Info</span>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10 }}>
              {drop && (
                <div style={{ fontSize: 13 }}>
                  <span
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 11,
                      color: "var(--text-dim)",
                      letterSpacing: "0.06em",
                      textTransform: "uppercase",
                    }}
                  >
                    Seri
                  </span>
                  <br />
                  <Link to={`/drops/${drop.id}`} style={{ color: "var(--gold)", fontWeight: 500, fontSize: 13 }}>
                    {drop.series}
                  </Link>
                </div>
              )}
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-muted)" }}>
                Nomor #{card.unitNumber} · {card.variant}
              </div>
              {owner && (
                <div style={{ fontSize: 13 }}>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-dim)" }}>Pemilik</span>{" "}
                  <Link to={`/u/${owner.username ?? owner.id}`} style={{ color: "var(--gold)", fontWeight: 500 }}>
                    {owner.displayName}
                  </Link>
                </div>
              )}
              {card.buyoutPriceCcoin != null ? (
                <div
                  style={{
                    marginTop: 6,
                    padding: "10px 12px",
                    background: "var(--surface-2)",
                    borderRadius: 8,
                    border: "1px solid var(--border)",
                  }}
                >
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-dim)", letterSpacing: "0.08em" }}>
                    HARGA
                  </span>
                  <div style={{ fontWeight: 700, fontSize: 15, marginTop: 2 }}>{card.buyoutPriceCcoin} C</div>
                  {canBuyout && !buyoutOpen && (
                    <button
                      className="btn-gold"
                      onClick={() => setBuyoutOpen(true)}
                      style={{ width: "100%", marginTop: 10, padding: "9px" }}
                    >
                      Beli di harga buyout
                    </button>
                  )}
                  {canBuyout && buyoutOpen && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10 }}>
                      <select
                        className="select"
                        aria-label="Tujuan pengiriman"
                        value={destination}
                        onChange={(e) => setDestination(e.target.value as "buyer_address" | "platform_vault")}
                      >
                        <option value="platform_vault">Simpan di vault</option>
                        <option value="buyer_address">Kirim ke alamat</option>
                      </select>
                      {destination === "buyer_address" && (
                        <textarea
                          className="textarea"
                          rows={3}
                          aria-label="Alamat pengiriman"
                          placeholder="Alamat lengkap (min 10 karakter)"
                          value={address}
                          onChange={(e) => setAddress(e.target.value)}
                          style={{ fontSize: 12 }}
                        />
                      )}
                      <div style={{ display: "flex", gap: 8 }}>
                        <button
                          className="btn-ghost"
                          onClick={() => setBuyoutOpen(false)}
                          disabled={busy}
                          style={{ flex: 1, padding: "8px" }}
                        >
                          Batal
                        </button>
                        <button className="btn-gold" onClick={onBuyout} disabled={busy} style={{ flex: 1, padding: "8px" }}>
                          {busy ? "Memproses…" : `Beli ${card.buyoutPriceCcoin} C`}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ) : null}
              {activeBid && (
                <div
                  style={{
                    padding: "10px 12px",
                    background: "var(--gold-bg-soft)",
                    borderRadius: 8,
                    fontSize: 13,
                    border: "1px solid var(--gold-border)",
                  }}
                >
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--gold)", letterSpacing: "0.06em" }}>
                    TAWARAN TERTINGGI
                  </span>
                  <div style={{ fontWeight: 600, marginTop: 4 }}>
                    {activeBid.amountCCoin} C{" "}
                    <span style={{ fontWeight: 400, color: "var(--text-muted)", fontSize: 12 }}>oleh {activeBid.bidderName}</span>
                  </div>
                  {myActiveBid && (
                    <button
                      className="btn-ghost"
                      onClick={onCancelBid}
                      disabled={busy}
                      style={{ marginTop: 8, padding: "7px 12px", fontSize: 12 }}
                    >
                      {busy ? "Memproses…" : "Batalkan bid"}
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
          <div className="card">
            <div
              style={{
                padding: "14px 16px",
                borderBottom: "1px solid var(--border)",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <span style={{ fontWeight: 600, fontSize: 13 }}>Riwayat Pemilik</span>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-dim)" }}>{history.length}</span>
            </div>
            {history.length === 0 ? (
              <div style={{ padding: 20, textAlign: "center", color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: 12 }}>
                Belum ada riwayat
              </div>
            ) : (
              <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 0 }}>
                {history.map((h) => (
                  <div
                    key={h.id}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      padding: "8px 0",
                      borderBottom: "1px solid var(--border)",
                      fontSize: 12,
                    }}
                  >
                    <span style={{ fontWeight: 500 }}>{h.ownerName ?? h.ownerId}</span>
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-muted)" }}>
                      {new Date(h.transferredAt).toLocaleDateString("id-ID")}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="card">
            <div
              style={{
                padding: "14px 16px",
                borderBottom: "1px solid var(--border)",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <span style={{ fontWeight: 600, fontSize: 13 }}>Riwayat Penawaran</span>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-dim)" }}>{bids.length}</span>
            </div>
            {bids.length === 0 ? (
              <div style={{ padding: 20, textAlign: "center", color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: 12 }}>
                Belum ada penawaran
              </div>
            ) : (
              <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 0 }}>
                {bids.slice(0, 10).map((b) => (
                  <div
                    key={b.id}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      padding: "8px 0",
                      borderBottom: "1px solid var(--border)",
                      fontSize: 12,
                    }}
                  >
                    <span>
                      {b.bidderName} · <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600 }}>{b.amountCCoin} C</span>
                    </span>
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-muted)" }}>
                      {new Date(b.createdAt).toLocaleDateString("id-ID")}
                    </span>
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

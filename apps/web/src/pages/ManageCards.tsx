import type { Card } from "@c-verse/shared";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { RequireAuth } from "../components/RequireAuth";
import { api } from "../lib/api";
import type { ApiProfileEnrichedCard } from "../lib/api-types";
import { useAuth } from "../lib/auth";
import { useToast } from "../lib/toast";
import "./account.css";

type EnrichedCard = ApiProfileEnrichedCard;

export default function ManageCards() {
  return (
    <RequireAuth>
      <ManageCardsInner />
    </RequireAuth>
  );
}

function ManageCardsInner() {
  const { user } = useAuth();
  const { push } = useToast();
  const [buyout, setBuyout] = useState<Record<string, string>>({});
  const [vaultAddr, setVaultAddr] = useState<Record<string, string>>({});
  const [vaultFee, setVaultFee] = useState<Record<string, number>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const { data, refetch } = useQuery({ queryKey: ["profile-manage"], queryFn: () => api.profile(), enabled: !!user });

  // Seed input dari harga buyout aktif — string supaya kosong ("") terbedakan dari angka.
  useEffect(() => {
    const list = data?.cards ?? [];
    if (list.length === 0) return;
    setBuyout((prev) => {
      const next = { ...prev };
      for (const card of list) {
        if (!(card.id in next)) next[card.id] = card.buyoutPriceCcoin != null ? String(card.buyoutPriceCcoin) : "";
      }
      return next;
    });
  }, [data]);

  const cards: EnrichedCard[] = data?.cards ?? [];
  async function onSetBuyout(card: EnrichedCard) {
    const raw = (buyout[card.id] ?? "").trim();
    const hasExisting = card.buyoutPriceCcoin != null;
    if (raw === "") {
      if (!hasExisting) return; // tidak ada perubahan — memang belum dijual
      if (!window.confirm("Hapus harga buyout C.Card ini?")) return;
      setBusyId(card.id);
      try {
        await api.patchBuyout(card.id, null);
        push("Harga dihapus", "success");
        refetch();
      } catch (e: unknown) {
        push(e instanceof Error ? e.message : String(e), "error");
      } finally {
        setBusyId(null);
      }
      return;
    }
    const v = Number(raw);
    if (Number.isNaN(v) || v < 1) {
      push("Minimal 1 C", "info");
      return;
    }
    setBusyId(card.id);
    try {
      await api.setBuyout(card.id, v);
      push(`Dijual ${v} C`, "success");
      refetch();
    } catch (e: unknown) {
      push(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setBusyId(null);
    }
  }
  async function onVaultShip(card: Card) {
    const addr = vaultAddr[card.id] ?? "";
    const fee = vaultFee[card.id] ?? 2;
    if (addr.length < 10) {
      push("Alamat minimal 10 karakter", "info");
      return;
    }
    // Konfirmasi: ongkir dipotong + kartu berstatus dikirim (founder 2026-08-29).
    if (!window.confirm(`Kirim C.Card ini ke alamat tujuan? Ongkir ${fee} C.`)) return;
    setBusyId(card.id);
    try {
      await api.vaultShipout(card.id, addr, fee);
      push("Pengiriman dibuat", "success");
      refetch();
    } catch (e: unknown) {
      push(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setBusyId(null);
    }
  }
  async function onAccept(card: EnrichedCard) {
    // Konfirmasi: kartu berpindah kepemilikan dan tidak bisa dibatalkan (founder 2026-08-29).
    if (!window.confirm(`Terima tawaran ${card.activeBid?.amountCCoin} C dari ${card.activeBid?.bidderName}? Kartu pindah ke pembeli.`))
      return;
    setBusyId(card.id);
    try {
      // Vault-only accept (founder 2026-08-28): settle straight to vault, no
      // address — buyer requests shipping later via "Kirim dari Vault".
      await api.acceptBidOnCard(card.id);
      push("Penawaran diterima — fisik disimpan di vault", "success");
      refetch();
    } catch (e: unknown) {
      push(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setBusyId(null);
    }
  }
  return (
    <div className="page-stack">
      <section className="page-hero ac-hero" aria-label="Header halaman Kelola">
        <div className="page-hero-rail">
          <span className="rail-channel">CH:10 / MANAGE</span>
          <span className="rail-dot" aria-hidden="true" />
          <span className="rail-sep">·</span>
          <span className="rail-extra">CARD MAINTENANCE</span>
          <span className="rail-time" aria-label="Siap">
            <span className="rail-cursor" aria-hidden="true" />
          </span>
        </div>
        <div className="page-hero-inner">
          <div className="page-hero-copy">
            <h1 className="page-hero-title">
              Kelola <em>C.Card</em> — {cards.length}
            </h1>
          </div>
          <Link to="/collection" className="btn-ghost" style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>
            ← Koleksi
          </Link>
        </div>
      </section>
      {cards.length === 0 ? (
        <div className="card card-pad muted" style={{ textAlign: "center", padding: 32 }}>
          Belum punya C.Card
        </div>
      ) : (
        <div className="ac-grid-cards">
          {cards.map((card) => (
            // P1-3 (audit 2026-08-24): hierarchical per-card structure.
            // <details> per aksi (buyout, accept-bid, ship-vault) supaya tidak
            // langsung bombardir user dengan 3 form terbuka — visual fokus.
            <div key={card.id} className="card ac-card">
              <div style={{ fontWeight: 600, fontSize: 13 }}>
                {card.drop?.title ?? card.dropId} · #{card.unitNumber}{" "}
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-dim)" }}>· {card.variant}</span>
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {card.buyoutPriceCcoin ? (
                  <span className="pill pill-warn" style={{ fontSize: 10 }}>
                    {card.buyoutPriceCcoin} C · Dijual
                  </span>
                ) : (
                  <span className="pill pill-muted" style={{ fontSize: 10 }}>
                    Tidak dijual
                  </span>
                )}
                {card.activeBid ? (
                  <span className="pill pill-success" style={{ fontSize: 10 }}>
                    Tawaran {card.activeBid.amountCCoin} C
                  </span>
                ) : null}
              </div>
              <Link
                to={`/cards/${card.id}`}
                style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--gold)", fontWeight: 500 }}
              >
                Detail →
              </Link>
              {/* Aksi 1 — Pasang harga jual */}
              <details className="ac-card-item">
                <summary className="ac-card-summary">Pasang / Ubah Harga Jual</summary>
                <div className="ac-card-row">
                  <input
                    className="input"
                    type="number"
                    min={1}
                    aria-label="Harga jual C-Coin"
                    placeholder="Harga C (kosong = hapus)"
                    value={buyout[card.id] ?? ""}
                    onChange={(e) => setBuyout((s) => ({ ...s, [card.id]: e.target.value }))}
                    style={{ flex: 1, fontSize: 12, fontFamily: "var(--font-mono)" }}
                  />
                  <button
                    className="btn-gold"
                    onClick={() => onSetBuyout(card)}
                    disabled={busyId === card.id}
                    style={{ fontSize: 12, padding: "7px 14px" }}
                  >
                    Simpan
                  </button>
                </div>
              </details>
              {/* Aksi 2 — Terima tawaran aktif */}
              {card.activeBid && (
                <details className="ac-card-item">
                  <summary className="ac-card-summary">
                    Terima Tawaran {card.activeBid.amountCCoin} C (dari {card.activeBid.bidderName})
                  </summary>
                  <div className="ac-card-body">
                    <div style={{ fontSize: 12, color: "var(--text-dim)" }}>
                      C.Card masuk vault — pembeli minta kirim fisik kapan saja via &quot;Kirim dari Vault&quot;.
                    </div>
                    <button
                      className="btn-gold"
                      onClick={() => onAccept(card)}
                      disabled={busyId === card.id}
                      style={{ fontSize: 12, fontFamily: "var(--font-mono)" }}
                    >
                      Terima →
                    </button>
                  </div>
                </details>
              )}
              {/* Aksi 3 — Kirim dari vault */}
              {card.location === "platform_vault" && (
                <details className="ac-card-item">
                  <summary className="ac-card-summary">Kirim dari Vault</summary>
                  <div className="ac-card-body">
                    <input
                      className="input"
                      aria-label="Alamat pengiriman"
                      placeholder="Alamat lengkap"
                      value={vaultAddr[card.id] ?? ""}
                      onChange={(e) => setVaultAddr((s) => ({ ...s, [card.id]: e.target.value }))}
                      style={{ fontSize: 12 }}
                    />
                    <div className="ac-card-row">
                      <input
                        className="input"
                        type="number"
                        min={1}
                        aria-label="Ongkir C-Coin"
                        value={vaultFee[card.id] ?? 2}
                        onChange={(e) => setVaultFee((s) => ({ ...s, [card.id]: Number(e.target.value) }))}
                        style={{ width: 100, fontSize: 12, fontFamily: "var(--font-mono)" }}
                      />
                      <button
                        className="btn-gold"
                        onClick={() => onVaultShip(card)}
                        disabled={busyId === card.id}
                        style={{ fontSize: 12, flex: 1 }}
                      >
                        Kirim
                      </button>
                    </div>
                  </div>
                </details>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

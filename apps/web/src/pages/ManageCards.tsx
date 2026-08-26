import type { Card } from "@c-verse/shared";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { RequireAuth } from "../components/RequireAuth";
import { api } from "../lib/api";
import type { ApiProfileEnrichedCard } from "../lib/api-types";
import { useAuth } from "../lib/auth";
import { useToast } from "../lib/toast";

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
  const [acceptDest, setAcceptDest] = useState<Record<string, "buyer_address" | "platform_vault">>({});
  const [acceptAddr, setAcceptAddr] = useState<Record<string, string>>({});
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
  async function onAccept(card: Card) {
    const destination = acceptDest[card.id] ?? "buyer_address";
    const addr = (acceptAddr[card.id] ?? "").trim();
    if (destination === "buyer_address" && addr.length < 10) {
      push("Alamat minimal 10 karakter", "info");
      return;
    }
    setBusyId(card.id);
    try {
      await api.acceptBidOnCard(card.id, destination, destination === "buyer_address" ? addr : undefined);
      push("Penawaran diterima", "success");
      refetch();
    } catch (e: unknown) {
      push(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setBusyId(null);
    }
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 12 }}>
        <div>
          <span className="eyebrow">Kelola</span>
          <h1 className="h2" style={{ marginTop: 4 }}>
            Kelola <em style={{ fontStyle: "italic", fontWeight: 300, color: "var(--gold)" }}>C.Card</em> — {cards.length}
          </h1>
        </div>
        <Link to="/collection" className="btn-ghost" style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>
          ← Koleksi
        </Link>
      </div>
      {cards.length === 0 ? (
        <div className="card card-pad muted" style={{ textAlign: "center", padding: 32 }}>
          Belum punya C.Card
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(300px,1fr))", gap: 14 }}>
          {cards.map((card) => (
            <div key={card.id} className="card" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
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
                  <span
                    className="pill"
                    style={{ fontSize: 10, background: "var(--surface-2)", color: "var(--text-dim)", border: "1px solid var(--border)" }}
                  >
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
              <div style={{ height: 1, background: "var(--border)", margin: "2px 0" }} />
              <div style={{ display: "flex", gap: 6 }}>
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
              {card.activeBid && (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                    padding: 10,
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                  }}
                >
                  <div style={{ fontSize: 12, fontWeight: 600 }}>
                    Terima {card.activeBid.amountCCoin} C dari {card.activeBid.bidderName}
                  </div>
                  <select
                    className="select"
                    aria-label="Tujuan pengiriman"
                    value={acceptDest[card.id] ?? "buyer_address"}
                    onChange={(e) => setAcceptDest((s) => ({ ...s, [card.id]: e.target.value as "buyer_address" | "platform_vault" }))}
                    style={{ fontSize: 12 }}
                  >
                    <option value="buyer_address">Kirim ke alamat pembeli</option>
                    <option value="platform_vault">Simpan di vault</option>
                  </select>
                  {(acceptDest[card.id] ?? "buyer_address") === "buyer_address" && (
                    <textarea
                      className="textarea"
                      rows={2}
                      aria-label="Alamat pembeli"
                      placeholder="Alamat pembeli (min 10 karakter)"
                      value={acceptAddr[card.id] ?? ""}
                      onChange={(e) => setAcceptAddr((s) => ({ ...s, [card.id]: e.target.value }))}
                      style={{ fontSize: 12 }}
                    />
                  )}
                  <button
                    className="btn-gold"
                    onClick={() => onAccept(card)}
                    disabled={busyId === card.id}
                    style={{ fontSize: 12, fontFamily: "var(--font-mono)" }}
                  >
                    Terima →
                  </button>
                </div>
              )}
              {card.location === "platform_vault" && (
                <div style={{ borderTop: "1px solid var(--border)", paddingTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
                  <div
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 11,
                      fontWeight: 500,
                      letterSpacing: "0.06em",
                      textTransform: "uppercase",
                      color: "var(--text-muted)",
                    }}
                  >
                    Kirim dari vault
                  </div>
                  <input
                    className="input"
                    aria-label="Alamat pengiriman"
                    placeholder="Alamat lengkap"
                    value={vaultAddr[card.id] ?? ""}
                    onChange={(e) => setVaultAddr((s) => ({ ...s, [card.id]: e.target.value }))}
                    style={{ fontSize: 12 }}
                  />
                  <div style={{ display: "flex", gap: 6 }}>
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
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

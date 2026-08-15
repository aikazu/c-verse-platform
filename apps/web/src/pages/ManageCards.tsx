import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useToast } from "../lib/toast";

export default function ManageCards() {
  const { user } = useAuth();
  const { push } = useToast();
  const [buyout, setBuyout] = useState<Record<string, number>>({});
  const [vaultAddr, setVaultAddr] = useState<Record<string, string>>({});
  const [vaultFee, setVaultFee] = useState<Record<string, number>>({});
  const { data, refetch } = useQuery({ queryKey: ["profile-manage"], queryFn: () => api.profile(), enabled: !!user });
  if (!user)
    return (
      <div className="card card-pad" style={{ textAlign: "center", padding: 32 }}>
        <span className="eyebrow">Kelola</span>
        <p className="muted" style={{ marginTop: 8 }}>
          Masuk untuk mengelola kartu
        </p>
        <a href="/login" style={{ color: "var(--gold)", fontSize: 13, fontWeight: 600, marginTop: 10, display: "inline-block" }}>
          Masuk →
        </a>
      </div>
    );
  const cards: any[] = (data as any)?.cards ?? [];
  async function onSetBuyout(card: any) {
    const v = buyout[card.id];
    if (v != null && (Number.isNaN(v) || v < 1)) {
      push("Minimal 1 C", "info");
      return;
    }
    try {
      if (v == null || v === 0) {
        await api.patchBuyout(card.id, null);
        push("Harga dihapus", "success");
      } else {
        await api.setBuyout(card.id, v);
        push(`Dijual ${v} C`, "success");
      }
      refetch();
    } catch (e: any) {
      push(e.message, "error");
    }
  }
  async function onVaultShip(card: any) {
    const addr = vaultAddr[card.id] ?? "";
    const fee = vaultFee[card.id] ?? 2;
    if (addr.length < 10) {
      push("Alamat minimal 10 karakter", "info");
      return;
    }
    try {
      await api.vaultShipout(card.id, addr, fee);
      push("Pengiriman dibuat", "success");
      refetch();
    } catch (e: any) {
      push(e.message, "error");
    }
  }
  async function onAccept(card: any) {
    try {
      await api.acceptBidOnCard(card.id);
      push("Penawaran diterima", "success");
      refetch();
    } catch (e: any) {
      push(e.message, "error");
    }
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 12 }}>
        <div>
          <span className="eyebrow">Kelola</span>
          <h1 className="h2" style={{ marginTop: 4 }}>
            Kelola <em style={{ fontStyle: "italic", fontWeight: 300, color: "var(--gold)" }}>Kartu</em> — {cards.length}
          </h1>
        </div>
        <Link to="/collection" className="btn-ghost" style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>
          ← Koleksi
        </Link>
      </div>
      {cards.length === 0 ? (
        <div className="card card-pad muted" style={{ textAlign: "center", padding: 32 }}>
          Belum punya kartu
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(300px,1fr))", gap: 14 }}>
          {cards.map((card: any) => (
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
                  placeholder="Harga C"
                  value={buyout[card.id] ?? card.buyoutPriceCcoin ?? ""}
                  onChange={(e) => setBuyout((s) => ({ ...s, [card.id]: e.target.value === "" ? (0 as any) : Number(e.target.value) }))}
                  style={{ flex: 1, fontSize: 12, fontFamily: "var(--font-mono)" }}
                />
                <button className="btn-gold" onClick={() => onSetBuyout(card)} style={{ fontSize: 12, padding: "7px 14px" }}>
                  Simpan
                </button>
              </div>
              {card.activeBid && (
                <button className="btn-ghost" onClick={() => onAccept(card)} style={{ fontSize: 12, fontFamily: "var(--font-mono)" }}>
                  Terima {card.activeBid.amountCCoin} C dari {card.activeBid.bidderName} →
                </button>
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
                      value={vaultFee[card.id] ?? 2}
                      onChange={(e) => setVaultFee((s) => ({ ...s, [card.id]: Number(e.target.value) }))}
                      style={{ width: 100, fontSize: 12, fontFamily: "var(--font-mono)" }}
                    />
                    <button className="btn-gold" onClick={() => onVaultShip(card)} style={{ fontSize: 12, flex: 1 }}>
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

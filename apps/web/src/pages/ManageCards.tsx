import { type Card, cardVariantLabel, SHIPMENT_FEE_CCOIN } from "@c-verse/shared";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useConfirm } from "../components/ConfirmProvider";
import { KelolaVisual } from "../components/HeroVisuals";
import { LEGAL_CONSENTS } from "../components/LegalConsentCheckbox";
import { PageHero } from "../components/PageHero";
import { RequireAuth } from "../components/RequireAuth";
import { api } from "../lib/api";
import type { ApiProfileEnrichedCard } from "../lib/api-types";
import { useAuth } from "../lib/auth";
import { useToast } from "../lib/toast";
import "./account.css";

type EnrichedCard = ApiProfileEnrichedCard;

// Fallback terakhir untuk error tanpa code-map — jangan render teks server mentah.
const GENERIC_ERROR = "Terjadi kesalahan, coba lagi";

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
  const confirm = useConfirm();
  const [buyout, setBuyout] = useState<Record<string, string>>({});
  const [vaultAddr, setVaultAddr] = useState<Record<string, string>>({});
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
      if (!(await confirm({ title: "Hapus harga buyout?", danger: true, confirmLabel: "Hapus" }))) return;
      setBusyId(card.id);
      try {
        await api.patchBuyout(card.id, null);
        push("Harga dihapus", "success");
        refetch();
      } catch (e: unknown) {
        console.error("patchBuyout gagal", e);
        push(GENERIC_ERROR, "error");
      } finally {
        setBusyId(null);
      }
      return;
    }
    const v = Number(raw);
    // Pattern CreatorPage: integer >= 1 wajib — tolak desimal/Infinity/NaN.
    if (!Number.isInteger(v) || v < 1) {
      push("Minimal 1 C", "info");
      return;
    }
    if (
      !(await confirm({
        title: `Pasang harga ${v} C?`,
        message: "Harga akan tampil sebagai penawaran buyout di secondary market.",
        confirmLabel: "Publikasikan",
        requireCheck: LEGAL_CONSENTS.listing,
      }))
    )
      return;
    setBusyId(card.id);
    try {
      await api.setBuyout(card.id, v);
      push(`Dijual ${v} C`, "success");
      refetch();
    } catch (e: unknown) {
      console.error("setBuyout gagal", e);
      push(GENERIC_ERROR, "error");
    } finally {
      setBusyId(null);
    }
  }
  async function onVaultShip(card: Card) {
    const addr = vaultAddr[card.id] ?? "";
    if (addr.length < 10) {
      push("Alamat minimal 10 karakter", "info");
      return;
    }
    // Konfirmasi: ongkir dipotong + kartu berstatus dikirim (founder 2026-08-29).
    // Fee = konstanta server SHIPMENT_FEE_CCOIN — bukan input client.
    if (
      !(await confirm({
        title: "Kirim C.Card ini?",
        message: `Ongkir ${SHIPMENT_FEE_CCOIN} C dipotong dari saldo.`,
        confirmLabel: "Kirim",
        requireCheck: LEGAL_CONSENTS.shipout,
      }))
    )
      return;
    setBusyId(card.id);
    try {
      await api.vaultShipout(card.id, addr);
      push("Pengiriman dibuat", "success");
      refetch();
    } catch (e: unknown) {
      console.error("vaultShipout gagal", e);
      push(GENERIC_ERROR, "error");
    } finally {
      setBusyId(null);
    }
  }
  async function onAccept(card: EnrichedCard) {
    // Konfirmasi: kartu berpindah kepemilikan dan tidak bisa dibatalkan (founder 2026-08-29).
    if (
      !(await confirm({
        title: `Terima tawaran ${card.activeBid?.amountCCoin} C?`,
        message: `Kartu pindah ke ${card.activeBid?.bidderName} (vault). Tidak bisa dibatalkan.`,
        confirmLabel: "Terima",
        danger: true,
        requireCheck: LEGAL_CONSENTS.acceptBid,
      }))
    )
      return;
    setBusyId(card.id);
    try {
      // Vault-only accept (founder 2026-08-28): settle straight to vault, no
      // address — buyer requests shipping later via "Kirim dari Vault".
      await api.acceptBidOnCard(card.id);
      push("Penawaran diterima — fisik disimpan di vault", "success");
      refetch();
    } catch (e: unknown) {
      console.error("acceptBid gagal", e);
      push(GENERIC_ERROR, "error");
    } finally {
      setBusyId(null);
    }
  }
  return (
    <div className="page-stack">
      <PageHero
        heroVisual={<KelolaVisual />}
        channel="10A"
        channelLabel="KELOLA"
        title="Kelola C.Card"
        desc={cards.length > 0 ? `${cards.length} unit` : undefined}
        actions={
          <Link to="/collection" className="btn-ghost" style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>
            ← Koleksi
          </Link>
        }
      />
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
                {card.drop?.title ?? "Tanpa judul"} · #{card.unitNumber}{" "}
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-dim)" }}>
                  · {cardVariantLabel(card.variant)}
                </span>
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

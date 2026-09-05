import { type Card, cardVariantLabel, MIN_SECONDARY_PRICE_CCOIN, SHIPMENT_FEE_CCOIN, type Shipment } from "@c-verse/shared";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useConfirm } from "../components/ConfirmProvider";
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
  const [returnAddr, setReturnAddr] = useState<Record<string, string>>({});
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
  const activeShipmentCardIds = new Set(
    (data?.shipments ?? [])
      .filter((shipment: Shipment) => !["delivered", "cancelled"].includes(shipment.status))
      .map((shipment) => shipment.cardId),
  );
  async function onSetBuyout(card: EnrichedCard) {
    const raw = (buyout[card.id] ?? "").trim();
    const hasExisting = card.buyoutPriceCcoin != null;
    if (raw === "") {
      if (!hasExisting) return; // tidak ada perubahan — memang belum dijual
      if (!(await confirm({ title: "Hapus harga jual?", danger: true, confirmLabel: "Hapus" }))) return;
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
    // Floor canonical secondary: split fee harus tetap menyisakan seller >= 1.
    if (!Number.isInteger(v) || v < MIN_SECONDARY_PRICE_CCOIN) {
      push(`Minimal ${MIN_SECONDARY_PRICE_CCOIN} C`, "info");
      return;
    }
    if (
      !(await confirm({
        title: `Pasang harga ${v} C?`,
        message: "C.Card akan ditawarkan di Marketplace dengan harga ini.",
        confirmLabel: "Pasang harga",
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
  async function onReturnToVault(card: Card) {
    const addr = returnAddr[card.id] ?? "";
    if (addr.length < 10) {
      push("Alamat Vault minimal 10 karakter", "info");
      return;
    }
    if (
      !(await confirm({
        title: "Kembalikan C.Card ke Vault?",
        message: "Pengiriman ke Vault gratis. Transaksi sekunder dapat diselesaikan setelah kartu diterima dan diverifikasi.",
        confirmLabel: "Kirim ke Vault",
        requireCheck: LEGAL_CONSENTS.shipout,
      }))
    )
      return;
    setBusyId(card.id);
    try {
      await api.sellerShipToVault(card.id, addr);
      push("Pengiriman ke Vault dibuat", "success");
      refetch();
    } catch (e: unknown) {
      console.error("sellerShipToVault gagal", e);
      push(GENERIC_ERROR, "error");
    } finally {
      setBusyId(null);
    }
  }
  async function onAccept(card: EnrichedCard) {
    // Konfirmasi: kartu berpindah kepemilikan dan tidak bisa dibatalkan (founder 2026-08-29).
    if (
      !(await confirm({
        title: `Terima penawaran ${card.activeBid?.amountCCoin} C?`,
        message: `Kepemilikan kartu beralih kepada ${card.activeBid?.bidderName}, dengan kartu fisik disimpan di Vault. Penjualan ini tidak bisa dibatalkan.`,
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
      push("Penawaran diterima — C.Card fisik disimpan di Vault", "success");
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
              {(() => {
                const hasActiveShipment = activeShipmentCardIds.has(card.id);
                // Drop seed tetap dapat settle dari pemilik. Kartu non-seed harus
                // diterima fisik di platform_vault terlebih dahulu.
                const needsVaultBeforeSettlement = card.drop?.isSeed !== true && card.location !== "platform_vault";
                const settlementBlocked = hasActiveShipment || needsVaultBeforeSettlement;
                const canCreateListing = !hasActiveShipment;
                return (
                  <>
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
                          Penawaran {card.activeBid.amountCCoin} C
                        </span>
                      ) : null}
                    </div>
                    <Link
                      to={`/cards/${card.id}`}
                      style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--gold)", fontWeight: 500 }}
                    >
                      Detail →
                    </Link>
                    {hasActiveShipment && (
                      <div className="muted" style={{ fontSize: 12 }}>
                        Pengiriman masih aktif. Tunggu selesai sebelum memulai atau menyelesaikan transaksi.
                      </div>
                    )}
                    {needsVaultBeforeSettlement && !hasActiveShipment && (
                      <div className="muted" style={{ fontSize: 12 }}>
                        Kembalikan C.Card ke Vault sebelum penjualan atau penawaran non-seed diselesaikan.
                      </div>
                    )}
                    {/* Aksi 1 — Pasang harga jual */}
                    <details className="ac-card-item">
                      <summary className="ac-card-summary">Pasang / Ubah Harga Jual</summary>
                      <div className="ac-card-row">
                        <input
                          className="input"
                          type="number"
                          min={MIN_SECONDARY_PRICE_CCOIN}
                          aria-label="Harga jual C-Coin"
                          placeholder={`Harga min. ${MIN_SECONDARY_PRICE_CCOIN} C (kosong = hapus)`}
                          value={buyout[card.id] ?? ""}
                          onChange={(e) => setBuyout((s) => ({ ...s, [card.id]: e.target.value }))}
                          disabled={!canCreateListing && card.buyoutPriceCcoin == null}
                          style={{ flex: 1, fontSize: 12, fontFamily: "var(--font-mono)" }}
                        />
                        <button
                          className="btn-gold"
                          onClick={() => onSetBuyout(card)}
                          disabled={busyId === card.id || (!canCreateListing && card.buyoutPriceCcoin == null)}
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
                          Terima Penawaran {card.activeBid.amountCCoin} C (dari {card.activeBid.bidderName})
                        </summary>
                        <div className="ac-card-body">
                          <div style={{ fontSize: 12, color: "var(--text-dim)" }}>
                            {settlementBlocked
                              ? "Kembalikan C.Card ke Vault dan tunggu pengiriman selesai sebelum menerima penawaran ini."
                              : 'C.Card fisik disimpan di Vault. Pembeli dapat meminta pengiriman fisik lewat "Kirim dari Vault".'}
                          </div>
                          <button
                            className="btn-gold"
                            onClick={() => onAccept(card)}
                            disabled={busyId === card.id || settlementBlocked}
                            style={{ fontSize: 12, fontFamily: "var(--font-mono)" }}
                          >
                            Terima →
                          </button>
                        </div>
                      </details>
                    )}
                    {/* Aksi 3 — Kembalikan dari pemilik ke vault. Tetap tersedia untuk
                  seed bid_pending agar seller dapat memenuhi custody sebelum settle. */}
                    {card.location === "with_owner" && (
                      <details className="ac-card-item">
                        <summary className="ac-card-summary">Kembalikan ke Vault</summary>
                        <div className="ac-card-body">
                          <div style={{ fontSize: 12, color: "var(--text-dim)" }}>
                            Gratis. Masukkan alamat penerimaan Vault; transaksi menunggu kartu diterima dan diverifikasi.
                          </div>
                          <input
                            className="input"
                            aria-label="Alamat penerimaan Vault"
                            placeholder="Alamat penerimaan Vault"
                            value={returnAddr[card.id] ?? ""}
                            onChange={(e) => setReturnAddr((s) => ({ ...s, [card.id]: e.target.value }))}
                            disabled={hasActiveShipment}
                            style={{ fontSize: 12 }}
                          />
                          <div className="ac-card-row">
                            <button
                              className="btn-gold"
                              onClick={() => onReturnToVault(card)}
                              disabled={busyId === card.id || hasActiveShipment}
                              style={{ fontSize: 12, flex: 1 }}
                            >
                              Kirim ke Vault
                            </button>
                          </div>
                        </div>
                      </details>
                    )}
                    {/* Aksi 4 — Kirim dari vault */}
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
                  </>
                );
              })()}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

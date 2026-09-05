import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { useConfirm } from "../components/ConfirmProvider";
import { LEGAL_CONSENTS } from "../components/LegalConsentCheckbox";
import { PageHero } from "../components/PageHero";
import { RequireAuth } from "../components/RequireAuth";
import { api } from "../lib/api";
import type { ApiProfileEnrichedCard, ApiProfileResponse } from "../lib/api-types";
import { ErrorState, LoadingState } from "../lib/QueryStates";
import { useToast } from "../lib/toast";
import "./account.css";

// Fallback terakhir untuk error tanpa code-map — jangan render teks server mentah.
const GENERIC_ERROR = "Terjadi kesalahan, coba lagi";

/**
 * P0-6 (audit 2026-08-24): PG-USR-07b — halaman USER untuk SELLER secondary
 * input resi pengiriman kartu ke platform vault (jalur vault) setelah sell
 * sukses dengan dest='platform_vault'. Input NFC verify + QC dilakukan ADMIN
 * via ADM-04 (di luar publik).
 *
 * Kartu eligible: location='with_owner' + buyout_price_ccoin=null (sudah sold /
 * di-transfer ke buyer, tinggal antar ke vault). Listing kartu yang dijual saja
 * tidak ditampilkan — penjual tidak perlu kirim ke vault saat masih hold kartu.
 */
export default function VerifyShipment() {
  return (
    <RequireAuth>
      <VerifyShipmentInner />
    </RequireAuth>
  );
}

function VerifyShipmentInner() {
  const { push } = useToast();
  const confirm = useConfirm();
  const { data, isLoading, isError, refetch } = useQuery<ApiProfileResponse>({
    queryKey: ["verify-shipment"],
    queryFn: () => api.profile(),
  });
  const [addr, setAddr] = useState<Record<string, string>>({});
  const [track, setTrack] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  if (isLoading) return <LoadingState />;
  if (isError || !data) return <ErrorState onRetry={() => refetch()} label="Gagal memuat data" />;
  // Eligible: kartu milik user dengan location='with_owner' yang SUDAH terjual
  // (buyoutPriceCcoin kosong artinya buyout diambil). Filter dari cards + listings.
  const myCards = data.cards ?? [];
  const eligible = myCards.filter((c) => c.location === "with_owner" && c.buyoutPriceCcoin == null);
  async function onSubmit(card: ApiProfileEnrichedCard) {
    const cardId = card.id;
    const address = (addr[cardId] ?? "").trim();
    const tracking = (track[cardId] ?? "").trim();
    if (address.length < 10) {
      push("Alamat minimal 10 karakter", "info");
      return;
    }
    if (
      !(await confirm({
        // Nomor unit, bukan UUID — label manusiawi di copy konfirmasi.
        title: `Kirim C.Card #${card.unitNumber} ke vault?`,
        message: "Setelah diterima, tim verifikasi NFC sebelum payout dilepas.",
        confirmLabel: "Kirim",
        danger: true,
        requireCheck: LEGAL_CONSENTS.sellerVault,
      }))
    )
      return;
    setBusyId(cardId);
    try {
      await api.sellerShipToVault(cardId, address, tracking || undefined);
      push("Pengiriman dicatat — admin menerima di vault", "success");
      refetch();
    } catch (e: unknown) {
      console.error("sellerShipToVault gagal", e);
      push(GENERIC_ERROR, "error");
    } finally {
      setBusyId(null);
    }
  }
  return (
    <div className="page-stack">
      <PageHero
        channel="10B"
        channelLabel="KELOLA"
        title="Kirim ke Vault"
        desc="Kirim kartu fisik ke Vault untuk verifikasi NFC. Penarikan dicairkan setelah verifikasi."
      />
      {eligible.length === 0 ? (
        <div className="card card-pad muted" style={{ textAlign: "center", padding: 32 }}>
          Tidak ada kartu yang perlu dikirim ke vault.{" "}
          <Link to="/me/manage" style={{ color: "var(--gold)" }}>
            Kelola kartu →
          </Link>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {eligible.map((card) => (
            <div key={card.id} className="card card-pad" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ fontWeight: 600, fontSize: 13 }}>
                {(card as unknown as { drop?: { title?: string } }).drop?.title ?? "Tanpa judul"} · #{card.unitNumber}
                <span className="pill pill-warn" style={{ fontSize: 10, marginLeft: 8 }}>
                  Perlu Dikirim ke Vault
                </span>
              </div>
              <div className="form-row" style={{ marginBottom: 0 }}>
                <label className="label" htmlFor={`addr-${card.id}`}>
                  Alamat platform (gudang vault)
                </label>
                <textarea
                  id={`addr-${card.id}`}
                  className="input"
                  rows={2}
                  value={addr[card.id] ?? ""}
                  onChange={(e) => setAddr((s) => ({ ...s, [card.id]: e.target.value }))}
                  placeholder="Alamat gudang vault C.Verse"
                />
              </div>
              <div className="form-row" style={{ marginBottom: 0 }}>
                <label className="label" htmlFor={`track-${card.id}`}>
                  No. Resi (opsional — bisa diisi admin nanti)
                </label>
                <input
                  id={`track-${card.id}`}
                  className="input"
                  value={track[card.id] ?? ""}
                  onChange={(e) => setTrack((s) => ({ ...s, [card.id]: e.target.value }))}
                  placeholder="JNE / J&T / SiCepat"
                />
              </div>
              <button className="btn-gold" onClick={() => onSubmit(card)} disabled={busyId === card.id}>
                {busyId === card.id ? "Mencatat…" : "Catat Pengiriman"}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

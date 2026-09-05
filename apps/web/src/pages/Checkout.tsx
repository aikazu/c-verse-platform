import { AOV_UNSIGNED_CCOIN } from "@c-verse/shared";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useConfirm } from "../components/ConfirmProvider";
import { LEGAL_CONSENTS } from "../components/LegalConsentCheckbox";
import { PageHero } from "../components/PageHero";
import type { ApiDropCardRow } from "../lib/api";
import { ApiError, api, ccoinToIdr, formatIdr } from "../lib/api";
import type { ApiDrop, ApiDropDetailResponse } from "../lib/api-types";
import { useAuth } from "../lib/auth";
import { useToast } from "../lib/toast";
import "./commerce.css";

// Fallback terakhir untuk error tanpa code-map — jangan render teks server mentah.
const GENERIC_ERROR = "Terjadi kesalahan, coba lagi";

export default function Checkout() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const { push } = useToast();
  const nav = useNavigate();
  const confirm = useConfirm();
  const [buying, setBuying] = useState(false);
  const { data, isLoading, isError } = useQuery<ApiDropDetailResponse>({
    queryKey: ["drop", id],
    queryFn: () => api.drop(id!),
    enabled: !!id,
  });
  const cardsQuery = useQuery<{ cards: ApiDropCardRow[] }>({
    queryKey: ["drop-cards", id],
    queryFn: () => api.dropCards(id!),
    enabled: !!id,
  });
  if (isLoading)
    return (
      <div className="muted" style={{ padding: 24, textAlign: "center" }}>
        Memuat…
      </div>
    );
  if (isError || !data)
    return (
      <div className="card card-pad">
        Drop tidak ditemukan.{" "}
        <Link to="/drops" style={{ color: "var(--gold)" }}>
          Kembali
        </Link>
      </div>
    );
  const drop: ApiDrop = data;
  // Pool dipilih di DropDetail FCFS dan diteruskan via query (?pool=premium);
  // nilai lain jatuh ke "regular" sesuai default checkoutSchema (@c-verse/shared).
  const pool: "regular" | "premium" = searchParams.get("pool") === "premium" ? "premium" : "regular";
  // Mirror coalesce harga RPC checkout (supabase/migrations/04_rpc.sql):
  // premium -> priceSignedCCoin dulu, regular -> priceCcoin dulu. Server
  // tetap source of truth saat debit.
  const priceRegular = drop.priceCcoin ?? drop.priceUnsignedCCoin ?? AOV_UNSIGNED_CCOIN;
  const price =
    pool === "premium" ? (drop.priceSignedCCoin ?? drop.priceCcoin ?? drop.priceUnsignedCCoin ?? AOV_UNSIGNED_CCOIN) : priceRegular;
  const phaseAllowsFcfs =
    !!drop.drawnAt &&
    !["sold_out", "closed", "cancelled"].includes(drop.status) &&
    (!drop.dropEndAt || new Date(drop.dropEndAt).getTime() > Date.now());
  const selectedVariant = pool === "premium" ? "signed" : "unsigned";
  const selectedPoolAvailable = (cardsQuery.data?.cards ?? []).some(
    (card) => card.variant === selectedVariant && card.status === "inventory",
  );
  const canCheckout = phaseAllowsFcfs && selectedPoolAvailable;

  if (cardsQuery.isLoading) {
    return (
      <div className="muted" style={{ padding: 24, textAlign: "center" }}>
        Memeriksa ketersediaan…
      </div>
    );
  }

  if (cardsQuery.isError || !canCheckout) {
    return (
      <div className="cm-shell">
        <PageHero channel="14" channelLabel="CHECKOUT" title="Checkout belum tersedia" />
        <div className="card card-pad">
          <p className="muted">Pool ini belum memasuki fase FCFS atau unitnya sudah habis. Pilih pool yang tersedia dari detail Drop.</p>
          <Link to={`/drops/${drop.id}`} className="btn-gold">
            Kembali ke {drop.title}
          </Link>
        </div>
      </div>
    );
  }
  async function onCheckout() {
    if (!user) {
      push("Masuk untuk melanjutkan pembelian", "info");
      nav("/login", { state: { from: `/drops/${drop.id}/checkout${pool === "premium" ? "?pool=premium" : ""}` } });
      return;
    }
    if (
      !(await confirm({
        title: `Bayar ${price} C?`,
        message: "Pembelian diproses langsung dan C.Card disimpan di Vault.",
        confirmLabel: "Bayar",
        requireCheck: LEGAL_CONSENTS.checkout,
      }))
    )
      return;
    setBuying(true);
    try {
      // Vault-only purchase (founder 2026-08-28): settle straight to vault,
      // physical shipping requested later via ManageCards vault-shipout.
      const res = await api.checkout(drop.id, pool);
      push(`Pembelian berhasil (${price} C). Kartu disimpan di Vault.`, "success");
      nav(`/orders/${res.order.id}`);
    } catch (e: unknown) {
      const err = e instanceof ApiError ? e : null;
      if (err?.code === "INSUFFICIENT" || err?.status === 402) {
        push("Saldo C-Coin tidak cukup. Isi saldo untuk melanjutkan.", "error");
        nav("/wallet");
      } else if (["SOLD_OUT", "INVALID_POOL", "DROP_NOT_FCFS"].includes(err?.code ?? "")) {
        push("Unit sudah habis atau pool tidak lagi tersedia.", "error");
        nav(`/drops/${drop.id}`);
      } else {
        // Raw server text tidak untuk user — catat di console, tampilkan fallback generik.
        console.error("checkout gagal", e);
        push(GENERIC_ERROR, "error");
      }
    } finally {
      setBuying(false);
    }
  }
  return (
    <div className="cm-shell">
      <PageHero
        channel="14"
        channelLabel="CHECKOUT"
        title="Checkout"
        actions={
          <Link to={`/drops/${drop.id}`} className="btn-ghost cm-back">
            ← {drop.title}
          </Link>
        }
      />
      <div className="card card-pad">
        <span className="eyebrow">Ringkasan</span>
        <h2 className="h2" style={{ marginTop: 4 }}>
          {drop.title}
        </h2>
        <p className="muted" style={{ marginTop: 4 }}>
          {drop.series}
        </p>
        <div className="cm-summary">
          <div>
            <div className="label">HARGA</div>
            <div className="cm-summary-value">
              {price} C · <span className="cm-summary-idr">{formatIdr(ccoinToIdr(price))}</span>
            </div>
          </div>
          <div>
            <div className="label">TERSEDIA</div>
            <div className="cm-summary-value-avail">{drop.totalUnits - drop.soldCount} kartu</div>
          </div>
          <div>
            <div className="label cm-summary-label-gold">TOTAL</div>
            <div className="cm-summary-total">{price} C</div>
          </div>
        </div>
      </div>
      <div className="card card-pad">
        <div className="label cm-form-label">Penyimpanan</div>
        <div className="muted cm-panel-note">
          Kartu disimpan di Vault. Kamu bisa meminta pengiriman melalui{" "}
          <Link to="/me/manage" style={{ color: "var(--gold)" }}>
            Kelola C.Card
          </Link>
          .
        </div>
        <button className="btn-gold cm-cta" onClick={onCheckout} disabled={buying}>
          {buying ? "Memproses…" : `Bayar ${price} C →`}
        </button>
      </div>
    </div>
  );
}

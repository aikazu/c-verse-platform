import { AOV_UNSIGNED_CCOIN } from "@c-verse/shared";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, formatIdr } from "../lib/api";
import type { ApiDrop, ApiDropDetailResponse } from "../lib/api-types";
import { useAuth } from "../lib/auth";
import { useToast } from "../lib/toast";
import "./commerce.css";

const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export default function Checkout() {
  const { id } = useParams();
  const { user } = useAuth();
  const { push } = useToast();
  const nav = useNavigate();
  const [delivery, setDelivery] = useState<"shipping" | "vault">("vault");
  const [addr, setAddr] = useState("");
  const [fee, setFee] = useState(2);
  const [buying, setBuying] = useState(false);
  const { data, isLoading } = useQuery<ApiDropDetailResponse>({
    queryKey: ["drop", id],
    queryFn: () => api.drop(id!),
    enabled: !!id,
  });
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
  const drop: ApiDrop = data;
  const price = drop.priceCcoin ?? drop.priceUnsignedCCoin ?? AOV_UNSIGNED_CCOIN;
  const total = price + (delivery === "shipping" ? fee : 0);
  async function onCheckout() {
    if (!user) {
      push("Silakan login dulu", "info");
      nav("/login");
      return;
    }
    setBuying(true);
    try {
      const res = await api.checkout({
        dropId: drop.id,
        deliveryOption: delivery,
        shippingAddress: delivery === "shipping" ? addr : null,
        shippingFeeCcoin: delivery === "shipping" ? fee : null,
      });
      push(`Checkout berhasil — ${total} C`, "success");
      nav(`/orders/${res.order.id}`);
    } catch (e: unknown) {
      push(errorMessage(e), "error");
    } finally {
      setBuying(false);
    }
  }
  return (
    <div className="cm-shell">
      <section className="page-hero" aria-label="Header halaman Checkout">
        <div className="page-hero-rail">
          <span className="rail-channel">CH:14 / CHECKOUT</span>
          <span className="rail-dot" aria-hidden="true" />
          <span className="rail-sep">·</span>
          <span className="rail-extra">ACQUISITION SEQUENCE</span>
          <span className="rail-time" aria-label="Siap">
            <span className="rail-cursor" aria-hidden="true" />
          </span>
        </div>
        <div className="page-hero-inner">
          <div className="page-hero-copy">
            <h1 className="page-hero-title">
              Check<em>out</em>
            </h1>
          </div>
          <Link to={`/drops/${drop.id}`} className="btn-ghost cm-back">
            ← {drop.title}
          </Link>
        </div>
      </section>
      <div className="card card-pad">
        <span className="eyebrow">Checkout</span>
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
              {price} C · <span className="cm-summary-idr">{formatIdr(price * 10000)}</span>
            </div>
          </div>
          <div>
            <div className="label">TERSEDIA</div>
            <div className="cm-summary-value-avail">{drop.totalUnits - drop.soldCount} unit</div>
          </div>
          <div>
            <div className="label cm-summary-label-gold">TOTAL</div>
            <div className="cm-summary-total">{total} C</div>
          </div>
        </div>
      </div>
      <div className="card card-pad">
        <div className="label cm-form-label">Pengiriman</div>
        <div className="cm-radio-row">
          <label className={`cm-radio-card${delivery === "vault" ? " cm-radio-card-active" : ""}`}>
            <input type="radio" className="cm-radio" checked={delivery === "vault"} onChange={() => setDelivery("vault")} />{" "}
            <span>
              <span className="cm-radio-title">Simpan di vault</span>
              <br />
              <span className="muted cm-radio-desc">Disimpan platform, kirim kapan saja</span>
            </span>
          </label>
          <label className={`cm-radio-card${delivery === "shipping" ? " cm-radio-card-active" : ""}`}>
            <input type="radio" className="cm-radio" checked={delivery === "shipping"} onChange={() => setDelivery("shipping")} />{" "}
            <span>
              <span className="cm-radio-title">Kirim sekarang</span>
              <br />
              <span className="muted cm-radio-desc">Masukkan alamat + ongkir</span>
            </span>
          </label>
        </div>
        {delivery === "shipping" && (
          <div className="cm-fields">
            <div>
              <label className="label" htmlFor="checkout-address">
                Alamat
              </label>
              <textarea
                id="checkout-address"
                className="input"
                value={addr}
                onChange={(e) => setAddr(e.target.value)}
                rows={3}
                placeholder="Alamat lengkap"
              />
            </div>
            <div>
              <label className="label" htmlFor="checkout-fee">
                Ongkir (C-Coin)
              </label>
              <input
                id="checkout-fee"
                className="input cm-fee-input"
                type="number"
                min={1}
                value={fee}
                onChange={(e) => setFee(Math.max(1, Number(e.target.value) || 1))}
              />
            </div>
          </div>
        )}
        <button className="btn-gold cm-cta" onClick={onCheckout} disabled={buying}>
          {buying ? "Memproses…" : `Bayar ${total} C →`}
        </button>
      </div>
    </div>
  );
}

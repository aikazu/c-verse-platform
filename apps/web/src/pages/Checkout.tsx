import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, formatIdr } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useToast } from "../lib/toast";

export default function Checkout() {
  const { id } = useParams();
  const { user } = useAuth();
  const { push } = useToast();
  const nav = useNavigate();
  const [delivery, setDelivery] = useState<"shipping" | "vault">("vault");
  const [addr, setAddr] = useState("");
  const [fee, setFee] = useState(2);
  const [buying, setBuying] = useState(false);
  const { data, isLoading } = useQuery({ queryKey: ["drop", id], queryFn: () => api.drop(id!), enabled: !!id });
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
  const d: any = (data as any).title ? (data as any) : ((data as any).drop ?? data);
  const drop = d.title ? d : d;
  const price = drop.priceCcoin ?? drop.priceUnsignedCCoin ?? 30;
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
      } as any);
      push(`Checkout berhasil — ${total} C`, "success");
      nav(`/orders/${res.order.id}`);
    } catch (e: any) {
      push(e.message, "error");
    } finally {
      setBuying(false);
    }
  }
  return (
    <div style={{ maxWidth: 680, margin: "0 auto", display: "flex", flexDirection: "column", gap: 18 }}>
      <Link to={`/drops/${drop.id}`} style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-muted)" }}>
        ← {drop.title}
      </Link>
      <div className="card card-pad">
        <span className="eyebrow">Checkout</span>
        <h2 className="h2" style={{ marginTop: 4 }}>
          {drop.title}
        </h2>
        <p className="muted" style={{ marginTop: 4 }}>
          {drop.series}
        </p>
        <div style={{ display: "flex", gap: 20, marginTop: 16, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-dim)", letterSpacing: "0.08em" }}>HARGA</div>
            <div style={{ fontWeight: 700, fontSize: 15, marginTop: 2 }}>
              {price} C · <span style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 400 }}>{formatIdr(price * 10000)}</span>
            </div>
          </div>
          <div>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-dim)", letterSpacing: "0.08em" }}>TERSEDIA</div>
            <div style={{ fontWeight: 600, fontSize: 14, marginTop: 2 }}>{drop.totalUnits - drop.soldCount} unit</div>
          </div>
          <div>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--gold)", letterSpacing: "0.08em", fontWeight: 600 }}>
              TOTAL
            </div>
            <div style={{ fontWeight: 800, fontSize: 16, color: "var(--gold)", marginTop: 2 }}>{total} C</div>
          </div>
        </div>
      </div>
      <div className="card card-pad">
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            fontWeight: 500,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "var(--text-muted)",
            marginBottom: 12,
          }}
        >
          Pengiriman
        </div>
        <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
          <label
            style={{
              flex: 1,
              display: "flex",
              gap: 10,
              padding: "14px 16px",
              border: `1px solid ${delivery === "vault" ? "var(--gold)" : "var(--border)"}`,
              borderRadius: 10,
              cursor: "pointer",
              background: delivery === "vault" ? "rgba(201,163,82,0.06)" : "transparent",
              transition: "all var(--motion-fast)",
            }}
          >
            <input
              type="radio"
              checked={delivery === "vault"}
              onChange={() => setDelivery("vault")}
              style={{ accentColor: "var(--gold)" }}
            />{" "}
            <span>
              <span style={{ fontWeight: 600, fontSize: 13 }}>Simpan di vault</span>
              <br />
              <span className="muted" style={{ fontSize: 11 }}>
                Disimpan platform, kirim kapan saja
              </span>
            </span>
          </label>
          <label
            style={{
              flex: 1,
              display: "flex",
              gap: 10,
              padding: "14px 16px",
              border: `1px solid ${delivery === "shipping" ? "var(--gold)" : "var(--border)"}`,
              borderRadius: 10,
              cursor: "pointer",
              background: delivery === "shipping" ? "rgba(201,163,82,0.06)" : "transparent",
              transition: "all var(--motion-fast)",
            }}
          >
            <input
              type="radio"
              checked={delivery === "shipping"}
              onChange={() => setDelivery("shipping")}
              style={{ accentColor: "var(--gold)" }}
            />{" "}
            <span>
              <span style={{ fontWeight: 600, fontSize: 13 }}>Kirim sekarang</span>
              <br />
              <span className="muted" style={{ fontSize: 11 }}>
                Masukkan alamat + ongkir
              </span>
            </span>
          </label>
        </div>
        {delivery === "shipping" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 14 }}>
            <div>
              <label className="label">Alamat</label>
              <textarea className="input" value={addr} onChange={(e) => setAddr(e.target.value)} rows={3} placeholder="Alamat lengkap" />
            </div>
            <div>
              <label className="label">Ongkir (C-Coin)</label>
              <input
                className="input"
                type="number"
                min={1}
                value={fee}
                onChange={(e) => setFee(Math.max(1, Number(e.target.value) || 1))}
                style={{ maxWidth: 140 }}
              />
            </div>
          </div>
        )}
        <button className="btn-gold" onClick={onCheckout} disabled={buying} style={{ width: "100%", padding: "13px", fontSize: 14 }}>
          {buying ? "Memproses…" : `Bayar ${total} C →`}
        </button>
      </div>
    </div>
  );
}

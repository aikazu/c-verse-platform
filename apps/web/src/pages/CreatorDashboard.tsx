import { useQuery } from "@tanstack/react-query";
import type React from "react";
import { useState } from "react";
import { api, formatIdr } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useToast } from "../lib/toast";

export default function CreatorDashboard() {
  const { user } = useAuth();
  const { push } = useToast();
  const [form, setForm] = useState({ title: "", series: "", narrative: "", totalUnits: 15, priceCcoin: 30 });

  const { data: dropsData, refetch } = useQuery({ queryKey: ["creator-drops"], queryFn: () => api.drops({}) });

  if (!user)
    return (
      <div className="card card-pad" style={{ textAlign: "center", padding: 32 }}>
        <span className="eyebrow">Kreator</span>
        <p className="muted" style={{ marginTop: 8 }}>
          Masuk untuk mengakses dashboard
        </p>
        <a href="/login" style={{ color: "var(--gold)", fontSize: 13, fontWeight: 600, marginTop: 10, display: "inline-block" }}>
          Masuk →
        </a>
      </div>
    );
  if ((user.role as string) !== "creator" && (user.role as string) !== "admin")
    return (
      <div className="card card-pad" style={{ textAlign: "center", padding: 32 }}>
        <p className="muted">Hanya kreator yang bisa mengakses halaman ini</p>
      </div>
    );

  const myDrops: any[] = (dropsData as any)?.drops?.filter((d: any) => d.creatorId === user.id || (user.role as string) === "admin") ?? [];

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api.createDrop({
        title: form.title,
        series: form.series,
        narrative: form.narrative,
        totalUnits: Number(form.totalUnits),
        priceCcoin: Number(form.priceCcoin),
      } as any);
      push("Drop dibuat", "success");
      refetch();
      setForm({ title: "", series: "", narrative: "", totalUnits: 15, priceCcoin: 30 });
    } catch (err: any) {
      push(err.message, "error");
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div>
        <span className="eyebrow">Kreator</span>
        <h1 className="h2" style={{ marginTop: 4 }}>
          Dashboard
        </h1>
      </div>

      <div className="card card-pad" style={{ background: "var(--surface-2)" }}>
        <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
          <div>
            <div
              style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-dim)", fontWeight: 500, letterSpacing: "0.08em" }}
            >
              TOTAL DROPS
            </div>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 26, fontWeight: 500, marginTop: 4 }}>{myDrops.length}</div>
          </div>
          <div>
            <div
              style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-dim)", fontWeight: 500, letterSpacing: "0.08em" }}
            >
              TERJUAL
            </div>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 26, fontWeight: 500, marginTop: 4 }}>
              {myDrops.reduce((n: any, d: any) => n + d.soldCount, 0)}
            </div>
          </div>
          <div>
            <div
              style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-dim)", fontWeight: 500, letterSpacing: "0.08em" }}
            >
              EST. GMV
            </div>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 15, fontWeight: 600, marginTop: 6 }}>
              {formatIdr(myDrops.reduce((n: any, d: any) => n + d.soldCount * ((d.priceCcoin ?? d.priceUnsignedCCoin) * 10000), 0))}
            </div>
          </div>
        </div>
      </div>

      <div className="grid-2" style={{ alignItems: "start" }}>
        <form onSubmit={onCreate} className="card card-pad" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ fontWeight: 600, fontSize: 14 }}>Buat Drop</div>
          <div className="form-row" style={{ marginBottom: 0 }}>
            <label className="label">Judul</label>
            <input
              className="input"
              value={form.title}
              onChange={(e) => setForm((s) => ({ ...s, title: e.target.value }))}
              required
              placeholder="Karina — Limited Genesis"
            />
          </div>
          <div className="form-row" style={{ marginBottom: 0 }}>
            <label className="label">Seri</label>
            <input
              className="input"
              value={form.series}
              onChange={(e) => setForm((s) => ({ ...s, series: e.target.value }))}
              required
              placeholder="HypeCreator X Aespa"
            />
          </div>
          <div className="form-row" style={{ marginBottom: 0 }}>
            <label className="label">Deskripsi</label>
            <textarea
              className="textarea"
              value={form.narrative}
              onChange={(e) => setForm((s) => ({ ...s, narrative: e.target.value }))}
              required
              placeholder="Cerita kolaborasi…"
            />
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <div className="form-row" style={{ flex: 1, marginBottom: 0 }}>
              <label className="label">Total unit</label>
              <input
                className="input"
                type="number"
                value={form.totalUnits}
                onChange={(e) => setForm((s) => ({ ...s, totalUnits: Number(e.target.value) }))}
                min={1}
                max={1000}
              />
            </div>
            <div className="form-row" style={{ flex: 1, marginBottom: 0 }}>
              <label className="label">Harga (C)</label>
              <input
                className="input"
                type="number"
                value={form.priceCcoin}
                onChange={(e) => setForm((s) => ({ ...s, priceCcoin: Number(e.target.value) }))}
                min={1}
              />
            </div>
          </div>
          <button className="btn-gold" style={{ padding: "11px", width: "100%" }}>
            Buat Draft
          </button>
        </form>
        <div className="card">
          <div
            style={{
              padding: "14px 16px",
              fontWeight: 600,
              fontSize: 13,
              borderBottom: "1px solid var(--border)",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <span>Drops Saya</span>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-dim)" }}>{myDrops.length}</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            {myDrops.length === 0 ? (
              <div style={{ padding: 24, textAlign: "center", color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: 12 }}>
                Belum ada drop
              </div>
            ) : (
              myDrops.map((d: any) => (
                <div
                  key={d.id}
                  style={{
                    padding: "12px 16px",
                    borderBottom: "1px solid var(--border)",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 10,
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{d.title}</div>
                    <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-muted)" }}>
                      {d.series} · {d.soldCount}/{d.totalUnits} · {d.priceCcoin ?? d.priceUnsignedCCoin} C
                    </div>
                  </div>
                  <span
                    className={`pill ${d.status === "live" ? "pill-success" : d.status === "draft" ? "pill-warn" : "pill-info"}`}
                    style={{ fontSize: 10 }}
                  >
                    {d.status}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

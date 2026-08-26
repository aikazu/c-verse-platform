import { useQuery } from "@tanstack/react-query";
import type React from "react";
import { useState } from "react";
import { RequireAuth } from "../components/RequireAuth";
import { StatusBadge } from "../components/StatusBadge";
import { api, formatIdr } from "../lib/api";
import type { ApiDrop, ApiDropsResponse } from "../lib/api-types";
import { useAuth } from "../lib/auth";
import { useToast } from "../lib/toast";

const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export default function CreatorDashboard() {
  return (
    <RequireAuth>
      <CreatorDashboardInner />
    </RequireAuth>
  );
}

function CreatorDashboardInner() {
  const { user } = useAuth();
  const { push } = useToast();
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({
    title: "",
    series: "",
    narrative: "",
    totalUnits: 15,
    priceCcoin: 30,
    releaseDate: today,
    releaseTime: "12:00",
  });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const { data: dropsData, refetch } = useQuery<ApiDropsResponse>({ queryKey: ["creator-drops"], queryFn: () => api.drops({}) });

  // RequireAuth di atas menjamin user non-null di sini; narrow untuk typecheck.
  if (!user) return null;
  if (user.role !== "creator" && user.role !== "admin")
    return (
      <div className="card card-pad" style={{ textAlign: "center", padding: 32 }}>
        <span className="eyebrow">Kreator</span>
        <p className="muted" style={{ marginTop: 8 }}>
          Dashboard kreator hanya untuk akun kreator. Akun kreator disediakan tim C.Verse via deal memo offline — tidak ada registrasi
          publik.
        </p>
        <div className="muted" style={{ marginTop: 14, fontSize: 12 }}>
          Sudah deal memo tapi belum punya akun? Hubungi tim untuk aktivasi.
        </div>
      </div>
    );

  const myDrops: ApiDrop[] = (dropsData?.drops ?? []).filter((d) => d.creatorId === user.id || user.role === "admin");

  async function onPublish(id: string, status: string) {
    if (
      status === "cancelled" &&
      !window.confirm("Batalkan drop ini? Drop yang sedang tayang akan dihentikan dan aksi ini tidak dapat dibatalkan.")
    ) {
      return;
    }
    setBusyId(id);
    try {
      await api.publishDrop(id, status);
      push(
        status === "scheduled" ? "Drop dijadwalkan rilis" : status === "draft" ? "Drop dikembalikan ke draft" : "Drop dibatalkan",
        "success",
      );
      refetch();
    } catch (err: unknown) {
      push(errorMessage(err), "error");
    } finally {
      setBusyId(null);
    }
  }

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    try {
      await api.createDrop({
        title: form.title,
        series: form.series,
        narrative: form.narrative,
        totalUnits: Number(form.totalUnits),
        priceCcoin: Number(form.priceCcoin),
        dropStartAt: `${form.releaseDate}T${form.releaseTime}:00+07:00`,
      });
      push("Drop dibuat", "success");
      refetch();
      setForm({ title: "", series: "", narrative: "", totalUnits: 15, priceCcoin: 30, releaseDate: today, releaseTime: "12:00" });
    } catch (err: unknown) {
      push(errorMessage(err), "error");
    } finally {
      setCreating(false);
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
              {myDrops.reduce((n, d) => n + d.soldCount, 0)}
            </div>
          </div>
          <div>
            <div
              style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-dim)", fontWeight: 500, letterSpacing: "0.08em" }}
            >
              EST. GMV
            </div>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 15, fontWeight: 600, marginTop: 6 }}>
              {formatIdr(myDrops.reduce((n, d) => n + d.soldCount * ((d.priceCcoin ?? d.priceUnsignedCCoin) * 10000), 0))}
            </div>
          </div>
        </div>
      </div>

      <div className="grid-2" style={{ alignItems: "start" }}>
        <form onSubmit={onCreate} className="card card-pad" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ fontWeight: 600, fontSize: 14 }}>Buat Drop</div>
          <div className="form-row" style={{ marginBottom: 0 }}>
            <label className="label" htmlFor="cd-title">
              Judul
            </label>
            <input
              id="cd-title"
              className="input"
              value={form.title}
              onChange={(e) => setForm((s) => ({ ...s, title: e.target.value }))}
              required
              placeholder="Karina — Limited Genesis"
            />
          </div>
          <div className="form-row" style={{ marginBottom: 0 }}>
            <label className="label" htmlFor="cd-series">
              Seri
            </label>
            <input
              id="cd-series"
              className="input"
              value={form.series}
              onChange={(e) => setForm((s) => ({ ...s, series: e.target.value }))}
              required
              placeholder="HypeCreator X Aespa"
            />
          </div>
          <div className="form-row" style={{ marginBottom: 0 }}>
            <label className="label" htmlFor="cd-narrative">
              Deskripsi
            </label>
            <textarea
              id="cd-narrative"
              className="textarea"
              value={form.narrative}
              onChange={(e) => setForm((s) => ({ ...s, narrative: e.target.value }))}
              required
              placeholder="Cerita kolaborasi…"
            />
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <div className="form-row" style={{ flex: 1, marginBottom: 0 }}>
              <label className="label" htmlFor="cd-units">
                Total unit
              </label>
              <input
                id="cd-units"
                className="input"
                type="number"
                value={form.totalUnits}
                onChange={(e) => setForm((s) => ({ ...s, totalUnits: Number(e.target.value) }))}
                min={1}
                max={1000}
              />
            </div>
            <div className="form-row" style={{ flex: 1, marginBottom: 0 }}>
              <label className="label" htmlFor="cd-price">
                Harga (C)
              </label>
              <input
                id="cd-price"
                className="input"
                type="number"
                value={form.priceCcoin}
                onChange={(e) => setForm((s) => ({ ...s, priceCcoin: Number(e.target.value) }))}
                min={1}
              />
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <div className="form-row" style={{ flex: 1, marginBottom: 0 }}>
              <label className="label" htmlFor="cd-date">
                Tanggal rilis
              </label>
              <input
                id="cd-date"
                className="input"
                type="date"
                value={form.releaseDate}
                onChange={(e) => setForm((s) => ({ ...s, releaseDate: e.target.value }))}
              />
            </div>
            <div className="form-row" style={{ flex: 1, marginBottom: 0 }}>
              <label className="label" htmlFor="cd-time">
                Jam (WIB)
              </label>
              <input
                id="cd-time"
                className="input"
                type="time"
                value={form.releaseTime}
                onChange={(e) => setForm((s) => ({ ...s, releaseTime: e.target.value }))}
              />
            </div>
          </div>
          <div className="muted" style={{ fontSize: 11 }}>
            Window raffle 24 jam otomatis setelah rilis; pembagian via draw.
          </div>
          <button className="btn-gold" disabled={creating} style={{ padding: "11px", width: "100%" }}>
            {creating ? "Membuat…" : "Buat Draft"}
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
              myDrops.map((d) => (
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
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                    {d.status === "draft" && (
                      <button
                        className="btn-gold"
                        onClick={() => onPublish(d.id, "scheduled")}
                        disabled={busyId === d.id}
                        style={{ fontSize: 11, padding: "6px 12px" }}
                      >
                        Publish
                      </button>
                    )}
                    {(d.status === "scheduled" || d.status === "live") && (
                      <button
                        className="btn-ghost"
                        onClick={() => onPublish(d.id, d.status === "scheduled" ? "draft" : "cancelled")}
                        disabled={busyId === d.id}
                        style={{ fontSize: 11, padding: "6px 12px" }}
                      >
                        Batalkan
                      </button>
                    )}
                    <StatusBadge status={d.status} kind="drop" style={{ fontSize: 10 }} />
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

import { useEffect, useState } from "react";
import { useConfirm } from "../components/ConfirmProvider";
import { StatusBadge } from "../components/StatusBadge";
import { apiFetch } from "../lib/api";
import { supabase } from "../lib/supabase";
import type { DropRow } from "../lib/types";
import { errMessage } from "../lib/utils";

export function DropsPage() {
  const confirm = useConfirm();
  const [rows, setRows] = useState<DropRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({
    title: "",
    series: "",
    narrative: "",
    artworkUrl: "",
    totalUnits: 15,
    priceCcoin: 30,
    dropStartAt: "",
  });
  const [msg, setMsg] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true);
    const { data } = await supabase
      .from("drops")
      .select("id,title,series,status,total_units,sold_count,price_ccoin,price_unsigned_ccoin,raffle_end_at,drawn_at,created_at")
      .order("created_at", { ascending: false })
      .limit(500);
    setRows((data ?? []) as DropRow[]);
    setLoading(false);
  }
  useEffect(() => {
    load();
  }, []);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    setCreating(true);
    try {
      await apiFetch("/api/drops", {
        method: "POST",
        body: JSON.stringify({
          title: form.title,
          series: form.series,
          narrative: form.narrative,
          artworkUrl: form.artworkUrl,
          totalUnits: Number(form.totalUnits),
          priceCcoin: Number(form.priceCcoin),
          ...(form.dropStartAt ? { dropStartAt: new Date(form.dropStartAt).toISOString() } : {}),
        }),
      });
      setMsg("Drop dibuat (draft) — signed/unsigned split & harga dihitung server-side");
      setForm({ title: "", series: "", narrative: "", artworkUrl: "", totalUnits: 15, priceCcoin: 30, dropStartAt: "" });
      load();
    } catch (err) {
      setMsg(errMessage(err));
    } finally {
      setCreating(false);
    }
  }

  async function setStatus(id: string, status: string) {
    const labels: Record<string, string> = { published: "publish", live: "jadikan live", closed: "tutup" };
    if (
      !(await confirm({
        title: `Ubah status drop menjadi "${status}" (${labels[status] ?? status})?`,
        confirmLabel: "Ubah",
        danger: status === "closed",
      }))
    )
      return;
    setMsg(null);
    setBusy(true);
    try {
      await apiFetch(`/api/drops/${id}/status`, { method: "PATCH", body: JSON.stringify({ status }) });
      load();
    } catch (err) {
      setMsg(errMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function draw(id: string) {
    if (
      !(await confirm({
        title: "Jalankan draw undian sekarang?",
        message: "Pemenang ditentukan permanen dan tidak bisa diulang.",
        confirmLabel: "Jalankan Draw",
        danger: true,
      }))
    )
      return;
    setMsg(null);
    setBusy(true);
    try {
      const { winners } = await apiFetch<{ winners: number }>(`/api/drops/${id}/draw`, { method: "POST" });
      setMsg(`Draw selesai — ${winners} pemenang`);
      load();
    } catch (err) {
      setMsg(errMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="admin-page">
      <div className="admin-page-head">
        <h2>Drops</h2>
        <p className="muted">Kelola koleksi dan jadwal rilis</p>
      </div>
      <form onSubmit={onCreate} className="card card-pad" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ fontWeight: 700, fontSize: 13 }}>Buat Drop</div>
        <label className="label" htmlFor="drop-title">
          Judul
        </label>
        <input
          id="drop-title"
          className="input"
          placeholder="Judul"
          value={form.title}
          onChange={(e) => setForm((s) => ({ ...s, title: e.target.value }))}
          required
        />
        <label className="label" htmlFor="drop-series">
          Seri
        </label>
        <input
          id="drop-series"
          className="input"
          placeholder="Seri"
          value={form.series}
          onChange={(e) => setForm((s) => ({ ...s, series: e.target.value }))}
          required
        />
        <label className="label" htmlFor="drop-narrative">
          Deskripsi
        </label>
        <textarea
          id="drop-narrative"
          className="input"
          placeholder="Deskripsi (min. 10 karakter)"
          value={form.narrative}
          onChange={(e) => setForm((s) => ({ ...s, narrative: e.target.value }))}
          required
          minLength={10}
          rows={2}
        />
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div style={{ flex: 1, minWidth: 160 }}>
            <label className="label" htmlFor="drop-artwork">
              URL artwork
            </label>
            <input
              id="drop-artwork"
              className="input"
              type="url"
              placeholder="https://…"
              value={form.artworkUrl}
              onChange={(e) => setForm((s) => ({ ...s, artworkUrl: e.target.value }))}
              style={{ width: "100%" }}
            />
          </div>
          <div style={{ width: 120 }}>
            <label className="label" htmlFor="drop-units">
              Total unit
            </label>
            <input
              id="drop-units"
              className="input"
              type="number"
              min={1}
              max={1000}
              value={form.totalUnits}
              onChange={(e) => setForm((s) => ({ ...s, totalUnits: Number(e.target.value) }))}
              style={{ width: "100%" }}
            />
          </div>
          <div style={{ width: 120 }}>
            <label className="label" htmlFor="drop-price">
              Harga (C)
            </label>
            <input
              id="drop-price"
              className="input"
              type="number"
              min={1}
              value={form.priceCcoin}
              onChange={(e) => setForm((s) => ({ ...s, priceCcoin: Number(e.target.value) }))}
              style={{ width: "100%" }}
            />
          </div>
        </div>
        <label className="label" htmlFor="drop-start">
          Waktu rilis (opsional)
        </label>
        <input
          id="drop-start"
          className="input"
          type="datetime-local"
          value={form.dropStartAt}
          onChange={(e) => setForm((s) => ({ ...s, dropStartAt: e.target.value }))}
        />
        <button className="btn-gold" style={{ alignSelf: "start" }} disabled={creating}>
          {creating ? "Membuat…" : "Buat Draft"}
        </button>
        {msg && (
          <div className="admin-msg" role="status" aria-live="polite">
            {msg}
          </div>
        )}
      </form>
      <div className="card">
        <div className="admin-table-head">Daftar — {rows.length}</div>
        {loading ? (
          <div style={{ padding: 20 }} className="muted">
            Memuat…
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Judul</th>
                  <th>Status</th>
                  <th>Unit</th>
                  <th>Harga</th>
                  <th>Aksi</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="empty-state">
                      Belum ada data
                    </td>
                  </tr>
                ) : (
                  rows.map((r) => (
                    <tr key={r.id}>
                      <td style={{ fontWeight: 700, fontSize: 12 }}>{r.title}</td>
                      <td>
                        <StatusBadge status={r.status} kind="drop" />
                        {r.drawn_at ? (
                          <span className="pill" style={{ marginLeft: 4 }}>
                            drawn
                          </span>
                        ) : null}
                      </td>
                      <td>
                        {r.sold_count ?? 0}/{r.total_units}
                      </td>
                      <td>{r.price_ccoin ?? r.price_unsigned_ccoin ?? "—"} C</td>
                      <td className="flex-gap-6 flex-wrap">
                        <button className="btn-ghost admin-mini" onClick={() => setStatus(r.id, "published")} disabled={busy}>
                          Publish
                        </button>
                        <button className="btn-ghost admin-mini" onClick={() => setStatus(r.id, "live")} disabled={busy}>
                          Live
                        </button>
                        <button className="btn-ghost admin-mini" onClick={() => setStatus(r.id, "closed")} disabled={busy}>
                          Tutup
                        </button>
                        {r.raffle_end_at && !r.drawn_at && (
                          <button className="btn-gold admin-mini" onClick={() => draw(r.id)} disabled={busy}>
                            Draw
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

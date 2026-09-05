import { BADGE_FAMILIES, BADGE_TIERS, type Badge, badgeIconSrc, parseBadgeCriteria } from "@c-verse/shared";
import { useEffect, useState } from "react";
import { useConfirm } from "../components/ConfirmProvider";
import { apiFetch } from "../lib/api";
import { errMessage } from "../lib/utils";
import "./badges.css";

export function BadgesPage() {
  const confirm = useConfirm();
  const [rows, setRows] = useState<Badge[]>([]);
  const [search, setSearch] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    setLoadError(false);
    try {
      const data = await apiFetch<{ badges: Badge[] }>("/api/gamification/badges/admin/catalog");
      setRows(data.badges);
    } catch {
      setLoadError(true);
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function toggleActive(b: Badge) {
    const isCurrentlyActive = b.isActive ?? true;
    const willDeactivate = isCurrentlyActive;
    if (
      !(await confirm({
        title: willDeactivate ? `Nonaktifkan lencana "${b.name}"?` : `Aktifkan lencana "${b.name}"?`,
        ...(willDeactivate ? { message: "User tidak bisa memperoleh lencana ini selama nonaktif." } : {}),
        confirmLabel: willDeactivate ? "Nonaktifkan" : "Aktifkan",
        danger: willDeactivate,
      }))
    )
      return;
    setMsg(null);
    setBusyId(b.id);
    try {
      await apiFetch(`/api/gamification/badges/${b.id}`, { method: "PATCH", body: JSON.stringify({ isActive: !isCurrentlyActive }) });
      await load();
    } catch (err) {
      setMsg(errMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="admin-page">
      <div className="admin-page-head">
        <h2>Lencana</h2>
        <p className="muted">
          Lencana bertingkat dan hadiah XP. Menonaktifkan lencana menghentikan hadiah baru; pencapaian yang sudah diperoleh tetap tersimpan.
        </p>
      </div>
      {msg && (
        <div className="admin-msg" role="status" aria-live="polite">
          {msg}
        </div>
      )}
      {loadError && (
        <div className="admin-msg" role="alert" aria-live="polite" style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span>Gagal memuat data lencana — periksa koneksi lalu coba lagi.</span>
          <button className="btn-ghost admin-mini" onClick={load}>
            Coba Lagi
          </button>
        </div>
      )}
      <div className="card">
        <div className="admin-table-head">
          {rows.length} lencana · {rows.filter((badge) => badge.isActive !== false).length} aktif
        </div>
        <label className="admin-badge-search">
          Cari lencana
          <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Nama, kode, atau kriteria" />
        </label>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Lambang</th>
                <th>Nama</th>
                <th>XP</th>
                <th>Kriteria</th>
                <th>Aktif</th>
                <th>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {rows.filter((badge) => `${badge.name} ${badge.code} ${badge.description}`.toLowerCase().includes(search.toLowerCase()))
                .length === 0 ? (
                <tr>
                  <td colSpan={6} className="empty-state">
                    {search ? "Tidak ada lencana yang cocok" : "Belum ada data"}
                  </td>
                </tr>
              ) : (
                rows
                  .filter((badge) => `${badge.name} ${badge.code} ${badge.description}`.toLowerCase().includes(search.toLowerCase()))
                  .map((r) => {
                    const criteria = parseBadgeCriteria(r.criteria);
                    const tier = BADGE_TIERS.find((entry) => entry.tier === criteria?.tier);
                    const family = BADGE_FAMILIES.find((entry) => entry.id === criteria?.family);
                    return (
                      <tr key={r.id}>
                        <td>
                          <span className="admin-badge-art" style={{ borderColor: tier?.color }}>
                            <img
                              src={badgeIconSrc(r, criteria?.family ?? "special", r.code)}
                              alt=""
                              width={64}
                              height={64}
                              loading="lazy"
                            />
                          </span>
                        </td>
                        <td>
                          <strong>{r.name}</strong>
                          <div className="muted">
                            {family?.name ?? "Khusus"} · {tier?.name ?? "Lencana"}
                          </div>
                          <code>{r.code}</code>
                        </td>
                        <td>+{r.xpReward ?? r.xp} XP</td>
                        <td className="admin-badge-description">{r.description}</td>
                        <td>{r.isActive !== false ? "Aktif" : "Nonaktif"}</td>
                        <td>
                          <button className="btn-ghost admin-mini" onClick={() => toggleActive(r)} disabled={busyId === r.id}>
                            {(r.isActive ?? true) ? "Nonaktifkan" : "Aktifkan"}
                          </button>
                        </td>
                      </tr>
                    );
                  })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

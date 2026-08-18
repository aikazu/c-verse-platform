import { useEffect, useState } from "react";
import { apiFetch } from "../lib/api";
import { supabase } from "../lib/supabase";
import type { CreatorRow, UserRow } from "../lib/types";
import { errMessage } from "../lib/utils";

export function CreatorsPage() {
  const [creators, setCreators] = useState<CreatorRow[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [holds, setHolds] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true);
    const [cr, us, wl] = await Promise.all([
      supabase
        .from("creators")
        .select("id,user_id,handle,total_followers_combined,status,notes,created_at")
        .order("created_at", { ascending: false })
        .limit(500),
      supabase.from("users").select("id,email,display_name,username,role,flag_reason").order("created_at", { ascending: false }).limit(500),
      supabase.from("wallets").select("user_id,hold_payout_until").limit(1000),
    ]);
    setCreators((cr.data ?? []) as CreatorRow[]);
    setUsers((us.data ?? []) as UserRow[]);
    const holdMap: Record<string, string> = {};
    for (const w of (wl.data ?? []) as { user_id: string; hold_payout_until: string | null }[]) {
      if (w.hold_payout_until) holdMap[w.user_id] = w.hold_payout_until;
    }
    setHolds(holdMap);
    setLoading(false);
  }
  useEffect(() => {
    load();
  }, []);

  async function promote(userId: string) {
    if (!window.confirm("Promosikan user ini menjadi creator?")) return;
    setBusy(true);
    try {
      await apiFetch(`/api/admin/users/${userId}`, { method: "PATCH", body: JSON.stringify({ role: "creator" }) });
      setMsg("User dipromosikan jadi creator — row creators diaktifkan server-side");
      load();
    } catch (err) {
      setMsg(errMessage(err));
    } finally {
      setBusy(false);
    }
  }
  async function toggleSuspend(u: UserRow) {
    const flagReason = u.flag_reason ? null : `manual:${new Date().toISOString().slice(0, 10)}`;
    const confirmMsg = flagReason
      ? `Suspend user ${u.email}? Akun tidak bisa transaksi hingga diaktifkan kembali.`
      : `Aktifkan kembali user ${u.email}?`;
    if (!window.confirm(confirmMsg)) return;
    setBusy(true);
    try {
      await apiFetch(`/api/admin/users/${u.id}`, { method: "PATCH", body: JSON.stringify({ flagReason }) });
      setMsg(flagReason ? `User ${u.email} disuspend` : `User ${u.email} diaktifkan kembali`);
      load();
    } catch (err) {
      setMsg(errMessage(err));
    } finally {
      setBusy(false);
    }
  }
  async function toggleHold(u: UserRow) {
    const isHeld = Boolean(holds[u.id]);
    const holdPayoutUntil = isHeld ? null : new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
    const confirmMsg = holdPayoutUntil ? `Hold payout ${u.email} selama 7 hari (fraud hold)?` : `Lepas fraud hold payout ${u.email}?`;
    if (!window.confirm(confirmMsg)) return;
    setBusy(true);
    try {
      await apiFetch(`/api/admin/users/${u.id}/wallet-hold`, { method: "PATCH", body: JSON.stringify({ holdPayoutUntil }) });
      setMsg(holdPayoutUntil ? `Payout ${u.email} di-hold 7 hari (fraud hold)` : `Fraud hold ${u.email} dilepas`);
      load();
    } catch (err) {
      setMsg(errMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const pending = creators.filter((c) => c.status === "inactive");
  const term = search.trim().toLowerCase();
  const filteredUsers = term
    ? users.filter((u) => u.email.toLowerCase().includes(term) || (u.username ?? "").toLowerCase().includes(term))
    : users;

  return (
    <div className="admin-page">
      <div className="admin-page-head">
        <h2>Kreator</h2>
        <p className="muted">Approve pendaftaran, promote role, suspend, dan fraud-hold payout (via API, ter-audit)</p>
      </div>
      {msg && (
        <div className="admin-msg" role="status" aria-live="polite">
          {msg}
        </div>
      )}

      <div className="card">
        <div className="admin-table-head">Pendaftaran menunggu approval — {pending.length}</div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Handle</th>
                <th>User</th>
                <th>Diajukan</th>
                <th>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {pending.length === 0 ? (
                <tr>
                  <td colSpan={4} className="empty-state">
                    Tidak ada pendaftaran pending
                  </td>
                </tr>
              ) : (
                pending.map((c) => (
                  <tr key={c.id}>
                    <td style={{ fontWeight: 700 }}>{c.handle ?? c.id}</td>
                    <td className="mono fs-11">{c.user_id ?? "—"}</td>
                    <td style={{ fontSize: 11 }}>{new Date(c.created_at).toLocaleDateString("id-ID")}</td>
                    <td>
                      {c.user_id ? (
                        <button className="btn-gold admin-mini" onClick={() => promote(c.user_id as string)} disabled={busy}>
                          Jadikan Creator
                        </button>
                      ) : (
                        <span className="muted" style={{ fontSize: 11 }}>
                          Tanpa user terhubung
                        </span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <div className="admin-table-head">
          Users — {filteredUsers.length}
          <input
            className="input"
            aria-label="Cari user"
            placeholder="Cari email/username…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: 220, marginLeft: "auto", fontSize: 12 }}
          />
        </div>
        {loading ? (
          <div style={{ padding: 20 }} className="muted">
            Memuat…
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Payout</th>
                  <th>Aksi</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map((u) => (
                  <tr key={u.id}>
                    <td style={{ fontSize: 12, fontWeight: 600 }}>{u.email}</td>
                    <td>
                      <span className="pill pill-info">{u.role}</span>
                    </td>
                    <td>{u.flag_reason ? <span className="pill">Suspended</span> : <span className="pill pill-info">Aktif</span>}</td>
                    <td>{holds[u.id] ? <span className="pill">Hold</span> : <span className="pill pill-info">Normal</span>}</td>
                    <td className="flex-gap-6 flex-wrap">
                      {u.role !== "creator" && u.role !== "admin" && (
                        <button className="btn-gold admin-mini" onClick={() => promote(u.id)} disabled={busy}>
                          Jadikan Creator
                        </button>
                      )}
                      {u.role !== "admin" && (
                        <button className="btn-ghost admin-mini" onClick={() => toggleSuspend(u)} disabled={busy}>
                          {u.flag_reason ? "Aktifkan" : "Suspend"}
                        </button>
                      )}
                      <button className="btn-ghost admin-mini" onClick={() => toggleHold(u)} disabled={busy}>
                        {holds[u.id] ? "Lepas Hold" : "Hold 7d"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <div className="admin-table-head">Kreator terdaftar — {creators.filter((c) => c.status !== "inactive").length}</div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Handle</th>
                <th>Followers</th>
                <th>Status</th>
                <th>Catatan</th>
              </tr>
            </thead>
            <tbody>
              {creators
                .filter((c) => c.status !== "inactive")
                .map((c) => (
                  <tr key={c.id}>
                    <td style={{ fontWeight: 700 }}>{c.handle ?? c.id}</td>
                    <td>{c.total_followers_combined ?? 0}</td>
                    <td>
                      <span className="pill pill-info">{c.status}</span>
                    </td>
                    <td style={{ fontSize: 11 }}>{c.notes ?? "—"}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

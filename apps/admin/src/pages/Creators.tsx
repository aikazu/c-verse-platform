import { useEffect, useState } from "react";
import { useConfirm } from "../components/ConfirmProvider";
import { StatusBadge } from "../components/StatusBadge";
import { apiFetch } from "../lib/api";
import type { CreatorRow, ProvisionResult, UserRow } from "../lib/types";
import { errMessage } from "../lib/utils";

export function CreatorsPage() {
  const confirm = useConfirm();
  const [creators, setCreators] = useState<CreatorRow[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [holds, setHolds] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    email: "",
    displayName: "",
    handle: "",
    totalFollowersCombined: "",
    notes: "",
  });

  async function load() {
    setLoading(true);
    try {
      const result = await apiFetch<{
        creators: CreatorRow[];
        users: UserRow[];
        wallets: { user_id: string; hold_payout_until: string | null }[];
      }>("/api/admin/creators");
      setCreators(result.creators);
      setUsers(result.users);
      const holdMap: Record<string, string> = {};
      for (const wallet of result.wallets) {
        if (wallet.hold_payout_until) holdMap[wallet.user_id] = wallet.hold_payout_until;
      }
      setHolds(holdMap);
    } catch {
      setMsg("Gagal memuat sebagian data — periksa koneksi lalu refresh.");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function promote(userId: string) {
    if (!(await confirm({ title: "Promosikan user ini menjadi creator?", confirmLabel: "Promosikan" }))) return;
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
    const suspending = Boolean(flagReason);
    if (
      !(await confirm({
        title: suspending ? `Suspend user ${u.email}?` : `Aktifkan kembali user ${u.email}?`,
        ...(suspending ? { message: "Akun tidak bisa transaksi hingga diaktifkan kembali." } : {}),
        confirmLabel: suspending ? "Suspend" : "Aktifkan",
        danger: suspending,
      }))
    )
      return;
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
    if (
      !(await confirm({
        title: holdPayoutUntil ? `Hold payout ${u.email} selama 7 hari (fraud hold)?` : `Lepas fraud hold payout ${u.email}?`,
        confirmLabel: holdPayoutUntil ? "Hold" : "Lepas",
      }))
    )
      return;
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
  async function provision() {
    if (!form.email.trim() || !form.displayName.trim() || !form.handle.trim()) {
      setMsg("Email, nama tampilan, dan handle wajib diisi.");
      return;
    }
    if (!(await confirm({ title: `Buat akun kreator untuk ${form.email.trim()}?`, confirmLabel: "Buat Akun" }))) return;
    setBusy(true);
    try {
      const res = await apiFetch<ProvisionResult>("/api/admin/users/provision", {
        method: "POST",
        body: JSON.stringify({
          email: form.email.trim(),
          displayName: form.displayName.trim(),
          handle: form.handle.trim(),
          totalFollowersCombined: form.totalFollowersCombined ? Number(form.totalFollowersCombined) : undefined,
          notes: form.notes.trim() || undefined,
        }),
      });
      setMsg(`Akun kreator ${res.user.email} dibuat (email akses: ${res.emailSent ? "terkirim" : "nonaktif-dev"})`);
      setForm({ email: "", displayName: "", handle: "", totalFollowersCombined: "", notes: "" });
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

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="admin-table-head">Buat akun kreator</div>
        <div className="admin-mini-form">
          <div className="flex-gap-6 flex-wrap">
            <input
              className="input"
              placeholder="Email kreator (dari deal memo)"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              style={{ width: 260, fontSize: 12 }}
            />
            <input
              className="input"
              placeholder="Nama tampilan"
              value={form.displayName}
              onChange={(e) => setForm({ ...form, displayName: e.target.value })}
              style={{ width: 200, fontSize: 12 }}
            />
            <input
              className="input"
              placeholder="Handle (IG/TikTok/YT/X)"
              value={form.handle}
              onChange={(e) => setForm({ ...form, handle: e.target.value })}
              style={{ width: 180, fontSize: 12 }}
            />
            <input
              className="input"
              type="number"
              min={0}
              placeholder="Followers combined"
              value={form.totalFollowersCombined}
              onChange={(e) => setForm({ ...form, totalFollowersCombined: e.target.value })}
              style={{ width: 160, fontSize: 12 }}
            />
            <input
              className="input"
              placeholder="Catatan (opsional)"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              style={{ width: 240, fontSize: 12 }}
            />
            <button className="btn-gold admin-mini" onClick={provision} disabled={busy}>
              Buat Akun
            </button>
          </div>
          <p className="muted" style={{ fontSize: 11, marginTop: 6 }}>
            Akun login passwordless (OTP email / Google) dibuat langsung di Supabase Auth + row kreator aktif.
          </p>
        </div>
      </div>

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
                      <StatusBadge status={c.status} />
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

import type { Session } from "@supabase/supabase-js";
import type React from "react";
import { useEffect, useState } from "react";
import { Navigate, NavLink, Route, Routes, useNavigate } from "react-router-dom";
import { apiFetch } from "./lib/api";
import { hasSupabase, supabase } from "./lib/supabase";

// ── Row types (snake_case straight from Supabase / admin API) ───────────────
type UserRow = {
  id: string;
  email: string;
  display_name: string | null;
  username: string | null;
  role: string;
  flag_reason: string | null;
};
type CreatorRow = {
  id: string;
  user_id: string | null;
  handle: string | null;
  total_followers_combined: number | null;
  status: string;
  notes: string | null;
  created_at: string;
};
type DropRow = {
  id: string;
  title: string;
  series: string;
  status: string;
  total_units: number;
  sold_count: number | null;
  price_ccoin: number | null;
  price_unsigned_ccoin: number | null;
  raffle_end_at: string | null;
  drawn_at: string | null;
  created_at: string;
};
type OrderRow = {
  id: string;
  card_id: string | null;
  status: string;
  delivery_option: string | null;
  tracking_number: string | null;
  created_at: string;
};
type ShipmentRow = { id: string; card_id: string; status: string; tracking_number: string | null };
type DisputeRow = {
  id: string;
  order_id: string | null;
  reporter_id: string;
  reason: string;
  status: string;
  decision_notes: string | null;
  created_at: string;
};
type BadgeRow = {
  id: string;
  code: string;
  name: string;
  description: string;
  icon: string;
  xp_reward: number | null;
  criteria: unknown;
  is_active: boolean | null;
};
type KycRow = {
  id: string;
  user_id: string;
  full_name: string;
  nik: string;
  status: string;
  created_at: string;
};
type PayoutBatchRow = { id: string; batch_code: string; status: string; total_ccoin: number; total_idr: number };
type PayoutRow = {
  id: string;
  user_id: string;
  type: string;
  ccoin_amount: number;
  idr_amount: number | null;
  status: string;
  batch_id: string | null;
};
type AuditRow = {
  id: string;
  admin_user_id: string;
  action: string;
  target_table: string;
  target_id: string | null;
  payload_summary: unknown;
  ip: string | null;
  created_at: string;
};
type NfcBatchRow = { id: string; batch_code: string; qty: number; status: string };
type CardRow = {
  id: string;
  nfc_uid: string | null;
  nfc_short_id: string | null;
  verify_status: string | null;
  nfc_configured: boolean | null;
  qc_status: string | null;
};

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Terjadi kesalahan";
}

// ── Auth hook ──────────────────────────────────────────────────────────────
function useAdminAuth() {
  const [session, setSession] = useState<Session | null>(null);
  const [aal2, setAal2] = useState(false);
  const [loading, setLoading] = useState(true);

  async function refreshAal2() {
    try {
      const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      setAal2(data?.currentLevel === "aal2");
    } catch {
      setAal2(false);
    }
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session ?? null);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      if (!newSession) setAal2(false);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) return;
    refreshAal2();
  }, [session]);

  return { session, aal2, loading, refreshAal2 };
}

// ── Configuration error (Supabase env is REQUIRED) ─────────────────────────
function ConfigErrorScreen() {
  return (
    <div className="admin-auth-page">
      <div className="admin-login-card" style={{ borderLeft: "4px solid #ef4444" }}>
        <h3 style={{ fontWeight: 800 }}>Konfigurasi tidak lengkap</h3>
        <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
          Supabase wajib dikonfigurasi — mode demo sudah dihapus. Salin <code>apps/admin/.env.example</code> ke <code>.env.local</code>,
          lalu isi <code>VITE_SUPABASE_URL</code> dan <code>VITE_SUPABASE_ANON_KEY</code> (anon key saja, dilindungi RLS + MFA aal2).
        </p>
      </div>
    </div>
  );
}

// ── Login (email OTP — no passwords) ───────────────────────────────────────
function LoginPage() {
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onLogin(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      // Tanpa password — email OTP (magic link), konsisten dengan platform.
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { shouldCreateUser: false, emailRedirectTo: window.location.origin },
      });
      if (error) setMsg(error.message);
      else setMsg("Tautan masuk terkirim — cek email (Inbucket di dev).");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="admin-auth-page">
      <div className="admin-login-card">
        <div className="admin-login-brand">
          <div className="admin-login-logo">
            C<span>.</span>Verse
          </div>
          <div className="admin-login-sub">Admin</div>
        </div>
        <h1 className="admin-login-title">Masuk</h1>
        <p className="muted" style={{ fontSize: 12, textAlign: "center", marginBottom: 18 }}>
          Hanya untuk pengelola platform — verifikasi TOTP diminta setelah login.
        </p>

        <form onSubmit={onLogin} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div>
            <label className="label">Email</label>
            <input
              className="input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@cverse.id"
              autoComplete="email"
            />
          </div>
          <button className="btn-gold" type="submit" disabled={busy} style={{ marginTop: 6, padding: "11px", width: "100%" }}>
            {busy ? "Mengirim…" : "Kirim Tautan Masuk"}
          </button>
        </form>

        {msg && <div className="admin-msg">{msg}</div>}

        <div style={{ fontSize: 11, color: "var(--dim)", textAlign: "center", marginTop: 16 }}>
          Butuh bantuan? Hubungi super admin untuk reset.
        </div>
      </div>
    </div>
  );
}

// ── TOTP aal1 → aal2 gate (dedicated verify card, no nested LoginPage) ──────
function TotpRequired({ onVerified }: { onVerified: () => void }) {
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onEnroll() {
    setMsg(null);
    const { error } = await supabase.auth.mfa.enroll({ factorType: "totp" });
    if (error) setMsg(error.message);
    else setMsg("Authenticator terdaftar — pindai QR di app authenticator kamu, lalu masukkan kodenya di sini.");
  }

  async function onVerify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const { data: factors } = await supabase.auth.mfa.listFactors();
      const factor = factors?.totp[0] ?? factors?.all[0];
      if (!factor) {
        setMsg("Belum ada authenticator — klik Daftar Authenticator dulu.");
        return;
      }
      const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({ factorId: factor.id });
      if (challengeError || !challenge) {
        setMsg(challengeError?.message ?? "Gagal membuat challenge TOTP");
        return;
      }
      const { error } = await supabase.auth.mfa.verify({ factorId: factor.id, challengeId: challenge.id, code });
      if (error) {
        setMsg(error.message);
        return;
      }
      onVerified();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="admin-auth-page">
      <div className="admin-login-card" style={{ borderLeft: "4px solid #eab308" }}>
        <h3 style={{ fontWeight: 800 }}>Verifikasi dua langkah (aal1 → aal2)</h3>
        <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>
          Login berhasil (aal1) — sesi kamu terbatas sebagai view-only. Selesaikan kode TOTP untuk membuka dashboard &amp; mutasi (aal2).
        </p>
        <form onSubmit={onVerify} style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 14 }}>
          <div>
            <label className="label">Kode TOTP (6 digit)</label>
            <input
              className="input"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="123456"
              inputMode="numeric"
              autoComplete="one-time-code"
              style={{ fontFamily: "var(--font-mono)", letterSpacing: 2, textAlign: "center", fontSize: 15 }}
            />
          </div>
          <button className="btn-gold" type="submit" disabled={busy || code.length < 6} style={{ padding: "11px" }}>
            {busy ? "Memverifikasi…" : "Verifikasi Kode"}
          </button>
          <button className="btn-ghost" type="button" onClick={onEnroll} style={{ fontSize: 12 }}>
            Daftar Authenticator
          </button>
        </form>
        {msg && <div className="admin-msg">{msg}</div>}
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--dim)", marginTop: 10 }}>
          Break-glass: admin lain yang sudah aal2 dapat mereset enrollment yang hilang — tercatat di audit log.
        </div>
      </div>
    </div>
  );
}

// ── Shell (sidebar + topbar) ───────────────────────────────────────────────
function Shell({ email, onLogout, children }: { email: string; onLogout: () => void; children: React.ReactNode }) {
  const nav = useNavigate();
  const items = [
    { to: "/", label: "Dashboard", icon: "▦" },
    { to: "/creators", label: "Kreator", icon: "◎" },
    { to: "/drops", label: "Drops", icon: "◈" },
    { to: "/orders", label: "Pesanan", icon: "⧉" },
    { to: "/nfc", label: "NFC", icon: "⬡" },
    { to: "/payouts", label: "Payout", icon: "₵" },
    { to: "/badges", label: "Lencana", icon: "✦" },
    { to: "/disputes", label: "Sengketa", icon: "⚑" },
    { to: "/kyc", label: "KYC", icon: "⊞" },
    { to: "/audit", label: "Audit", icon: "◷" },
    { to: "/investor", label: "Investor", icon: "⬢" },
  ];

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <div className="admin-sidebar-brand">
          <div className="admin-sidebar-logo">
            C<span>.</span>Verse
          </div>
          <div className="admin-sidebar-sub">Admin</div>
        </div>
        <nav className="admin-nav">
          {items.map((it) => (
            <NavLink
              key={it.to}
              to={it.to}
              end={it.to === "/"}
              className={({ isActive }) => (isActive ? "admin-nav-link active" : "admin-nav-link")}
            >
              <span className="admin-nav-icon">{it.icon}</span>
              {it.label}
            </NavLink>
          ))}
        </nav>
        <div className="admin-sidebar-foot">
          <div className="admin-user">
            <div className="admin-user-avatar">{email.slice(0, 1).toUpperCase()}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {email}
              </div>
              <div style={{ fontSize: 10, color: "var(--muted)" }}>Supabase · aal2</div>
            </div>
          </div>
          <button className="btn-ghost admin-logout" onClick={onLogout}>
            Keluar
          </button>
        </div>
      </aside>

      <div className="admin-main">
        <header className="admin-topbar">
          <div className="admin-topbar-title">Kelola Platform</div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn-ghost" style={{ fontSize: 12 }} onClick={() => nav("/")}>
              Dashboard
            </button>
          </div>
        </header>
        <div className="admin-content">{children}</div>
        <footer className="admin-footer">C.Verse Admin</footer>
      </div>
    </div>
  );
}

// ── Pages ──────────────────────────────────────────────────────────────────
function CreatorsPage() {
  const [creators, setCreators] = useState<CreatorRow[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [holds, setHolds] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

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
    try {
      await apiFetch(`/api/admin/users/${userId}`, { method: "PATCH", body: JSON.stringify({ role: "creator" }) });
      setMsg("User dipromosikan jadi creator — row creators diaktifkan server-side");
      load();
    } catch (err) {
      setMsg(errMessage(err));
    }
  }
  async function toggleSuspend(u: UserRow) {
    const flagReason = u.flag_reason ? null : `manual:${new Date().toISOString().slice(0, 10)}`;
    try {
      await apiFetch(`/api/admin/users/${u.id}`, { method: "PATCH", body: JSON.stringify({ flagReason }) });
      setMsg(flagReason ? `User ${u.email} disuspend` : `User ${u.email} diaktifkan kembali`);
      load();
    } catch (err) {
      setMsg(errMessage(err));
    }
  }
  async function toggleHold(u: UserRow) {
    const isHeld = Boolean(holds[u.id]);
    const holdPayoutUntil = isHeld ? null : new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
    try {
      await apiFetch(`/api/admin/users/${u.id}/wallet-hold`, { method: "PATCH", body: JSON.stringify({ holdPayoutUntil }) });
      setMsg(holdPayoutUntil ? `Payout ${u.email} di-hold 7 hari (fraud hold)` : `Fraud hold ${u.email} dilepas`);
      load();
    } catch (err) {
      setMsg(errMessage(err));
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
      {msg && <div className="admin-msg">{msg}</div>}

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
                  <td colSpan={4} style={{ textAlign: "center", padding: 20 }} className="muted">
                    Tidak ada pendaftaran pending
                  </td>
                </tr>
              ) : (
                pending.map((c) => (
                  <tr key={c.id}>
                    <td style={{ fontWeight: 700 }}>{c.handle ?? c.id}</td>
                    <td style={{ fontFamily: "monospace", fontSize: 11 }}>{c.user_id ?? "—"}</td>
                    <td style={{ fontSize: 11 }}>{new Date(c.created_at).toLocaleDateString("id-ID")}</td>
                    <td>
                      {c.user_id ? (
                        <button className="btn-gold admin-mini" onClick={() => promote(c.user_id as string)}>
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
                    <td style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {u.role !== "creator" && u.role !== "admin" && (
                        <button className="btn-gold admin-mini" onClick={() => promote(u.id)}>
                          Jadikan Creator
                        </button>
                      )}
                      {u.role !== "admin" && (
                        <button className="btn-ghost admin-mini" onClick={() => toggleSuspend(u)}>
                          {u.flag_reason ? "Aktifkan" : "Suspend"}
                        </button>
                      )}
                      <button className="btn-ghost admin-mini" onClick={() => toggleHold(u)}>
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

function DropsPage() {
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
    try {
      // drops punya tanpa grant insert utk authenticated — wajib lewat API (audited).
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
    }
  }

  async function setStatus(id: string, status: string) {
    setMsg(null);
    try {
      await apiFetch(`/api/drops/${id}/status`, { method: "PATCH", body: JSON.stringify({ status }) });
      load();
    } catch (err) {
      setMsg(errMessage(err));
    }
  }

  async function draw(id: string) {
    setMsg(null);
    try {
      const { winners } = await apiFetch<{ winners: number }>(`/api/drops/${id}/draw`, { method: "POST" });
      setMsg(`Draw selesai — ${winners} pemenang`);
      load();
    } catch (err) {
      setMsg(errMessage(err));
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
        <input
          className="input"
          placeholder="Judul"
          value={form.title}
          onChange={(e) => setForm((s) => ({ ...s, title: e.target.value }))}
          required
        />
        <input
          className="input"
          placeholder="Seri"
          value={form.series}
          onChange={(e) => setForm((s) => ({ ...s, series: e.target.value }))}
          required
        />
        <textarea
          className="input"
          placeholder="Deskripsi (min. 10 karakter)"
          value={form.narrative}
          onChange={(e) => setForm((s) => ({ ...s, narrative: e.target.value }))}
          required
          rows={2}
        />
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input
            className="input"
            placeholder="URL artwork"
            value={form.artworkUrl}
            onChange={(e) => setForm((s) => ({ ...s, artworkUrl: e.target.value }))}
            style={{ flex: 1, minWidth: 160 }}
          />
          <input
            className="input"
            type="number"
            min={1}
            max={1000}
            value={form.totalUnits}
            onChange={(e) => setForm((s) => ({ ...s, totalUnits: Number(e.target.value) }))}
            style={{ width: 120 }}
          />
          <input
            className="input"
            type="number"
            min={1}
            value={form.priceCcoin}
            onChange={(e) => setForm((s) => ({ ...s, priceCcoin: Number(e.target.value) }))}
            style={{ width: 120 }}
          />
        </div>
        <input
          className="input"
          type="datetime-local"
          value={form.dropStartAt}
          onChange={(e) => setForm((s) => ({ ...s, dropStartAt: e.target.value }))}
        />
        <button className="btn-gold" style={{ alignSelf: "start" }}>
          Buat Draft
        </button>
        {msg && <div className="admin-msg">{msg}</div>}
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
                    <td colSpan={5} style={{ textAlign: "center", padding: 20 }} className="muted">
                      Belum ada data
                    </td>
                  </tr>
                ) : (
                  rows.map((r) => (
                    <tr key={r.id}>
                      <td style={{ fontWeight: 700, fontSize: 12 }}>{r.title}</td>
                      <td>
                        <span className="pill pill-info">{r.status}</span>
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
                      <td style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        <button className="btn-ghost admin-mini" onClick={() => setStatus(r.id, "published")}>
                          Publish
                        </button>
                        <button className="btn-ghost admin-mini" onClick={() => setStatus(r.id, "live")}>
                          Live
                        </button>
                        <button className="btn-ghost admin-mini" onClick={() => setStatus(r.id, "closed")}>
                          Tutup
                        </button>
                        {r.raffle_end_at && !r.drawn_at && (
                          <button className="btn-gold admin-mini" onClick={() => draw(r.id)}>
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

function OrdersPage() {
  const [rows, setRows] = useState<OrderRow[]>([]);
  const [shipments, setShipments] = useState<ShipmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [trackInputs, setTrackInputs] = useState<Record<string, string>>({});

  async function load() {
    setLoading(true);
    // orders select granted utk authenticated; mutasi status/resi WAJIB via /api/shipments.
    const [{ data: o }, { data: s }] = await Promise.all([
      supabase
        .from("orders")
        .select("id,card_id,status,delivery_option,tracking_number,created_at")
        .order("created_at", { ascending: false })
        .limit(100),
      supabase.from("shipments").select("id,card_id,status,tracking_number").order("created_at", { ascending: false }).limit(500),
    ]);
    setRows((o ?? []) as OrderRow[]);
    setShipments((s ?? []) as ShipmentRow[]);
    setLoading(false);
  }
  useEffect(() => {
    load();
  }, []);

  function shipmentFor(order: OrderRow): ShipmentRow | null {
    if (!order.card_id) return null;
    return shipments.find((s) => s.card_id === order.card_id) ?? null;
  }

  async function updateShipment(shipmentId: string, status: string, trackingNumber?: string) {
    setMsg(null);
    try {
      await apiFetch(`/api/shipments/${shipmentId}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status, ...(trackingNumber ? { trackingNumber } : {}) }),
      });
      load();
    } catch (err) {
      setMsg(errMessage(err));
    }
  }

  function actionsFor(order: OrderRow) {
    if (order.delivery_option === "vault") {
      return (
        <span className="muted" style={{ fontSize: 11 }}>
          Vault — settled otomatis
        </span>
      );
    }
    const shipment = shipmentFor(order);
    if (!shipment) {
      return (
        <span className="muted" style={{ fontSize: 11 }}>
          Tidak ada shipment — order shipping tanpa record pengiriman
        </span>
      );
    }
    const tracking = trackInputs[shipment.id] ?? "";
    return (
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        <span className="pill pill-info" style={{ fontSize: 10 }}>
          {shipment.status}
        </span>
        {shipment.status === "requested" && (
          <>
            <button className="btn-ghost admin-mini" onClick={() => updateShipment(shipment.id, "packed")}>
              Packing
            </button>
            <button className="btn-ghost admin-mini" onClick={() => updateShipment(shipment.id, "cancelled")}>
              Batal
            </button>
          </>
        )}
        {(shipment.status === "requested" || shipment.status === "packed") && (
          <>
            <input
              className="input"
              placeholder="No. resi"
              value={tracking}
              onChange={(e) => setTrackInputs((prev) => ({ ...prev, [shipment.id]: e.target.value }))}
              style={{ width: 110, fontSize: 11, padding: "4px 8px" }}
            />
            <button className="btn-ghost admin-mini" onClick={() => updateShipment(shipment.id, "shipped", tracking || undefined)}>
              Kirim
            </button>
          </>
        )}
        {shipment.status === "shipped" && (
          <button className="btn-gold admin-mini" onClick={() => updateShipment(shipment.id, "delivered")}>
            Selesai
          </button>
        )}
        {shipment.status === "delivered" && (
          <span className="muted" style={{ fontSize: 11 }}>
            Selesai
          </span>
        )}
        {shipment.status === "cancelled" && (
          <span className="muted" style={{ fontSize: 11 }}>
            Dibatalkan
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="admin-page">
      <div className="admin-page-head">
        <h2>Pesanan</h2>
        <p className="muted">Kelola pengiriman — transisi divalidasi server-side via /api/shipments</p>
      </div>
      {msg && <div className="admin-msg">{msg}</div>}
      <div className="card">
        <div className="admin-table-head">100 terbaru</div>
        {loading ? (
          <div style={{ padding: 20 }} className="muted">
            Memuat…
          </div>
        ) : rows.length === 0 ? (
          <div style={{ padding: 20 }} className="muted">
            Belum ada pesanan
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Status Order</th>
                  <th>Opsi</th>
                  <th>Resi</th>
                  <th>Pengiriman</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td style={{ fontFamily: "monospace", fontSize: 11 }}>{r.id.slice(0, 10)}</td>
                    <td>
                      <span className="pill pill-info">{r.status}</span>
                    </td>
                    <td style={{ fontSize: 12 }}>{r.delivery_option ?? "—"}</td>
                    <td style={{ fontSize: 11 }}>{r.tracking_number ?? "—"}</td>
                    <td>{actionsFor(r)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function NfcPage() {
  const [batches, setBatches] = useState<NfcBatchRow[]>([]);
  const [cards, setCards] = useState<CardRow[]>([]);
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    const { data: b, error: bErr } = await supabase
      .from("nfc_batches")
      .select("id,batch_code,qty,status")
      .order("created_at", { ascending: false });
    setBatches((b ?? []) as NfcBatchRow[]);
    const { data: c, error: cErr } = await supabase
      .from("cards")
      .select("id,nfc_uid,nfc_short_id,verify_status,nfc_configured,qc_status")
      .limit(50);
    setCards((c ?? []) as CardRow[]);
    const err = bErr ?? cErr;
    if (err) setMsg(err.message);
  }
  useEffect(() => {
    load();
  }, []);

  return (
    <div className="admin-page">
      <div className="admin-page-head">
        <h2>NFC</h2>
        <p className="muted">Pantau batch dan verifikasi kartu (read-only — provisioning via backend)</p>
      </div>
      {msg && <div className="admin-msg">{msg}</div>}
      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn-ghost" onClick={load}>
          Refresh
        </button>
      </div>
      <div className="grid-2">
        <div className="card">
          <div className="admin-table-head">Batch — {batches.length}</div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Batch</th>
                  <th>Qty</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {batches.length === 0 ? (
                  <tr>
                    <td colSpan={3} style={{ textAlign: "center", padding: 20 }} className="muted">
                      Belum ada batch
                    </td>
                  </tr>
                ) : (
                  batches.map((b) => (
                    <tr key={b.id}>
                      <td style={{ fontFamily: "monospace", fontSize: 11 }}>{b.batch_code}</td>
                      <td>{b.qty}</td>
                      <td>
                        <span className="pill pill-info">{b.status}</span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
        <div className="card">
          <div className="admin-table-head">Kartu — sampel 50</div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Kode</th>
                  <th>UID</th>
                  <th>QC</th>
                  <th>Verifikasi</th>
                </tr>
              </thead>
              <tbody>
                {cards.length === 0 ? (
                  <tr>
                    <td colSpan={4} style={{ textAlign: "center", padding: 20 }} className="muted">
                      Belum ada data
                    </td>
                  </tr>
                ) : (
                  cards.map((c) => (
                    <tr key={c.id}>
                      <td style={{ fontFamily: "monospace", fontSize: 11 }}>{c.nfc_short_id}</td>
                      <td style={{ fontFamily: "monospace", fontSize: 11 }}>{(c.nfc_uid ?? "").slice(0, 12)}</td>
                      <td>
                        <span className="pill pill-info">{c.qc_status ?? "—"}</span>
                      </td>
                      <td>{c.verify_status ?? "—"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

function PayoutsPage() {
  const [batches, setBatches] = useState<PayoutBatchRow[]>([]);
  const [payouts, setPayouts] = useState<PayoutRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    const [{ data: b }, { data: p }] = await Promise.all([
      supabase
        .from("payout_batches")
        .select("id,batch_code,status,total_ccoin,total_idr")
        .order("created_at", { ascending: false })
        .limit(500),
      supabase
        .from("payouts")
        .select("id,user_id,type,ccoin_amount,idr_amount,status,batch_id")
        .order("batch_id", { ascending: false })
        .limit(500),
    ]);
    setBatches((b ?? []) as PayoutBatchRow[]);
    setPayouts((p ?? []) as PayoutRow[]);
  }
  useEffect(() => {
    load();
  }, []);

  async function triggerBatch() {
    setBusy(true);
    setMsg(null);
    try {
      const { batchId } = await apiFetch<{ batchId: string | null }>("/api/payments/admin/payout-run", { method: "POST" });
      setMsg(
        batchId
          ? `Batch ${batchId} dibuat — payout eligible dikelompokkan`
          : "Tidak ada payout eligible (min 10 C, KYC approved, tanpa hold)",
      );
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
        <h2>Payout</h2>
        <p className="muted">Kelola pencairan dan rekonsiliasi — batch via API (ter-audit)</p>
      </div>
      {msg && <div className="admin-msg">{msg}</div>}
      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn-gold" onClick={triggerBatch} disabled={busy}>
          {busy ? "Menjalankan…" : "Jalankan Batch"}
        </button>
        <button className="btn-ghost" onClick={load}>
          Refresh
        </button>
      </div>
      <div className="card">
        <div className="admin-table-head">Batch — {batches.length}</div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Batch</th>
                <th>Status</th>
                <th>Total C</th>
                <th>Total IDR</th>
              </tr>
            </thead>
            <tbody>
              {batches.length === 0 ? (
                <tr>
                  <td colSpan={4} style={{ textAlign: "center", padding: 20 }} className="muted">
                    Belum ada batch
                  </td>
                </tr>
              ) : (
                batches.map((b) => (
                  <tr key={b.id}>
                    <td style={{ fontFamily: "monospace", fontSize: 11 }}>{b.batch_code}</td>
                    <td>
                      <span className="pill pill-info">{b.status}</span>
                    </td>
                    <td>{b.total_ccoin}</td>
                    <td>{b.total_idr}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
      <div className="card" style={{ marginTop: 14 }}>
        <div className="admin-table-head">Payout — {payouts.length}</div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>User</th>
                <th>Tipe</th>
                <th>C-Coin</th>
                <th>IDR</th>
                <th>Status</th>
                <th>Batch</th>
              </tr>
            </thead>
            <tbody>
              {payouts.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: "center", padding: 20 }} className="muted">
                    Belum ada payout
                  </td>
                </tr>
              ) : (
                payouts.map((p) => (
                  <tr key={p.id}>
                    <td style={{ fontFamily: "monospace", fontSize: 11 }}>{p.user_id.slice(0, 8)}</td>
                    <td>{p.type}</td>
                    <td>{p.ccoin_amount}</td>
                    <td>{p.idr_amount ?? "—"}</td>
                    <td>
                      <span className="pill pill-info">{p.status}</span>
                    </td>
                    <td style={{ fontFamily: "monospace", fontSize: 11 }}>{p.batch_id ? p.batch_id.slice(0, 8) : "—"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function DisputesPage() {
  const [rows, setRows] = useState<DisputeRow[]>([]);
  const [drafts, setDrafts] = useState<Record<string, { status: string; notes: string }>>({});
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    try {
      const { disputes } = await apiFetch<{ disputes: DisputeRow[] }>("/api/admin/disputes");
      setRows(disputes);
    } catch (err) {
      setMsg(errMessage(err));
    }
  }
  useEffect(() => {
    load();
  }, []);

  function setDraft(id: string, patch: Partial<{ status: string; notes: string }>) {
    setDrafts((prev) => ({ ...prev, [id]: { status: prev[id]?.status ?? "under_review", notes: prev[id]?.notes ?? "", ...patch } }));
  }

  async function decide(id: string) {
    const draft = drafts[id] ?? { status: "under_review", notes: "" };
    setMsg(null);
    try {
      await apiFetch(`/api/admin/disputes/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: draft.status, decisionNotes: draft.notes || undefined }),
      });
      setMsg(`Disput ${id.slice(0, 8)} diperbarui`);
      load();
    } catch (err) {
      setMsg(errMessage(err));
    }
  }

  const RESOLUTIONS = ["under_review", "resolved_refund", "resolved_strike", "resolved_suspend"];

  return (
    <div className="admin-page">
      <div className="admin-page-head">
        <h2>Sengketa</h2>
        <p className="muted">Tinjau dan selesaikan laporan (via API, ter-audit)</p>
      </div>
      {msg && <div className="admin-msg">{msg}</div>}
      <div className="card">
        <div className="admin-table-head">Daftar — {rows.length}</div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Alasan</th>
                <th>Status</th>
                <th>Keputusan</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={4} style={{ textAlign: "center", padding: 20 }} className="muted">
                    Belum ada laporan
                  </td>
                </tr>
              ) : (
                rows.map((r) => {
                  const isResolved = r.status.startsWith("resolved_");
                  return (
                    <tr key={r.id}>
                      <td style={{ fontFamily: "monospace", fontSize: 11 }}>{r.id.slice(0, 10)}</td>
                      <td style={{ fontSize: 12, maxWidth: 220 }}>{r.reason}</td>
                      <td>
                        <span className="pill pill-info">{r.status}</span>
                        {r.decision_notes ? (
                          <div className="muted" style={{ fontSize: 10, marginTop: 4 }}>
                            {r.decision_notes}
                          </div>
                        ) : null}
                      </td>
                      <td>
                        {isResolved ? (
                          <span className="muted" style={{ fontSize: 11 }}>
                            Selesai
                          </span>
                        ) : (
                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", minWidth: 260 }}>
                            <select
                              className="input"
                              value={drafts[r.id]?.status ?? "under_review"}
                              onChange={(e) => setDraft(r.id, { status: e.target.value })}
                              style={{ width: 160, fontSize: 11, padding: "4px 8px" }}
                            >
                              {RESOLUTIONS.map((s) => (
                                <option key={s} value={s}>
                                  {s}
                                </option>
                              ))}
                            </select>
                            <textarea
                              className="input"
                              placeholder="Catatan keputusan"
                              value={drafts[r.id]?.notes ?? ""}
                              onChange={(e) => setDraft(r.id, { notes: e.target.value })}
                              rows={1}
                              style={{ flex: 1, minWidth: 140, fontSize: 11, padding: "4px 8px" }}
                            />
                            <button className="btn-gold admin-mini" onClick={() => decide(r.id)}>
                              Simpan
                            </button>
                          </div>
                        )}
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

function BadgesPage() {
  const [rows, setRows] = useState<BadgeRow[]>([]);
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    const { data } = await supabase.from("badges").select("*").order("created_at", { ascending: false });
    setRows((data ?? []) as BadgeRow[]);
  }
  useEffect(() => {
    load();
  }, []);

  async function toggleActive(b: BadgeRow) {
    setMsg(null);
    try {
      const isActive = !(b.is_active ?? true);
      await apiFetch(`/api/gamification/badges/${b.id}`, { method: "PATCH", body: JSON.stringify({ isActive }) });
      load();
    } catch (err) {
      setMsg(errMessage(err));
    }
  }

  return (
    <div className="admin-page">
      <div className="admin-page-head">
        <h2>Lencana</h2>
        <p className="muted">Aktifkan/nonaktifkan lencana (via API, ter-audit)</p>
      </div>
      {msg && <div className="admin-msg">{msg}</div>}
      <div className="card">
        <div className="admin-table-head">Daftar — {rows.length}</div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Kode</th>
                <th>Nama</th>
                <th>XP</th>
                <th>Kriteria</th>
                <th>Aktif</th>
                <th>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: "center", padding: 20 }} className="muted">
                    Belum ada data
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id}>
                    <td style={{ fontWeight: 700, fontFamily: "monospace", fontSize: 11 }}>{r.code}</td>
                    <td>{r.name}</td>
                    <td>{r.xp_reward ?? 0}</td>
                    <td style={{ fontFamily: "monospace", fontSize: 11, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis" }}>
                      {typeof r.criteria === "string" ? r.criteria : JSON.stringify(r.criteria)}
                    </td>
                    <td>{String(r.is_active ?? true)}</td>
                    <td>
                      <button className="btn-ghost admin-mini" onClick={() => toggleActive(r)}>
                        {(r.is_active ?? true) ? "Nonaktifkan" : "Aktifkan"}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function KycPage() {
  const [rows, setRows] = useState<KycRow[]>([]);
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    try {
      const { kyc } = await apiFetch<{ kyc: KycRow[] }>("/api/kyc/admin/all");
      setRows(kyc);
    } catch (err) {
      setMsg(errMessage(err));
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function decide(id: string, action: "approve" | "reject") {
    setMsg(null);
    try {
      await apiFetch(`/api/kyc/${id}/${action}`, { method: "POST" });
      setMsg(`KYC ${id.slice(0, 8)} ${action === "approve" ? "disetujui" : "ditolak"}`);
      load();
    } catch (err) {
      setMsg(errMessage(err));
    }
  }

  return (
    <div className="admin-page">
      <div className="admin-page-head">
        <h2>KYC</h2>
        <p className="muted">Review KYC untuk payout &amp; top-up besar (via API, ter-audit)</p>
      </div>
      {msg && <div className="admin-msg">{msg}</div>}
      <div className="card">
        <div className="admin-table-head">Daftar — {rows.length}</div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>User</th>
                <th>Nama</th>
                <th>NIK</th>
                <th>Status</th>
                <th>Diajukan</th>
                <th>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: "center", padding: 20 }} className="muted">
                    Belum ada pengajuan
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id}>
                    <td style={{ fontFamily: "monospace", fontSize: 11 }}>{r.user_id.slice(0, 8)}</td>
                    <td style={{ fontSize: 12, fontWeight: 600 }}>{r.full_name}</td>
                    <td style={{ fontFamily: "monospace", fontSize: 11 }}>{r.nik}</td>
                    <td>
                      <span className="pill pill-info">{r.status}</span>
                    </td>
                    <td style={{ fontSize: 11 }}>{new Date(r.created_at).toLocaleDateString("id-ID")}</td>
                    <td style={{ display: "flex", gap: 6 }}>
                      {r.status === "pending" ? (
                        <>
                          <button className="btn-gold admin-mini" onClick={() => decide(r.id, "approve")}>
                            Setujui
                          </button>
                          <button className="btn-ghost admin-mini" onClick={() => decide(r.id, "reject")}>
                            Tolak
                          </button>
                        </>
                      ) : (
                        <span className="muted" style={{ fontSize: 11 }}>
                          Selesai
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
    </div>
  );
}

function AuditPage() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [filter, setFilter] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    setMsg(null);
    try {
      // admin_audit_log RLS-deny utk authenticated — wajib lewat API (service-role).
      const { audit } = await apiFetch<{ audit: AuditRow[] }>("/api/admin/audit?limit=100");
      setRows(audit);
    } catch (err) {
      setMsg(errMessage(err));
    }
  }
  useEffect(() => {
    load();
  }, []);

  const term = filter.trim().toLowerCase();
  const visible = term ? rows.filter((r) => r.action.toLowerCase().includes(term)) : rows;

  return (
    <div className="admin-page">
      <div className="admin-page-head">
        <h2>Audit Log</h2>
        <p className="muted">Riwayat aktivitas admin — append-only, ditulis server-side oleh API</p>
      </div>
      {msg && <div className="admin-msg">{msg}</div>}
      <div style={{ display: "flex", gap: 8 }}>
        <input className="input" placeholder="Cari aksi…" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ flex: 1 }} />
        <button className="btn-ghost" onClick={load}>
          Refresh
        </button>
      </div>
      <div className="card">
        <div className="admin-table-head">100 terbaru</div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Waktu</th>
                <th>Admin</th>
                <th>Aksi</th>
                <th>Target</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ textAlign: "center", padding: 20 }} className="muted">
                    Belum ada aktivitas
                  </td>
                </tr>
              ) : (
                visible.map((r) => (
                  <tr key={r.id}>
                    <td style={{ fontSize: 11, color: "var(--muted)" }}>{new Date(r.created_at).toLocaleString("id-ID")}</td>
                    <td style={{ fontFamily: "monospace", fontSize: 11 }}>{r.admin_user_id.slice(0, 10)}</td>
                    <td>
                      <span className="pill pill-info">{r.action}</span>
                    </td>
                    <td style={{ fontSize: 11 }}>
                      {r.target_table}
                      {r.target_id ? `:${String(r.target_id).slice(0, 8)}` : ""}
                    </td>
                    <td style={{ fontFamily: "monospace", fontSize: 11, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis" }}>
                      {r.payload_summary != null ? JSON.stringify(r.payload_summary) : "—"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function InvestorPage() {
  const [data, setData] = useState<{
    gmv: number;
    secondaryVol: number;
    users: number;
    drops: number;
    sold: number;
    units: number;
    dropsRows: { id: string; title: string; status: string; sold_count: number | null; total_units: number }[];
  } | null>(null);

  useEffect(() => {
    async function load() {
      const [wtx, us, dr] = await Promise.all([
        supabase.from("wallet_transactions").select("amount_ccoin,type").limit(1000),
        supabase.from("users").select("id,total_xp").limit(1000),
        supabase.from("drops").select("id,title,status,total_units,sold_count").limit(100),
      ]);
      const w = (wtx.data ?? []) as { amount_ccoin: number; type: string }[];
      const users = (us.data ?? []) as { id: string }[];
      const drops = (dr.data ?? []) as { id: string; title: string; status: string; total_units: number; sold_count: number | null }[];
      const gmv = w.filter((t) => t.type === "checkout" || t.type === "platform_buy").reduce((n, t) => n + Math.abs(t.amount_ccoin), 0);
      const secondaryVol = w.filter((t) => t.type === "payout" || t.type === "royalty").reduce((n, t) => n + Math.abs(t.amount_ccoin), 0);
      setData({
        gmv,
        secondaryVol,
        users: users.length,
        drops: drops.length,
        sold: drops.reduce((n, d) => n + (d.sold_count ?? 0), 0),
        units: drops.reduce((n, d) => n + (d.total_units ?? 0), 0),
        dropsRows: drops,
      });
    }
    load();
  }, []);

  if (!data)
    return (
      <div className="muted" style={{ padding: 24, textAlign: "center" }}>
        Memuat…
      </div>
    );
  return (
    <div className="admin-page">
      <div className="admin-page-head">
        <h2>
          Investor Data Pack{" "}
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--dim)", fontWeight: 400 }}>
            ADM-10 · bukan untuk publik
          </span>
        </h2>
        <p className="muted">Ringkasan metrik kunci untuk meeting fundraising — GMV, user growth, drop performance, secondary volume</p>
      </div>
      <div className="admin-stats">
        <div className="admin-stat-card gold">
          <div className="admin-stat-label">GMV (C-Coin)</div>
          <div className="admin-stat-value">{data.gmv}</div>
          <div className="admin-stat-hint">≈ Rp {(data.gmv * 10000).toLocaleString("id-ID")}</div>
        </div>
        <div className="admin-stat-card">
          <div className="admin-stat-label">Users</div>
          <div className="admin-stat-value">{data.users}</div>
          <div className="admin-stat-hint">Total terdaftar</div>
        </div>
        <div className="admin-stat-card">
          <div className="admin-stat-label">Drops</div>
          <div className="admin-stat-value">{data.drops}</div>
          <div className="admin-stat-hint">
            {data.sold}/{data.units} unit terjual
          </div>
        </div>
        <div className="admin-stat-card">
          <div className="admin-stat-label">Secondary</div>
          <div className="admin-stat-value">{data.secondaryVol}</div>
          <div className="admin-stat-hint">C-Coin volume</div>
        </div>
      </div>
      <div className="card" style={{ marginTop: 14 }}>
        <div className="admin-table-head">Drop performance</div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Drop</th>
                <th>Status</th>
                <th>Terjual</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {data.dropsRows.slice(0, 20).map((d) => (
                <tr key={d.id}>
                  <td style={{ fontWeight: 600, fontSize: 12 }}>{d.title}</td>
                  <td>
                    <span className="pill pill-info" style={{ fontSize: 10 }}>
                      {d.status}
                    </span>
                  </td>
                  <td style={{ fontFamily: "monospace" }}>{d.sold_count ?? 0}</td>
                  <td style={{ fontFamily: "monospace" }}>{d.total_units}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="muted" style={{ fontSize: 11, marginTop: 12 }}>
        Sumber: Supabase (RLS, authenticated read). Data untuk internal founder saja — tidak diekspos ke publik.
      </div>
    </div>
  );
}

function DashboardInner() {
  const [stats, setStats] = useState<{ drops: number; orders: number; creators: number }>({ drops: 0, orders: 0, creators: 0 });
  useEffect(() => {
    async function load() {
      const [d, o, c] = await Promise.all([
        supabase.from("drops").select("id", { count: "exact", head: true }),
        supabase.from("orders").select("id", { count: "exact", head: true }),
        supabase.from("creators").select("id", { count: "exact", head: true }),
      ]);
      setStats({ drops: d.count ?? 0, orders: o.count ?? 0, creators: c.count ?? 0 });
    }
    load();
  }, []);
  return (
    <div className="admin-page">
      <div className="admin-page-head">
        <h2>Dashboard</h2>
        <p className="muted">Ringkasan operasional</p>
      </div>

      <div className="admin-stats">
        <div className="admin-stat-card">
          <div className="admin-stat-label">Drops</div>
          <div className="admin-stat-value">{stats.drops}</div>
          <div className="admin-stat-hint">Koleksi aktif</div>
        </div>
        <div className="admin-stat-card">
          <div className="admin-stat-label">Pesanan</div>
          <div className="admin-stat-value">{stats.orders}</div>
          <div className="admin-stat-hint">Perlu diproses</div>
        </div>
        <div className="admin-stat-card">
          <div className="admin-stat-label">Kreator</div>
          <div className="admin-stat-value">{stats.creators}</div>
          <div className="admin-stat-hint">Terdaftar</div>
        </div>
        <div className="admin-stat-card gold">
          <div className="admin-stat-label">Sistem</div>
          <div className="admin-stat-value" style={{ fontSize: 14 }}>
            Terhubung
          </div>
          <div className="admin-stat-hint">Supabase aktif · MFA aal2</div>
        </div>
      </div>

      <div className="grid-3">
        <div className="card card-pad admin-dash-card">
          <div className="admin-dash-icon">◈</div>
          <div style={{ fontWeight: 700 }}>Drops</div>
          <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
            Buat dan atur jadwal rilis
          </div>
        </div>
        <div className="card card-pad admin-dash-card">
          <div className="admin-dash-icon">⧉</div>
          <div style={{ fontWeight: 700 }}>Pesanan</div>
          <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
            Proses hingga selesai
          </div>
        </div>
        <div className="card card-pad admin-dash-card">
          <div className="admin-dash-icon">₵</div>
          <div style={{ fontWeight: 700 }}>Payout</div>
          <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
            Batch dan rekonsiliasi
          </div>
        </div>
      </div>
      <div className="grid-3" style={{ marginTop: 14 }}>
        <div className="card card-pad admin-dash-card">
          <div className="admin-dash-icon">⬡</div>
          <div style={{ fontWeight: 700 }}>NFC</div>
          <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
            Batch dan QC kartu
          </div>
        </div>
        <div className="card card-pad admin-dash-card">
          <div className="admin-dash-icon">✦</div>
          <div style={{ fontWeight: 700 }}>Lencana</div>
          <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
            Atur penghargaan
          </div>
        </div>
        <div className="card card-pad admin-dash-card">
          <div className="admin-dash-icon">◷</div>
          <div style={{ fontWeight: 700 }}>Audit</div>
          <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
            Riwayat perubahan
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Root — login gate + admin shell ────────────────────────────────────────
export default function App() {
  const { session, aal2, loading, refreshAal2 } = useAdminAuth();
  const nav = useNavigate();

  if (!hasSupabase) return <ConfigErrorScreen />;

  if (loading) {
    return (
      <div className="admin-auth-page">
        <div className="muted">Memuat…</div>
      </div>
    );
  }

  if (!session) return <LoginPage />;
  if (!aal2) return <TotpRequired onVerified={refreshAal2} />;

  async function onLogout() {
    await supabase.auth.signOut();
    localStorage.removeItem("admin_demo_session"); // clean up legacy demo-session leftovers
    nav("/");
  }

  return (
    <Shell email={session.user.email ?? "admin"} onLogout={onLogout}>
      <Routes>
        <Route path="/" element={<DashboardInner />} />
        <Route path="/creators" element={<CreatorsPage />} />
        <Route path="/drops" element={<DropsPage />} />
        <Route path="/orders" element={<OrdersPage />} />
        <Route path="/nfc" element={<NfcPage />} />
        <Route path="/payouts" element={<PayoutsPage />} />
        <Route path="/badges" element={<BadgesPage />} />
        <Route path="/disputes" element={<DisputesPage />} />
        <Route path="/kyc" element={<KycPage />} />
        <Route path="/audit" element={<AuditPage />} />
        <Route path="/investor" element={<InvestorPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Shell>
  );
}

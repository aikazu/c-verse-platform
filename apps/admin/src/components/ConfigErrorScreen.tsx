export function ConfigErrorScreen() {
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
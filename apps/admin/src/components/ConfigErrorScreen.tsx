export function ConfigErrorScreen() {
  return (
    <div className="admin-auth-page">
      <div className="admin-login-card admin-config-card">
        <h3 className="admin-config-title">Konfigurasi tidak lengkap</h3>
        <p className="muted admin-config-copy">
          Supabase wajib dikonfigurasi — mode demo sudah dihapus. Salin <code>apps/admin/.env.example</code> ke <code>.env.local</code>,
          lalu isi <code>VITE_SUPABASE_URL</code> dan <code>VITE_SUPABASE_ANON_KEY</code> (anon key saja, dilindungi RLS dan otorisasi
          peran).
        </p>
      </div>
    </div>
  );
}

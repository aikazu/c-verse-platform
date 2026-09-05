const CONFIRMED_DEVELOPMENT_PROJECT_REF = "rnsfgbhoahzvrbtvjjtw";

export interface RemoteSupabaseConfig {
  projectRef: string;
  supabaseUrl: string;
  anonKey: string;
  serviceRoleKey: string;
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} wajib untuk E2E remote development`);
  return value;
}

function loopbackOrigin(name: string, fallback: string): string {
  const value = process.env[name]?.trim() || fallback;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} harus berupa URL origin yang valid`);
  }
  if (url.protocol !== "http:" || !["localhost", "127.0.0.1"].includes(url.hostname) || url.pathname !== "/" || url.search || url.hash) {
    throw new Error(`${name} harus berupa origin HTTP loopback tanpa path, query, atau fragment`);
  }
  return url.origin;
}

/** Endpoint aplikasi memang lokal; database yang dipakai E2E selalu remote. */
export function localAppOrigins() {
  return {
    api: loopbackOrigin("E2E_API_ORIGIN", "http://127.0.0.1:8787"),
    web: loopbackOrigin("E2E_WEB_ORIGIN", "http://localhost:5173"),
    admin: loopbackOrigin("E2E_ADMIN_ORIGIN", "http://localhost:3000"),
  };
}

/**
 * Membaca kredensial yang sengaja diberi namespace E2E dan mengikatnya ke
 * project development yang sudah dikonfirmasi. Validasi ini dijalankan sebelum
 * helper fixture/auth memanggil PostgREST atau GoTrue.
 */
export function remoteSupabaseConfig(): RemoteSupabaseConfig {
  const projectRef = requiredEnv("E2E_SUPABASE_PROJECT_REF");
  if (projectRef !== CONFIRMED_DEVELOPMENT_PROJECT_REF) {
    throw new Error(`E2E_SUPABASE_PROJECT_REF harus ${CONFIRMED_DEVELOPMENT_PROJECT_REF}, bukan project lain`);
  }

  const rawUrl = requiredEnv("E2E_SUPABASE_URL");
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("E2E_SUPABASE_URL harus berupa URL HTTPS Supabase yang valid");
  }
  if (url.protocol !== "https:" || url.hostname !== `${projectRef}.supabase.co` || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("E2E_SUPABASE_URL tidak cocok dengan project ref development yang dikonfirmasi");
  }

  return {
    projectRef,
    supabaseUrl: url.origin,
    anonKey: requiredEnv("E2E_SUPABASE_ANON_KEY"),
    serviceRoleKey: requiredEnv("E2E_SUPABASE_SERVICE_ROLE_KEY"),
  };
}

/** Credensial proses aplikasi: API menerima service role, browser hanya anon key. */
export function appServerEnv(): Record<string, string> {
  const remote = remoteSupabaseConfig();
  return {
    SUPABASE_URL: remote.supabaseUrl,
    SUPABASE_ANON_KEY: remote.anonKey,
    SUPABASE_SERVICE_ROLE_KEY: remote.serviceRoleKey,
    ENV: "development",
    ENABLE_DEMO_LOGIN: "0",
    EMAIL_ENABLED: "0",
  };
}

export function browserEnv(apiOrigin: string): Record<string, string> {
  const remote = remoteSupabaseConfig();
  return {
    VITE_SUPABASE_URL: remote.supabaseUrl,
    VITE_SUPABASE_ANON_KEY: remote.anonKey,
    VITE_API_URL: apiOrigin,
    VITE_TURNSTILE_SITE_KEY: "",
  };
}

export function reuseExistingServers(): boolean {
  return process.env.E2E_REUSE_SERVERS === "1";
}

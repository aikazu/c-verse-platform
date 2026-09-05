import { expect, type Page } from "@playwright/test";
import { localAppOrigins, remoteSupabaseConfig } from "./env";

const FIXTURE_EMAILS = new Set([
  "admin@cverse.id",
  "demo@cverse.id",
  "hype@creator.id",
  "karina@creator.id",
  "badge.bronze@cverse.id",
  "badge.silver@cverse.id",
  "badge.gold@cverse.id",
  "badge.astral@cverse.id",
  "badge.nova@cverse.id",
]);

interface AuthSession {
  access_token?: string;
  expires_at?: number;
}

// Each worker reuses a fixture session so a suite has one bounded
// generate_link/verify exchange per persona rather than one per test.
const fixtureSessions = new Map<string, AuthSession>();
const pendingFixtureSessions = new Map<string, Promise<AuthSession>>();
const fixtureSessionFailures = new Map<string, unknown>();

function sessionIsUnexpired(session: AuthSession): boolean {
  return typeof session.expires_at === "number" && session.expires_at * 1000 > Date.now() + 60_000;
}

function fixtureEmail(email: string): string {
  const normalized = email.trim().toLowerCase();
  if (!FIXTURE_EMAILS.has(normalized)) {
    throw new Error(`Login E2E hanya diizinkan untuk email fixture canonical, bukan ${normalized}`);
  }
  return normalized;
}

function serviceHeaders(): Record<string, string> {
  const { serviceRoleKey } = remoteSupabaseConfig();
  return {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    "Content-Type": "application/json",
  };
}

/** Pastikan generate_link tidak dapat membuat identitas baru di project remote. */
async function assertExistingFixtureUser(email: string): Promise<void> {
  const { supabaseUrl } = remoteSupabaseConfig();
  const result = await fetch(`${supabaseUrl}/rest/v1/users?email=eq.${encodeURIComponent(email)}&select=id&limit=1`, {
    headers: serviceHeaders(),
  });
  if (!result.ok) throw new Error(`Validasi user fixture ${email} gagal: HTTP ${result.status}`);
  const rows = (await result.json()) as Array<{ id?: string }>;
  if (!rows[0]?.id) throw new Error(`User fixture ${email} tidak ada di project remote development`);
}

/**
 * Membuat token login tanpa menjalankan alur email. Endpoint admin GoTrue hanya
 * menghasilkan token; session tetap diverifikasi melalui endpoint publik yang
 * sama dengan browser. Tidak ada tautan atau token yang ditulis ke log/report.
 */
async function createFixtureSession(email: string): Promise<AuthSession> {
  const fixture = fixtureEmail(email);
  const { anonKey, supabaseUrl } = remoteSupabaseConfig();
  await assertExistingFixtureUser(fixture);

  const generated = await fetch(`${supabaseUrl}/auth/v1/admin/generate_link`, {
    method: "POST",
    headers: serviceHeaders(),
    body: JSON.stringify({ type: "magiclink", email: fixture }),
  });
  if (!generated.ok) throw new Error(`Generate login fixture ${fixture} gagal: HTTP ${generated.status}`);
  const generatedBody = (await generated.json()) as { hashed_token?: string; verification_type?: string };
  const tokenHash = generatedBody.hashed_token;
  const verificationType = generatedBody.verification_type ?? "magiclink";
  if (!tokenHash) throw new Error(`Generate login fixture ${fixture} tidak mengembalikan token hash`);

  const verified = await fetch(`${supabaseUrl}/auth/v1/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: anonKey },
    body: JSON.stringify({ token_hash: tokenHash, type: verificationType }),
  });
  if (!verified.ok) throw new Error(`Verifikasi login fixture ${fixture} gagal: HTTP ${verified.status}`);
  const session = (await verified.json()) as AuthSession;
  if (!session.access_token) throw new Error(`Verifikasi login fixture ${fixture} tidak mengembalikan sesi`);
  return session;
}

async function sessionForFixture(email: string): Promise<AuthSession> {
  const fixture = fixtureEmail(email);
  const cached = fixtureSessions.get(fixture);
  if (cached && sessionIsUnexpired(cached)) return cached;
  const previousFailure = fixtureSessionFailures.get(fixture);
  if (previousFailure) throw previousFailure;
  const existingRequest = pendingFixtureSessions.get(fixture);
  if (existingRequest) return existingRequest;

  const created = createFixtureSession(fixture);
  pendingFixtureSessions.set(fixture, created);
  try {
    const session = await created;
    fixtureSessions.set(fixture, session);
    return session;
  } catch (error) {
    // A provider error must not make each following test issue another request.
    fixtureSessionFailures.set(fixture, error);
    throw error;
  } finally {
    pendingFixtureSessions.delete(fixture);
  }
}

function storageKey(): string {
  const { supabaseUrl } = remoteSupabaseConfig();
  return `sb-${new URL(supabaseUrl).hostname.split(".")[0]}-auth-token`;
}

async function installSession(page: Page, session: AuthSession): Promise<void> {
  await page.addInitScript(
    ([key, sessionJson]) => {
      globalThis.localStorage.setItem(key, sessionJson);
    },
    [storageKey(), JSON.stringify(session)],
  );
}

/** UserMenu hanya dirender setelah auth state resolved. */
export function userMenuLocator(page: Page) {
  return page.locator('button[aria-haspopup="menu"]');
}

/** Login fixture remote tanpa OTP, Mailpit, demo-login API, atau pengiriman email. */
export async function loginAs(page: Page, email: string): Promise<void> {
  const session = await sessionForFixture(email);
  await installSession(page, session);
  await page.goto("/");
  await expect(userMenuLocator(page)).toBeVisible({ timeout: 15_000 });
}

/** Remote E2E tidak memakai mailbox; cleanup tetap idempoten untuk caller lama. */
export async function clearMailbox(_email: string): Promise<void> {}

/** Login admin memakai session remote yang dibentuk server-side; role tetap divalidasi API. */
export async function adminLogin(page: Page): Promise<void> {
  const { admin } = localAppOrigins();
  const session = await sessionForFixture("admin@cverse.id");
  await installSession(page, session);
  await page.goto(`${admin}/`);
  await expect(page.getByRole("button", { name: "Keluar" })).toBeVisible({ timeout: 15_000 });
}

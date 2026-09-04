import type { Session } from "@supabase/supabase-js";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import App from "./App";

const authState = vi.hoisted(() => ({
  value: { session: null as Session | null, loading: false },
}));

vi.mock("./lib/hooks/useAdminAuth", () => ({
  useAdminAuth: () => authState.value,
}));

vi.mock("./lib/supabase", () => ({
  hasSupabase: true,
  supabase: { auth: { signOut: vi.fn() } },
}));

vi.mock("./components/LoginPage", () => ({
  LoginPage: () => <div>login-screen</div>,
}));

vi.mock("./pages/Dashboard", () => ({
  DashboardPage: () => <div>dashboard-screen</div>,
}));

function sessionWithAal1(): Session {
  return {
    access_token: `header.${btoa(JSON.stringify({ aal: "aal1" }))}.signature`,
    refresh_token: "refresh-token",
    expires_in: 3600,
    expires_at: 2_000_000_000,
    token_type: "bearer",
    user: {
      id: "admin-id",
      aud: "authenticated",
      role: "authenticated",
      email: "admin@cverse.id",
      app_metadata: {},
      user_metadata: {},
      created_at: "2026-01-01T00:00:00Z",
    },
  };
}

function renderApp() {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={["/"]}>
      <App />
    </MemoryRouter>,
  );
}

describe("App authentication", () => {
  it("renders the dashboard for an AAL1 email-OTP session without TOTP", () => {
    authState.value = { session: sessionWithAal1(), loading: false };

    const html = renderApp();

    expect(html).toContain("dashboard-screen");
    expect(html).not.toContain("login-screen");
    expect(html).not.toMatch(/totp/i);
  });

  it("renders login without a session", () => {
    authState.value = { session: null, loading: false };

    expect(renderApp()).toContain("login-screen");
  });

  it("keeps the loading screen while the session is resolving", () => {
    authState.value = { session: null, loading: true };

    const html = renderApp();

    expect(html).toContain("Memuat…");
    expect(html).not.toContain("login-screen");
  });
});

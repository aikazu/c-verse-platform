// Creator page-view beacon (docs 09 §2.8 + §3.5): log /c/:username views from
// day 1 into our own DB — invisible to users, no UI copy anywhere.
// The API derives referrer host + coarse city server-side; the client only
// names the creator and (when a session exists) carries the JWT so the RPC
// can attribute viewer_id = auth.uid().
import { supabase } from "./supabase";

// Same-origin base — value replicated from lib/api.ts (not exported there;
// that module is owned by another lane and must not gain surface for this).
const API_BASE = ((import.meta.env.VITE_API_URL as string | undefined) ?? (import.meta.env.PROD ? "https://api.c-verse.co" : "")).replace(
  /\/$/,
  "",
);

/**
 * Fire-and-forget page-view beacon. Never awaits in the render path and never
 * throws — analytics must not be able to disturb the page.
 */
export function trackCreatorPageView(username: string): void {
  if (!username) return;
  void sendViewBeacon(username).catch(() => {
    // Swallowed by contract: beacon failures are never user-visible.
  });
}

async function sendViewBeacon(username: string): Promise<void> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  // Local session read (supabase-js persists it) — no network round-trip.
  if (supabase) {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  await fetch(`${API_BASE}/api/public/${encodeURIComponent(username)}/view`, {
    method: "POST",
    headers,
    body: JSON.stringify({}),
    keepalive: true,
  });
}

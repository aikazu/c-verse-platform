import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const hasSupabase = Boolean(url && anon);

// Supabase env is REQUIRED — App renders a configuration error screen when
// !hasSupabase, so the client below is never exercised unconfigured. The cast
// only satisfies the non-null type without sprinkling guards across pages.
export const supabase: SupabaseClient = hasSupabase ? createClient(url as string, anon as string) : (null as unknown as SupabaseClient);

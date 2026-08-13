import { createClient } from "@supabase/supabase-js";
const url = (import.meta as any).env?.VITE_SUPABASE_URL as string | undefined;
const anon = (import.meta as any).env?.VITE_SUPABASE_ANON_KEY as string | undefined;
export const supabase = url && anon ? createClient(url, anon) : null as any;
export const hasSupabase = Boolean(supabase);

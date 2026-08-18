import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../supabase";

export function useAdminAuth() {
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
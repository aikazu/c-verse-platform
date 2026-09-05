import type { FullConfig } from "@playwright/test";
import { remoteSupabaseConfig } from "./env";

async function healthCheck(url: string, label: string, maxRetries = 10): Promise<void> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const { anonKey } = remoteSupabaseConfig();
      const res = await fetch(url, { headers: { apikey: anonKey } });
      if (res.ok) return;
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`${label} (${url}) tidak responsif setelah ${maxRetries} detik`);
}

export default async function globalSetup(_config: FullConfig) {
  const remote = remoteSupabaseConfig();
  await healthCheck(`${remote.supabaseUrl}/auth/v1/health`, `Supabase remote (${remote.projectRef})`);
  console.log(`✓ Aplikasi lokal dan Supabase remote ${remote.projectRef} siap — E2E test dimulai`);
}

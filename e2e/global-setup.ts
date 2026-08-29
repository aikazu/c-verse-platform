import type { FullConfig } from "@playwright/test";

async function healthCheck(url: string, label: string, maxRetries = 10): Promise<void> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`${label} (${url}) tidak responsif setelah ${maxRetries} detik`);
}

export default async function globalSetup(_config: FullConfig) {
  await healthCheck("http://127.0.0.1:5173", "Web app");
  await healthCheck("http://127.0.0.1:8787/health", "API");
  await healthCheck("http://127.0.0.1:3000", "Admin");
  // Root gateway Kong (54321) balas 404 → pakai health endpoint GoTrue yang 200.
  await healthCheck("http://127.0.0.1:54321/auth/v1/health", "Supabase");
  console.log("✓ Semua service siap — E2E test dimulai");
}

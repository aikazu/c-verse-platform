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
  await healthCheck("http://localhost:5173", "Web app");
  await healthCheck("http://localhost:8787/health", "API");
  await healthCheck("http://localhost:54321", "Supabase");
  console.log("✓ Semua service siap — E2E test dimulai");
}
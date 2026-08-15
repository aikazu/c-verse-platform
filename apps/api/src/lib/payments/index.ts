import type { PaymentProvider } from "./provider.js";

// Env-driven singleton (docs/14 §4). Tanpa MIDTRANS_SERVER_KEY -> null (dev: top-up
// mock instant-credit hanya lewat route wallet lama).

function getEnv(name: string): string | undefined {
  const g = globalThis as unknown as Record<string, string | undefined>;
  const processEnv =
    typeof process !== "undefined" ? (process as unknown as Record<string, Record<string, string | undefined> | undefined>).env : undefined;
  return g[name] ?? processEnv?.[name];
}

let cached: PaymentProvider | null | undefined;

export async function getProvider(): Promise<PaymentProvider | null> {
  if (cached !== undefined) return cached;
  const serverKey = getEnv("MIDTRANS_SERVER_KEY");
  if (!serverKey) {
    cached = null;
    return cached;
  }
  const { createMidtransProvider } = await import("./midtrans.js");
  cached = createMidtransProvider({
    serverKey,
    isProduction: getEnv("MIDTRANS_IS_PRODUCTION") === "true",
  });
  return cached;
}

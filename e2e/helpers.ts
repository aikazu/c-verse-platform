import { type Page, expect } from "@playwright/test";

/**
 * Ambil OTP 6 digit dari Inbucket untuk email tertentu.
 * Inbucket menyimpan email di /api/v1/mailbox/{email}.
 * Retry sampai 10× dengan delay 1s (email butuh waktu sampai).
 */
export async function getOtpFromInbucket(email: string): Promise<string> {
  for (let i = 0; i < 10; i++) {
    try {
      const res = await fetch(`http://localhost:9000/api/v1/mailbox/${encodeURIComponent(email)}`);
      if (!res.ok) {
        await new Promise((r) => setTimeout(r, 1000));
        continue;
      }
      const messages = await res.json();
      if (!Array.isArray(messages) || messages.length === 0) {
        await new Promise((r) => setTimeout(r, 1000));
        continue;
      }
      const body = messages[messages.length - 1].body?.text ?? "";
      const match = body.match(/(\d{6})/);
      if (match) return match[1];
    } catch {
      // Inbucket belum siap
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`OTP tidak ditemukan untuk ${email} setelah 10 percobaan`);
}

/**
 * Login sebagai seed user via email OTP.
 * 1. Buka halaman login
 * 2. Isi email
 * 3. Kirim OTP
 * 4. Ambil OTP dari Inbucket
 * 5. Verifikasi OTP
 * 6. Tunggu redirect ke halaman utama
 */
export async function loginAs(page: Page, email: string): Promise<void> {
  await page.goto("/login");
  await page.waitForSelector('input[type="email"]', { timeout: 10000 });

  // Isi email
  await page.fill('input[type="email"]', email);
  await page.click('button:has-text("Kirim")');

  // Ambil OTP dari Inbucket
  const otp = await getOtpFromInbucket(email);
  await page.fill('input[inputmode="numeric"]', otp);
  await page.click('button:has-text("Verifikasi")');

  // Tunggu login sukses — landing page atau home
  await expect(page.locator("text=Koleksi").or(page.locator("[class*=user-menu]")).first()).toBeVisible({ timeout: 15000 });
}

/** Bersihkan Inbucket mailbox antar test */
export async function clearMailbox(email: string): Promise<void> {
  try {
    await fetch(`http://localhost:9000/api/v1/mailbox/${encodeURIComponent(email)}`, { method: "DELETE" });
  } catch {
    // ok
  }
}
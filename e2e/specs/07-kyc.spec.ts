import { expect, test } from "@playwright/test";
import { KYC_KTP_FIXTURE, KYC_SELFIE_FIXTURE } from "../fixtures/kyc-fixtures";
import { clearMailbox, loginAs } from "../helpers";

test.describe("KYC", () => {
  test.beforeEach(async () => {
    await clearMailbox("demo@cverse.id");
  });

  test("form KYC bisa diakses dari menu", async ({ page }) => {
    await loginAs(page, "demo@cverse.id");
    await page.goto("/me/kyc");
    // Kyc.tsx: form "Ajukan Verifikasi" memakai id kyc-* (bukan atribut name);
    // form tetap render untuk status pending/rejected (hanya hidden saat approved).
    await expect(page.locator("#kyc-fullname")).toBeVisible({ timeout: 10000 });
    await expect(page.locator("#kyc-nik")).toBeVisible();
    await expect(page.locator("#kyc-dob")).toBeVisible();
    await expect(page.locator("#kyc-address")).toBeVisible();

    // Validasi client-side yang nyata di bench lokal: parser NIK (parseNik) +
    // feedback file upload. NIK koheren dengan tanggal lahir (digit 7-12 = 090391
    // → 1991-03-09) sehingga hint "Cocok dengan NIK" muncul.
    await page.locator("#kyc-fullname").fill("E2E Tester");
    await page.locator("#kyc-nik").fill("3174012003910001");
    await page.locator("#kyc-dob").fill("1991-03-09");
    await page.locator("#kyc-address").fill("Jl. Testing No. 123, Jakarta");
    await page.locator("#kyc-ktp").setInputFiles(KYC_KTP_FIXTURE);
    await page.locator("#kyc-selfie").setInputFiles(KYC_SELFIE_FIXTURE);

    await expect(page.locator("text=Valid → 317401 / 200391 / 0001")).toBeVisible();
    await expect(page.locator("text=Cocok dengan NIK")).toBeVisible();
    await expect(page.locator("text=kyc-ktp.png")).toBeVisible();
    await expect(page.locator("text=kyc-selfie.png")).toBeVisible();
  });

  test("submit KYC dengan data valid", async ({ page }) => {
    await loginAs(page, "demo@cverse.id");
    await page.goto("/me/kyc");
    await expect(page.locator("#kyc-fullname")).toBeVisible({ timeout: 10000 });

    // Data koheren NIK↔DOB (digit 7-12 = 090391 → 1991-03-09). Upload jalan ke
    // storage lokal BENERAN (bucket kyc-files, policy kyc_files_owner_insert di
    // 01_schema.sql), lalu POST /api/kyc meng-upsert kyc_records (seed kyc-demo:
    // status pending → resubmit diizinkan, hanya approved yang ditolak 400).
    await page.locator("#kyc-fullname").fill("E2E Tester");
    await page.locator("#kyc-nik").fill("3174012003910001");
    await page.locator("#kyc-dob").fill("1991-03-09");
    await page.locator("#kyc-address").fill("Jl. Testing No. 123, Jakarta");
    await page.locator("#kyc-ktp").setInputFiles(KYC_KTP_FIXTURE);
    await page.locator("#kyc-selfie").setInputFiles(KYC_SELFIE_FIXTURE);
    await page.locator("button.btn-gold").click();

    // Toast sukses hanya muncul kalau upload storage + POST /api/kyc keduanya 2xx.
    await expect(page.locator(".toast-msg", { hasText: "Verifikasi terkirim" })).toBeVisible();
    // Round-trip nyata: status card (hasil GET /api/kyc setelah refetch) menampilkan
    // fullName BARU "E2E Tester" — membuktikan row benar-benar tersimpan (sebelum
    // submit card memuat "Demo Kolektor" dari seed).
    await expect(page.locator(".ac-status-name", { hasText: "E2E Tester" })).toBeVisible();
    // Status tetap pending (bukan approved) — admin yang memutuskan.
    await expect(page.locator(".ac-status-note", { hasText: "Menunggu verifikasi" })).toBeVisible();
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { creatorAccessEmailTemplate, redactEmail, sendCreatorAccessEmail } from "./email.js";

// Test murni modul email (docs/10 §3.6): flag EMAIL_ENABLED default OFF — tanpa
// env, sendCreatorAccessEmail TIDAK menyentuh SMTP dan return { sent:false }.
// Jalur kirim nyata (SMTP SumoPod) tidak dieksekusi di test — flag OFF.

function resetEnv() {
  const g = globalThis as unknown as Record<string, string | undefined>;
  delete g.EMAIL_ENABLED;
  delete g.SMTP_HOST;
  delete g.SMTP_PORT;
  delete g.SMTP_USER;
  delete g.SMTP_PASS;
  delete process.env.EMAIL_ENABLED;
}

describe("lib/email sendCreatorAccessEmail", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    resetEnv();
  });

  it("EMAIL_ENABLED unset -> { sent: false } tanpa mengirim (default OFF)", async () => {
    resetEnv();
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const res = await sendCreatorAccessEmail({ to: "creator@example.com", displayName: "Budi" });
    expect(res).toEqual({ sent: false, reason: "disabled" });
    expect(infoSpy).toHaveBeenCalledWith(expect.stringContaining("nonaktif"));
  });

  it("log PII: tidak menuliskan email tujuan lengkap saat EMAIL_ENABLED OFF (M2)", async () => {
    resetEnv();
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    await sendCreatorAccessEmail({ to: "secretperson@gmail.com", displayName: "Budi" });
    const logged = infoSpy.mock.calls.map((c) => String(c[0] ?? "")).join("\n");
    expect(logged).not.toContain("secretperson@gmail.com");
    expect(logged).toMatch(/^.*s\*+@gmail\.com\b/);
  });

  it("EMAIL_ENABLED=false eksplisit -> tetap { sent: false }", async () => {
    resetEnv();
    (globalThis as unknown as Record<string, string | undefined>).EMAIL_ENABLED = "false";
    const res = await sendCreatorAccessEmail({ to: "creator@example.com", displayName: "Budi" });
    expect(res).toEqual({ sent: false, reason: "disabled" });
  });

  it("template email berbahasa Indonesia, passwordless, berisi email tujuan", () => {
    const { subject, text } = creatorAccessEmailTemplate({ to: "creator@example.com", displayName: "Budi" });
    expect(subject).toBe("Akun Kreator C.Verse kamu sudah aktif");
    expect(text).toContain("tanpa password");
    expect(text).toContain("c-verse.co");
    expect(text).toContain("creator@example.com");
    expect(text).toContain("Budi");
  });
});

describe("redactEmail", () => {
  it("menyimpan domain dan beberapa karakter pertama local-part", () => {
    expect(redactEmail("secretperson@gmail.com")).toMatch(/^s.+@gmail\.com$/);
    expect(redactEmail("secretperson@gmail.com")).not.toBe("secretperson@gmail.com");
  });

  it("local-part 1-2 karakter -> masked seluruhnya", () => {
    expect(redactEmail("ab@gmail.com")).toBe("**@gmail.com");
  });

  it("format tidak valid -> kembalikan apa adanya (defensive)", () => {
    expect(redactEmail("not-an-email")).toBe("not-an-email");
  });
});

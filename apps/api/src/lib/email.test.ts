import { afterEach, describe, expect, it, vi } from "vitest";
import { creatorAccessEmailTemplate, sendCreatorAccessEmail } from "./email.js";

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

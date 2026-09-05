import { afterEach, describe, expect, it, vi } from "vitest";
import {
  creatorAccessEmailTemplate,
  type EmailBindings,
  redactEmail,
  type SendEmailBinding,
  sendCreatorAccessEmail,
  sendEmail,
} from "./email.js";

// Test murni modul email (docs/10 §3.6): flag EMAIL_ENABLED default OFF — tanpa
// flag, tidak ada transport yang disentuh dan result { sent:false }.
// Transport (owner decision 2026-08-29) = Cloudflare Email Service binding
// (`env.EMAIL`, rich message form). Tidak ada kirim nyata di test — binding
// selalu mock.

function resetEnv() {
  const g = globalThis as unknown as Record<string, string | undefined>;
  delete g.EMAIL_ENABLED;
  delete g.EMAIL_FROM;
  delete g.EMAIL;
  delete process.env.EMAIL_ENABLED;
  delete process.env.EMAIL_FROM;
}

function makeBinding(): SendEmailBinding & { send: ReturnType<typeof vi.fn> } {
  return { send: vi.fn().mockResolvedValue({ messageId: "msg_test_1" }) };
}

function enabledEnv(overrides: Partial<EmailBindings> = {}): EmailBindings {
  return { EMAIL_ENABLED: "true", EMAIL: makeBinding(), EMAIL_FROM: "no-reply@c-verse.co", ...overrides };
}

describe("lib/email sendEmail (Cloudflare Email Service binding)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    resetEnv();
  });

  it("EMAIL_ENABLED unset -> { sent:false, reason:'email_disabled' }, binding TIDAK dipanggil", async () => {
    resetEnv();
    const binding = makeBinding();
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const res = await sendEmail(
      { to: "creator@example.com", subject: "s", text: "t", html: "<p>t</p>" },
      { EMAIL: binding, EMAIL_FROM: "no-reply@c-verse.co" },
    );
    expect(res).toEqual({ sent: false, reason: "email_disabled" });
    expect(binding.send).not.toHaveBeenCalled();
    expect(infoSpy).toHaveBeenCalledWith(expect.stringContaining("nonaktif"));
  });

  it("log PII: tidak menuliskan email tujuan lengkap saat EMAIL_ENABLED OFF (M2)", async () => {
    resetEnv();
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    await sendEmail({ to: "secretperson@gmail.com", subject: "s", text: "t", html: "<p>t</p>" });
    const logged = infoSpy.mock.calls.map((c) => String(c[0] ?? "")).join("\n");
    expect(logged).not.toContain("secretperson@gmail.com");
    expect(logged).toMatch(/^.*s\*+@gmail\.com\b/);
  });

  it("EMAIL_ENABLED=false pada binding Worker -> tetap { sent:false }", async () => {
    resetEnv();
    const res = await sendEmail({ to: "creator@example.com", subject: "s", text: "t", html: "<p>t</p>" }, { EMAIL_ENABLED: "false" });
    expect(res).toEqual({ sent: false, reason: "email_disabled" });
  });

  it("EMAIL_ENABLED dari binding Worker tanpa global -> send dipanggil dengan from { email: EMAIL_FROM, name: 'C.Verse' } + text + html", async () => {
    const env = enabledEnv();
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const binding = env.EMAIL as SendEmailBinding & { send: ReturnType<typeof vi.fn> };
    const res = await sendEmail({ to: "creator@example.com", subject: "Akun aktif", text: "body text", html: "<p>body html</p>" }, env);
    expect(res).toEqual({ sent: true });
    expect(binding.send).toHaveBeenCalledTimes(1);
    expect(binding.send).toHaveBeenCalledWith({
      to: "creator@example.com",
      from: { email: "no-reply@c-verse.co", name: "C.Verse" },
      subject: "Akun aktif",
      text: "body text",
      html: "<p>body html</p>",
    });
    expect(infoSpy).not.toHaveBeenCalled();
  });

  it("enabled + binding di globalThis (tanpa env eksplisit) -> tetap terkirim (jalur caller lama)", async () => {
    const g = globalThis as unknown as Record<string, unknown>;
    g.EMAIL_ENABLED = "true";
    g.EMAIL_FROM = "no-reply@c-verse.co";
    const binding = makeBinding();
    g.EMAIL = binding;
    try {
      const res = await sendEmail({ to: "creator@example.com", subject: "s", text: "t", html: "<p>h</p>" });
      expect(res).toEqual({ sent: true });
      expect(binding.send).toHaveBeenCalledWith(expect.objectContaining({ from: { email: "no-reply@c-verse.co", name: "C.Verse" } }));
    } finally {
      delete g.EMAIL;
    }
  });

  it("enabled + EMAIL_FROM hilang -> { sent:false, reason:'email_from_missing' }, tidak mengirim", async () => {
    const env = enabledEnv({ EMAIL_FROM: undefined });
    const binding = env.EMAIL as SendEmailBinding & { send: ReturnType<typeof vi.fn> };
    const res = await sendEmail({ to: "creator@example.com", subject: "s", text: "t", html: "<p>h</p>" }, env);
    expect(res).toEqual({ sent: false, reason: "email_from_missing" });
    expect(binding.send).not.toHaveBeenCalled();
  });

  it("enabled + binding tidak tersedia (Node dev) -> payload di-log, reason 'email_binding_unavailable'", async () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const res = await sendEmail(
      {
        to: "secretperson@gmail.com",
        subject: "Akun aktif",
        // Mimic the real creator template: the recipient address is embedded in
        // both bodies, so the log line must never carry text/html.
        text: "login dengan email ini: secretperson@gmail.com",
        html: "<p>login dengan email ini: <strong>secretperson@gmail.com</strong></p>",
      },
      { EMAIL_ENABLED: "true", EMAIL_FROM: "no-reply@c-verse.co" },
    );
    expect(res).toEqual({ sent: false, reason: "email_binding_unavailable" });
    const logged = infoSpy.mock.calls.map((c) => String(c[0] ?? "")).join("\n");
    expect(logged).toContain("binding");
    expect(logged).toContain("Akun aktif");
    // M2 + audit fix: NO raw PII anywhere in the log — redacted `to` only.
    expect(logged).not.toContain("secretperson@gmail.com");
    expect(logged).not.toContain("login dengan email ini");
    expect(logged).toMatch(/s\*+@gmail\.com/);
  });

  it("send throws dengan E_* code -> reason = code, error mentah di-log server-side", async () => {
    const bindingError = Object.assign(new Error("domain not onboarded"), { code: "E_SENDER_NOT_VERIFIED" });
    const env = enabledEnv();
    (env.EMAIL as { send: ReturnType<typeof vi.fn> }).send.mockRejectedValue(bindingError);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const res = await sendEmail({ to: "creator@example.com", subject: "s", text: "t", html: "<p>h</p>" }, env);
    expect(res).toEqual({ sent: false, reason: "E_SENDER_NOT_VERIFIED" });
    expect(errorSpy).toHaveBeenCalled();
  });

  it("send throws tanpa code -> reason fallback 'email_send_failed'", async () => {
    const env = enabledEnv();
    (env.EMAIL as { send: ReturnType<typeof vi.fn> }).send.mockRejectedValue(new Error("boom"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const res = await sendEmail({ to: "creator@example.com", subject: "s", text: "t", html: "<p>h</p>" }, env);
    expect(res).toEqual({ sent: false, reason: "email_send_failed" });
  });
});

describe("lib/email sendCreatorAccessEmail", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    resetEnv();
  });

  it("EMAIL_ENABLED unset -> { sent:false, reason:'email_disabled' } tanpa mengirim (default OFF)", async () => {
    resetEnv();
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const res = await sendCreatorAccessEmail({ to: "creator@example.com", displayName: "Budi" });
    expect(res).toEqual({ sent: false, reason: "email_disabled" });
    expect(infoSpy).toHaveBeenCalledWith(expect.stringContaining("nonaktif"));
  });

  it("enabled + binding -> kirim email akses kreator dengan template (subject/text/html)", async () => {
    const env = enabledEnv();
    const binding = env.EMAIL as SendEmailBinding & { send: ReturnType<typeof vi.fn> };
    const res = await sendCreatorAccessEmail({ to: "creator@example.com", displayName: "Budi" }, env);
    expect(res).toEqual({ sent: true });
    const msg = binding.send.mock.calls[0]?.[0] as Record<string, string>;
    expect(msg.subject).toBe("Akun Kreator C.Verse kamu sudah aktif");
    expect(msg.text).toContain("tanpa password");
    expect(msg.html).toContain("tanpa password");
    expect(msg.to).toBe("creator@example.com");
  });
});

describe("creatorAccessEmailTemplate", () => {
  it("template email berbahasa Indonesia, passwordless, berisi email tujuan", () => {
    const { subject, text } = creatorAccessEmailTemplate({ to: "creator@example.com", displayName: "Budi" });
    expect(subject).toBe("Akun Kreator C.Verse kamu sudah aktif");
    expect(text).toContain("tanpa password");
    expect(text).toContain("c-verse.co");
    expect(text).toContain("creator@example.com");
    expect(text).toContain("Budi");
  });

  it("html variant: berisi email tujuan, displayName, dan pesan passwordless", () => {
    const { html } = creatorAccessEmailTemplate({ to: "creator@example.com", displayName: "Budi" });
    expect(html).toContain("creator@example.com");
    expect(html).toContain("Budi");
    expect(html).toContain("tanpa password");
    expect(html).toContain("https://c-verse.co");
  });

  it("html variant: displayName di-escape (anti HTML injection)", () => {
    const { html } = creatorAccessEmailTemplate({
      to: "creator@example.com",
      displayName: '<script>alert("x")</script>',
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
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

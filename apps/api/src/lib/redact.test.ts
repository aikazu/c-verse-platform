import { describe, expect, it } from "vitest";
import { redactKycForOwner, redactNik } from "./redact";

describe("redactNik (M5 audit 2026-08-24)", () => {
  it("mempertahankan 4 digit terakhir, masking 12 digit pertama", () => {
    expect(redactNik("3201234567890001")).toBe("************0001");
  });

  it("bukan 16 digit -> kembalikan apa adanya (defensive)", () => {
    expect(redactNik("not-a-nik")).toBe("not-a-nik");
    expect(redactNik("")).toBe("");
    expect(redactNik("1234")).toBe("1234");
    expect(redactNik("12345678901234567")).toBe("12345678901234567");
  });
});

describe("redactKycForOwner", () => {
  it("menyimpan status/id/timestamps; nik ter-mask; address jadi placeholder", () => {
    const out = redactKycForOwner({
      id: "kyc-1",
      userId: "u-1",
      fullName: "Budi",
      nik: "3201234567890001",
      address: "Jl. Sudirman No. 1, Jakarta",
      status: "pending",
      createdAt: "2026-08-24T00:00:00Z",
      ktpObjectKey: "u-1/ktp-private.png",
      selfieObjectKey: "u-1/selfie-private.jpg",
    });
    expect(out).toMatchObject({
      id: "kyc-1",
      userId: "u-1",
      fullName: "Budi",
      nik: "************0001",
      address: "[redacted]",
      status: "pending",
    });
    expect(out.address).not.toContain("Sudirman");
    expect(out).not.toHaveProperty("ktpObjectKey");
    expect(out).not.toHaveProperty("selfieObjectKey");
  });
});

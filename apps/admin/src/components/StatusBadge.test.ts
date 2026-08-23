import { dropStatusLabel, kycStatusLabel, orderStatusLabel, shipmentStatusLabel } from "@c-verse/shared";
import { describe, expect, it } from "vitest";
import { labelFor, variantFor } from "./StatusBadge";

// Pure-logic tests for StatusBadge helpers — no DOM, no @testing-library.
// These guarantee the pill color + label stay in sync with @c-verse/shared.

describe("variantFor", () => {
  it("maps success-domain statuses to the success variant", () => {
    expect(variantFor("live")).toBe("success");
    expect(variantFor("settled")).toBe("success");
    expect(variantFor("approved")).toBe("success");
    expect(variantFor("delivered")).toBe("success");
    expect(variantFor("resolved_refund")).toBe("success");
  });

  it("maps warn-domain statuses to the warn variant", () => {
    expect(variantFor("scheduled")).toBe("warn");
    expect(variantFor("pending")).toBe("warn");
    expect(variantFor("qc")).toBe("warn");
    expect(variantFor("packed")).toBe("warn");
  });

  it("maps info-domain statuses to the info variant", () => {
    expect(variantFor("shipped")).toBe("info");
    expect(variantFor("closed")).toBe("info");
    expect(variantFor("sold_out")).toBe("info");
  });

  it("maps danger-domain statuses to the danger variant", () => {
    expect(variantFor("cancelled")).toBe("danger");
    expect(variantFor("rejected")).toBe("danger");
    expect(variantFor("tamper_detected")).toBe("danger");
    expect(variantFor("disputed")).toBe("danger");
    expect(variantFor("resolved_suspend")).toBe("danger");
  });

  it("falls back to info for unknown statuses", () => {
    expect(variantFor("not_a_real_status")).toBe("info");
    expect(variantFor("")).toBe("info");
  });
});

describe("labelFor", () => {
  it("delegates drop/order/shipment/kyc to @c-verse/shared mappers", () => {
    expect(labelFor("drop", "live")).toBe(dropStatusLabel("live"));
    expect(labelFor("drop", "sold_out")).toBe("Habis");
    expect(labelFor("order", "delivered")).toBe(orderStatusLabel("delivered"));
    expect(labelFor("shipment", "shipped")).toBe(shipmentStatusLabel("shipped"));
    expect(labelFor("kyc", "approved")).toBe(kycStatusLabel("approved"));
  });

  it("returns the raw status when kind is generic", () => {
    expect(labelFor("generic", "some_raw_state")).toBe("some_raw_state");
  });
});

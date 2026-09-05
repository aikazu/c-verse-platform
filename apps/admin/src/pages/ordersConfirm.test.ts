import { describe, expect, it } from "vitest";
import { shipmentActionsForStatus, shipmentConfirmOptions, shipmentDestination } from "./Orders";

// Pure-logic tests untuk opsi konfirmasi D8 transisi pengiriman
// (pola kycRows.test.ts). Import Orders.tsx aman tanpa DOM — modul level
// tidak menyentuh supabase saat import.

describe("shipmentConfirmOptions", () => {
  it("semua transisi aksi admin punya konfirmasi (D8)", () => {
    expect(shipmentConfirmOptions("requested", undefined)).toBeNull(); // bukan aksi
    expect(shipmentConfirmOptions("packed", undefined)?.title).toContain("dipacking");
    expect(shipmentConfirmOptions("shipped", "RESI-1")?.title).toContain("dikirim");
    expect(shipmentConfirmOptions("shipped", undefined)?.title).toContain("tanpa nomor resi");
    expect(shipmentConfirmOptions("delivered", undefined)?.title).toContain("selesai");
    expect(shipmentConfirmOptions("cancelled", undefined)?.title).toContain("Batalkan");
  });

  it("kirim tanpa resi = danger, transisi lain standar kecuali Batal", () => {
    expect(shipmentConfirmOptions("shipped", undefined)?.danger).toBe(true);
    expect(shipmentConfirmOptions("shipped", "RESI-1")?.danger).toBeUndefined();
    expect(shipmentConfirmOptions("cancelled", undefined)?.danger).toBe(true);
    expect(shipmentConfirmOptions("packed", undefined)?.danger).toBeUndefined();
    expect(shipmentConfirmOptions("delivered", undefined)?.danger).toBeUndefined();
  });

  it("transisi tanpa aksi admin -> null (tanpa modal)", () => {
    expect(shipmentConfirmOptions("unknown_status", undefined)).toBeNull();
  });

  it("aksi ditentukan langsung dari status shipment, tanpa order terkait", () => {
    expect(shipmentActionsForStatus("requested")).toEqual(["packed", "cancelled", "shipped"]);
    expect(shipmentActionsForStatus("packed")).toEqual(["shipped", "cancelled"]);
    expect(shipmentActionsForStatus("shipped")).toEqual(["delivered"]);
    expect(shipmentActionsForStatus("delivered")).toEqual([]);
    expect(shipmentActionsForStatus("cancelled")).toEqual([]);
  });

  it("menampilkan tujuan shipment dari destination dan alamat operasional", () => {
    expect(shipmentDestination({ to_dest: "platform_vault", address: null })).toBe("platform_vault");
    expect(shipmentDestination({ to_dest: "buyer_address", address: { street: "Jl. C.Verse 1" } })).toBe("buyer_address · Jl. C.Verse 1");
  });
});

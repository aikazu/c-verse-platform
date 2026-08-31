import { describe, expect, it } from "vitest";
import { shipmentConfirmOptions } from "./Orders";

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
});

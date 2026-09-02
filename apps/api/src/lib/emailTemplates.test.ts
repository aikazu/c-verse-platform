import { describe, expect, it } from "vitest";
import { renderNotificationEmail } from "./emailTemplates.js";

// Template notifikasi transaksional (lane email low volume, high value).
// Setiap template_key yang masuk queue email (channel='email', status='pending')
// WAJIB punya render di sini — key tanpa render dianggap kegagalan permanen
// oleh worker (drainEmailQueue).

describe("lib/emailTemplates renderNotificationEmail", () => {
  it("topup_settled: amount + balance muncul di subject/text/html", () => {
    const mail = renderNotificationEmail("topup_settled", { amount: 100, balance: 250, refId: "TOPUP-1" });
    expect(mail).not.toBeNull();
    expect(mail?.subject).toContain("100");
    expect(mail?.text).toContain("250");
    expect(mail?.html).toContain("100");
  });

  it("payout_disbursed & payout_failed: amount + payoutId", () => {
    const paid = renderNotificationEmail("payout_disbursed", { payoutId: "po-1", amount: 40 });
    const failed = renderNotificationEmail("payout_failed", { payoutId: "po-2", amount: 30, status: "failed" });
    expect(paid?.subject).toContain("40");
    expect(failed?.subject).toContain("gagal");
    expect(failed?.text).toContain("30");
  });

  it("bid_accepted & card_bought: amount", () => {
    const accepted = renderNotificationEmail("bid_accepted", { cardId: "c-1", amount: 50 });
    const sold = renderNotificationEmail("card_bought", { cardId: "c-1", amount: 50 });
    expect(accepted?.subject).toContain("50");
    expect(sold?.subject).toContain("terjual");
  });

  it("shipment_shipped memuat nomor resi; delivered tanpa resi", () => {
    const shipped = renderNotificationEmail("shipment_shipped", { cardId: "c-1", trackingNumber: "JX123" });
    const delivered = renderNotificationEmail("shipment_delivered", { cardId: "c-1" });
    expect(shipped?.text).toContain("JX123");
    expect(shipped?.html).toContain("JX123");
    expect(delivered?.subject).toContain("tiba");
  });

  it("kyc_approved & kyc_rejected render tanpa payload", () => {
    expect(renderNotificationEmail("kyc_approved", {})?.subject).toContain("disetujui");
    expect(renderNotificationEmail("kyc_rejected", {})?.subject).toContain("ditolak");
  });

  it("drop_won: judul drop + variant", () => {
    const mail = renderNotificationEmail("drop_won", { dropId: "d-1", dropTitle: "Karina Signed", variant: "signed", amount: 20 });
    expect(mail?.subject).toContain("Karina Signed");
    expect(mail?.text).toContain("Signed");
  });

  it("payload string di-escape di html (anti XSS-in-email)", () => {
    const mail = renderNotificationEmail("drop_won", { dropId: "d-1", dropTitle: "<script>x</script>", variant: "signed", amount: 1 });
    expect(mail?.html).not.toContain("<script>");
    expect(mail?.html).toContain("&lt;script&gt;");
  });

  it("payload null / field hilang -> tetap render aman (fallback kosong)", () => {
    const mail = renderNotificationEmail("topup_settled", null);
    expect(mail).not.toBeNull();
  });

  it("template_key tanpa render (mis. bid_outbid / drop_lost) -> null", () => {
    expect(renderNotificationEmail("bid_outbid", {})).toBeNull();
    expect(renderNotificationEmail("drop_lost", {})).toBeNull();
    expect(renderNotificationEmail("unknown_key", {})).toBeNull();
  });
});

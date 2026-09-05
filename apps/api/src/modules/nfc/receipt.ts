import { hkdfSync } from "node:crypto";
import { jwtVerify, SignJWT } from "jose";

const PURPOSE = "cverse:nfc-view-receipt:v1";

function receiptKey(master: Uint8Array): Uint8Array {
  // A separate HKDF purpose keeps browser receipts separate from NFC app keys.
  return new Uint8Array(hkdfSync("sha256", master, "", PURPOSE, 32));
}

/** A short-lived view receipt never advances or reuses a physical SUN counter. */
export async function issueViewReceipt(master: Uint8Array, cardId: string): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(PURPOSE)
    .setAudience("card-viewer")
    .setSubject(cardId)
    .setIssuedAt()
    .setExpirationTime("60s")
    .sign(receiptKey(master));
}

export async function verifyViewReceipt(master: Uint8Array, cardId: string, receipt: string): Promise<boolean> {
  try {
    await jwtVerify(receipt, receiptKey(master), {
      algorithms: ["HS256"],
      issuer: PURPOSE,
      audience: "card-viewer",
      subject: cardId,
      maxTokenAge: "60s",
    });
    return true;
  } catch {
    return false;
  }
}

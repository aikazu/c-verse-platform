// Web NFC (Android Chrome) tap relay — feature-detected, fully silent.
// The browser NEVER constructs crypto material: everything here is opaque
// pass-through of what the physical C.Card itself emits — either the SUN URL
// stored on the tag (?uid=&ctr=&c=&t=) or the tag serial number — forwarded
// verbatim to POST /api/nfc/verify-nfc, where the server is the sole verifier.

/** Pass-through payload read off the tag; forwarded as-is to /api/nfc/verify-nfc. */
export interface NfcTapPayload {
  uid: string;
  counter?: string;
  cmac?: string;
  t?: string;
  shortId?: string;
}

// Minimal structural types — lib.dom.d.ts does not ship Web NFC typings, and we
// only touch the tiny surface needed to read records off a tap.
interface NdefRecordLike {
  readonly recordType: string;
  readonly data: Readonly<Uint8Array> | undefined;
}
interface NdefMessageLike {
  readonly records: ReadonlyArray<NdefRecordLike>;
}
interface NdefReadingEventLike {
  readonly message: NdefMessageLike;
  readonly serialNumber: string | null;
}
interface NdefReaderLike {
  scan(): Promise<void>;
  addEventListener(type: "reading", listener: (event: NdefReadingEventLike) => void): void;
}
type NdefReaderCtor = new () => NdefReaderLike;

export function isWebNfcSupported(): boolean {
  return typeof window !== "undefined" && "NDEFReader" in window;
}

function decodeRecord(record: NdefRecordLike): string | null {
  if (!record.data) return null;
  try {
    return new TextDecoder().decode(record.data);
  } catch {
    return null;
  }
}

/** The tag's NDEF URL record carries the SUN params (?uid=&ctr=&c=&t=) — relay only. */
function tapPayloadFromUrlRecords(records: ReadonlyArray<NdefRecordLike>): NfcTapPayload | null {
  for (const record of records) {
    if (record.recordType !== "url") continue;
    const raw = decodeRecord(record);
    if (!raw) continue;
    // Some tag writers keep the URI-prefix byte terse; normalize defensively.
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      try {
        url = new URL(`https://${raw}`);
      } catch {
        continue;
      }
    }
    const uid = url.searchParams.get("uid") ?? url.searchParams.get("UID");
    if (!uid) continue;
    return {
      uid,
      counter: url.searchParams.get("ctr") ?? undefined,
      cmac: url.searchParams.get("c") ?? url.searchParams.get("cmac") ?? undefined,
      t: url.searchParams.get("t") ?? undefined,
      shortId: url.searchParams.get("shortId") ?? url.searchParams.get("id") ?? undefined,
    };
  }
  return null;
}

/** Fallback without an URL record: serial number = UID only (QR-grade server-side). */
function tapPayloadFromSerial(serialNumber: string | null): NfcTapPayload | null {
  if (!serialNumber) return null;
  const uid = serialNumber.replace(/[:\s-]/g, "").toLowerCase();
  return uid ? { uid } : null;
}

/**
 * Start listening for physical card taps. Returns a cleanup function — a no-op
 * when Web NFC is unsupported or the reader cannot start (callers stay silent).
 * Chrome requires transient user activation for `scan()`, so a failed first
 * attempt is retried once on the first pointer interaction.
 */
export function scanNfcTaps(onTap: (payload: NfcTapPayload) => void): () => void {
  if (!isWebNfcSupported()) return () => {};
  const readerCtor = (window as unknown as { NDEFReader?: NdefReaderCtor }).NDEFReader;
  if (!readerCtor) return () => {};

  let isDisposed = false;
  let isArmed = false;
  let removeGestureHook: (() => void) | null = null;

  const handleReading = (event: NdefReadingEventLike) => {
    if (isDisposed) return;
    const payload = tapPayloadFromUrlRecords(event.message.records) ?? tapPayloadFromSerial(event.serialNumber);
    if (payload) onTap(payload);
  };

  const arm = async (): Promise<boolean> => {
    if (isArmed || isDisposed) return isArmed;
    try {
      const reader = new readerCtor();
      await reader.scan();
      if (isDisposed) return isArmed;
      reader.addEventListener("reading", handleReading);
      isArmed = true;
    } catch {
      // No activation, permission denied, or platform refusal — stay silent.
    }
    return isArmed;
  };

  void arm().then((isArmedNow) => {
    if (isArmedNow || isDisposed) return;
    const onFirstGesture = () => {
      removeGestureHook = null;
      void arm();
    };
    window.addEventListener("pointerdown", onFirstGesture, { once: true });
    removeGestureHook = () => window.removeEventListener("pointerdown", onFirstGesture);
  });

  return () => {
    isDisposed = true;
    removeGestureHook?.();
    removeGestureHook = null;
  };
}

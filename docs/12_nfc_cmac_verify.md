# 12 — NFC CMAC Verify (provenance sesungguhnya)

> Status: [DRAFT — SPEC SIAP EKSEKUSI]
> Created: 2026-08-15
> Basis audit: `apps/api/src/routes/nfc.ts` — endpoint `verify-nfc` menerima
> `cmac`+`counter` lalu MENGABAIKANNYA; verdict "verified" hanya dari lookup
> UID. Badge "Verified Card" bisa dipalsukan siapa pun yang tahu UID.
> Estimasi: 2-4 hari AI-assisted. Dependency: tidak ada (paralel dengan 10/11).
> Mengimplement: keputusan NFC N5 (SUN/SDM — ISO 7816-4 file
> system, SDM mirror UID+counter+CMAC ke NDEF, server-side CMAC
> verify; N5b iOS via SUN URL) + `06_tech_decisions.md`
> D2+D4, `07_constraints.md` C-03.

## 1. Desain Kripto (sesuai keputusan docs)

```
AppMasterKey (Workers secret NFC_MASTER_KEY, 16 byte hex)
      |
      | key diversification: AppKey = AES-CMAC(MasterKey, UID[7])
      v
Tag NTAG 424 DNA TagTamper (SUN/SDM aktif):
  tiap tap, tag mirror ke NDEF URL:
  https://c-verse.co/cards/{shortId}/3d?uid={uid}&ctr={ctr}&c={cmac}
  cmac = AES-CMAC(AppKey, SUN-message)   // UID + counter + tamper status
      |
      v
Server: derive AppKey dari uid → hitung expected CMAC →
  compare (constant-time) → cek counter > last_ctr → parse tamper bit
      |
      v
verdict: verified | tamper_detected | unknown
```

- Key diversification per-UID dipilih (bukan simpan AppKey per tag) sesuai
  `18_nfc_decision.md` N5 — tidak butuh tabel kunci, master tidak pernah
  keluar server.
- SUN message layout byte-exact: ikuti **NXP AN12196 (SUN)** — UID[7] +
  ReadCounter[3] + TagTamper status + file data tertentu. JANGAN
  dikarang dari ingatan: implement dari dokumen AN12196 + **test vector
  resmi NXP** sebagai unit test wajib pertama.

## 2. Deliverable Code

### 2,1 `apps/api/src/lib/cmac.ts`
```
aesCmac(key: Uint8Array /*16*/, message: Uint8Array): Uint8Array /*16*/
  - AES-CMAC per RFC 4493 (subkey K1/K2 dari encrypt zero-block)
  - Workers: Web Crypto AES-CBC encrypt satu block (no nodejs_compat)
deriveAppKey(master: Uint8Array, uid: Uint8Array /*7*/): Uint8Array
  = aesCmac(master, uid)
verifySun({ uidHex, ctrHex, cmacHex, tamperBit }, master): {
  valid: boolean; reason?: 'bad_cmac' | 'bad_format'
}
```
- Compare pakai constant-time (`crypto.subtle.timingSafeEqual` atau XOR loop).

### 2,2 Route (rewrite `nfc.ts`)
- `GET /cards/:shortId/3d` menerima `?uid=&ctr=&c=` (SUN URL dari tap
  fisik — Android Web NFC maupun iOS background reading sama-sama
  menghasilkan URL ini):
  1. Resolve card by short_id.
  2. `verifySun(...)` — CMAC mismatch → `verifyStatus: 'unknown'` +
     log fraud signal (`cards.flag`/audit). JANGAN fallback jadi verified.
  3. Anti-replay: `UPDATE cards SET last_ctr = $ctr
     WHERE id = $id AND last_ctr < $ctr` — 0 row = counter mundur/ulang →
     tolak + fraud signal. [IMPLEMENTED 2026-08-16 — persist atomic
     di `apps/api/src/routes/nfc.ts`, bukan read-modify-write JS]
  4. TagTamper bit set → set `cards.verify_status = 'tamper_detected'`
     (permanen, irreversible) → tampil badge tamper + WAJIB audit log
     (`nfc_tamper_flagged`) — counter tetap dimajukan (tap valid).
  5. Semua lolos → tampil 3D + badge "Verified Card".
- QR-grade (`/verify/:shortId`, `verify-nfc` tanpa crypto, `sun-verify`
  tanpa param crypto) [IMPLEMENTED 2026-08-16]: hanya upgrade
  `unknown|registered → registered` — TIDAK PERNAH menurunkan
  `verified`/`tamper_detected` yang sudah diraih.
- `POST /api/nfc/verify` — sama, untuk Web NFC programmatic read.
- `last_ctr` TIDAK di-reset saat transfer kepemilikan — counter adalah
  properti fisik tag; reset = membuka celah replay tap lama.
- HAPUS: `POST /simulate-tamper/:cardId` dari route publik (pindah ke
  admin service-role untuk demo/QC).

### 2,3 Schema NFC (di fase 1 migration `foundation`,
timestamp `20260817000000`)
- `cards.last_ctr integer not null default 0` (anti-replay).
- `cards.nfc_uid` & `cards.nfc_short_id` (sudah unique — dipakai lookup).
- `cards.verify_status` enum: `unknown | registered | verified |
  tamper_detected` — QR path set `registered` (tanpa CMAC), tap path set
  `verified`.

### 2,4 Provisioning tool (scope minimal MVP — bukan code besar)
Untuk batch kecil (20-50 tag/pilot), pakai **NXP TapLinx Android app /
"NFC Writer & TapLinx Configurator"** GUI:
1. Generate AppKey per UID: script admin (service-role) cetak
   `deriveAppKey(master, uid)` → operator copy ke TapLinx.
2. Konfigurasi tag: NDEF URL template
   `https://c-verse.co/cards/{shortId}/3d` + SDM mirror
   (UID+counter+CMAC) + TagTamper enable + PICC key set.
3. Input mapping ke ADM-04: `nfc_uid ↔ short_id ↔ card_id`, reset
   `last_ctr=0`, `nfc_configured=true`.
Tool desktop custom (ACR122U/Python) = opsional Y2 kalau volume > 200 tag.

## 3. Validasi Device (gate C-03 — wajib sebelum fallback QR dimatikan)

Checklist uji iPhone nyata (minimal 2 device: iOS lama 15-16 & baru 17+):
- [ ] Layar terkunci / mati → tap → muncul notifikasi tag? URL terbuka?
- [ ] Prompt "Open in Safari?" muncul atau langsung navigate?
- [ ] SUN URL lengkap dengan `uid/ctr/c` sampai ke server (cek access log)?
- [ ] Parity UX vs Android Chrome 89+ (Web NFC scan di halaman).
- [ ] TagTamper physical test: buka 1 kartu sample → bit set → server
      tampil "Tamper detected" permanen.

Hasil C-03 dicatat di `07_constraints.md` (update status DRAFT → hasil).

## 4. Test Wajib (vitest)

- [ ] AES-CMAC RFC 4493 test vectors (publik) pass.
- [ ] NXP AN12196 SUN sample vector pass (dari dokumen NXP).
- [ ] `verifySun`: cmac salah 1 byte → invalid; ctr format aneh → bad_format.
- [ ] Counter mundur (ctr <= last_ctr) → ditolak, tidak ubah last_ctr.
- [ ] TagTamper bit → verify_status permanen tamper_detected.
- [ ] QR short_id TANPA param crypto → maksimal "registered", tidak pernah
      "verified".

## 5. Jangan Dilakukan

- Jangan pernah return `verified` tanpa CMAC match (termasuk "untuk demo" —
  pakai flag kartu seed `verify_status='verified'` di DB dev, bukan bypass).
- Jangan log full CMAC/UID di response error (info untuk forger).
- Jangan simpan AppKey per-tag di tabel readable — derivation stateless.
- Jangan matikan fallback QR sebelum C-03 lulus.

## 6. Acceptance Criteria

- [ ] Tap kartu fisik (Chrome Android) → URL SUN → server verified.
- [ ] QLIP/clone URL dengan cmac ngawur → rejected + fraud signal tercatat.
- [ ] Replay URL yang sama (ctr sama) → kedua kali ditolak.
- [ ] `nfc.ts` tidak lagi menerima request tanpa memvalidasi field crypto.

## 7. Sumber

- Keputusan NFC N5 (arsitektur SUN/SDM: ISO 7816-4 file system,
  SDM mirror UID+counter+CMAC ke NDEF, key derivation master key +
  UID, validation flow 5 langkah dari tap → lookup → derive CMAC →
  compare → parse TagTamper status), N5b (iOS SUN URL — Web NFC
  API TIDAK support di iOS, tapi tap-to-verify jalan via SUN URL,
  koreksi 2026-08-12).
- `dev-strategy/06_tech_decisions.md` D2, D4 (CMAC < 1ms, master key di
  Workers Secrets, O-1).
- `dev-strategy/07_constraints.md` C-03, C-04.
- NXP AN12196 (SUN), RFC 4493 (AES-CMAC).

# 12 — NFC CMAC Verify (provenance sesungguhnya)

> Status: [DRAFT — SPEC SIAP EKSEKUSI]
> Created: 2026-08-15
> Basis audit: `apps/api/src/routes/nfc.ts` — endpoint `verify-nfc` menerima
> `cmac`+`counter` lalu MENGABAIKANNYA; verdict "verified" hanya dari lookup
> UID. Badge "Verified Card" bisa dipalsukan siapa pun yang tahu UID.
> Estimasi: 2-4 hari AI-assisted. Dependency: tidak ada (paralel dengan 10/11).
> Mengimplement: `90_research/18_nfc_decision.md` N5, `06_tech_decisions.md`
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
     tolak + fraud signal.
  4. TagTamper bit set → set `cards.verify_status = 'tamper_detected'`
     (permanen, irreversible) → tampil badge tamper.
  5. Semua lolos → tampil 3D + badge "Verified Card".
- `POST /api/nfc/verify` — sama, untuk Web NFC programmatic read.
- HAPUS: `POST /simulate-tamper/:cardId` dari route publik (pindah ke
  admin service-role untuk demo/QC).

### 2,3 Schema NFC (di fase 1 `20260817000000_foundation.sql`)
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

- `90_research/18_nfc_decision.md` N5 (arsitektur SUN/SDM, key derivation,
  validation flow 5 langkah), N5b (iOS SUN URL).
- `dev-strategy/06_tech_decisions.md` D2, D4 (CMAC < 1ms, master key di
  Workers Secrets, O-1).
- `dev-strategy/07_constraints.md` C-03, C-04.
- NXP AN12196 (SUN), RFC 4493 (AES-CMAC).

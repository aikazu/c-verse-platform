// C.Verse — Lane D (2026-08-31): anon-key PostgREST read `bids` (bidder_name)
// dan `creators` (bank_account/notes) HARUS ditolak (revoke select dari anon).
// Key TIDAK di-hardcode: dibaca dari apps/web/.env.local; kalau file/env tidak
// ada, test SKIP gracefully (konvensi repo, cf. rpc_nfc_replay_test.mjs).
// Jalankan:
//   node supabase/tests/rest_anon_read_test.mjs
import { existsSync, readFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function readWebEnv() {
  const envPath = path.join(root, "apps/web/.env.local");
  if (!existsSync(envPath)) return null;
  const text = readFileSync(envPath, "utf8");
  const pick = (name) => {
    const m = text.match(new RegExp(`^\\s*${name}\\s*=\\s*"?([^"\\r\\n]+)"?\\s*$`, "m"));
    return m ? m[1].trim() : null;
  };
  const url = pick("VITE_SUPABASE_URL");
  const key = pick("VITE_SUPABASE_ANON_KEY");
  return url && key ? { url: url.replace(/\/+$/, ""), key } : null;
}

const results = [];
function report(id, pass, detail) {
  results.push({ id, pass });
  console.log(`${id} ${pass ? "PASS" : "FAIL"}${detail ? ` (${detail})` : ""}`);
}

const env = readWebEnv();
if (!env) {
  console.log("SKIP rest_anon_read_test — apps/web/.env.local (VITE_SUPABASE_URL/ANON_KEY) tidak tersedia");
  process.exit(0);
}

// node:http (bukan global fetch): socket dihancurkan eksplisit — undici
// keep-alive memicu libuv assertion win/async.c saat process.exit di Windows.
function anonSelect(table, columns) {
  return new Promise((resolve) => {
    const req = http.request(
      `${env.url}/rest/v1/${table}?select=${columns}&limit=1`,
      { method: "GET", headers: { apikey: env.key, Authorization: `Bearer ${env.key}` } },
      (res) => {
        let body = "";
        res.on("data", (d) => {
          body += d;
          if (body.length > 200) res.destroy();
        });
        res.on("end", () =>
          resolve({ isOk: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, body: body.slice(0, 120) }),
        );
        res.on("close", () =>
          resolve({ isOk: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, body: body.slice(0, 120) }),
        );
      },
    );
    req.on("error", (e) => resolve({ isOk: false, status: 0, body: String(e).slice(0, 120) }));
    req.end();
  });
}

{
  const r = await anonSelect("bids", "bidder_name");
  report("r1 anon REST select bids.bidder_name rejected", !r.isOk, `status=${r.status} ${r.body}`);
}
{
  const r = await anonSelect("creators", "bank_account,notes");
  report("r2 anon REST select creators.bank_account/notes rejected", !r.isOk, `status=${r.status} ${r.body}`);
}
// Sanity: reads publik yang memang sah tetap jalan (drops) — revoke tidak over-block.
{
  const r = await anonSelect("drops", "id,title");
  report("r3 anon REST select drops still allowed", r.isOk, `status=${r.status} ${r.body}`);
}

const failed = results.filter((r) => !r.pass).length;
console.log(`\n${results.length - failed}/${results.length} PASS`);
process.exit(failed > 0 ? 1 : 0);

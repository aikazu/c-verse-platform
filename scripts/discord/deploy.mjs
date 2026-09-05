import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { readState } from "./client.mjs";

export async function notifyDeployment({ app, exitCode, revision, webhookUrl, fetcher = fetch }) {
  if (!webhookUrl) return false;
  const url = new URL(webhookUrl);
  if (url.origin !== "https://discord.com" || !/^\/api(?:\/v10)?\/webhooks\/\d+\/[^/]+$/.test(url.pathname)) {
    throw new Error("Expected a Discord incoming webhook URL");
  }
  url.searchParams.set("wait", "true");
  const result = await fetcher(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(10000),
    body: JSON.stringify({
      allowed_mentions: { parse: [] },
      embeds: [
        {
          title: `Deploy ${exitCode === 0 ? "berhasil" : "gagal"} · ${app}`,
          color: exitCode === 0 ? 0x4ecdc4 : 0xff6b6b,
          description: `Wrangler selesai dengan exit code ${exitCode}.\nCommit lokal: ${revision || "tidak diketahui"}.\nIni hasil perintah deploy; smoke test aplikasi tetap diperlukan.`,
          timestamp: new Date().toISOString(),
          footer: { text: "C.Verse · Deployment" },
        },
      ],
    }),
  });
  if (!result.ok) throw new Error(`Discord deployment notification failed: HTTP ${result.status}`);
  return true;
}

export async function runDeployment({ execute, notify, report = console.warn }) {
  const exitCode = await execute();
  try {
    await notify(exitCode);
  } catch {
    report("Deployment notification failed; the deployment exit code is preserved. No credentials were logged.");
  }
  return exitCode;
}

async function main() {
  const app = JSON.parse(readFileSync(resolve("package.json"), "utf8")).name;
  if (!["@c-verse/api", "@c-verse/web", "@c-verse/admin"].includes(app)) throw new Error("Run through an application deploy script");
  const packagePath = resolve("node_modules/wrangler/package.json");
  const binary = JSON.parse(readFileSync(packagePath, "utf8")).bin.wrangler;
  const entry = resolve(dirname(packagePath), binary);
  const revision = spawnSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8", windowsHide: true }).stdout?.trim();
  process.exitCode = await runDeployment({
    execute: () =>
      new Promise((done, reject) => {
        const child = spawn(process.execPath, [entry, "deploy", ...process.argv.slice(2)], { stdio: "inherit", windowsHide: true });
        child.once("error", reject);
        child.once("exit", (code) => done(code ?? 1));
      }),
    notify: async (exitCode) => {
      const webhookUrl = process.env.DISCORD_DEPLOY_WEBHOOK_URL || readState("webhooks.json").deploy?.url;
      if (!webhookUrl) console.log("Discord deploy notification skipped: no local webhook or DISCORD_DEPLOY_WEBHOOK_URL.");
      await notifyDeployment({ app, exitCode, revision, webhookUrl });
    },
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => {
    console.error("Could not run the deployment command; inspect the local application setup.");
    process.exitCode = 1;
  });
}

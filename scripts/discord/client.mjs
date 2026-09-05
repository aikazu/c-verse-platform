import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const guildId = "1543174682742628356";
export const stateDirectory = join(process.env.LOCALAPPDATA ?? join(homedir(), ".local", "state"), "CVerse", "discord", guildId);

export function readState(name, fallback = {}) {
  const path = join(stateDirectory, name);
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : fallback;
}

export function writeState(name, data) {
  mkdirSync(stateDirectory, { recursive: true, mode: 0o700 });
  writeFileSync(join(stateDirectory, name), `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
}

function loadToken() {
  if (process.env.DISCORD_BOT_TOKEN) return process.env.DISCORD_BOT_TOKEN;
  const path = join(homedir(), ".claude", "channels", "discord", ".env");
  const line = readFileSync(path, "utf8")
    .split(/\r?\n/)
    .find((value) => value.startsWith("DISCORD_BOT_TOKEN="));
  const token = line
    ?.slice("DISCORD_BOT_TOKEN=".length)
    .trim()
    .replace(/^(['"])(.*)\1$/, "$2");
  if (!token) throw new Error("DISCORD_BOT_TOKEN is unavailable");
  return token;
}

export function discordClient() {
  const token = loadToken();
  return async function request(method, path, body) {
    for (let attempt = 0; attempt < 4; attempt++) {
      const response = await fetch(`https://discord.com/api/v10${path}`, {
        method,
        headers: {
          Authorization: `Bot ${token}`,
          "Content-Type": "application/json",
          "X-Audit-Log-Reason": "C.Verse community redesign and permission repair",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(20000),
      });
      if (response.status === 429 && attempt < 3) {
        const data = await response.json();
        const wait = Math.ceil(Number(data.retry_after) * 1000) + 100;
        if (!Number.isFinite(wait) || wait > 30000) throw new Error("Discord rate limit exceeds bounded retry window");
        await new Promise((resolve) => setTimeout(resolve, wait));
        continue;
      }
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        // Never include response bodies, credentials, or webhook URLs in errors.
        const error = new Error(
          `Discord ${method} ${path.replace(/(\/webhooks\/\d+\/)[^/?]+/, "$1[redacted]")} failed: HTTP ${response.status}, code ${data.code ?? "unknown"}`,
        );
        error.status = response.status;
        throw error;
      }
      return response.status === 204 ? null : response.json();
    }
    throw new Error("Discord retry budget exhausted");
  };
}

export async function snapshot(api) {
  const root = `/guilds/${guildId}`;
  const [guild, roles, channels, automod, onboarding, webhooks, bot] = await Promise.all([
    api("GET", root),
    api("GET", `${root}/roles`),
    api("GET", `${root}/channels`),
    api("GET", `${root}/auto-moderation/rules`),
    api("GET", `${root}/onboarding`),
    api("GET", `${root}/webhooks`),
    api("GET", "/users/@me"),
  ]);
  return {
    guild,
    roles,
    channels,
    automod,
    onboarding,
    bot: { id: bot.id, username: bot.username },
    webhooks: webhooks.map(({ id, name, channel_id, application_id }) => ({ id, name, channel_id, application_id })),
  };
}

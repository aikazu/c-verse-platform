#!/usr/bin/env node
// Bootstrap the C.Verse community Discord server: roles, categories, channels,
// permission overwrites, guild settings, welcome content, and an invite link.
//
// Idempotent — existing roles/channels (matched by name) are reused, only what
// is missing gets created. Nothing is ever deleted.
//
// Credentials: reads DISCORD_BOT_TOKEN from the environment, falling back to
// ~/.claude/channels/discord/.env. Never hardcode tokens in this file.
//
// Usage: node scripts/discord-server-setup.mjs

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const API_BASE = "https://discord.com/api/v10";
const GUILD_ID = process.env.DISCORD_GUILD_ID ?? "1543174682742628356";
const GOLD = 0xffc94d;

const manualSteps = [];

// ---------------------------------------------------------------------------
// Permission bitfields (Discord) — computed with BigInt, sent as strings.
// ---------------------------------------------------------------------------

const FLAGS = {
  CREATE_INSTANT_INVITE: 1n << 0n,
  ADMINISTRATOR: 1n << 3n,
  KICK_MEMBERS: 1n << 1n,
  BAN_MEMBERS: 1n << 2n,
  MANAGE_CHANNELS: 1n << 4n,
  MANAGE_GUILD: 1n << 5n,
  ADD_REACTIONS: 1n << 6n,
  VIEW_AUDIT_LOG: 1n << 7n,
  PRIORITY_SPEAKER: 1n << 8n,
  STREAM: 1n << 9n,
  VIEW_CHANNEL: 1n << 10n,
  SEND_MESSAGES: 1n << 11n,
  MANAGE_MESSAGES: 1n << 13n,
  EMBED_LINKS: 1n << 14n,
  ATTACH_FILES: 1n << 15n,
  READ_MESSAGE_HISTORY: 1n << 16n,
  USE_EXTERNAL_EMOJIS: 1n << 18n,
  VIEW_GUILD_INSIGHTS: 1n << 19n,
  CONNECT: 1n << 20n,
  SPEAK: 1n << 21n,
  MUTE_MEMBERS: 1n << 22n,
  DEAFEN_MEMBERS: 1n << 23n,
  MOVE_MEMBERS: 1n << 24n,
  CHANGE_NICKNAME: 1n << 26n,
  MANAGE_NICKNAMES: 1n << 27n,
  MANAGE_ROLES: 1n << 28n,
  MANAGE_WEBHOOKS: 1n << 29n,
  USE_APPLICATION_COMMANDS: 1n << 31n,
  REQUEST_TO_SPEAK: 1n << 32n,
  MANAGE_THREADS: 1n << 34n,
  CREATE_PUBLIC_THREADS: 1n << 35n,
  USE_EXTERNAL_STICKERS: 1n << 37n,
  SEND_MESSAGES_IN_THREADS: 1n << 38n,
  MODERATE_MEMBERS: 1n << 40n,
  USE_SOUNDBOARD: 1n << 42n,
};

const perms = (names) => names.reduce((acc, name) => acc | FLAGS[name], 0n).toString();

const BASE = [
  "CREATE_INSTANT_INVITE",
  "ADD_REACTIONS",
  "STREAM",
  "VIEW_CHANNEL",
  "SEND_MESSAGES",
  "EMBED_LINKS",
  "ATTACH_FILES",
  "READ_MESSAGE_HISTORY",
  "USE_EXTERNAL_EMOJIS",
  "CONNECT",
  "SPEAK",
  "CHANGE_NICKNAME",
  "USE_APPLICATION_COMMANDS",
  "REQUEST_TO_SPEAK",
  "CREATE_PUBLIC_THREADS",
  "USE_EXTERNAL_STICKERS",
  "SEND_MESSAGES_IN_THREADS",
  "USE_SOUNDBOARD",
];

const MOD_EXTRA = [
  "KICK_MEMBERS",
  "BAN_MEMBERS",
  "MANAGE_CHANNELS",
  "VIEW_AUDIT_LOG",
  "MANAGE_MESSAGES",
  "MUTE_MEMBERS",
  "DEAFEN_MEMBERS",
  "MOVE_MEMBERS",
  "MANAGE_NICKNAMES",
  "MANAGE_THREADS",
  "MODERATE_MEMBERS",
  "VIEW_GUILD_INSIGHTS",
  "PRIORITY_SPEAKER",
];

const BOT_EXTRA = [
  "MANAGE_CHANNELS",
  "MANAGE_ROLES",
  "MANAGE_WEBHOOKS",
  "MANAGE_MESSAGES",
  "MANAGE_THREADS",
  "VIEW_AUDIT_LOG",
  "MODERATE_MEMBERS",
];

// Lowest first — each POST lands at position 1 and pushes earlier roles down,
// so creation order yields the intended hierarchy top-down.
const ROLE_PLAN = [
  { name: "Muted", color: 0x4a4a58, hoist: false, permissions: perms([]) },
  { name: "Member", color: 0x58c0f8, hoist: false, permissions: perms(BASE) },
  { name: "Bots", color: 0x7289da, hoist: true, permissions: perms([...BASE, ...BOT_EXTRA]) },
  { name: "Creator", color: 0xb98cff, hoist: true, permissions: perms(BASE) },
  { name: "Moderator", color: 0x4ecdc4, hoist: true, permissions: perms([...BASE, ...MOD_EXTRA]) },
  { name: "Admin", color: 0xff6b6b, hoist: true, permissions: FLAGS.ADMINISTRATOR.toString() },
  { name: "Owner", color: GOLD, hoist: true, permissions: FLAGS.ADMINISTRATOR.toString() },
];

// ---------------------------------------------------------------------------
// Server layout. visibility: public | staff | creator. readonly: staff-only send.
// ---------------------------------------------------------------------------

const CHANNEL_PLAN = [
  {
    category: "🚪 GATE · CH:00",
    visibility: "public",
    channels: [
      { name: "welcome", type: "text", topic: "Mulai dari sini — baca aturan dan selesaikan verifikasi.", readonly: true },
      { name: "announcements", type: "text", topic: "Pengumuman resmi C.Verse.", readonly: true },
    ],
  },
  {
    category: "📣 LOBBY · CH:01",
    visibility: "public",
    channels: [
      { name: "general", type: "text", topic: "Ngobrol santai seputar C.Verse.", reusePattern: /^(general|umum)$/i },
      { name: "introductions", type: "text", topic: "Perkenalkan dirimu — siapa kamu dan kartu favoritmu." },
    ],
  },
  {
    category: "🎴 C.CARD · CH:02",
    visibility: "public",
    channels: [
      { name: "drop-alerts", type: "text", topic: "Alert drop C.Card — rilis 12:00 WIB.", readonly: true },
      { name: "card-talk", type: "text", topic: "Diskusi C.Card — koleksi, tips, tukar pikiran." },
      { name: "showcase", type: "forum", topic: "Pamer koleksimu — satu post per kartu atau set." },
    ],
  },
  {
    category: "🛠 SUPPORT · CH:03",
    visibility: "public",
    channels: [
      { name: "help-desk", type: "text", topic: "Butuh bantuan? Buka tiket di sini — akun, wallet, payout." },
      { name: "bug-reports", type: "forum", topic: "Lapor bug — sertakan langkah dan screenshot." },
      { name: "suggestions", type: "forum", topic: "Usulan fitur untuk C.Verse." },
    ],
  },
  {
    category: "✦ CREATOR · CH:04",
    visibility: "creator",
    channels: [
      { name: "creator-lounge", type: "text", topic: "Ruang khusus kreator C.Verse." },
      { name: "creator-spotlight", type: "text", topic: "Sorotan karya dan drop dari kreator.", readonly: true, creatorCanPost: true },
    ],
  },
  {
    category: "🎙 VOICE",
    visibility: "public",
    channels: [{ name: "Lounge VC", type: "voice" }],
  },
  {
    category: "🔒 STAFF",
    visibility: "staff",
    channels: [
      { name: "staff-chat", type: "text", topic: "Koordinasi staf." },
      { name: "mod-log", type: "text", topic: "Log moderasi." },
      { name: "ticket-log", type: "text", topic: "Transkrip tiket support." },
    ],
  },
];

const READONLY_DENY = perms(["SEND_MESSAGES", "CREATE_PUBLIC_THREADS", "SEND_MESSAGES_IN_THREADS"]);
const MUTED_DENY = perms(["SEND_MESSAGES", "ADD_REACTIONS", "SPEAK", "CREATE_PUBLIC_THREADS", "SEND_MESSAGES_IN_THREADS"]);

// ---------------------------------------------------------------------------
// HTTP helper with 429 retry. Token never gets logged.
// ---------------------------------------------------------------------------

function loadToken() {
  if (process.env.DISCORD_BOT_TOKEN) return process.env.DISCORD_BOT_TOKEN;
  const envFile = join(homedir(), ".claude", "channels", "discord", ".env");
  if (!existsSync(envFile)) {
    throw new Error(`DISCORD_BOT_TOKEN not set and ${envFile} not found`);
  }
  const line = readFileSync(envFile, "utf8")
    .split("\n")
    .find((l) => l.startsWith("DISCORD_BOT_TOKEN="));
  if (!line) throw new Error(`DISCORD_BOT_TOKEN missing in ${envFile}`);
  return line.slice("DISCORD_BOT_TOKEN=".length).trim();
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const log = (msg) => console.log(msg);

let TOKEN;
async function api(method, path, body) {
  const res = await fetch(API_BASE + path, {
    method,
    headers: {
      Authorization: `Bot ${TOKEN}`,
      "Content-Type": "application/json",
      "X-Audit-Reason": "C.Verse server bootstrap",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 429) {
    const data = await res.json().catch(() => ({}));
    const waitMs = Math.ceil((data.retry_after ?? 1) * 1000) + 250;
    log(`⏳ rate limited, waiting ${waitMs}ms`);
    await sleep(waitMs);
    return api(method, path, body);
  }
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`${method} ${path} → ${res.status}: ${detail}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

async function tryStep(label, fn) {
  try {
    return await fn();
  } catch (error) {
    log(`⚠️  ${label}: ${error.message}`);
    manualSteps.push(label);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Ensure helpers (idempotent by name lookup).
// ---------------------------------------------------------------------------

async function ensureRoles(existingByName) {
  const ids = {};
  for (const role of ROLE_PLAN) {
    const found = existingByName.get(role.name.toLowerCase());
    if (found) {
      ids[role.name] = found.id;
      log(`✓ role ada: ${role.name}`);
      continue;
    }
    const created = await api("POST", `/guilds/${GUILD_ID}/roles`, {
      name: role.name,
      color: role.color,
      hoist: role.hoist,
      mentionable: true,
      permissions: role.permissions,
    });
    ids[role.name] = created.id;
    log(`✓ role dibuat: ${role.name}`);
    await sleep(250);
  }
  return ids;
}

function overwrite(id, { allow = 0n, deny = 0n } = {}) {
  return { id, type: 1, allow: allow.toString(), deny: deny.toString() };
}

async function ensureChannels(existingChannels, roleIds) {
  const byName = new Map(existingChannels.map((c) => [c.name.toLowerCase(), c]));
  const created = {};
  const everyone = GUILD_ID;

  for (const group of CHANNEL_PLAN) {
    let category = byName.get(group.category.toLowerCase());
    if (!category) {
      category = await api("POST", `/guilds/${GUILD_ID}/channels`, { name: group.category, type: 4 });
      log(`✓ kategori dibuat: ${group.category}`);
      await sleep(250);
    }
    created[group.category] = category.id;

    const categoryOverwrites = [];
    if (group.visibility === "staff") {
      categoryOverwrites.push(
        overwrite(everyone, { deny: FLAGS.VIEW_CHANNEL | FLAGS.CONNECT }),
        overwrite(roleIds.Moderator, { allow: FLAGS.VIEW_CHANNEL | FLAGS.SEND_MESSAGES | FLAGS.CONNECT }),
      );
    }
    if (group.visibility === "public") {
      categoryOverwrites.push(overwrite(roleIds.Muted, { deny: BigInt(MUTED_DENY) }));
    }
    if (categoryOverwrites.length > 0) {
      await api("PATCH", `/channels/${category.id}`, { permission_overwrites: categoryOverwrites });
    }

    for (const channel of group.channels) {
      const reuseKey = channel.reusePattern ? [...byName.entries()].find(([name]) => channel.reusePattern.test(name))?.[1] : undefined;
      const existing = byName.get(channel.name.toLowerCase()) ?? reuseKey;
      const overwrites = [];
      if (channel.readonly) {
        overwrites.push(overwrite(everyone, { deny: BigInt(READONLY_DENY) }));
        overwrites.push(overwrite(roleIds.Moderator, { allow: FLAGS.SEND_MESSAGES }));
        if (channel.creatorCanPost) overwrites.push(overwrite(roleIds.Creator, { allow: FLAGS.SEND_MESSAGES }));
      }
      if (channel.name === "creator-lounge") {
        overwrites.push(
          overwrite(everyone, { deny: FLAGS.VIEW_CHANNEL | FLAGS.SEND_MESSAGES }),
          overwrite(roleIds.Creator, { allow: FLAGS.VIEW_CHANNEL | FLAGS.SEND_MESSAGES }),
          overwrite(roleIds.Moderator, { allow: FLAGS.VIEW_CHANNEL | FLAGS.SEND_MESSAGES }),
        );
      }
      if (existing) {
        created[channel.name] = existing.id;
        log(`✓ channel ada: #${channel.name}`);
        if (overwrites.length > 0) {
          await api("PATCH", `/channels/${existing.id}`, { permission_overwrites: overwrites });
        }
        continue;
      }
      const payload = {
        name: channel.name,
        type: channel.type === "voice" ? 2 : channel.type === "forum" ? 15 : 0,
        parent_id: category.id,
      };
      if (channel.topic) payload.topic = channel.topic;
      if (overwrites.length > 0) payload.permission_overwrites = overwrites;
      const made = await api("POST", `/guilds/${GUILD_ID}/channels`, payload);
      byName.set(channel.name.toLowerCase(), made);
      created[channel.name] = made.id;
      log(`✓ channel dibuat: #${channel.name}`);
      await sleep(250);
    }
  }
  return created;
}

// ---------------------------------------------------------------------------
// Content.
// ---------------------------------------------------------------------------

const RULES = [
  "**Sopan dan menghargai semua orang.** Tidak ada hate speech, harassment, atau konten NSFW.",
  "**Semua jual-beli C.Card & C-Coin hanya lewat platform.** Trading di luar platform berisiko scam dan tidak ada perlindungan.",
  "**Jangan bagikan kredensial, OTP, atau bukti pembayaran** di channel maupun DM.",
  "**Admin dan moderator tidak pernah DM duluan** meminta data sensitif. Waspadai impersonator.",
  "**Dilarang spam dan promosi** tanpa izin staf.",
  "**Pelanggaran berujung warn → kick → ban** sesuai penilaian staf.",
];

const welcomeEmbed = {
  title: "◈ SELAMAT DATANG DI C.VERSE",
  description:
    "Markas komunitas C.Verse — rumah para kolektor C.Card.\n\nMulai dari sini: baca aturan, selesaikan verifikasi, lalu jelajahi channel di bawah. 🚀",
  color: GOLD,
  fields: [
    { name: "📣 LOBBY", value: "#general & #introductions — ngobrol santai dan perkenalkan dirimu." },
    { name: "🎴 C.CARD", value: "#drop-alerts, #card-talk, #showcase — pantau drop rilis 12:00 WIB, diskusi, dan pamerkan koleksi." },
    { name: "🛠 SUPPORT", value: "#help-desk — masalah akun, wallet, atau payout? Buka tiket di sini." },
    { name: "✦ CREATOR", value: "#creator-spotlight — karya dan drop dari kreator C.Verse." },
  ],
  footer: { text: "C.Verse — Bukan sekadar merch." },
};

const rulesEmbed = {
  title: "📜 ATURAN SERVER",
  description: RULES.map((rule, index) => `**${index + 1}.** ${rule}`).join("\n\n"),
  color: GOLD,
  footer: { text: "Langgar aturan = keluar dari orbit." },
};

async function postWelcomeContent(ids) {
  if (!ids.welcome || !ids.announcements) return;
  const existingMessages = await api("GET", `/channels/${ids.welcome}/messages?limit=10`);
  const hasWelcome = existingMessages.some((m) => m.author?.bot && m.embeds?.some((e) => e.title === welcomeEmbed.title));
  if (!hasWelcome) {
    const welcomeMessage = await api("POST", `/channels/${ids.welcome}/messages`, { embeds: [welcomeEmbed] });
    await api("PUT", `/channels/${ids.welcome}/pins/${welcomeMessage.id}`);
    const rulesMessage = await api("POST", `/channels/${ids.welcome}/messages`, { embeds: [rulesEmbed] });
    await api("PUT", `/channels/${ids.welcome}/pins/${rulesMessage.id}`);
    log("✓ welcome + rules terpasang dan di-pin");
  } else {
    log("✓ welcome content sudah ada");
  }
  const announcements = await api("GET", `/channels/${ids.announcements}/messages?limit=10`);
  if (announcements.length === 0) {
    await api("POST", `/channels/${ids.announcements}/messages`, {
      content:
        "🚀 **Selamat datang di server resmi C.Verse!**\n\nSemua info drop C.Card dan pengumuman penting akan muncul di sini. Mulai perjalananmu dari #welcome ya. ✦",
    });
    log("✓ announcement pertama terkirim");
  }
}

// ---------------------------------------------------------------------------
// Main.
// ---------------------------------------------------------------------------

async function main() {
  TOKEN = loadToken();
  log(`token: loaded (${TOKEN.slice(0, 4)}****)`);

  const app = await api("GET", "/applications/@me");
  const botInviteUrl = `https://discord.com/oauth2/authorize?client_id=${app.id}&scope=bot+applications.commands&permissions=8`;

  let guild;
  try {
    guild = await api("GET", `/guilds/${GUILD_ID}?with_counts=true`);
  } catch (error) {
    log(`❌ Bot tidak bisa melihat guild ${GUILD_ID}: ${error.message}`);
    log(`   Pastikan bot sudah di-invite ke server. Invite URL (Administrator, untuk setup):`);
    log(`   ${botInviteUrl}`);
    process.exitCode = 1;
    return;
  }
  log(`✓ terhubung ke guild: ${guild.name} (member: ${guild.approximate_member_count ?? "?"})`);

  let hasCommunity = guild.features.includes("COMMUNITY");
  if (!hasCommunity) {
    await tryStep("Enable Community via API (fallback: manual di Server Settings)", async () => {
      await api("PATCH", `/guilds/${GUILD_ID}`, { features: [...guild.features, "COMMUNITY"] });
      hasCommunity = true;
    });
    if (hasCommunity) log("✓ fitur Community diaktifkan via API");
  } else {
    log("✓ fitur Community sudah aktif");
  }

  const [existingChannels, existingRoles] = await Promise.all([
    api("GET", `/guilds/${GUILD_ID}/channels`),
    api("GET", `/guilds/${GUILD_ID}/roles`),
  ]);

  const rolesByName = new Map(existingRoles.map((r) => [r.name.toLowerCase(), r]));
  const roleIds = await ensureRoles(rolesByName);

  // @everyone: view + chat base everywhere public (screening = consent gate).
  await tryStep("Set permission @everyone", () => api("PATCH", `/guilds/${GUILD_ID}/roles/${GUILD_ID}`, { permissions: perms(BASE) }));
  const ids = await ensureChannels(existingChannels, roleIds);

  // Guild settings are patched in independent slices so one invalid field does
  // not reject the rest. The system channel is optional (join notices only).
  await tryStep("Update guild settings", () =>
    api("PATCH", `/guilds/${GUILD_ID}`, {
      verification_level: 2,
      explicit_content_filter: 2,
      preferred_locale: "id",
      description: "Komunitas resmi C.Verse — kolektor C.Card, drop, dan marketplace.",
    }),
  );
  if (hasCommunity) {
    await tryStep("Set rules & public-updates channel", () =>
      api("PATCH", `/guilds/${GUILD_ID}`, {
        rules_channel_id: ids.welcome,
        public_updates_channel_id: ids.announcements,
      }),
    );
  }

  if (hasCommunity) {
    await tryStep("Pasang welcome screen", () =>
      api("PATCH", `/guilds/${GUILD_ID}/welcome-screen`, {
        enabled: true,
        welcome_channels: [
          { channel_id: ids.welcome, description: "Mulai dari sini — aturan & verifikasi", emoji_name: "🚪" },
          { channel_id: ids.announcements, description: "Pengumuman resmi & info drop", emoji_name: "📣" },
          { channel_id: ids["card-talk"], description: "Diskusi seputar C.Card", emoji_name: "🎴" },
          { channel_id: ids.showcase, description: "Pamerkan koleksimu", emoji_name: "✨" },
          { channel_id: ids["help-desk"], description: "Butuh bantuan? Buka tiket", emoji_name: "🛠" },
        ],
      }),
    );

    // Membership screening cannot be created over the REST API (GET 404 /
    // PUT 405 until the form is initialized in the client).
    log("ℹ️  Membership screening diaktifkan manual: Server Settings → Safety Setup → Membership Screening");
    manualSteps.push("Aktifkan Membership Screening: Server Settings → Safety Setup → Membership Screening");
  } else {
    manualSteps.push("Enable Community: Server Settings → Enable Community → rules channel #welcome, updates channel #announcements");
  }

  await postWelcomeContent(ids);

  let inviteLink = null;
  await tryStep("Buat invite permanen", async () => {
    const invite = await api("POST", `/channels/${ids.welcome}/invites`, { max_age: 0, max_uses: 0, unique: true });
    inviteLink = `https://discord.gg/${invite.code}`;
  });

  // Final tree.
  const finalChannels = await api("GET", `/guilds/${GUILD_ID}/channels`);
  log("\n════════ STRUKTUR SERVER ════════");
  const categories = finalChannels.filter((c) => c.type === 4);
  for (const category of categories) {
    log(`📁 ${category.name}`);
    for (const channel of finalChannels.filter((c) => c.parent_id === category.id)) {
      const icon = channel.type === 2 ? "🔊" : channel.type === 15 ? "📋" : "#";
      log(`   ${icon} ${channel.name}`);
    }
  }

  log("\n════════ HASIL ════════");
  if (inviteLink) log(`🔗 Invite permanen: ${inviteLink}`);
  if (manualSteps.length > 0) {
    log("\n⚠️  Butuh langkah manual:");
    for (const step of manualSteps) log(`   - ${step}`);
  } else {
    log("✨ Semua langkah API selesai tanpa kendala.");
  }
}

main().catch((error) => {
  console.error("❌ fatal:", error.message);
  process.exitCode = 1;
});

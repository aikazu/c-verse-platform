import { discordClient, guildId, readState, snapshot, stateDirectory, writeState } from "./client.mjs";
import { categories, channels, onboardingPayload, webhookPlan } from "./layout.mjs";
import {
  adminPermissions,
  maintenancePermissions,
  mask,
  memberPermissions,
  moderatorPermissions,
  mutedDeny,
  P,
  readOnlyDeny,
  roleOverwrite,
} from "./permissions.mjs";

const rolePolicy = {
  "@everyone": memberPermissions,
  Member: "0",
  Creator: "0",
  Bots: "0",
  Muted: "0",
  "Server Booster": "0",
  Moderator: moderatorPermissions,
  Admin: adminPermissions,
  Owner: "0",
  "Info Drop": "0",
  "Cerita Kreator": "0",
  "C.Verse Maintenance": maintenancePermissions,
};

export function channelOverwrites(plan, roles) {
  const privateChannel = ["staff", "stafflog", "creator", "adminlog"].includes(plan.access);
  const readonly = ["readonly", "spotlight", "stafflog", "adminlog"].includes(plan.access);
  const deny = (privateChannel ? P.VIEW_CHANNEL | P.CONNECT : 0n) | (readonly ? BigInt(readOnlyDeny) : 0n);
  const result = [roleOverwrite(guildId, "0", deny), roleOverwrite(roles.Muted, "0", mutedDeny)];
  const staff = mask(["VIEW_CHANNEL", "READ_MESSAGE_HISTORY", "SEND_MESSAGES", "SEND_MESSAGES_IN_THREADS", "CONNECT"]);
  result.push(roleOverwrite(roles.Admin, staff), roleOverwrite(roles.Owner, staff));
  if (plan.access !== "adminlog") result.push(roleOverwrite(roles.Moderator, staff));
  if (plan.access === "creator") result.push(roleOverwrite(roles.Creator, mask(["VIEW_CHANNEL", "READ_MESSAGE_HISTORY"])));
  // Ticket Tool can only see its public panel and private ticket-log among managed channels.
  if (roles["Ticket Tool"])
    result.push(roleOverwrite(roles["Ticket Tool"], plan.ticket ? staff : "0", plan.ticket ? "0" : mask(["VIEW_CHANNEL"])));
  if (roles["C-Verse"])
    result.push(
      roleOverwrite(roles["C-Verse"], mask(["VIEW_CHANNEL", "READ_MESSAGE_HISTORY", "SEND_MESSAGES", "SEND_MESSAGES_IN_THREADS"])),
    );
  return result;
}

export async function configureAutomod(api, existing, alertChannel) {
  const block = {
    type: 1,
    metadata: { custom_message: "Pesan diblokir untuk menjaga komunitas. Jika keliru, hubungi staf melalui bantuan." },
  };
  const alert = { type: 2, metadata: { channel_id: alertChannel } };
  const rules = [
    {
      name: "C.Verse · Mention & raid protection",
      trigger_type: 5,
      trigger_metadata: { mention_total_limit: 5, mention_raid_protection_enabled: true },
      actions: [block, alert, { type: 3, metadata: { duration_seconds: 600 } }],
    },
    { name: "C.Verse · Spam protection", trigger_type: 3, trigger_metadata: {}, actions: [block, alert] },
    { name: "C.Verse · Harmful language", trigger_type: 4, trigger_metadata: { presets: [2, 3], allow_list: [] }, actions: [block, alert] },
    {
      name: "C.Verse · Scam & unsolicited invites",
      trigger_type: 1,
      trigger_metadata: {
        keyword_filter: [
          "*discord.gg/*",
          "*discord.com/invite/*",
          "*discordapp.com/invite/*",
          "*free nitro*",
          "*nitro gratis*",
          "*steamcommunitty*",
          "*discorcl*",
        ],
      },
      actions: [block, alert],
    },
  ];
  for (const rule of rules) {
    const found =
      existing.find((item) => item.name === rule.name) ??
      existing.find((item) => rule.trigger_type !== 1 && item.trigger_type === rule.trigger_type);
    const payload = { ...rule, enabled: true, event_type: 1, exempt_roles: [], exempt_channels: [] };
    if (found) {
      const { trigger_type: _trigger, ...patch } = payload;
      try {
        await api("PATCH", `/guilds/${guildId}/auto-moderation/rules/${found.id}`, patch);
      } catch (error) {
        // Discord may list a synthetic default rule that is not a mutable resource.
        if (error.status !== 404) throw error;
        await api("POST", `/guilds/${guildId}/auto-moderation/rules`, payload);
      }
    } else await api("POST", `/guilds/${guildId}/auto-moderation/rules`, payload);
    console.log(`Configured AutoMod: ${rule.name}`);
  }
}

export async function reconcile() {
  const api = discordClient();
  const before = await snapshot(api);
  const apply = process.argv.includes("--apply");
  if (!apply) {
    console.log(
      JSON.stringify(
        {
          guild: { id: before.guild.id, name: before.guild.name },
          mode: "audit-only",
          categories,
          channels,
          roles: rolePolicy,
          webhookPlan,
        },
        null,
        2,
      ),
    );
    return;
  }
  if (before.guild.id !== guildId) throw new Error("Unexpected guild");
  for (const item of [...categories, ...channels.filter((channel) => channel.id)]) {
    if (!before.channels.some((channel) => channel.id === item.id))
      throw new Error(`Expected channel missing: ${item.id}; inspect drift before applying`);
  }
  writeState(`before-${new Date().toISOString().replace(/[:.]/g, "-")}.json`, before);
  console.log(`Saved pre-change snapshot outside the repository: ${stateDirectory}`);
  const roles = Object.fromEntries(before.roles.map((role) => [role.name, role.id]));
  const pending = [];
  for (const [name, permissions] of Object.entries(rolePolicy)) {
    if (!roles[name]) {
      const role = await api("POST", `/guilds/${guildId}/roles`, {
        name,
        permissions,
        mentionable: false,
        color: name === "Info Drop" ? 0xffc94d : 0xb98cff,
      });
      roles[name] = role.id;
    } else {
      const current = before.roles.find((role) => role.id === roles[name]);
      if (current.permissions === permissions && !current.mentionable) continue;
      try {
        await api("PATCH", `/guilds/${guildId}/roles/${roles[name]}`, { permissions, mentionable: false });
      } catch (error) {
        pending.push(`Role ${name}: ${error.message}`);
      }
    }
  }
  const botMember = await api("GET", `/guilds/${guildId}/members/${before.bot.id}`);
  if (!botMember.roles.includes(roles["C.Verse Maintenance"])) {
    await api("PUT", `/guilds/${guildId}/members/${before.bot.id}/roles/${roles["C.Verse Maintenance"]}`);
  }
  // Close private categories and each child explicitly; unsynced children must not remain public.
  for (const [position, category] of categories.entries()) {
    await api("PATCH", `/channels/${category.id}`, {
      name: category.name,
      position,
      permission_overwrites: channelOverwrites(category, roles),
    });
  }
  const ids = {};
  const saved = readState("resources.json");
  for (const [position, channel] of channels.entries()) {
    const found = before.channels.find(
      (item) => item.id === (channel.id ?? saved[channel.name]) || (!channel.id && item.name === channel.name),
    );
    const payload = {
      name: channel.name,
      parent_id: categories[channel.category].id,
      position,
      permission_overwrites: channelOverwrites(channel, roles),
    };
    if (!channel.voice) Object.assign(payload, { topic: channel.topic, rate_limit_per_user: channel.slowmode ?? 0 });
    if (channel.tags)
      Object.assign(payload, {
        available_tags: channel.tags.map((name) => ({
          ...(found?.available_tags?.find((tag) => tag.name === name)?.id
            ? { id: found.available_tags.find((tag) => tag.name === name).id }
            : {}),
          name,
          moderated: ["Perlu info", "Selesai", "Dipertimbangkan", "Diterapkan"].includes(name),
        })),
        default_forum_layout: channel.gallery ? 2 : 1,
        default_sort_order: 0,
        default_reaction_emoji: { emoji_name: channel.gallery ? "✨" : "👍", emoji_id: null },
        default_auto_archive_duration: 10080,
        default_thread_rate_limit_per_user: 5,
      });
    const result = found
      ? await api("PATCH", `/channels/${found.id}`, payload)
      : await api("POST", `/guilds/${guildId}/channels`, { ...payload, type: 0 });
    // Discord validates REQUIRE_TAG against persisted tags, before applying new tags.
    if (channel.tags && !(result.flags & 16)) await api("PATCH", `/channels/${result.id}`, { flags: result.flags | 16 });
    ids[channel.name] = result.id;
    writeState("resources.json", { ...saved, ...ids });
    console.log(`Configured #${channel.name}`);
  }
  await api("PATCH", `/guilds/${guildId}`, {
    description:
      "Rumah kolektor dan kreator C.Card. Temukan cerita di balik karya, ikuti drop, dan bagikan koleksimu. Situs resmi: c-verse.co",
    verification_level: 3,
    explicit_content_filter: 2,
    default_message_notifications: 1,
    rules_channel_id: ids["aturan-komunitas"],
    public_updates_channel_id: ids["discord-updates"],
    system_channel_id: ids["halo-kolektor"],
    system_channel_flags: 13,
  });
  await configureAutomod(api, before.automod, ids["mod-log"]);
  await api("PUT", `/guilds/${guildId}/onboarding`, onboardingPayload(ids, roles, before.onboarding));
  const webhookState = readState("webhooks.json");
  const hooks = await api("GET", `/guilds/${guildId}/webhooks`);
  for (const item of webhookPlan) {
    let hook = hooks.find(
      (value) => value.id === webhookState[item.key]?.id || (value.name === item.name && value.channel_id === ids[item.channel]),
    );
    if (!hook) hook = await api("POST", `/channels/${ids[item.channel]}/webhooks`, { name: item.name });
    if (hook.channel_id !== ids[item.channel]) throw new Error(`Webhook destination drift: ${item.key}`);
    if (!hook.token) throw new Error(`Webhook credential unavailable: ${item.key}`);
    webhookState[item.key] = { id: hook.id, channel_id: hook.channel_id, url: `https://discord.com/api/webhooks/${hook.id}/${hook.token}` };
    writeState("webhooks.json", webhookState);
    console.log(`Configured webhook: ${item.key} -> #${item.channel} (credential kept outside repository)`);
  }
  writeState("after.json", await snapshot(api));
  writeState("pending.json", pending);
  if (pending.length) console.log(JSON.stringify({ pending }, null, 2));
  console.log("Configuration applied. Message publication and provider wiring are separate explicit operations.");
}

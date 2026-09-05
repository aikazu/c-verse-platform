import assert from "node:assert/strict";
import { discordClient, guildId, readState, snapshot, writeState } from "./client.mjs";
import { categories, channels } from "./layout.mjs";
import { effectivePermissions, P } from "./permissions.mjs";

export async function verifyServer() {
  const current = await snapshot(discordClient());
  const everyone = current.roles.find((role) => role.id === guildId);
  const role = (name) => current.roles.find((value) => value.name === name);
  const permission = (channel, names) =>
    effectivePermissions({ everyone, roles: names.map(role), overwrites: channel.permission_overwrites, memberId: "unassigned-member" });
  const ids = readState("resources.json");
  let checks = 0;
  for (const plan of channels) {
    const channel = current.channels.find((value) => value.id === (plan.id ?? ids[plan.name]));
    assert(channel, `Missing ${plan.name}`);
    for (const names of [[], ["Member"], ["Creator"], ["Server Booster"], ["Member", "Info Drop", "Cerita Kreator"]]) {
      const actual = permission(channel, names);
      const privateChannel =
        ["staff", "stafflog", "adminlog"].includes(plan.access) || (plan.access === "creator" && !names.includes("Creator"));
      assert.equal(Boolean(actual & P.VIEW_CHANNEL), !privateChannel, `${plan.name}: view for ${names.join(",") || "everyone"}`);
      if (["readonly", "spotlight"].includes(plan.access)) {
        assert.equal(
          actual & (P.SEND_MESSAGES | P.CREATE_PUBLIC_THREADS | P.CREATE_PRIVATE_THREADS | P.SEND_MESSAGES_IN_THREADS),
          0n,
          `${plan.name}: read-only`,
        );
      }
      checks++;
    }
    if (plan.access === "adminlog")
      assert.equal(permission(channel, ["Moderator"]) & P.VIEW_CHANNEL, 0n, `${plan.name}: private repository data hidden from Moderator`);
    assert(permission(channel, ["Admin"]) & P.VIEW_CHANNEL, `${plan.name}: Admin can view`);
    if (["public", "creator"].includes(plan.access))
      assert.equal(permission(channel, ["Creator", "Muted"]) & P.SEND_MESSAGES, 0n, `${plan.name}: Creator cannot bypass Muted`);
    assert.equal(
      Boolean(permission(channel, ["Ticket Tool"]) & P.VIEW_CHANNEL),
      Boolean(plan.ticket),
      `${plan.name}: Ticket Tool isolation`,
    );
    if (plan.tags) {
      assert(channel.flags & 16, `${plan.name}: required tag`);
      assert(
        channel.available_tags.some((tag) => !tag.moderated),
        `${plan.name}: members can choose tags`,
      );
    }
  }
  for (const name of ["Member", "Creator", "Server Booster", "Bots", "Info Drop", "Cerita Kreator"])
    assert.equal(role(name).permissions, "0", `${name}: cosmetic role`);
  assert(!current.roles.some((value) => BigInt(value.permissions) & P.ADMINISTRATOR), "No role or bot should retain Administrator");
  for (const name of ["Creator", "Member", "Server Booster", "C-Verse", "Ticket Tool"]) {
    assert(role("Moderator").position > role(name).position, `Moderator must be above ${name}`);
  }
  assert(role("Owner").position > role("Admin").position && role("Admin").position > role("Moderator").position, "Staff role hierarchy");
  assert(current.onboarding.enabled, "Onboarding enabled");
  assert(current.guild.features.includes("MEMBER_VERIFICATION_GATE_ENABLED"), "Server rules acceptance enabled");
  const ticketCategory = current.channels.find((channel) => channel.id === categories.find((category) => category.ticket).id);
  assert(permission(ticketCategory, ["Ticket Tool"]) & P.VIEW_CHANNEL, "Ticket Tool can create tickets in the help category");
  const discoverable = new Set([
    ...current.onboarding.default_channel_ids,
    ...current.onboarding.prompts.flatMap((prompt) => prompt.options.flatMap((option) => option.channel_ids)),
  ]);
  for (const channel of current.channels.filter((value) => [0, 5, 15, 16].includes(value.type))) {
    if (permission(channel, []) & P.VIEW_CHANNEL)
      assert(discoverable.has(channel.id), `${channel.name}: public channel missing from onboarding`);
  }
  for (const prompt of current.onboarding.prompts)
    for (const option of prompt.options) {
      assert(
        option.role_ids.every((id) => [role("Info Drop").id, role("Cerita Kreator").id].includes(id)),
        "Only harmless opt-in roles",
      );
    }
  assert.equal(current.automod.filter((rule) => rule.name.startsWith("C.Verse") && rule.enabled).length, 4);
  assert(current.guild.icon, "Server icon installed");
  assert.equal(current.guild.mfa_level, 1, "Moderator 2FA preserved");
  assert.equal(current.guild.verification_level, 3);
  writeState("after.json", current);
  writeState("verification.json", {
    verified_at: new Date().toISOString(),
    access_scenarios: checks,
    channels: channels.length,
    automod_rules: 4,
    result: "passed",
  });
  console.log(
    `Live verification passed: ${checks} role/channel scenarios, ${channels.length} channels, onboarding, AutoMod, branding and guild security.`,
  );
}

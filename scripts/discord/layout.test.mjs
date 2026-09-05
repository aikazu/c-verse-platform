import { describe, expect, it } from "vitest";
import { guildId } from "./client.mjs";
import { messageNonce, messagePlan } from "./content.mjs";
import { categories, channels, onboardingPayload } from "./layout.mjs";
import { effectivePermissions, memberPermissions, P } from "./permissions.mjs";
import { channelOverwrites } from "./reconcile.mjs";

const roles = Object.fromEntries(
  ["Member", "Creator", "Muted", "Admin", "Owner", "Moderator", "Ticket Tool", "C-Verse"].map((name) => [name, name]),
);
function permissions(plan, names) {
  return effectivePermissions({
    everyone: { id: guildId, permissions: memberPermissions },
    roles: names.map((name) => ({ id: name, permissions: "0" })),
    overwrites: channelOverwrites(plan, roles),
  });
}

describe("configured Discord channel boundaries", () => {
  it("lets Ticket Tool use its ticket category without exposing other community channels to the bot", () => {
    expect(
      permissions(
        categories.find((category) => category.ticket),
        ["Ticket Tool"],
      ) & P.VIEW_CHANNEL,
    ).toBe(P.VIEW_CHANNEL);
    for (const channel of channels.filter((value) => value.category === 3))
      expect(Boolean(permissions(channel, ["Ticket Tool"]) & P.VIEW_CHANNEL)).toBe(Boolean(channel.ticket));
  });
  it("makes every public text or forum channel discoverable through onboarding", () => {
    const ids = Object.fromEntries(channels.map((channel) => [channel.name, channel.id ?? channel.name]));
    const payload = onboardingPayload(ids, { "Info Drop": "drop-role", "Cerita Kreator": "creator-interest-role" }, {});
    const available = new Set([
      ...payload.default_channel_ids,
      ...payload.prompts.flatMap((prompt) => prompt.options.flatMap((option) => option.channel_ids)),
    ]);
    for (const channel of channels.filter((value) => ["public", "readonly", "spotlight"].includes(value.access) && !value.voice))
      expect(available.has(ids[channel.name]), channel.name).toBe(true);
    const support = payload.prompts[0].options.find((option) => option.title === "Bantuan & Feedback");
    expect(support.role_ids).toEqual([]);
  });
  it("prevents the Creator role from overriding legacy Muted in studio or spotlight", () => {
    for (const access of ["creator", "spotlight"]) {
      const plan = channels.find((channel) => channel.access === access);
      expect(permissions(plan, ["Creator", "Muted"]) & P.SEND_MESSAGES).toBe(0n);
    }
    expect(
      permissions(
        channels.find((channel) => channel.access === "creator"),
        ["Creator"],
      ) & P.SEND_MESSAGES,
    ).toBe(P.SEND_MESSAGES);
  });
  it("keeps repository notifications hidden from moderators and the ticket bot", () => {
    for (const plan of channels.filter((channel) => channel.access === "adminlog")) {
      for (const name of ["Moderator", "Ticket Tool", "Creator", "Member"]) expect(permissions(plan, [name]) & P.VIEW_CHANNEL).toBe(0n);
      expect(permissions(plan, ["Admin"]) & P.VIEW_CHANNEL).toBe(P.VIEW_CHANNEL);
    }
  });
  it("uses valid deterministic publication nonces for every content entry", () => {
    const plan = messagePlan(Object.fromEntries(channels.map((channel) => [channel.name, channel.id ?? "new-channel"])));
    for (const item of plan) expect(messageNonce(item.key).length).toBeLessThanOrEqual(25);
  });
});

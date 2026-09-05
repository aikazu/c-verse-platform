import { describe, expect, it } from "vitest";
import { effectivePermissions, memberPermissions, mutedDeny, P, readOnlyDeny, roleOverwrite } from "./permissions.mjs";

const everyone = { id: "guild", permissions: "0" };
const member = { id: "member", permissions: memberPermissions };
const creator = { id: "creator", permissions: memberPermissions };
const booster = { id: "booster", permissions: "0" };
const muted = { id: "muted", permissions: "0" };
const moderator = { id: "moderator", permissions: (P.VIEW_AUDIT_LOG | P.MANAGE_MESSAGES).toString() };

function has(permissionSet, permission) {
  return (permissionSet & permission) === permission;
}

describe("Discord channel permission policy", () => {
  it("keeps staff channels private until the Moderator role is explicitly allowed", () => {
    const staffOverwrites = [roleOverwrite("guild", "0", P.VIEW_CHANNEL), roleOverwrite("moderator", P.VIEW_CHANNEL)];

    for (const roles of [[member], [creator], [booster], [muted]]) {
      expect(has(effectivePermissions({ everyone, roles, overwrites: staffOverwrites, memberId: "user" }), P.VIEW_CHANNEL)).toBe(false);
    }
    expect(
      has(effectivePermissions({ everyone, roles: [member, moderator], overwrites: staffOverwrites, memberId: "mod" }), P.VIEW_CHANNEL),
    ).toBe(true);
  });

  it("makes read-only channels viewable without allowing posts or threads", () => {
    const permissions = effectivePermissions({
      everyone,
      roles: [member],
      overwrites: [roleOverwrite("guild", "0", readOnlyDeny)],
      memberId: "member-1",
    });

    expect(has(permissions, P.VIEW_CHANNEL)).toBe(true);
    expect(has(permissions, P.SEND_MESSAGES)).toBe(false);
    expect(has(permissions, P.CREATE_PUBLIC_THREADS)).toBe(false);
    expect(has(permissions, P.CREATE_PRIVATE_THREADS)).toBe(false);
    expect(has(permissions, P.SEND_MESSAGES_IN_THREADS)).toBe(false);
  });

  it("does not let harmless opt-in roles bypass a muted overwrite", () => {
    const permissions = effectivePermissions({
      everyone,
      roles: [member, muted, { id: "drop-alert", permissions: "0" }, { id: "creator-spotlight", permissions: "0" }],
      overwrites: [roleOverwrite("muted", "0", mutedDeny)],
      memberId: "muted-member",
    });

    for (const permission of [P.SEND_MESSAGES, P.ADD_REACTIONS, P.CONNECT, P.SPEAK, P.CREATE_PUBLIC_THREADS, P.SEND_MESSAGES_IN_THREADS]) {
      expect(has(permissions, permission)).toBe(false);
    }
  });

  it("uses role overwrite type 0 and preserves member-overwrite precedence", () => {
    expect(roleOverwrite("member", P.VIEW_CHANNEL)).toMatchObject({ id: "member", type: 0, allow: P.VIEW_CHANNEL.toString(), deny: "0" });

    const permissions = effectivePermissions({
      everyone,
      roles: [member],
      overwrites: [
        roleOverwrite("member", "0", P.SEND_MESSAGES),
        { id: "member-1", type: 1, allow: P.SEND_MESSAGES.toString(), deny: "0" },
      ],
      memberId: "member-1",
    });
    expect(has(permissions, P.SEND_MESSAGES)).toBe(true);
  });

  it("lets Administrator and the guild owner bypass channel overwrites", () => {
    const denyView = [roleOverwrite("guild", "0", P.VIEW_CHANNEL)];
    const administrator = { id: "administrator", permissions: P.ADMINISTRATOR.toString() };

    expect(has(effectivePermissions({ everyone, roles: [administrator], overwrites: denyView, memberId: "admin" }), P.VIEW_CHANNEL)).toBe(
      true,
    );
    expect(has(effectivePermissions({ everyone, roles: [], overwrites: denyView, memberId: "owner", owner: true }), P.VIEW_CHANNEL)).toBe(
      true,
    );
  });
});

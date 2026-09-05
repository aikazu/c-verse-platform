// Discord API v10 permission flags. Keep masks as BigInt until serialization.
export const P = Object.freeze({
  CREATE_INSTANT_INVITE: 1n << 0n,
  KICK_MEMBERS: 1n << 1n,
  BAN_MEMBERS: 1n << 2n,
  ADMINISTRATOR: 1n << 3n,
  MANAGE_CHANNELS: 1n << 4n,
  MANAGE_GUILD: 1n << 5n,
  ADD_REACTIONS: 1n << 6n,
  VIEW_AUDIT_LOG: 1n << 7n,
  STREAM: 1n << 9n,
  VIEW_CHANNEL: 1n << 10n,
  SEND_MESSAGES: 1n << 11n,
  MANAGE_MESSAGES: 1n << 13n,
  EMBED_LINKS: 1n << 14n,
  ATTACH_FILES: 1n << 15n,
  READ_MESSAGE_HISTORY: 1n << 16n,
  MENTION_EVERYONE: 1n << 17n,
  USE_EXTERNAL_EMOJIS: 1n << 18n,
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
  MANAGE_EVENTS: 1n << 33n,
  MANAGE_THREADS: 1n << 34n,
  CREATE_PUBLIC_THREADS: 1n << 35n,
  CREATE_PRIVATE_THREADS: 1n << 36n,
  USE_EXTERNAL_STICKERS: 1n << 37n,
  SEND_MESSAGES_IN_THREADS: 1n << 38n,
  MODERATE_MEMBERS: 1n << 40n,
  USE_SOUNDBOARD: 1n << 42n,
  CREATE_EVENTS: 1n << 44n,
  PIN_MESSAGES: 1n << 51n,
});

const ALL_PERMISSIONS = (1n << 53n) - 1n;

function toBigInt(value) {
  return typeof value === "bigint" ? value : BigInt(value);
}

export function mask(names) {
  return names
    .reduce((result, name) => {
      if (!(name in P)) throw new Error(`Unknown Discord permission: ${name}`);
      return result | P[name];
    }, 0n)
    .toString();
}

const memberPermissionNames = [
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
  "CREATE_PUBLIC_THREADS",
  "USE_EXTERNAL_STICKERS",
  "SEND_MESSAGES_IN_THREADS",
  "USE_SOUNDBOARD",
];

export const memberPermissions = mask(memberPermissionNames);
export const moderatorPermissions = mask([
  ...memberPermissionNames,
  "KICK_MEMBERS",
  "BAN_MEMBERS",
  "VIEW_AUDIT_LOG",
  "MANAGE_MESSAGES",
  "MUTE_MEMBERS",
  "DEAFEN_MEMBERS",
  "MOVE_MEMBERS",
  "MANAGE_NICKNAMES",
  "MANAGE_THREADS",
  "MODERATE_MEMBERS",
  "PIN_MESSAGES",
]);
export const adminPermissions = mask([
  ...memberPermissionNames,
  "KICK_MEMBERS",
  "BAN_MEMBERS",
  "VIEW_AUDIT_LOG",
  "MANAGE_MESSAGES",
  "MUTE_MEMBERS",
  "DEAFEN_MEMBERS",
  "MOVE_MEMBERS",
  "MANAGE_NICKNAMES",
  "MANAGE_THREADS",
  "MODERATE_MEMBERS",
  "PIN_MESSAGES",
  "MANAGE_CHANNELS",
  "MANAGE_ROLES",
  "MANAGE_WEBHOOKS",
  "MANAGE_GUILD",
  "MANAGE_EVENTS",
  "CREATE_EVENTS",
  "CREATE_INSTANT_INVITE",
]);
export const readOnlyDeny = mask(["SEND_MESSAGES", "CREATE_PUBLIC_THREADS", "CREATE_PRIVATE_THREADS", "SEND_MESSAGES_IN_THREADS"]);
export const maintenancePermissions = mask([
  "VIEW_CHANNEL",
  "READ_MESSAGE_HISTORY",
  "SEND_MESSAGES",
  "SEND_MESSAGES_IN_THREADS",
  "EMBED_LINKS",
  "ATTACH_FILES",
  "ADD_REACTIONS",
  "MANAGE_GUILD",
  "MANAGE_CHANNELS",
  "MANAGE_ROLES",
  "MANAGE_WEBHOOKS",
  "MANAGE_MESSAGES",
  "PIN_MESSAGES",
  "MANAGE_THREADS",
  "MODERATE_MEMBERS",
  "VIEW_AUDIT_LOG",
]);
export const mutedDeny = mask([
  "SEND_MESSAGES",
  "ADD_REACTIONS",
  "CONNECT",
  "SPEAK",
  "CREATE_PUBLIC_THREADS",
  "CREATE_PRIVATE_THREADS",
  "SEND_MESSAGES_IN_THREADS",
]);

export function roleOverwrite(id, allow = "0", deny = "0") {
  return { id: String(id), type: 0, allow: toBigInt(allow).toString(), deny: toBigInt(deny).toString() };
}

function applyOverwrite(permissions, overwrite) {
  return (permissions & ~toBigInt(overwrite.deny)) | toBigInt(overwrite.allow);
}

/**
 * Calculate channel permissions using Discord's documented overwrite order.
 * `everyone` and each entry in `roles` use `{ id, permissions }`.
 */
export function effectivePermissions({ everyone, roles = [], overwrites = [], memberId, owner = false }) {
  if (owner) return ALL_PERMISSIONS;

  let permissions = toBigInt(everyone.permissions);
  for (const role of roles) permissions |= toBigInt(role.permissions);
  if ((permissions & P.ADMINISTRATOR) === P.ADMINISTRATOR) return ALL_PERMISSIONS;

  const everyoneOverwrite = overwrites.find((overwrite) => overwrite.type === 0 && overwrite.id === String(everyone.id));
  if (everyoneOverwrite) permissions = applyOverwrite(permissions, everyoneOverwrite);

  let roleAllow = 0n;
  let roleDeny = 0n;
  for (const role of roles) {
    const overwrite = overwrites.find((item) => item.type === 0 && item.id === String(role.id));
    if (overwrite) {
      roleAllow |= toBigInt(overwrite.allow);
      roleDeny |= toBigInt(overwrite.deny);
    }
  }
  permissions = (permissions & ~roleDeny) | roleAllow;

  const memberOverwrite = overwrites.find((overwrite) => overwrite.type === 1 && overwrite.id === String(memberId));
  return memberOverwrite ? applyOverwrite(permissions, memberOverwrite) : permissions;
}

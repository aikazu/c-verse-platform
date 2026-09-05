# C.Verse Discord operations

The existing community server is `Creator Verse Realm`, guild `1543174682742628356`.
This tooling repairs and maintains that server by stable channel IDs. It is not a generic server bootstrap.

The operational record lives in [11_discord_server.md](../../../00_Dream_Project/40_operations/11_discord_server.md).

## Commands

Run from the Platform checkout:

```powershell
node scripts/discord-server-setup.mjs                 # read-only plan
node scripts/discord-server-setup.mjs --apply         # roles, layout, onboarding, AutoMod, Discord webhook destinations
node scripts/discord-server-setup.mjs --verify        # read live state and check effective permissions
node scripts/discord-server-setup.mjs --publish       # publish/update the reviewed community messages
node scripts/discord-server-setup.mjs --wire-github    # connect GitHub repository webhooks
pnpm exec vitest run scripts/discord
```

`--apply` does not publish messages, invoke webhooks, delete channels, or rotate credentials.
The dedicated publication command requires authorization to publish on behalf of C.Verse.
Before changing an existing message, webhook, role policy, or forum tag, review the current server and intended change.
Do not run conflicting administration tasks concurrently.

## Credentials and recovery

- The bot uses `DISCORD_BOT_TOKEN` or the existing `~/.claude/channels/discord/.env` fallback. Never print token prefixes.
- Snapshots, created resource IDs, message IDs and webhook credentials are outside the repository:
  `%LOCALAPPDATA%\CVerse\discord\1543174682742628356\` on Windows.
- On this workstation the directory ACL grants access only to the current Windows user and SYSTEM. Set the same restriction before using another workstation; Node file modes alone do not enforce Windows ACLs.
- `webhooks.json` contains bearer credentials. Never attach it to an issue, chat, artifact, log, or backup with wider access.
- `before-*.json` captures the state before each apply; `after.json` and `verification.json` record successful verification. Backups exclude webhook tokens.
- The script stops on missing expected channel IDs. Investigate drift before substituting IDs. Unknown channels and active ticket channels are not managed by the layout plan.
- A snapshot is a recovery reference, not an automatic rollback command. Restore only task-owned fields after reviewing subsequent server activity. No channels or messages are deleted by reconciliation.
- Reusing a saved message ID makes publication resumable. If the local state directory is lost, inspect existing pins before publishing new messages to avoid duplicates.

## Access model

Role overwrites must use `type: 0`; `type: 1` is a member overwrite. The old script used the wrong type.
Private children have explicit overwrites because existing children may not sync with category permissions.

Member, Creator, Booster, Bots and opt-in roles have zero extra guild permissions. Public access comes from `@everyone`.
Creator gets access to the private studio; spotlight publication is curated by staff.
Owner is the actual Discord guild owner, not merely someone holding a role named Owner.
Admin and Moderator have explicit permission sets; no human role needs Administrator.

The C-Verse bot is a trusted maintenance application. Its maintenance permissions include managing channels, roles below its role, webhooks, messages, threads, AutoMod and timeouts; it does not need Administrator.
Ticket Tool retains its existing functional permission set, with explicit access to its help category, panel and ticket-log among managed resources. Its own private tickets are controlled through the Ticket Tool panel configuration.
Server Rules acceptance is enabled under Discord's Access settings. The verifier checks this feature, while rule text and role hierarchy are maintained through the owner UI.
Use Discord native **Timeout** as the moderation control. The legacy Muted role is only a compatibility restriction for ordinary community/creator roles; staff allow-overwrites can override it.

## Notifications

- `github-updates`: private repo push, pull request, and release events using Discord's GitHub-compatible endpoint.
- `deploy-status`: GitHub `check_run` events and future local application deploy results.
- `cloudflare-alerts`: account-wide DDoS, Universal SSL, and passive origin availability alerts. These basic alert types rejected zone filters on this account. They are not custom Worker exception/5xx thresholds.
- All three channels are restricted to Owner/Admin and the trusted maintenance bot, excluding Moderator and Ticket Tool.
- Cloudflare configuration uses its Notifications API/connector; policy IDs and source references are in the operational record. Keep the existing budget email policy unchanged.

Application `pnpm --filter @c-verse/{api,web,admin} deploy` scripts keep their normal build/deploy behavior and report the Wrangler exit status through `deploy.mjs`. The helper uses `DISCORD_DEPLOY_WEBHOOK_URL`, falling back to the local `webhooks.json` deploy destination. Direct `wrangler deploy` commands bypass this helper.
Notification failure never changes a successful deploy into failure or masks a failed deploy. Notifications contain app, exit status and local commit only, never deployment output, environment values, or auth URLs. A deploy notification is not a smoke test.
GitHub checks are build/check results, not proof of deployment. The next real deployment is the production-path verification of the wrapper; do not deploy application code merely to test Discord.

## Source references

- [Discord permissions](https://docs.discord.com/developers/topics/permissions)
- [Discord guild/onboarding](https://docs.discord.com/developers/resources/guild)
- [Discord AutoMod](https://docs.discord.com/developers/resources/auto-moderation)
- [Discord webhook delivery](https://docs.discord.com/developers/resources/webhook)
- [Cloudflare webhook destinations](https://developers.cloudflare.com/notifications/get-started/configure-webhooks/)

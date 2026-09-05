#!/usr/bin/env node
import { publishContent } from "./discord/content.mjs";
import { wireGithub } from "./discord/github.mjs";
// Read-only plan by default. See scripts/discord/README.md before using --apply.
import { reconcile } from "./discord/reconcile.mjs";
import { verifyServer } from "./discord/verify.mjs";

const action = process.argv.includes("--publish")
  ? publishContent
  : process.argv.includes("--wire-github")
    ? wireGithub
    : process.argv.includes("--verify")
      ? verifyServer
      : reconcile;
Promise.resolve()
  .then(action)
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });

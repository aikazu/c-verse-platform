import { spawnSync } from "node:child_process";
import { readState, writeState } from "./client.mjs";

const repository = "aikazu/c-verse-platform";
function github(method, path, body) {
  const args = ["api", "--method", method, path];
  if (body) args.push("--input", "-");
  const result = spawnSync("gh", args, { input: body ? JSON.stringify(body) : undefined, encoding: "utf8", windowsHide: true });
  if (result.status !== 0)
    throw new Error(`GitHub ${method} failed (exit ${result.status}); inspect account access without printing webhook credentials`);
  return JSON.parse(result.stdout);
}

export function wireGithub() {
  const hooks = readState("webhooks.json");
  const existing = github("GET", `repos/${repository}/hooks`);
  const result = {};
  for (const [key, events] of Object.entries({ github: ["push", "pull_request", "release"], deploy: ["check_run"] })) {
    if (!hooks[key]?.url) throw new Error(`Missing Discord ${key} webhook`);
    const url = `${hooks[key].url}/github`;
    const found = existing.find((hook) => hook.config?.url === url);
    const body = { name: "web", active: true, events, config: { url, content_type: "json", insecure_ssl: "0" } };
    const hook = github(found ? "PATCH" : "POST", `repos/${repository}/hooks${found ? `/${found.id}` : ""}`, body);
    result[key] = { id: hook.id, active: hook.active, events: hook.events };
  }
  writeState("github.json", result);
  console.log(JSON.stringify({ repository, hooks: result }));
}

import { spawn } from "node:child_process";

const api = spawn("pnpm", ["--filter", "@c-verse/api", "dev:node"], { stdio: "inherit", shell: true });
const web = spawn("pnpm", ["--filter", "@c-verse/web", "dev"], { stdio: "inherit", shell: true });
const onExit = (code, _sig) => {
  try {
    api.kill();
  } catch {}
  try {
    web.kill();
  } catch {}
  process.exit(code ?? 0);
};
api.on("exit", onExit);
web.on("exit", onExit);
process.on("SIGINT", onExit);
process.on("SIGTERM", onExit);

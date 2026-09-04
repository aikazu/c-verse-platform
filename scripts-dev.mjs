import { spawn } from "node:child_process";

const api = spawn("pnpm", ["--filter", "@c-verse/api", "dev"], { stdio: "inherit", shell: true });
const web = spawn("pnpm", ["--filter", "@c-verse/web", "dev"], { stdio: "inherit", shell: true });
const stopChildren = () => {
  try {
    api.kill();
  } catch {}
  try {
    web.kill();
  } catch {}
};
const onChildExit = (code) => {
  stopChildren();
  process.exit(typeof code === "number" ? code : 0);
};
api.on("exit", onChildExit);
web.on("exit", onChildExit);
process.on("SIGINT", () => {
  stopChildren();
  process.exit(130);
});
process.on("SIGTERM", () => {
  stopChildren();
  process.exit(143);
});

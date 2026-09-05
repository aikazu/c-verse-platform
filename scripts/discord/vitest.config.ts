import { defineConfig } from "vitest/config";

export default defineConfig({ test: { name: "discord-operations", environment: "node", include: ["**/*.test.mjs"] } });

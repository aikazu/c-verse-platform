import dotenv from "dotenv";
import path from "node:path";

// Load env for `tsx watch src/server.ts` (Node) — Wrangler uses .dev.vars separately.
// Order: .env (root) → apps/api/.env → apps/api/.dev.vars (last wins, matches wrangler)
dotenv.config({ path: path.resolve(process.cwd(), "../../.env") });
dotenv.config({ path: path.resolve(process.cwd(), ".env") });
dotenv.config({ path: path.resolve(process.cwd(), ".dev.vars") });

import app from "./index.js";
import { serve } from "@hono/node-server";

const port = Number(process.env.PORT || 8787);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`C.Verse API listening on http://localhost:${info.port}`);
  const hasDb = Boolean(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL);
  console.log(`DB: ${hasDb ? "Supabase (" + (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL)?.slice(0, 32) + "...)" : "in-memory (store.ts)"}`);
});

import app from "./index.js";
import { serve } from "@hono/node-server";

const port = Number(process.env.PORT || 8787);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`C.Verse API listening on http://localhost:${info.port}`);
});

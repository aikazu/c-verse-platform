import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import drops from "./routes/drops.js";
import wallet from "./routes/wallet.js";
import orders from "./routes/orders.js";
import nfc from "./routes/nfc.js";
import listings from "./routes/listings.js";
import bids from "./routes/bids.js";
import browse from "./routes/browse.js";
import auth from "./routes/auth.js";
import profile from "./routes/profile.js";
import publicProfile from "./routes/publicProfile.js";
import gamification from "./routes/gamification.js";
import creators from "./routes/creators.js";
import kyc from "./routes/kyc.js";
import shipments from "./routes/shipments.js";

export type Bindings = {
  ENV?: string;
};

const app = new Hono<{ Bindings: Bindings }>();

app.use("*", logger());
app.use("*", cors({
  origin: ["http://localhost:5173", "http://localhost:3000", "http://127.0.0.1:5173", "http://localhost:4173"],
  allowHeaders: ["Content-Type", "Authorization", "x-forwarded-for"],
  allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
}));

app.get("/", (c) => c.json({ name: "C.Verse API", version: "0.1.0", tagline: "Revolusi Ekonomi Kreator", status: "ok" }));
app.get("/health", (c) => c.json({ ok: true, ts: new Date().toISOString() }));
app.get("/api/health", (c) => c.json({ ok: true, ts: new Date().toISOString() }));

app.route("/api/auth", auth);
app.route("/api/drops", drops);
app.route("/api/wallet", wallet);
app.route("/api/orders", orders);
app.route("/api/nfc", nfc);
app.route("/api/listings", listings);
app.route("/api/bids", bids);
app.route("/api/browse", browse);
app.route("/api/profile", profile);
app.route("/api/public", publicProfile);
app.route("/api/gamification", gamification);
app.route("/api/creators", creators);
app.route("/api/kyc", kyc);
app.route("/api/shipments", shipments);

// Compat aliases (old clients hit /api/marketplace etc directly)
app.route("/api/marketplace", listings);

// Fallback JSON 404
app.notFound((c) => c.json({ error: "Not found", path: c.req.path }, 404));
app.onError((err, c) => {
  console.error(err);
  return c.json({ error: err.message || "Internal error" }, 500);
});

export default app;

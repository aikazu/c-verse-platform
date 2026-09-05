import { editorialKindSchema, editorialSaveSchema, emptyEditorialDocument } from "@c-verse/shared";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { adminGateError, clientIp, requireAdmin, tokenFingerprint } from "../../lib/auth.js";
import { RpcError, rpcSaveEditorial, userDb } from "../../lib/db.js";
import { getDropById, listCardsByDrop } from "../../lib/reads/drops.js";
import { getEditorialDraft, getPublicEditorial } from "../../lib/reads/editorial.js";

const app = new Hono();
app.get("/:id/editorial", async (c) => {
  c.header("Cache-Control", "no-store");
  return c.json({ items: await getPublicEditorial(c.req.param("id")) });
});
app.get("/:id/editorial/:kind", async (c) => {
  const auth = await requireAdmin(c);
  if ("error" in auth) {
    const gate = adminGateError(auth);
    return c.json(gate.body, gate.status);
  }
  const kind = editorialKindSchema.safeParse(c.req.param("kind"));
  if (!kind.success) return c.json({ error: "Jenis konten tidak valid" }, 400);
  const dropId = c.req.param("id");
  const drop = await getDropById(dropId);
  if (!drop) return c.json({ error: "Drop tidak ditemukan" }, 404);
  if (kind.data === "seed_campaign" && !drop.isSeed) return c.json({ error: "Kampanye hanya tersedia untuk Creator Seed" }, 400);
  const [row, cards] = await Promise.all([getEditorialDraft(userDb(auth.token), dropId, kind.data), listCardsByDrop(dropId)]);
  c.header("Cache-Control", "no-store");
  return c.json({
    draft: row?.draft ?? emptyEditorialDocument(),
    published: row?.published ?? null,
    revision: row?.revision ?? 0,
    cards: cards.map((card) => ({ id: card.id, shortId: card.nfcShortId, unitNumber: card.unitNumber })),
  });
});
app.put("/:id/editorial/:kind", zValidator("json", editorialSaveSchema), async (c) => {
  const auth = await requireAdmin(c);
  if ("error" in auth) {
    const gate = adminGateError(auth);
    return c.json(gate.body, gate.status);
  }
  const kind = editorialKindSchema.safeParse(c.req.param("kind"));
  if (!kind.success) return c.json({ error: "Jenis konten tidak valid" }, 400);
  try {
    const revision = await rpcSaveEditorial(
      userDb(auth.token),
      c.req.param("id"),
      kind.data,
      c.req.valid("json"),
      clientIp(c),
      await tokenFingerprint(auth.token),
    );
    return c.json({ revision });
  } catch (error) {
    if (error instanceof RpcError)
      return c.json(
        { error: error.message, code: error.code },
        error.code === "EDITORIAL_CONFLICT" ? 409 : error.code === "FORBIDDEN" ? 403 : 400,
      );
    return c.json({ error: "Gagal menyimpan konten" }, 500);
  }
});
export default app;

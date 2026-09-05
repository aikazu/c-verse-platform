import { z } from "zod";

export const editorialKindSchema = z.enum(["story", "seed_campaign"]);
export type EditorialKind = z.infer<typeof editorialKindSchema>;
const mediaUrlSchema = z
  .string()
  .url()
  .max(2048)
  .refine((value) => {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  }, "Gunakan URL HTTPS tanpa kredensial");
export const editorialDocumentSchema = z
  .object({
    title: z.string().trim().max(120),
    body: z.string().trim().max(8000),
    media: z
      .array(
        z
          .object({
            type: z.enum(["image", "video"]),
            url: mediaUrlSchema,
            caption: z.string().trim().min(1).max(240),
          })
          .strict(),
      )
      .max(6),
    cardId: z.string().max(100).nullable(),
    making: z.string().trim().max(4000),
    signing: z.string().trim().max(4000),
    handover: z.string().trim().max(4000),
  })
  .strict();
export type EditorialDocument = z.infer<typeof editorialDocumentSchema>;
export const editorialSaveSchema = z
  .object({
    document: editorialDocumentSchema,
    action: z.enum(["draft", "publish", "unpublish"]),
    revision: z.number().int().min(0),
  })
  .strict();
export type EditorialSave = z.infer<typeof editorialSaveSchema>;
export interface EditorialState {
  draft: EditorialDocument;
  published: EditorialDocument | null;
  revision: number;
  cards: Array<{ id: string; shortId: string; unitNumber: number }>;
}
export const emptyEditorialDocument = (): EditorialDocument => ({
  title: "",
  body: "",
  media: [],
  cardId: null,
  making: "",
  signing: "",
  handover: "",
});
export interface PublishedEditorial {
  kind: EditorialKind;
  document: EditorialDocument;
  cardShortId: string | null;
}

import { z } from "zod";

export const SHOWCASE_MAX_CARDS = 3;
export const showcaseSchema = z
  .object({
    title: z.string().trim().max(80),
    cardIds: z.array(z.string().min(1).max(100)).max(SHOWCASE_MAX_CARDS),
  })
  .strict()
  .refine((value) => new Set(value.cardIds).size === value.cardIds.length, "Kartu unggulan harus berbeda")
  .refine((value) => value.cardIds.length === 0 || value.title.length > 0, "Judul etalase wajib diisi");

export type ShowcaseInput = z.infer<typeof showcaseSchema>;
export interface ShowcaseCard {
  id: string;
  shortId: string;
  title: string;
  artworkUrl: string;
  unitNumber: number;
  variant: "signed" | "unsigned";
}
export interface PublicShowcase {
  title: string;
  username: string;
  displayName: string;
  cards: ShowcaseCard[];
}

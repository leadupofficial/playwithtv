import "./zod-config.js";
import { z } from "zod";

/**
 * Sponsor slots on the TV. Every placement is shown only while nobody is playing, or painted into the scene;
 * nothing ever appears on a phone.
 *   lobby-rail    banner under the lobby
 *   results-rail  banner under the results screen
 *   presented-by  card during a game's opening "get ready" seconds
 *   in-game       sponsor name painted into the game scene (boxing ring apron, trivia header)
 */
export const AdPlacement = z.enum(["lobby-rail", "results-rail", "presented-by", "in-game"]);
export type AdPlacement = z.infer<typeof AdPlacement>;
export const AD_PLACEMENTS = AdPlacement.options;

/** Banner images: 970×90 (or 1940×180) PNG, JPEG or WebP. */
export const AD_IMAGE_MAX_BYTES = 300 * 1024;
export const AD_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;

/** What the admin sends to create or update a sponsor. Dates are inclusive calendar days in India time. */
export const AdInput = z.object({
  advertiser: z.string().trim().min(1).max(60),
  title: z.string().trim().min(1).max(60),
  line: z.string().trim().max(120).default(""),
  placements: z.array(AdPlacement).min(1).max(AD_PLACEMENTS.length),
  startsOn: z.iso.date(),
  endsOn: z.iso.date(),
  enabled: z.boolean().default(true),
}).refine((a) => a.startsOn <= a.endsOn, { message: "endsOn must be on or after startsOn", path: ["endsOn"] });
export type AdInput = z.infer<typeof AdInput>;

export interface AdRecord extends AdInput {
  id: string;
  imageType: string | null;
  imageVersion: number;
}

/** What TVs receive: only active sponsors, no admin fields. */
export interface AdServed {
  id: string;
  advertiser: string;
  title: string;
  line: string;
  placements: AdPlacement[];
  imageUrl: string | null;
}

/**
 * TVs report how often each sponsor was shown, about once a minute, over their authenticated room
 * connection (never an open endpoint). A banner rotates every 15 s, so 10 per item per report is generous.
 */
export const ImpressionItems = z.array(z.object({ id: z.uuid(), placement: AdPlacement, n: z.number().int().min(1).max(10) })).min(1).max(20);
export const ImpressionBatch = z.object({ items: ImpressionItems });
export type ImpressionBatch = z.infer<typeof ImpressionBatch>;

export interface AdStats { id: string; placement: AdPlacement; impressions: number }

import { z } from "zod";
import { base64UrlToBytes } from "@/modules/security/encoding";
const publicId = z.string().length(22).refine(value => base64UrlToBytes(value)?.byteLength === 16);
export const SeriesDecisionRequestSchema = z.object({ publicId, revision: z.number().int().positive(), action: z.enum(["CONFIRM", "PROPOSE_CANCEL"]) }).strict();
export type SeriesDecisionRequest = z.infer<typeof SeriesDecisionRequestSchema>;
export const PublicSeriesViewSchema = z.object({ publicId, title: z.string().min(1).max(2000), revision: z.number().int().positive(),
  state: z.enum(["PROPOSED", "ACTIVE", "CANCELLED", "COMPLETED"]), action: z.enum(["CREATE", "CANCEL"]).nullable(),
  calendarLabel: z.string().max(300), eventLabel: z.string().max(300).nullable(),
  occurrences: z.array(z.object({ localDate: z.iso.date(), localTime: z.string().regex(/^\d{2}:\d{2}$/u),
    status: z.enum(["PROPOSED", "PENDING", "CLAIMED", "RETRYABLE", "SENT", "FAILED", "UNCERTAIN", "CANCELLED"]) }).strict()).min(2).max(30),
}).strict();
export type PublicSeriesView = z.infer<typeof PublicSeriesViewSchema>;
export const SeriesResponseSchema = z.object({ data: z.object({ series: z.array(PublicSeriesViewSchema).max(100) }).strict() }).strict();
export const SeriesDecisionResponseSchema = z.object({ data: z.object({ result: z.enum(["CONFIRMED", "ALREADY_CONFIRMED", "PROPOSED", "CANCELLED", "ALREADY_CANCELLED", "STALE"]) }).strict() }).strict();

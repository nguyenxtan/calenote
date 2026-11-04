import { z } from "zod";
import { base64UrlToBytes } from "@/modules/security/encoding";

/** Canonical (context-contract) series controls. Separate from the legacy
 * /api/reminder-series authority, which intentionally filters these rows. */
const publicId = z.string().length(22).refine(value => base64UrlToBytes(value)?.byteLength === 16);
export const CanonicalSeriesCancelRequestSchema = z.strictObject({ publicId, expectedRevision: z.number().int().positive().max(1_000_000) });
export type CanonicalSeriesCancelRequest = z.infer<typeof CanonicalSeriesCancelRequestSchema>;

export const CanonicalOccurrenceStatusSchema = z.enum(["PENDING", "CLAIMED", "RETRYABLE", "SENT", "FAILED", "UNCERTAIN", "CANCELLED"]);
export const CanonicalSeriesViewSchema = z.strictObject({
  publicId, revision: z.number().int().positive(),
  state: z.enum(["ACTIVE", "CANCELLED", "COMPLETED"]),
  title: z.string().min(1).max(1800),
  calendar: z.enum(["GREGORIAN", "LUNAR_VN"]),
  eventDate: z.iso.date().nullable(),
  eventTime: z.string().regex(/^\d{2}:\d{2}$/u).nullable(),
  occurrences: z.array(z.strictObject({ localDate: z.iso.date(), localTime: z.string().regex(/^\d{2}:\d{2}$/u), status: CanonicalOccurrenceStatusSchema })).min(1).max(30),
  currentReminders: z.array(z.strictObject({localDate:z.iso.date(),localTime:z.string().regex(/^\d{2}:\d{2}$/u),status:CanonicalOccurrenceStatusSchema})).max(30).optional(),
  pendingFollowUps:z.number().int().min(0).max(30).optional(),
});
export type CanonicalSeriesView = z.infer<typeof CanonicalSeriesViewSchema>;
export const CanonicalSeriesListResponseSchema = z.strictObject({ data: z.strictObject({ schemaVersion: z.literal("canonical-series-1"), series: z.array(CanonicalSeriesViewSchema).max(10) }) });

export const CanonicalSeriesCancelResultSchema = z.discriminatedUnion("result", [
  z.strictObject({ result: z.literal("CANCELLED"), revision: z.number().int().positive(),
    cancelledReminders: z.number().int().min(0).max(60), cancelledDeliveries: z.number().int().min(0).max(60),
    stoppedTasks: z.number().int().min(0).max(60), preservedUnchanged: z.number().int().min(0).max(60) }),
  z.strictObject({ result: z.literal("ALREADY_CANCELLED"), revision: z.number().int().positive() }),
  z.strictObject({ result: z.literal("CONFLICT") }),
  z.strictObject({ result: z.literal("NOT_FOUND") }),
]);
export type CanonicalSeriesCancelResult = z.infer<typeof CanonicalSeriesCancelResultSchema>;
export const CanonicalSeriesCancelResponseSchema = z.strictObject({ data: CanonicalSeriesCancelResultSchema });

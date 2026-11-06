import { z } from "zod";
import { base64UrlToBytes,bytesToBase64Url } from "@/modules/security/encoding";

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
const cursorValue=z.tuple([z.union([z.literal(0),z.literal(1)]),z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),publicId]);
export function decodeCanonicalSeriesCursor(cursor:string):z.infer<typeof cursorValue>|null{
 try{if(cursor.length>256)return null;const bytes=base64UrlToBytes(cursor);if(!bytes)return null;const parsed=cursorValue.safeParse(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)));return parsed.success?parsed.data:null;}catch{return null;}
}
export function encodeCanonicalSeriesCursor(value:z.infer<typeof cursorValue>):string{return bytesToBase64Url(new TextEncoder().encode(JSON.stringify(cursorValue.parse(value))));}
export const CanonicalSeriesCursorSchema=z.string().min(1).max(256).refine(value=>decodeCanonicalSeriesCursor(value)!==null);
const pageFields={series:z.array(CanonicalSeriesViewSchema).max(10),hasMore:z.boolean(),nextCursor:CanonicalSeriesCursorSchema.nullable(),skipped:z.number().int().min(0).max(10)};
export const CanonicalSeriesPageSchema=z.strictObject(pageFields).refine(page=>page.hasMore===(page.nextCursor!==null));
export type CanonicalSeriesPage=z.infer<typeof CanonicalSeriesPageSchema>;
export const CanonicalSeriesListResponseSchema = z.strictObject({data:z.strictObject({...pageFields,schemaVersion:z.literal('canonical-series-1')}).refine(page=>page.hasMore===(page.nextCursor!==null))});

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

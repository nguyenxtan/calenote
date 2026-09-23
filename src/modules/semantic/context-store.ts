import { z } from "zod";
import { LocalDateSchema, LocalTimeSchema, MAX_SEMANTIC_TITLE_CODE_UNITS } from "./contracts";
import { isValidSemanticLocalDate, isValidSemanticLocalTime } from "./validation";

const localDate = LocalDateSchema.refine(isValidSemanticLocalDate);
const localTime = LocalTimeSchema.refine(isValidSemanticLocalTime);

const missing = z.array(z.enum(["date", "time", "title", "range"]))
  .min(1).max(4).refine((fields) => new Set(fields).size === fields.length);

/** Only known semantic slots survive a turn. Never a message or transcript. */
export const SemanticContextSlotsSchema = z.discriminatedUnion("targetIntent", [
  z.object({
    targetIntent: z.literal("CREATE_REMINDER"),
    title: z.string().min(1).max(MAX_SEMANTIC_TITLE_CODE_UNITS).refine((title) => title.trim().length > 0).nullable(),
    localDate: localDate.nullable(),
    localTime: localTime.nullable(),
    missingFields: missing.refine((fields) => !fields.includes("range")),
  }).strict(),
  z.object({
    targetIntent: z.literal("LIST_REMINDERS"),
    rangeKind: z.enum(["TODAY", "TOMORROW", "DATE", "THIS_WEEK", "NEXT_7_DAYS", "UPCOMING"]).nullable(),
    localDate: localDate.nullable(),
    missingFields: missing.refine((fields) => fields.length === 1 && fields[0] === "range"),
  }).strict().refine((slots) => slots.rangeKind === "DATE" ? slots.localDate !== null : slots.localDate === null),
]);
export type SemanticContextSlots = z.infer<typeof SemanticContextSlotsSchema>;
export interface SemanticContextScope { ownerId: string; chatIdentityId: string; now: number }
export interface CreateSemanticContextInput extends SemanticContextScope {
  id: string;
  sourceInboundId: string;
  claimMarker: string;
  slots: SemanticContextSlots;
  expiresAt: number;
}
export interface PendingSemanticContext {
  id: string;
  sourceInboundId: string;
  slots: SemanticContextSlots;
  expiresAt: number;
}
export interface ResolveSemanticContextInput extends SemanticContextScope {
  id: string;
  resolutionInboundId: string;
  claimMarker: string;
  status: "RESOLVED" | "CANCELLED";
}
export interface SemanticContextStore {
  createPending(input: CreateSemanticContextInput): Promise<"CREATED" | "ALREADY_EXISTS" | "CONFLICT">;
  findPending(input: SemanticContextScope): Promise<PendingSemanticContext | null>;
  resolve(input: ResolveSemanticContextInput): Promise<boolean>;
}

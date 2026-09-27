import { z } from "zod";
import { ModelSemanticInterpretationSchema, MAX_SEMANTIC_TITLE_CODE_UNITS } from "../semantic/contracts";
import { isValidSemanticLocalDate, isValidSemanticLocalTime } from "../semantic/validation";

export const CONVERSATION_MAX_TURNS = 6;
export const CONVERSATION_MAX_TURN_CHARACTERS = 2000;
export const CONVERSATION_MAX_BYTES = 16 * 1024;
export const CONVERSATION_IDLE_TTL_MS = 30 * 60_000;
export const CONVERSATION_ABSOLUTE_TTL_MS = 2 * 60 * 60_000;

export const CalendarKindSchema = z.enum(["GREGORIAN", "LUNAR_VN"]);
export type CalendarKind = z.infer<typeof CalendarKindSchema>;
export const DialogueActSchema = z.enum(["GREET", "CAPABILITY", "CONTINUE", "EDIT", "ABANDON", "NEW_REQUEST", "AMBIGUOUS"]);
export type DialogueAct = z.infer<typeof DialogueActSchema>;
export const MissingFieldSchema = z.enum(["title", "eventDate", "date", "time", "year", "leapMonth", "seriesCount", "seriesRelation", "intent"]);
export type MissingField = z.infer<typeof MissingFieldSchema>;

/** Suggestions only. Confirmation is deliberately not a model output. */
export const ConversationModelSchema = ModelSemanticInterpretationSchema.safeExtend({
  dialogueAct: DialogueActSchema,
  continuation: z.enum(["YES", "NO", "UNCERTAIN"]),
  capability: z.literal("LUNAR").nullable(),
}).superRefine((value, ctx) => {
  if ((value.dialogueAct === "CAPABILITY") !== (value.capability !== null)
    || (["GREET", "CAPABILITY", "ABANDON"].includes(value.dialogueAct) && value.intent !== "HELP")) {
    ctx.addIssue({ code: "custom", path: ["dialogueAct"], message: "Incompatible dialogue semantics" });
  }
});
export type ConversationModel = z.infer<typeof ConversationModelSchema>;
const conversationBaseJsonSchema = z.toJSONSchema(ConversationModelSchema, { target: "draft-07" });
// Each branch carries the full object contract. Do not depend on provider
// schema lowering preserving sibling constraints around a union.
function dialogueBranch(properties: NonNullable<typeof conversationBaseJsonSchema.properties>): NonNullable<typeof conversationBaseJsonSchema.anyOf>[number] {
  return { type: "object", additionalProperties: false, required: conversationBaseJsonSchema.required,
    properties: { ...conversationBaseJsonSchema.properties, ...properties } };
}
export const ConversationModelJsonSchema: typeof conversationBaseJsonSchema = {
  ...conversationBaseJsonSchema,
  // Zod refinements are runtime-only. Express dialogue ownership on the wire
  // as well; root properties/required/additionalProperties still apply.
  anyOf: [
    dialogueBranch({ dialogueAct: { type: "string", enum: ["CAPABILITY"] }, capability: { type: "string", enum: ["LUNAR"] }, intent: { type: "string", enum: ["HELP"] },
      title: { type: "null" }, titleState: { type: "string", enum: ["NOT_APPLICABLE"] }, targetIntent: { type: "null" } }),
    dialogueBranch({ dialogueAct: { type: "string", enum: ["GREET", "ABANDON"] }, capability: { type: "null" }, intent: { type: "string", enum: ["HELP"] },
      title: { type: "null" }, titleState: { type: "string", enum: ["NOT_APPLICABLE"] }, targetIntent: { type: "null" } }),
    ...[
      { intent: { type: "string" as const, enum: ["CREATE_REMINDER"] }, targetIntent: { type: "null" as const } },
      { intent: { type: "string" as const, enum: ["AMBIGUOUS"] }, targetIntent: { type: "string" as const, enum: ["CREATE_REMINDER"] } },
    ].flatMap(semantic => [
      { title: { type: "string" as const, minLength: 1, maxLength: MAX_SEMANTIC_TITLE_CODE_UNITS, pattern: "\\S" }, titleState: { type: "string" as const, enum: ["RESOLVED"] } },
      { title: { type: "null" as const }, titleState: { type: "string" as const, enum: ["MISSING", "AMBIGUOUS"] } },
    ].map(title => dialogueBranch({ ...semantic, ...title,
      dialogueAct: { type: "string", enum: ["CONTINUE", "EDIT", "NEW_REQUEST", "AMBIGUOUS"] }, capability: { type: "null" } }))),
    ...[
      { intent: { type: "string" as const, enum: ["LIST_REMINDERS", "HELP", "UNSUPPORTED"] }, targetIntent: { type: "null" as const } },
      { intent: { type: "string" as const, enum: ["AMBIGUOUS"] }, targetIntent: { enum: [null, "LIST_REMINDERS"] } },
    ].map(semantic => dialogueBranch({ ...semantic, title: { type: "null" }, titleState: { type: "string", enum: ["NOT_APPLICABLE"] },
      dialogueAct: { type: "string", enum: ["CONTINUE", "EDIT", "NEW_REQUEST", "AMBIGUOUS"] }, capability: { type: "null" } })),
  ],
};

const instant = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const identifier = z.string().min(1).max(128);
export const LunarDateSchema = z.object({
  year: z.number().int().min(1900).max(2100), month: z.number().int().min(1).max(12),
  day: z.number().int().min(1).max(30), leap: z.boolean(),
}).strict();
export type LunarDate = z.infer<typeof LunarDateSchema>;
export const DateFactSchema = z.object({
  solarDate: z.string().refine(isValidSemanticLocalDate), calendar: CalendarKindSchema,
  lunar: LunarDateSchema.nullable(), conversionVersion: z.string().min(1).max(128).nullable(),
  sourceInboundId: identifier,
}).strict().refine(fact => fact.calendar === "GREGORIAN"
  ? fact.lunar === null && fact.conversionVersion === null
  : fact.lunar !== null && fact.conversionVersion !== null, "Calendar provenance is required");
export type DateFact = z.infer<typeof DateFactSchema>;
export const SeriesRelationSchema = z.enum(["STARTING_ON", "BEFORE_EVENT", "INCLUDING_EVENT"]);
export type SeriesRelation = z.infer<typeof SeriesRelationSchema>;
// Application-owned unresolved operands, never part of the provider schema.
export const PendingLunarInputSchema = z.object({
  day: z.number().int().min(1).max(30), month: z.number().int().min(1).max(12),
  year: z.number().int().min(1900).max(2100).nullable(), leap: z.boolean().nullable(),
  role: z.enum(["EVENT", "REMINDER"]), sourceInboundId: identifier,
}).strict();
export type PendingLunarInput = z.infer<typeof PendingLunarInputSchema>;
export const PendingRequestSchema = z.object({
  title: z.string().min(1).max(MAX_SEMANTIC_TITLE_CODE_UNITS).refine(text => text.trim().length > 0).nullable(),
  calendar: CalendarKindSchema,
  eventDate: DateFactSchema.nullable(), reminderDate: DateFactSchema.nullable(),
  reminderTime: z.string().refine(isValidSemanticLocalTime).nullable(),
  count: z.number().int().min(1).max(30).nullable(), relation: SeriesRelationSchema.nullable(),
  lunarInput: PendingLunarInputSchema.optional(),
  missing: z.array(MissingFieldSchema).max(9).refine(fields => new Set(fields).size === fields.length),
}).strict();
export type PendingRequest = z.infer<typeof PendingRequestSchema>;
export interface ConversationScope {
  ownerId: string; chatIdentityId: string; sourceInboundId: string; claimMarker: string; now: number;
}
export const ConversationStatusSchema = z.enum(["CLARIFYING", "DRAFT_READY", "COMPLETED", "CANCELLED", "EXPIRED", "INVALID"]);
export type ConversationStatus = z.infer<typeof ConversationStatusSchema>;
export const ConversationTurnSchema = z.object({
  userText: z.string().min(1).max(CONVERSATION_MAX_TURN_CHARACTERS * 2)
    .refine(text => [...text].length <= CONVERSATION_MAX_TURN_CHARACTERS),
  receivedAt: instant, outcomeCode: z.string().regex(/^[A-Z][A-Z_]{0,63}$/u),
}).strict();
export const ConversationSnapshotSchema = z.object({
  id: identifier, revision: z.number().int().positive(), status: ConversationStatusSchema,
  createdAt: instant, expiresAt: instant, request: PendingRequestSchema,
  turns: z.array(ConversationTurnSchema).max(CONVERSATION_MAX_TURNS),
}).strict().superRefine((snapshot, ctx) => {
  const latest = snapshot.turns.at(-1)?.receivedAt ?? snapshot.createdAt;
  if (snapshot.expiresAt <= snapshot.createdAt
    || snapshot.expiresAt > snapshot.createdAt + CONVERSATION_ABSOLUTE_TTL_MS
    || snapshot.expiresAt > latest + CONVERSATION_IDLE_TTL_MS
    || snapshot.turns.some((turn, index) => turn.receivedAt < (snapshot.turns[index - 1]?.receivedAt ?? snapshot.createdAt))
    || new TextEncoder().encode(JSON.stringify(snapshot)).byteLength > CONVERSATION_MAX_BYTES) {
    ctx.addIssue({ code: "custom", message: "Invalid context bounds" });
  }
});
export type ConversationSnapshot = z.infer<typeof ConversationSnapshotSchema>;

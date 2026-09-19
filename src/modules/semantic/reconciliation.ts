import { z } from "zod";
import { LocalDateSchema, LocalTimeSchema, ModelSemanticInterpretationSchema, SEMANTIC_TIMEZONE,
  type ModelSemanticInterpretation } from "./contracts";
import { SemanticContextSlotsSchema, type SemanticContextSlots } from "./context-store";
import { mergeTemporalEvidence, type TemporalEvidence } from "./temporal-evidence";
import { isValidSemanticLocalDate, isValidSemanticLocalTime, validateSemanticPayload, type SemanticValidationResult } from "./validation";

export type SemanticReconciliationResult = Exclude<SemanticValidationResult, { kind: "CLARIFICATION" }>
  | (Extract<SemanticValidationResult, { kind: "CLARIFICATION" }> & { contextSlots: SemanticContextSlots });

const localDate = LocalDateSchema.refine(isValidSemanticLocalDate);
const localTime = LocalTimeSchema.refine(isValidSemanticLocalTime);
const missing = z.object({ state: z.literal("MISSING") }).strict();

// This checks the internal boundary too: a malformed serialized/context value
// must not gain authority just because a TypeScript caller asserted its type.
export const TemporalEvidenceSchema = z.object({
  timezone: z.literal(SEMANTIC_TIMEZONE),
  referenceLocalDate: localDate,
  referenceLocalTime: localTime,
  date: z.discriminatedUnion("state", [
    missing,
    z.object({ state: z.literal("RESOLVED"), source: z.enum(["TODAY", "TOMORROW", "EXPLICIT_DATE", "DAY_MONTH"]), localDate }).strict(),
    z.object({ state: z.literal("AMBIGUOUS"), reason: z.enum(["MULTIPLE_DATE_EXPRESSIONS", "INVALID_DATE", "CONFLICTING_DATE_EXPRESSIONS"]) }).strict(),
  ]),
  time: z.discriminatedUnion("state", [
    missing,
    z.object({ state: z.literal("RESOLVED"), source: z.literal("EXACT_TIME"), localTime }).strict(),
    z.object({ state: z.literal("AMBIGUOUS"), reason: z.enum(["MULTIPLE_TIME_EXPRESSIONS", "INVALID_TIME", "DAYPART_WITHOUT_EXACT_TIME"]) }).strict(),
  ]),
  range: z.discriminatedUnion("state", [
    missing,
    z.object({ state: z.literal("AMBIGUOUS") }).strict(),
    z.object({ state: z.literal("RESOLVED"), kind: z.enum(["TODAY", "TOMORROW", "DATE", "THIS_WEEK", "NEXT_7_DAYS", "UPCOMING"]),
      localDate: localDate.nullable() }).strict().refine((range) => range.kind === "DATE" ? range.localDate !== null : range.localDate === null),
  ]),
}).strict();

const questions = {
  title: "Bạn muốn được nhắc việc gì?",
  date: "Bạn muốn được nhắc vào ngày nào?",
  time: "Bạn muốn được nhắc lúc mấy giờ?",
  range: "Bạn muốn xem lời nhắc trong ngày hoặc khoảng thời gian nào?",
} as const;

function clarify(contextSlots: SemanticContextSlots): SemanticReconciliationResult {
  return {
    kind: "CLARIFICATION",
    clarification: { targetIntent: contextSlots.targetIntent, missingFields: [...contextSlots.missingFields],
      question: contextSlots.missingFields.map((field) => questions[field]).join(" ") },
    contextSlots,
  };
}

/** Prior values are already absolute, scoped/TTL-checked slots from the context store. */
function priorEvidence(slots: SemanticContextSlots, current: TemporalEvidence): TemporalEvidence {
  const base: TemporalEvidence = { ...current, date: { state: "MISSING" }, time: { state: "MISSING" }, range: { state: "MISSING" } };
  if (slots.targetIntent === "CREATE_REMINDER") {
    if (slots.localDate !== null) base.date = { state: "RESOLVED", source: "EXPLICIT_DATE", localDate: slots.localDate as `${number}-${number}-${number}` };
    if (slots.localTime !== null) base.time = { state: "RESOLVED", source: "EXACT_TIME", localTime: slots.localTime as `${number}:${number}` };
  } else if (slots.rangeKind !== null) {
    base.range = { state: "RESOLVED", kind: slots.rangeKind, localDate: slots.localDate as `${number}-${number}-${number}` | null };
  }
  return base;
}

/** Pure outcome construction. Storage, encryption, draft creation and confirmation remain with the application. */
export function reconcileSemanticInterpretation(input: {
  modelInterpretation: ModelSemanticInterpretation;
  temporalEvidence: TemporalEvidence;
  previousContext?: SemanticContextSlots;
  processingNow: number;
}): SemanticReconciliationResult {
  if (!Number.isSafeInteger(input.processingNow) || input.processingNow < 0 || input.processingNow > 8_640_000_000_000_000) {
    return { kind: "SAFE_HELP", code: "INVALID_PROCESSING_TIME" };
  }
  const parsedModel = ModelSemanticInterpretationSchema.safeParse(input.modelInterpretation);
  if (!parsedModel.success) return { kind: "SAFE_HELP", code: "INVALID_SEMANTIC_INTERPRETATION" };
  const model = parsedModel.data;
  if (model.intent === "HELP" || model.intent === "UNSUPPORTED") return { kind: "SAFE_HELP", code: model.intent };
  if (model.intent === "AMBIGUOUS") return { kind: "SAFE_HELP", code: "AMBIGUOUS_INTENT" };

  const parsedEvidence = TemporalEvidenceSchema.safeParse(input.temporalEvidence);
  if (!parsedEvidence.success) return { kind: "SAFE_HELP", code: "INVALID_TEMPORAL_EVIDENCE" };
  let evidence = parsedEvidence.data as TemporalEvidence;
  let previous: SemanticContextSlots | undefined;
  if (input.previousContext !== undefined) {
    const parsedContext = SemanticContextSlotsSchema.safeParse(input.previousContext);
    if (!parsedContext.success) return { kind: "SAFE_HELP", code: "INVALID_CONTEXT" };
    previous = parsedContext.data;
    if (previous.targetIntent !== model.intent) return { kind: "SAFE_CLARIFICATION", code: "CONFLICTING_CONTEXT" };
    // Fresh list contexts contain only a missing range. Older/externally
    // supplied resolved relative ranges have no receipt anchor in these slots;
    // accepting one would silently move it to this inbound's calendar window.
    if (previous.targetIntent === "LIST_REMINDERS" && previous.rangeKind !== null && previous.rangeKind !== "DATE") {
      return { kind: "SAFE_CLARIFICATION", code: "CONFLICTING_CONTEXT" };
    }
    const merged = mergeTemporalEvidence(priorEvidence(previous, evidence), evidence);
    if (merged.kind === "CONFLICT") return { kind: "SAFE_CLARIFICATION", code: "CONFLICTING_CONTEXT" };
    evidence = merged.evidence;
  }

  if (model.intent === "LIST_REMINDERS") {
    if (evidence.range.state !== "RESOLVED") return clarify({
      targetIntent: "LIST_REMINDERS", rangeKind: null, localDate: null, missingFields: ["range"],
    });
    return validateFinal({ intent: "LIST_REMINDERS", rangeKind: evidence.range.kind, localDate: evidence.range.localDate }, input.processingNow);
  }

  const previousTitle = previous?.targetIntent === "CREATE_REMINDER" ? previous.title : null;
  if (previousTitle !== null && (model.titleState === "AMBIGUOUS"
    || (model.titleState === "RESOLVED" && model.title !== previousTitle))) {
    return { kind: "SAFE_CLARIFICATION", code: "CONFLICTING_CONTEXT" };
  }
  const title = previousTitle ?? model.title;
  const date = evidence.date.state === "RESOLVED" ? evidence.date.localDate : null;
  const time = evidence.time.state === "RESOLVED" ? evidence.time.localTime : null;
  const missingFields: Array<"title" | "date" | "time"> = [];
  if (title === null) missingFields.push("title");
  if (date === null) missingFields.push("date");
  if (time === null) missingFields.push("time");
  if (missingFields.length !== 0) return clarify({
    targetIntent: "CREATE_REMINDER", title, localDate: date, localTime: time, missingFields,
  });
  return validateFinal({ intent: "CREATE_REMINDER", title, localDate: date, localTime: time,
    timezone: SEMANTIC_TIMEZONE, needsClarification: false }, input.processingNow);
}

function validateFinal(payload: unknown, processingNow: number): SemanticReconciliationResult {
  const result = validateSemanticPayload(payload, processingNow);
  // Only the two final application contracts are constructed above. Never
  // return an unbacked clarification without the corresponding context slots.
  return result.kind === "CLARIFICATION" ? { kind: "SAFE_HELP", code: "INVALID_SEMANTIC_INTERPRETATION" } : result;
}

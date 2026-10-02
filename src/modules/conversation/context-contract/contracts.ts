import { z } from "zod";
import { projectCanonicalValidation, type CanonicalValidationDiagnostics } from "./validation-diagnostics";

/** Dormant canonical successor contract. No execution or confirmation authority. */
export const SLOT_NAMES = ["title", "location", "notes", "eventDate", "eventTime", "reminderDate", "reminderTime", "calendar", "frequency", "occurrenceCount", "eventRelation", "leadOffsetDays", "endDate"] as const;
export const SlotNameSchema = z.enum(SLOT_NAMES);
export const CalendarSchema = z.enum(["GREGORIAN", "LUNAR_VN"]);
const positive = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const nfcText = (max: number) => z.string().min(1).max(max * 2).refine(s => s.isWellFormed() && s === s.normalize("NFC") && [...s].length <= max && s.trim().length > 0, "Expected nonblank NFC Unicode scalar text within code-point limit").meta({ maxLength: max });
const text1800 = nfcText(1800);
const text2000 = nfcText(2000);
export const DateOperandSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("CIVIL_DATE"), calendar: CalendarSchema, day: z.number().int().min(1).max(31), month: z.number().int().min(1).max(12), year: z.number().int().min(1).max(9999).nullable(), leapMonth: z.boolean().nullable() })
    .refine(v => v.calendar !== "GREGORIAN" || v.leapMonth === null, "Gregorian leapMonth must be null"),
  z.strictObject({ kind: z.literal("RELATIVE_DAY"), offsetDays: z.number().int().min(-366).max(366) }),
  z.strictObject({ kind: z.literal("WEEKDAY"), weekday: z.number().int().min(1).max(7), qualifier: z.enum(["THIS_WEEK", "NEXT_WEEK", "UNRESOLVED"]) }),
]);
export type DateOperand = z.infer<typeof DateOperandSchema>;
export const ClockOperandSchema = z.strictObject({ hour: z.number().int().min(0).max(23), minute: z.number().int().min(0).max(59), qualifier: z.enum(["H24", "AM", "PM", "UNKNOWN"]) })
  .refine(v => !["AM", "PM"].includes(v.qualifier) || (v.hour >= 1 && v.hour <= 12), "AM/PM hours must be 1–12");
export const EvidenceRefSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("USER_QUOTE"), turn: z.number().int().min(0).max(11), quote: text2000, occurrence: positive }),
  z.strictObject({ kind: z.literal("CONTEXT_FACT"), ref: z.string().regex(/^f[1-9][0-9]*$/u).max(16) }),
]);
export type EvidenceRef = z.infer<typeof EvidenceRefSchema>;
const evidence = z.array(EvidenceRefSchema).min(1).max(3);
export const SlotValueSchemas = {
  title: text1800, location: nfcText(300), notes: text2000,
  eventDate: DateOperandSchema, eventTime: ClockOperandSchema,
  reminderDate: DateOperandSchema, reminderTime: ClockOperandSchema,
  calendar: CalendarSchema, frequency: z.enum(["ONCE", "DAILY", "WEEKLY", "MONTHLY", "YEARLY", "UNKNOWN"]),
  occurrenceCount: positive, eventRelation: z.enum(["BEFORE_EVENT", "INCLUDING_EVENT", "STARTING_ON"]),
  leadOffsetDays: positive, endDate: DateOperandSchema,
};
const values = SlotValueSchemas;
// The generic helper preserves the field/value association in inferred TS types.
function setBranch<K extends keyof typeof values>(field: K) {
  return z.strictObject({ field: z.literal(field), operation: z.literal("SET"), value: values[field], evidence });
}
export const LegacyV2FieldChangeSchema = z.union([
  setBranch("title"), setBranch("location"), setBranch("notes"), setBranch("eventDate"), setBranch("eventTime"), setBranch("reminderDate"), setBranch("reminderTime"), setBranch("calendar"), setBranch("frequency"), setBranch("occurrenceCount"), setBranch("eventRelation"), setBranch("leadOffsetDays"), setBranch("endDate"),
  z.strictObject({ field: SlotNameSchema, operation: z.literal("CLEAR"), value: z.null(), evidence }),
]);
export type LegacyV2FieldChange = z.infer<typeof LegacyV2FieldChangeSchema>;
export const QueryPeriodSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("DAY"), date: DateOperandSchema.nullable() }),
  z.strictObject({ kind: z.enum(["WEEK", "MONTH", "WEEKEND"]), offset: z.union([z.literal(-1), z.literal(0), z.literal(1)]) }),
  z.strictObject({ kind: z.enum(["REST_OF_MONTH", "NEXT_7_DAYS", "UPCOMING"]) }),
  z.strictObject({ kind: z.literal("DATE_BOUNDS"), from: DateOperandSchema.nullable(), through: DateOperandSchema.nullable() }),
]);
export const QueryOperandSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("LIST"), period: QueryPeriodSchema.nullable(), statusScope: z.literal("DEFAULT"), evidence }),
  z.strictObject({ kind: z.literal("CALENDAR_DATE"), date: DateOperandSchema.nullable(), outputCalendar: CalendarSchema.nullable(), evidence }),
  z.strictObject({ kind: z.literal("CAPABILITY"), topic: z.enum(["LUNAR", "FINITE_SERIES", "ANNUAL"]).nullable(), evidence }),
]);
export type QueryOperand = z.infer<typeof QueryOperandSchema>;
export const IntentSchema = z.enum(["CREATE_REMINDER", "LIST_REMINDERS", "CALENDAR_QUERY", "CAPABILITY_QUERY", "HELP", "UNSUPPORTED", "AMBIGUOUS"]);
export const DialogueActSchema = z.enum(["NEW_REQUEST", "CONTINUE", "EDIT", "ABANDON_PENDING", "GREET", "AMBIGUOUS"]);
export const IssueFieldSchema = z.enum([...SLOT_NAMES, "intent", "queryRange", "operation"]);
const reason = z.enum(["MISSING", "AMBIGUOUS", "CONFLICT", "UNSUPPORTED_COMBINATION"]);
// Typed possible values with grounding; never free-form model prose.
const alternative = <T extends z.ZodType>(value: T) => z.strictObject({ value, evidence });
function slotUncertainty<K extends keyof typeof values>(field: K) { return z.strictObject({ field: z.literal(field), reason, alternatives: z.array(z.strictObject({ value: values[field], evidence })).max(2) }); }
export const LegacyV2UncertaintySchema = z.union([
  slotUncertainty("title"), slotUncertainty("location"), slotUncertainty("notes"), slotUncertainty("eventDate"), slotUncertainty("eventTime"), slotUncertainty("reminderDate"), slotUncertainty("reminderTime"), slotUncertainty("calendar"), slotUncertainty("frequency"), slotUncertainty("occurrenceCount"), slotUncertainty("eventRelation"), slotUncertainty("leadOffsetDays"), slotUncertainty("endDate"),
  z.strictObject({ field: z.literal("intent"), reason, alternatives: z.array(alternative(IntentSchema)).max(2) }),
  z.strictObject({ field: z.literal("queryRange"), reason, alternatives: z.array(alternative(QueryPeriodSchema)).max(2) }),
  z.strictObject({ field: z.literal("operation"), reason, alternatives: z.array(alternative(DialogueActSchema)).max(2) }),
]);
export const LegacyV2SemanticPatchProposalSchema = z.strictObject({
  schemaVersion: z.literal("calenote-context-2"), intent: IntentSchema, dialogueAct: DialogueActSchema,
  continuation: z.enum(["YES", "NO", "UNCERTAIN"]), changes: z.array(LegacyV2FieldChangeSchema).max(13),
  query: QueryOperandSchema.nullable(), uncertainties: z.array(LegacyV2UncertaintySchema).max(4), controlEvidence: z.array(EvidenceRefSchema).max(3),
}).superRefine((v, ctx) => {
  const fail = (message: string) => ctx.addIssue({ code: "custom", message });
  if (new Set(v.changes.map(c => c.field)).size !== v.changes.length) fail("Duplicate field rejects whole patch");
  const queryKinds: Record<string, string> = { LIST_REMINDERS: "LIST", CALENDAR_QUERY: "CALENDAR_DATE", CAPABILITY_QUERY: "CAPABILITY" };
  const queryKind = queryKinds[v.intent];
  if (queryKind ? v.query?.kind !== queryKind || v.changes.length !== 0 : v.query !== null) fail("Query/intent ownership mismatch");
  if ((["HELP", "UNSUPPORTED"].includes(v.intent) || v.dialogueAct === "ABANDON_PENDING") && v.changes.length) fail("Non-mutating proposal cannot carry changes");
  if (v.changes.some(c => c.operation === "CLEAR" && !c.evidence.some(e => e.kind === "USER_QUOTE"))) fail("CLEAR requires user evidence");
  if (v.query && ((v.query.kind === "LIST" && (v.query.period === null || (v.query.period.kind === "DAY" && v.query.period.date === null) || (v.query.period.kind === "DATE_BOUNDS" && (v.query.period.from === null || v.query.period.through === null)))) || (v.query.kind === "CALENDAR_DATE" && (v.query.date === null || v.query.outputCalendar === null)) || (v.query.kind === "CAPABILITY" && v.query.topic === null)) && !v.uncertainties.some(u => u.field === (v.query?.kind === "CAPABILITY" ? "intent" : "queryRange"))) fail("Unresolved query requires targeted uncertainty");
  if (v.uncertainties.some(u => u.field === "operation" && u.reason === "UNSUPPORTED_COMBINATION") && (v.intent !== "AMBIGUOUS" || v.changes.length > 0 || !v.controlEvidence.some(e => e.kind === "USER_QUOTE"))) fail("Combined actions must be ambiguous and grounded without executable changes");
});
export type LegacyV2SemanticPatchProposal = z.infer<typeof LegacyV2SemanticPatchProposalSchema>;
export const ConversationDirectiveSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("ASK_FOR_FIELD"), field: IssueFieldSchema }),
  z.strictObject({ kind: z.literal("ASK_FOR_DISAMBIGUATION"), field: IssueFieldSchema, reason: z.enum(["AMBIGUOUS", "CONFLICT", "UNSUPPORTED_COMBINATION"]) }),
  z.strictObject({ kind: z.literal("EXPLAIN_UNSUPPORTED"), issue: z.enum(["CAPABILITY", "REQUEST_COMBINATION", "DOMAIN_LIMIT", "ASSISTANT_SCOPE"]) }),
  z.strictObject({ kind: z.literal("HELP"), topic: z.enum(["GENERAL", "REMINDERS", "LUNAR", "FINITE_SERIES"]) }),
  z.strictObject({ kind: z.literal("PRESENT_PREVIEW") }),
  z.strictObject({ kind: z.literal("ANSWER_QUERY"), queryKind: z.enum(["LIST", "CALENDAR_DATE", "CAPABILITY"]) }),
]);
export type ConversationDirective = z.infer<typeof ConversationDirectiveSchema>;
export const ReplyProposalSchema = z.strictObject({ text: nfcText(400) }).nullable();
export type ReplyProposal = z.infer<typeof ReplyProposalSchema>;
export const LegacyV2ConversationInterpretationSchema = LegacyV2SemanticPatchProposalSchema.safeExtend({ conversationDirective: ConversationDirectiveSchema, replyProposal: ReplyProposalSchema });
export type LegacyV2ConversationInterpretation = z.infer<typeof LegacyV2ConversationInterpretationSchema>;
export type LegacyV2ParsedInterpretation = {
  semantic: LegacyV2SemanticPatchProposal;
  directive: { status: "VALID"; value: ConversationDirective } | { status: "INVALID" };
  reply: { status: "VALID"; value: ReplyProposal } | { status: "INVALID"; reason: "REPLY_INVALID" | "REPLY_TOO_LONG" };
  fullSchemaValid: boolean;
};
export type LegacyV2InterpretationSections = { status: "REFUSED"; reason: "ENVELOPE_INVALID" | "SEMANTIC_PATCH_INVALID" } | { status: "PARSED"; value: LegacyV2ParsedInterpretation };
/** Accept a fully decoded JSON object only. The transport still owns raw-body
 * byte/finish-reason checks. Quarantine exactly the two guidance properties. */
export function LegacyV2parseInterpretationSections(raw: unknown, observeInvalid?: (value: CanonicalValidationDiagnostics) => void): LegacyV2InterpretationSections {
  const full = LegacyV2ConversationInterpretationSchema.safeParse(raw);
  if (!full.success) observeInvalid?.(projectCanonicalValidation(raw, full.error.issues));
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { status: "REFUSED", reason: "ENVELOPE_INVALID" };
  const { conversationDirective, replyProposal, ...core } = raw as Record<string, unknown>;
  const semantic = LegacyV2SemanticPatchProposalSchema.safeParse(core);
  if (!semantic.success) return { status: "REFUSED", reason: "SEMANTIC_PATCH_INVALID" };
  const directive = ConversationDirectiveSchema.safeParse(conversationDirective);
  const reply = ReplyProposalSchema.safeParse(replyProposal);
  const text = replyProposal && typeof replyProposal === "object" && "text" in replyProposal ? replyProposal.text : null;
  return { status: "PARSED", value: {
    semantic: semantic.data,
    directive: directive.success ? { status: "VALID", value: directive.data } : { status: "INVALID" },
    reply: reply.success ? { status: "VALID", value: reply.data } : { status: "INVALID", reason: typeof text === "string" && [...text].length > 400 ? "REPLY_TOO_LONG" : "REPLY_INVALID" },
    fullSchemaValid: full.success,
  } };
}
const factAlias = z.string().regex(/^f[1-9][0-9]*$/u).max(16);
const provenance = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("EXPLICIT_USER") }),
  z.strictObject({ kind: z.literal("DERIVED_POLICY"), policyVersion: nfcText(128), dependencies: z.array(factAlias).max(13), referenceTime: z.iso.datetime() }),
]);
/** Same field/scope discriminants in semantic input and encrypted state. Extra
 * metadata belongs only to the internal instance; it never enters the wire. */
export function contextFactSchema<M extends z.ZodRawShape>(metadata: M) {
  const common = { alias: factAlias, provenance, sourceReferenceTime: z.iso.datetime(), dependencies: z.array(factAlias).max(13), ...metadata };
  const reminder = <K extends keyof typeof values>(field: K) => z.strictObject({ ...common, scope: z.literal("REMINDER"), field: z.literal(field), value: values[field] });
  return z.union([
    reminder("title"), reminder("location"), reminder("notes"), reminder("eventDate"), reminder("eventTime"), reminder("reminderDate"), reminder("reminderTime"), reminder("calendar"), reminder("frequency"), reminder("occurrenceCount"), reminder("eventRelation"), reminder("leadOffsetDays"), reminder("endDate"),
    z.strictObject({ ...common, scope: z.literal("QUERY"), field: z.literal("queryRange"), value: QueryOperandSchema }),
  ]);
}
const slot = <T extends z.ZodType>(value: T) => z.strictObject({ state: z.enum(["MISSING", "PROPOSED", "RESOLVED", "CONFLICT"]), value: value.nullable(), fact: factAlias.nullable() }).refine(s => {
  const v = "value" in s ? s.value : undefined;
  return s.state === "MISSING" ? v === null && s.fact === null : s.state !== "RESOLVED" || (v !== null && s.fact !== null);
}, "Slot state/value/fact mismatch");
export const LegacyV2ContextInputSchema = z.strictObject({
  schemaVersion: z.literal("calenote-context-input-1"),
  reference: z.strictObject({ instant: z.iso.datetime(), localDate: z.iso.date(), timezone: z.literal("Asia/Ho_Chi_Minh") }),
  turns: z.array(z.strictObject({ role: z.enum(["USER", "ASSISTANT"]), text: z.string().refine(s => s.isWellFormed() && s === s.normalize("NFC"), "NFC scalar semantic view required") })).min(1).max(12), currentTurn: z.number().int().min(0).max(11),
  activeRequest: z.strictObject({ lifecycle: z.enum(["CLARIFYING", "AWAITING_CONFIRMATION"]), slots: z.strictObject({
    title: slot(values.title), location: slot(values.location), notes: slot(values.notes), eventDate: slot(values.eventDate), eventTime: slot(values.eventTime), reminderDate: slot(values.reminderDate), reminderTime: slot(values.reminderTime), calendar: slot(values.calendar), frequency: slot(values.frequency), occurrenceCount: slot(values.occurrenceCount), eventRelation: slot(values.eventRelation), leadOffsetDays: slot(values.leadOffsetDays), endDate: slot(values.endDate),
  }) }).nullable(),
  facts: z.array(contextFactSchema({})).max(26),
  pendingQuestion: z.strictObject({ text: nfcText(2000), scope: z.enum(["REMINDER", "QUERY"]), field: IssueFieldSchema, decisionKind: z.enum(["SAVE_PREVIEW", "REPLACE_PENDING", "ACCEPT_ONE_TIME_ALTERNATIVE", "RESUME_PENDING", "RESTART_PENDING"]).nullable(), reason }).nullable(),
  ambiguities: z.array(LegacyV2UncertaintySchema).max(4),
  capabilities: z.strictObject({ version: nfcText(128), supported: z.array(z.enum(["ONCE", "FINITE_DAILY", "LIST", "CALENDAR_DATE", "CAPABILITY"])).max(5), unsupported: z.array(z.enum(["WEEKLY", "MONTHLY", "YEARLY", "HOUR_OFFSET"])).max(4), calendars: z.array(CalendarSchema).max(2), limits: z.strictObject({ dailyCount: z.literal(30), horizonDays: z.literal(366) }) }),
}).superRefine((v, ctx) => {
  if (v.turns[v.currentTurn]?.role !== "USER" || v.currentTurn !== v.turns.length - 1 || v.turns.filter(t => t.role === "USER").length > 6 || v.turns.filter(t => t.role === "ASSISTANT").length > 6) ctx.addIssue({ code: "custom", message: "Invalid current turn or role bounds" });
  if (new Set(v.facts.map(f => f.alias)).size !== v.facts.length) ctx.addIssue({ code: "custom", message: "Duplicate fact alias" });
});
export type LegacyV2ContextInput = z.infer<typeof LegacyV2ContextInputSchema>;
// Reused definitions retain every branch. Semantic refinements are local gates,
// not proof that a provider enforces them or supports this entire schema dialect.
export const LegacyV2InterpretationJsonSchema = z.toJSONSchema(LegacyV2ConversationInterpretationSchema, { target: "draft-07", reused: "ref" });

/** Authority-consolidated successor. Kept dormant alongside context-2 until A5. */
export const RequestTargetV3Schema = z.strictObject({ kind: z.enum(["CURRENT", "NEW", "UNRESOLVED"]), evidence });
export type RequestTargetV3 = z.infer<typeof RequestTargetV3Schema>;
export type FieldOperationV3 = "SET" | "REPLACE" | "CLEAR";
function changeBranchV3<K extends keyof typeof values>(field: K) {
  return z.strictObject({ field: z.literal(field), operation: z.enum(["SET", "REPLACE"]), value: values[field], evidence });
}
export const FieldChangeV3Schema = z.union([
  changeBranchV3("title"), changeBranchV3("location"), changeBranchV3("notes"), changeBranchV3("eventDate"), changeBranchV3("eventTime"), changeBranchV3("reminderDate"), changeBranchV3("reminderTime"), changeBranchV3("calendar"), changeBranchV3("frequency"), changeBranchV3("occurrenceCount"), changeBranchV3("eventRelation"), changeBranchV3("leadOffsetDays"), changeBranchV3("endDate"),
  z.strictObject({ field: SlotNameSchema, operation: z.literal("CLEAR"), value: z.null(), evidence }),
]);
export type FieldChangeV3 = z.infer<typeof FieldChangeV3Schema>;
export const UncertaintyV3Schema = z.union([
  slotUncertainty("title"), slotUncertainty("location"), slotUncertainty("notes"), slotUncertainty("eventDate"), slotUncertainty("eventTime"), slotUncertainty("reminderDate"), slotUncertainty("reminderTime"), slotUncertainty("calendar"), slotUncertainty("frequency"), slotUncertainty("occurrenceCount"), slotUncertainty("eventRelation"), slotUncertainty("leadOffsetDays"), slotUncertainty("endDate"),
  z.strictObject({ field: z.literal("intent"), reason, alternatives: z.array(alternative(IntentSchema)).max(2) }),
  z.strictObject({ field: z.literal("queryRange"), reason, alternatives: z.array(alternative(QueryPeriodSchema)).max(2) }),
  z.strictObject({ field: z.literal("operation"), reason, alternatives: z.array(alternative(z.enum(["CURRENT", "NEW"]))).max(2) }),
]);
export type UncertaintyV3 = z.infer<typeof UncertaintyV3Schema>;
export const SemanticPatchProposalV3Schema = z.strictObject({
  schemaVersion: z.literal("calenote-context-3"), intent: IntentSchema, requestTarget: RequestTargetV3Schema.nullable(),
  changes: z.array(FieldChangeV3Schema).max(13), query: QueryOperandSchema.nullable(), uncertainties: z.array(UncertaintyV3Schema).max(4),
}).superRefine((v, ctx) => {
  const fail = (message: string) => ctx.addIssue({ code: "custom", message });
  const hasUser = (refs: EvidenceRef[]) => refs.some(ref => ref.kind === "USER_QUOTE");
  if (new Set(v.changes.map(c => c.field)).size !== v.changes.length) fail("Duplicate field rejects whole patch");
  const queryKinds: Record<string, string> = { LIST_REMINDERS: "LIST", CALENDAR_QUERY: "CALENDAR_DATE", CAPABILITY_QUERY: "CAPABILITY" };
  const queryKind = queryKinds[v.intent];
  if (queryKind ? v.query?.kind !== queryKind || v.changes.length !== 0 : v.query !== null) fail("Query/intent ownership mismatch");
  if (["HELP", "UNSUPPORTED"].includes(v.intent) && v.changes.length) fail("Non-mutating proposal cannot carry changes");
  const targeted = v.uncertainties.some(u => u.field === "operation");
  if (v.intent === "CREATE_REMINDER" ? v.requestTarget === null : v.requestTarget !== null && (v.intent !== "AMBIGUOUS" || !targeted)) fail("Request target/intent ownership mismatch");
  if (v.requestTarget && !v.requestTarget.evidence.every(ref => ref.kind === "USER_QUOTE")) fail("Request targeting requires current user evidence");
  if (v.changes.some(c => c.operation !== "SET" && !hasUser(c.evidence))) fail("REPLACE/CLEAR requires user evidence");
  if (v.uncertainties.some(u => u.field === "operation" && u.alternatives.some(a => !hasUser(a.evidence)))) fail("Operation alternatives require user evidence");
  if (v.query && ((v.query.kind === "LIST" && (v.query.period === null || (v.query.period.kind === "DAY" && v.query.period.date === null) || (v.query.period.kind === "DATE_BOUNDS" && (v.query.period.from === null || v.query.period.through === null)))) || (v.query.kind === "CALENDAR_DATE" && (v.query.date === null || v.query.outputCalendar === null)) || (v.query.kind === "CAPABILITY" && v.query.topic === null)) && !v.uncertainties.some(u => u.field === (v.query?.kind === "CAPABILITY" ? "intent" : "queryRange"))) fail("Unresolved query requires targeted uncertainty");
  if (v.uncertainties.some(u => u.field === "operation" && u.reason === "UNSUPPORTED_COMBINATION") && (v.intent !== "AMBIGUOUS" || v.changes.length > 0 || v.requestTarget?.kind !== "UNRESOLVED")) fail("Combined actions must be ambiguous and grounded without executable changes");
});
export type SemanticPatchProposalV3 = z.infer<typeof SemanticPatchProposalV3Schema>;
// Null is explicit absence of advice, not an inferred model directive.
export const ModelDirectiveV3Schema = z.discriminatedUnion("kind", [ConversationDirectiveSchema.options[0], ConversationDirectiveSchema.options[1], ConversationDirectiveSchema.options[2], ConversationDirectiveSchema.options[3]]).nullable();
export type ModelDirectiveV3 = z.infer<typeof ModelDirectiveV3Schema>;
export const ConversationInterpretationV3Schema = SemanticPatchProposalV3Schema.safeExtend({ conversationDirective: ModelDirectiveV3Schema, replyProposal: ReplyProposalSchema });
export type ConversationInterpretationV3 = z.infer<typeof ConversationInterpretationV3Schema>;
export type ParsedInterpretationV3 = {
  semantic: SemanticPatchProposalV3;
  directive: { status: "VALID"; value: ModelDirectiveV3 } | { status: "INVALID" };
  reply: LegacyV2ParsedInterpretation["reply"];
  fullSchemaValid: boolean;
};
export type InterpretationSectionsV3 = { status: "REFUSED"; reason: "ENVELOPE_INVALID" | "SEMANTIC_PATCH_INVALID" } | { status: "PARSED"; value: ParsedInterpretationV3 };
export function parseInterpretationSectionsV3(raw: unknown, observeInvalid?: (value: CanonicalValidationDiagnostics) => void): InterpretationSectionsV3 {
  const full = ConversationInterpretationV3Schema.safeParse(raw);
  if (!full.success) observeInvalid?.(projectCanonicalValidation(raw, full.error.issues, "calenote-context-3"));
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { status: "REFUSED", reason: "ENVELOPE_INVALID" };
  const { conversationDirective, replyProposal, ...core } = raw as Record<string, unknown>;
  const semantic = SemanticPatchProposalV3Schema.safeParse(core);
  if (!semantic.success) return { status: "REFUSED", reason: "SEMANTIC_PATCH_INVALID" };
  const directive = ModelDirectiveV3Schema.safeParse(conversationDirective), reply = ReplyProposalSchema.safeParse(replyProposal);
  const text = replyProposal && typeof replyProposal === "object" && "text" in replyProposal ? replyProposal.text : null;
  return { status: "PARSED", value: { semantic: semantic.data,
    directive: directive.success ? { status: "VALID", value: directive.data } : { status: "INVALID" },
    reply: reply.success ? { status: "VALID", value: reply.data } : { status: "INVALID", reason: typeof text === "string" && [...text].length > 400 ? "REPLY_TOO_LONG" : "REPLY_INVALID" },
    fullSchemaValid: full.success,
  } };
}
export const ContextInputV2Schema = z.strictObject({ ...LegacyV2ContextInputSchema.shape, schemaVersion: z.literal("calenote-context-input-2"), ambiguities: z.array(UncertaintyV3Schema).max(4) }).superRefine((v, ctx) => {
  if (v.turns[v.currentTurn]?.role !== "USER" || v.currentTurn !== v.turns.length - 1 || v.turns.filter(t => t.role === "USER").length > 6 || v.turns.filter(t => t.role === "ASSISTANT").length > 6) ctx.addIssue({ code: "custom", message: "Invalid current turn or role bounds" });
  if (new Set(v.facts.map(f => f.alias)).size !== v.facts.length) ctx.addIssue({ code: "custom", message: "Duplicate fact alias" });
});
export type ContextInputV2 = z.infer<typeof ContextInputV2Schema>;
export const InterpretationJsonSchemaV3 = z.toJSONSchema(ConversationInterpretationV3Schema, { target: "draft-07", reused: "ref" });

// Application-selected successor aliases. LegacyV2 exports are isolated reference codecs.
export const FieldChangeSchema = FieldChangeV3Schema;
export type FieldChange = FieldChangeV3;
export const UncertaintySchema = UncertaintyV3Schema;
export const SemanticPatchProposalSchema = SemanticPatchProposalV3Schema;
export type SemanticPatchProposal = SemanticPatchProposalV3;
export const ConversationInterpretationSchema = ConversationInterpretationV3Schema;
export type ConversationInterpretation = ConversationInterpretationV3;
export type ParsedInterpretation = ParsedInterpretationV3;
export type InterpretationSections = InterpretationSectionsV3;
export const ContextInputSchema = ContextInputV2Schema;
export type ContextInput = ContextInputV2;
export const InterpretationJsonSchema = InterpretationJsonSchemaV3;
export const parseInterpretationSections = parseInterpretationSectionsV3;

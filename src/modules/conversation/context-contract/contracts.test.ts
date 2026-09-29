import { describe, expect, expectTypeOf, it } from "vitest";
import { ContextInputSchema, ConversationInterpretationSchema, FieldChangeSchema, InterpretationJsonSchema, SLOT_NAMES, UncertaintySchema, parseInterpretationSections, type FieldChange } from "./contracts";

const ref = { kind: "USER_QUOTE", turn: 0, quote: "ngày mai", occurrence: 1 };
const proposal = { schemaVersion: "calenote-context-2", intent: "CREATE_REMINDER", dialogueAct: "NEW_REQUEST", continuation: "NO", changes: [], query: null, uncertainties: [], controlEvidence: [], conversationDirective: { kind: "ASK_FOR_FIELD", field: "reminderTime" }, replyProposal: null };
const values = { title: "thi", location: "trường", notes: "giấy tờ", eventDate: { kind: "RELATIVE_DAY", offsetDays: 1 }, eventTime: { hour: 8, minute: 0, qualifier: "H24" }, reminderDate: { kind: "CIVIL_DATE", calendar: "GREGORIAN", day: 1, month: 10, year: null, leapMonth: null }, reminderTime: { hour: 9, minute: 0, qualifier: "H24" }, calendar: "GREGORIAN", frequency: "DAILY", occurrenceCount: 2, eventRelation: "BEFORE_EVENT", leadOffsetDays: 2, endDate: { kind: "WEEKDAY", weekday: 1, qualifier: "NEXT_WEEK" } };
const set = (field: keyof typeof values) => ({ field, operation: "SET", value: values[field], evidence: [ref] });
const accepts = (overrides: object) => ConversationInterpretationSchema.safeParse({ ...proposal, ...overrides }).success;

const amended = { ...proposal, schemaVersion: "calenote-context-2", conversationDirective: { kind: "ASK_FOR_FIELD", field: "reminderTime" }, replyProposal: null };
describe("independent guidance sections", () => {
  it("guidance_fields_required_and_unknown_keys_rejected", () => {
    expect(ConversationInterpretationSchema.safeParse(amended).success).toBe(true);
    for (const key of ["conversationDirective", "replyProposal"]) {
      const value: Record<string, unknown> = { ...amended }; delete value[key];
      expect(ConversationInterpretationSchema.safeParse(value).success).toBe(false);
      expect(parseInterpretationSections(value)).toMatchObject({ status: "PARSED", value: { fullSchemaValid: false } });
    }
    expect(parseInterpretationSections({ ...amended, ownerId: "invented" }).status).toBe("REFUSED");
  });
  it("six_directives_have_no_authority", () => {
    for (const conversationDirective of [{ kind: "ASK_FOR_FIELD", field: "reminderTime" }, { kind: "ASK_FOR_DISAMBIGUATION", field: "frequency", reason: "AMBIGUOUS" }, { kind: "EXPLAIN_UNSUPPORTED", issue: "CAPABILITY" }, { kind: "HELP", topic: "GENERAL" }, { kind: "PRESENT_PREVIEW" }, { kind: "ANSWER_QUERY", queryKind: "LIST" }]) {
      expect(ConversationInterpretationSchema.safeParse({ ...amended, conversationDirective }).success).toBe(true);
      for (const extra of [{ confirmed: true }, { ownerId: "owner" }, { token: "CN-abc" }, { occurrences: [] }]) expect(ConversationInterpretationSchema.safeParse({ ...amended, conversationDirective: { ...conversationDirective, ...extra } }).success).toBe(false);
    }
    expect(ConversationInterpretationSchema.safeParse({ ...amended, conversationDirective: { kind: "CONFIRMED" } }).success).toBe(false);
  });
  it("reply_400_401_unicode_boundary", () => {
    for (const text of ["ế".repeat(400), "😀".repeat(400)]) expect(ConversationInterpretationSchema.safeParse({ ...amended, replyProposal: { text } }).success).toBe(true);
    for (const text of ["ế".repeat(401), "😀".repeat(401), " ", "e\u0301", "\ud800"]) expect(ConversationInterpretationSchema.safeParse({ ...amended, replyProposal: { text } }).success).toBe(false);
  });
  it("bad_guidance_preserves_valid_core_without_schema_score_laundering", () => {
    const raw = { ...amended, changes: [set("title")], conversationDirective: { kind: "SAVE" }, replyProposal: { text: "😀".repeat(401) } };
    const result = parseInterpretationSections(raw);
    expect(result).toMatchObject({ status: "PARSED", value: { fullSchemaValid: false, semantic: { changes: [set("title")] }, directive: { status: "INVALID" }, reply: { status: "INVALID", reason: "REPLY_TOO_LONG" } } });
    if (result.status === "PARSED") expect(Object.keys(result.value.semantic)).not.toContain("replyProposal");
  });
  it("invalid_core_not_rescued_by_guidance", () => {
    for (const raw of [{ ...amended, changes: [set("title"), set("title")] }, { ...amended, changes: [{ ...set("title"), ownerId: "bad" }] }, { ...amended, schemaVersion: "calenote-context-1" }, JSON.stringify(amended).slice(0, -1), null, []]) expect(parseInterpretationSections(raw).status).toBe("REFUSED");
  });
});

describe("strict successor proposals", () => {
  it("all_root_keys_required", () => {
    expect(accepts({})).toBe(true);
    for (const key of Object.keys(proposal)) { const copy: Record<string, unknown> = { ...proposal }; delete copy[key]; expect(ConversationInterpretationSchema.safeParse(copy).success, key).toBe(false); }
  });
  it("duplicate_changes_reject_atomically", () => expect(accepts({ changes: [set("title"), set("title")] })).toBe(false));
  it("omission_keeps_clear_requires_null", () => {
    expect(ConversationInterpretationSchema.parse(proposal).changes).toEqual([]);
    for (const field of SLOT_NAMES) {
      expect(FieldChangeSchema.safeParse(set(field)).success, field).toBe(true);
      expect(FieldChangeSchema.safeParse({ ...set(field), value: null }).success).toBe(false);
      expect(FieldChangeSchema.safeParse({ ...set(field), operation: "CLEAR", value: null }).success).toBe(true);
      expect(FieldChangeSchema.safeParse({ ...set(field), operation: "CLEAR" }).success).toBe(false);
    }
    expect(accepts({ changes: [{ field: "notes", operation: "CLEAR", value: null, evidence: [{ kind: "CONTEXT_FACT", ref: "f1" }] }] })).toBe(false);
  });
  it("typed_set_has_no_cross_field_value_widening", () => {
    type Title = Extract<FieldChange, { field: "title"; operation: "SET" }>;
    expectTypeOf<Title["value"]>().toEqualTypeOf<string>();
    expect(accepts({ changes: [{ ...set("title"), value: 2 }] })).toBe(false);
  });
  it("query_changes_forbidden", () => {
    for (const [intent, query] of [["LIST_REMINDERS", { kind: "LIST", period: { kind: "MONTH", offset: 0 }, statusScope: "DEFAULT", evidence: [ref] }], ["CALENDAR_QUERY", { kind: "CALENDAR_DATE", date: values.eventDate, outputCalendar: "LUNAR_VN", evidence: [ref] }], ["CAPABILITY_QUERY", { kind: "CAPABILITY", topic: "ANNUAL", evidence: [ref] }]]) {
      expect(accepts({ intent, query })).toBe(true);
      expect(accepts({ intent, query, changes: [set("notes")] })).toBe(false);
      expect(accepts({ query })).toBe(false);
    }
    for (const intent of ["HELP", "UNSUPPORTED"]) expect(accepts({ intent, changes: [set("title")] })).toBe(false);
    expect(accepts({ dialogueAct: "ABANDON_PENDING", changes: [set("title")] })).toBe(false);
  });
  it("unresolved_query_requires_the_targeted_uncertainty", () => {
    const query = { kind: "LIST", period: null, statusScope: "DEFAULT", evidence: [ref] };
    expect(accepts({ intent: "LIST_REMINDERS", query, uncertainties: [{ field: "title", reason: "MISSING", alternatives: [] }] })).toBe(false);
    expect(accepts({ intent: "LIST_REMINDERS", query, uncertainties: [{ field: "queryRange", reason: "MISSING", alternatives: [] }] })).toBe(true);
  });
  it("multiple_actions_cannot_execute_a_subset", () => {
    const uncertainties = [{ field: "operation", reason: "UNSUPPORTED_COMBINATION", alternatives: [] }];
    expect(accepts({ uncertainties, changes: [set("title")] })).toBe(false);
    expect(accepts({ intent: "AMBIGUOUS", dialogueAct: "AMBIGUOUS", uncertainties, controlEvidence: [ref] })).toBe(true);
  });
  it("civil_source_calendar_required", () => {
    const date = { ...values.reminderDate }; delete (date as Partial<typeof date>).calendar;
    expect(accepts({ changes: [{ ...set("reminderDate"), value: date }] })).toBe(false);
    expect(accepts({ changes: [{ ...set("reminderDate"), value: { ...values.reminderDate, leapMonth: false } }] })).toBe(false);
    expect(accepts({ changes: [{ ...set("reminderDate"), value: { ...values.reminderDate, calendar: "LUNAR_VN", leapMonth: false } }] })).toBe(true);
  });
  it("no_model_authority_fields", () => {
    for (const key of ["timezone", "epoch", "ownerId", "requestId", "confirmed", "actions", "summary", "reply", "sql"]) {
      expect(accepts({ [key]: "invented" }), key).toBe(false);
      expect(accepts({ changes: [{ ...set("notes"), [key]: "invented" }] }), key).toBe(false);
    }
    expect(accepts({ schemaVersion: "calenote-conversation-2" })).toBe(false);
  });
  it("preserves_unknown_unsupported_and_omitted_cadence_without_defaulting", () => {
    for (const value of ["UNKNOWN", "WEEKLY", "MONTHLY", "YEARLY"]) expect(ConversationInterpretationSchema.parse({ ...proposal, changes: [{ ...set("frequency"), value }] }).changes[0].value).toBe(value);
    expect(accepts({ changes: [{ ...set("frequency"), value: null }] })).toBe(false);
    expect(ConversationInterpretationSchema.parse(proposal).changes).toEqual([]);
  });
  it("bounded_changes_uncertainties_alternatives_and_evidence", () => {
    expect(accepts({ changes: SLOT_NAMES.map(set) })).toBe(true);
    expect(accepts({ changes: [...SLOT_NAMES.map(set), set("title")] })).toBe(false);
    for (const count of [0, 4]) expect(accepts({ changes: [{ ...set("title"), evidence: Array(count).fill(ref) }] })).toBe(false);
    const uncertainty = { field: "title", reason: "AMBIGUOUS", alternatives: [{ value: "thi", evidence: [ref] }] };
    expect(accepts({ uncertainties: Array(5).fill(uncertainty) })).toBe(false);
    expect(accepts({ uncertainties: [{ ...uncertainty, alternatives: Array(3).fill(uncertainty.alternatives[0]) }] })).toBe(false);
    expect(accepts({ uncertainties: [{ ...uncertainty, alternatives: [{ value: 1, evidence: [ref] }] }] })).toBe(false);
    expect(accepts({ controlEvidence: Array(4).fill(ref) })).toBe(false);
  });
  it("text_limits_use_nfc_scalars_not_utf16", () => {
    for (const [field, max] of [["title", 1800], ["location", 300], ["notes", 2000]] as const) {
      expect(accepts({ changes: [{ ...set(field), value: "😀".repeat(max) }] })).toBe(true);
      expect(accepts({ changes: [{ ...set(field), value: "ế".repeat(max + 1) }] })).toBe(false);
    }
    for (const quote of ["", "ế".repeat(2001), "e\u0301", "\ud800"]) expect(accepts({ changes: [{ ...set("notes"), evidence: [{ ...ref, quote }] }] })).toBe(false);
    for (const evidence of [{ ...ref, occurrence: 0 }, { ...ref, turn: 12 }, { ...ref, ownerId: "invented" }]) expect(accepts({ changes: [{ ...set("notes"), evidence: [evidence] }] })).toBe(false);
  });
  it("json_schema_every_object_is_closed_and_all_properties_required", () => {
    const visit = (value: unknown) => {
      if (!value || typeof value !== "object") return;
      if (Array.isArray(value)) { value.forEach(visit); return; }
      const node = value as Record<string, unknown>;
      if (node.type === "object") { expect(node.additionalProperties).toBe(false); expect(new Set(node.required as string[])).toEqual(new Set(Object.keys(node.properties as object))); }
      Object.values(node).forEach(visit);
    };
    visit(InterpretationJsonSchema);
  });
  it("input_slots_require_consistent_value_and_fact_state", () => {
    const input = { schemaVersion: "calenote-context-input-1", reference: { instant: "2026-09-28T03:00:00Z", localDate: "2026-09-28", timezone: "Asia/Ho_Chi_Minh" }, turns: [{ role: "USER", text: "9h" }], currentTurn: 0, activeRequest: { lifecycle: "CLARIFYING", slots: Object.fromEntries(SLOT_NAMES.map(field => [field, { state: "MISSING", value: null, fact: null }])) }, facts: [], pendingQuestion: null, ambiguities: [], capabilities: { version: "v1", supported: [], unsupported: [], calendars: [], limits: { dailyCount: 30, horizonDays: 366 } } };
    expect(ContextInputSchema.safeParse(input).success).toBe(true);
    input.activeRequest.slots.title = { state: "RESOLVED", value: null, fact: null };
    expect(ContextInputSchema.safeParse(input).success).toBe(false);
  });
  it("facts_and_alternatives_are_typed_by_field_and_scope", () => {
    const fact = { alias: "f1", scope: "REMINDER", field: "title", value: 2, provenance: { kind: "EXPLICIT_USER" }, sourceReferenceTime: "2026-09-28T03:00:00Z", dependencies: [] };
    expect(ContextInputSchema.shape.facts.safeParse([fact]).success).toBe(false);
    expect(ContextInputSchema.shape.facts.safeParse([{ ...fact, value: "thi" }]).success).toBe(true);
    expect(ContextInputSchema.shape.facts.safeParse([{ ...fact, scope: "QUERY", value: "thi" }]).success).toBe(false);
    type Alternative = Extract<ReturnType<typeof UncertaintySchema.parse>, { field: "title" }>["alternatives"][number]["value"];
    expectTypeOf<Alternative>().toEqualTypeOf<string>();
  });
});

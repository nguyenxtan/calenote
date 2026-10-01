// @vitest-environment node
import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { ContextInputSchema, ConversationInterpretationSchema, parseInterpretationSections } from "../../../conversation/context-contract/contracts";
import { createContextContractGateway, createContextHttpTransport, type SemanticJsonRequest } from "./semantic-gateway";
import { encodeGoogleLiteEuContext, googleLiteEuContextWireSchema, parseGoogleLiteEuContextSections } from "./context-provider-wire";

const config = { maxInputChars: 1800, maxInputTokens: 12000, maxOutputTokens: 1536, maxResponseBytes: 32768, timeoutMs: 30000,
  primary: { model: "google/gemini-2.5-flash-lite", provider: "google-vertex/eu", requireZdr: true, promptPriceMicrounitsPerMillionTokens: 100000, completionPriceMicrounitsPerMillionTokens: 400000 } };
const input = ContextInputSchema.parse({ schemaVersion: "calenote-context-input-1", reference: { instant: "2026-09-28T03:00:00.000Z", localDate: "2026-09-28", timezone: "Asia/Ho_Chi_Minh" }, turns: [{ role: "USER", text: "synthetic" }], currentTurn: 0, activeRequest: null, facts: [], pendingQuestion: null, ambiguities: [], capabilities: { version: "context-capabilities-1", supported: ["ONCE"], unsupported: ["YEARLY"], calendars: ["GREGORIAN"], limits: { dailyCount: 30, horizonDays: 366 } } });
const minimal = { schemaVersion: "calenote-context-2", intent: "HELP", dialogueAct: "GREET", continuation: "NO", changes: [], query: null, uncertainties: [], controlEvidence: [], conversationDirective: { kind: "HELP", topic: "GENERAL" }, replyProposal: null };
const quote = { kind: "USER_QUOTE", turn: 0, quote: "synthetic", occurrence: 1 };
const evidence = [quote, { kind: "CONTEXT_FACT", ref: "f1" }, quote];
const civil = { kind: "CIVIL_DATE", calendar: "GREGORIAN", day: 31, month: 12, year: 9999, leapMonth: null };
const clock = { hour: 23, minute: 59, qualifier: "H24" };
const values = { title: "t".repeat(1800), location: "l".repeat(300), notes: "n".repeat(2000), eventDate: civil, eventTime: clock, reminderDate: { kind: "RELATIVE_DAY", offsetDays: -366 }, reminderTime: clock, calendar: "LUNAR_VN", frequency: "DAILY", occurrenceCount: Number.MAX_SAFE_INTEGER, eventRelation: "BEFORE_EVENT", leadOffsetDays: Number.MAX_SAFE_INTEGER, endDate: { kind: "WEEKDAY", weekday: 7, qualifier: "NEXT_WEEK" } };
// Independent, hand-specified wire layout; never calls a production encoder.
const pads: Record<string, string[]> = { USER_QUOTE: ["ref"], CONTEXT_FACT: ["turn", "quote", "occurrence"], CIVIL_DATE: ["offsetDays", "weekday", "qualifier"], RELATIVE_DAY: ["calendar", "day", "month", "year", "leapMonth", "weekday", "qualifier"], WEEKDAY: ["calendar", "day", "month", "year", "leapMonth", "offsetDays"], DAY: ["offset", "from", "through"], WEEK: ["date", "from", "through"], MONTH: ["date", "from", "through"], WEEKEND: ["date", "from", "through"], UPCOMING: ["date", "offset", "from", "through"], DATE_BOUNDS: ["date", "offset"], LIST: ["date", "outputCalendar", "topic"], CALENDAR_DATE: ["period", "statusScope", "topic"], CAPABILITY: ["period", "statusScope", "date", "outputCalendar"], HELP: ["field", "reason", "issue", "queryKind"], ASK_FOR_FIELD: ["reason", "issue", "topic", "queryKind"], ASK_FOR_DISAMBIGUATION: ["issue", "topic", "queryKind"], EXPLAIN_UNSUPPORTED: ["field", "reason", "topic", "queryKind"], PRESENT_PREVIEW: ["field", "reason", "issue", "topic", "queryKind"], ANSWER_QUERY: ["field", "reason", "issue", "topic"] };
function wireFixture(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(wireFixture);
  if (!value || typeof value !== "object") return value;
  const object = value as Record<string, unknown>, result = Object.fromEntries(Object.entries(object).map(([key, child]) => [key, key === "uncertainties" && Array.isArray(child)
    ? child.map((item: { field: unknown; reason: unknown; alternatives: unknown[] }) => ({ field: item.field, reason: item.reason, alternatives: item.alternatives.map(alternative => JSON.stringify(alternative)) }))
    : wireFixture(child)]));
  if (Object.hasOwn(object, "schemaVersion")) delete result.schemaVersion;
  if (typeof object.kind === "string") for (const key of pads[object.kind] ?? []) result[key] = null;
  return result;
}
async function dispatch(payload: unknown, requests: SemanticJsonRequest[] = []) {
  const transport = createContextHttpTransport("SYNTHETIC_CREDENTIAL", async (_url, init) => {
    requests.push(JSON.parse(String(init.body)));
    return new Response(JSON.stringify({ model: "google/gemini-2.5-flash-lite", provider: "Google", id: "gen-wire-test", choices: [{ finish_reason: "stop", message: { content: JSON.stringify(payload) } }], usage: { cost: .001, prompt_tokens: 100, completion_tokens: 100 } }), { headers: { "content-type": "application/json" } });
  });
  const attempt = createContextContractGateway(config, transport, { status: "OBSERVABLE_CANARY", advertisedContextTokens: 1048576 }).prepare("PRIMARY", input);
  if (attempt.status !== "READY") throw new Error("Expected ready");
  const result = await attempt.dispatch();
  expect(await attempt.dispatch()).toMatchObject({ status: "FAILURE" });
  expect(requests).toHaveLength(1);
  return result;
}
it("emits the reviewed scalar-normalized schema through the actual HTTP boundary", async () => {
  const requests: SemanticJsonRequest[] = [];
  await dispatch(wireFixture(minimal), requests);
  expect(createHash("sha256").update(JSON.stringify(requests[0].response_format.json_schema.schema)).digest("hex")).toBe("5d23f1dae10bb34bf4bfd5e43cec5d5932afe5d4b97511eba2734ff6d8fc3df5");
  expect(requests[0].provider).toEqual({ only: ["google-vertex/eu"], allow_fallbacks: false, require_parameters: true, data_collection: "deny", zdr: true, max_price: { prompt: .1, completion: .4 } });
  expect(requests[0].stream).toBe(false);
});
it("reconstructs the exact minimal canonical fixture from required inactive null padding", async () => {
  expect(await dispatch(wireFixture(minimal))).toMatchObject({ status: "SUCCESS", interpretation: { fullSchemaValid: true, directive: { status: "VALID", value: minimal.conversationDirective } } });
});
it.each(Object.entries(values).flatMap(([field, value]) => ["SET", "CLEAR"].map(operation => ({ field, operation, value: operation === "SET" ? value : null, evidence }))))("preserves typed SET/CLEAR and evidence order for $field/$operation", async change => {
  const canonical = { ...minimal, intent: "CREATE_REMINDER", dialogueAct: "NEW_REQUEST", changes: [change] };
  expect(ConversationInterpretationSchema.safeParse(canonical).success).toBe(true);
  expect(await dispatch(wireFixture(canonical))).toMatchObject({ status: "SUCCESS", interpretation: { semantic: { changes: [change] }, fullSchemaValid: true } });
});
it("preserves full changes/uncertainties/evidence capacities and ordered alternatives", async () => {
  const changes = Object.entries(values).map(([field, value]) => ({ field, operation: "SET", value, evidence }));
  const uncertainties = Array.from({ length: 4 }, () => ({ field: "title", reason: "AMBIGUOUS", alternatives: [{ value: "first", evidence }, { value: "second", evidence: [...evidence].reverse() }] }));
  expect(await dispatch(wireFixture({ ...minimal, intent: "CREATE_REMINDER", dialogueAct: "NEW_REQUEST", changes, uncertainties, controlEvidence: evidence }))).toMatchObject({ status: "SUCCESS", interpretation: { semantic: { changes, uncertainties, controlEvidence: evidence }, fullSchemaValid: true } });
});
it.each(Object.entries({ ...values, intent: "HELP", operation: "NEW_REQUEST", queryRange: { kind: "DATE_BOUNDS", from: civil, through: civil } }))("preserves uncertainty field association for %s", async (field, value) => {
  const uncertainties = [{ field, reason: "AMBIGUOUS", alternatives: [{ value, evidence }, { value, evidence }] }];
  expect(await dispatch(wireFixture({ ...minimal, uncertainties }))).toMatchObject({ status: "SUCCESS", interpretation: { semantic: { uncertainties }, fullSchemaValid: true } });
});
it.each([
  ["LIST_REMINDERS", { kind: "LIST", period: { kind: "DATE_BOUNDS", from: civil, through: civil }, statusScope: "DEFAULT", evidence }],
  ["CALENDAR_QUERY", { kind: "CALENDAR_DATE", date: civil, outputCalendar: "LUNAR_VN", evidence }],
  ["CAPABILITY_QUERY", { kind: "CAPABILITY", topic: "LUNAR", evidence }],
])("reconstructs query ownership for %s", async (intent, query) => {
  expect(await dispatch(wireFixture({ ...minimal, intent, query }))).toMatchObject({ status: "SUCCESS", interpretation: { semantic: { intent, query }, fullSchemaValid: true } });
});
it("versioned encoder matches independent fixtures and reconstructs every typed canonical field", () => {
  const canonical = { ...minimal, intent: "CREATE_REMINDER", dialogueAct: "NEW_REQUEST", changes: Object.entries(values).map(([field, value]) => ({ field, operation: "SET", value, evidence })), controlEvidence: evidence };
  const before = JSON.stringify(canonical), encoded = encodeGoogleLiteEuContext(canonical);
  expect(encoded).toEqual(wireFixture(canonical));
  expect(parseGoogleLiteEuContextSections(encoded)).toEqual(parseInterpretationSections(canonical));
  expect(JSON.stringify(canonical)).toBe(before);
  for (const directive of [{ kind: "ASK_FOR_FIELD", field: "title" }, { kind: "ASK_FOR_DISAMBIGUATION", field: "title", reason: "AMBIGUOUS" }, { kind: "EXPLAIN_UNSUPPORTED", issue: "CAPABILITY" }, { kind: "HELP", topic: "GENERAL" }, { kind: "PRESENT_PREVIEW" }, { kind: "ANSWER_QUERY", queryKind: "LIST" }]) {
    const fixture = { ...minimal, conversationDirective: directive, replyProposal: { text: "x".repeat(400) } };
    expect(encodeGoogleLiteEuContext(fixture)).toEqual(wireFixture(fixture));
    expect(parseGoogleLiteEuContextSections(encodeGoogleLiteEuContext(fixture))).toEqual(parseInterpretationSections(fixture));
  }
  expect(() => encodeGoogleLiteEuContext({ ...canonical, changes: [...canonical.changes, canonical.changes[0]] })).toThrow("CONTEXT_PROVIDER_WIRE_INVALID");
  const schema = googleLiteEuContextWireSchema();
  expect(schema.version).toBe("google-gemini-2.5-flash-lite-vertex-eu-context-application-metadata-7");
  expect(createHash("sha256").update(JSON.stringify(schema.schema)).digest("hex")).toBe("5d23f1dae10bb34bf4bfd5e43cec5d5932afe5d4b97511eba2734ff6d8fc3df5");
  schema.schema.required = [];
  expect(googleLiteEuContextWireSchema().schema.required).not.toEqual([]);
});
it.each([
  ["numeric safe integer", { field: "occurrenceCount", operation: "SET", value: Number.MAX_SAFE_INTEGER + 1, evidence }],
  ["positive numeric minimum", { field: "leadOffsetDays", operation: "SET", value: 0, evidence }],
  ["Gregorian leap refinement", { field: "eventDate", operation: "SET", value: { ...civil, leapMonth: false }, evidence }],
  ["civil range", { field: "eventDate", operation: "SET", value: { ...civil, day: 32 }, evidence }],
  ["clock refinement", { field: "eventTime", operation: "SET", value: { hour: 0, minute: 0, qualifier: "AM" }, evidence }],
  ["non-NFC text", { field: "title", operation: "SET", value: "e\u0301", evidence }],
  ["blank text", { field: "title", operation: "SET", value: " ", evidence }],
  ["quote safe integer", { field: "title", operation: "SET", value: "synthetic", evidence: [{ ...quote, occurrence: Number.MAX_SAFE_INTEGER + 1 }] }],
  ["evidence string cap", { field: "title", operation: "SET", value: "synthetic", evidence: [{ ...quote, quote: "x".repeat(2001) }] }],
  ["fact reference pattern", { field: "title", operation: "SET", value: "synthetic", evidence: [{ kind: "CONTEXT_FACT", ref: "f0" }] }],
])("retains canonical omitted-bound/refinement authority: %s", async (_label, change) => {
  expect(await dispatch(wireFixture({ ...minimal, intent: "CREATE_REMINDER", dialogueAct: "NEW_REQUEST", changes: [change] }))).toMatchObject({ status: "FAILURE", category: "SCHEMA_INVALID" });
});
it.each([
  { ...minimal, uncertainties: Array.from({ length: 5 }, () => ({ field: "title", reason: "MISSING", alternatives: [] })) },
  { ...minimal, uncertainties: [{ field: "title", reason: "AMBIGUOUS", alternatives: Array.from({ length: 3 }, () => ({ value: "synthetic", evidence })) }] },
  { ...minimal, uncertainties: [{ field: "title", reason: "AMBIGUOUS", alternatives: [{ value: "synthetic", evidence }, { value: 2, evidence }] }] },
  { ...minimal, controlEvidence: [...evidence, quote] },
  { ...minimal, query: { kind: "CAPABILITY", topic: "LUNAR", evidence } },
])("rejects array caps, mixed field alternatives and query/intent mismatch %#", async canonical => {
  expect(await dispatch(wireFixture(canonical))).toMatchObject({ status: "FAILURE", category: "SCHEMA_INVALID" });
});
it("retains active nullable date values and rejects missing envelope/core keys", () => {
  const canonical = { ...minimal, intent: "CREATE_REMINDER", dialogueAct: "NEW_REQUEST", changes: [{ field: "eventDate", operation: "SET", value: { ...civil, year: null }, evidence }] };
  expect(parseGoogleLiteEuContextSections(encodeGoogleLiteEuContext(canonical))).toEqual(parseInterpretationSections(canonical));
  for (const raw of [null, [], "invalid", {}, { ...wireFixture(minimal) as object, extra: null }]) expect(parseGoogleLiteEuContextSections(raw).status).toBe("REFUSED");
});
it.each([
  ["unknown directive", (raw: Record<string, unknown>) => { raw.conversationDirective = { kind: "SAVE" }; }, { directive: { status: "INVALID" }, reply: { status: "VALID", value: null } }],
  ["missing directive padding", (raw: Record<string, unknown>) => { delete (raw.conversationDirective as Record<string, unknown>).field; }, { directive: { status: "INVALID" }, reply: { status: "VALID", value: null } }],
  ["overlong reply", (raw: Record<string, unknown>) => { raw.replyProposal = { text: "x".repeat(401) }; }, { directive: { status: "VALID" }, reply: { status: "INVALID", reason: "REPLY_TOO_LONG" } }],
  ["missing guidance", (raw: Record<string, unknown>) => { delete raw.conversationDirective; delete raw.replyProposal; }, { directive: { status: "INVALID" }, reply: { status: "INVALID", reason: "REPLY_INVALID" } }],
] as const)("quarantines %s independently without losing valid core", async (_label, mutate, expected) => {
  const raw = wireFixture(minimal) as Record<string, unknown>; mutate(raw);
  expect(await dispatch(raw)).toMatchObject({ status: "SUCCESS", interpretation: { ...expected, semantic: { changes: [] }, fullSchemaValid: false } });
});
it.each([
  ["wrong field value", (raw: Record<string, unknown>) => { (raw.changes as Array<Record<string, unknown>>)[0].value = 2; }],
  ["overlong title", (raw: Record<string, unknown>) => { (raw.changes as Array<Record<string, unknown>>)[0].value = "x".repeat(1801); }],
  ["empty evidence", (raw: Record<string, unknown>) => { (raw.changes as Array<Record<string, unknown>>)[0].evidence = []; }],
  ["four evidence", (raw: Record<string, unknown>) => { ((raw.changes as Array<Record<string, unknown>>)[0].evidence as unknown[]).push(wireFixture(quote)); }],
  ["duplicate field", (raw: Record<string, unknown>) => { (raw.changes as unknown[]).push(structuredClone((raw.changes as unknown[])[0])); }],
  ["unknown root", (raw: Record<string, unknown>) => { raw.extra = null; }],
  ["missing core", (raw: Record<string, unknown>) => { delete raw.intent; }],
] as const)("rejects invalid core atomically: %s", async (_label, mutate) => {
  const raw = wireFixture({ ...minimal, intent: "CREATE_REMINDER", dialogueAct: "NEW_REQUEST", changes: [{ field: "title", operation: "SET", value: "synthetic", evidence }] }) as Record<string, unknown>; mutate(raw);
  expect(await dispatch(raw)).toMatchObject({ status: "FAILURE", category: "SCHEMA_INVALID" });
});
it("discards inactive evidence and guidance at the HTTP boundary without changing semantic authority", async () => {
  const canonical = { ...minimal, intent: "CREATE_REMINDER", dialogueAct: "NEW_REQUEST", changes: [{ field: "title", operation: "SET", value: "synthetic", evidence }] };
  const raw = wireFixture(canonical) as Record<string, unknown>;
  (raw.conversationDirective as Record<string, unknown>).field = "title";
  (((raw.changes as Array<Record<string, unknown>>)[0].evidence as Array<Record<string, unknown>>)[0]).ref = "f999";
  expect(await dispatch(raw)).toMatchObject({ status: "SUCCESS", interpretation: { semantic: { changes: canonical.changes }, directive: { status: "VALID", value: minimal.conversationDirective }, fullSchemaValid: true } });
});

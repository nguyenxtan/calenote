// @vitest-environment node
import { expect, it } from "vitest";
import { z } from "zod";
import { LegacyV2ConversationInterpretationSchema as ConversationInterpretationSchema, ConversationDirectiveSchema, IssueFieldSchema, LegacyV2UncertaintySchema as UncertaintySchema, LegacyV2parseInterpretationSections as parseInterpretationSections } from "../../../conversation/context-contract/contracts";
import { UNCERTAINTY_FIELD_WIRE_CODE_V1, legacyV2EncodeGoogleLiteEuContext as encodeGoogleLiteEuContext, legacyV2GoogleLiteEuContextWireSchema as googleLiteEuContextWireSchema, legacyV2ParseGoogleLiteEuContextSections as parseGoogleLiteEuContextSections } from "./context-provider-wire";
import { ConversationInterpretationV3Schema, parseInterpretationSectionsV3 } from "../../../conversation/context-contract/contracts";
import { CONTEXT_PROTOCOL_V3 } from "../../../conversation/context-contract/protocol";
import { encodeGoogleLiteEuContextV3, googleLiteEuContextWireSchemaV3, parseGoogleLiteEuContextSectionsV3 } from "./context-provider-wire";
import { createContextContractGateway } from "./semantic-gateway";
import { buildContextInputV2 } from "../../../conversation/context-contract/context";
import { chat, message, observation } from "../../../conversation/context-contract/context-test-fixtures";
import { serializeContextRequest } from "../../../conversation/context-contract/wire";

it("null advice is full-valid through strict canonical, advertised wire and both selected gateway paths", async () => {
  const text = "nhắc đi thi", msg = message(text);
  const built = buildContextInputV2({ message: msg, context: chat, snapshot: null, observation: observation(null, msg) });
  if (built.status !== "READY") throw new Error(built.reason);
  const evidence = [{ kind: "USER_QUOTE", turn: built.input.currentTurn, quote: text, occurrence: 1 }];
  const raw = { schemaVersion: "calenote-context-3", intent: "CREATE_REMINDER", requestTarget: { kind: "NEW", evidence }, changes: [{ field: "title", operation: "SET", value: "đi thi", evidence }], query: null, uncertainties: [], conversationDirective: null, replyProposal: null };
  expect(ConversationInterpretationV3Schema.safeParse(raw).success, "explicit absent advice must satisfy the full contract").toBe(true);
  const encoded = encodeGoogleLiteEuContextV3(ConversationInterpretationV3Schema.parse(raw));
  expect(successorValidator.safeParse(encoded).success).toBe(true);
  expect(parseGoogleLiteEuContextSectionsV3(encoded, CONTEXT_PROTOCOL_V3)).toMatchObject({ status: "PARSED", value: { fullSchemaValid: true, directive: { status: "VALID", value: null }, reply: { status: "VALID", value: null } } });
  const config = { protocol: CONTEXT_PROTOCOL_V3, maxInputChars: 1800, maxInputTokens: 12000, maxOutputTokens: 1536, maxResponseBytes: 32768, timeoutMs: 30000,
    primary: { model: "google/gemini-2.5-flash-lite", provider: "google-vertex/eu", requireZdr: true, promptPriceMicrounitsPerMillionTokens: 100000, completionPriceMicrounitsPerMillionTokens: 400000 } };
  const response = { status: 200, body: JSON.stringify({ model: "google/gemini-2.5-flash-lite", provider: "Google", choices: [{ finish_reason: "stop", message: { content: JSON.stringify(encoded) } }], usage: { cost: .0004, prompt_tokens: 2200, completion_tokens: 500 } }) };
  const request = { model: config.primary.model, ...serializeContextRequest(built.input), provider: { only: [config.primary.provider], allow_fallbacks: false, require_parameters: true, data_collection: "deny", zdr: true, max_price: { prompt: 0.1, completion: 0.4 } } };
  const offline = createContextContractGateway(config, { kind: "OFFLINE_FIXTURE", exchanges: [{ requestJson: JSON.stringify(request), response, admission: { fullInputTokens: 2200, billableOverheadMicrounits: 0 } }] });
  const observable = createContextContractGateway(config, async () => response, { status: "OBSERVABLE_CANARY", advertisedContextTokens: 1048576 });
  for (const gateway of [offline, observable]) {
    const attempt = gateway.prepare("PRIMARY", built.input); expect(attempt.status).toBe("READY");
    if (attempt.status !== "READY") throw new Error(attempt.category);
    expect(await attempt.dispatch()).toMatchObject({ status: "SUCCESS", interpretation: { fullSchemaValid: true, directive: { status: "VALID", value: null }, semantic: { changes: [{ field: "title", operation: "SET", value: "đi thi" }] } } });
  }
  const wire = encoded as Record<string, unknown>;
  for (const advice of [undefined, { kind: "UNKNOWN" }, { kind: "HELP", topic: "GENERAL", extra: true }, { kind: "PRESENT_PREVIEW" }]) {
    const changed = { ...wire, conversationDirective: advice };
    if (advice === undefined) delete changed.conversationDirective;
    expect(parseGoogleLiteEuContextSectionsV3(changed, CONTEXT_PROTOCOL_V3)).toMatchObject({ status: "PARSED", value: { fullSchemaValid: false, directive: { status: "INVALID" }, reply: { status: "VALID", value: null } } });
  }
  expect(parseGoogleLiteEuContextSectionsV3({ ...wire, replyProposal: { text: "valid independent words", extra: true } }, CONTEXT_PROTOCOL_V3)).toMatchObject({ status: "PARSED", value: { fullSchemaValid: false, directive: { status: "VALID", value: null }, reply: { status: "INVALID" } } });
  expect(parseGoogleLiteEuContextSectionsV3({ ...wire, extra: true }, CONTEXT_PROTOCOL_V3).status).toBe("REFUSED");
});

// Validate the actual publicly emitted JSON Schema with an independent public
// JSON-Schema consumer, rather than reconstructing the producer's predicates.
const publicSchema = googleLiteEuContextWireSchema().schema;
// Zod's converter supports definition refs only. Resolve local pointers without
// altering any assertions so it can consume this provider's draft-7/$defs mix.
function inlineRefs(value: unknown, root: unknown = publicSchema): unknown {
  if (Array.isArray(value)) return value.map(child => inlineRefs(child, root));
  if (!value || typeof value !== "object") return value;
  const node = value as Record<string, unknown>;
  if (typeof node.$ref === "string") {
    if (Object.keys(node).length !== 1) throw new Error("Reference siblings need an independent validator proof");
    const target = decodeURIComponent(node.$ref).slice(2).split("/").reduce((current, key) => (current as Record<string, unknown>)[key.replaceAll("~1", "/").replaceAll("~0", "~")], root);
    return inlineRefs(target, root);
  }
  return Object.fromEntries(Object.entries(node).filter(([key]) => key !== "$defs").map(([key, child]) => [key, inlineRefs(child, root)]));
}
const successorSchema = googleLiteEuContextWireSchemaV3().schema;
const successorValidator = z.fromJSONSchema(inlineRefs(successorSchema, successorSchema) as Parameters<typeof z.fromJSONSchema>[0]);
const successorEvidence = [{ kind: "USER_QUOTE", turn: 0, quote: "synthetic", occurrence: 1 }];
it.each([1, 2, 3])("query evidence slots enforce and roundtrip %i canonical refs", count => {
  const refs = Array.from({ length: count }, (_, index) => ({ ...successorEvidence[0], occurrence: index + 1 }));
  const canonical = ConversationInterpretationV3Schema.parse({ schemaVersion: "calenote-context-3", intent: "LIST_REMINDERS", requestTarget: null, changes: [],
    query: { kind: "LIST", period: { kind: "UPCOMING" }, statusScope: "DEFAULT", evidence: refs }, uncertainties: [], conversationDirective: null, replyProposal: null });
  const wire = encodeGoogleLiteEuContextV3(canonical) as { query: { evidence: Record<string, unknown> } };
  expect(wire.query.evidence).toEqual({ primaryEvidence: { ...refs[0], ref: null }, secondaryEvidence: count >= 2 ? { ...refs[1], ref: null } : null, tertiaryEvidence: count === 3 ? { ...refs[2], ref: null } : null });
  expect(successorValidator.safeParse(wire).success).toBe(true);
  expect(parseGoogleLiteEuContextSectionsV3(wire, CONTEXT_PROTOCOL_V3)).toEqual(parseInterpretationSectionsV3(canonical));
  for (const invalid of [[], {}, { ...wire.query.evidence, primaryEvidence: null }, { secondaryEvidence: null, tertiaryEvidence: null }, { ...wire.query.evidence, fourthEvidence: wire.query.evidence.primaryEvidence }]) {
    const changed = { ...wire, query: { ...wire.query, evidence: invalid } };
    expect(successorValidator.safeParse(changed).success).toBe(false);
    expect(parseGoogleLiteEuContextSectionsV3(changed, CONTEXT_PROTOCOL_V3).status).toBe("REFUSED");
  }
});
const successorValues = { title: "title", location: "location", notes: "notes", eventDate: { kind: "CIVIL_DATE", calendar: "GREGORIAN", day: 1, month: 2, year: null, leapMonth: null }, eventTime: { hour: 8, minute: 0, qualifier: "H24" }, reminderDate: { kind: "RELATIVE_DAY", offsetDays: 1 }, reminderTime: { hour: 9, minute: 0, qualifier: "AM" }, calendar: "LUNAR_VN", frequency: "DAILY", occurrenceCount: 2, eventRelation: "BEFORE_EVENT", leadOffsetDays: 1, endDate: { kind: "WEEKDAY", weekday: 1, qualifier: "NEXT_WEEK" } };
it.each(Object.entries(successorValues).flatMap(([field, value]) => ["SET", "REPLACE", "CLEAR"].map(operation => ({ field, operation, value: operation === "CLEAR" ? null : value }))))("successor_wire_canonical_parity $field/$operation", change => {
  const canonical = ConversationInterpretationV3Schema.parse({ schemaVersion: "calenote-context-3", intent: "CREATE_REMINDER", requestTarget: { kind: "CURRENT", evidence: successorEvidence }, changes: [{ ...change, evidence: successorEvidence }], query: null, uncertainties: [], conversationDirective: { kind: "ASK_FOR_FIELD", field: "title" }, replyProposal: null });
  const encoded = encodeGoogleLiteEuContextV3(canonical);
  expect(successorValidator.safeParse(encoded).success).toBe(true);
  expect(parseGoogleLiteEuContextSectionsV3(encoded, CONTEXT_PROTOCOL_V3)).toEqual(parseInterpretationSectionsV3(canonical));
});
const validator = z.fromJSONSchema(inlineRefs(publicSchema) as Parameters<typeof z.fromJSONSchema>[0]);
it("standalone inactive null rejects every non-null JSON type", () => {
  const schema = inlineRefs(publicSchema) as { properties: { conversationDirective: { anyOf: Array<{ properties: Record<string, unknown> }> } } };
  const branch = schema.properties.conversationDirective.anyOf.find(item => JSON.stringify(item.properties.kind).includes('"HELP"'))!;
  const inactive = z.fromJSONSchema(branch.properties.field as Parameters<typeof z.fromJSONSchema>[0]);
  expect(inactive.safeParse(null).success).toBe(true);
  for (const value of [false, 0, "", [], {}]) expect(inactive.safeParse(value).success).toBe(false);
});
it("equivalent string payload definitions coalesce only their finite field discriminators", () => {
  const schema = inlineRefs(publicSchema) as { properties: { changes: { items: { anyOf: Array<{ properties: Record<string, { enum?: string[]; const?: string }> }> } } } };
  const branch = schema.properties.changes.items.anyOf.find(item => JSON.stringify(item.properties.field).includes('"title"') && JSON.stringify(item.properties.operation).includes('"SET"'))!;
  expect(branch.properties.field.enum).toEqual(expect.arrayContaining(["title", "location", "notes"]));
  expect(branch.properties.field.enum).not.toContain("eventDate");
});
const evidence = [{ kind: "USER_QUOTE", turn: 0, quote: "synthetic", occurrence: 1 }];
const base = { schemaVersion: "calenote-context-2", intent: "HELP", dialogueAct: "GREET", continuation: "NO", changes: [], query: null, uncertainties: [], controlEvidence: evidence, conversationDirective: { kind: "HELP", topic: "GENERAL" }, replyProposal: null };
const uncertaintyFields = UncertaintySchema.options.map(branch => branch.shape.field.value);
it.each(uncertaintyFields)("finite control uncertainty domain roundtrips %s", field => {
  const canonical = { ...base, uncertainties: [{ field, reason: "MISSING", alternatives: [] }] };
  expect(ConversationInterpretationSchema.safeParse(canonical).success).toBe(true);
  const wire = encodeGoogleLiteEuContext(canonical);
  expect(validator.safeParse(wire).success).toBe(true);
  expect(parseGoogleLiteEuContextSections(wire)).toEqual(parseInterpretationSections(canonical));
});
it("RED: uncertainty wire must not advertise unknown active field strings", () => {
  const wire = { ...encodeGoogleLiteEuContext(base) as object, uncertainties: [{ field: "not_a_canonical_field", reason: "MISSING", alternatives: [] }] };
  expect(validator.safeParse(wire).success).toBe(false);
  expect(parseGoogleLiteEuContextSections(wire).status).toBe("REFUSED");
});
it("exhaustively equals canonical and advertised uncertainty field domains", () => {
  const schema = inlineRefs(publicSchema) as { properties: { uncertainties: { items: { properties: { fieldCode: { type: string; minimum: number; maximum: number } } } } } };
  expect(schema.properties.uncertainties.items.properties.fieldCode).toMatchObject({ type: "integer", minimum: 0, maximum: 15 });
  expect(Object.keys(UNCERTAINTY_FIELD_WIRE_CODE_V1).sort()).toEqual(uncertaintyFields.slice().sort());
});
const controlDirectives = ConversationDirectiveSchema.options.flatMap(branch => {
  const shape = branch.shape;
  const combinations = Object.entries(shape).reduce<Record<string, unknown>[]>((rows, [key, schema]) => {
    const values: readonly unknown[] = "options" in schema ? schema.options : "value" in schema ? [schema.value] : [];
    return rows.flatMap(row => values.map(value => ({ ...row, [key]: value })));
  }, [{}]);
  return combinations;
});
it.each(controlDirectives)("control directive branch parity %#", conversationDirective => {
  expect(ConversationDirectiveSchema.safeParse(conversationDirective).success).toBe(true);
  const canonical = { ...base, conversationDirective };
  const wire = encodeGoogleLiteEuContext(canonical) as { conversationDirective: Record<string, unknown> };
  expect(validator.safeParse(wire).success).toBe(true);
  expect(parseGoogleLiteEuContextSections(wire)).toEqual(parseInterpretationSections(canonical));
  for (const key of Object.keys(conversationDirective)) {
    const invalid = structuredClone(wire);
    invalid.conversationDirective[key] = "not_a_control_enum";
    expect(validator.safeParse(invalid).success).toBe(false);
    const result = parseGoogleLiteEuContextSections(invalid);
    expect(result.status === "REFUSED" || !result.value.fullSchemaValid).toBe(true);
  }
});
it("active directive field rejection explains canonical invalid_union sentinel without domain drift", () => {
  const wire = encodeGoogleLiteEuContext({ ...base, conversationDirective: { kind: "ASK_FOR_FIELD", field: IssueFieldSchema.options[0] } }) as { conversationDirective: Record<string, unknown> };
  wire.conversationDirective.field = "not_a_control_enum";
  const canonicalIssues: unknown[] = [], wireIssues: unknown[] = [];
  expect(validator.safeParse(wire).success).toBe(false);
  const parsed = parseGoogleLiteEuContextSections(wire, d => canonicalIssues.push(d), d => wireIssues.push(d));
  expect(parsed.status === "PARSED" && parsed.value.directive.status === "INVALID" && !parsed.value.fullSchemaValid).toBe(true);
  expect(JSON.stringify(wireIssues)).toContain('"conversationDirective","field"');
  expect(JSON.stringify(canonicalIssues)).toContain('"conversationDirective","kind"');
});
const dates = [
  { kind: "CIVIL_DATE", calendar: "GREGORIAN", day: 1, month: 1, year: null, leapMonth: null },
  { kind: "RELATIVE_DAY", offsetDays: 0 },
  { kind: "WEEKDAY", weekday: 1, qualifier: "THIS_WEEK" },
];
const periods = [
  ...dates.map(date => ({ kind: "DAY", date })),
  ...["WEEK", "MONTH", "WEEKEND"].flatMap(kind => [-1, 0, 1].map(offset => ({ kind, offset }))),
  ...["REST_OF_MONTH", "NEXT_7_DAYS", "UPCOMING"].map(kind => ({ kind })),
  { kind: "DATE_BOUNDS", from: dates[0], through: dates[1] },
];
const values: Record<string, unknown> = { title: "synthetic", location: "synthetic", notes: "synthetic", eventDate: dates[0], eventTime: { hour: 10, minute: 0, qualifier: "H24" }, reminderDate: dates[1], reminderTime: { hour: 10, minute: 0, qualifier: "H24" }, calendar: "GREGORIAN", frequency: "ONCE", occurrenceCount: 1, eventRelation: "BEFORE_EVENT", leadOffsetDays: 1, endDate: dates[2] };
const uncertaintyValues = { ...values, intent: "HELP", queryRange: periods[0], operation: "NEW_REQUEST" };
it("freezes the measured uncertainty schema-complexity boundary without claiming Google's private state count", () => {
  // Version 9 uses a bounded integer code and compact V1 guide, not nested alternatives.
  expect(Buffer.byteLength(JSON.stringify(publicSchema))).toBeLessThanOrEqual(12057);
  const shape = z.object({ properties: z.object({ uncertainties: z.object({ items: z.record(z.string(), z.unknown()) }) }) }).parse(publicSchema);
  expect(Object.keys(shape.properties.uncertainties.items).sort()).toEqual(["additionalProperties", "properties", "required", "type"]);
  expect(shape.properties.uncertainties.items).toMatchObject({
    properties: { fieldCode: { type: "integer", minimum: 0, maximum: 15 }, alternatives: { type: "array", items: { type: "string" } } },
    required: ["fieldCode", "reason", "alternatives"], additionalProperties: false,
  });
});
it.each([
  null, [], 7, "sensitive synthetic value",
  { evidence }, { value: "synthetic" },
  { value: "synthetic", evidence: [{ kind: "USER_QUOTE", turn: 0, quote: "sensitive synthetic value", occurrence: 1, extra: true }] },
  { value: "synthetic", evidence: [{ kind: "CONTEXT_FACT", ref: 7 }] },
  { value: { kind: "UNRECOGNIZED" }, evidence },
])("rejects decoded invalid alternative #%#", alternative => {
  const wire = { ...encodeGoogleLiteEuContext(base) as object, uncertainties: [{ fieldCode: 0, reason: "AMBIGUOUS", alternatives: [JSON.stringify(alternative)] }] };
  expect(validator.safeParse(wire).success).toBe(true);
  const diagnostics: unknown[] = [];
  expect(parseGoogleLiteEuContextSections(wire, issue => diagnostics.push(issue)).status).toBe("REFUSED");
  expect(JSON.stringify(diagnostics)).not.toContain("sensitive synthetic value");
});
it.each([
  { fieldCode: 16, reason: "AMBIGUOUS", alternatives: [] },
  { fieldCode: 0, reason: "unknown", alternatives: [] },
  { fieldCode: 0, reason: "AMBIGUOUS", alternatives: [null] },
  { fieldCode: 0, reason: "AMBIGUOUS", alternatives: Array(3).fill(JSON.stringify({ value: "synthetic", evidence })) },
  { fieldCode: 0, reason: "AMBIGUOUS", alternatives: [], extra: true },
  { fieldCode: 0, reason: "AMBIGUOUS" },
])("rejects invalid uncertainty envelope #%#", item => {
  expect(parseGoogleLiteEuContextSections({ ...encodeGoogleLiteEuContext(base) as object, uncertainties: [item] }).status).toBe("REFUSED");
});
it("rejects an oversized uncertainty array before parsing alternatives", () => {
  const item = { fieldCode: 0, reason: "MISSING", alternatives: [] };
  expect(parseGoogleLiteEuContextSections({ ...encodeGoogleLiteEuContext(base) as object, uncertainties: Array(5).fill(item) }).status).toBe("REFUSED");
});
it.each([...dates, ...periods])("preserves typed date/query alternatives without inactive padding %#", value => {
  const field = periods.includes(value as typeof periods[number]) ? "queryRange" : "eventDate";
  const canonical = { ...base, uncertainties: [{ field, reason: "AMBIGUOUS", alternatives: [{ value, evidence: [{ kind: "CONTEXT_FACT", ref: "f1" }] }] }] };
  const wire = encodeGoogleLiteEuContext(canonical);
  expect(validator.safeParse(wire).success).toBe(true);
  expect(parseGoogleLiteEuContextSections(wire)).toEqual(parseInterpretationSections(canonical));
});
it.each(Object.entries(uncertaintyValues))("uncertainty wire preserves canonical JSON alternatives for %s", (field, value) => {
  const canonical = { ...base, uncertainties: [{ field, reason: "AMBIGUOUS", alternatives: [{ value, evidence }] }] };
  const wire = encodeGoogleLiteEuContext(canonical) as { uncertainties: Array<{ fieldCode: number; reason: string; alternatives: unknown[] }> };
  expect(wire.uncertainties).toEqual([{ fieldCode: UNCERTAINTY_FIELD_WIRE_CODE_V1[field as keyof typeof UNCERTAINTY_FIELD_WIRE_CODE_V1], reason: "AMBIGUOUS", alternatives: [JSON.stringify({ value, evidence })] }]);
  expect(parseGoogleLiteEuContextSections(wire)).toEqual(parseInterpretationSections(canonical));
});
it("emitted uncertainty shape avoids nested typed alternatives while canonical validation rejects invalid combinations", () => {
  const schema = inlineRefs(publicSchema) as { properties: { uncertainties: { items: unknown } } };
  expect(schema.properties.uncertainties.items).toMatchObject({ type: "object", properties: { fieldCode: { type: "integer", minimum: 0, maximum: 15 }, alternatives: { type: "array", items: { type: "string" } } } });
  for (const alternative of ["not JSON", JSON.stringify({ value: 12, evidence }), JSON.stringify({ value: "synthetic", evidence: [] }), JSON.stringify({ value: "synthetic", evidence, unexpected: true }), "x".repeat(32769)]) {
    const wire = { ...encodeGoogleLiteEuContext(base) as object, uncertainties: [{ fieldCode: 0, reason: "AMBIGUOUS", alternatives: [alternative] }] };
    expect(parseGoogleLiteEuContextSections(wire).status).toBe("REFUSED");
  }
});
const directives = [ { kind: "ASK_FOR_FIELD", field: "title" }, { kind: "ASK_FOR_DISAMBIGUATION", field: "title", reason: "AMBIGUOUS" }, { kind: "EXPLAIN_UNSUPPORTED", issue: "CAPABILITY" }, { kind: "HELP", topic: "GENERAL" }, { kind: "PRESENT_PREVIEW" }, { kind: "ANSWER_QUERY", queryKind: "LIST" } ];
const pads: Record<string, string[]> = {
  USER_QUOTE: ["ref"], CONTEXT_FACT: ["turn", "quote", "occurrence"],
  CIVIL_DATE: ["offsetDays", "weekday", "qualifier"], RELATIVE_DAY: ["calendar", "day", "month", "year", "leapMonth", "weekday", "qualifier"], WEEKDAY: ["calendar", "day", "month", "year", "leapMonth", "offsetDays"],
  DAY: ["offset", "from", "through"], WEEK: ["date", "from", "through"], MONTH: ["date", "from", "through"], WEEKEND: ["date", "from", "through"], REST_OF_MONTH: ["date", "offset", "from", "through"], NEXT_7_DAYS: ["date", "offset", "from", "through"], UPCOMING: ["date", "offset", "from", "through"], DATE_BOUNDS: ["date", "offset"],
  LIST: ["date", "outputCalendar", "topic"], CALENDAR_DATE: ["period", "statusScope", "topic"], CAPABILITY: ["period", "statusScope", "date", "outputCalendar"],
  ASK_FOR_FIELD: ["reason", "issue", "topic", "queryKind"], ASK_FOR_DISAMBIGUATION: ["issue", "topic", "queryKind"], EXPLAIN_UNSUPPORTED: ["field", "reason", "topic", "queryKind"], HELP: ["field", "reason", "issue", "queryKind"], PRESENT_PREVIEW: ["field", "reason", "issue", "topic", "queryKind"], ANSWER_QUERY: ["field", "reason", "issue", "topic"],
};
const fixtures = [
  { name: "minimal", canonical: base },
  ...Object.entries(values).flatMap(([field, value]) => ["SET", "CLEAR"].map(operation => ({ name: `change/${field}/${operation}`, canonical: { ...base, intent: "CREATE_REMINDER", dialogueAct: "NEW_REQUEST", changes: [{ field, operation, value: operation === "SET" ? value : null, evidence }] } }))),
  ...Object.entries(uncertaintyValues).map(([field, value]) => ({ name: `uncertainty/${field}`, canonical: { ...base, uncertainties: [{ field, reason: "AMBIGUOUS", alternatives: [{ value, evidence }, { value, evidence }] }] } })),
  ...periods.map((period, index) => ({ name: `period/${period.kind}/${index}`, canonical: { ...base, intent: "LIST_REMINDERS", query: { kind: "LIST", period, statusScope: "DEFAULT", evidence } } })),
  ...[null, { kind: "DAY", date: null }, { kind: "DATE_BOUNDS", from: null, through: null }].map((period, index) => ({ name: `period/nullable/${index}`, canonical: { ...base, intent: "LIST_REMINDERS", query: { kind: "LIST", period, statusScope: "DEFAULT", evidence }, uncertainties: [{ field: "queryRange", reason: "MISSING", alternatives: [] }] } })),
  ...dates.map((date, index) => ({ name: `query/calendar/${index}`, canonical: { ...base, intent: "CALENDAR_QUERY", query: { kind: "CALENDAR_DATE", date, outputCalendar: "GREGORIAN", evidence } } })),
  { name: "query/capability", canonical: { ...base, intent: "CAPABILITY_QUERY", query: { kind: "CAPABILITY", topic: "LUNAR", evidence } } },
  ...directives.map(conversationDirective => ({ name: `directive/${conversationDirective.kind}`, canonical: { ...base, conversationDirective } })),
  { name: "evidence/fact", canonical: { ...base, controlEvidence: [{ kind: "CONTEXT_FACT", ref: "f1" }] } },
];
function inactivePaths(value: unknown, path: (string | number)[] = []): (string | number)[][] {
  if (Array.isArray(value)) return value.flatMap((child, index) => inactivePaths(child, [...path, index]));
  if (!value || typeof value !== "object") return [];
  const object = value as Record<string, unknown>;
  return [...(pads[String(object.kind)] ?? []).map(key => [...path, key]), ...Object.entries(object).flatMap(([key, child]) => inactivePaths(child, [...path, key]))];
}
function replace(raw: unknown, path: (string | number)[], value: unknown) {
  const result = structuredClone(raw);
  let node = result as Record<string | number, unknown>;
  for (const key of path.slice(0, -1)) node = node[key] as Record<string | number, unknown>;
  node[path.at(-1)!] = value;
  return result;
}
const encoded = fixtures.map(fixture => ({ ...fixture, wire: encodeGoogleLiteEuContext(fixture.canonical) }));
// Each inactive mutation uses a payload independently chosen to be valid for
// that property in an active branch, not an arbitrary invalid scalar.
const activeValues: Record<string, unknown> = { ref: "f1", turn: 0, quote: "synthetic", occurrence: 1, calendar: "GREGORIAN", day: 1, month: 1, year: 2026, leapMonth: false, offsetDays: 0, weekday: 1, qualifier: "THIS_WEEK", date: null, offset: 0, from: null, through: null, period: null, statusScope: "DEFAULT", outputCalendar: "GREGORIAN", topic: "GENERAL", field: "title", reason: "AMBIGUOUS", issue: "CAPABILITY", queryKind: "LIST" };
const calendarWire = encoded.find(f => f.name === "query/calendar/1")!.wire as { query: { date: unknown } };
const listWire = encoded.find(f => f.name === "period/MONTH/6")!.wire as { query: { period: unknown } };
Object.assign(activeValues, { date: calendarWire.query.date, from: calendarWire.query.date, through: calendarWire.query.date, period: listWire.query.period });
const mutations = encoded.flatMap(fixture => inactivePaths(fixture.wire).map(path => ({ name: `${fixture.name}:${path.join(".")}`, path, canonical: fixture.canonical, wire: replace(fixture.wire, path, activeValues[String(path.at(-1))]) })));

it.each(encoded)("public wire schema admits and decoder reconstructs $name", ({ canonical, wire }) => {
  expect(ConversationInterpretationSchema.safeParse(canonical).success).toBe(true);
  expect(validator.safeParse(wire).success).toBe(true);
  expect(parseGoogleLiteEuContextSections(wire)).toEqual(parseInterpretationSections(canonical));
});
it.each(mutations)("generation schema rejects padding while decoder discards inactive active-shaped values $name", ({ canonical, wire }) => {
  expect(validator.safeParse(wire).success).toBe(false);
  expect(parseGoogleLiteEuContextSections(wire)).toEqual(parseInterpretationSections(canonical));
});
it("discards the observed inactive query date.calendar without treating it as a date operand", () => {
  const fixture = encoded.find(item => item.name === "period/MONTH/6")!;
  const wire = replace(fixture.wire, ["query", "period", "date"], { calendar: "GREGORIAN" });
  expect(validator.safeParse(wire).success).toBe(false);
  expect(parseGoogleLiteEuContextSections(wire)).toEqual(parseInterpretationSections(fixture.canonical));
});
const boundedNoise = [false, 42, "CONFIRM_SAVE", [], { kind: "CONTEXT_FACT", ref: "f999", confirmation: true, title: "inactive", count: 999 }, { kind: "CIVIL_DATE", calendar: "GREGORIAN", day: 1, month: 10, year: 2026, leapMonth: null }];
const noiseCases = encoded.filter(fixture => inactivePaths(fixture.wire).length).flatMap(fixture => boundedNoise.map((noise, index) => ({ ...fixture, name: `${fixture.name}/noise-${index}`, padded: inactivePaths(fixture.wire).reduce((wire, path) => replace(wire, path, noise), fixture.wire) })));
it.each(noiseCases)("projects every inactive key to zero canonical/evidence/control authority $name", ({ canonical, padded }) => {
  expect(parseGoogleLiteEuContextSections(padded)).toEqual(parseInterpretationSections(canonical));
});
it.each(encoded.filter(fixture => inactivePaths(fixture.wire).length))("never reads or traverses inactive values $name", ({ canonical, wire }) => {
  const raw = structuredClone(wire);
  for (const path of inactivePaths(wire)) {
    let node = raw as Record<string | number, unknown>;
    for (const key of path.slice(0, -1)) node = node[key] as Record<string | number, unknown>;
    Object.defineProperty(node, path.at(-1)!, { enumerable: true, get() { throw new Error("INACTIVE_VALUE_READ"); } });
  }
  expect(parseGoogleLiteEuContextSections(raw)).toEqual(parseInterpretationSections(canonical));
});
function activePaths(value: unknown, path: (string | number)[] = []): (string | number)[][] {
  if (Array.isArray(value)) return value.flatMap((child, index) => activePaths(child, [...path, index]));
  if (!value || typeof value !== "object") return [];
  const object = value as Record<string, unknown>;
  return [...(typeof object.kind === "string" || typeof object.operation === "string" ? Object.keys(object).map(key => [...path, key]) : []), ...Object.entries(object).flatMap(([key, child]) => activePaths(child, [...path, key]))];
}
const malformedActive = encoded.flatMap(fixture => activePaths(fixture.canonical).filter(path => path[0] !== "uncertainties").map(path => ({ name: `${fixture.name}:${path.join(".")}`, path, wire: replace(fixture.wire, path, []) })));
it.each(malformedActive)("keeps active branch fields and discriminators strict $name", ({ wire, path }) => {
  const parsed = parseGoogleLiteEuContextSections(wire);
  expect(parsed.status === "REFUSED" || !parsed.value.fullSchemaValid).toBe(true);
  const missing = structuredClone(wire);
  let node = missing as Record<string | number, unknown>;
  for (const key of path.slice(0, -1)) node = node[key] as Record<string | number, unknown>;
  delete node[path.at(-1)!];
  const absent = parseGoogleLiteEuContextSections(missing);
  expect(absent.status === "REFUSED" || !absent.value.fullSchemaValid).toBe(true);
});
it.each([
  { fixture: "period/MONTH/6", path: ["query", "period"], switchTo: { kind: "DAY", date: { calendar: "GREGORIAN" } } },
  { fixture: "period/MONTH/6", path: ["query"], switchTo: { kind: "CALENDAR_DATE", date: { calendar: "GREGORIAN" }, outputCalendar: "GREGORIAN" } },
  { fixture: "query/calendar/1", path: ["query", "date"], switchTo: { kind: "CIVIL_DATE", calendar: "INVALID", day: 1, month: 1, year: 2026, leapMonth: null } },
  { fixture: "evidence/fact", path: ["controlEvidence", 0], switchTo: { kind: "USER_QUOTE", turn: 0, quote: 42, occurrence: 1 } },
  { fixture: "minimal", path: ["conversationDirective"], switchTo: { kind: "ASK_FOR_FIELD", field: "CONFIRM_SAVE" } },
] as const)("switching discriminator immediately activates strict validation $fixture/$path", ({ fixture, path, switchTo }) => {
  const raw = structuredClone(encoded.find(item => item.name === fixture)!.wire);
  let node = raw as Record<string | number, unknown>;
  for (const key of path) node = node[key] as Record<string | number, unknown>;
  const { kind, ...payload } = switchTo;
  Object.assign(node, payload);
  // The malformed payload is ignored under the original discriminator.
  expect(parseGoogleLiteEuContextSections(raw)).toEqual(parseInterpretationSections(encoded.find(item => item.name === fixture)!.canonical));
  node.kind = kind;
  const parsed = parseGoogleLiteEuContextSections(raw);
  expect(parsed.status === "REFUSED" || !parsed.value.fullSchemaValid).toBe(true);
});
it.each(mutations)("keeps required inactive key presence strict $name", ({ wire, path }) => {
  const raw = structuredClone(wire);
  let node = raw as Record<string | number, unknown>;
  for (const key of path.slice(0, -1)) node = node[key] as Record<string | number, unknown>;
  delete node[path.at(-1)!];
  const parsed = parseGoogleLiteEuContextSections(raw);
  expect(parsed.status === "REFUSED" || !parsed.value.fullSchemaValid).toBe(true);
});
it.each(encoded.filter(fixture => inactivePaths(fixture.wire).length))("rejects unknown keys beside inactive padding $name", ({ wire }) => {
  const path = inactivePaths(wire)[0].slice(0, -1);
  const raw = structuredClone(wire);
  let node = raw as Record<string | number, unknown>;
  for (const key of path) node = node[key] as Record<string | number, unknown>;
  node.unrecognizedAuthority = { confirmation: true };
  const parsed = parseGoogleLiteEuContextSections(raw);
  expect(parsed.status === "REFUSED" || !parsed.value.fullSchemaValid).toBe(true);
});
it.each(Object.entries(values))("producer retains SET/CLEAR and field/value association for %s", (field, value) => {
  const set = encoded.find(f => f.name === `change/${field}/SET`)!.wire;
  const clear = encoded.find(f => f.name === `change/${field}/CLEAR`)!.wire;
  for (const invalid of [replace(set, ["changes", 0, "value"], null), replace(clear, ["changes", 0, "value"], value), replace(set, ["changes", 0, "value"], typeof value === "number" ? "wrong type" : 12)]) {
    expect(validator.safeParse(invalid).success).toBe(false);
    expect(parseGoogleLiteEuContextSections(invalid).status).toBe("REFUSED");
  }
});
it.each(Object.entries(uncertaintyValues))("canonical boundary retains homogeneous alternatives/field association for %s", (field, value) => {
  const wire = encoded.find(f => f.name === `uncertainty/${field}`)!.wire;
  const badAlternative = { value: typeof value === "number" ? "wrong type" : 12, evidence };
  const invalid = replace(wire, ["uncertainties", 0, "alternatives", 1], JSON.stringify(badAlternative));
  // The wire accepts bounded JSON strings; the unchanged canonical validator
  // owns the field/value correlation after deterministic decoding.
  expect(validator.safeParse(invalid).success).toBe(true);
  expect(ConversationInterpretationSchema.safeParse({ ...base, uncertainties: [{ field, reason: "AMBIGUOUS", alternatives: [{ value, evidence }, badAlternative] }] }).success).toBe(false);
  expect(parseGoogleLiteEuContextSections(invalid).status).toBe("REFUSED");
});

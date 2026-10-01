// @vitest-environment node
import { expect, it } from "vitest";
import { z } from "zod";
import { ConversationInterpretationSchema, parseInterpretationSections } from "../../../conversation/context-contract/contracts";
import { encodeGoogleLiteEuContext, googleLiteEuContextWireSchema, parseGoogleLiteEuContextSections } from "./context-provider-wire";

// Validate the actual publicly emitted JSON Schema with an independent public
// JSON-Schema consumer, rather than reconstructing the producer's predicates.
const publicSchema = googleLiteEuContextWireSchema().schema;
// Zod's converter supports definition refs only. Resolve local pointers without
// altering any assertions so it can consume this provider's draft-7/$defs mix.
function inlineRefs(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(inlineRefs);
  if (!value || typeof value !== "object") return value;
  const node = value as Record<string, unknown>;
  if (typeof node.$ref === "string") {
    if (Object.keys(node).length !== 1) throw new Error("Reference siblings need an independent validator proof");
    const target = decodeURIComponent(node.$ref).slice(2).split("/").reduce((current, key) => (current as Record<string, unknown>)[key.replaceAll("~1", "/").replaceAll("~0", "~")], publicSchema as unknown);
    return inlineRefs(target);
  }
  return Object.fromEntries(Object.entries(node).filter(([key]) => key !== "$defs").map(([key, child]) => [key, inlineRefs(child)]));
}
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
  expect(Buffer.byteLength(JSON.stringify(publicSchema))).toBeLessThanOrEqual(11853);
  const shape = z.object({ properties: z.object({ uncertainties: z.object({ items: z.record(z.string(), z.unknown()) }) }) }).parse(publicSchema);
  expect(Object.keys(shape.properties.uncertainties.items).sort()).toEqual(["additionalProperties", "properties", "required", "type"]);
  expect(shape.properties.uncertainties.items).toMatchObject({
    properties: { field: { type: "string" }, alternatives: { type: "array", items: { type: "string" } } },
    required: ["field", "reason", "alternatives"], additionalProperties: false,
  });
});
it.each([
  null, [], 7, "sensitive synthetic value",
  { evidence }, { value: "synthetic" },
  { value: "synthetic", evidence: [{ kind: "USER_QUOTE", turn: 0, quote: "sensitive synthetic value", occurrence: 1, extra: true }] },
  { value: "synthetic", evidence: [{ kind: "CONTEXT_FACT", ref: 7 }] },
  { value: { kind: "UNRECOGNIZED" }, evidence },
])("rejects decoded invalid alternative #%#", alternative => {
  const wire = { ...encodeGoogleLiteEuContext(base) as object, uncertainties: [{ field: "title", reason: "AMBIGUOUS", alternatives: [JSON.stringify(alternative)] }] };
  expect(validator.safeParse(wire).success).toBe(true);
  const diagnostics: unknown[] = [];
  expect(parseGoogleLiteEuContextSections(wire, issue => diagnostics.push(issue)).status).toBe("REFUSED");
  expect(JSON.stringify(diagnostics)).not.toContain("sensitive synthetic value");
});
it.each([
  { field: "unknown", reason: "AMBIGUOUS", alternatives: [] },
  { field: "title", reason: "unknown", alternatives: [] },
  { field: "title", reason: "AMBIGUOUS", alternatives: [null] },
  { field: "title", reason: "AMBIGUOUS", alternatives: Array(3).fill(JSON.stringify({ value: "synthetic", evidence })) },
  { field: "title", reason: "AMBIGUOUS", alternatives: [], extra: true },
  { field: "title", reason: "AMBIGUOUS" },
])("rejects invalid uncertainty envelope #%#", item => {
  expect(parseGoogleLiteEuContextSections({ ...encodeGoogleLiteEuContext(base) as object, uncertainties: [item] }).status).toBe("REFUSED");
});
it("rejects an oversized uncertainty array before parsing alternatives", () => {
  const item = { field: "title", reason: "MISSING", alternatives: [] };
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
  const wire = encodeGoogleLiteEuContext(canonical) as { uncertainties: Array<{ field: string; reason: string; alternatives: unknown[] }> };
  expect(wire.uncertainties).toEqual([{ field, reason: "AMBIGUOUS", alternatives: [JSON.stringify({ value, evidence })] }]);
  expect(parseGoogleLiteEuContextSections(wire)).toEqual(parseInterpretationSections(canonical));
});
it("emitted uncertainty shape avoids nested typed alternatives while canonical validation rejects invalid combinations", () => {
  const schema = inlineRefs(publicSchema) as { properties: { uncertainties: { items: unknown } } };
  expect(schema.properties.uncertainties.items).toMatchObject({ type: "object", properties: { field: { type: "string" }, alternatives: { type: "array", items: { type: "string" } } } });
  for (const alternative of ["not JSON", JSON.stringify({ value: 12, evidence }), JSON.stringify({ value: "synthetic", evidence: [] }), JSON.stringify({ value: "synthetic", evidence, unexpected: true }), "x".repeat(32769)]) {
    const wire = { ...encodeGoogleLiteEuContext(base) as object, uncertainties: [{ field: "title", reason: "AMBIGUOUS", alternatives: [alternative] }] };
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
const mutations = encoded.flatMap(fixture => inactivePaths(fixture.wire).map(path => ({ name: `${fixture.name}:${path.join(".")}`, wire: replace(fixture.wire, path, activeValues[String(path.at(-1))]) })));

it.each(encoded)("public wire schema admits and decoder reconstructs $name", ({ canonical, wire }) => {
  expect(ConversationInterpretationSchema.safeParse(canonical).success).toBe(true);
  expect(validator.safeParse(wire).success).toBe(true);
  expect(parseGoogleLiteEuContextSections(wire)).toEqual(parseInterpretationSections(canonical));
});
it.each(mutations)("public wire schema rejects inactive active-shaped padding $name", ({ wire }) => {
  expect(validator.safeParse(wire).success).toBe(false);
  const parsed = parseGoogleLiteEuContextSections(wire);
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

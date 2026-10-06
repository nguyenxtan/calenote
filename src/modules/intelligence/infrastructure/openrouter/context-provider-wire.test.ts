// @vitest-environment node
import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { ContextInputSchema, ConversationInterpretationSchema, ConversationInterpretationV3Schema, parseInterpretationSections } from "../../../conversation/context-contract/contracts";
import { CONTEXT_PROTOCOL_V3 } from "../../../conversation/context-contract/protocol";
import { createContextContractGateway, createContextHttpTransport, type SemanticJsonRequest } from "./semantic-gateway";
import { encodeGoogleLiteEuContextV3, googleLiteEuContextWireSchemaV3 as googleLiteEuContextWireSchema, parseGoogleLiteEuContextSectionsV3 } from "./context-provider-wire";
import * as wireModule from "./context-provider-wire";
import {isUnreconciledListInterpretation,readListTransport} from "../../../conversation/context-contract/list-period-transport";

const config = { protocol: CONTEXT_PROTOCOL_V3, maxInputChars: 1800, maxInputTokens: 12000, maxOutputTokens: 1536, maxResponseBytes: 32768, timeoutMs: 30000,
  primary: { model: "google/gemini-2.5-flash-lite", provider: "google-vertex/eu", requireZdr: true, promptPriceMicrounitsPerMillionTokens: 100000, completionPriceMicrounitsPerMillionTokens: 400000 } };
const input = ContextInputSchema.parse({ schemaVersion: "calenote-context-input-2", reference: { instant: "2026-09-28T03:00:00.000Z", localDate: "2026-09-28", timezone: "Asia/Ho_Chi_Minh" }, turns: [{ role: "USER", text: "synthetic" }], currentTurn: 0, activeRequest: null, facts: [], pendingQuestion: null, ambiguities: [], capabilities: { version: "context-capabilities-1", supported: ["ONCE"], unsupported: ["YEARLY"], calendars: ["GREGORIAN"], limits: { dailyCount: 30, horizonDays: 366 } } });
const minimal = { schemaVersion: "calenote-context-3", intent: "HELP", requestTarget: null, changes: [], query: null, uncertainties: [], conversationDirective: { kind: "HELP", topic: "GENERAL" }, replyProposal: null };
const successorWire = wireModule;
const selectedV3 = CONTEXT_PROTOCOL_V3;
const v3Help = { schemaVersion: "calenote-context-3", intent: "HELP", requestTarget: null, changes: [], query: null, uncertainties: [], conversationDirective: { kind: "HELP", topic: "GENERAL" }, replyProposal: null };
it.each(["THIS_MONTH", "private title location secret", "A".repeat(1000)])("retains only safe finite-control diagnostics (%#)", token => {
  const canonical = { ...v3Help, intent: "LIST_REMINDERS", conversationDirective: null, query: { kind: "LIST", period: { kind: "MONTH", offset: 0 }, statusScope: "DEFAULT", evidence: [{ kind: "USER_QUOTE", turn: 0, quote: "private", occurrence: 1 }] } };
  const wire = encodeGoogleLiteEuContextV3(canonical as never) as { query: { period: { kind: string } } };
  wire.query.period.kind = token;
  const diagnostics: unknown[] = [];
  expect(parseGoogleLiteEuContextSectionsV3(wire, selectedV3, undefined, value => diagnostics.push(value)).status).toBe("REFUSED");
  expect(diagnostics).toMatchObject([{ issues: [{ path: ["query", "period", "kind"], constraint: "CONTROL_ENUM", acceptedDomainId: expect.stringMatching(/^CONTROL_DOMAIN_SHA256:/), acceptedValueCount: 8, actualType: "string", actualLength: token.length, actualDigest: createHash("sha256").update(token).digest("hex") }] }]);
  if (token === "THIS_MONTH") expect(diagnostics).toMatchObject([{ issues: [{ actualSafeToken: token }] }]);
  else { expect(JSON.stringify(diagnostics)).not.toContain(token); expect(diagnostics).toMatchObject([{ issues: [expect.not.objectContaining({ actualSafeToken: expect.anything() })] }]); }
});
it("diagnoses another finite control domain without changing valid decoding", () => {
  const wire = encodeGoogleLiteEuContextV3(v3Help as never) as Record<string, unknown>;
  const diagnostics: unknown[] = [];
  expect(parseGoogleLiteEuContextSectionsV3(wire, selectedV3, undefined, value => diagnostics.push(value)).status).toBe("PARSED");
  expect(diagnostics).toEqual([]);
  wire.intent = "INVALID_INTENT";
  expect(parseGoogleLiteEuContextSectionsV3(wire, selectedV3, undefined, value => diagnostics.push(value)).status).toBe("REFUSED");
  expect(diagnostics).toMatchObject([{ issues: [{ path: ["intent"], constraint: "CONTROL_ENUM", actualSafeToken: "INVALID_INTENT", acceptedValueCount: expect.any(Number) }] }]);
});
it("accepts valid MONTH without diagnostic capture", () => {
  const canonical = { ...v3Help, intent: "LIST_REMINDERS", conversationDirective: null, query: { kind: "LIST", period: { kind: "MONTH", offset: 0 }, statusScope: "DEFAULT", evidence: [{ kind: "USER_QUOTE", turn: 0, quote: "private", occurrence: 1 }] } };
  const diagnostics: unknown[] = [];
  expect(parseGoogleLiteEuContextSectionsV3(encodeGoogleLiteEuContextV3(canonical as never), selectedV3, undefined, value => diagnostics.push(value)).status).toBe("PARSED");
  expect(diagnostics).toEqual([]);
});
it.each(["SECRET VALUE", "SECRET\nVALUE", "âm_lịch", "TOKEN@EMAIL.COM", "x".repeat(49)])("does not retain unsafe control strings in scalar enums (%#)", token => {
  const wire = encodeGoogleLiteEuContextV3(v3Help as never) as Record<string, unknown>;
  wire.intent = token;
  const diagnostics: unknown[] = [];
  expect(parseGoogleLiteEuContextSectionsV3(wire, selectedV3, undefined, value => diagnostics.push(value)).status).toBe("REFUSED");
  expect(JSON.stringify(diagnostics)).not.toContain(token);
  expect(diagnostics).toMatchObject([{ issues: [{ constraint: "CONTROL_ENUM", actualLength: token.length, actualDigest: createHash("sha256").update(token).digest("hex") }] }]);
});
it("diagnoses invalid compact control code without retaining arbitrary values", () => {
  const wire = encodeGoogleLiteEuContextV3(v3Help as never) as Record<string, unknown>;
  wire.uncertainties = [{ fieldCode: "BAD_CODE", reason: "private reason", alternatives: [] }];
  const diagnostics: unknown[] = [];
  expect(parseGoogleLiteEuContextSectionsV3(wire, selectedV3, undefined, value => diagnostics.push(value)).status).toBe("REFUSED");
  expect(diagnostics).toMatchObject([{ issues: [{ path: ["uncertainties", 0, "fieldCode"], constraint: "CONTROL_ENUM", actualSafeToken: "BAD_CODE", acceptedValueCount: 16 }] }]);
  expect(JSON.stringify(diagnostics)).not.toContain("private reason");
});
it.each(["primaryEvidence", "additionalEvidenceJson"] as const)("retains decoded control type and structural path inside %s", slot => {
  const canonical = { ...v3Help, intent: "LIST_REMINDERS", conversationDirective: null, query: { kind: "LIST", period: { kind: "MONTH", offset: 0 }, statusScope: "DEFAULT", evidence: [{ kind: "USER_QUOTE", turn: 0, quote: "private", occurrence: 1 }] } };
  const wire = encodeGoogleLiteEuContextV3(canonical as never) as { query: { evidence: { primaryEvidence: string; additionalEvidenceJson: string } } };
  if (slot === "primaryEvidence") wire.query.evidence.primaryEvidence = JSON.stringify({...JSON.parse(wire.query.evidence.primaryEvidence),kind:"BAD_EVIDENCE_KIND"});
  else wire.query.evidence.additionalEvidenceJson = JSON.stringify([{ kind: "BAD_EVIDENCE_KIND", turn: 0, quote: "private", occurrence: 1, ref: null }]);
  const diagnostics: unknown[] = [];
  expect(parseGoogleLiteEuContextSectionsV3(wire, selectedV3, undefined, value => diagnostics.push(value)).status).toBe("REFUSED");
  expect(diagnostics).toMatchObject([{ issues: [{ path: ["query", "evidence", slot, ...(slot === "additionalEvidenceJson" ? [0] : []), "kind"], classification: "value", actualType: "string", actualSafeToken: "BAD_EVIDENCE_KIND" }] }]);
  expect(JSON.stringify(diagnostics)).not.toContain("private");
});
it("observes decoded canonical query before a root constraint rejects the envelope", () => {
  const canonical = { ...v3Help, intent: "LIST_REMINDERS", conversationDirective: null, query: { kind: "LIST", period: { kind: "MONTH", offset: 0 }, statusScope: "DEFAULT", evidence: [{ kind: "USER_QUOTE", turn: 0, quote: "PRIVATE_QUERY", occurrence: 1 }] } };
  const wire = encodeGoogleLiteEuContextV3(canonical as never) as Record<string, unknown>;
  wire.intent = "HELP";
  let observed: unknown;
  const parse = parseGoogleLiteEuContextSectionsV3 as unknown as (raw: unknown, protocol: typeof CONTEXT_PROTOCOL_V3, invalid: undefined, wireInvalid: undefined, decoded: (value: unknown) => void) => { status: string };
  expect(parse(wire, CONTEXT_PROTOCOL_V3, undefined, undefined, value => { observed = value; }).status).toBe("REFUSED");
  expect(observed).toMatchObject({ intent: "HELP", query: { kind: "LIST", period: { kind: "MONTH", offset: 0 } } });
  expect(parse(wire, CONTEXT_PROTOCOL_V3, undefined, undefined, () => { throw Error("diagnostic observer failure"); }).status).toBe("REFUSED");
  expect(parse(wire, CONTEXT_PROTOCOL_V3, undefined, undefined, value => { (value as { intent: string }).intent = "LIST_REMINDERS"; }).status).toBe("REFUSED");
});
it.each([
  [42, "number"], [null, "null"], [["SENSITIVE_PRIVATE_VALUE"], "array"], ["SENSITIVE_PRIVATE_VALUE".repeat(10000), "string"], [false, "boolean"],
] as const)("selected primitive envelope diagnostics remain bounded and private (case %#)", (raw, actualType) => {
  const diagnostics: unknown[] = [], canonical: unknown[] = [];
  expect(parseGoogleLiteEuContextSectionsV3(raw, CONTEXT_PROTOCOL_V3, value => canonical.push(value), value => diagnostics.push(value))).toEqual({ status: "REFUSED", reason: "ENVELOPE_INVALID" });
  expect(canonical).toEqual([]);
  expect(diagnostics).toEqual([{ schemaVersion: "calenote-context-3", issues: [{ path: [], code: "WIRE_SHAPE_INVALID", expected: "object", actualType, classification: "value", unknownPathSegments: 0 }], topLevelKeys: [], unknownTopLevelKeyCount: 0, truncated: false }]);
  expect(JSON.stringify(diagnostics)).not.toContain("SENSITIVE_PRIVATE_VALUE");
  expect(JSON.stringify(diagnostics).length).toBeLessThan(400);
});
it("invalid application protocol selection does not produce raw-envelope diagnostics", () => {
  const diagnostics: unknown[] = [];
  const wrong = { ...CONTEXT_PROTOCOL_V3, canonicalVersion: "calenote-context-2" } as unknown as typeof CONTEXT_PROTOCOL_V3;
  expect(parseGoogleLiteEuContextSectionsV3(42, wrong, value => diagnostics.push(value), value => diagnostics.push(value))).toEqual({ status: "REFUSED", reason: "ENVELOPE_INVALID" });
  expect(diagnostics).toEqual([]);
});
function v3Wire() { expect(successorWire.googleLiteEuContextWireSchemaV3).toBeDefined(); return successorWire.googleLiteEuContextWireSchemaV3(); }
it("new_wire_has_no_dialogue_or_owned_metadata", () => {
  const schema = v3Wire().schema;
  const text = JSON.stringify(schema);
  for (const key of ["dialogueAct", "continuation", "controlEvidence", "schemaVersion", "PRESENT_PREVIEW", "ANSWER_QUERY"]) expect(text).not.toContain(`\"${key}\"`);
  expect(schema.properties).toHaveProperty("requestTarget");
});
it("invalid_active_discriminator_rejects", () => {
  v3Wire();
  const wire = successorWire.encodeGoogleLiteEuContextV3(ConversationInterpretationV3Schema.parse(v3Help)) as Record<string, unknown>;
  expect(successorWire.parseGoogleLiteEuContextSectionsV3({ ...wire, intent: "INVALID" }, selectedV3)).toMatchObject({ status: "REFUSED" });
  expect(successorWire.parseGoogleLiteEuContextSectionsV3(wire, { ...selectedV3, canonicalVersion: "calenote-context-2" } as unknown as typeof selectedV3)).toMatchObject({ status: "REFUSED" });
});
it("inactive_padding_never_enters_core", () => {
  v3Wire();
  const value = { ...v3Help, intent: "CREATE_REMINDER", requestTarget: { kind: "NEW", evidence: [{ kind: "USER_QUOTE", turn: 0, quote: "new", occurrence: 1 }] }, changes: [{ field: "eventDate", operation: "SET", value: { kind: "RELATIVE_DAY", offsetDays: 1 }, evidence: [{ kind: "USER_QUOTE", turn: 0, quote: "new", occurrence: 1 }] }] };
  const wire = successorWire.encodeGoogleLiteEuContextV3(ConversationInterpretationV3Schema.parse(value)) as { changes: Array<{ value: Record<string, unknown> }> };
  wire.changes[0].value.year = { malicious: true };
  expect(successorWire.parseGoogleLiteEuContextSectionsV3(wire, selectedV3)).toMatchObject({ status: "PARSED", value: { semantic: { changes: value.changes } } });
  wire.changes[0].value.unknown = true;
  expect(successorWire.parseGoogleLiteEuContextSectionsV3(wire, selectedV3)).toMatchObject({ status: "REFUSED" });
});
it("isolated_wire_guidance_failure_keeps_core_and_reports_full_failure", () => {
  const wire = successorWire.encodeGoogleLiteEuContextV3(ConversationInterpretationV3Schema.parse(v3Help)) as Record<string, unknown>;
  expect(successorWire.parseGoogleLiteEuContextSectionsV3({ ...wire, conversationDirective: { kind: "HELP", topic: "GENERAL" } }, selectedV3)).toMatchObject({ status: "PARSED", value: { directive: { status: "INVALID" }, fullSchemaValid: false } });
  const withoutGuidance = Object.fromEntries(Object.entries(wire).filter(([key]) => !["conversationDirective", "replyProposal"].includes(key)));
  expect(successorWire.parseGoogleLiteEuContextSectionsV3(withoutGuidance, selectedV3)).toMatchObject({ status: "PARSED", value: { directive: { status: "INVALID" }, reply: { status: "INVALID" }, fullSchemaValid: false } });
  expect(successorWire.parseGoogleLiteEuContextSectionsV3({ ...wire, conversationDirective: { kind: "INVALID" }, replyProposal: { text: "valid independent wording" } }, selectedV3)).toMatchObject({ status: "PARSED", value: { directive: { status: "INVALID" }, reply: { status: "VALID" }, fullSchemaValid: false } });
  expect(successorWire.parseGoogleLiteEuContextSectionsV3({ ...wire, extra: true }, selectedV3)).toMatchObject({ status: "REFUSED" });
});
const quote = { kind: "USER_QUOTE", turn: 0, quote: "synthetic", occurrence: 1 };
const evidence = [quote, { kind: "CONTEXT_FACT", ref: "f1" }, quote];
const civil = { kind: "CIVIL_DATE", calendar: "GREGORIAN", day: 31, month: 12, year: 9999, leapMonth: null };
const clock = { hour: 23, minute: 59, qualifier: "H24" };
const values = { title: "t".repeat(1800), location: "l".repeat(300), notes: "n".repeat(2000), eventDate: civil, eventTime: clock, reminderDate: { kind: "RELATIVE_DAY", offsetDays: -366 }, reminderTime: clock, calendar: "LUNAR_VN", frequency: "DAILY", occurrenceCount: Number.MAX_SAFE_INTEGER, eventRelation: "BEFORE_EVENT", leadOffsetDays: Number.MAX_SAFE_INTEGER, endDate: { kind: "WEEKDAY", weekday: 7, qualifier: "NEXT_WEEK" } };
// Independent, hand-specified wire layout; never calls a production encoder.
const pads: Record<string, string[]> = { USER_QUOTE: ["ref"], CONTEXT_FACT: ["turn", "quote", "occurrence"], CIVIL_DATE: ["offsetDays", "weekday", "qualifier"], RELATIVE_DAY: ["calendar", "day", "month", "year", "leapMonth", "weekday", "qualifier"], WEEKDAY: ["calendar", "day", "month", "year", "leapMonth", "offsetDays"], DAY: ["offset", "from", "through"], WEEK: ["date", "from", "through"], MONTH: ["date", "from", "through"], WEEKEND: ["date", "from", "through"], UPCOMING: ["date", "offset", "from", "through"], DATE_BOUNDS: ["date", "offset"], LIST: ["date", "outputCalendar", "topic"], CALENDAR_DATE: ["period", "topic"], CAPABILITY: ["period", "date", "outputCalendar"], HELP: ["field", "reason", "issue"], ASK_FOR_FIELD: ["reason", "issue", "topic"], ASK_FOR_DISAMBIGUATION: ["issue", "topic"], EXPLAIN_UNSUPPORTED: ["field", "reason", "topic"], PRESENT_PREVIEW: ["field", "reason", "issue", "topic"], ANSWER_QUERY: ["field", "reason", "issue", "topic"] };
function wireFixture(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(wireFixture);
  if (!value || typeof value !== "object") return value;
  const object = value as Record<string, unknown>, result = Object.fromEntries(Object.entries(object).map(([key, child]) => [key, key === "uncertainties" && Array.isArray(child)
    ? child.map((item: { field: unknown; reason: unknown; alternatives: unknown[] }) => ({ fieldCode: ["title", "location", "notes", "eventDate", "eventTime", "reminderDate", "reminderTime", "calendar", "frequency", "occurrenceCount", "eventRelation", "leadOffsetDays", "endDate", "intent", "queryRange", "operation"].indexOf(String(item.field)), reason: item.reason, alternatives: item.alternatives.map(alternative => JSON.stringify(alternative)) }))
    : wireFixture(child)]));
  if (Object.hasOwn(object, "schemaVersion")) delete result.schemaVersion;
  if (Array.isArray(object.evidence)) {
    result.evidence = { primaryEvidence: JSON.stringify(object.evidence[0]), additionalEvidenceJson: JSON.stringify(object.evidence.slice(1)) };
  }
  if (object.kind === "LIST") delete result.statusScope;
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
  expect(createHash("sha256").update(JSON.stringify(requests[0].response_format.json_schema.schema)).digest("hex")).toBe("5ae993826dffda6629ee599b5c9bd21353192b10a088d5adc1a2822ea070e906");
  expect(requests[0].provider).toEqual({ only: ["google-vertex/eu"], allow_fallbacks: false, require_parameters: true, data_collection: "deny", zdr: true, max_price: { prompt: .1, completion: .4 } });
  expect(requests[0].stream).toBe(false);
});
it("reconstructs the exact minimal canonical fixture from required inactive null padding", async () => {
  expect(await dispatch(wireFixture(minimal))).toMatchObject({ status: "SUCCESS", interpretation: { fullSchemaValid: true, directive: { status: "VALID", value: minimal.conversationDirective } } });
});
it.each(Object.entries(values).flatMap(([field, value]) => ["SET", "CLEAR"].map(operation => ({ field, operation, value: operation === "SET" ? value : null, evidence }))))("preserves typed SET/CLEAR and evidence order for $field/$operation", async change => {
  const canonical = { ...minimal, intent: "CREATE_REMINDER", requestTarget: { kind: "NEW", evidence: [quote] }, changes: [change] };
  expect(ConversationInterpretationSchema.safeParse(canonical).success).toBe(true);
  expect(await dispatch(wireFixture(canonical))).toMatchObject({ status: "SUCCESS", interpretation: { semantic: { changes: [change] }, fullSchemaValid: true } });
});
it("preserves full changes/uncertainties/evidence capacities and ordered alternatives", async () => {
  const changes = Object.entries(values).map(([field, value]) => ({ field, operation: "SET", value, evidence }));
  const uncertainties = Array.from({ length: 4 }, () => ({ field: "title", reason: "AMBIGUOUS", alternatives: [{ value: "first", evidence }, { value: "second", evidence: [...evidence].reverse() }] }));
  expect(await dispatch(wireFixture({ ...minimal, intent: "CREATE_REMINDER", requestTarget: { kind: "NEW", evidence: [quote] }, changes, uncertainties }))).toMatchObject({ status: "SUCCESS", interpretation: { semantic: { changes, uncertainties }, fullSchemaValid: true } });
});
it.each(Object.entries({ ...values, intent: "HELP", operation: "CURRENT", queryRange: { kind: "DATE_BOUNDS", from: civil, through: civil } }))("preserves uncertainty field association for %s", async (field, value) => {
  const uncertainties = [{ field, reason: "AMBIGUOUS", alternatives: [{ value, evidence }, { value, evidence }] }];
  expect(await dispatch(wireFixture({ ...minimal, uncertainties }))).toMatchObject({ status: "SUCCESS", interpretation: { semantic: { uncertainties }, fullSchemaValid: true } });
});
it.each([
  ["LIST_REMINDERS", { kind: "LIST", period: { kind: "DATE_BOUNDS", from: civil, through: civil }, statusScope: "DEFAULT", evidence }],
  ["CALENDAR_QUERY", { kind: "CALENDAR_DATE", date: civil, outputCalendar: "LUNAR_VN", evidence }],
  ["CAPABILITY_QUERY", { kind: "CAPABILITY", topic: "LUNAR", evidence }],
])("reconstructs query ownership for %s", async (intent, query) => {
  const result=await dispatch(wireFixture({ ...minimal, intent, query }));
  if(intent==="LIST_REMINDERS") {
    if(!("period" in query))throw Error("fixture query ownership");
    expect(result.status).toBe("SUCCESS");if(result.status!=="SUCCESS")throw Error(result.category);
    expect(isUnreconciledListInterpretation(result.interpretation)).toBe(true);
    const staged=readListTransport(result.interpretation);
    expect(staged.core).toMatchObject({intent,query:{kind:"LIST",statusScope:query.statusScope,evidence:query.evidence}});
    expect(staged.period).toEqual({status:"KNOWN",value:query.period});
  } else expect(result).toMatchObject({ status: "SUCCESS", interpretation: { semantic: { intent, query }, fullSchemaValid: true } });
});
it("versioned encoder matches independent fixtures and reconstructs every typed canonical field", () => {
  const canonical = { ...minimal, intent: "CREATE_REMINDER", requestTarget: { kind: "NEW", evidence: [quote] }, changes: Object.entries(values).map(([field, value]) => ({ field, operation: "SET", value, evidence })) };
  const before = JSON.stringify(canonical), encoded = encodeGoogleLiteEuContext(canonical);
  expect(encoded).toEqual(wireFixture(canonical));
  expect(parseGoogleLiteEuContextSections(encoded)).toEqual(parseInterpretationSections(canonical));
  expect(JSON.stringify(canonical)).toBe(before);
  for (const directive of [{ kind: "ASK_FOR_FIELD", field: "title" }, { kind: "ASK_FOR_DISAMBIGUATION", field: "title", reason: "AMBIGUOUS" }, { kind: "EXPLAIN_UNSUPPORTED", issue: "CAPABILITY" }, { kind: "HELP", topic: "GENERAL" }, null]) {
    const fixture = { ...minimal, conversationDirective: directive, replyProposal: { text: "x".repeat(400) } };
    expect(encodeGoogleLiteEuContext(fixture)).toEqual(wireFixture(fixture));
    expect(parseGoogleLiteEuContextSections(encodeGoogleLiteEuContext(fixture))).toEqual(parseInterpretationSections(fixture));
  }
  expect(() => encodeGoogleLiteEuContext({ ...canonical, changes: [...canonical.changes, canonical.changes[0]] })).toThrow();
  const schema = googleLiteEuContextWireSchema();
  expect(schema.version).toBe("google-gemini-2.5-flash-lite-vertex-eu-context-canonical-evidence-json-16");
  expect(createHash("sha256").update(JSON.stringify(schema.schema)).digest("hex")).toBe("5ae993826dffda6629ee599b5c9bd21353192b10a088d5adc1a2822ea070e906");
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
  expect(await dispatch(wireFixture({ ...minimal, intent: "CREATE_REMINDER", requestTarget: { kind: "NEW", evidence: [quote] }, changes: [change] }))).toMatchObject({ status: "FAILURE", category: "SCHEMA_INVALID" });
});
it.each([
  { ...minimal, uncertainties: Array.from({ length: 5 }, () => ({ field: "title", reason: "MISSING", alternatives: [] })) },
  { ...minimal, uncertainties: [{ field: "title", reason: "AMBIGUOUS", alternatives: Array.from({ length: 3 }, () => ({ value: "synthetic", evidence })) }] },
  { ...minimal, uncertainties: [{ field: "title", reason: "AMBIGUOUS", alternatives: [{ value: "synthetic", evidence }, { value: 2, evidence }] }] },
  { ...minimal, requestTarget: { kind: "NEW", evidence: [...evidence, quote] } },
  { ...minimal, query: { kind: "CAPABILITY", topic: "LUNAR", evidence } },
])("rejects array caps, mixed field alternatives and query/intent mismatch %#", async canonical => {
  expect(await dispatch(wireFixture(canonical))).toMatchObject({ status: "FAILURE", category: "SCHEMA_INVALID" });
});
it("retains active nullable date values and rejects missing envelope/core keys", () => {
  const canonical = { ...minimal, intent: "CREATE_REMINDER", requestTarget: { kind: "NEW", evidence: [quote] }, changes: [{ field: "eventDate", operation: "SET", value: { ...civil, year: null }, evidence }] };
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
  ["four evidence", (raw: Record<string, unknown>) => { ((raw.changes as Array<Record<string, unknown>>)[0].evidence as Record<string, unknown>).additionalEvidenceJson = JSON.stringify([wireFixture(quote), wireFixture(quote), wireFixture(quote)]); }],
  ["duplicate field", (raw: Record<string, unknown>) => { (raw.changes as unknown[]).push(structuredClone((raw.changes as unknown[])[0])); }],
  ["unknown root", (raw: Record<string, unknown>) => { raw.extra = null; }],
  ["missing core", (raw: Record<string, unknown>) => { delete raw.intent; }],
] as const)("rejects invalid core atomically: %s", async (_label, mutate) => {
  const raw = wireFixture({ ...minimal, intent: "CREATE_REMINDER", requestTarget: { kind: "NEW", evidence: [quote] }, changes: [{ field: "title", operation: "SET", value: "synthetic", evidence }] }) as Record<string, unknown>; mutate(raw);
  expect(await dispatch(raw)).toMatchObject({ status: "FAILURE", category: "SCHEMA_INVALID" });
});
it("discards inactive evidence and guidance at the HTTP boundary without changing semantic authority", async () => {
  const canonical = { ...minimal, intent: "CREATE_REMINDER", requestTarget: { kind: "NEW", evidence: [quote] }, changes: [{ field: "title", operation: "SET", value: "synthetic", evidence }] };
  const raw = wireFixture(canonical) as Record<string, unknown>;
  (raw.conversationDirective as Record<string, unknown>).field = "title";
  const changedEvidence=(raw.changes as Array<Record<string,unknown>>)[0].evidence as {primaryEvidence:string};
  changedEvidence.primaryEvidence=JSON.stringify({...JSON.parse(changedEvidence.primaryEvidence),ref:"f999"});
  expect(await dispatch(raw)).toMatchObject({ status: "SUCCESS", interpretation: { semantic: { changes: canonical.changes }, directive: { status: "VALID", value: minimal.conversationDirective }, fullSchemaValid: true } });
});

function encodeGoogleLiteEuContext(value: unknown) { return encodeGoogleLiteEuContextV3(ConversationInterpretationV3Schema.parse(value)); }
function parseGoogleLiteEuContextSections(value: unknown) { return parseGoogleLiteEuContextSectionsV3(value, CONTEXT_PROTOCOL_V3); }

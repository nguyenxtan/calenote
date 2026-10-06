// @vitest-environment node
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { measureLegacyV2EnvelopeReference as measureEnvelope, preflightLegacyV2EnvelopeReference as preflightEnvelopeTransition } from "../../src/modules/conversation/context-contract/admission";
import { LegacyV2ContextInputSchema as ContextInputSchema, LegacyV2ConversationInterpretationSchema as ConversationInterpretationSchema, LegacyV2InterpretationJsonSchema as InterpretationJsonSchema, SLOT_NAMES, LegacyV2parseInterpretationSections as parseInterpretationSections, type LegacyV2ContextInput as ContextInput } from "../../src/modules/conversation/context-contract/contracts";
import { CONTEXT_CONTRACT_PROMPT } from "../../src/modules/conversation/context-contract/prompt";
import { serializeLegacyV2ContextRequestReference as serializeContextRequest } from "../../src/modules/conversation/context-contract/wire";
import { decodeIdentityViews, encodeIdentityViews } from "./snapshot-identity-view";
import { measureLocalTokens, measureLocalTokenArtifacts } from "./local-tokenizer";
import { createContextContractProbe, runContextFixtureCampaign } from "./context-contract-probe";
import { frozenContextProposal, encodeFixtureV3 } from "./context-contract-fixtures";
import { admitContextManifest, expandContextCampaign, type ContextManifest } from "./context-contract";
import { ConversationInterpretationSchema as SelectedInterpretationSchema, InterpretationJsonSchema as SelectedInterpretationJsonSchema } from "../../src/modules/conversation/context-contract/contracts";
import { serializeContextRequest as serializeSelectedRequest } from "../../src/modules/conversation/context-contract/wire";
import { measureEnvelope as measureSelectedEnvelope } from "../../src/modules/conversation/context-contract/admission";
import { encodeContextSnapshotV2 } from "../../src/modules/conversation/context-contract/state";
import { ContextSnapshotV1Schema, decodeContextSnapshot, encodeContextSnapshot } from "../../src/modules/conversation/context-contract/state";
import { execFileSync } from "node:child_process";
import { legacyV2GoogleLiteEuContextWireSchema, googleLiteEuContextWireSchemaV3 } from "../../src/modules/intelligence/infrastructure/openrouter/context-provider-wire";

it("wire_complexity_before_after_is_source_bound", () => {
  const immutable = execFileSync("git", ["show", "899b1f25f38d4d4afcd7429ffbb10c91851c25e3:src/modules/intelligence/infrastructure/openrouter/semantic-gateway.test.ts"], { encoding: "utf8" });
  const golden = immutable.match(/\.toBe\("(840ad[a-f0-9]+)"\)/u)?.[1];
  expect(golden).toBe("840ad3ff121dc4a5ad61016ad65a37f37a5f5b0819851e6cdb04952fb12705ab");
  expect(digest(JSON.stringify(legacyV2GoogleLiteEuContextWireSchema().schema))).toBe(golden);
  console.log(JSON.stringify({ promptDigest: digest(CONTEXT_CONTRACT_PROMPT), baselineDigest: golden, targetDigest: digest(JSON.stringify(googleLiteEuContextWireSchemaV3().schema)) }));
  expect(digest(CONTEXT_CONTRACT_PROMPT)).toBe("87ed8785a164c369b86f73d4cb2af8abc1eee3fa90f10106e36906da9408d822");
});

function schemaMetrics(schema: unknown) {
  let nodes = 0, depth = 0, branches = 0, required = 0, enumArrays = 0, enumValues = 0, largestEnum = 0, nullable = 0, refs = 0, definitions = 0, constants = 0;
  function walk(value: unknown, level: number) {
    if (!value || typeof value !== "object") return;
    nodes++; depth = Math.max(depth, level);
    if (Array.isArray(value)) { value.forEach(v => walk(v, level + 1)); return; }
    const obj = value as Record<string, unknown>;
    for (const key of ["anyOf", "oneOf"]) if (Array.isArray(obj[key])) branches += obj[key].length;
    if (Array.isArray(obj.required)) required += obj.required.length;
    if (Array.isArray(obj.enum)) { enumArrays++; enumValues += obj.enum.length; largestEnum = Math.max(largestEnum, obj.enum.length); }
    if (obj.type === "null" || Array.isArray(obj.type) && obj.type.includes("null")) nullable++;
    if (typeof obj.$ref === "string") refs++;
    for (const key of ["$defs", "definitions"]) if (obj[key] && typeof obj[key] === "object") definitions += Object.keys(obj[key]).length;
    if ("const" in obj) constants++;
    Object.values(obj).forEach(v => walk(v, level + 1));
  }
  walk(schema, 0);
  const root = schema as { properties: object };
  return { utf8Bytes: utf8(JSON.stringify(schema)), rootKeys: Object.keys(root.properties).length, recursiveObjectArrayNodes: nodes, maximumDepth: depth, unionBranches: branches, requiredEntries: required, enumArrays, enumValues, largestEnum, nullableNodes: nullable, references: refs, definitions, constantDiscriminators: constants };
}

it.skipIf(process.env.CONTEXT_FIT_LOCAL_TOKENS !== "1")("selected_V3_actual_service_envelopes_and_wire9_wire10_same_algorithm_fit", async () => {
  const baselineSchema = legacyV2GoogleLiteEuContextWireSchema().schema;
  const targetSchema = googleLiteEuContextWireSchemaV3().schema;
  expect(digest(JSON.stringify(baselineSchema))).toBe("840ad3ff121dc4a5ad61016ad65a37f37a5f5b0819851e6cdb04952fb12705ab");
  expect(schemaMetrics(baselineSchema)).toMatchObject({ utf8Bytes: 12057, rootKeys: 9, recursiveObjectArrayNodes: 337, unionBranches: 49, enumArrays: 22, enumValues: 100, maximumDepth: 11 });
  expect(Object.keys((targetSchema as { properties: object }).properties)).not.toEqual(expect.arrayContaining(["dialogueAct", "continuation", "controlEvidence"]));
  expect(JSON.stringify(targetSchema)).not.toContain('"PRESENT_PREVIEW"');
  expect(JSON.stringify(targetSchema)).not.toContain('"ANSWER_QUERY"');
  const manifests = ["regressions", "development"].map(name => admitContextManifest(JSON.parse(readFileSync(`src/modules/conversation/context-contract/benchmark/${name}.json`, "utf8"))));
  const selected = manifests.flatMap(m => m.cases).filter(c => ["R02", "R07", "R14", "D01", "D02", "D06", "D07"].includes(c.id));
  const artifacts: Parameters<typeof measureLocalTokenArtifacts>[0] = [];
  const measurements: unknown[] = [];
  for (const script of selected) {
    let count = 0, turnIndex = 0;
    const outputs: string[] = [];
    const probe = await createContextContractProbe({ sourceSha: "68fac9b2b5e95ee57c53f0ac1f491210e153ed01", referenceNow: Date.parse(script.turns[0].receipt) }, value => {
      const proposal = frozenContextProposal(value, script.id, turnIndex); count++;
      const canonical = JSON.stringify(SelectedInterpretationSchema.parse(proposal));
      const wireOutput = JSON.stringify(encodeFixtureV3(proposal));
      const request = serializeSelectedRequest(value);
      const name = `${script.id}_dispatch_${count}`;
      artifacts.push({ case: name, prompt: CONTEXT_CONTRACT_PROMPT, inputJson: JSON.stringify(value), schemaJson: JSON.stringify(targetSchema), wireJson: JSON.stringify(request), outputJson: wireOutput });
      artifacts.push({ case: `${name}_canonical_output`, prompt: CONTEXT_CONTRACT_PROMPT, inputJson: JSON.stringify(value), schemaJson: JSON.stringify(targetSchema), wireJson: JSON.stringify(request), outputJson: canonical });
      outputs.push(canonical);
      return proposal;
    });
    try {
      for (const turn of script.turns) {
        await probe.turn(turn.text.includes("{{ISSUED_TOKEN}}") ? turn.text.replaceAll("{{ISSUED_TOKEN}}", probe.issuedControlToken()) : turn.text, turn.receipt, undefined, turn.processingAt);
        turnIndex++;
        const snapshot = probe.snapshot();
        const value = probe.inputs.at(-1);
        if (snapshot && value) {
          const encoded = encodeContextSnapshotV2(snapshot);
          const measured = measureSelectedEnvelope(value, encoded, outputs.at(-1));
          expect(measured.reasons, script.id).toEqual(["TOKEN_BOUND_UNVERIFIED"]);
          expect(measured.bytes.snapshot).toBeLessThanOrEqual(16384);
          expect(measured.admitted).toBe(false);
          measurements.push({ script: script.id, turn: turn.text, encodedSnapshotSha256: digest(encoded), ...measured });
        }
      }
    } finally { probe.dispose(); }
  }
  expect(artifacts.length).toBeGreaterThan(20);
  const all = ["regressions", "development", "heldout"].map(name => admitContextManifest(JSON.parse(readFileSync(`src/modules/conversation/context-contract/benchmark/${name}.json`, "utf8"))));
  const planned = expandContextCampaign({ version: "context-contract-corpus-1", cases: all.flatMap(m => m.cases) } as ContextManifest, "FULL");
  const candidates = new Map<string, Parameters<typeof measureLocalTokenArtifacts>[0]>();
  const observed = await runContextFixtureCampaign(planned, { sourceSha: "68fac9b2b5e95ee57c53f0ac1f491210e153ed01", referenceNow: Date.parse("2026-09-28T03:00:00Z") }, (value, id, index) => {
    const proposal = frozenContextProposal(value, id, index), parsed = SelectedInterpretationSchema.safeParse(proposal);
    if (parsed.success) {
      const wire = serializeSelectedRequest(value), common = { prompt: CONTEXT_CONTRACT_PROMPT, inputJson: JSON.stringify(value), schemaJson: JSON.stringify(targetSchema), wireJson: JSON.stringify(wire) };
      candidates.set(`${id}:${index}`, [{ ...common, case: `FULL_${id}_${index}_wire`, outputJson: JSON.stringify(encodeFixtureV3(parsed.data)) }, { ...common, case: `FULL_${id}_${index}_canonical`, outputJson: JSON.stringify(parsed.data) }]);
    }
    return proposal;
  });
  for (const script of observed) for (const [index, actual] of script.turns.entries()) if (actual.fullSchemaValid && actual.status !== "FAILED") artifacts.push(...(candidates.get(`${script.id}:${index}`) ?? []));
  const common = artifacts[0];
  artifacts.push({ ...common, case: "wire9_immutable_schema_same_input", schemaJson: JSON.stringify(baselineSchema), wireJson: JSON.stringify({ ...JSON.parse(common.wireJson), response_format: { type: "json_schema", json_schema: legacyV2GoogleLiteEuContextWireSchema() } }) });
  const long = "ế".repeat(2000);
  const evidence = [quote(0, long), quote(0, long), quote(0, long)];
  const worst = SelectedInterpretationSchema.parse({ schemaVersion: "calenote-context-3", intent: "CREATE_REMINDER", requestTarget: { kind: "NEW", evidence: [quote(0, long)] }, changes: [{ field: "notes", operation: "SET", value: long, evidence }], query: null, uncertainties: [{ field: "notes", reason: "AMBIGUOUS", alternatives: [{ value: long, evidence }, { value: long, evidence }] }], conversationDirective: { kind: "HELP", topic: "GENERAL" }, replyProposal: { text: "ế".repeat(400) } });
  artifacts.push({ ...common, case: "schema_maximal_notes_evidence_canonical_not_product_accepted", outputJson: JSON.stringify(worst) });
  artifacts.push({ ...common, case: "schema_maximal_notes_evidence_wire_not_product_accepted", outputJson: JSON.stringify(encodeFixtureV3(worst)) });
  const oversized = await createContextContractProbe({ sourceSha: "a".repeat(40), referenceNow: Date.parse("2026-09-28T03:00:00Z") }, () => worst);
  try {
    const actual = await oversized.turn("Mai 8h nhắc gọi mẹ", "2026-09-28T03:00:00Z");
    expect(actual).toMatchObject({ status: "REJECTED", dispatches: 1, mutations: 0, fullSchemaValid: false });
    expect(oversized.snapshot()).toBeNull();
    expect(utf8(JSON.stringify(encodeFixtureV3(worst)))).toBeGreaterThan(32768);
  } finally { oversized.dispose(); }
  const evidenceResult = measureLocalTokenArtifacts(artifacts);
  expect(evidenceResult.provenance.networkGuardActive).toBe(true);
  expect(evidenceResult.provenance.networkAttemptsAfterSelfCheck).toEqual([]);
  for (const row of evidenceResult.rows.filter(r => !r.case.startsWith("schema_maximal"))) {
    expect(row.applicationTextTokens, row.case).toBeLessThanOrEqual(12000);
    expect(row.outputTextTokens, row.case).toBeLessThanOrEqual(1536);
    expect(row.routeFramingTokens).toBe("UNKNOWN");
  }
  expect(evidenceResult.rows.find(r => r.case === "schema_maximal_notes_evidence_wire_not_product_accepted")!.outputTextTokens).toBeGreaterThan(1536);
  expect(digest(JSON.stringify(InterpretationJsonSchema))).toBe("8f1b868f606fd39972adc8984666f62960bf6c6f5ad38ff64774997b8765ba2d");
  expect(digest(JSON.stringify(SelectedInterpretationJsonSchema))).toBe("43b6689ce9c4874c4d532652ea212b52aa7d7f222cddd55377e59d483f5c444b");
  const paths = ["src/modules/conversation/context-contract/contracts.ts", "src/modules/conversation/context-contract/prompt.ts", "src/modules/conversation/context-contract/wire.ts", "src/modules/intelligence/infrastructure/openrouter/context-provider-wire.ts", "src/modules/intelligence/infrastructure/openrouter/provider-wire-schema.ts", "src/modules/intelligence/infrastructure/openrouter/semantic-gateway.test.ts"];
  const report = { revision: "context-authority-v3-A6", method: "recursive-all-object-array-v1+pinned-local-tokenizer-offline-1", immutableBaseline: { sourceSha: "899b1f25f38d4d4afcd7429ffbb10c91851c25e3", sourceHashes: Object.fromEntries(paths.map(path => [path, digest(execFileSync("git", ["show", `899b1f25f38d4d4afcd7429ffbb10c91851c25e3:${path}`], { encoding: "utf8" }))])), exactSerializedSchemaSha256: digest(JSON.stringify(baselineSchema)), ...schemaMetrics(baselineSchema) }, target: { sourceBaseSha: "68fac9b2b5e95ee57c53f0ac1f491210e153ed01", sourceHashes: Object.fromEntries(paths.map(path => [path, digest(readFileSync(path, "utf8"))])), exactSerializedSchemaSha256: digest(JSON.stringify(targetSchema)), promptSha256: digest(CONTEXT_CONTRACT_PROMPT), ...schemaMetrics(targetSchema) }, routeAdmission: "UNVERIFIED", applicationProviderCalls: 0, providerCountingCalls: 0, caveat: "Same V3 input/prompt isolates schema bytes, not a legacy runtime replay. Maximal output is schema-only, not accepted grounding. No Google private validator-state claim.", evidence: evidenceResult, actualV3EnvelopeMeasurements: measurements, artifacts: artifacts.map(a => ({ case: a.case, inputSha256: digest(a.inputJson), wireSha256: digest(a.wireJson), outputSha256: a.outputJson && digest(a.outputJson), outputUtf8Bytes: a.outputJson && utf8(a.outputJson) })) };
  if (process.env.CONTEXT_FIT_V3_REPORT === "1") writeFileSync("docs/benchmarks/llm-context-contract-authority-v3-measurements.json", JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ baseline: report.immutableBaseline, target: report.target, ordinaryRows: artifacts.length - 2, actualEnvelopeRows: measurements.length }));
}, 60000);

const input = ContextInputSchema.parse({
  schemaVersion: "calenote-context-input-1",
  reference: { instant: "2026-09-28T03:00:00.000Z", localDate: "2026-09-28", timezone: "Asia/Ho_Chi_Minh" },
  turns: [{ role: "USER", text: "Mai 8h nhắc gọi mẹ" }], currentTurn: 0,
  activeRequest: null, facts: [], pendingQuestion: null, ambiguities: [],
  capabilities: { version: "context-capabilities-1", supported: ["ONCE", "FINITE_DAILY", "LIST", "CALENDAR_DATE"], unsupported: ["WEEKLY", "MONTHLY", "YEARLY"], calendars: ["GREGORIAN", "LUNAR_VN"], limits: { dailyCount: 30, horizonDays: 366 } },
});
const output = { schemaVersion: "calenote-context-2", intent: "CREATE_REMINDER", dialogueAct: "NEW_REQUEST", continuation: "NO", changes: [
  { field: "title", operation: "SET", value: "gọi mẹ", evidence: [{ kind: "USER_QUOTE", turn: 0, quote: "gọi mẹ", occurrence: 1 }] },
], query: null, uncertainties: [], controlEvidence: [], conversationDirective: { kind: "PRESENT_PREVIEW" }, replyProposal: null };

const utf8 = (value: string) => Buffer.byteLength(value, "utf8");
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const quote = (turn: number, text: string, occurrence = 1) => ({ kind: "USER_QUOTE", turn, quote: text, occurrence });
const change = (field: string, value: unknown, turn: number, text: string) => ({ field, operation: "SET", value, evidence: [quote(turn, text)] });
const proposal = (changes: unknown[], extra: Record<string, unknown> = {}) => ConversationInterpretationSchema.parse({ ...output, changes, ...extra });
const at = "2026-09-28T03:00:00.000Z";
const clock9 = { hour: 9, minute: 0, qualifier: "H24" };
const examDate = { kind: "CIVIL_DATE", calendar: "GREGORIAN", day: 11, month: 10, year: null, leapMonth: null };
const examTurns = ["Ngày 11/10 đi thi ở Quang Trung, nhớ mang giấy tờ.", "Nhắc hai ngày liên tiếp trước hôm thi.", "8h.", "Đổi sang 9h."];
// Test-only literal serialization samples. These are not a context builder,
// projector, state machine, provenance validator or multi-turn evaluator.
function sampleInput(texts: string[], retained: Record<string, unknown> = {}): ContextInput {
  const facts = Object.entries(retained).map(([field, value], i) => ({ alias: `f${i + 1}`, scope: "REMINDER", field, value, provenance: { kind: "EXPLICIT_USER" }, sourceReferenceTime: at, dependencies: [] }));
  const slots = Object.fromEntries(SLOT_NAMES.map(field => {
    const fact = facts.find(f => f.field === field);
    return [field, { state: fact ? "RESOLVED" : "MISSING", value: fact?.value ?? null, fact: fact?.alias ?? null }];
  }));
  return ContextInputSchema.parse({ ...input,
    turns: texts.flatMap((text, i) => i === texts.length - 1 ? [{ role: "USER", text: text.normalize("NFC") }] : [{ role: "USER", text: text.normalize("NFC") }, { role: "ASSISTANT", text: "Bạn muốn được nhắc lúc mấy giờ?" }]),
    currentTurn: texts.length * 2 - 2, facts,
    activeRequest: facts.length ? { lifecycle: "CLARIFYING", slots } : null,
    pendingQuestion: facts.length ? { text: "Bạn muốn được nhắc lúc mấy giờ?", scope: "REMINDER", field: "reminderTime", decisionKind: null, reason: "MISSING" } : null,
  });
}
function snapshotSample(value: ContextInput, originals = value.turns.map(t => t.text), candidate: unknown = null) {
  // Only literal groundings for this fixed specimen corpus. No language parsing,
  // resolution, projection or accepted-state transition is implemented here.
  const groundings: Record<string, { text: string; quote: string; start: number; end: number }> = {
    title: { text: examTurns[0], quote: "đi thi", start: 11, end: 17 },
    location: { text: examTurns[0], quote: "Quang Trung", start: 20, end: 31 },
    notes: { text: examTurns[0], quote: "nhớ mang giấy tờ", start: 33, end: 49 },
    eventDate: { text: examTurns[0], quote: "Ngày 11/10", start: 0, end: 10 },
    frequency: { text: examTurns[1], quote: "hai ngày liên tiếp", start: 5, end: 23 },
    occurrenceCount: { text: examTurns[1], quote: "hai ngày liên tiếp", start: 5, end: 23 },
    eventRelation: { text: examTurns[1], quote: "trước hôm thi", start: 24, end: 37 },
    reminderDate: { text: "mai nhắc tui gọi khách", quote: "mai", start: 0, end: 3 },
    reminderTime: { text: examTurns[2], quote: "8h.", start: 0, end: 3 },
  };
  const slots = Object.fromEntries(SLOT_NAMES.map(field => {
    const fact = value.facts.find(f => f.field === field);
    const base = value.activeRequest?.slots[field] ?? { state: "MISSING", value: null, fact: null };
    if (!fact) return [field, { ...base, evidence: [], provenance: null, resolution: null, proposalRevision: 3 }];
    let grounding = groundings[field];
    if (fact.value === "gọi khách") grounding = { text: "mai nhắc tui gọi khách", quote: "gọi khách", start: 13, end: 22 };
    if (typeof fact.value === "string" && ["title", "location", "notes"].includes(field) && fact.value.startsWith("ế")) grounding = { text: fact.value, quote: fact.value, start: 0, end: [...fact.value].length };
    if (field === "reminderTime" && typeof fact.value === "object" && fact.value !== null && "hour" in fact.value && fact.value.hour === 9) grounding = { text: examTurns[3], quote: "Đổi sang 9h.", start: 0, end: 12 };
    const turn = value.turns.findIndex(t => t.role === "USER" && t.text === grounding.text);
    return [field, { ...base, evidence: [{ kind: "USER_QUOTE", sourceTurnId: `synthetic-turn-${turn}`, sourceMapTurnId: `synthetic-turn-${turn}`, quote: grounding.quote, occurrence: 1, sourceSpan: { start: grounding.start, end: grounding.end }, viewSpan: { start: grounding.start, end: grounding.end }, normalizationVersion: "nfc-codepoint-v1" }], provenance: fact.provenance,
      resolution: { method: "EXPLICIT_OPERAND", version: "synthetic-resolution-v1", referenceTime: at, timezone: "Asia/Ho_Chi_Minh", dependencies: [] }, proposalRevision: 3 }];
  }));
  return {
    schemaVersion: "calenote-context-state-1", scope: { ownerId: "synthetic-owner", workspaceId: "synthetic-workspace", connectionId: "synthetic-connection", chatId: "synthetic-chat" },
    inbound: { id: "synthetic-inbound", receivedAt: at, rowid: 7, claimMarker: "synthetic-claim" },
    requestId: "synthetic-request", contextRevision: 4, draftRevision: 3, lifecycle: "CLARIFYING",
    slots, facts: value.facts.map(f => ({ ...f, evidenceSlot: f.field })),
    pendingReminderQuestion: value.pendingQuestion, pendingQueryQuestion: null, ambiguities: value.ambiguities,
    transcript: value.turns.map((t, i) => ({ id: `synthetic-turn-${i}`, role: t.role, text: originals[i], receivedAt: at, kind: t.role === "USER" ? "RECEIVED" : "CLARIFICATION", deliveryState: t.role === "USER" ? "RECEIVED" : "SENT", semanticView: t.text,
      sourceMap: { normalizationVersion: "nfc-codepoint-v1", sourceCodePoints: [...originals[i]].length, viewCodePoints: [...t.text].length, segments: [{ sourceStart: 0, sourceEnd: [...originals[i]].length, viewStart: 0, viewEnd: [...t.text].length, kind: originals[i] === t.text ? "UNCHANGED" : "NFC_COMPOSITION_RUN", sourceStride: originals[i] === t.text ? 1 : 3, viewStride: 1 }] } })),
    pendingDecision: { kind: "REPLACE_PENDING", target: { ownerId: "synthetic-owner", chatId: "synthetic-chat", requestId: "synthetic-request" }, questionId: "synthetic-question", previewId: "synthetic-preview", draftRevision: 3, contextRevision: 4, issuedAfterInbound: { receivedAt: at, rowid: 7 }, deliveryState: "SENT", expiresAt: "2026-09-28T03:10:00.000Z", acceptedReplies: ["có", "ok", "1"], candidate },
    previewReceipt: { previewId: "synthetic-preview", draftRevision: 3, draftHash: "a".repeat(64), ownerId: "synthetic-owner", chatId: "synthetic-chat", issuedAfterOrder: { receivedAt: at, rowid: 7 }, expiresAt: "2026-09-28T03:10:00.000Z", deliveryState: "SENT" },
    controlRegistry: [{ handle: "CN-SYNTHETIC-TOKEN", ownerId: "synthetic-owner", chatId: "synthetic-chat", decisionId: "synthetic-decision", expiresAt: "2026-09-28T03:10:00.000Z" }],
    modelAttemptBinding: { contextRevision: 4, sourceInboundId: "synthetic-inbound" }, createdAt: at, idleExpiresAt: "2026-09-28T03:30:00.000Z", absoluteExpiresAt: "2026-09-28T05:00:00.000Z", draftExpiresAt: "2026-09-28T03:10:00.000Z", capabilityVersion: "context-capabilities-1",
  };
}
type Specimen = { name: string; input: ContextInput; snapshot: string; output: string; expectedReasons: string[]; schemaValid: boolean };
const specimens: Specimen[] = [];
let finalizedStateMeasurements: unknown[] = [];
function add(name: string, value: ContextInput, out: unknown, expectedReasons: string[] = [], snapshot = JSON.stringify(snapshotSample(value))) {
  ContextInputSchema.parse(value);
  const valid = ConversationInterpretationSchema.parse(out);
  specimens.push({ name, input: value, snapshot, output: JSON.stringify(valid), expectedReasons, schemaValid: true });
}
const simple = proposal([change("title", "gọi mẹ", 0, "gọi mẹ"), change("reminderDate", { kind: "RELATIVE_DAY", offsetDays: 1 }, 0, "Mai"), change("reminderTime", { hour: 8, minute: 0, qualifier: "H24" }, 0, "8h")]);
add("simple_create", input, simple);
add("two_turn_start", sampleInput(["mai nhắc tui gọi khách"]), proposal([change("title", "gọi khách", 0, "gọi khách"), change("reminderDate", { kind: "RELATIVE_DAY", offsetDays: 1 }, 0, "mai")], { uncertainties: [{ field: "reminderTime", reason: "MISSING", alternatives: [] }] }));
add("two_turn_complete", sampleInput(["mai nhắc tui gọi khách", "9h"], { title: "gọi khách", reminderDate: { kind: "RELATIVE_DAY", offsetDays: 1 } }), proposal([change("reminderTime", clock9, 2, "9h")], { dialogueAct: "CONTINUE", continuation: "YES" }));
const examFacts = { title: "đi thi", location: "Quang Trung", notes: "nhớ mang giấy tờ", eventDate: examDate };
const examProposals = [
  proposal([change("title", "đi thi", 0, "đi thi"), change("location", "Quang Trung", 0, "Quang Trung"), change("notes", "nhớ mang giấy tờ", 0, "nhớ mang giấy tờ"), change("eventDate", examDate, 0, "Ngày 11/10")], { uncertainties: [{ field: "reminderTime", reason: "MISSING", alternatives: [] }] }),
  proposal([change("frequency", "DAILY", 2, "hai ngày liên tiếp"), change("occurrenceCount", 2, 2, "hai ngày liên tiếp"), change("eventRelation", "BEFORE_EVENT", 2, "trước hôm thi")], { dialogueAct: "CONTINUE", continuation: "YES" }),
  proposal([change("reminderTime", { hour: 8, minute: 0, qualifier: "H24" }, 4, "8h.")], { dialogueAct: "CONTINUE", continuation: "YES" }),
  proposal([change("reminderTime", clock9, 6, "Đổi sang 9h.")], { dialogueAct: "EDIT", continuation: "YES" }),
];
examProposals.forEach((out, i) => add(`exam_turn_${i + 1}`, sampleInput(examTurns.slice(0, i + 1), i === 0 ? {} : { ...examFacts, ...(i >= 2 ? { frequency: "DAILY", occurrenceCount: 2, eventRelation: "BEFORE_EVENT" } : {}), ...(i >= 3 ? { reminderTime: { hour: 8, minute: 0, qualifier: "H24" } } : {}) }), out));
const correction = "Đổi sang 9h, địa điểm ở Quang Trung, ghi chú nhớ mang giấy tờ.";
add("multi_field_correction", sampleInput([examTurns[0], correction], examFacts), proposal([change("reminderTime", clock9, 2, "Đổi sang 9h"), change("location", "Quang Trung", 2, "địa điểm ở Quang Trung"), change("notes", "nhớ mang giấy tờ", 2, "ghi chú nhớ mang giấy tờ")], { dialogueAct: "EDIT", continuation: "YES" }));
for (const [field, length] of [["title", 1800], ["location", 300], ["notes", 2000]] as const) {
  const long = "ế".repeat(length);
  const value = sampleInput([long, "Giữ nguyên."], { [field]: long });
  add(`maximum_${field}`, value, proposal([{ field, operation: "SET", value: long, evidence: [{ kind: "CONTEXT_FACT", ref: "f1" }] }], { dialogueAct: "CONTINUE", continuation: "YES" }), field === "location" ? [] : ["CONTEXT_SNAPSHOT_TOO_LARGE"]);
}
for (const field of ["title", "notes"] as const) for (const length of [900, 600]) {
  const long = "ế".repeat(length);
  add(`long_${field}_${length}`, sampleInput([long, "Giữ nguyên."], { [field]: long }), proposal([{ field, operation: "SET", value: long, evidence: [{ kind: "CONTEXT_FACT", ref: "f1" }] }], { dialogueAct: "CONTINUE", continuation: "YES" }), length === 900 ? ["CONTEXT_SNAPSHOT_TOO_LARGE"] : []);
}
const combinedFacts = { title: "ế".repeat(1800), location: "ế".repeat(300), notes: "ế".repeat(2000) };
const combinedInput = sampleInput([combinedFacts.title, combinedFacts.location, combinedFacts.notes, "Giữ nguyên."], combinedFacts);
add("long_combined", combinedInput, proposal(Object.entries(combinedFacts).map(([field, value], i) => ({ field, operation: "SET", value, evidence: [{ kind: "CONTEXT_FACT", ref: `f${i + 1}` }] }))), ["CONTEXT_SNAPSHOT_TOO_LARGE"]);
const escaped = 'Nhớ "giấy tờ" \\ hồ sơ\nnhớ mang giấy tờ; nhớ mang giấy tờ';
for (const refs of [1, 2, 3]) add(`escaped_refs_${refs}`, sampleInput([escaped]), proposal([{ field: "notes", operation: "SET", value: escaped, evidence: [quote(0, '"giấy tờ" \\ hồ sơ\n'), quote(0, "nhớ mang giấy tờ", 1), quote(0, "nhớ mang giấy tờ", 2)].slice(0, refs) }]));
const ambiguities = ["eventDate", "reminderDate", "endDate", "eventTime"].map(field => ({ field, reason: "AMBIGUOUS", alternatives: field === "eventTime" ? [{ value: { hour: 8, minute: 0, qualifier: "AM" }, evidence: [quote(4, "8h")] }, { value: { hour: 8, minute: 0, qualifier: "PM" }, evidence: [quote(4, "8h")] }] : [{ value: { kind: "RELATIVE_DAY", offsetDays: 1 }, evidence: [quote(4, "mai")] }, { value: { kind: "RELATIVE_DAY", offsetDays: 2 }, evidence: [quote(4, "mốt")] }] }));
const uncertainInput = ContextInputSchema.parse({ ...sampleInput([examTurns[0], "Mai 8h nhắc gọi mẹ", "mai hay mốt lúc 8h"], examFacts), ambiguities });
const candidateProposal = proposal([change("title", "gọi mẹ", 2, "gọi mẹ"), change("reminderDate", { kind: "RELATIVE_DAY", offsetDays: 1 }, 2, "Mai"), change("reminderTime", { hour: 8, minute: 0, qualifier: "H24" }, 2, "8h")]);
add("four_uncertainties_candidate", uncertainInput, proposal([], { intent: "AMBIGUOUS", dialogueAct: "AMBIGUOUS", continuation: "UNCERTAIN", uncertainties: ambiguities }), [], JSON.stringify(snapshotSample(uncertainInput, undefined, {
  proposal: candidateProposal, sourceEvidence: [quote(2, "Mai 8h nhắc gọi mẹ")], sourceTurnId: "synthetic-turn-2", sourceText: "Mai 8h nhắc gọi mẹ", sourceSpan: { start: 0, end: 18 }, normalizationVersion: "nfc-codepoint-v1",
  evidenceIndex: [
    { field: "title", sourceTurnId: "synthetic-turn-2", sourceSpan: { start: 12, end: 18 }, viewSpan: { start: 12, end: 18 }, sourceMapTurnId: "synthetic-turn-2", normalizationVersion: "nfc-codepoint-v1" },
    { field: "reminderDate", sourceTurnId: "synthetic-turn-2", sourceSpan: { start: 0, end: 3 }, viewSpan: { start: 0, end: 3 }, sourceMapTurnId: "synthetic-turn-2", normalizationVersion: "nfc-codepoint-v1" },
    { field: "reminderTime", sourceTurnId: "synthetic-turn-2", sourceSpan: { start: 4, end: 6 }, viewSpan: { start: 4, end: 6 }, sourceMapTurnId: "synthetic-turn-2", normalizationVersion: "nfc-codepoint-v1" },
  ],
})));
const twelveInput = sampleInput([examTurns[0], examTurns[1], examTurns[2], examTurns[3], "Giữ địa điểm.", "Giữ ghi chú."], { ...examFacts, reminderTime: clock9, frequency: "DAILY", occurrenceCount: 2, eventRelation: "BEFORE_EVENT" });
twelveInput.turns.unshift({ role: "ASSISTANT", text: "Bạn cần nhắc việc gì?" }); twelveInput.currentTurn++;
add("six_user_six_assistant", twelveInput, proposal([], { dialogueAct: "CONTINUE", continuation: "YES" }));
const boundaryInput = structuredClone(twelveInput);
const missing = 16384 - utf8(JSON.stringify(snapshotSample(boundaryInput)));
// Fill actual assistant source/view, recalculate maps, then use the final few
// bytes in an internal synthetic request identity (not hidden padding).
boundaryInput.turns[0].text += "x".repeat(Math.floor(missing / 2) - 16);
const boundarySnapshot = snapshotSample(boundaryInput);
boundarySnapshot.requestId += "x".repeat(16384 - utf8(JSON.stringify(boundarySnapshot)));
const boundaryJson = JSON.stringify(boundarySnapshot);
add("snapshot_16384", boundaryInput, proposal([]), [], boundaryJson);
add("snapshot_16385", boundaryInput, proposal([]), ["CONTEXT_SNAPSHOT_TOO_LARGE"], JSON.stringify({ ...boundarySnapshot, requestId: boundarySnapshot.requestId + "x" }));
const projectedInput = sampleInput([examTurns[0], "[CONTROL] Đổi sang 9h."], examFacts);
const projectedSnapshot = snapshotSample(projectedInput, [examTurns[0], "Bạn muốn được nhắc lúc mấy giờ?", "CN-SYNTHETIC-TOKEN Đổi sang 9h."]);
projectedSnapshot.transcript[2].sourceMap.segments = [
  { sourceStart: 0, sourceEnd: 18, viewStart: 0, viewEnd: 9, kind: "CONTROL_REPLACEMENT", sourceStride: 0, viewStride: 0 },
  { sourceStart: 18, sourceEnd: 31, viewStart: 9, viewEnd: 22, kind: "UNCHANGED", sourceStride: 1, viewStride: 1 },
];
add("control_projection_literal", projectedInput, proposal([change("reminderTime", clock9, 2, "Đổi sang 9h.")], { dialogueAct: "EDIT", continuation: "YES" }), [], JSON.stringify(projectedSnapshot));

// Amendment specimens retain the complete original semantic fields/evidence.
const guidanceCases = ["guidance_null", "guidance_ordinary", "guidance_max_400", "guidance_max_supplementary_400", "guidance_escaped_unicode", "guidance_ambiguity", "guidance_multi_field_correction", "guidance_retained_selected"];
for (const [name, base, conversationDirective, replyProposal] of [
  ["guidance_null", "two_turn_start", { kind: "ASK_FOR_FIELD", field: "reminderTime" }, null],
  ["guidance_ordinary", "two_turn_start", { kind: "ASK_FOR_FIELD", field: "reminderTime" }, { text: "Bạn muốn được nhắc lúc mấy giờ?" }],
  ["guidance_max_400", "two_turn_start", { kind: "ASK_FOR_FIELD", field: "reminderTime" }, { text: "ế".repeat(400) }],
  ["guidance_max_supplementary_400", "two_turn_start", { kind: "ASK_FOR_FIELD", field: "reminderTime" }, { text: "😀".repeat(400) }],
  ["guidance_escaped_unicode", "escaped_refs_3", { kind: "ASK_FOR_FIELD", field: "reminderTime" }, { text: 'Bạn muốn nhắc vào "buổi sáng" hay buổi chiều? 😀' }],
  ["guidance_ambiguity", "four_uncertainties_candidate", { kind: "ASK_FOR_DISAMBIGUATION", field: "eventDate", reason: "AMBIGUOUS" }, { text: "Bạn muốn chọn ngày nào trong hai ngày vừa nhắc đến?" }],
  ["guidance_multi_field_correction", "multi_field_correction", { kind: "ASK_FOR_FIELD", field: "eventRelation" }, { text: "Bạn muốn được nhắc trước hay trong ngày diễn ra sự kiện?" }],
] as const) {
  const original = specimens.find(s => s.name === base)!;
  add(name, original.input, { ...JSON.parse(original.output), conversationDirective, replyProposal }, original.expectedReasons, original.snapshot);
}
const retainedSelected = structuredClone(twelveInput);
for (const t of retainedSelected.turns) if (t.role === "ASSISTANT") t.text = "Bạn muốn mình làm rõ điều gì trong yêu cầu này?";
add("guidance_retained_selected", retainedSelected, proposal([], { dialogueAct: "CONTINUE", continuation: "YES", conversationDirective: { kind: "ASK_FOR_FIELD", field: "operation" }, replyProposal: { text: "Bạn muốn mình làm rõ điều gì trong yêu cầu này?" } }));

describe("full specimen measurements", () => {
  it("amended_corpus_accounts_for_guidance_without_displacing_semantic_fields", () => {
    for (const name of guidanceCases) {
      const sample = specimens.find(s => s.name === name);
      expect(sample, name).toBeDefined();
      const decoded = JSON.parse(sample!.output);
      expect(Object.keys(decoded)).toEqual(expect.arrayContaining(["conversationDirective", "replyProposal", "changes", "uncertainties", "controlEvidence"]));
      expect(ConversationInterpretationSchema.safeParse(decoded).success).toBe(true);
    }
    expect(JSON.parse(specimens.find(s => s.name === "guidance_max_400")!.output).replyProposal.text).toHaveLength(400);
    expect(JSON.parse(specimens.find(s => s.name === "guidance_multi_field_correction")!.output).changes).toHaveLength(3);
  });
  it("finalized_application_state_is_strict_lossless_and_ordinary_flows_fit", () => {
    // Keep the original T0 byte specimens and classifications above as history.
    // T1 measurement adds every finalized mandatory binding to those same data;
    // this strict runtime schema, not a benchmark state type, is the authority.
    const rows = specimens.map(s => {
      const legacy = JSON.parse(s.snapshot);
      const fullScope = { ...legacy.scope, chatIdentityId: "synthetic-chat-identity" };
      const oldCandidate = legacy.pendingDecision.candidate;
      const sourceEvidence = (turnId: string, quote: string, sourceSpan: { start: number; end: number }, viewSpan = sourceSpan) => ({ kind: "USER_QUOTE", sourceTurnId: turnId, sourceMapTurnId: turnId, quote, occurrence: 1, sourceSpan, viewSpan, normalizationVersion: "nfc-codepoint-v1" });
      const candidate = oldCandidate ? {
        proposalId: "synthetic-proposal", proposalRevision: 1, proposal: (() => { const parsed = parseInterpretationSections(oldCandidate.proposal); if (parsed.status !== "PARSED") throw new Error(parsed.reason); return parsed.value.semantic; })(),
        sourceEvidence: [sourceEvidence(oldCandidate.sourceTurnId, oldCandidate.sourceText, oldCandidate.sourceSpan)],
        evidenceIndex: oldCandidate.evidenceIndex.map((e: { field: string; sourceTurnId: string; sourceSpan: { start: number; end: number }; viewSpan: { start: number; end: number } }) => ({ field: e.field, evidence: [sourceEvidence(e.sourceTurnId, [...oldCandidate.sourceText].slice(e.viewSpan.start, e.viewSpan.end).join(""), e.sourceSpan, e.viewSpan)] })),
        createdAt: at, expiresAt: legacy.draftExpiresAt,
      } : null;
      const logical = ContextSnapshotV1Schema.parse({ ...legacy,
        id: "synthetic-context", scope: fullScope, draftCreatedAt: at, lastTerminalOutcome: null,
        pendingReminderQuestion: legacy.pendingReminderQuestion ? { ...legacy.pendingReminderQuestion, questionId: "synthetic-question", noProgressCount: 0, deliveryState: "SENT", issuedAfterOrder: { receivedAt: at, rowid: 7 } } : null,
        transcript: legacy.transcript.map((t: object) => ({ ...t, messageRef: "synthetic-message", controlSpans: [] })),
        pendingDecision: { ...legacy.pendingDecision, decisionId: "synthetic-decision", kind: candidate ? "REPLACE_PENDING" : "RESUME_PENDING", target: { ...legacy.pendingDecision.target, requestId: legacy.requestId, chatIdentityId: fullScope.chatIdentityId, proposalId: candidate?.proposalId ?? null }, replyReference: null, tokenHandle: "CN-SYNTHETIC-TOKEN", candidate },
        previewReceipt: { ...legacy.previewReceipt, requestId: legacy.requestId, chatIdentityId: fullScope.chatIdentityId, channel: "ZALO", replyReference: "synthetic-preview-message" },
        controlRegistry: legacy.controlRegistry.map((c: object) => ({ ...c, kind: "TOKEN", chatIdentityId: fullScope.chatIdentityId, contextRevision: 4, draftRevision: 3 })),
        modelAttemptBinding: { ...legacy.modelAttemptBinding, attemptId: "synthetic-attempt", observationId: "synthetic-observation", claimMarker: "synthetic-claim", inputDigest: "b".repeat(64), promptDigest: "c".repeat(64), contractDigest: "d".repeat(64), contractVersion: "calenote-context-2", status: "ACCEPTED" },
      });
      const encoded = encodeContextSnapshot(logical);
      const measurement = measureEnvelope(s.input, encoded, s.output);
      if (utf8(encoded) <= 16384) expect(decodeContextSnapshot(encoded), s.name).toEqual(logical);
      else expect(() => decodeContextSnapshot(encoded)).toThrow("storage limit");
      expect(measurement.admitted).toBe(false);
      // Historical size negatives may now fit; do not manufacture failures.
      if (!["maximum_title", "maximum_notes", "long_combined", "snapshot_16384", "snapshot_16385"].includes(s.name)) expect(measurement.reasons, s.name).toEqual(["TOKEN_BOUND_UNVERIFIED"]);
      return { case: s.name, historicalExpanded: utf8(s.snapshot), finalizedExpanded: utf8(JSON.stringify(logical)), finalizedEncoded: utf8(encoded), reasons: measurement.reasons, sha256: digest(encoded) };
    });
    if (process.env.CONTEXT_FIT_REPORT === "1") console.log(JSON.stringify({ finalizedStateMeasurements: rows }));
    finalizedStateMeasurements = rows;
  });
  it("required_900_codepoint_fields_fit_lossless_identity_view_storage", () => {
    for (const name of ["long_title_900", "long_notes_900"]) {
      const s = specimens.find(s => s.name === name)!;
      expect(utf8(s.snapshot)).toBe(18904); // Historical expanded representation.
      const encoded = encodeIdentityViews(s.snapshot);
      expect(utf8(encoded)).toBeLessThanOrEqual(16384);
      expect(decodeIdentityViews(encoded)).toBe(s.snapshot);
      expect(measureEnvelope(s.input, encoded, s.output).reasons).toEqual(["TOKEN_BOUND_UNVERIFIED"]);
    }
  });
  it("all_specimens_roundtrip_without_fact_source_mapping_or_expiry_loss", () => {
    for (const s of specimens) expect(decodeIdentityViews(encodeIdentityViews(s.snapshot))).toBe(s.snapshot);
  });
  it.skipIf(process.env.CONTEXT_FIT_LOCAL_TOKENS !== "1")("measures_known_text_and_full_schema_support_without_authorizing_a_route", () => {
    const unicodeSamples = [1799, 1800, 1801, 2000].flatMap(units => ["NFC", "DECOMPOSED", "SUPPLEMENTARY"].map(variant => {
      const raw = variant === "NFC" ? "ế".repeat(units) : variant === "DECOMPOSED" ? "e\u0302\u0301".repeat(units) : "😀".repeat(Math.floor(units / 2)) + (units % 2 ? "ế" : "");
      const input = sampleInput([raw]);
      const snapshot = JSON.stringify(snapshotSample(input, [raw]));
      return { name: `INPUT_${units}_${variant}`, input, snapshot };
    }));
    const long = "ế".repeat(2000);
    const oversized = JSON.stringify(proposal([{ field: "notes", operation: "SET", value: long, evidence: [quote(0, long), quote(0, long), quote(0, long)] }], { uncertainties: [{ field: "notes", reason: "AMBIGUOUS", alternatives: [{ value: long, evidence: [quote(0, long)] }, { value: long, evidence: [quote(0, long)] }] }] }));
    const encodedBoundary = JSON.parse(encodeIdentityViews(specimens.find(s => s.name === "snapshot_16384")!.snapshot));
    encodedBoundary.snapshot.requestId += "x".repeat(16384 - utf8(JSON.stringify(encodedBoundary)));
    const exactEncoded = JSON.stringify(encodedBoundary);
    encodedBoundary.snapshot.requestId += "x";
    const samples = [...specimens, ...unicodeSamples,
      { name: "encoded_snapshot_16384", input: boundaryInput, snapshot: decodeIdentityViews(exactEncoded), output: JSON.stringify(proposal([])) },
      { name: "encoded_snapshot_16385", input: boundaryInput, snapshot: decodeIdentityViews(JSON.stringify(encodedBoundary)), output: JSON.stringify(proposal([])) },
      { name: "oversized_output", input, snapshot: JSON.stringify(snapshotSample(input)), output: oversized },
      { name: "truncated_output", input, snapshot: JSON.stringify(snapshotSample(input)), output: oversized.slice(0, -1) }];
    const evidence = measureLocalTokens(samples, "LEGACY_V2_REFERENCE");
    if (process.env.CONTEXT_FIT_AMENDMENT_REPORT === "1") {
      writeFileSync("docs/benchmarks/llm-context-contract-conversation-guidance-v2-measurements.json", JSON.stringify({
        revision: "conversation-guidance-v2", contractVersion: "calenote-context-2", methodVersion: "pinned-local-tokenizer-offline-1", routeAdmission: "UNVERIFIED", applicationLlmCalls: 0, providerCountingCalls: 0,
        promptSha256: digest(CONTEXT_CONTRACT_PROMPT), schemaSha256: digest(JSON.stringify(InterpretationJsonSchema)), corpusSha256: digest(JSON.stringify(samples)),
        sources: Object.fromEntries(["contracts", "prompt", "wire", "admission", "guidance", "projection", "evidence"].map(name => [name, digest(readFileSync(`src/modules/conversation/context-contract/${name}.ts`, "utf8"))])),
        tooling: Object.fromEntries(["tools/benchmark/local-tokenizer.ts", "tools/benchmark/tokenizer/measure.py", "tools/benchmark/tokenizer/requirements.txt"].map(path => [path, digest(readFileSync(path, "utf8"))])),
        evidence, finalizedStateMeasurements,
        specimens: samples.map(s => ({ name: s.name, sha256: digest(JSON.stringify(s)), wireSha256: digest(JSON.stringify(serializeContextRequest(s.input))), outputSha256: "output" in s ? digest(s.output) : null, ...measureEnvelope(s.input, encodeIdentityViews(s.snapshot), "output" in s ? s.output : undefined) })),
      }, null, 2) + "\n");
    }
    expect(evidence.phase).toBe("OFFLINE_MEASUREMENT");
    expect(evidence.provenance.networkGuardActive).toBe(true);
    expect(evidence.provenance.networkAttemptsAfterSelfCheck).toEqual([]);
    for (const row of evidence.rows) {
      expect(row.applicationTextTokens).toBe(row.sdkTextProjectionTokens);
      expect(row.schemaSha256).toBe(digest(JSON.stringify(InterpretationJsonSchema)));
      expect(row.sdkFullStructuredTokens).toBeNull();
      expect(row.unsupportedSchema.length).toBeGreaterThan(0);
      expect(row.routeFramingTokens).toBe("UNKNOWN");
      const s = samples.find(s => s.name === row.case)!;
      expect(decodeIdentityViews(encodeIdentityViews(s.snapshot))).toBe(s.snapshot);
      expect(measureEnvelope(s.input, encodeIdentityViews(s.snapshot), "output" in s ? s.output : undefined).admitted).toBe(false);
    }
    const normal = evidence.rows.filter(row => ["simple_create", "two_turn_start", "two_turn_complete", "exam_turn_1", "exam_turn_2", "exam_turn_3", "exam_turn_4", "multi_field_correction", "long_title_900", "long_notes_900", "maximum_location"].includes(row.case));
    expect(normal).toHaveLength(11);
    for (const row of normal) {
      expect(row.applicationTextTokens).toBeLessThan(12000);
      expect(row.outputTextTokens).toBeLessThanOrEqual(1536);
    }
    const amended = evidence.rows.filter(row => guidanceCases.includes(row.case));
    expect(amended).toHaveLength(8);
    for (const row of amended) {
      expect(row.applicationTextTokens, row.case).toBeLessThanOrEqual(12000);
      expect(row.outputTextTokens, row.case).toBeLessThanOrEqual(1536);
    }
    if (process.env.CONTEXT_FIT_REPORT === "1") console.log(JSON.stringify({ localTokenEvidence: evidence, encodedSnapshotBytes: samples.map(s => {
      const encoded = encodeIdentityViews(s.snapshot);
      const m = measureEnvelope(s.input, encoded, "output" in s ? s.output : undefined);
      let outputSchemaValid: boolean | null = null;
      if ("output" in s) { try { outputSchemaValid = ConversationInterpretationSchema.safeParse(JSON.parse(s.output)).success; } catch { outputSchemaValid = false; } }
      return { case: s.name, expanded: utf8(s.snapshot), encoded: utf8(encoded), encodedSha256: digest(encoded), inputSchemaValid: ContextInputSchema.safeParse(s.input).success, outputSchemaValid, current: m.current, bytes: m.bytes, reasons: m.reasons, lossless: decodeIdentityViews(encoded) === s.snapshot };
    }) }));
  });
  it("retained_snapshot_slots_include_grounded_evidence_and_resolution_metadata", () => {
    for (const s of specimens) {
      const snapshot = JSON.parse(s.snapshot);
      for (const fact of s.input.facts) {
        const slot = snapshot.slots[fact.field];
        expect(slot.evidence, `${s.name}:${fact.field}`).toHaveLength(1);
        expect(slot.resolution).toMatchObject({ method: "EXPLICIT_OPERAND", version: "synthetic-resolution-v1", referenceTime: at, timezone: "Asia/Ho_Chi_Minh" });
        const ref = slot.evidence[0];
        const source = snapshot.transcript.find((t: { id: string }) => t.id === ref.sourceTurnId);
        expect(source?.role).toBe("USER");
        expect([...source.text].slice(ref.sourceSpan.start, ref.sourceSpan.end).join("")).toBe(ref.quote);
        expect([...source.semanticView].slice(ref.viewSpan.start, ref.viewSpan.end).join("")).toBe(ref.quote);
        expect(ref.normalizationVersion).toBe("nfc-codepoint-v1");
        expect(ref.sourceMapTurnId).toBe(source.id);
        expect(source.sourceMap.segments.some((segment: { kind: string; sourceStart: number; sourceEnd: number; viewStart: number; viewEnd: number }) => segment.kind === "UNCHANGED" && segment.sourceStart <= ref.sourceSpan.start && segment.sourceEnd >= ref.sourceSpan.end && segment.viewStart <= ref.viewSpan.start && segment.viewEnd >= ref.viewSpan.end)).toBe(true);
        expect(snapshot.facts.find((f: { alias: string }) => f.alias === fact.alias).evidenceSlot).toBe(fact.field);
      }
    }
  });
  it("uncertainty_and_control_samples_retain_exam_sources_and_candidate_quotes", () => {
    for (const name of ["four_uncertainties_candidate", "control_projection_literal"]) {
      const s = specimens.find(s => s.name === name)!;
      const snapshot = JSON.parse(s.snapshot);
      expect(snapshot.transcript.map((t: { text: string }) => t.text)).toContain(examTurns[0]);
      const candidate = snapshot.pendingDecision.candidate;
      if (candidate) for (const c of candidate.proposal.changes) for (const ref of c.evidence) {
        const source = snapshot.transcript[ref.turn];
        expect(source.role).toBe("USER");
        expect(source.text).toBe("Mai 8h nhắc gọi mẹ");
        const grounding = candidate.evidenceIndex.find((e: { field: string }) => e.field === c.field);
        expect(grounding.sourceTurnId).toBe(source.id);
        expect([...source.text].slice(grounding.sourceSpan.start, grounding.sourceSpan.end).join("")).toBe(ref.quote);
        expect([...source.semanticView].slice(grounding.viewSpan.start, grounding.viewSpan.end).join("")).toBe(ref.quote);
        expect(source.sourceMap.segments[0].kind).toBe("UNCHANGED");
        expect(source.sourceMap.segments[0].sourceEnd).toBe(18);
        expect(ref.occurrence).toBe(1);
      }
    }
  });
  it("boundary_snapshot_source_maps_cover_the_actual_retained_text", () => {
    const s = specimens.find(s => s.name === "snapshot_16384")!;
    const snapshot = JSON.parse(s.snapshot);
    for (const [i, turn] of snapshot.transcript.entries()) {
      expect(turn.sourceMap.sourceCodePoints).toBe([...turn.text].length);
      expect(turn.sourceMap.viewCodePoints).toBe([...turn.semanticView].length);
      expect(turn.semanticView).toBe(s.input.turns[i].text);
    }
  });
  it.each(specimens)("$name preserves complete serialized artifacts and reports actual limits", specimen => {
    const before = JSON.stringify(specimen);
    const m = measureEnvelope(specimen.input, specimen.snapshot, specimen.output);
    expect(m.reasons).toEqual([...specimen.expectedReasons, "TOKEN_BOUND_UNVERIFIED"]);
    expect(m.admitted).toBe(false);
    expect(m.inputTokens).toBeNull(); expect(m.outputTokens).toBeNull();
    expect(m.bytes.request).toBe(m.bytes.prompt + m.bytes.schema + m.bytes.input + m.bytes.framing);
    expect(JSON.parse(serializeContextRequest(specimen.input).messages[1].content)).toEqual(specimen.input);
    expect(JSON.stringify(specimen)).toBe(before);
  });
  it("exam_correction_keeps_location_notes_event_and_schedule_operands_on_wire", () => {
    const value = JSON.parse(serializeContextRequest(specimens.find(s => s.name === "exam_turn_4")!.input).messages[1].content);
    expect(value.activeRequest.slots.location.value).toBe("Quang Trung");
    expect(value.activeRequest.slots.notes.value).toBe("nhớ mang giấy tờ");
    expect(value.activeRequest.slots.eventDate.value).toEqual(examDate);
    expect(value.activeRequest.slots.occurrenceCount.value).toBe(2);
    expect(value.activeRequest.slots.eventRelation.value).toBe("BEFORE_EVENT");
    expect(examProposals[3].changes.map(c => c.field)).toEqual(["reminderTime"]);
  });
  it("reports_reproducible_numeric_matrix_and_artifact_digests", () => {
    const rows = specimens.map(s => {
      const m = measureEnvelope(s.input, s.snapshot, s.output);
      const raw = JSON.stringify({ choices: [{ message: { role: "assistant", content: s.output }, finish_reason: "stop" }] });
      return { case: s.name, utf16: m.current.utf16Units, cp: m.current.codePoints, input: m.bytes.input, snapshot: m.bytes.snapshot, request: m.bytes.request, framing: m.bytes.framing, output: m.bytes.output, syntheticRaw: utf8(raw), reasons: m.reasons.join(","), specimenSha256: digest(JSON.stringify(s)) };
    });
    expect(rows.find(r => r.case === "snapshot_16384")?.snapshot).toBe(16384);
    expect(rows.find(r => r.case === "snapshot_16385")?.snapshot).toBe(16385);
    if (process.env.CONTEXT_FIT_REPORT === "1") {
      console.log(JSON.stringify({ promptBytes: utf8(CONTEXT_CONTRACT_PROMPT), schemaBytes: utf8(JSON.stringify(InterpretationJsonSchema)), promptSha256: digest(CONTEXT_CONTRACT_PROMPT), schemaSha256: digest(JSON.stringify(InterpretationJsonSchema)), method: "gemini-2.5-flash-lite:UNVERIFIED", sources: Object.fromEntries(["contracts", "prompt", "wire", "admission"].map(name => [name, digest(readFileSync(`src/modules/conversation/context-contract/${name}.ts`, "utf8"))])), rows }, null, 2));
    }
  });
});

describe("independent admission boundaries", () => {
  it("encoded_snapshot_boundary_and_overflow_refusal_keep_prior_state_and_expiry", () => {
    const prior = specimens.find(s => s.name === "exam_turn_4")!;
    const previous = encodeIdentityViews(prior.snapshot);
    const candidate = JSON.parse(encodeIdentityViews(specimens.find(s => s.name === "snapshot_16384")!.snapshot));
    candidate.snapshot.requestId += "x".repeat(16384 - utf8(JSON.stringify(candidate)));
    const exact = JSON.stringify(candidate);
    candidate.snapshot.requestId += "x";
    const overflow = JSON.stringify(candidate);
    expect(utf8(exact)).toBe(16384);
    expect(utf8(overflow)).toBe(16385);
    expect(measureEnvelope(prior.input, exact).reasons).toEqual(["TOKEN_BOUND_UNVERIFIED"]);
    const refusal = preflightEnvelopeTransition(previous, prior.input, overflow);
    expect(refusal).toEqual({ action: "REFUSE", reason: "CONTEXT_SNAPSHOT_TOO_LARGE", recovery: "SHORTEN_OR_RESTART", retainedSnapshotJson: previous });
    expect(decodeIdentityViews(refusal.retainedSnapshotJson)).toBe(prior.snapshot);
    // A pure plan cannot call a model, perform a canonical write, extend expiry
    // or apply a proposal. This proves preflight, not a database transaction.
    expect(JSON.parse(decodeIdentityViews(refusal.retainedSnapshotJson)).idleExpiresAt).toBe("2026-09-28T03:30:00.000Z");
  });
  it("oversized_or_truncated_proposals_produce_no_partial_transition", () => {
    const s = specimens.find(s => s.name === "exam_turn_4")!;
    const previous = encodeIdentityViews(s.snapshot);
    for (const [out, reason] of [[s.output.slice(0, -1), "OUTPUT_JSON_INVALID"], ['{"padding":"' + "x".repeat(32768) + '"}', "OUTPUT_JSON_TOO_LARGE"]]) {
      const refusal = preflightEnvelopeTransition(previous, s.input, previous, out);
      expect(refusal.reason).toBe(reason);
      expect(refusal.retainedSnapshotJson).toBe(previous);
      expect(Object.keys(refusal).sort()).toEqual(["action", "reason", "recovery", "retainedSnapshotJson"]);
    }
  });
  for (const units of [1799, 1800, 1801, 2000]) for (const variant of ["NFC", "DECOMPOSED", "SUPPLEMENTARY"]) {
    it(`INPUT_${units}_${variant}`, () => {
      const raw = variant === "NFC" ? "ế".repeat(units) : variant === "DECOMPOSED" ? "e\u0302\u0301".repeat(units) : "😀".repeat(Math.floor(units / 2)) + (units % 2 ? "ế" : "");
      const value = sampleInput([raw]);
      const original = JSON.stringify(snapshotSample(value, [raw]));
      const m = measureEnvelope(value, original);
      expect(m.current.utf16Units).toBe(units);
      expect(m.current.codePoints).toBe(variant === "SUPPLEMENTARY" ? Math.ceil(units / 2) : units);
      expect(m.reasons.includes("SEMANTIC_INPUT_TOO_LONG")).toBe(units > 1800);
      expect(m.reasons).not.toContain("CONTEXT_TURN_TOO_LONG");
      expect(JSON.parse(original).transcript[0].text).toBe(raw);
      if (process.env.CONTEXT_FIT_REPORT === "1") console.log(JSON.stringify({ unicode: `INPUT_${units}_${variant}`, originalUnits: raw.length, originalCp: [...raw].length, ...m.current, snapshotBytes: m.bytes.snapshot, requestBytes: m.bytes.request, reasons: m.reasons }));
    });
  }
  it("retained_turn_exceeding_2000_codepoints_is_rejected_without_clipping", () => {
    const value = { ...input, turns: [{ role: "USER" as const, text: "ế".repeat(2001) }] };
    expect(measureEnvelope(value, "{}").reasons).toContain("CONTEXT_TURN_TOO_LONG");
    expect(value.turns[0].text.length).toBe(2001);
  });
  it("seven_users_or_assistants_cannot_evade_role_bounds", () => {
    for (const role of ["USER", "ASSISTANT"] as const) {
      const value = { ...input, turns: [...Array.from({ length: 7 }, () => ({ role, text: "Giữ nguyên." })), { role: "USER" as const, text: "9h" }], currentTurn: 7 };
      expect(measureEnvelope(value, "{}").reasons).toContain("CONTEXT_TURN_COUNT_EXCEEDED");
    }
  });
  it("oversized_json_and_truncation_never_return_a_partial_patch", () => {
    const long = "ế".repeat(2000);
    const large = proposal([{ field: "notes", operation: "SET", value: long, evidence: [quote(0, long), quote(0, long), quote(0, long)] }], { uncertainties: [{ field: "notes", reason: "AMBIGUOUS", alternatives: [{ value: long, evidence: [quote(0, long)] }, { value: long, evidence: [quote(0, long)] }] }] });
    const json = JSON.stringify(large);
    expect(utf8(json)).toBeGreaterThan(32768);
    expect(measureEnvelope(input, "{}", json).reasons).toContain("OUTPUT_JSON_TOO_LARGE");
    expect(measureEnvelope(input, "{}", json.slice(0, -1)).reasons).toContain("OUTPUT_JSON_INVALID");
    const small = JSON.stringify(simple);
    const raw = JSON.stringify({ choices: [{ message: { content: small }, finish_reason: "stop" }], diagnostic: "x".repeat(32768) });
    expect(utf8(small)).toBeLessThan(32768); expect(utf8(raw)).toBeGreaterThan(32768);
    // Extracted JSON cannot certify raw transport fit. Admission remains blocked;
    // the future gateway must inspect raw bytes and finish reason separately.
    expect(measureEnvelope(input, "{}", small).admitted).toBe(false);
    if (process.env.CONTEXT_FIT_REPORT === "1") console.log(JSON.stringify({ overflow: { validOutputBytes: utf8(json), truncatedBytes: utf8(json.slice(0, -1)), smallOutputBytes: utf8(small), oversizedRawBytes: utf8(raw) } }));
  });
  it("strict_nested_shapes_cover_all_slots_dates_queries_and_typed_alternatives", () => {
    expect(ConversationInterpretationSchema.safeParse({ ...output, changes: [{ ...output.changes[0], evidence: [] }] }).success).toBe(false);
    expect(ConversationInterpretationSchema.safeParse({ ...output, changes: [{ ...output.changes[0], operation: "CLEAR", value: null, evidence: [{ kind: "CONTEXT_FACT", ref: "f1" }] }] }).success).toBe(false);
    expect(ConversationInterpretationSchema.safeParse({ ...output, changes: [change("eventDate", { ...examDate, leapMonth: false }, 0, "11/10")] }).success).toBe(false);
    expect(ConversationInterpretationSchema.safeParse({ ...output, changes: [change("reminderTime", { hour: 23, minute: 0, qualifier: "PM" }, 0, "23h")] }).success).toBe(false);
    expect(ConversationInterpretationSchema.safeParse({ ...output, intent: "LIST_REMINDERS", query: { kind: "LIST", period: { kind: "MONTH", offset: 0 }, statusScope: "DEFAULT", evidence: [quote(0, "tháng này")] } }).success).toBe(false);
    const list = proposal([], { intent: "LIST_REMINDERS", query: { kind: "LIST", period: { kind: "MONTH", offset: 0 }, statusScope: "DEFAULT", evidence: [quote(0, "tháng này")] } });
    expect(list.query?.kind).toBe("LIST");
    expect(ConversationInterpretationSchema.safeParse({ ...list, query: { ...list.query, ownerId: "model-owner" } }).success).toBe(false);
    expect(ConversationInterpretationSchema.safeParse({ ...output, uncertainties: [{ field: "reminderTime", reason: "AMBIGUOUS", alternatives: [{ value: "9h", evidence: [quote(0, "9h")] }] }] }).success).toBe(false);
  });
});

describe("offline context contract feasibility", () => {
  // These catch omitted normalization/counting, accidental dispatch and partial acceptance.
  it("fit_reports_units_bytes_and_method_separately", () => {
    const measured = measureEnvelope({ ...input, turns: [{ role: "USER", text: "e\u0301😀" }] }, "{}");
    expect(measured.current).toEqual({ utf16Units: 3, codePoints: 2 });
    expect(measured.bytes.snapshot).toBe(2);
    expect(measured.bytes.schema).toBeGreaterThan(1000);
    expect(measured.tokenMethod).toBe("gemini-2.5-flash-lite:UNVERIFIED");
  });
  it("ordinary_flows_fit_or_block", () => {
    expect(ConversationInterpretationSchema.safeParse(output).success).toBe(true);
    const wire = serializeContextRequest(input);
    expect(wire.messages).toHaveLength(2);
    const measured = measureEnvelope(input, "{}", JSON.stringify(output));
    expect(measured.admitted).toBe(false);
    expect(measured.reasons).toEqual(["TOKEN_BOUND_UNVERIFIED"]);
  });
  it("oversize_never_clips", () => {
    const tooLong: ContextInput = { ...input, turns: [{ role: "USER", text: "ế".repeat(1801) }] };
    const before = JSON.stringify(tooLong);
    expect(measureEnvelope(tooLong, "{}").reasons).toContain("SEMANTIC_INPUT_TOO_LONG");
    expect(JSON.stringify(tooLong)).toBe(before);
  });
  it("truncated_patch_never_admitted", () => {
    const measured = measureEnvelope(input, "{}", JSON.stringify(output).slice(0, -1));
    expect(measured.admitted).toBe(false);
    expect(measured.reasons).toContain("OUTPUT_JSON_INVALID");
  });
  it("schema_rejects_duplicate_unknown_wrongly_typed_or_authorizing_changes", () => {
    expect(ConversationInterpretationSchema.safeParse({ ...output, changes: [...output.changes, ...output.changes] }).success).toBe(false);
    expect(ConversationInterpretationSchema.safeParse({ ...output, confirmed: true }).success).toBe(false);
    expect(ConversationInterpretationSchema.safeParse({ ...output, changes: [{ ...output.changes[0], field: "reminderTime" }] }).success).toBe(false);
  });
});

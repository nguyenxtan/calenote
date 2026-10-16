import { describe, expect, it } from "vitest";
import { buildLegacyV2ContextInput as buildContextInput, type ReadyContext } from "./context";
import { chat, message, observation, snapshot, turn, withNotes } from "./context-test-fixtures";
import { validateLegacyV2Evidence as validateEvidence } from "./evidence";
import { DownstreamTraceSchema, type DownstreamDiagnostic } from "./downstream";
import {buildContextInputV2} from "./context";
import {validateEvidenceV3} from "./evidence";
import {ContextSnapshotV2Schema} from "./state";
import {SemanticPatchProposalV3Schema} from "./contracts";

it.each(["REPLACE","CLEAR"] as const)("V3 historical %s identifies the representative source without changing refusal",operation=>{
 const old=withNotes("PRIVATE_OLD_NOTE"),state=ContextSnapshotV2Schema.parse({...old,schemaVersion:"calenote-context-state-2",pendingSemanticCandidate:null});
 const msg=message("PRIVATE_CURRENT_TASK"),built=buildContextInputV2({message:msg,context:chat,snapshot:state,observation:observation(old,msg)});if(built.status!=="READY")throw Error(built.reason);
 const current={kind:"USER_QUOTE" as const,turn:built.input.currentTurn,quote:msg.text,occurrence:1};
 const historical={kind:"USER_QUOTE" as const,turn:0,quote:"PRIVATE_OLD_NOTE",occurrence:1};
 const proposal=SemanticPatchProposalV3Schema.parse({schemaVersion:"calenote-context-3",intent:"CREATE_REMINDER",requestTarget:{kind:"CURRENT",evidence:[current]},changes:[{field:"notes",operation,value:operation==="CLEAR"?null:"PRIVATE_NEW_NOTE",evidence:[historical]}],query:null,uncertainties:[]});
 const trace:DownstreamDiagnostic[]=[];const before=JSON.stringify(proposal),result=validateEvidenceV3(proposal,built,d=>trace.push(d));
 expect(result).toEqual({status:"REFUSED",reason:"CURRENT_USER_EVIDENCE_REQUIRED"});
 expect(trace.find(d=>d.stage==="EVIDENCE")?.evidenceFailure).toMatchObject({reason:"CURRENT_USER_EVIDENCE_REQUIRED",field:"notes",operation,currentTurnOrdinal:built.input.currentTurn,path:["changes",0,"evidence"],referenceOrdinal:0,referenceSelection:"REPRESENTATIVE_NO_CURRENT",sourceAlias:"t0",sourceTurnOrdinal:0,resolvedSourceRole:"USER"});
 expect(DownstreamTraceSchema.safeParse(trace).success).toBe(true);expect(JSON.stringify(proposal)).toBe(before);expect(JSON.stringify(trace)).not.toContain("PRIVATE_");
 expect(validateEvidenceV3(proposal,built,()=>{throw Error("PRIVATE_OBSERVER");})).toEqual(result);
 const supplied={...proposal,changes:[{...proposal.changes[0],evidence:[current]}]};expect(validateEvidenceV3(supplied,built).status).toBe("VALID");
 const kept=SemanticPatchProposalV3Schema.parse({...proposal,changes:[{...proposal.changes[0],operation:"SET",value:"PRIVATE_OLD_NOTE"}]});expect(validateEvidenceV3(kept,built).status).toBe("VALID");
});
it.each(["FACT_REPLACE","TARGET","QUERY","ALTERNATIVE"] as const)("V3 current-source failure diagnostic identifies %s without exposing operands",site=>{
 const old=withNotes("PRIVATE_OLD_NOTE"),state=ContextSnapshotV2Schema.parse({...old,schemaVersion:"calenote-context-state-2",pendingSemanticCandidate:null});
 const msg=message("PRIVATE_CURRENT_TASK"),built=buildContextInputV2({message:msg,context:chat,snapshot:state,observation:observation(old,msg)});if(built.status!=="READY")throw Error(built.reason);
 const current={kind:"USER_QUOTE" as const,turn:built.input.currentTurn,quote:msg.text,occurrence:1},past={kind:"USER_QUOTE" as const,turn:0,quote:"PRIVATE_OLD_NOTE",occurrence:1};
 const fact=built.input.facts.find(f=>f.field==="notes")!;
 const base={schemaVersion:"calenote-context-3",intent:"CREATE_REMINDER",requestTarget:{kind:"CURRENT",evidence:[current]},changes:[],query:null,uncertainties:[]};
 const raw=site==="FACT_REPLACE"?{...base,changes:[{field:"notes",operation:"REPLACE",value:"PRIVATE_OLD_NOTE",evidence:[{kind:"CONTEXT_FACT",ref:fact.alias},past]}]}:site==="TARGET"?{...base,requestTarget:{kind:"CURRENT",evidence:[current,past]}}:site==="QUERY"?{...base,intent:"LIST_REMINDERS",requestTarget:null,query:{kind:"LIST",period:{kind:"MONTH",offset:0},statusScope:"DEFAULT",evidence:[past]}}:{...base,intent:"AMBIGUOUS",uncertainties:[{field:"operation",reason:"AMBIGUOUS",alternatives:[{value:"CURRENT",evidence:[current,past]}]}]};
 const proposal=SemanticPatchProposalV3Schema.parse(raw),trace:DownstreamDiagnostic[]=[];
 expect(validateEvidenceV3(proposal,built,d=>trace.push(d))).toEqual({status:"REFUSED",reason:"CURRENT_USER_EVIDENCE_REQUIRED"});
 const diagnostic=trace.find(d=>d.stage==="EVIDENCE")?.evidenceFailure;
 const expected=site==="FACT_REPLACE"?{field:"notes",path:["changes",0,"evidence"],operation:"REPLACE",sourceAlias:fact.alias,resolvedSourceRole:"CONTEXT_FACT",sourceTurnOrdinal:null,referenceOrdinal:0,referenceSelection:"REPRESENTATIVE_NO_CURRENT"}:site==="TARGET"?{field:"operation",path:["requestTarget","evidence"],sourceAlias:"t0",referenceOrdinal:1,referenceSelection:"FIRST_OFFENDING"}:site==="QUERY"?{field:"queryRange",path:["query","evidence"],sourceAlias:"t0",referenceOrdinal:0,referenceSelection:"REPRESENTATIVE_NO_CURRENT"}:{field:"operation",path:["uncertainties",0,"alternatives",0,"evidence"],sourceAlias:"t0",referenceOrdinal:1,referenceSelection:"FIRST_OFFENDING"};
 expect(diagnostic).toMatchObject({...expected,reason:"CURRENT_USER_EVIDENCE_REQUIRED",currentTurnOrdinal:built.input.currentTurn});
 expect(DownstreamTraceSchema.safeParse(trace).success).toBe(true);expect(JSON.stringify(trace)).not.toContain("PRIVATE_");
});

function build(text: string, state = null as ReturnType<typeof snapshot> | null): ReadyContext {
  const msg = message(text);
  const result = buildContextInput({ message: msg, context: chat, snapshot: state, observation: observation(state, msg) });
  if (result.status !== "READY") throw new Error(result.reason);
  return result;
}
const quote = (text: string, occurrence = 1, turn = 0) => ({ kind: "USER_QUOTE", quote: text, occurrence, turn });
const proposal = (ref: unknown, field = "notes") => ({ schemaVersion: "calenote-context-2", intent: "CREATE_REMINDER", dialogueAct: "EDIT", continuation: "YES", changes: [{ field, operation: "SET", value: "safe", evidence: [ref] }], query: null, uncertainties: [], controlEvidence: [] });
function check(raw: unknown, context: ReadyContext) {
  const trace: DownstreamDiagnostic[] = [];
  const result = validateEvidence(raw, context, d => trace.push(d));
  expect(DownstreamTraceSchema.safeParse(trace).success).toBe(true);
  return { result, trace, diagnostic: trace.find(d => d.stage === "EVIDENCE")?.evidenceFailure };
}
describe("sanitized exact evidence failure tracing", () => {
  it("adds diagnostic-only formatting classification without accepting a normalized quote", () => {
    const checked = check(proposal(quote("nhắc hai ngày")), build("nhắc  hai ngày"));
    expect(checked.result).toEqual({ status: "REFUSED", reason: "EVIDENCE_QUOTE_NOT_FOUND" });
    expect(checked.diagnostic).toMatchObject({ quoteClassification: { classification: "FORMATTING_VARIANT", whitespaceNormalizedMatch: true, sourceMapStatus: "VALID" } });
  });
  it.each([
    ["gọi mẹ 😀 gọi mẹ 😀", "gọi mẹ 😀", 3, 2, "QUOTE_OCCURRENCE_OUT_OF_RANGE"],
    ["gọi mẹ", "call mom", 1, 0, "QUOTE_NOT_FOUND"],
    ["aaaa", "aa", 3, 2, "QUOTE_OCCURRENCE_OUT_OF_RANGE"],
  ])("identifies missing exact occurrence without content: %s", (source, text, occurrence, matches, reason) => {
    const { result, diagnostic, trace } = check(proposal(quote(text, occurrence)), build(source));
    expect(result).toEqual({ status: "REFUSED", reason: "EVIDENCE_QUOTE_NOT_FOUND" });
    expect(diagnostic).toMatchObject({ field: "notes", path: ["changes", 0, "evidence"], referenceOrdinal: 0, sourceAlias: "t0", expectedSourceRole: "USER", resolvedSourceRole: "USER", sourceTurnOrdinal: 0, requestedOccurrence: occurrence, matchCount: matches, reason, sourceMapStatus: "NOT_CHECKED" });
    expect(diagnostic?.quoteSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(diagnostic?.sourceViewSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(diagnostic?.quoteBytes).toBe(new TextEncoder().encode(text).length);
    expect(diagnostic?.quoteCodePoints).toBe([...text].length);
    const serialized = JSON.stringify(trace);
    // Short strings can coincidentally occur inside a hexadecimal hash.
    for (const sensitive of [source, text, "owner", "provider-user", "safe"]) expect(serialized).not.toContain(JSON.stringify(sensitive));
  });
  it("keeps exact once/multiple and NFC Vietnamese emoji acceptance unchanged", () => {
    for (const [source, text, occurrence] of [["gọi mẹ 😀", "gọi mẹ 😀", 1], ["e\u0301😀 é😀", "é😀", 2]] as const) {
      const checked = check(proposal(quote(text, occurrence)), build(source));
      expect(checked.result.status).toBe("VALID");
      expect(checked.diagnostic).toBeUndefined();
    }
    expect(check(proposal(quote("e\u0301")), build("é")).result).toEqual({ status: "REFUSED", reason: "PROPOSAL_SCHEMA_INVALID" });
  });
  it("distinguishes an unknown turn from an assistant source", () => {
    expect(check(proposal(quote("absent", 1, 11)), build("current")).diagnostic).toMatchObject({ reason: "SOURCE_ALIAS_UNKNOWN", resolvedSourceRole: "UNKNOWN", sourceViewSha256: null });
    const state = snapshot();
    state.transcript = [{ ...turn("assistant secret"), role: "ASSISTANT", kind: "PREVIEW", deliveryState: "SENT" }];
    const checked = check(proposal(quote("assistant secret")), build("current", state));
    expect(checked.result).toEqual({ status: "REFUSED", reason: "EVIDENCE_NOT_USER" });
    expect(checked.diagnostic).toMatchObject({ reason: "SOURCE_ROLE_NOT_USER", resolvedSourceRole: "ASSISTANT" });
    expect(JSON.stringify(checked.trace)).not.toContain("assistant secret");
  });
  it("retains the rejection event for a long ineligible assistant source", () => {
    const state = snapshot();
    state.transcript = [{ ...turn("a".repeat(10001)), role: "ASSISTANT", kind: "PREVIEW", deliveryState: "SENT" }];
    const checked = check(proposal(quote("a")), build("current", state));
    expect(checked.result).toEqual({ status: "REFUSED", reason: "EVIDENCE_NOT_USER" });
    expect(checked.diagnostic).toMatchObject({ reason: "SOURCE_ROLE_NOT_USER", matchCount: null, resolvedSourceRole: "ASSISTANT" });
    expect(checked.trace.map(d => d.stage)).toEqual(["EVIDENCE", "PATCH"]);
  });
  it("distinguishes unknown fact, scope mismatch, and target mismatch", () => {
    const built = build("current", withNotes());
    expect(check(proposal({ kind: "CONTEXT_FACT", ref: "f99" }), built).diagnostic).toMatchObject({ sourceAlias: "f99", reason: "SOURCE_ALIAS_UNKNOWN" });
    expect(check(proposal({ kind: "CONTEXT_FACT", ref: "f1" }, "title"), built).diagnostic).toMatchObject({ reason: "EVIDENCE_TARGET_MISMATCH" });
    const raw = { ...proposal(null), changes: [], intent: "LIST_REMINDERS", query: { kind: "LIST", period: { kind: "MONTH", offset: 0 }, statusScope: "DEFAULT", evidence: [{ kind: "CONTEXT_FACT", ref: "f1" }] } };
    expect(check(raw, built).diagnostic).toMatchObject({ field: "queryRange", path: ["query", "evidence"], reason: "SOURCE_SCOPE_MISMATCH" });
  });
  it("observer failure does not change the hard rejection", () => {
    expect(validateEvidence(proposal(quote("absent")), build("source"), () => { throw new Error("private"); })).toEqual({ status: "REFUSED", reason: "EVIDENCE_QUOTE_NOT_FOUND" });
  });
  it("identifies a quote crossing a removed control span", () => {
    const state = snapshot();
    state.controlRegistry = [{ handle: "CN-AbC123", kind: "TOKEN", ownerId: "owner", chatIdentityId: "identity", chatId: "chat", decisionId: "d", contextRevision: 1, draftRevision: 1, expiresAt: "2026-09-28T03:10:00.000Z" }];
    const checked = check(proposal(quote("đổi [CONTROL] sang", 1, 1)), build("đổi CN-AbC123 sang 9h", state));
    expect(checked.result).toEqual({ status: "REFUSED", reason: "EVIDENCE_REMOVED_SPAN" });
    expect(checked.diagnostic).toMatchObject({ reason: "QUOTE_REMOVED_CONTROL_SPAN", sourceMapStatus: "REMOVED_CONTROL_SPAN", matchCount: 1 });
    expect(JSON.stringify(checked.trace)).not.toContain("CN-AbC123");
  });
  it("reports an unmappable NFC grapheme boundary without normalizing an invalid quote into acceptance", () => {
    const checked = check(proposal(quote("ạ")), build("a\u0301\u0323"));
    expect(checked.result).toEqual({ status: "REFUSED", reason: "EVIDENCE_NORMALIZATION_BOUNDARY" });
    expect(checked.diagnostic).toMatchObject({ reason: "QUOTE_NORMALIZATION_MISMATCH", sourceMapStatus: "NORMALIZATION_BOUNDARY", matchCount: 1 });
  });
  it("hashes the NFC identity with SHA256 independently of acceptance", async () => {
    const source = "e\u0301😀", text = "absent";
    const checked = check(proposal(quote(text)), build(source));
    const digest = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value.normalize("NFC")))), byte => byte.toString(16).padStart(2, "0")).join("");
    expect(checked.diagnostic?.quoteSha256).toBe(await digest(text));
    expect(checked.diagnostic?.sourceViewSha256).toBe(await digest(source));
  });
  it("records the first failure with its actual reference ordinal and nested target", () => {
    const built = build("valid source");
    const raw = proposal(quote("valid"));
    raw.changes[0].evidence.push(quote("absent"));
    expect(check(raw, built).diagnostic).toMatchObject({ referenceOrdinal: 1, field: "notes" });
    const nested = { ...proposal(quote("valid")), uncertainties: [{ field: "location", reason: "AMBIGUOUS", alternatives: [{ value: "private location", evidence: [quote("absent")] }] }] };
    const checked = check(nested, built);
    expect(checked.diagnostic).toMatchObject({ field: "location", path: ["uncertainties", 0, "alternatives", 0, "evidence"] });
    expect(JSON.stringify(checked.trace)).not.toContain("private location");
  });
  it("cannot use telemetry to bypass stale context, ownership, or forged source maps", () => {
    const state = snapshot(), msg = message();
    for (const changed of [{ ...state, scope: { ...state.scope, ownerId: "other" } }, { ...state, contextRevision: 2 }]) {
      expect(buildContextInput({ message: msg, context: chat, snapshot: changed, observation: observation(state, msg) }).status).toBe("REFUSED");
    }
    const built = build("valid source");
    expect(check(proposal(quote("valid")), { ...built, evidenceIndex: [] }).result).toEqual({ status: "REFUSED", reason: "CONTEXT_NOT_BUILT" });
    const damaged = snapshot();
    damaged.transcript[0].sourceMap.segments = [];
    // Invalid retained maps fail before evidence validation; never forge a
    // locally issued ReadyContext to manufacture a reachable map failure.
    expect(buildContextInput({ message: msg, context: chat, snapshot: damaged, observation: observation(damaged, msg) })).toEqual({ status: "REFUSED", reason: "CONTEXT_INVALID" });
    expect(Object.isFrozen(built.evidenceIndex[0].sourceMap.segments)).toBe(true);
  });
  it("rejects unbounded and arbitrary diagnostic content at the durable trace boundary", () => {
    const { trace } = check(proposal(quote("absent")), build("source"));
    const diagnostic = trace[0];
    for (const extra of [{ quote: "private" }, { path: ["private title"] }, { sourceAlias: "owner-id" }, { sourceViewSha256: "raw text" }, { matchCount: 10001 }]) {
      expect(DownstreamTraceSchema.safeParse([{ ...diagnostic, evidenceFailure: { ...diagnostic.evidenceFailure, ...extra } }]).success).toBe(false);
    }
    expect(JSON.stringify(trace).length).toBeLessThan(1500);
  });
});

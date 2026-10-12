// @vitest-environment node
import { expect, it } from "vitest";
import { buildContextInputV2 } from "./context";
import { chat, message, observation, snapshot } from "./context-test-fixtures";
import { ContextSnapshotV2Schema, type ContextSnapshotV2 } from "./state";
import { SemanticPatchProposalV3Schema } from "./contracts";
import { validateEvidenceV3 } from "./evidence";
import { harness, proposal } from "./service-test-support";
import { DownstreamDiagnosticSchema } from "./downstream";
import { mergePatchV3 } from "./merge";

function check(state: ContextSnapshotV2 | null, kind: "CURRENT" | "NEW" | "UNRESOLVED" = "CURRENT") {
  const msg=message("Em thi ngày 20/12 lúc 9h.");
  const seen=observation(null,msg);
  const built=buildContextInputV2({message:msg,context:chat,snapshot:state,observation:state?{...seen,observed:{presence:"PRESENT",contextId:state.id,contextRevision:state.contextRevision}}:seen});
  if(built.status!=="READY") return built;
  const ref={kind:"USER_QUOTE",turn:built.input.currentTurn,quote:msg.text,occurrence:1};
  const value=SemanticPatchProposalV3Schema.parse({schemaVersion:"calenote-context-3",intent:"CREATE_REMINDER",requestTarget:{kind,evidence:[ref]},changes:[{field:"title",operation:"SET",value:"đi thi",evidence:[ref]}],query:null,uncertainties:[]});
  const before=JSON.stringify(value);
  const result=validateEvidenceV3(value,built);
  expect(JSON.stringify(value)).toBe(before);
  return result;
}
it("rejects CURRENT for R04's first event statement without creating NEW authority",()=>{
  expect(check(null)).toEqual({status:"REFUSED",reason:"REQUEST_TARGET_NOT_AVAILABLE"});
});
it("a retained conversation without a request is not CURRENT authority",()=>{
  const state=ContextSnapshotV2Schema.parse({...snapshot(),schemaVersion:"calenote-context-state-2",pendingSemanticCandidate:null,requestId:null,draftRevision:null,draftCreatedAt:null,draftExpiresAt:null,lifecycle:"NONE"});
  expect(check(state)).toEqual({status:"REFUSED",reason:"REQUEST_TARGET_NOT_AVAILABLE"});
});
it("a pending query question without a draft cannot grant CURRENT",()=>{
  const base=snapshot();
  const state=ContextSnapshotV2Schema.parse({...base,schemaVersion:"calenote-context-state-2",pendingSemanticCandidate:null,requestId:null,draftRevision:null,draftCreatedAt:null,draftExpiresAt:null,lifecycle:"NONE",pendingQueryQuestion:{questionId:"query",text:"Khoảng nào?",scope:"QUERY",field:"queryRange",decisionKind:null,reason:"MISSING",noProgressCount:0,deliveryState:"SENT",issuedAfterOrder:{receivedAt:base.inbound.receivedAt,rowid:1}}});
  expect(check(state)).toEqual({status:"REFUSED",reason:"REQUEST_TARGET_NOT_AVAILABLE"});
});
it("an unresolved semantic candidate without a draft cannot grant CURRENT",()=>{
  const msg={...message("nhắc gọi mẹ"),id:"seed"},context={...chat,inboundRowId:1};
  const built=buildContextInputV2({message:msg,context,snapshot:null,observation:observation(null,msg,context)});
  if(built.status!=="READY") throw new Error(built.reason);
  const ref={kind:"USER_QUOTE",turn:built.input.currentTurn,quote:msg.text,occurrence:1};
  const parsed=validateEvidenceV3(SemanticPatchProposalV3Schema.parse({schemaVersion:"calenote-context-3",intent:"CREATE_REMINDER",requestTarget:{kind:"UNRESOLVED",evidence:[ref]},changes:[{field:"title",operation:"SET",value:"gọi mẹ",evidence:[ref]}],query:null,uncertainties:[]}),built);
  if(parsed.status!=="VALID") throw new Error(parsed.reason);
  const staged=mergePatchV3(null,parsed.patch);
  if(staged.status!=="CLARIFY_OPERATION") throw new Error(staged.status);
  staged.candidate.pendingReminderQuestion!.deliveryState="SENT";
  expect(staged.candidate.requestId).toBeNull();
  expect(check(staged.candidate)).toEqual({status:"REFUSED",reason:"REQUEST_TARGET_NOT_AVAILABLE"});
});
const active = () => ContextSnapshotV2Schema.parse({...snapshot(),schemaVersion:"calenote-context-state-2",pendingSemanticCandidate:null});
it.each(["CLARIFYING","AWAITING_CONFIRMATION"] as const)("accepts a real scoped unexpired %s draft without changing CURRENT",lifecycle=>{
  const result=check({...active(),lifecycle});
  expect(result.status).toBe("VALID");
  if(result.status==="VALID") expect(result.patch.requestTarget?.kind).toBe("CURRENT");
});
it.each(["NEW","UNRESOLVED"] as const)("keeps absent-target %s semantics unchanged",kind=>{
  const result=check(null,kind);
  expect(result.status).toBe("VALID");
  if(result.status==="VALID") expect(result.patch.requestTarget?.kind).toBe(kind);
});
it.each(["COMPLETED","CANCELLED","EXPIRED","INVALID"] as const)("terminal %s cannot grant CURRENT",lifecycle=>{
  expect(check({...active(),lifecycle})).toEqual({status:"REFUSED",reason:"CONTEXT_TERMINAL"});
});
it("expired target cannot grant CURRENT",()=>{
  expect(check({...active(),draftExpiresAt:"2026-09-28T03:01:00.000Z"})).toEqual({status:"REFUSED",reason:"CONTEXT_EXPIRED"});
});
it("scope or observed revision mismatch cannot grant CURRENT",()=>{
  const state=active(),msg=message();
  const seen={...observation(null,msg),observed:{presence:"PRESENT" as const,contextId:state.id,contextRevision:state.contextRevision}};
  expect(buildContextInputV2({message:msg,context:chat,snapshot:{...state,scope:{...state.scope,ownerId:"other"}},observation:seen})).toEqual({status:"REFUSED",reason:"CONTEXT_SCOPE_MISMATCH"});
  expect(buildContextInputV2({message:msg,context:chat,snapshot:state,observation:{...seen,observed:{presence:"PRESENT",contextId:state.id,contextRevision:2}}})).toEqual({status:"REFUSED",reason:"CONTEXT_STALE"});
});
it("service rejects first-task CURRENT with bounded diagnostics, no partial draft or reminder",async()=>{
  const h=await harness([proposal({title:"đi thi",eventTime:{hour:9,minute:0,qualifier:"H24"}},"CURRENT")]);
  await h.turn(0,"Em thi ngày 20/12 lúc 9h.");
  const state=await h.read(1);
  expect(state?.requestId??null).toBeNull();
  expect(state?.slots.title.value??null).toBeNull();
  expect(state?.pendingSemanticCandidate??null).toBeNull();
  expect(state?.previewReceipt??null).toBeNull();
  expect(await h.f.db.prepare("SELECT COUNT(*) AS n FROM reminders").first("n")).toBe(0);
  const diagnostics=h.events.flatMap(e=>e.event==="POST_CANONICAL_STAGE"?[e.diagnostic]:[]);
  expect(diagnostics.some(d=>d.reason==="REQUEST_TARGET_NOT_AVAILABLE")).toBe(true);
  expect(diagnostics.every(d=>DownstreamDiagnosticSchema.safeParse(d).success)).toBe(true);
  expect(JSON.stringify(diagnostics)).not.toContain("Em thi");
});

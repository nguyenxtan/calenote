import { expect, it } from "vitest";
import { SemanticPatchProposalV3Schema, LegacyV2SemanticPatchProposalSchema, ClockOperandSchema, DateOperandSchema, ContextInputSchema, SLOT_NAMES } from "./contracts";
import { projectCanonicalValidation } from "./validation-diagnostics";

const user = [{kind:"USER_QUOTE",turn:0,quote:"PRIVATE_SENTINEL",occurrence:1}];
const fact = [{kind:"CONTEXT_FACT",ref:"f1"}];
const base = {schemaVersion:"calenote-context-3",intent:"HELP",requestTarget:null,changes:[],query:null,uncertainties:[]};
const change = {field:"title",operation:"SET",value:"PRIVATE_SENTINEL",evidence:user};
const list = {kind:"LIST",period:{kind:"MONTH",offset:0},statusScope:"DEFAULT",evidence:user};
const op = {field:"operation",reason:"AMBIGUOUS",alternatives:[]};
const cases = [
  ["DUPLICATE_CHANGE_FIELD", {intent:"CREATE_REMINDER",requestTarget:{kind:"NEW",evidence:user},changes:[change,change]}, ["changes"]],
  ["QUERY_INTENT_OWNERSHIP", {intent:"LIST_REMINDERS",query:null}, ["intent","query","changes"]],
  ["NON_MUTATING_CHANGES", {changes:[change]}, ["intent","changes"]],
  ["REQUEST_TARGET_INTENT_OWNERSHIP", {intent:"LIST_REMINDERS",query:list,requestTarget:{kind:"CURRENT",evidence:user}}, ["intent","requestTarget","uncertainties"]],
  ["REQUEST_TARGET_USER_EVIDENCE", {intent:"CREATE_REMINDER",requestTarget:{kind:"NEW",evidence:fact}}, ["requestTarget","evidence"]],
  ["MUTATING_OPERATION_USER_EVIDENCE", {intent:"CREATE_REMINDER",requestTarget:{kind:"NEW",evidence:user},changes:[{...change,operation:"CLEAR",value:null,evidence:fact}]}, ["changes","operation","evidence"]],
  ["OPERATION_ALTERNATIVE_USER_EVIDENCE", {intent:"AMBIGUOUS",uncertainties:[{...op,alternatives:[{value:"NEW",evidence:fact}]}]}, ["uncertainties","evidence"]],
  ["UNRESOLVED_QUERY_TARGETED_UNCERTAINTY", {intent:"LIST_REMINDERS",query:{...list,period:null}}, ["query","uncertainties"]],
  ["COMBINED_ACTIONS_NON_EXECUTABLE", {uncertainties:[{...op,reason:"UNSUPPORTED_COMBINATION"}]}, ["intent","changes","requestTarget","uncertainties"]],
] as const;
it.each(cases)("reports %s from the rejecting predicate without user values", (id, patch, fields) => {
  const raw = {...base,...patch};
  const parsed = SemanticPatchProposalV3Schema.safeParse(raw);
  expect(parsed.success).toBe(false);
  if(parsed.success) throw Error("Expected rejection");
  const diagnostics = projectCanonicalValidation(raw,parsed.error.issues,"calenote-context-3");
  expect(diagnostics.issues).toContainEqual(expect.objectContaining({code:"custom",path:[],constraintId:id,participatingFields:[...fields],actualCategory:expect.any(String),expectedCategory:expect.any(String)}));
  expect(JSON.stringify(diagnostics)).not.toContain("PRIVATE_SENTINEL");
});
it("legacy output uses the same known rule identities",()=>{
  const raw={schemaVersion:"calenote-context-2",intent:"LIST_REMINDERS",dialogueAct:"CONTINUE",continuation:"YES",changes:[],query:null,uncertainties:[],controlEvidence:[]};
  const result=LegacyV2SemanticPatchProposalSchema.safeParse(raw);
  expect(result.success).toBe(false);
  if(result.success)throw Error("Expected rejection");
  expect(projectCanonicalValidation(raw,result.error.issues).issues).toContainEqual(expect.objectContaining({constraintId:"QUERY_INTENT_OWNERSHIP"}));
});
it.each([
  ["CLOCK_QUALIFIER_HOUR", ClockOperandSchema,{hour:13,minute:0,qualifier:"AM"}],
  ["GREGORIAN_LEAP_MONTH",DateOperandSchema,{kind:"CIVIL_DATE",calendar:"GREGORIAN",day:1,month:1,year:null,leapMonth:true}],
] as const)("nested %s refinements retain identity",(id,schema,raw)=>{
  const p=schema.safeParse(raw);expect(p.success).toBe(false);if(p.success)throw Error("Expected rejection");
  expect(projectCanonicalValidation(raw,p.error.issues,"calenote-context-3").issues).toContainEqual(expect.objectContaining({constraintId:id}));
});
it("unknown or forged custom metadata cannot expose messages or states",()=>{
  const diagnostic=projectCanonicalValidation({},[{code:"custom",path:[],message:"PRIVATE_SENTINEL",params:{constraintId:"PRIVATE_SENTINEL",actualCategory:"PRIVATE_SENTINEL",participatingFields:["PRIVATE_SENTINEL"]}}],"calenote-context-3");
  expect(JSON.stringify(diagnostic)).not.toContain("PRIVATE_SENTINEL");
  expect(diagnostic.issues[0]).not.toHaveProperty("constraintId");
});
it("valid canonical input has no spurious constraint diagnostic",()=>{
  expect(SemanticPatchProposalV3Schema.safeParse(base).success).toBe(true);
  expect(projectCanonicalValidation(base,[],"calenote-context-3").issues).toEqual([]);
});
// Context input identities are tested at their real input boundary, not model output.
it("context turn and duplicate alias rules report safe root identities",()=>{
  const raw={schemaVersion:"calenote-context-input-2",reference:{instant:"2026-09-28T03:00:00Z",localDate:"2026-09-28",timezone:"Asia/Ho_Chi_Minh"},turns:[{role:"ASSISTANT",text:"PRIVATE_SENTINEL"}],currentTurn:0,activeRequest:null,facts:[],pendingQuestion:null,ambiguities:[],capabilities:{version:"1",supported:[],unsupported:[],calendars:[],limits:{dailyCount:30,horizonDays:366}}};
  const result=ContextInputSchema.safeParse(raw);expect(result.success).toBe(false);if(result.success)throw Error("Expected rejection");
  expect(projectCanonicalValidation(raw,result.error.issues,"calenote-context-3").issues).toContainEqual(expect.objectContaining({constraintId:"CONTEXT_CURRENT_USER_TURN"}));
});
it.each(["CONTEXT_UNIQUE_FACT_ALIAS","SLOT_STATE_VALUE_FACT","CONTEXT_NFC_SCALAR_TEXT","NFC_SCALAR_TEXT"])("reports %s at nested/input boundaries without sensitive text",id=>{
  const raw={schemaVersion:"calenote-context-input-2",reference:{instant:"2026-09-28T03:00:00Z",localDate:"2026-09-28",timezone:"Asia/Ho_Chi_Minh"},turns:[{role:"USER",text:"hello"}],currentTurn:0,activeRequest:null as unknown,facts:[] as unknown[],pendingQuestion:null,ambiguities:[],capabilities:{version:"1",supported:[],unsupported:[],calendars:[],limits:{dailyCount:30,horizonDays:366}}};
  if(id==="CONTEXT_UNIQUE_FACT_ALIAS"){
    const f={alias:"f1",provenance:{kind:"EXPLICIT_USER"},sourceReferenceTime:"2026-09-28T03:00:00Z",dependencies:[],scope:"REMINDER",field:"title",value:"PRIVATE_SENTINEL"};raw.facts=[f,f];
  }else if(id==="SLOT_STATE_VALUE_FACT")raw.activeRequest={lifecycle:"CLARIFYING",slots:{...Object.fromEntries(SLOT_NAMES.map(n=>[n,{state:"MISSING",value:null,fact:null}])),title:{state:"MISSING",value:"PRIVATE_SENTINEL",fact:null}}};
  else if(id==="CONTEXT_NFC_SCALAR_TEXT")raw.turns[0].text="PRIVATE_SENTINEL\ud800";
  else raw.capabilities.version="   ";
  const p=ContextInputSchema.safeParse(raw);expect(p.success).toBe(false);if(p.success)throw Error("Expected rejection");
  const d=projectCanonicalValidation(raw,p.error.issues,"calenote-context-3");
  expect(d.issues).toContainEqual(expect.objectContaining({constraintId:id}));expect(JSON.stringify(d)).not.toContain("PRIVATE_SENTINEL");
});
it.each([
  ["LEGACY_NON_MUTATING_CHANGES",{changes:[change]}],
  ["LEGACY_COMBINED_ACTIONS_NON_EXECUTABLE",{uncertainties:[{field:"operation",reason:"UNSUPPORTED_COMBINATION",alternatives:[]}]}],
] as const)("legacy-specific %s descriptor remains precise",(id,patch)=>{
  const raw={schemaVersion:"calenote-context-2",intent:"HELP",dialogueAct:"NEW_REQUEST",continuation:"NO",changes:[],query:null,uncertainties:[],controlEvidence:[],...patch};
  const p=LegacyV2SemanticPatchProposalSchema.safeParse(raw);expect(p.success).toBe(false);if(p.success)throw Error("Expected rejection");
  expect(projectCanonicalValidation(raw,p.error.issues).issues).toContainEqual(expect.objectContaining({constraintId:id}));
});

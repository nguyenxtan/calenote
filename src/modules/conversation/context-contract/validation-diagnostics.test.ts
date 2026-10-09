import { expect, it } from "vitest";
import { LegacyV2parseInterpretationSections as parseInterpretationSections } from "./contracts";
import { ConversationInterpretationV3Schema, parseInterpretationSectionsV3 } from "./contracts";
import { projectCanonicalValidation, projectDateOperandFailure, type CanonicalValidationDiagnostics } from "./validation-diagnostics";

const valid = { schemaVersion: "calenote-context-2", intent: "HELP", dialogueAct: "NEW_REQUEST", continuation: "NO", changes: [], query: null, uncertainties: [], controlEvidence: [], conversationDirective: { kind: "HELP", topic: "GENERAL" }, replyProposal: null };
const sentinel = "SENSITIVE_ATTACK_DO_NOT_RETAIN";
it("date operand structural projection never evaluates accessors or copies private keys/values",()=>{
  let reads=0;const candidate=Object.defineProperties({},{kind:{get(){reads++;throw new Error(sentinel);}},private_secret_key:{get(){reads++;throw new Error(sentinel);}}});
  const diagnostic=projectDateOperandFailure(candidate,"CANONICAL_OPERAND","INVALID_OPERAND","eventDate","private_secret_code");
  expect(reads).toBe(0);expect(diagnostic).toMatchObject({kind:"UNKNOWN",actualType:"object",unknownKeyCount:1,unknownKeyCountTruncated:false});
  expect(JSON.stringify(diagnostic)).not.toContain("private_secret");expect(JSON.stringify(diagnostic)).not.toContain(sentinel);expect(diagnostic).not.toHaveProperty("issueCode");
});
it("duplicate canonical change diagnostics identify only finite fields and authored indexes",()=>{
  const evidence=[{kind:"USER_QUOTE",turn:0,quote:sentinel,occurrence:1}];
  const raw={schemaVersion:"calenote-context-3",intent:"CREATE_REMINDER",requestTarget:{kind:"NEW",evidence},changes:[
    {field:"reminderTime",operation:"SET",value:{hour:8,minute:0,qualifier:"H24"},evidence},
    {field:"notes",operation:"SET",value:sentinel,evidence},
    {field:"reminderTime",operation:"REPLACE",value:{hour:9,minute:0,qualifier:"H24"},evidence},
  ],query:null,uncertainties:[],conversationDirective:null,replyProposal:null};
  const before=JSON.stringify(raw);let diagnostics:CanonicalValidationDiagnostics|undefined;
  expect(parseInterpretationSectionsV3(raw,value=>{diagnostics=value;})).toMatchObject({status:"REFUSED"});
  expect(diagnostics?.issues.find(issue=>issue.constraintId==="DUPLICATE_CHANGE_FIELD")).toMatchObject({duplicateFieldCounts:[{field:"reminderTime",count:2,indexes:[0,2]}],duplicateFieldCountsTruncated:false});
  expect(JSON.stringify(diagnostics)).not.toContain(sentinel);
  expect(JSON.stringify(raw)).toBe(before);
});
function actualDuplicateIssue(){
  const evidence=[{kind:"USER_QUOTE",turn:0,quote:sentinel,occurrence:1}];
  const result=ConversationInterpretationV3Schema.safeParse({schemaVersion:"calenote-context-3",intent:"CREATE_REMINDER",requestTarget:{kind:"NEW",evidence},changes:[{field:"notes",operation:"SET",value:sentinel,evidence},{field:"notes",operation:"SET",value:sentinel,evidence}],query:null,uncertainties:[],conversationDirective:null,replyProposal:null});
  if(result.success)throw Error("duplicate specimen unexpectedly accepted");
  const issue=result.error.issues.find(issue=>issue.code==="custom"&&issue.params?.constraintId==="DUPLICATE_CHANGE_FIELD");
  if(!issue)throw Error("duplicate predicate absent");return issue;
}
it("duplicate field telemetry ignores unknown names, private operations and value/evidence accessors",()=>{
  const first={field:"reminderTime",operation:sentinel};
  Object.defineProperty(first,"value",{enumerable:true,get(){throw Error("VALUE_READ");}});
  Object.defineProperty(first,"evidence",{enumerable:true,get(){throw Error("EVIDENCE_READ");}});
  const raw={changes:[first,{field:sentinel,value:sentinel},{field:"reminderTime",operation:sentinel},{field:sentinel,value:sentinel}], [sentinel]:sentinel};
  const diagnostics=projectCanonicalValidation(raw,[{...actualDuplicateIssue(),message:sentinel}],"calenote-context-3");
  expect(diagnostics.issues[0]).toMatchObject({duplicateFieldCounts:[{field:"reminderTime",count:2,indexes:[0,2]}],duplicateFieldCountsTruncated:false});
  expect(JSON.stringify(diagnostics)).not.toContain(sentinel);
  expect(JSON.stringify(diagnostics)).not.toContain("operation");
});
it("duplicate field counts are bounded observations with first eight indexes and explicit truncation",()=>{
  const raw={changes:Array.from({length:70},()=>({field:"notes",value:sentinel,evidence:sentinel}))};
  const diagnostics=projectCanonicalValidation(raw,[actualDuplicateIssue()],"calenote-context-3");
  expect(diagnostics.issues[0]).toMatchObject({duplicateFieldCounts:[{field:"notes",count:64,indexes:[0,1,2,3,4,5,6,7]}],duplicateFieldCountsTruncated:true});
  expect(JSON.stringify(diagnostics)).not.toContain(sentinel);
});
it.each([
  ["missing", { ...valid, replyProposal: undefined }, "replyProposal", "missing"],
  ["wrong enum", { ...valid, intent: sentinel }, "intent", "value"],
  ["primitive", 42, undefined, "value"],
  ["unknown key", { ...valid, [sentinel]: sentinel }, undefined, "extra"],
  ["nested union", { ...valid, changes: [{ field: "title", operation: "SET", value: 12, evidence: [{ kind: "USER_QUOTE", turn: 0, quote: sentinel, occurrence: 1 }] }] }, "value", "value"],
  ["malformed evidence", { ...valid, controlEvidence: [{ kind: "USER_QUOTE", turn: sentinel, quote: sentinel, occurrence: 1 }] }, "turn", "value"],
  ["sensitive reply", { ...valid, replyProposal: { text: sentinel, [sentinel]: sentinel } }, "replyProposal", "extra"],
] as const)("projects canonical %s failure without values or raw issue messages", (_name, raw, path, classification) => {
  let diagnostics: unknown;
  parseInterpretationSections(raw, value => { diagnostics = value; });
  expect(diagnostics).toBeDefined();
  const projected = diagnostics as { issues: Array<{ path: Array<string | number>; classification: string; actualType: string; code: string }> };
  expect(projected.issues.some(issue => issue.classification === classification && (path === undefined || issue.path.includes(path)))).toBe(true);
  expect(JSON.stringify(projected)).not.toContain(sentinel);
  expect(JSON.stringify(projected)).not.toContain("message");
  expect(projected.issues.every(issue => typeof issue.actualType === "string" && typeof issue.code === "string")).toBe(true);
});
it("bounds nested union issues, paths and unknown key names", () => {
  let diagnostics: unknown;
  const raw = { ...valid, changes: Array.from({ length: 100 }, () => ({ [sentinel]: sentinel })) };
  parseInterpretationSections(raw, value => { diagnostics = value; });
  expect(diagnostics).toMatchObject({ truncated: true });
  expect(JSON.stringify(diagnostics).length).toBeLessThan(12000);
  expect(JSON.stringify(diagnostics)).not.toContain(sentinel);
});
it("does not emit diagnostics or change canonical acceptance on valid input", () => {
  let diagnostics: unknown;
  expect(parseInterpretationSections(valid, value => { diagnostics = value; })).toMatchObject({ status: "PARSED", value: { fullSchemaValid: true } });
  expect(diagnostics).toBeUndefined();
});
it("retains malformed evidence in a late field union branch", () => {
  let diagnostics: unknown;
  parseInterpretationSections({ ...valid, changes: [{ field: "endDate", operation: "SET", value: { kind: "RELATIVE_DAY", offsetDays: 1 }, evidence: [{ kind: "USER_QUOTE", turn: 0, quote: sentinel, occurrence: sentinel }] }] }, value => { diagnostics = value; });
  expect((diagnostics as { issues: Array<{ path: Array<string | number> }> }).issues.some(issue => issue.path.join(".") === "changes.0.evidence.0.occurrence")).toBe(true);
});
import { projectWireValidation } from "./validation-diagnostics";
it.each(["BOUNDED_JSON_OBJECT","JSON_OBJECT","EVIDENCE_SOURCE_POINTER"])("preserves finite primary evidence failure %s without value leakage",expected=>{
  const raw={changes:[{evidence:{primaryEvidence:{value:sentinel}}}]};
  const diagnostic=projectWireValidation(raw,["changes",0,"evidence","primaryEvidence"],expected,undefined,"calenote-context-3");
  expect(diagnostic.issues[0]).toMatchObject({expected,path:["changes",0,"evidence","primaryEvidence"],actualType:"object"});
  expect(JSON.stringify(diagnostic)).not.toContain(sentinel);
  expect(projectWireValidation(raw,["changes",0,"evidence","primaryEvidence"],sentinel,undefined,"calenote-context-3").issues[0].expected).toBeUndefined();
});
it.each([
  [3,{index:3,change:{}},null,"COLLISION",["titleChange"]],
  [4,null,null,"OUT_OF_RANGE",[]],
  [-1,null,null,"NEGATIVE",[]],
  [0.5,null,null,"NON_INTEGER",[]],
  [null,null,null,"NON_INTEGER",[]],
] as const)("carrier position diagnostics classify structural index case %# without private values",(index,titleChange,reminderDateChange,reason,collisions)=>{
  const raw={changes:[{value:sentinel,evidence:sentinel}],titleChange,reminderDateChange,reminderTimeChange:{index,change:{value:sentinel,evidence:sentinel}}};
  const diagnostic=projectWireValidation(raw,["reminderTimeChange","index"],"CHANGE_POSITION",undefined,"calenote-context-3");
  expect(diagnostic.issues[0]).toMatchObject({carrierPosition:{reason,ordinaryCount:1,carrierCount:titleChange?2:1,combinedCount:titleChange?3:2,minIndex:0,maxIndex:titleChange?2:1,collisionRoots:collisions,...(typeof index==="number"&&Number.isSafeInteger(index)?{actualIndex:index}:{})}});
  expect(JSON.stringify(diagnostic)).not.toContain(sentinel);
});
it("position diagnostics ignore unknown roots and never inspect private change payloads",()=>{
  const payload={get value(){throw Error("PRIVATE_GETTER");},get evidence(){throw Error("PRIVATE_GETTER");}};
  const raw={changes:[payload],titleChange:null,reminderDateChange:null,reminderTimeChange:{index:7,change:payload},[sentinel]:{index:7,change:payload}};
  const diagnostic=projectWireValidation(raw,["reminderTimeChange","index"],"CHANGE_POSITION",undefined,"calenote-context-3");
  expect(diagnostic.issues[0]).toMatchObject({carrierPosition:{actualIndex:7,ordinaryCount:1,carrierCount:1,combinedCount:2,collisionRoots:[]}});
  expect(JSON.stringify(diagnostic)).not.toContain(sentinel);
  expect(projectWireValidation(raw,[sentinel,"index"],"CHANGE_POSITION",undefined,"calenote-context-3").issues[0].carrierPosition).toBeUndefined();
  const fractional=projectWireValidation({...raw,reminderTimeChange:{index:0.25,change:payload}},["reminderTimeChange","index"],"CHANGE_POSITION",undefined,"calenote-context-3");
  expect(fractional.issues[0].carrierPosition).not.toHaveProperty("actualIndex");
});
it.each(["reminderDateChange","reminderTimeChange","eventDateChange","eventTimeChange","eventRelationChange","frequencyChange","occurrenceCountChange","endDateChange"])("new singleton path %s is finite and unknown child names remain redacted",root=>{
  const raw={[root]:{index:null,change:{[sentinel]:sentinel}}};
  expect(projectWireValidation(raw,[root,"index"],"CHANGE_POSITION",undefined,"calenote-context-3")).toMatchObject({issues:[{path:[root,"index"],expected:"CHANGE_POSITION",actualType:"null",unknownPathSegments:0}],topLevelKeys:[root],unknownTopLevelKeyCount:0});
  const unknown=projectWireValidation(raw,[root,"change",sentinel],"FIELD_CHANGE",undefined,"calenote-context-3");
  expect(unknown.issues[0].unknownPathSegments).toBe(1);
  expect(JSON.stringify(unknown)).not.toContain(sentinel);
});

it("retains the trusted date-encoding failure family without operand content", () => {
  const diagnostic = projectWireValidation({ changes: [{ field: "reminderDate", value: "SYNTHETIC_PRIVATE_DATE" }] }, ["changes", 0, "value"], "DATE_OPERAND_JSON", undefined, "calenote-context-3");
  expect(diagnostic.issues[0]).toMatchObject({ path: ["changes", 0, "value"], expected: "DATE_OPERAND_JSON", actualType: "string" });
  expect(JSON.stringify(diagnostic)).not.toContain("SYNTHETIC_PRIVATE_DATE");
});

it.each([
  [JSON.stringify({ evidence: { ref: sentinel } }), "object"],
  [JSON.stringify([sentinel]), "array"],
  ["null", "null"],
  ["2", "number"],
  ["true", "boolean"],
  [JSON.stringify(sentinel), "string"],
  [sentinel, "INVALID_JSON"],
  [" ".repeat(32769), "OVERSIZED"],
  [JSON.stringify("ộ".repeat(11000)), "OVERSIZED"],
  [" ".repeat(32764) + "null", "null"],
] as const)("reports only bounded embedded type for rejected requestTarget string (%#)", (value, embeddedJsonType) => {
  const diagnostic = projectWireValidation({ requestTarget: value }, ["requestTarget"], "object", undefined, "calenote-context-3");
  expect(diagnostic.issues[0]).toMatchObject({ actualType: "string", embeddedJsonType });
  expect(JSON.stringify(diagnostic)).not.toContain(sentinel);
  expect(JSON.stringify(diagnostic).length).toBeLessThan(1000);
});

it("does not inspect business strings or change actual type of requestTarget", () => {
  const diagnostic = projectWireValidation({ changes: [{ value: JSON.stringify({ location: sentinel }) }] }, ["changes", 0, "value"], "object");
  expect(diagnostic.issues[0]).not.toHaveProperty("embeddedJsonType");
  expect(JSON.stringify(diagnostic)).not.toContain(sentinel);
});

it.each(["CURRENT", "NEW", "UNRESOLVED"])("retains only exact approved misplaced requestTarget control literal %s", token => {
  const diagnostic = projectWireValidation({ requestTarget: token }, ["requestTarget"], "object", undefined, "calenote-context-3");
  expect(diagnostic.issues[0]).toMatchObject({ expected: "object", actualType: "string", actualSafeToken: token, embeddedJsonType: "INVALID_JSON" });
});

it.each([sentinel, "current", "CURRENT ", "NEW_PRIVATE", JSON.stringify("CURRENT"), "X".repeat(40000)])("never retains unknown misplaced target contents (%#)", token => {
  const diagnostic = projectWireValidation({ requestTarget: token }, ["requestTarget"], "object", undefined, "calenote-context-3");
  expect(diagnostic.issues[0]).not.toHaveProperty("actualSafeToken");
  expect(JSON.stringify(diagnostic)).not.toContain(token);
});

it("never grants target-token telemetry to a business value", () => {
  const diagnostic = projectWireValidation({ changes: [{ value: "CURRENT" }] }, ["changes", 0, "value"], "object");
  expect(diagnostic.issues[0]).not.toHaveProperty("actualSafeToken");
});

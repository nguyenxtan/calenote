import {expect, it} from "vitest";
import {IntentSchema, SemanticPatchProposalV3Schema, parseInterpretationSectionsV3} from "./contracts";
import {projectCanonicalValidation} from "./validation-diagnostics";
import {canonicalConstraint, type OwnershipControlState} from "./canonical-constraints";

const secret = "PRIVATE_TITLE_NOTES_QUOTE_REASON";
const evidence = [{kind:"USER_QUOTE",turn:0,quote:secret,occurrence:1}];
const base = {schemaVersion:"calenote-context-3",intent:"HELP",requestTarget:null,changes:[],query:null,uncertainties:[]};
const query = {kind:"LIST",period:{kind:"MONTH",offset:0},statusScope:"DEFAULT",evidence};
const target = (kind:string) => ({kind,evidence});
function rejected(raw:unknown) {
  const result = SemanticPatchProposalV3Schema.safeParse(raw);
  expect(result.success).toBe(false);
  if(result.success)throw Error("Expected rejection");
  return {issues:result.error.issues,diagnostics:projectCanonicalValidation(raw,result.error.issues,"calenote-context-3")};
}

it.each(["CURRENT","NEW","UNRESOLVED"])("captures actual LIST/%s ownership controls without evidence content",kind=>{
  const {diagnostics}=rejected({...base,intent:"LIST_REMINDERS",query,requestTarget:target(kind)});
  expect(diagnostics.issues).toContainEqual(expect.objectContaining({constraintId:"REQUEST_TARGET_INTENT_OWNERSHIP",ownershipState:{intent:"LIST_REMINDERS",requestTargetKind:kind,uncertaintyCount:0,uncertainties:[],queryKind:"LIST",changeCount:0}}));
  expect(JSON.stringify(diagnostics)).not.toContain(secret);
});
it("captures missing CREATE target as literal null rather than an inferred default",()=>{
  const {diagnostics}=rejected({...base,intent:"CREATE_REMINDER"});
  expect(diagnostics.issues).toContainEqual(expect.objectContaining({constraintId:"REQUEST_TARGET_INTENT_OWNERSHIP",ownershipState:expect.objectContaining({intent:"CREATE_REMINDER",requestTargetKind:null})}));
});
it("captures uncertainty field/reason/count but never typed alternative free text",()=>{
  const raw={...base,intent:"AMBIGUOUS",requestTarget:target("CURRENT"),uncertainties:[{field:"notes",reason:"AMBIGUOUS",alternatives:[{value:secret,evidence}]}]};
  const {diagnostics}=rejected(raw);
  expect(diagnostics.issues).toContainEqual(expect.objectContaining({constraintId:"REQUEST_TARGET_INTENT_OWNERSHIP",ownershipState:expect.objectContaining({intent:"AMBIGUOUS",requestTargetKind:"CURRENT",uncertaintyCount:1,uncertainties:[{field:"notes",reason:"AMBIGUOUS",alternativeCount:1}]})}));
  expect(JSON.stringify(diagnostics)).not.toContain(secret);
});
it("captures operation uncertainty in the same actual rejecting cross-field state",()=>{
  const {diagnostics}=rejected({...base,intent:"LIST_REMINDERS",query,requestTarget:target("UNRESOLVED"),uncertainties:[{field:"operation",reason:"UNSUPPORTED_COMBINATION",alternatives:[{value:"CURRENT",evidence},{value:"NEW",evidence}]}]});
  expect(diagnostics.issues).toContainEqual(expect.objectContaining({constraintId:"REQUEST_TARGET_INTENT_OWNERSHIP",ownershipState:expect.objectContaining({uncertaintyCount:1,uncertainties:[{field:"operation",reason:"UNSUPPORTED_COMBINATION",alternativeCount:2}]})}));
});
it("generic query ownership rejects retain the same bounded snapshot",()=>{
  const {diagnostics}=rejected({...base,intent:"HELP",query});
  expect(diagnostics.issues).toContainEqual(expect.objectContaining({constraintId:"QUERY_INTENT_OWNERSHIP",ownershipState:expect.objectContaining({intent:"HELP",requestTargetKind:null,queryKind:"LIST",changeCount:0})}));
});
it("captured state belongs to the rejection, not later raw payload mutations",()=>{
  const raw={...base,intent:"LIST_REMINDERS",query,requestTarget:target("CURRENT")};
  const result=rejected(raw);raw.intent="HELP";raw.requestTarget.kind="NEW";
  const d=projectCanonicalValidation(raw,result.issues,"calenote-context-3");
  expect(d.issues).toContainEqual(expect.objectContaining({constraintId:"REQUEST_TARGET_INTENT_OWNERSHIP",ownershipState:expect.objectContaining({intent:"LIST_REMINDERS",requestTargetKind:"CURRENT"})}));
});
it("forged known constraint params cannot inject ownership values",()=>{
  const d=projectCanonicalValidation(base,[{code:"custom",path:[],message:secret,params:{constraintId:"REQUEST_TARGET_INTENT_OWNERSHIP",ownershipState:{intent:secret,requestTargetKind:secret,uncertainties:[{field:"notes",reason:secret}]}}}],"calenote-context-3");
  expect(d.issues[0]).not.toHaveProperty("ownershipState");expect(JSON.stringify(d)).not.toContain(secret);
});
it.each(IntentSchema.options)("preserves canonical valid combinations for %s",intent=>{
  const queries:Record<string,unknown>={LIST_REMINDERS:query,CALENDAR_QUERY:{kind:"CALENDAR_DATE",date:{kind:"RELATIVE_DAY",offsetDays:0},outputCalendar:"LUNAR_VN",evidence},CAPABILITY_QUERY:{kind:"CAPABILITY",topic:"LUNAR",evidence}};
  const raw={...base,intent,query:queries[intent]??null,requestTarget:intent==="CREATE_REMINDER"?target("CURRENT"):null,conversationDirective:null,replyProposal:null};
  let diag:unknown;expect(parseInterpretationSectionsV3(raw,d=>{diag=d;})).toMatchObject({status:"PARSED",value:{fullSchemaValid:true}});expect(diag).toBeUndefined();
});
it("AMBIGUOUS target requires operation uncertainty, not an unrelated slot uncertainty",()=>{
  expect(SemanticPatchProposalV3Schema.safeParse({...base,intent:"AMBIGUOUS",requestTarget:target("UNRESOLVED"),uncertainties:[{field:"operation",reason:"AMBIGUOUS",alternatives:[]}]}).success).toBe(true);
});
it("malformed private uncertainty cannot enter a trusted predicate snapshot",()=>{
  const {diagnostics}=rejected({...base,intent:"LIST_REMINDERS",query,requestTarget:target("CURRENT"),uncertainties:[{field:secret,reason:secret,alternatives:[]}]});
  expect(diagnostics.issues.every(i=>!("ownershipState" in i))).toBe(true);expect(JSON.stringify(diagnostics)).not.toContain(secret);
});
it("mutating emitted diagnostic copies cannot rewrite later captured state",()=>{
  const raw={...base,intent:"LIST_REMINDERS",query,requestTarget:target("CURRENT"),uncertainties:[{field:"notes",reason:"AMBIGUOUS",alternatives:[]}]};
  const {issues,diagnostics}=rejected(raw);
  const state=diagnostics.issues.find(i=>i.constraintId==="REQUEST_TARGET_INTENT_OWNERSHIP")!.ownershipState!;
  state.intent="HELP";state.uncertainties[0].field="title";
  expect(projectCanonicalValidation(raw,issues,"calenote-context-3").issues).toContainEqual(expect.objectContaining({constraintId:"REQUEST_TARGET_INTENT_OWNERSHIP",ownershipState:expect.objectContaining({intent:"LIST_REMINDERS",uncertainties:[{field:"notes",reason:"AMBIGUOUS",alternativeCount:0}]})}));
});
it("local metadata factory rejects private control strings and excludes extra payload keys",()=>{
  const state:OwnershipControlState={intent:"HELP",requestTargetKind:null,queryKind:null,changeCount:0,uncertaintyCount:0,uncertainties:[]};
  const good=canonicalConstraint("QUERY_INTENT_OWNERSHIP",secret,{...state,extra:secret} as OwnershipControlState);
  const bad=canonicalConstraint("QUERY_INTENT_OWNERSHIP",secret,{...state,intent:secret} as unknown as OwnershipControlState);
  const project=(params:Record<string,unknown>)=>projectCanonicalValidation(base,[{code:"custom",path:[],message:secret,params}],"calenote-context-3");
  expect(project(good.params).issues[0]).toHaveProperty("ownershipState.intent","HELP");
  expect(project(bad.params).issues[0]).not.toHaveProperty("ownershipState");
  expect(JSON.stringify([project(good.params),project(bad.params)])).not.toContain(secret);
  expect(project(JSON.parse(JSON.stringify(good.params))).issues[0]).not.toHaveProperty("ownershipState");
});
it("four uncertainty summaries are bounded and all private alternatives excluded",()=>{
  const uncertainties=["MISSING","AMBIGUOUS","CONFLICT","UNSUPPORTED_COMBINATION"].map(reason=>({field:"notes",reason,alternatives:[{value:secret,evidence},{value:secret,evidence}]}));
  const {diagnostics}=rejected({...base,intent:"AMBIGUOUS",requestTarget:target("CURRENT"),uncertainties});
  expect(diagnostics.issues[0].ownershipState).toMatchObject({uncertaintyCount:4,uncertainties:uncertainties.map(u=>({field:"notes",reason:u.reason,alternativeCount:2}))});
  expect(JSON.stringify(diagnostics)).not.toContain(secret);
});

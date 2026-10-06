// @vitest-environment node
import {it,expect} from "vitest";
import {diagnoseContextTurn,type ContextTurn,type ContextObservation,expandContextCampaign,scoreContextCampaign,type ContextManifest} from "./context-contract";
import {runContextFixtureCampaign} from "./context-contract-probe";
import {frozenContextProposal} from "./context-contract-fixtures";
import regressions from "../../src/modules/conversation/context-contract/benchmark/regressions.json";
import * as oracle from "./context-contract";
import {ConversationInterpretationV3Schema} from "../../src/modules/conversation/context-contract/contracts";

it("R01 conflicting model remaining-month operand preserves every frozen application assertion",async()=>{
  const corpus={version:"context-contract-corpus-1",cases:regressions.cases.filter(c=>c.id==="R01")} as ContextManifest;
  const planned=expandContextCampaign(corpus,"FULL",[]);
  const observed=await runContextFixtureCampaign(planned,{sourceSha:"3640e7c038257fbec10e068319ce4547550c3bcf",referenceNow:Date.parse("2026-09-28T03:00:00Z")},(input,id,index)=>{
    const proposal=ConversationInterpretationV3Schema.parse(frozenContextProposal(input,id,index));
    expect(proposal).toMatchObject({intent:"LIST_REMINDERS",requestTarget:null,uncertainties:index===0?[{field:"queryRange",reason:"MISSING",alternatives:[]}]:[]});
    if(index===1)expect(input.pendingQuestion).toMatchObject({scope:"QUERY",field:"queryRange"});
    if(index===1&&proposal.query?.kind==="LIST")proposal.query.period={kind:"REST_OF_MONTH"};
    return proposal;
  });
  expect(scoreContextCampaign(planned,observed)).toMatchObject({passedScripts:1,passedTurns:2,failedMandatory:[],safetyFailures:0});
  for(const [index,turn]of planned[0].turns.entries())expect(diagnoseContextTurn(turn,observed[0].turns[index])).toMatchObject({passed:true,failedAssertionCount:0});
  expect(observed[0].turns[0]).toMatchObject({status:"CLARIFICATION_REQUESTED",pendingField:"queryRange",listStoreReads:0,mutations:0});
  expect(observed[0].turns[1]).toMatchObject({status:"REMINDERS_LISTED",pendingField:null,listStoreReads:1,mutations:0});
});

it("R02 unsupported BEFORE_EVENT proposal preserves all 43 frozen turn-zero assertions", async () => {
  const corpus = {version:"context-contract-corpus-1",cases:regressions.cases.filter(c=>c.id==="R02")} as ContextManifest;
  const planned = expandContextCampaign(corpus,"FULL",[]);
  const observed = await runContextFixtureCampaign(planned,{sourceSha:"bb233e9ee0740a673acebb7523c81b3e5a96b858",referenceNow:Date.parse("2026-09-28T03:00:00Z")},(input,id,index)=>{
    const proposal = ConversationInterpretationV3Schema.parse(frozenContextProposal(input,id,index));
    if(index===0) proposal.changes.push({field:"eventRelation",operation:"SET",value:"BEFORE_EVENT",evidence:[{kind:"USER_QUOTE",turn:input.currentTurn,quote:input.turns[input.currentTurn].text,occurrence:1}]});
    return proposal;
  });
  const actual = observed[0].turns[0];
  expect(actual).toMatchObject({status:"CLARIFICATION_REQUESTED",pendingField:"reminderTime",listStoreReads:0,mutations:0,fields:{eventRelation:null}});
  const diagnostic = oracle.captureContextOracleState(planned[0].turns[0],actual,true);
  expect(diagnostic.assertions).toHaveLength(43);
  expect(diagnostic.assertions.every(a=>a.passed)).toBe(true);
  expect(scoreContextCampaign(planned,observed)).toMatchObject({passedScripts:1,passedTurns:3,failedMandatory:[],safetyFailures:0});
});

it("model semantic state exposes only validated controls, counts and value digests",()=>{
  const semantic=ConversationInterpretationV3Schema.parse({schemaVersion:"calenote-context-3",intent:"HELP",requestTarget:null,changes:[],query:null,uncertainties:[],conversationDirective:null,replyProposal:null});
  const core={schemaVersion:semantic.schemaVersion,intent:semantic.intent,requestTarget:semantic.requestTarget,changes:semantic.changes,query:semantic.query,uncertainties:semantic.uncertainties};
  expect(oracle.captureValidationSemanticState(core)).toMatchObject({intent:"HELP",changes:[],query:null,uncertainties:[]});
  expect(()=>oracle.captureValidationSemanticState({...core,intent:"PRIVATE_CONTENT"})).toThrow();
});

it("complete oracle state preserves passed and failed assertions without sensitive content",()=>{
  const actual=observation();actual.pendingField="eventRelation";
  const state=oracle.captureContextOracleState(expected,actual,true);
  expect(state.controlState).toMatchObject({effectiveDirective:{type:"undefined"},pendingField:{value:"eventRelation"}});
  expect(state.assertions).toContainEqual(expect.objectContaining({path:"pendingField",passed:false}));
  expect(state.assertions).toContainEqual(expect.objectContaining({path:"applicationStatus",passed:true}));
  expect(JSON.stringify(state)).not.toContain("PRIVATE_EXPECTED_TITLE");expect(JSON.stringify(state)).not.toContain("private input");
  expect(state.truncated).toBe(false);
});

const expected:ContextTurn={text:"private input",receipt:"2026-09-28T03:00:00Z",model:"HEALTHY",expect:{status:"CLARIFICATION_REQUESTED",dispatches:1,mutations:0,fields:{title:"PRIVATE_EXPECTED_TITLE",eventDate:{kind:"CIVIL_DATE",year:null}},pendingField:"reminderTime"}};
const observation=():ContextObservation["turns"][number]=>({status:"CLARIFICATION_REQUESTED",dispatches:1,actualDispatches:1,mutations:0,fullSchemaValid:true,fields:{title:"PRIVATE_EXPECTED_TITLE",eventDate:{kind:"CIVIL_DATE",year:null}},pendingField:"reminderTime"});
it("PASS emits no failed assertions",()=>{expect(diagnoseContextTurn(expected,observation())).toMatchObject({passed:true,failedAssertionCount:0,failedAssertions:[],truncated:false});});
it("one scalar mismatch reports exact path and finite safe values",()=>{const actual=observation();actual.pendingField="eventRelation";expect(diagnoseContextTurn(expected,actual)).toMatchObject({passed:false,failedAssertionCount:1,failedAssertions:[{path:"pendingField",assertionKind:"DEEP_EQUAL",expected:{type:"string",value:"reminderTime"},actual:{type:"string",value:"eventRelation"}}]});});
it("multiple nested mismatches have deterministic paths",()=>{const actual=observation();actual.status="REJECTED";actual.fields.eventDate={kind:"CIVIL_DATE",year:2026};actual.mutations=1;const result=diagnoseContextTurn(expected,actual);expect(result.failedAssertions.map(i=>i.path)).toEqual(["safety.mutations","applicationStatus","mutationCount","fields.eventDate.year"]);expect(result.failedAssertionCount).toBe(4);});
it("free text, unknown enum strings and dynamic keys never leak",()=>{const actual=observation();actual.fields.title="PRIVATE_ACTUAL_TITLE";actual.status="PRIVATE_STATUS";actual.assertions={PRIVATE_ASSERTION_KEY:false};actual.fields.eventDate={kind:"CIVIL_DATE",year:null,PRIVATE_NESTED_KEY:"PRIVATE_NESTED_VALUE"};const serialized=JSON.stringify(diagnoseContextTurn(expected,actual));for(const sensitive of ["PRIVATE_EXPECTED_TITLE","PRIVATE_ACTUAL_TITLE","PRIVATE_STATUS","PRIVATE_ASSERTION_KEY","PRIVATE_NESTED_KEY","PRIVATE_NESTED_VALUE","private input"])expect(serialized).not.toContain(sensitive);expect(serialized).toContain("sha256");});
it("reply constraints report booleans only without snippets or selected text",()=>{const turn={...expected,expect:{...expected.expect,replyIncludes:["PRIVATE_REQUIRED"],replyExcludes:["PRIVATE_FORBIDDEN"]}};const actual={...observation(),selectedText:"PRIVATE_FORBIDDEN"};const d=diagnoseContextTurn(turn,actual);expect(d.failedAssertions.map(i=>i.path)).toEqual(["replyIncludes.0","replyExcludes.0"]);expect(JSON.stringify(d)).not.toContain("PRIVATE_");});
it("missing observation and false internal assertions are explained",()=>{expect(diagnoseContextTurn(expected,undefined).failedAssertions.map(i=>i.path)).toContain("observation");const actual=observation();actual.assertions={completeLogicalRoundTrip:false};expect(diagnoseContextTurn(expected,actual).failedAssertions).toContainEqual(expect.objectContaining({path:"assertions.completeLogicalRoundTrip",expected:{type:"boolean",value:true},actual:{type:"boolean",value:false}}));});
it("prototype-only deep equality mismatch cannot produce diagnostic PASS",()=>{const actual=observation();actual.fields.eventDate=Object.assign(Object.create(null),{kind:"CIVIL_DATE",year:null});expect(diagnoseContextTurn(expected,actual)).toMatchObject({passed:false,failedAssertionCount:1,failedAssertions:[{path:"fields.eventDate"}]});});
it("extra undefined property reports key presence rather than identical undefined types",()=>{const actual=observation();actual.fields.eventDate={kind:"CIVIL_DATE",year:null,extra:undefined};expect(diagnoseContextTurn(expected,actual).failedAssertions).toContainEqual(expect.objectContaining({assertionKind:"KEY_PRESENCE",expected:{type:"boolean",value:false},actual:{type:"boolean",value:true}}));});
it("missing nested year reports the exact key without recursive parent substitution",()=>{const actual=observation();actual.fields.eventDate={kind:"CIVIL_DATE"};expect(diagnoseContextTurn(expected,actual).failedAssertions).toEqual([expect.objectContaining({path:"fields.eventDate.year",assertionKind:"KEY_PRESENCE",expected:{type:"boolean",value:true},actual:{type:"boolean",value:false}})]);});
it.each(["constructor","__proto__","toString"])("untrusted nested %s key does not crash or leak",key=>{const turn={...expected,expect:{...expected.expect,fields:{eventDate:JSON.parse(`{"${key}":"PRIVATE_EXPECTED"}`)}}};const actual={...observation(),fields:{eventDate:JSON.parse(`{"${key}":"PRIVATE_ACTUAL"}`)}};const d=diagnoseContextTurn(turn,actual);expect(d.passed).toBe(false);expect(JSON.stringify(d)).not.toContain("PRIVATE_");});
it("original scalar strict equality still treats signed zero as equal",()=>{const actual=observation();actual.mutations=-0;expect(diagnoseContextTurn(expected,actual).passed).toBe(true);});
it("oversized invalid observation produces bounded metadata",()=>{const actual=observation();actual.fields.title="PRIVATE_HUGE".repeat(100000);actual.assertions=Object.fromEntries(Array.from({length:500},(_,i)=>[`private-${i}`,false]));const d=diagnoseContextTurn(expected,actual);expect(d.failedAssertionCount).toBe(501);expect(d.failedAssertions.length).toBeLessThanOrEqual(128);expect(d.truncated).toBe(true);expect(JSON.stringify(d).length).toBeLessThan(65536);expect(JSON.stringify(d)).not.toContain("PRIVATE_HUGE");});
it("R01 and R02 deterministic application paths preserve complete frozen oracles",async()=>{const corpus={version:"context-contract-corpus-1",cases:regressions.cases.filter(c=>["R01","R02"].includes(c.id))} as ContextManifest;const planned=expandContextCampaign(corpus,"FULL",[]);const observed=await runContextFixtureCampaign(planned,{sourceSha:"bb233e9ee0740a673acebb7523c81b3e5a96b858",referenceNow:Date.parse("2026-09-28T03:00:00Z")},frozenContextProposal);expect(scoreContextCampaign(planned,observed)).toMatchObject({passedScripts:2,passedTurns:5,failedMandatory:[],safetyFailures:0});for(const script of planned)for(const [index,turn]of script.turns.entries())expect(diagnoseContextTurn(turn,observed.find(o=>o.id===script.id)!.turns[index])).toMatchObject({passed:true,failedAssertionCount:0});expect(observed[0].turns[0]).toMatchObject({listStoreReads:0,mutations:0});expect(observed[0].turns[1]).toMatchObject({listStoreReads:1,mutations:0});expect(observed[1].turns[0]).toMatchObject({pendingField:"reminderTime",listStoreReads:0,mutations:0});});

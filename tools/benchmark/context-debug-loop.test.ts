// @vitest-environment node
import {it,expect} from "vitest";
import {mkdtempSync,mkdirSync,realpathSync,readFileSync,writeFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createHash} from "node:crypto";
import {appendCampaignEvent,reserveCampaignCall,markCampaignDispatched,finishCampaignCall} from "./context-contract-live";
import {currentFixtureCandidate} from "./current-candidate.test-support";
import {deriveBoundedPilotManifest} from "./context-bounded-pilot";
import {createDebugLoopLoader,inspectDebugLoop,runDebugLoopExecution,debugProbeSchema} from "./context-debug-loop";
import {googleLiteEuContextWireSchemaV3} from "../../src/modules/intelligence/infrastructure/openrouter/context-provider-wire";
import {parseGoogleLiteEuContextSectionsV3} from "../../src/modules/intelligence/infrastructure/openrouter/context-provider-wire";
import {CONTEXT_PROTOCOL_V3} from "../../src/modules/conversation/context-contract/protocol";
import {frozenContextProposal,encodeFixtureV3} from "./context-pointer-fixtures";
const hash=(s:string)=>createHash("sha256").update(s).digest("hex");
const candidate=currentFixtureCandidate();
it("string-selector diagnostic changes only wire enum representation without runtime repair",()=>{
 const original=googleLiteEuContextWireSchemaV3().schema;
 original.properties!.operationCode={type:"integer",enum:Array.from({length:12},(_,i)=>i)};
 const before=JSON.stringify(original);
 const probe=debugProbeSchema(original,"OPERATION_STRING");
 expect(probe.properties!.operationCode).toEqual({type:"string",enum:Array.from({length:12},(_,i)=>String(i))});
 expect({...probe,properties:{...probe.properties,operationCode:original.properties!.operationCode}}).toEqual(original);
 expect(JSON.stringify(original)).toBe(before);
 const raw=encodeFixtureV3(frozenContextProposal({turns:[{role:"USER",text:"Có lịch nào ko?"}],currentTurn:0,activeRequest:null,pendingQuestion:null,facts:[]} as never,"R01",0)) as Record<string,unknown>;
 raw.operationCode=3;
 expect(parseGoogleLiteEuContextSectionsV3(raw,CONTEXT_PROTOCOL_V3).status).toBe("REFUSED");
});
it("historical string-selector probe fails closed when runtime is already string-coded",async()=>{
 const s=setup();let calls=0;
 try{
  const a=s.load(),result=await runDebugLoopExecution(a,candidate,"OPERATION_STRING",async()=>{calls++;throw Error("FORBIDDEN")},{now:()=>100});
  expect(result).toMatchObject({providerHttpAttempts:0,applicationLlmCalls:1,terminal:true,pilotCredit:false});
  expect(result.responses[0].status).toBe("FAILURE");
  await expect(runDebugLoopExecution(a,candidate,"OPERATION_STRING",async()=>{calls++;throw Error("FORBIDDEN")})).rejects.toThrow("DEBUG_EXECUTION_CONSUMED");
  expect(calls).toBe(0);
 }finally{s.cleanup()}
});
it("R02 diagnostic is exactly one frozen turn with safe semantic summary and no Pilot credit",async()=>{
 const s=setup();let calls=0;
 try{
  const result=await runDebugLoopExecution(s.load(),candidate,"R02_TURN0",async request=>{
   calls++;const content=encodeFixtureV3(frozenContextProposal(JSON.parse(request.messages[1].content),"R02",0));
   const body=JSON.stringify({model:request.model,provider:"Google",id:"gen-local-diagnostic",usage:{cost:.0001,prompt_tokens:100,completion_tokens:100},choices:[{finish_reason:"stop",message:{content:JSON.stringify(content)}}]});
   return {status:200,body,rawResponseBytes:Buffer.byteLength(body)};
  },{now:()=>100});
  expect(result).toMatchObject({providerHttpAttempts:1,applicationLlmCalls:1,terminal:true,pilotCredit:false});
  expect(result.responses[0]).toMatchObject({fixtureId:"R02",turnIndex:0,semanticState:{intent:"CREATE_REMINDER"}});
  expect(JSON.stringify(result.responses[0].semanticState)).not.toContain("Quang Trung");
  await expect(runDebugLoopExecution(s.load(),candidate,"R02_TURN0",async()=>{calls++;throw Error("FORBIDDEN")})).rejects.toThrow("DEBUG_EXECUTION_CONSUMED");
  expect(calls).toBe(1);
 }finally{s.cleanup()}
});
function setup(){
 const root=process.cwd(),accountRoot=realpathSync(mkdtempSync(join(tmpdir(),"debug-loop-"))),campaignRoot=join(accountRoot,"existing"),history=join(campaignRoot,"PILOT");mkdirSync(history,{recursive:true});
 appendCampaignEvent(history,{event:"BEGIN",runId:"old",sourceSha:"a".repeat(40),profile:"PILOT",provenanceDigest:"b".repeat(64),cumulativeAuthorizedMicrounits:1500000,cumulativeRetainedMicrounits:0,startedAt:1,executionKind:"R01_REPLAY",accountingPolicy:"CONFIRMED_COST_V1",requestExposureBoundMicrounits:105472});
 reserveCampaignCall(history,{runId:"old",profile:"PILOT",provenanceDigest:"b".repeat(64),reservationId:"old",maximumMicrounits:0,now:1,startedAt:1});markCampaignDispatched(history,{runId:"old",reservationId:"old",at:1});finishCampaignCall(history,{runId:"old",reservationId:"old",observedMicrounits:null,at:1});
 const ownerMessagePath=join(accountRoot,"owner.txt"),path=join(accountRoot,"grant.json");writeFileSync(ownerMessagePath,"Owner approved repeated debug under $5 including conservative UNKNOWN.");
 const record={version:"t11-debug-loop-authority-1",operation:"T11_SCHEMA_DEBUG_THROUGH_FORMAL_PILOT",accountRoot,campaignRoot,hardCapMicrounits:5000000,accountingPolicy:"CONSERVATIVE_DEBUG_V1",model:"google/gemini-2.5-flash-lite",provider:"google-vertex/eu",retry:0,fallback:"none",stream:false,manifestSha256:deriveBoundedPilotManifest(root).manifestSha256,ownerMessagePath,ownerMessageSha256:hash(readFileSync(ownerMessagePath,"utf8"))};
 const load=(patch:Record<string,unknown>={})=>{const text=JSON.stringify({...record,...patch});writeFileSync(path,text);return createDebugLoopLoader({accountRoot,campaignRoot,reviewedRecordSha256:hash(text),reviewedOwnerMessageSha256:record.ownerMessageSha256})(path,root)};
 return {root,accountRoot,campaignRoot,history,load,cleanup:()=>rmSync(accountRoot,{recursive:true,force:true})};
}
it("new reviewed debug authority admits conservative UNKNOWN without rewriting stopped history",()=>{const s=setup();try{const before=readFileSync(join(s.history,"campaign.jsonl"),"utf8");expect(inspectDebugLoop(s.load())).toMatchObject({unknownExposureMicrounits:105472,remainingConservativeMicrounits:4894528});expect(readFileSync(join(s.history,"campaign.jsonl"),"utf8")).toBe(before);}finally{s.cleanup()}});
it.each([{hardCapMicrounits:5000001},{model:"other"},{provider:"other"},{retry:1},{fallback:"other"},{accountingPolicy:"CONFIRMED_COST_V1"}])("rejects broadened debug policy %j",patch=>{const s=setup();try{expect(()=>s.load(patch)).toThrow()}finally{s.cleanup()}});
it("no authority, even with a transport, cannot dispatch",async()=>{let calls=0;await expect(runDebugLoopExecution(undefined,candidate,"QUERY_ONLY",async()=>{calls++;return {status:400,body:"{}"}})).rejects.toThrow("DEBUG_AUTHORITY_REQUIRED");expect(calls).toBe(0)});
it("probe performs one durable application-path request; terminal duplicate cannot dispatch again",async()=>{const s=setup();let calls=0;try{const a=s.load(),before=readFileSync(join(s.history,"campaign.jsonl"),"utf8");const result=await runDebugLoopExecution(a,candidate,"QUERY_ONLY",async request=>{calls++;expect(request.stream).toBe(false);expect(request.provider.allow_fallbacks).toBe(false);return {status:400,body:"{}"}},{now:()=>100});expect(result).toMatchObject({providerHttpAttempts:1,terminal:true,pilotCredit:false});await expect(runDebugLoopExecution(a,candidate,"QUERY_ONLY",async()=>{calls++;return {status:400,body:"{}"}})).rejects.toThrow("DEBUG_EXECUTION_CONSUMED");expect(calls).toBe(1);expect(inspectDebugLoop(a)).toMatchObject({prospectiveUnknownCount:2,unknownExposureMicrounits:210944});expect(readFileSync(join(s.history,"campaign.jsonl"),"utf8")).toBe(before);}finally{s.cleanup()}});
it("schema probes alter only selected evidence representation and never mutate runtime schema",()=>{
 const schema=googleLiteEuContextWireSchemaV3().schema,before=JSON.stringify(schema),probe=debugProbeSchema(schema,"QUERY_ONLY") as typeof schema;
 expect(probe.properties!.requestTarget).not.toEqual(schema.properties!.requestTarget);
 expect(probe.properties!.query).toEqual(schema.properties!.query);
 expect(JSON.stringify(schema)).toBe(before);
 expect(debugProbeSchema(schema,"V14")).toEqual(schema);
});
it("tampered authority after loading fails before dispatch",async()=>{const s=setup();let calls=0;try{const a=s.load();writeFileSync(join(s.accountRoot,"grant.json"),"{}");await expect(runDebugLoopExecution(a,candidate,"V14",async()=>{calls++;return {status:400,body:"{}"}})).rejects.toThrow("DEBUG_RECORD_BINDING");expect(calls).toBe(0)}finally{s.cleanup()}});
it.each(["CHANGE_TEXT_ONLY","CHANGE_DATE_ONLY","CHANGE_TIME_ONLY","CHANGE_SCALAR_ONLY","CHANGE_CLEAR_ONLY"] as const)("%s preserves only its semantic evidence group despite coalesced branches",mode=>{
 type ProbeNode={type?:string;enum?:unknown[];const?:unknown;$ref?:string;properties?:Record<string,ProbeNode>;items?:ProbeNode;$defs?:Record<string,ProbeNode>;anyOf?:ProbeNode[]};
 const schema=googleLiteEuContextWireSchemaV3().schema,probe=debugProbeSchema(schema,mode) as ProbeNode;
 const ref=probe.properties!.changes.items!.$ref!,branches=probe.$defs![ref.split("/").at(-1)!].anyOf!;
 const group=mode==="CHANGE_TEXT_ONLY"?["title","location","notes"]:mode==="CHANGE_DATE_ONLY"?["eventDate","reminderDate","endDate"]:mode==="CHANGE_TIME_ONLY"?["eventTime","reminderTime"]:["calendar","frequency","occurrenceCount","leadOffsetDays","eventRelation"];
 for(const branch of branches){
  const properties=branch.properties!,fields=properties.field.enum??[properties.field.const],clear=properties.operation.const==="CLEAR";
  for(const field of fields){const retained=mode==="CHANGE_CLEAR_ONLY"?clear:!clear&&group.includes(String(field));expect(properties.evidence.type,`${field}/${clear}`).toBe(retained?"object":"array");}
 }
 expect(probe.properties!.query).toEqual(schema.properties!.query);
});
it("wrong candidate fails before durable execution or provider",async()=>{const s=setup();let calls=0;try{await expect(runDebugLoopExecution(s.load(),"a".repeat(40),"V14",async()=>{calls++;return {status:400,body:"{}"}})).rejects.toThrow();expect(calls).toBe(0)}finally{s.cleanup()}});
it("concurrent duplicate probe cannot dispatch twice",async()=>{const s=setup();let calls=0;try{const a=s.load(),transport=async()=>{calls++;return {status:400,body:"{}"}};const outcomes=await Promise.allSettled([runDebugLoopExecution(a,candidate,"V14",transport,{now:()=>100}),runDebugLoopExecution(a,candidate,"V14",transport,{now:()=>100})]);expect(calls).toBe(1);expect(outcomes.filter(o=>o.status==="rejected")).toHaveLength(1)}finally{s.cleanup()}});
it("transport exception retains UNKNOWN and a terminal execution cannot redispatch",async()=>{const s=setup();let calls=0;try{const a=s.load();await runDebugLoopExecution(a,candidate,"V14",async()=>{calls++;throw Error("fake timeout")},{now:()=>100});expect(inspectDebugLoop(a).prospectiveUnknownCount).toBe(2);await expect(runDebugLoopExecution(a,candidate,"V14",async()=>{calls++;return {status:200,body:"{}"}})).rejects.toThrow("DEBUG_EXECUTION_CONSUMED");expect(calls).toBe(1)}finally{s.cleanup()}});
it("debug cap blocks another probe despite a new mode and available credential transport",async()=>{const s=setup();let calls=0;try{const a=s.load({hardCapMicrounits:210944});await runDebugLoopExecution(a,candidate,"V14",async()=>{calls++;return {status:400,body:"{}"}},{now:()=>100});await expect(runDebugLoopExecution(a,candidate,"QUERY_ONLY",async()=>{calls++;return {status:400,body:"{}"}})).rejects.toThrow("DEBUG_COST_HARD_CAP");expect(calls).toBe(1)}finally{s.cleanup()}});
it("formal debug execution retains the frozen oracle and all 76 requests without Full",async()=>{const s=setup();let calls=0;try{const targets=deriveBoundedPilotManifest(s.root).targets,result=await runDebugLoopExecution(s.load(),candidate,"FORMAL_PILOT",async request=>{const target=targets[calls++],content=encodeFixtureV3(frozenContextProposal(JSON.parse(request.messages[1].content),target.fixtureId,target.turnIndex));const body=JSON.stringify({model:request.model,provider:"Google",id:"gen-local-debug",usage:{cost:.0001,prompt_tokens:100,completion_tokens:100},choices:[{finish_reason:"stop",message:{content:JSON.stringify(content)}}]});return {status:200,body,rawResponseBytes:Buffer.byteLength(body)}},{now:()=>100});expect(result).toMatchObject({pilotCredit:true,providerHttpAttempts:76,applicationLlmCalls:76});expect(result.score).toMatchObject({passedScripts:32,passedTurns:84,safetyFailures:0});expect(result.accounting.prospectiveUnknownCount).toBe(1)}finally{s.cleanup()}},120000);

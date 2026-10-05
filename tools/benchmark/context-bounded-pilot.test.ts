// @vitest-environment node
import {it,expect,vi} from "vitest";
import * as probeModule from "./context-contract-probe";
import {mkdtempSync,rmSync,realpathSync,mkdirSync,readFileSync,writeFileSync,readdirSync} from "node:fs";
import {createHash} from "node:crypto";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {executeObservableCampaign} from "./context-contract-runner";
import {readCampaignLedger,appendCampaignEvent,auditCampaignAccountRoot,preflightContextCampaign,reserveCampaignCall,markCampaignDispatched,finishCampaignCall} from "./context-contract-live";
import {candidateValidationProof,validationExecutionKey} from "./context-contract-candidate-validation";
import * as recordModule from "./context-contract-candidate-validation";
import {inspectConfirmedCampaignCost} from "./context-confirmed-cost";
import {contextCampaignMaximumReservation} from "./context-contract-runner";
import {deriveBoundedPilotManifest,createBoundedPilotLoader,runBoundedPilot,inspectBoundedPilot} from "./context-bounded-pilot";
import {frozenContextProposal,encodeFixtureV3} from "./context-contract-fixtures";
import type {ContextInput} from "../../src/modules/conversation/context-contract/contracts";
import type {ConversationInterpretation} from "../../src/modules/conversation/context-contract/contracts";
import type {ContextAction,PlannedContextCase} from "./context-contract";

import { currentFixtureCandidate } from "./current-candidate.test-support";
const candidate=currentFixtureCandidate();
const hash=(v:string)=>createHash("sha256").update(v).digest("hex");
function setup(knownMicrounits=0){
 const root=process.cwd(),accountRoot=realpathSync(mkdtempSync(join(tmpdir(),"pilot-authority-"))),campaignRoot=join(accountRoot,"existing-T11"),history=join(campaignRoot,"PILOT");mkdirSync(history,{recursive:true});
 appendCampaignEvent(history,{event:"BEGIN",profile:"PILOT",runId:"history",sourceSha:"a".repeat(40),provenanceDigest:"b".repeat(64),cumulativeAuthorizedMicrounits:1500000,cumulativeRetainedMicrounits:0,startedAt:1});
 reserveCampaignCall(history,{runId:"history",profile:"PILOT",provenanceDigest:"b".repeat(64),reservationId:"historical-unknown",maximumMicrounits:10000,now:1,startedAt:1});
 if(knownMicrounits){reserveCampaignCall(history,{runId:"history",profile:"PILOT",provenanceDigest:"b".repeat(64),reservationId:"historical-known",maximumMicrounits:knownMicrounits,now:1,startedAt:1});markCampaignDispatched(history,{runId:"history",reservationId:"historical-known",at:1});finishCampaignCall(history,{runId:"history",reservationId:"historical-known",observedMicrounits:knownMicrounits,at:1});}
 appendCampaignEvent(history,{event:"STOP",runId:"history",at:1,reason:"HISTORICAL"});
 const manifest=deriveBoundedPilotManifest(root),proof=candidateValidationProof(root,candidate),ownerMessagePath=join(accountRoot,"owner.txt"),path=join(accountRoot,"grant.json");writeFileSync(ownerMessagePath,"Direct fresh bounded Pilot test authority");
 const record={version:"bounded-pilot-authority-1",operation:"BOUNDED_T11_FORMAL_PILOT",accountRoot,campaignRoot,...proof,manifestSha256:manifest.manifestSha256,targets:manifest.targets,maxProviderHttpRequests:manifest.maxProviderHttpRequests,accountingPolicy:"CONFIRMED_COST_V1",hardCapMicrounits:preflightContextCampaign({root}).pilot.maxMicrounits,model:"google/gemini-2.5-flash-lite",provider:"google-vertex/eu",stream:false,retry:0,fallback:"none",ownerMessagePath,ownerMessageSha256:hash(readFileSync(ownerMessagePath,"utf8")),historicalInventorySha256:auditCampaignAccountRoot(accountRoot).inventoryDigest};
 function load(patch:Record<string,unknown>={}){const text=JSON.stringify({...record,...patch});writeFileSync(path,text);return createBoundedPilotLoader({accountRoot,campaignRoot,expectedCandidateSha:candidate,reviewedRecordSha256:hash(text),reviewedOwnerMessageSha256:record.ownerMessageSha256})(path,root);}
 return {root,accountRoot,campaignRoot,history,record,manifest,path,load,cleanup:()=>rmSync(accountRoot,{recursive:true,force:true})};
}
function response(request:{model:string},content:unknown,cost:number|null=.001){const body=JSON.stringify({model:request.model,provider:"Google",id:"gen-local-pilot",usage:{...(cost===null?{}:{cost}),prompt_tokens:100,completion_tokens:100},choices:[{finish_reason:"stop",message:{content:JSON.stringify(content)}}]});return{status:200,body,rawResponseBytes:Buffer.byteLength(body)};}

it.each(["R12","R13"])("%s action failure terminally rejects its target before any later paid target",async fixtureId=>{
 const s=setup();let calls=0,atFailure=0;
 const original=probeModule.runContextFixtureCampaign;
 const spy=vi.spyOn(probeModule,"runContextFixtureCampaign").mockImplementation((planned,config,fixture,hooks)=>original(planned,config,fixture,hooks?{...hooks,
  async onAction(script:PlannedContextCase,index:number,actionIndex:number,actual:ContextAction["expect"],releasedTurnIndex?:number){
   const fail=script.executionId===fixtureId;
   if(fail)atFailure=calls;
   const check=Reflect.get(hooks,"onAction");
   if(check)await check(script,index,actionIndex,fail?{...actual,sendAttempts:actual.sendAttempts+1}:actual,releasedTurnIndex);
  }}:hooks));
 try{const result=await runBoundedPilot(s.load(),async request=>{const t=s.manifest.targets[calls++];return response(request,encodeFixtureV3(frozenContextProposal(JSON.parse(request.messages[1].content),t.fixtureId,t.turnIndex)));},{now:()=>100});
 expect(atFailure).toBeGreaterThan(0);expect(calls).toBe(atFailure);expect(calls).toBeLessThan(76);expect(result.pilotStatus).toBe("FAIL");
 const leaf=join(s.campaignRoot,"bounded-pilot-executions",validationExecutionKey(s.record.ownerMessageSha256),"PILOT");const index=fixtureId==="R12"?0:1;
 expect(JSON.parse(readFileSync(join(leaf,`${fixtureId}-turn-${index}.terminal.json`),"utf8"))).toMatchObject({accepted:false});
 }finally{spy.mockRestore();s.cleanup();}
},120000);

it("hard cap after a passing target blocks the next dispatch, not through financial reservation",async()=>{
 const s=setup(1394000);let calls=0;try{const result=await runBoundedPilot(s.load(),async request=>{calls++;return response(request,encodeFixtureV3(frozenContextProposal(JSON.parse(request.messages[1].content),"R01",0)),.001);},{now:()=>100});
 expect(calls).toBe(1);expect(result.pilotStatus).toBe("FAIL");expect(result).toMatchObject({firstGateFailure:{fixtureId:"R01",turnIndex:1,stage:"PRE_DISPATCH_ADMISSION",code:"CONFIRMED_COST_HARD_CAP"}});const account=inspectConfirmedCampaignCost(s.accountRoot,1500000,contextCampaignMaximumReservation,false);expect(account.confirmedMicrounits).toBe(1395000);expect(account.hardCapReady).toBe(false);expect(account.executionClaimMicrounits).toBe(0);
 }finally{s.cleanup();}
});
it("changed trusted record after loading cannot reach provider",async()=>{const s=setup();let calls=0;try{const authority=s.load();writeFileSync(s.path,JSON.stringify({...s.record,maxProviderHttpRequests:77}));await expect(runBoundedPilot(authority,async()=>{calls++;throw Error("FORBIDDEN");})).rejects.toThrow("PILOT_RECORD_BINDING");expect(calls).toBe(0);}finally{s.cleanup();}});
it.each(["candidateProofSha256","harnessProofSha256","harnessRevisionSha"])("changed %s cannot admit despite a rehashed grant",field=>{const s=setup();try{expect(()=>s.load({[field]:"a".repeat(field==="harnessRevisionSha"?40:64)})).toThrow("PILOT_SOURCE_BINDING");}finally{s.cleanup();}});
it("durable target claims precede dispatch; later failure stops subsequent targets",async()=>{
 const s=setup();let calls=0;try{const authority=s.load(),leaf=join(s.campaignRoot,"bounded-pilot-executions",validationExecutionKey(s.record.ownerMessageSha256),"PILOT");const result=await runBoundedPilot(authority,async request=>{const t=s.manifest.targets[calls++];const claim=JSON.parse(readFileSync(join(leaf,`${t.fixtureId}-turn-${t.turnIndex}.claim.json`),"utf8"));expect(claim).toMatchObject({target:t,financialClaimMicrounits:0});return calls===3?{status:400,body:"{}"}:response(request,encodeFixtureV3(frozenContextProposal(JSON.parse(request.messages[1].content),t.fixtureId,t.turnIndex)));},{now:()=>100});expect(calls).toBe(3);expect(result.pilotStatus).toBe("FAIL");expect(result.applicationEvidence.slice(0,2).every(t=>t.oracle==="PASS")).toBe(true);expect(readdirSync(leaf).filter(n=>n.endsWith(".terminal.json"))).toHaveLength(3);
 }finally{s.cleanup();}
});
it("prospective UNKNOWN blocks a fresh grant without resetting historical exposure",async()=>{
 const s=setup();let calls=0;try{await runBoundedPilot(s.load(),async request=>{calls++;return response(request,encodeFixtureV3(frozenContextProposal(JSON.parse(request.messages[1].content),"R01",0)),null);},{now:()=>100});
 writeFileSync(s.record.ownerMessagePath,"Different fresh test authority");const owner=hash(readFileSync(s.record.ownerMessagePath,"utf8"));const text=JSON.stringify({...s.record,ownerMessageSha256:owner,historicalInventorySha256:auditCampaignAccountRoot(s.accountRoot).inventoryDigest});writeFileSync(s.path,text);
 const authority=createBoundedPilotLoader({accountRoot:s.accountRoot,campaignRoot:s.campaignRoot,expectedCandidateSha:candidate,reviewedRecordSha256:hash(text),reviewedOwnerMessageSha256:owner})(s.path,s.root);
 expect(()=>inspectBoundedPilot(authority)).toThrow("CONFIRMED_COST_UNKNOWN_SAFETY_LIMIT");expect(calls).toBe(1);const account=inspectConfirmedCampaignCost(s.accountRoot,1500000,contextCampaignMaximumReservation,false);expect(account).toMatchObject({confirmedMicrounits:0,prospectiveUnknownCount:1,historicalUnknownExposureMicrounits:10000});
 }finally{s.cleanup();}
});
it("concurrent duplicate launcher cannot dispatch twice",async()=>{
 const s=setup();let calls=0;try{const authority=s.load();const transport=async()=>{calls++;await new Promise(resolve=>setTimeout(resolve,20));return {status:400,body:"{}"};};const outcomes=await Promise.allSettled([runBoundedPilot(authority,transport,{now:()=>100}),runBoundedPilot(authority,transport,{now:()=>100})]);expect(calls).toBe(1);expect(outcomes.filter(o=>o.status==="rejected")).toHaveLength(1);
 }finally{s.cleanup();}
});
it("pre-dispatch interruption terminalizes its claim without phantom spend",async()=>{
 const s=setup();let calls=0,ticks=0;try{const authority=s.load();const result=await runBoundedPilot(authority,async()=>{calls++;throw Error("FORBIDDEN");},{now:()=>++ticks<=3?100:1200100});
 expect(calls).toBe(0);expect(result.pilotStatus).toBe("FAIL");const leaf=join(s.campaignRoot,"bounded-pilot-executions",validationExecutionKey(s.record.ownerMessageSha256),"PILOT");expect(readdirSync(leaf)).toContain("R01-turn-0.claim.json");expect(readdirSync(leaf)).toContain("R01-turn-0.terminal.json");expect(JSON.parse(readFileSync(join(leaf,"R01-turn-0.terminal.json"),"utf8"))).toMatchObject({accepted:false});expect(inspectConfirmedCampaignCost(s.accountRoot,1500000,contextCampaignMaximumReservation,false).confirmedMicrounits).toBe(0);await expect(runBoundedPilot(authority,async()=>{calls++;throw Error("FORBIDDEN");})).rejects.toThrow("PILOT_AUTHORITY_CONSUMED");
 }finally{s.cleanup();}
});
it("interruption after dispatch retains conservative UNKNOWN and cannot redispatch",async()=>{
 const s=setup();let calls=0;try{const authority=s.load();const result=await runBoundedPilot(authority,async()=>{calls++;throw Error("simulated interruption");},{now:()=>100});expect(result.pilotStatus).toBe("FAIL");const account=inspectConfirmedCampaignCost(s.accountRoot,1500000,contextCampaignMaximumReservation,false);expect(account).toMatchObject({confirmedMicrounits:0,prospectiveUnknownCount:1,historicalUnknownExposureMicrounits:10000});await expect(runBoundedPilot(authority,async()=>{calls++;throw Error("FORBIDDEN");})).rejects.toThrow("PILOT_AUTHORITY_CONSUMED");expect(calls).toBe(1);
 }finally{s.cleanup();}
});
it("settlement-record interruption still terminalizes the target without manufacturing cost",async()=>{
 const s=setup();let calls=0;const append=recordModule.appendCandidateValidationRecord;const spy=vi.spyOn(recordModule,"appendCandidateValidationRecord").mockImplementation((root,path,value)=>{if(path.endsWith(".settled.json"))throw Error("simulated storage interruption");return append(root,path,value);});
 try{const result=await runBoundedPilot(s.load(),async request=>{calls++;return response(request,encodeFixtureV3(frozenContextProposal(JSON.parse(request.messages[1].content),"R01",0)));},{now:()=>100});expect(calls).toBe(1);expect(result.pilotStatus).toBe("FAIL");const leaf=join(s.campaignRoot,"bounded-pilot-executions",validationExecutionKey(s.record.ownerMessageSha256),"PILOT");expect(readdirSync(leaf)).toContain("R01-turn-0.terminal.json");expect(inspectConfirmedCampaignCost(s.accountRoot,1500000,contextCampaignMaximumReservation,false).confirmedMicrounits).toBe(1000);
 }finally{spy.mockRestore();s.cleanup();}
});

it("binds exact formal manifest, preserving standalone validation as non-Pilot credit",()=>{const s=setup();try{expect(s.manifest).toMatchObject({totalFixtures:32,totalTurns:84,maxProviderHttpRequests:76});expect(s.manifest.targets.slice(0,3)).toEqual([{fixtureId:"R01",turnIndex:0},{fixtureId:"R01",turnIndex:1},{fixtureId:"R02",turnIndex:0}]);expect(inspectBoundedPilot(s.load())).toMatchObject({confirmedCount:0,unknownCount:1,executionClaimMicrounits:0});}finally{s.cleanup();}});
it.each(["candidate","campaign","manifest","foreign-target","full-target","duplicate","order","count","model","provider","cap","accounting","owner"])("rejects mismatched %s even with rehashed record",kind=>{const s=setup();try{const patches:Record<string,Record<string,unknown>>={candidate:{evaluationCandidateSha:"a".repeat(40)},campaign:{campaignRoot:s.accountRoot},manifest:{manifestSha256:"a".repeat(64)},"foreign-target":{targets:[{fixtureId:"R01",turnIndex:5},...s.record.targets.slice(1)]},"full-target":{targets:[{fixtureId:"H01",turnIndex:0}]},duplicate:{targets:[s.record.targets[0],...s.record.targets.slice(0,-1)]},order:{targets:[s.record.targets[1],s.record.targets[0],...s.record.targets.slice(2)]},count:{maxProviderHttpRequests:77},model:{model:"other"},provider:{provider:"other"},cap:{hardCapMicrounits:999999},accounting:{accountingPolicy:"LEGACY"},owner:{ownerMessageSha256:"a".repeat(64)}};expect(()=>s.load(patches[kind])).toThrow();}finally{s.cleanup();}});
it("credential possession without branded Pilot authority cannot dispatch",async()=>{let calls=0;await expect(runBoundedPilot(undefined,async()=>{calls++;throw Error("FORBIDDEN");})).rejects.toThrow("PILOT_AUTHORIZATION_REQUIRED");expect(calls).toBe(0);});
it("consumed single-validation owner message cannot be repackaged as Pilot",async()=>{const s=setup();try{writeFileSync(join(s.accountRoot,".single-old.consumed.json"),JSON.stringify({ownerMessageSha256:s.record.ownerMessageSha256}));await expect(runBoundedPilot(s.load(),async()=>{throw Error("FORBIDDEN");})).rejects.toThrow("PILOT_AUTHORITY_CONSUMED");}finally{s.cleanup();}});
it("formal Pilot runs all 76 fake requests in order and completes without Full",async()=>{const s=setup();let calls=0;try{const before=readFileSync(join(s.history,"campaign.jsonl"),"utf8"),authority=s.load();const result=await runBoundedPilot(authority,async request=>{const target=s.manifest.targets[calls++],context=JSON.parse(request.messages[1].content) as ContextInput;return response(request,encodeFixtureV3(frozenContextProposal(context,target.fixtureId,target.turnIndex)));},{now:()=>100});expect(result).toMatchObject({pilotStatus:"PASS",providerInferenceHttpAttempts:76,applicationLlmCalls:76,terminal:true,fullStarted:false});expect(result.score).toMatchObject({passedScripts:32,passedTurns:84,safetyFailures:0});expect(readFileSync(join(s.history,"campaign.jsonl"),"utf8")).toBe(before);await expect(runBoundedPilot(authority,async()=>{calls++;throw Error("FORBIDDEN");})).rejects.toThrow("PILOT_AUTHORITY_CONSUMED");expect(calls).toBe(76);expect(auditCampaignAccountRoot(s.accountRoot).totals.PILOT.unknownMicrounits).toBe(10000);}finally{s.cleanup();}},120000);
it.each(["provider","wire","evidence","unknown","throw"])("first %s failure terminally blocks later targets and preserves history",async mode=>{const s=setup();let calls=0;try{const authority=s.load(),before=readFileSync(join(s.history,"campaign.jsonl"),"utf8");const result=await runBoundedPilot(authority,async request=>{calls++;if(mode==="throw")throw Error("fake network");if(mode==="provider")return{status:400,body:"{}"};const context=JSON.parse(request.messages[1].content) as ContextInput,proposal=frozenContextProposal(context,"R01",0) as ConversationInterpretation;if(mode==="evidence"&&proposal.query)proposal.query.evidence=[{kind:"USER_QUOTE",turn:context.currentTurn,quote:"ABSENT_PRIVATE_SENTINEL",occurrence:1}];return response(request,mode==="wire"?{}:encodeFixtureV3(proposal),mode==="unknown"?null:.001);},{now:()=>100});expect(calls).toBe(1);expect(result.pilotStatus).toBe("FAIL");expect(result.applicationEvidence.every(t=>t.mutations===0)).toBe(true);expect(readFileSync(join(s.history,"campaign.jsonl"),"utf8")).toBe(before);const account=auditCampaignAccountRoot(s.accountRoot);expect(account.totals.PILOT.retainedMicrounits).toBe(mode==="unknown"||mode==="throw"||mode==="provider"?10000:11000);await expect(runBoundedPilot(authority,async()=>{calls++;throw Error("FORBIDDEN");})).rejects.toThrow("PILOT_AUTHORITY_CONSUMED");}finally{s.cleanup();}});

it("formal confirmed-cost scope records a zero-dollar claim and stops after the first provider failure",async()=>{
 const directory=mkdtempSync(join(tmpdir(),"bounded-pilot-red-"));let calls=0,claims=0,settlements=0,outcomes=0;
 try{
 const result=await executeObservableCampaign({root:process.cwd(),directory,profile:"PILOT",sourceSha:"a".repeat(40),provenanceDigest:"b".repeat(64),runId:"bounded-red",accountingPolicy:"CONFIRMED_COST_V1",cumulativeAuthorizedMicrounits:1500000,cumulativeRetainedMicrounits:0,now:()=>100,
 boundedPilot:{manifestSha256:"c".repeat(64),maxRequests:76,beforeDispatch(target){expect(target).toEqual({fixtureId:"R01",turnIndex:0});claims++;},settled(){settlements++;},outcome(_target,accepted){expect(accepted).toBe(false);outcomes++;}},
 transport:async()=>{calls++;return {status:400,body:"{}",rawResponseBytes:2};}});
 expect(calls).toBe(1);expect(claims).toBe(1);expect(settlements).toBe(1);expect(outcomes).toBe(1);
 expect(result.status).toBe("STOP");expect(readCampaignLedger(directory).filter(r=>r.event==="RESERVE")).toMatchObject([{maximumMicrounits:0}]);
 }finally{rmSync(directory,{recursive:true,force:true});}
});

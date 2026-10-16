// @vitest-environment node
import { it, expect } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendCampaignEvent, reserveCampaignCall, markCampaignDispatched, finishCampaignCall, readCampaignLedger } from "./context-contract-live";
import { inspectConfirmedCampaignCost, inspectConservativeDebugCost } from "./context-confirmed-cost";
function fixture() {
 const root=realpathSync(mkdtempSync(join(tmpdir(),"confirmed-cost-")));
 function execution(id:string,cost:number|null,prospective=false,reportedCostUsd?:number,profile:"PILOT"|"FULL"="PILOT") {
  const dir=join(root,id,profile);mkdirSync(dir,{recursive:true});
  appendCampaignEvent(dir,{event:"BEGIN",runId:id,profile,sourceSha:"a".repeat(40),provenanceDigest:"b".repeat(64),cumulativeAuthorizedMicrounits:1500000,cumulativeRetainedMicrounits:0,startedAt:1,...(prospective?{executionKind:"R01_REPLAY",accountingPolicy:"CONFIRMED_COST_V1",requestExposureBoundMicrounits:105472}as const:{})});
  reserveCampaignCall(dir,{runId:id,profile,provenanceDigest:"b".repeat(64),reservationId:id,maximumMicrounits:prospective?0:100000,now:1,startedAt:1});
  markCampaignDispatched(dir,{runId:id,reservationId:id,at:1});
  finishCampaignCall(dir,{runId:id,reservationId:id,at:1,observedMicrounits:cost,...(reportedCostUsd===undefined?{}:{reportedCostUsd})});
  if(!readCampaignLedger(dir).some(r=>r.event==="STOP"))appendCampaignEvent(dir,{event:"STOP",runId:id,at:1,reason:"TERMINAL"});
  return dir;
 }
 return {root,execution,cleanup:()=>rmSync(root,{recursive:true,force:true})};
}
it("total debug cap also accounts historical FULL exposure without granting Full execution",()=>{const f=fixture();try{f.execution("full-unknown",null,false,undefined,"FULL");f.execution("full-known",10,false,undefined,"FULL");expect(inspectConservativeDebugCost(f.root,5000000,105472)).toMatchObject({confirmedMicrounits:10,unknownExposureMicrounits:100000,remainingConservativeMicrounits:4899990});expect(inspectConfirmedCampaignCost(f.root,1500000,105472).confirmedCount).toBe(0)}finally{f.cleanup()}});
it("debug admission charges historical and prospective UNKNOWN conservatively without settling or releasing either",()=>{
 const f=fixture();try{const old=f.execution("old",null),fresh=f.execution("fresh",null,true);f.execution("known",315,true,.0003146);
 const snapshots=[old,fresh].map(d=>readFileSync(join(d,"campaign.jsonl"),"utf8"));
 expect(inspectConservativeDebugCost(f.root,5000000,105472)).toMatchObject({confirmedMicrounits:315,unknownExposureMicrounits:205472,conservativeRetainedMicrounits:205787,remainingConservativeMicrounits:4794213,hardCapReady:true});
 expect([old,fresh].map(d=>readFileSync(join(d,"campaign.jsonl"),"utf8"))).toEqual(snapshots);
 expect(()=>inspectConfirmedCampaignCost(f.root,1500000,105472)).toThrow("CONFIRMED_COST_UNKNOWN_SAFETY_LIMIT");
 }finally{f.cleanup();}
});
it("debug admission stops when UNKNOWN plus the next request bound exceed the cap",()=>{
 const f=fixture();try{f.execution("unknown",null,true);
 expect(()=>inspectConservativeDebugCost(f.root,210943,105472)).toThrow("DEBUG_COST_HARD_CAP");
 expect(inspectConservativeDebugCost(f.root,210944,105472).remainingConservativeMicrounits).toBe(105472);
 }finally{f.cleanup();}
});
it("confirmed metrics use actual settlements, not historical UNKNOWN reservations",()=>{
 const f=fixture();try{
  const old=f.execution("old",null),before=readFileSync(join(old,"campaign.jsonl"),"utf8");
  for(const [id,cost]of [["one",100],["two",300],["three",200]]as const)f.execution(id,cost,true);
  expect(inspectConfirmedCampaignCost(f.root,1500000,105472)).toMatchObject({confirmedCount:3,confirmedMicrounits:600,averageMicrounits:200,minMicrounits:100,maxMicrounits:300,p50Microunits:200,p95Microunits:300,unknownCount:1,historicalUnknownExposureMicrounits:100000,prospectiveUnknownCount:0,executionClaimMicrounits:0});
  expect(readFileSync(join(old,"campaign.jsonl"),"utf8")).toBe(before);
 }finally{f.cleanup();}
});
it("terminal UNKNOWN cannot be overwritten with an invented settlement",()=>{
 const f=fixture();try{
  const dir=f.execution("known",null,true);
  // A second settlement cannot overwrite a terminal UNKNOWN.
  expect(()=>finishCampaignCall(dir,{runId:"known",reservationId:"known",at:1,observedMicrounits:315,reportedCostUsd:.0003146})).toThrow("MISSING_OR_DUPLICATE_DISPATCH");
  const state=inspectConfirmedCampaignCost(f.root,1500000,105472,false);
  expect(state.confirmedCount).toBe(0);expect(state.prospectiveUnknownCount).toBe(1);
 }finally{f.cleanup();}
});
it("exact provider charge is preserved separately from conservative integer accounting",()=>{
 const f=fixture();try{f.execution("paid",315,true,.0003146);
  expect(inspectConfirmedCampaignCost(f.root,1500000,105472)).toMatchObject({confirmedCount:1,confirmedMicrounits:315,confirmedTotalCostUsd:.0003146,averageConfirmedCostUsd:.0003146,p50ConfirmedCostUsd:.0003146,p95ConfirmedCostUsd:.0003146});
 }finally{f.cleanup();}
});
it("a full legacy UNKNOWN allowance cannot recreate the obsolete Pilot quota block",()=>{
 const f=fixture();try{for(let i=0;i<15;i++)f.execution(`old-${i}`,null);
  expect(inspectConfirmedCampaignCost(f.root,1500000,105472)).toMatchObject({confirmedMicrounits:0,hardCapReady:true,unknownSafetyReady:true,historicalUnknownExposureMicrounits:1500000});
 }finally{f.cleanup();}
});
it("historical provider-reported charge is read without rewriting its rounded settlement",()=>{
 const f=fixture();try{const dir=f.execution("call-1",315),path=join(dir,"campaign.jsonl"),before=readFileSync(path,"utf8");
  writeFileSync(join(dir,"responses.json"),JSON.stringify([{call:1,runId:"call-1",usage:{costMicrounits:315,reportedCostUsd:.0003146}}]));
  expect(inspectConfirmedCampaignCost(f.root,1500000,105472)).toMatchObject({confirmedTotalCostUsd:.0003146,roundedOnlyCount:0});
  expect(readFileSync(path,"utf8")).toBe(before);
 }finally{f.cleanup();}
});
it("mismatched historical provider cost cannot silently alter metrics",()=>{
 const f=fixture();try{const dir=f.execution("call-1",315);
  writeFileSync(join(dir,"responses.json"),JSON.stringify([{call:1,runId:"call-1",usage:{costMicrounits:315,reportedCostUsd:1}}]));
  expect(()=>inspectConfirmedCampaignCost(f.root,1500000,105472)).toThrow("CONFIRMED_COST_RESPONSE_BINDING");
 }finally{f.cleanup();}
});
it("single-response legacy artifacts bind only to a unique ledger dispatch",()=>{
 const f=fixture();try{const dir=f.execution("legacy-single",315);
  writeFileSync(join(dir,"responses.json"),JSON.stringify({usage:{costMicrounits:315,reportedCostUsd:.0003146}}));
  expect(inspectConfirmedCampaignCost(f.root,1500000,105472)).toMatchObject({confirmedTotalCostUsd:.0003146,roundedOnlyCount:0});
 }finally{f.cleanup();}
});
it("foreign response identity retains explicit rounded fallback instead of inventing precision",()=>{
 const f=fixture();try{const dir=f.execution("call-1",315);
  writeFileSync(join(dir,"responses.json"),JSON.stringify([{call:1,runId:"foreign",usage:{costMicrounits:315,reportedCostUsd:.0003146}}]));
  expect(inspectConfirmedCampaignCost(f.root,1500000,105472)).toMatchObject({confirmedTotalCostUsd:.000315,roundedOnlyCount:1});
 }finally{f.cleanup();}
});
it("new UNKNOWN consumes the prospective safety count, never confirmed spend",()=>{
 const f=fixture();try{f.execution("new",null,true);
  expect(()=>inspectConfirmedCampaignCost(f.root,1500000,105472)).toThrow("CONFIRMED_COST_UNKNOWN_SAFETY_LIMIT");
 }finally{f.cleanup();}
});
it("campaign cap derives across run IDs and rejects actual overspend",()=>{
 const f=fixture();try{f.execution("paid",1500001,true);
  expect(()=>inspectConfirmedCampaignCost(f.root,1500000,105472)).toThrow("CONFIRMED_COST_HARD_CAP");
 }finally{f.cleanup();}
});
it("crashed zero-dollar execution claim remains UNKNOWN and cannot fund another execution",()=>{
 const f=fixture();try{
  const dir=join(f.root,"crashed","PILOT");mkdirSync(dir,{recursive:true});
  appendCampaignEvent(dir,{event:"BEGIN",runId:"crashed",profile:"PILOT",sourceSha:"a".repeat(40),provenanceDigest:"b".repeat(64),cumulativeAuthorizedMicrounits:1500000,cumulativeRetainedMicrounits:0,startedAt:1,executionKind:"R01_REPLAY",accountingPolicy:"CONFIRMED_COST_V1",requestExposureBoundMicrounits:105472});
  reserveCampaignCall(dir,{runId:"crashed",profile:"PILOT",provenanceDigest:"b".repeat(64),reservationId:"crashed",maximumMicrounits:0,now:1,startedAt:1});
  expect(()=>inspectConfirmedCampaignCost(f.root,1500000,105472)).toThrow("CONFIRMED_COST_UNKNOWN_SAFETY_LIMIT");
 }finally{f.cleanup();}
});

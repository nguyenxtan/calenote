import {admitCanonicalCampaign,type ContextManifest} from './context-contract';
import {deriveBoundedPilotManifest} from './context-bounded-pilot';
import {readFileSync,lstatSync,realpathSync} from 'node:fs';import {join} from 'node:path';
import {parseJsonWithoutDuplicateMembers} from '../../src/modules/intelligence/infrastructure/openrouter/strict-json';
import {readCampaignLedger} from './context-contract-live';
import {RATE_POLICY as P,rateNatural,type RateHint} from './context-rate-policy';import type {RateReceipt} from './context-rate-receipt';
/** Bounded artifact reader; errors never include file/provider content. */
export function readRateArtifact(path:string,maximum=4194304):unknown{if(realpathSync(path)!==path||lstatSync(path).isSymbolicLink()||!lstatSync(path).isFile()||lstatSync(path).size>maximum)throw Error('RATE_ARTIFACT');return parseJsonWithoutDuplicateMembers(readFileSync(path,'utf8'));}
type ResponseRow={call:number;fixtureId:string;turnIndex:number;status:string;category?:string;httpStatus:number;usage?:{costMicrounits?:number|null}};
type ApplicationRow={fixtureId:string;turnIndex:number;oracle:string;mutations:number;oracleDiagnostics?:{passed:boolean;failedAssertionCount:number}};
type ParentReport={status:string;configuredProvider:string;privacyPolicy:string;zdr:boolean;actualProviderCalls:number;applicationLlmCalls:number;providerHttpRequests:number;responses:ResponseRow[];applicationEvidence:ApplicationRow[];actionEvidence:Array<{oracle:string;unsafe:boolean;fixtureId:string;turnIndex:number;actionIndex:number}>;score:null|{safetyFailures:number}};
/** Lifecycle closure is not billing settlement: last UNKNOWN remains full B.
 * Caller must bind these files/receipt to the exact reviewed parent or its own
 * just-finished child, never accept a caller-authored eligibility projection. */
export function verifyRateSuccessor(directory:string,manifest:string,receipt:RateReceipt,root=process.cwd()):{receiptAt:number;hint:RateHint}{return verifyRateParentForSource(directory,manifest,receipt,P.app,root);}
export function verifyRateParentForSource(directory:string,manifest:string,receipt:RateReceipt,source:string,root=process.cwd()):{receiptAt:number;hint:RateHint}{
 const fail=():never=>{throw Error('RATE_PARENT');};
 try{
  const rows=readCampaignLedger(directory),b=rows[0],end=rows.at(-1),reserves=rows.filter(r=>r.event==='RESERVE'),dispatches=rows.filter(r=>r.event==='DISPATCH'),finishes=rows.filter(r=>r.event==='FINISH');
  if(b?.event!=='BEGIN'||b.profile!=='PILOT'||b.sourceSha!==source||!(/^[a-f0-9]{40}$/u).test(source)||b.executionKind!=='BOUNDED_PILOT'||b.targetManifestSha256!==manifest||b.maxTargetRequests!==76||b.accountingPolicy!=='CONFIRMED_COST_V1'||b.requestExposureBoundMicrounits!==P.reserve||end?.event!=='STOP'||end.reason!=='UNKNOWN_USAGE')return fail();
  const n=reserves.length;if(n<2||n>76||dispatches.length!==n||finishes.length!==n)return fail();
  for(const r of reserves)if(!dispatches.some(d=>d.reservationId===r.reservationId)||!finishes.some(f=>f.reservationId===r.reservationId))return fail();
  const lastFinish=finishes.at(-1)!;if(lastFinish.observedMicrounits!=null||lastFinish.reservationId!==`call-${n}`||finishes.slice(0,-1).some(f=>f.observedMicrounits==null))return fail();
  if(!receipt||receipt.status!==429||!receipt.complete||!receipt.matchedPool||!receipt.hint||!rateNatural(receipt.capturedBytes)||receipt.capturedBytes>8192||!/^[a-f0-9]{64}$/u.test(receipt.capturedSha256??'')||!rateNatural(receipt.receivedAt)||receipt.receivedAt>lastFinish.at)return fail();
  if(deriveBoundedPilotManifest(root).manifestSha256!==manifest)return fail();
  const corpus:ContextManifest={version:'context-contract-corpus-1',cases:['regressions','development','heldout'].flatMap(name=>(readRateArtifact(join(root,`src/modules/conversation/context-contract/benchmark/${name}.json`)) as ContextManifest).cases)};
  const planned=admitCanonicalCampaign(corpus,'PILOT').flatMap(script=>script.turns.map((turn,index)=>({fixtureId:script.executionId,turnIndex:index,healthy:turn.model==='HEALTHY',actions:turn.actionsAfter??[]})));
  const report=readRateArtifact(join(directory,'report.json')) as ParentReport,responses=readRateArtifact(join(directory,'responses.json')) as ResponseRow[],terminal=readRateArtifact(join(directory,'terminal.json'),16384) as {status:string;mode:string;attempts:number;pilotCredit:boolean};
  if(terminal.status!=='STOP'||terminal.mode!=='FORMAL_PILOT'||terminal.attempts!==n||terminal.pilotCredit!==false||report.status!=='STOP'||report.configuredProvider!=='google-ai-studio'||report.privacyPolicy!=='AI_STUDIO_PILOT_RETENTION_55D'||report.zdr!==false||report.actualProviderCalls!==n||report.applicationLlmCalls!==n||report.providerHttpRequests!==n||JSON.stringify(responses)!==JSON.stringify(report.responses))return fail();
  if(!Array.isArray(responses)||responses.length!==n||!Array.isArray(report.applicationEvidence)||!Array.isArray(report.actionEvidence)||report.actionEvidence.some(a=>a.oracle!=='PASS'||a.unsafe!==false)||(report.score!==null&&report.score?.safetyFailures!==0))return fail();
  const finalTarget=responses.at(-1)!,finalIndex=planned.findIndex(t=>t.fixtureId===finalTarget.fixtureId&&t.turnIndex===finalTarget.turnIndex);
  if(finalIndex<0)return fail();const prefix=planned.slice(0,finalIndex+1),healthy=prefix.filter(t=>t.healthy);
  if(healthy.length!==n||report.applicationEvidence.length!==prefix.length)return fail();
  for(const [i,t] of prefix.entries()){
   const a=report.applicationEvidence[i];if(!a||a.fixtureId!==t.fixtureId||a.turnIndex!==t.turnIndex)return fail();
   if(i<prefix.length-1&&(a.oracle!=='PASS'||a.oracleDiagnostics?.passed!==true||a.oracleDiagnostics.failedAssertionCount!==0))return fail();
   if(i===prefix.length-1&&a.mutations!==0)return fail();
  }
  const expectedActions=prefix.slice(0,-1).flatMap(t=>t.actions.map((_,actionIndex)=>({fixtureId:t.fixtureId,turnIndex:t.turnIndex,actionIndex})));
  if(report.actionEvidence.length!==expectedActions.length||report.actionEvidence.some((a,i)=>{const t=expectedActions[i];return a.fixtureId!==t.fixtureId||a.turnIndex!==t.turnIndex||a.actionIndex!==t.actionIndex;}))return fail();
  for(const [i,r] of responses.entries()){
   const t=healthy[i],f=finishes.find(x=>x.reservationId===`call-${i+1}`);
   if(r.call!==i+1||r.fixtureId!==t.fixtureId||r.turnIndex!==t.turnIndex||!f)return fail();
   if(i<n-1&&(r.status!=='SUCCESS'||r.httpStatus!==200||!rateNatural(f.observedMicrounits)||r.usage?.costMicrounits!==f.observedMicrounits))return fail();
   if(i===n-1&&(r.status!=='FAILURE'||r.httpStatus!==429||r.category!=='RATE_LIMITED'||r.usage?.costMicrounits!=null))return fail();
  }
  return {receiptAt:receipt.receivedAt,hint:receipt.hint};
 }catch{return fail();}
}

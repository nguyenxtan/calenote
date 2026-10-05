import {createHash} from "node:crypto";
import {readFileSync,existsSync,readdirSync,lstatSync,realpathSync,mkdirSync} from "node:fs";
import {join,relative,isAbsolute} from "node:path";
import {fileURLToPath} from "node:url";
import {z} from "zod";
import {admitCanonicalCampaign,type ContextManifest} from "./context-contract";
import {auditCampaignAccountRoot,preflightContextCampaign,validateFrozenContextCorpus,withAccountRootLock} from "./context-contract-live";
import {candidateValidationProof,prepareCandidateValidation,appendCandidateValidationRecord,validationExecutionKey} from "./context-contract-candidate-validation";
import {inspectConfirmedCampaignCost} from "./context-confirmed-cost";
import {executeObservableCampaign,contextCampaignMaximumReservation} from "./context-contract-runner";
import {createContextHttpTransport,type SemanticTransport} from "../../src/modules/intelligence/infrastructure/openrouter/semantic-gateway";

const hash=(v:string|Uint8Array)=>createHash("sha256").update(v).digest("hex");
const digest=z.string().regex(/^[a-f0-9]{64}$/u),sha=z.string().regex(/^[a-f0-9]{40}$/u);
const targetSchema=z.strictObject({fixtureId:z.string().regex(/^R(?:0[1-9]|1[0-6])(?:#[23])?$/u),turnIndex:z.number().int().min(0).max(5)});
export type PilotTarget=z.infer<typeof targetSchema>;
const recordSchema=z.strictObject({version:z.literal("bounded-pilot-authority-1"),operation:z.literal("BOUNDED_T11_FORMAL_PILOT"),
 accountRoot:z.string(),campaignRoot:z.string(),evaluationCandidateSha:sha,harnessRevisionSha:sha,candidateProofSha256:digest,harnessProofSha256:digest,
 manifestSha256:digest,targets:z.array(targetSchema).min(1).max(192),maxProviderHttpRequests:z.number().int().positive().max(192),
 accountingPolicy:z.literal("CONFIRMED_COST_V1"),hardCapMicrounits:z.number().int().positive(),
 model:z.literal("google/gemini-2.5-flash-lite"),provider:z.literal("google-vertex/eu"),stream:z.literal(false),retry:z.literal(0),fallback:z.literal("none"),
 ownerMessagePath:z.string(),ownerMessageSha256:digest,historicalInventorySha256:digest});
type PilotRecord=z.infer<typeof recordSchema>;
export interface PilotTrust {accountRoot:string;campaignRoot:string;expectedCandidateSha:string;reviewedRecordSha256:string;reviewedOwnerMessageSha256:string;}
const brand:unique symbol=Symbol("BoundedPilotAuthority");
export interface BoundedPilotAuthority {readonly [brand]:true;}
const grants=new WeakMap<object,{root:string;path:string;trust:PilotTrust;record:PilotRecord}>();
const loadedChecks=new WeakMap<object,()=>void>();

export function deriveBoundedPilotManifest(root:string){
 const manifests=["regressions","development","heldout"].map(n=>JSON.parse(readFileSync(join(root,`src/modules/conversation/context-contract/benchmark/${n}.json`),"utf8")) as ContextManifest);
 validateFrozenContextCorpus(root,manifests);
 const planned=admitCanonicalCampaign({version:"context-contract-corpus-1",cases:manifests.flatMap(m=>m.cases)},"PILOT");
 const targets=planned.flatMap(s=>s.turns.flatMap((t,i)=>t.model==="HEALTHY"?[{fixtureId:s.executionId,turnIndex:i}]:[]));
 return {manifestSha256:hash(JSON.stringify({version:"bounded-formal-pilot-manifest-1",manifests,planned})),targets,
  maxProviderHttpRequests:targets.length,totalFixtures:planned.length,totalTurns:planned.reduce((n,s)=>n+s.turns.length,0)};
}
function contained(root:string,path:string){const rel=relative(root,path);if(!isAbsolute(path)||!rel||rel.startsWith("..")||isAbsolute(rel)||realpathSync(path)!==path||lstatSync(path).isSymbolicLink())throw Error("PILOT_PATH_BINDING");}
function boundedRead(path:string){if(lstatSync(path).isSymbolicLink()||lstatSync(path).size>16384)throw Error("PILOT_RECORD_SIZE");return readFileSync(path,"utf8");}
function key(r:PilotRecord){return validationExecutionKey(r.ownerMessageSha256);}
function directory(r:PilotRecord){return join(r.campaignRoot,"bounded-pilot-executions",key(r),"PILOT");}
function verify(root:string,path:string,trust:PilotTrust){
 if(realpathSync(trust.accountRoot)!==trust.accountRoot)throw Error("PILOT_ACCOUNT_ROOT");contained(trust.accountRoot,path);contained(trust.accountRoot,trust.campaignRoot);
 const text=boundedRead(path);if(hash(text)!==trust.reviewedRecordSha256)throw Error("PILOT_RECORD_BINDING");
 const r=recordSchema.parse(JSON.parse(text));
 if(r.accountRoot!==trust.accountRoot||r.campaignRoot!==trust.campaignRoot||r.evaluationCandidateSha!==trust.expectedCandidateSha)throw Error("PILOT_SCOPE_BINDING");
 contained(r.accountRoot,r.ownerMessagePath);if(r.ownerMessageSha256!==trust.reviewedOwnerMessageSha256||hash(boundedRead(r.ownerMessagePath))!==r.ownerMessageSha256)throw Error("PILOT_OWNER_BINDING");
 const proof=candidateValidationProof(root,r.evaluationCandidateSha);
 if(proof.harnessRevisionSha!==r.harnessRevisionSha||proof.candidateProofSha256!==r.candidateProofSha256||proof.harnessProofSha256!==r.harnessProofSha256)throw Error("PILOT_SOURCE_BINDING");
 const manifest=deriveBoundedPilotManifest(root);
 if(manifest.manifestSha256!==r.manifestSha256||JSON.stringify(manifest.targets)!==JSON.stringify(r.targets)||manifest.maxProviderHttpRequests!==r.maxProviderHttpRequests)throw Error("PILOT_MANIFEST_BINDING");
 if(r.hardCapMicrounits!==preflightContextCampaign({root}).pilot.maxMicrounits)throw Error("PILOT_CAP_BINDING");
 const history=auditCampaignAccountRoot(r.accountRoot,directory(r));
 if(history.inventoryDigest!==r.historicalInventorySha256||!history.bindings.some(b=>b.directory===join(r.campaignRoot,"PILOT")))throw Error("PILOT_HISTORY_BINDING");
 return r;
}
export function createBoundedPilotLoader(trust:PilotTrust){const pins=Object.freeze({...trust});return(path:string,root:string):BoundedPilotAuthority=>{const record=verify(root,path,pins),a=Object.freeze({}) as BoundedPilotAuthority;grants.set(a,{root,path,trust:pins,record});return a;};}
function grant(a:BoundedPilotAuthority|undefined){const g=a&&grants.get(a);if(!g)throw Error("PILOT_AUTHORIZATION_REQUIRED");return {...g,record:verify(g.root,g.path,g.trust)};}
function unconsumed(r:PilotRecord){
 if(existsSync(directory(r)))throw Error("PILOT_AUTHORITY_CONSUMED");
 for(const name of readdirSync(r.accountRoot).filter(n=>n.startsWith(".")&&n.endsWith(".consumed.json"))){const path=join(r.accountRoot,name);contained(r.accountRoot,path);const value=JSON.parse(boundedRead(path));if(value.ownerMessageSha256===r.ownerMessageSha256||value.ownerApprovalSha256===r.ownerMessageSha256)throw Error("PILOT_AUTHORITY_CONSUMED");}
}
export function inspectBoundedPilot(a:BoundedPilotAuthority|undefined){const g=grant(a);unconsumed(g.record);return inspectConfirmedCampaignCost(g.record.accountRoot,g.record.hardCapMicrounits,contextCampaignMaximumReservation);}
export function prepareBoundedPilot(root:string,candidate:string){const p=prepareCandidateValidation(root,candidate),manifest=deriveBoundedPilotManifest(root);return {...p,...manifest,target:"FORMAL_PILOT" as const,authorityMechanism:"READY_FOR_FRESH_BOUNDED_PILOT_GRANT",formalSatisfiedTurns:0,formalRemainingTurns:manifest.totalTurns};}
export async function loadTrustedBoundedPilot(root:string,candidate:string,pins:{recordPath:string;reviewedRecordSha256:string;reviewedOwnerMessageSha256:string;}){
 const p=prepareBoundedPilot(root,candidate),loader=await import("./register-conversation-loader.mjs");const check=()=>loader.assertLoadedCandidateModules(root,candidate,p.harnessRevisionSha);check();
 const a=createBoundedPilotLoader({accountRoot:p.accountRoot,campaignRoot:p.parentCampaignRoot,expectedCandidateSha:candidate,...pins})(pins.recordPath,root);inspectBoundedPilot(a);loadedChecks.set(a,check);return a;
}
export async function runBoundedPilot(a:BoundedPilotAuthority|undefined,transport:SemanticTransport,options:{now?:()=>number}={}){
 const initial=grant(a),executingRoot=realpathSync(fileURLToPath(new URL("../../",import.meta.url)));
 if(realpathSync(initial.root)!==executingRoot||realpathSync(process.cwd())!==executingRoot)throw Error("PILOT_EXECUTING_ROOT");
 return withAccountRootLock(initial.record.accountRoot,async()=>{
  const g=grant(a),r=g.record,before=inspectBoundedPilot(a),leaf=directory(r);
  appendCandidateValidationRecord(r.accountRoot,join(r.accountRoot,`.${key(r)}.consumed.json`),{ownerMessageSha256:r.ownerMessageSha256,evaluationCandidateSha:r.evaluationCandidateSha,operation:r.operation});
  mkdirSync(leaf,{recursive:true,mode:0o700});appendCandidateValidationRecord(r.accountRoot,join(leaf,"execution.json"),{record:r,accounting:before});
  let next=0;const states=new Map<string,{target:PilotTarget;reservationId:string;settled:boolean;terminal:boolean}>();
  const targetKey=(t:PilotTarget)=>`${t.fixtureId}-turn-${t.turnIndex}`;
  const write=(t:PilotTarget,phase:string,value:unknown)=>appendCandidateValidationRecord(r.accountRoot,join(leaf,`${targetKey(t)}.${phase}.json`),value);
  let firstGateFailure:{fixtureId:string;turnIndex:number;stage:"PRE_DISPATCH_ADMISSION";code:string}|null=null;
  const safeGateCodes=new Set(["CONFIRMED_COST_HARD_CAP","CONFIRMED_COST_UNKNOWN_SAFETY_LIMIT","PILOT_TARGET_FENCE","PILOT_SOURCE_BINDING","PILOT_MANIFEST_BINDING","PILOT_RECORD_BINDING","PILOT_HISTORY_BINDING","PILOT_OWNER_BINDING","PILOT_SCOPE_BINDING"]);
  const hooks={manifestSha256:r.manifestSha256,maxRequests:r.maxProviderHttpRequests,beforeDispatch(t:PilotTarget,reservationId:string){
   try {
   grant(a);loadedChecks.get(a!)?.();if(JSON.stringify(t)!==JSON.stringify(r.targets[next])||states.has(targetKey(t))||next>=r.maxProviderHttpRequests||[...states.values()].some(s=>!s.terminal))throw Error("PILOT_TARGET_FENCE");
   inspectConfirmedCampaignCost(r.accountRoot,r.hardCapMicrounits,contextCampaignMaximumReservation);
   write(t,"claim",{target:t,reservationId,financialClaimMicrounits:0,authoritySha256:g.trust.reviewedRecordSha256});states.set(targetKey(t),{target:t,reservationId,settled:false,terminal:false});next++;
   }catch(error){if(!firstGateFailure){const code=error instanceof Error&&safeGateCodes.has(error.message)?error.message:"PILOT_ADMISSION_FAILED";firstGateFailure={...t,stage:"PRE_DISPATCH_ADMISSION",code};appendCandidateValidationRecord(r.accountRoot,join(leaf,"first-gate-failure.json"),firstGateFailure);}throw error;}
  },settled(t:PilotTarget,reservationId:string,costMicrounits:number|null){const s=states.get(targetKey(t));if(!s||s.settled||s.reservationId!==reservationId)throw Error("PILOT_SETTLEMENT_FENCE");write(t,"settled",{target:t,reservationId,costMicrounits});s.settled=true;
  },outcome(t:PilotTarget,accepted:boolean){const s=states.get(targetKey(t));if(!s){if(!accepted)return;throw Error("PILOT_TARGET_NOT_DISPATCHED");}if(s.terminal)throw Error("PILOT_TARGET_TERMINAL");if(!s.settled)throw Error("PILOT_TARGET_UNSETTLED");write(t,"terminal",{target:t,accepted});s.terminal=true;}};
  let attempts=0;
  // Termination is not a cost settlement. Never fabricate a known zero for an
  // interrupted target: its ledger retains pending/UNKNOWN accounting as-is.
  const terminateOutstanding=()=>{for(const s of states.values())if(!s.terminal){write(s.target,"terminal",{target:s.target,accepted:false,settlementRecorded:s.settled,reason:"EXECUTION_INTERRUPTED"});s.terminal=true;}};
  try{
   const result=await executeObservableCampaign({root:g.root,directory:leaf,profile:"PILOT",sourceSha:r.evaluationCandidateSha,provenanceDigest:r.candidateProofSha256,runId:key(r),accountingPolicy:"CONFIRMED_COST_V1",boundedPilot:hooks,cumulativeAuthorizedMicrounits:r.hardCapMicrounits,cumulativeRetainedMicrounits:before.confirmedMicrounits,now:options.now,
    transport:async(request,requestOptions)=>{grant(a);loadedChecks.get(a!)?.();if(attempts>=next||attempts>=r.maxProviderHttpRequests||request.model!==r.model||request.stream!==false||request.provider.only.join("|")!==r.provider||request.provider.allow_fallbacks!==false||request.provider.require_parameters!==true||request.provider.zdr!==true||request.provider.data_collection!=="deny")throw Error("PILOT_HTTP_ROUTE_FENCE");attempts++;return transport(request,requestOptions);}});
   const passed=result.status==="PASS"&&result.score?.gate==="PASS"&&attempts===r.targets.length&&states.size===r.targets.length&&[...states.values()].every(s=>s.terminal);
   if(!passed)terminateOutstanding();
   appendCandidateValidationRecord(r.accountRoot,join(leaf,"terminal.json"),{status:passed?"PASS":"FAIL",attempts,fullStarted:false});
   return {...result,firstGateFailure,pilotStatus:passed?"PASS" as const:"FAIL" as const,providerInferenceHttpAttempts:attempts,terminal:true,fullStarted:false};
  }catch(error){terminateOutstanding();appendCandidateValidationRecord(r.accountRoot,join(leaf,"terminal.json"),{status:"FAIL",attempts,fullStarted:false});throw error;}
 });
}
export async function runTrustedBoundedPilot(a:BoundedPilotAuthority|undefined,key:string){const check=a&&loadedChecks.get(a);if(!check)throw Error("PILOT_TRUSTED_AUTHORITY_REQUIRED");check();inspectBoundedPilot(a);if(!key||/[\r\n]/u.test(key))throw Error("CREDENTIAL_INVALID");let physicalAttempts=0;
 const result=await runBoundedPilot(a,async(request,options)=>{let fetched=false;const physical=createContextHttpTransport(key,async(url,init)=>{check();if(fetched)throw Error("PILOT_PHYSICAL_HTTP_FENCE");fetched=true;physicalAttempts++;return fetch(url,{...init,redirect:"error"});});return physical(request,options);});return {...result,physicalProviderHttpAttempts:physicalAttempts};}

import {createHash} from "node:crypto";
import {readFileSync,lstatSync,realpathSync,existsSync,mkdirSync} from "node:fs";
import {join,relative,isAbsolute} from "node:path";
import {z} from "zod";
import {candidateValidationProof,appendCandidateValidationRecord} from "./context-contract-candidate-validation";
import {auditCampaignAccountRoot,withAccountRootLock} from "./context-contract-live";
import {inspectConservativeDebugCost} from "./context-confirmed-cost";
import {deriveBoundedPilotManifest} from "./context-bounded-pilot";
import {executeObservableCampaign,executeObservableR01Turn0Replay,executeObservableSingleTargetValidation,resolveSingleValidationTarget,contextCampaignMaximumReservation} from "./context-contract-runner";
import {createContextHttpTransport,type SemanticTransport} from "../../src/modules/intelligence/infrastructure/openrouter/semantic-gateway";

const hash=(s:string)=>createHash("sha256").update(s).digest("hex");
const digest=z.string().regex(/^[a-f0-9]{64}$/u);
const schema=z.strictObject({version:z.literal("t11-debug-loop-authority-1"),operation:z.literal("T11_SCHEMA_DEBUG_THROUGH_FORMAL_PILOT"),
 accountRoot:z.string(),campaignRoot:z.string(),hardCapMicrounits:z.number().int().positive().max(5000000),accountingPolicy:z.literal("CONSERVATIVE_DEBUG_V1"),
 model:z.literal("google/gemini-2.5-flash-lite"),provider:z.literal("google-vertex/eu"),retry:z.literal(0),fallback:z.literal("none"),stream:z.literal(false),
 manifestSha256:digest,ownerMessagePath:z.string(),ownerMessageSha256:digest});
export interface DebugLoopTrust {accountRoot:string;campaignRoot:string;reviewedRecordSha256:string;reviewedOwnerMessageSha256:string}
const brand:unique symbol=Symbol("DebugLoopAuthority");
export interface DebugLoopAuthority {readonly [brand]:true}
const grants=new WeakMap<object,{root:string;path:string;trust:DebugLoopTrust}>();
const loadedChecks=new WeakMap<object,(candidate:string,harness:string)=>void>();
function read(root:string,path:string){const rel=relative(root,path);if(!isAbsolute(path)||!rel||rel.startsWith("..")||isAbsolute(rel)||realpathSync(path)!==path||lstatSync(path).isSymbolicLink()||!lstatSync(path).isFile()||lstatSync(path).size>16384)throw Error("DEBUG_PATH_BINDING");return readFileSync(path,"utf8")}
function verify(g:{root:string;path:string;trust:DebugLoopTrust}){
 const {trust:t}=g,text=read(t.accountRoot,g.path);if(hash(text)!==t.reviewedRecordSha256)throw Error("DEBUG_RECORD_BINDING");
 const r=schema.parse(JSON.parse(text));
 if(r.accountRoot!==t.accountRoot||r.campaignRoot!==t.campaignRoot||realpathSync(t.accountRoot)!==t.accountRoot||!relative(t.accountRoot,t.campaignRoot)||relative(t.accountRoot,t.campaignRoot).startsWith("..")||realpathSync(t.campaignRoot)!==t.campaignRoot)throw Error("DEBUG_CAMPAIGN_BINDING");
 if(r.ownerMessageSha256!==t.reviewedOwnerMessageSha256||hash(read(t.accountRoot,r.ownerMessagePath))!==t.reviewedOwnerMessageSha256)throw Error("DEBUG_OWNER_BINDING");
 if(deriveBoundedPilotManifest(g.root).manifestSha256!==r.manifestSha256)throw Error("DEBUG_MANIFEST_BINDING");
 if(!auditCampaignAccountRoot(r.accountRoot).bindings.some(b=>b.directory===join(r.campaignRoot,"PILOT")))throw Error("DEBUG_HISTORY_BINDING");
 return {...g,record:r};
}
function grant(a:DebugLoopAuthority|undefined){const g=a&&grants.get(a);if(!g)throw Error("DEBUG_AUTHORITY_REQUIRED");return verify(g)}
export function createDebugLoopLoader(trust:DebugLoopTrust){const pins=Object.freeze({...trust});return(path:string,root:string):DebugLoopAuthority=>{const g={root,path,trust:pins};verify(g);const a=Object.freeze({})as DebugLoopAuthority;grants.set(a,g);return a}}
export function inspectDebugLoop(a:DebugLoopAuthority|undefined){const {record:r}=grant(a);return inspectConservativeDebugCost(r.accountRoot,r.hardCapMicrounits,contextCampaignMaximumReservation)}
export const DEBUG_PROBE_MODES=["R02_TURN0","CANONICAL_WIRE","V14","QUERY_ONLY","NO_REQUEST_TARGET","NO_CHANGE_EVIDENCE","CHANGE_TEXT_ONLY","CHANGE_DATE_ONLY","CHANGE_TIME_ONLY","CHANGE_SCALAR_ONLY","CHANGE_CLEAR_ONLY"] as const;
export type DebugProbeMode=typeof DEBUG_PROBE_MODES[number];
type Node={type?:string;properties?:Record<string,Node>;$defs?:Record<string,Node>;anyOf?:Node[];items?:Node;$ref?:string;[key:string]:unknown};
/** Diagnostic ablation ONLY. Never used as runtime output repair. Probe
 * responses cannot earn Pilot credit; the candidate decoder stays unchanged. */
export function debugProbeSchema<T>(input:T,mode:DebugProbeMode):T{
 if(!DEBUG_PROBE_MODES.includes(mode))throw Error("DEBUG_PROBE_SCOPE");
 const s=structuredClone(input) as Node;
 if(mode==="R02_TURN0"||mode==="CANONICAL_WIRE"||mode==="V14")return s as T;
 const change=s.properties?.changes?.items,definition=change?.$ref?s.$defs?.[change.$ref.split("/").at(-1)!]:undefined;
 const groups:Record<string,string[]>={CHANGE_TEXT_ONLY:["title","location","notes"],CHANGE_DATE_ONLY:["eventDate","reminderDate","endDate"],CHANGE_TIME_ONLY:["eventTime","reminderTime"],CHANGE_SCALAR_ONLY:["calendar","frequency","occurrenceCount","leadOffsetDays","eventRelation"]};
 const unslot=(n:Node)=>{const e=n.properties?.evidence;if(!e?.properties?.primaryEvidence)throw Error("DEBUG_PROBE_SHAPE");n.properties!.evidence={type:"array",items:e.properties.primaryEvidence}};
 if(mode!=="NO_CHANGE_EVIDENCE") {const target=s.properties?.requestTarget?.anyOf?.[0];if(!target)throw Error("DEBUG_PROBE_SHAPE");unslot(target)}
 if(!definition?.anyOf?.length)throw Error("DEBUG_PROBE_SHAPE");
 definition.anyOf=definition.anyOf.flatMap(n=>{
  const field=n.properties?.field,operation=n.properties?.operation;
  const fields=Array.isArray(field?.enum)?field.enum:typeof field?.const==="string"?[field.const]:undefined;
  if(!fields?.length||!fields.every(f=>typeof f==="string")||!operation)throw Error("DEBUG_PROBE_SHAPE");
  const clear=operation.const==="CLEAR";
  const keep=(f:unknown)=>mode==="NO_REQUEST_TARGET"||mode==="CHANGE_CLEAR_ONLY"&&clear||!clear&&(groups[mode]?.includes(String(f))??false);
  const retained=fields.filter(keep),ablated=fields.filter(f=>!keep(f));
  return [retained,ablated].filter(part=>part.length).map(part=>{
   const branch=structuredClone(n);
   if(part.length!==fields.length)branch.properties!.field={type:"string",enum:part};
   if(!keep(part[0]))unslot(branch);
   return branch;
  });
 });
 return s as T;
}
export async function loadTrustedDebugLoop(root:string,path:string,trust:DebugLoopTrust,candidate:string){
 const a=createDebugLoopLoader(trust)(path,root),loader=await import("./register-conversation-loader.mjs");
 loadedChecks.set(a,(candidate,harness)=>{loader.assertLoadedCandidateModules(root,candidate,harness)});
 const proof=candidateValidationProof(root,candidate);loadedChecks.get(a)!(candidate,proof.harnessRevisionSha);inspectDebugLoop(a);return a;
}
export async function runDebugLoopExecution(a:DebugLoopAuthority|undefined,candidate:string,mode:DebugProbeMode|"FORMAL_PILOT",transport:SemanticTransport,options:{now?:()=>number}={}){
 const initial=grant(a);if(mode!=="FORMAL_PILOT"&&!DEBUG_PROBE_MODES.includes(mode))throw Error("DEBUG_PROBE_SCOPE");
 return withAccountRootLock(initial.record.accountRoot,async()=>{
 const g=grant(a),r=g.record,proof=candidateValidationProof(g.root,candidate),manifest=deriveBoundedPilotManifest(g.root);
 loadedChecks.get(a!)?.(candidate,proof.harnessRevisionSha);
 const id=`debug-${hash(r.ownerMessageSha256+candidate+mode).slice(0,40)}`,leaf=join(r.campaignRoot,"debug-loop-executions",id,"PILOT");
 if(existsSync(leaf))throw Error("DEBUG_EXECUTION_CONSUMED");
 const before=inspectDebugLoop(a);mkdirSync(leaf,{recursive:true,mode:0o700});
 appendCandidateValidationRecord(r.accountRoot,join(leaf,"execution.json"),{authoritySha256:g.trust.reviewedRecordSha256,...proof,mode,manifestSha256:r.manifestSha256,accounting:before});
 let attempts=0,next=0;const targets=mode==="FORMAL_PILOT"?manifest.targets:[{fixtureId:mode==="R02_TURN0"?"R02":"R01",turnIndex:0}];
 const singleTarget=mode==="R02_TURN0"?resolveSingleValidationTarget(g.root,{fixture:"R02",turn:0}):undefined;
 const check=()=>{grant(a);const p=candidateValidationProof(g.root,candidate);if(JSON.stringify(p)!==JSON.stringify(proof))throw Error("DEBUG_SOURCE_BINDING");loadedChecks.get(a!)?.(candidate,proof.harnessRevisionSha)};
 const hooks={manifestSha256:r.manifestSha256,maxRequests:targets.length,beforeDispatch(t:{fixtureId:string;turnIndex:number},reservationId:string){check();if(JSON.stringify(t)!==JSON.stringify(targets[next])||attempts!==next)throw Error("DEBUG_TARGET_FENCE");inspectDebugLoop(a);appendCandidateValidationRecord(r.accountRoot,join(leaf,`target-${next}.claim.json`),{target:t,reservationId});next++},settled(){},outcome(){}};
 const input={root:g.root,directory:leaf,profile:"PILOT" as const,sourceSha:candidate,provenanceDigest:proof.candidateProofSha256,runId:id,accountingPolicy:"CONFIRMED_COST_V1" as const,debugBudgetAuthoritySha256:g.trust.reviewedRecordSha256,cumulativeAuthorizedMicrounits:r.hardCapMicrounits,cumulativeRetainedMicrounits:before.confirmedMicrounits,now:options.now,
 transport:async(request:Parameters<SemanticTransport>[0],requestOptions:Parameters<SemanticTransport>[1])=>{
 check();if(attempts>=targets.length||request.model!==r.model||request.provider.only.join("|")!==r.provider||request.stream!==false||request.provider.allow_fallbacks!==false||request.provider.require_parameters!==true||request.provider.zdr!==true||request.provider.data_collection!=="deny"||request.max_tokens!==1536||request.response_format.json_schema.strict!==true)throw Error("DEBUG_HTTP_ROUTE_FENCE");
 // For probes the runner has already durably marked DISPATCH. It contains
 // exactly one selected frozen turn; check budget without counting its pending
 // claim twice (the before-execution inspection reserved full headroom).
 const outbound=mode==="FORMAL_PILOT"?request:{...request,response_format:{...request.response_format,json_schema:{...request.response_format.json_schema,schema:debugProbeSchema(request.response_format.json_schema.schema,mode)}}};
 appendCandidateValidationRecord(r.accountRoot,join(leaf,`http-${attempts}.json`),{requestSha256:hash(JSON.stringify(outbound)),schemaSha256:hash(JSON.stringify(outbound.response_format.json_schema.schema)),mode});attempts++;return transport(outbound,requestOptions);
 }};
 try{const result=mode==="FORMAL_PILOT"?await executeObservableCampaign({...input,boundedPilot:hooks}):singleTarget?await executeObservableSingleTargetValidation({...input,singleTarget:{fixture:singleTarget.fixture,turn:0,manifestSha256:singleTarget.manifestSha256}}):await executeObservableR01Turn0Replay(input);
 const passed=mode==="FORMAL_PILOT"&&result.status==="PASS"&&result.score?.gate==="PASS"&&attempts===targets.length;
 appendCandidateValidationRecord(r.accountRoot,join(leaf,"terminal.json"),{status:passed?"PASS":"STOP",attempts,mode,pilotCredit:passed});
 return {...result,directory:leaf,providerHttpAttempts:attempts,terminal:true,pilotCredit:passed,accounting:inspectConservativeDebugCost(r.accountRoot,r.hardCapMicrounits,contextCampaignMaximumReservation,false)};
 }catch(error){appendCandidateValidationRecord(r.accountRoot,join(leaf,"terminal.json"),{status:"FAIL",attempts,mode,pilotCredit:false});throw error}
 });
}
export async function runTrustedDebugLoopExecution(a:DebugLoopAuthority|undefined,candidate:string,mode:DebugProbeMode|"FORMAL_PILOT",key:string){
 const check=a&&loadedChecks.get(a);if(!check)throw Error("DEBUG_TRUSTED_AUTHORITY_REQUIRED");
 const {root}=grant(a),proof=candidateValidationProof(root,candidate);check(candidate,proof.harnessRevisionSha);inspectDebugLoop(a);
 if(!key||/[\r\n]/u.test(key))throw Error("CREDENTIAL_INVALID");let physicalAttempts=0;
 const result=await runDebugLoopExecution(a,candidate,mode,async(request,options)=>{let fetched=false;return createContextHttpTransport(key,async(url,init)=>{if(fetched)throw Error("DEBUG_PHYSICAL_HTTP_FENCE");fetched=true;physicalAttempts++;return fetch(url,{...init,redirect:"error"})})(request,options)});
 return {...result,physicalProviderHttpAttempts:physicalAttempts};
}

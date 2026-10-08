import {createHash} from "node:crypto";
import {readFileSync,lstatSync,realpathSync,existsSync,mkdirSync} from "node:fs";
import {join,relative,isAbsolute} from "node:path";
import {z} from "zod";
import {candidateValidationProof,appendCandidateValidationRecord} from "./context-contract-candidate-validation";
import {auditCampaignAccountRoot,withAccountRootLock,readCampaignLedger} from "./context-contract-live";
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
export interface DebugFreshRunTrust {recordPath:string;reviewedRecordSha256:string;reviewedOwnerMessageSha256:string;reviewedEvidenceSha256:string;expectedCandidateSha:string;parentDirectory:string}
export interface DebugLoopTrust {accountRoot:string;campaignRoot:string;reviewedRecordSha256:string;reviewedOwnerMessageSha256:string;freshRun?:DebugFreshRunTrust}
const brand:unique symbol=Symbol("DebugLoopAuthority");
export interface DebugLoopAuthority {readonly [brand]:true}
const grants=new WeakMap<object,{root:string;path:string;trust:DebugLoopTrust}>();
const loadedChecks=new WeakMap<object,(candidate:string,harness:string)=>void>();
function read(root:string,path:string,maximum=16384){const rel=relative(root,path);if(!isAbsolute(path)||!rel||rel.startsWith("..")||isAbsolute(rel)||realpathSync(path)!==path||lstatSync(path).isSymbolicLink()||!lstatSync(path).isFile()||lstatSync(path).size>maximum)throw Error("DEBUG_PATH_BINDING");return readFileSync(path,"utf8")}
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
export function createDebugLoopLoader(trust:DebugLoopTrust){const pins=Object.freeze({...trust,...(trust.freshRun?{freshRun:Object.freeze({...trust.freshRun})}:{})});return(path:string,root:string):DebugLoopAuthority=>{const g={root,path,trust:pins};const checked=verify(g);if(pins.freshRun)verifyFreshRun(checked,pins.freshRun.expectedCandidateSha);const a=Object.freeze({})as DebugLoopAuthority;grants.set(a,g);return a}}
export function inspectDebugLoop(a:DebugLoopAuthority|undefined){const {record:r}=grant(a);return inspectConservativeDebugCost(r.accountRoot,r.hardCapMicrounits,contextCampaignMaximumReservation)}
const natural=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const freshSchema=z.strictObject({version:z.literal("debug-fresh-run-authority-1"),operation:z.literal("FRESH_FORMAL_PILOT_AFTER_GOOGLE_429"),accountRoot:z.string(),campaignRoot:z.string(),evaluationCandidateSha:z.string().regex(/^[a-f0-9]{40}$/u),candidateProofSha256:digest,mode:z.literal("FORMAL_PILOT"),manifestSha256:digest,budgetAuthoritySha256:digest,parentDirectory:z.string(),evidencePath:z.string(),evidenceSha256:digest,ownerMessagePath:z.string(),ownerMessageSha256:digest,cooldownMs:natural.min(60000),retry:z.literal(0),fallback:z.literal("none")});
const artifactSchema=z.strictObject({"execution.json":digest,"terminal.json":digest,"campaign.jsonl":digest,"report.json":digest,"responses.json":digest});
const metadataProjectionSchema=z.strictObject({version:z.literal("provider-failure-1"),httpStatus:z.literal(200),responseBytes:natural.max(32768),contentType:z.literal("application/json"),bodyState:z.literal("JSON"),bodyDigest:digest,errorMetadataSanitized:z.strictObject({status:z.literal(429),provider_name:z.literal("Google")})});
const generationMetadataThrottleSchema=z.strictObject({version:z.literal("debug-throttle-evidence-1"),kind:z.literal("REVIEWED_GENERATION_METADATA"),parentDirectory:z.string(),artifactSha256:artifactSchema,generationId:z.string().regex(/^gen-[A-Za-z0-9_-]{1,156}$/u),model:z.literal("google/gemini-2.5-flash-lite"),provider:z.literal("Google"),upstreamHttpStatus:z.literal(429),finishReason:z.literal("error"),reportedCostUsd:z.number().finite().nonnegative(),verifiedAt:natural,projection:metadataProjectionSchema});
// An application envelope is not generation metadata. Its 429 must come from
// the immutable hashed parent response, not the sidecar's status labels.
const applicationEnvelopeThrottleSchema=generationMetadataThrottleSchema.omit({projection:true}).extend({kind:z.literal("REVIEWED_APPLICATION_ENVELOPE")});
const throttleSchema=z.discriminatedUnion("kind",[generationMetadataThrottleSchema,applicationEnvelopeThrottleSchema]);
const providerErrorDiagnosticSchema=z.object({state:z.literal("PROVIDER_ENVELOPE_FAILED"),schemaVersion:z.literal("calenote-context-3"),inputRepresentation:z.literal("PROVIDER_ENVELOPE"),payloadByteCount:natural.max(32768),payloadSha256:digest,
 validation:z.object({truncated:z.literal(false),issues:z.array(z.object({path:z.tuple([z.literal("choices"),z.literal(0),z.literal("finish_reason")]),code:z.literal("invalid_value"),actualType:z.literal("string"),unknownPathSegments:z.literal(0),classification:z.literal("value"),expected:z.literal("CONTROL_ENUM")})).length(1)}),
 providerEnvelope:z.object({version:z.literal("provider-envelope-1"),choicesType:z.literal("array"),choicesCount:z.literal(1),firstChoice:z.object({finishReason:z.object({type:z.literal("string"),token:z.literal("error"),length:z.literal(5),sha256:z.literal("ca00fccfb408989eddc401062c4d1219a6aceb6b9b55412357f1790862e8f178")})})})});
function baseExecutionId(owner:string,candidate:string,mode:string){return `debug-${hash(owner+candidate+mode).slice(0,40)}`}
function successorMarker(accountRoot:string,parent:string){return join(accountRoot,`.debug-successor-${hash(parent)}.json`)}
/** A terminal stays immutable. Only separately reviewed evidence and lifecycle
 * pins can authorize a successor; bytes/digests alone do not prove ownership. */
function verifyFreshRun(g:ReturnType<typeof verify>,candidate:string,checkSettlements=true){
 const t=g.trust.freshRun;if(!t)throw Error("DEBUG_FRESH_AUTHORITY_REQUIRED");
 const text=read(g.record.accountRoot,t.recordPath);if(hash(text)!==t.reviewedRecordSha256)throw Error("DEBUG_FRESH_RECORD_BINDING");
 const r=freshSchema.parse(JSON.parse(text)),budget=g.record;
 if(r.accountRoot!==budget.accountRoot||r.campaignRoot!==budget.campaignRoot||r.evaluationCandidateSha!==candidate||candidate!==t.expectedCandidateSha||r.parentDirectory!==t.parentDirectory||r.budgetAuthoritySha256!==g.trust.reviewedRecordSha256||r.manifestSha256!==budget.manifestSha256)throw Error("DEBUG_FRESH_SCOPE_BINDING");
 if(r.ownerMessageSha256!==t.reviewedOwnerMessageSha256||hash(read(r.accountRoot,r.ownerMessagePath))!==t.reviewedOwnerMessageSha256)throw Error("DEBUG_FRESH_OWNER_BINDING");
 if(candidateValidationProof(g.root,candidate).candidateProofSha256!==r.candidateProofSha256)throw Error("DEBUG_FRESH_SOURCE_BINDING");
 const evidenceText=read(r.accountRoot,r.evidencePath);if(hash(evidenceText)!==t.reviewedEvidenceSha256||r.evidenceSha256!==t.reviewedEvidenceSha256)throw Error("DEBUG_THROTTLE_EVIDENCE_BINDING");
 const evidence=throttleSchema.parse(JSON.parse(evidenceText));if(evidence.parentDirectory!==r.parentDirectory)throw Error("DEBUG_THROTTLE_PARENT_BINDING");
 const texts=Object.fromEntries(Object.entries(evidence.artifactSha256).map(([name,expected])=>{const text=read(r.accountRoot,join(r.parentDirectory,name),4194304);if(hash(text)!==expected)throw Error("DEBUG_THROTTLE_ARTIFACT_BINDING");return [name,text]}));
 const parent=JSON.parse(texts["execution.json"]),terminal=JSON.parse(texts["terminal.json"]),report=JSON.parse(texts["report.json"]),responses=JSON.parse(texts["responses.json"]),rows=readCampaignLedger(r.parentDirectory),begin=rows[0],last=rows.at(-1);
 if(parent.evaluationCandidateSha!==candidate||parent.candidateProofSha256!==r.candidateProofSha256||parent.authoritySha256!==r.budgetAuthoritySha256||parent.manifestSha256!==r.manifestSha256||parent.mode!==r.mode||terminal.mode!==r.mode||terminal.status!=="STOP"||terminal.pilotCredit!==false||begin?.event!=="BEGIN"||begin.sourceSha!==candidate||begin.profile!=="PILOT"||begin.executionKind!=="BOUNDED_PILOT"||begin.targetManifestSha256!==r.manifestSha256||begin.debugBudgetAuthoritySha256!==r.budgetAuthoritySha256||begin.cumulativeAuthorizedMicrounits!==budget.hardCapMicrounits||last?.event!=="STOP"||last.reason!=="PROVIDER_ADMISSION_FAILED")throw Error("DEBUG_THROTTLE_TERMINAL_BINDING");
 const claims=rows.filter(row=>row.event==="RESERVE"),dispatches=rows.filter(row=>row.event==="DISPATCH"),finishes=rows.filter(row=>row.event==="FINISH");
 if(!claims.length||claims.length!==dispatches.length||claims.length!==finishes.length||terminal.attempts!==claims.length||!Array.isArray(responses)||responses.length!==claims.length||report.status!=="STOP"||report.applicationLlmCalls!==claims.length||report.providerHttpRequests!==claims.length||JSON.stringify(report.responses)!==JSON.stringify(responses))throw Error("DEBUG_THROTTLE_SETTLEMENT_BINDING");
 const final=responses.at(-1),targets=deriveBoundedPilotManifest(g.root).targets;
 for(const [i,response] of responses.entries())if(response.call!==i+1||response.runId!==begin.runId||response.fixtureId!==targets[i]?.fixtureId||response.turnIndex!==targets[i]?.turnIndex||(i<responses.length-1?(response.canonicalValidationDiagnostics||response.status!=="SUCCESS"):!providerErrorDiagnosticSchema.safeParse(response.canonicalValidationDiagnostics).success))throw Error("DEBUG_THROTTLE_SEMANTIC_FAILURE");
 if(final.status!=="FAILURE"||final.httpStatus!==200||final.provider?.generationId!==evidence.generationId||final.provider?.model!==evidence.model||final.provider?.provider!==evidence.provider||final.usage?.reportedCostUsd!==evidence.reportedCostUsd||final.category!=="PROVIDER_FAILURE")throw Error("DEBUG_THROTTLE_RESPONSE_BINDING");
 if(evidence.kind==="REVIEWED_APPLICATION_ENVELOPE"){
  const choice=final.canonicalValidationDiagnostics?.providerEnvelope?.firstChoice;
  if(choice?.choiceErrorPresent!==true||choice.choiceErrorType!=="object"||choice.choiceErrorCode!==429)throw Error("DEBUG_THROTTLE_APPLICATION_ENVELOPE_BINDING");
 }
 if(!Array.isArray(report.applicationEvidence)||!report.applicationEvidence.length||report.applicationEvidence.some((turn:{fixtureId:string;turnIndex:number;oracle:string})=>turn.oracle!=="PASS"&&(turn.fixtureId!==final.fixtureId||turn.turnIndex!==final.turnIndex))||!Array.isArray(report.actionEvidence)||report.actionEvidence.some((action:{oracle:string;unsafe:boolean})=>action.oracle!=="PASS"||action.unsafe))throw Error("DEBUG_THROTTLE_SEMANTIC_FAILURE");
 // Walk only the fixed original run and its durable single-successor links.
 // A fabricated/unrelated terminal directory cannot become a fresh root.
 let current=r.parentDirectory;const seen=new Set<string>();
 const original=join(r.campaignRoot,"debug-loop-executions",baseExecutionId(budget.ownerMessageSha256,candidate,r.mode),"PILOT");
 while(current!==original){if(seen.has(current)||seen.size>=1000)throw Error("DEBUG_FRESH_LINEAGE_BINDING");seen.add(current);const execution=JSON.parse(read(r.accountRoot,join(current,"execution.json"))),link=execution.freshRun;if(!link||typeof link.parentDirectory!=="string")throw Error("DEBUG_FRESH_LINEAGE_BINDING");const consumed=JSON.parse(read(r.accountRoot,successorMarker(r.accountRoot,link.parentDirectory)));if(consumed.childDirectory!==current||consumed.recordSha256!==link.recordSha256||consumed.evidenceSha256!==link.evidenceSha256)throw Error("DEBUG_FRESH_LINEAGE_BINDING");current=link.parentDirectory;}
 // Account-wide unresolved claims cannot be bypassed by choosing another run.
 if(checkSettlements)for(const binding of auditCampaignAccountRoot(r.accountRoot).bindings){const ledger=readCampaignLedger(binding.directory);if(ledger.some(row=>row.event==="RESERVE"&&!ledger.some(finish=>finish.event==="FINISH"&&finish.reservationId===row.reservationId)))throw Error("DEBUG_FRESH_UNSETTLED_ACCOUNT");}
 const cooldownUntil=Math.max(last.at,evidence.verifiedAt)+r.cooldownMs;if(!Number.isSafeInteger(cooldownUntil))throw Error("DEBUG_FRESH_COOLDOWN_INVALID");
 const id=`debug-${hash(r.ownerMessageSha256+candidate+r.mode+r.parentDirectory).slice(0,40)}`,directory=join(r.campaignRoot,"debug-loop-executions",id,"PILOT"),marker=successorMarker(r.accountRoot,r.parentDirectory);
 return {record:r,evidence,id,directory,marker,cooldownUntil};
}
/** Read-only preflight; credential loading belongs after this succeeds. */
export function inspectDebugLoopFreshRun(a:DebugLoopAuthority|undefined,candidate:string,options:{now?:()=>number}={}){
 const fresh=verifyFreshRun(grant(a),candidate);if(existsSync(fresh.marker)||existsSync(fresh.directory))throw Error("DEBUG_SUCCESSOR_CONSUMED");
 const now=(options.now??Date.now)();if(!Number.isSafeInteger(now)||now<fresh.cooldownUntil)throw Error("DEBUG_FRESH_COOLDOWN");
 const accounting=inspectDebugLoop(a);return {parentDirectory:fresh.record.parentDirectory,directory:fresh.directory,mode:fresh.record.mode,cooldownUntil:fresh.cooldownUntil,accounting};
}
export const DEBUG_PROBE_MODES=["OPERATION_STRING","R02_TURN0","CANONICAL_WIRE","V14","QUERY_ONLY","NO_REQUEST_TARGET","NO_CHANGE_EVIDENCE","CHANGE_TEXT_ONLY","CHANGE_DATE_ONLY","CHANGE_TIME_ONLY","CHANGE_SCALAR_ONLY","CHANGE_CLEAR_ONLY"] as const;
export type DebugProbeMode=typeof DEBUG_PROBE_MODES[number];
type Node={type?:string;properties?:Record<string,Node>;$defs?:Record<string,Node>;anyOf?:Node[];items?:Node;$ref?:string;[key:string]:unknown};
/** Diagnostic ablation ONLY. Never used as runtime output repair. Probe
 * responses cannot earn Pilot credit; the candidate decoder stays unchanged. */
export function debugProbeSchema<T>(input:T,mode:DebugProbeMode):T{
 if(!DEBUG_PROBE_MODES.includes(mode))throw Error("DEBUG_PROBE_SCOPE");
 const s=structuredClone(input) as Node;
 if(mode==="OPERATION_STRING"){
  const selector=s.properties?.operationCode;
  if(selector?.type!=="integer"||!Array.isArray(selector.enum)||selector.enum.length!==12||selector.enum.some((value,index)=>value!==index))throw Error("DEBUG_PROBE_SHAPE");
  s.properties!.operationCode={type:"string",enum:selector.enum.map(String)};
  return s as T;
 }
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
 if(initial.trust.freshRun){if(mode!=="FORMAL_PILOT")throw Error("DEBUG_FRESH_MODE_BINDING");inspectDebugLoopFreshRun(a,candidate,options);}
 return withAccountRootLock(initial.record.accountRoot,async()=>{
 const g=grant(a),r=g.record,proof=candidateValidationProof(g.root,candidate),manifest=deriveBoundedPilotManifest(g.root);
 loadedChecks.get(a!)?.(candidate,proof.harnessRevisionSha);
 const fresh=g.trust.freshRun?verifyFreshRun(g,candidate):undefined;
 if(fresh)inspectDebugLoopFreshRun(a,candidate,options);
 const id=fresh?.id??baseExecutionId(r.ownerMessageSha256,candidate,mode),leaf=fresh?.directory??join(r.campaignRoot,"debug-loop-executions",id,"PILOT");
 if(existsSync(leaf))throw Error("DEBUG_EXECUTION_CONSUMED");
 const before=inspectDebugLoop(a);
 if(fresh)appendCandidateValidationRecord(r.accountRoot,fresh.marker,{parentDirectory:fresh.record.parentDirectory,childDirectory:leaf,recordSha256:g.trust.freshRun!.reviewedRecordSha256,evidenceSha256:fresh.record.evidenceSha256});
 mkdirSync(leaf,{recursive:true,mode:0o700});
 appendCandidateValidationRecord(r.accountRoot,join(leaf,"execution.json"),{authoritySha256:g.trust.reviewedRecordSha256,...proof,mode,manifestSha256:r.manifestSha256,accounting:before,...(fresh?{freshRun:{parentDirectory:fresh.record.parentDirectory,recordSha256:g.trust.freshRun!.reviewedRecordSha256,evidenceSha256:fresh.record.evidenceSha256}}:{})});
 let attempts=0,next=0;const targets=mode==="FORMAL_PILOT"?manifest.targets:[{fixtureId:mode==="R02_TURN0"?"R02":"R01",turnIndex:0}];
 const singleTarget=mode==="R02_TURN0"?resolveSingleValidationTarget(g.root,{fixture:"R02",turn:0}):undefined;
 const check=()=>{const checked=grant(a);if(fresh)verifyFreshRun(checked,candidate,false);const p=candidateValidationProof(g.root,candidate);if(JSON.stringify(p)!==JSON.stringify(proof))throw Error("DEBUG_SOURCE_BINDING");loadedChecks.get(a!)?.(candidate,proof.harnessRevisionSha)};
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
 const g=grant(a),{root}=g,proof=candidateValidationProof(root,candidate);check(candidate,proof.harnessRevisionSha);inspectDebugLoop(a);if(g.trust.freshRun){if(mode!=="FORMAL_PILOT")throw Error("DEBUG_FRESH_MODE_BINDING");inspectDebugLoopFreshRun(a,candidate);}
 if(!key||/[\r\n]/u.test(key))throw Error("CREDENTIAL_INVALID");let physicalAttempts=0;
 const result=await runDebugLoopExecution(a,candidate,mode,async(request,options)=>{let fetched=false;return createContextHttpTransport(key,async(url,init)=>{if(fetched)throw Error("DEBUG_PHYSICAL_HTTP_FENCE");fetched=true;physicalAttempts++;return fetch(url,{...init,redirect:"error"})})(request,options)});
 return {...result,physicalProviderHttpAttempts:physicalAttempts};
}

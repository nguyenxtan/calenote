import {createHash} from "node:crypto";
import {readFileSync,lstatSync,realpathSync,existsSync,mkdirSync} from "node:fs";
import {join,relative,isAbsolute} from "node:path";
import {isDeepStrictEqual} from "node:util";
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
export const DEBUG_PROBE_MODES=["R02_TURN1_GENERAL_SOURCE_COMPACT_BASELINE","R02_TURN1_GENERAL_SOURCE_STRING_BASELINE","R02_TURN1_REPLACE_COALESCED_BASELINE","R02_TURN1_CURRENT_KEY_BASELINE","R02_TURN1_SCHEMA_CONTROL","R02_TURN1_UNCERTAINTY_UNBOUNDED_BASELINE","DATE_CURRENT_NO_SCALAR_BOUNDS","DATE_CURRENT_STRING_BASELINE","SOURCE_CURRENT_KEY_BASELINE","SOURCE_INTEGER_BASELINE","SOURCE_CURRENT_INLINE_BASELINE","SOURCE_COMPACT_BASELINE","SOURCE_SINGLETON_BASELINE","SOURCE_T0_SCHEMA_BASELINE","SOURCE_STRING_BASELINE","OPERATION_STRING","R02_TURN0","CANONICAL_WIRE","V14","QUERY_ONLY","NO_REQUEST_TARGET","NO_CHANGE_EVIDENCE","CHANGE_TEXT_ONLY","CHANGE_DATE_ONLY","CHANGE_TIME_ONLY","CHANGE_SCALAR_ONLY","CHANGE_CLEAR_ONLY","DATE_STRING_BASELINE","DATE_NO_NULL_UNIONS","DATE_NO_SCALAR_BOUNDS"] as const;
export type DebugProbeMode=typeof DEBUG_PROBE_MODES[number];
const isR02Turn1ProbeMode=(mode:string)=>mode==="R02_TURN1_SCHEMA_CONTROL"||mode==="R02_TURN1_UNCERTAINTY_UNBOUNDED_BASELINE"||mode==="R02_TURN1_CURRENT_KEY_BASELINE"||mode==="R02_TURN1_REPLACE_COALESCED_BASELINE"||mode==="R02_TURN1_GENERAL_SOURCE_STRING_BASELINE"||mode==="R02_TURN1_GENERAL_SOURCE_COMPACT_BASELINE";
const isSourceProbeMode=(mode:string)=>mode==="DATE_CURRENT_NO_SCALAR_BOUNDS"||mode==="DATE_CURRENT_STRING_BASELINE"||mode==="SOURCE_CURRENT_KEY_BASELINE"||mode==="SOURCE_INTEGER_BASELINE"||mode==="SOURCE_CURRENT_INLINE_BASELINE"||mode==="SOURCE_COMPACT_BASELINE"||mode==="SOURCE_STRING_BASELINE"||mode==="SOURCE_SINGLETON_BASELINE"||mode==="SOURCE_T0_SCHEMA_BASELINE";
type Node={type?:string;properties?:Record<string,Node>;$defs?:Record<string,Node>;anyOf?:Node[];items?:Node;$ref?:string;[key:string]:unknown};
/** Diagnostic ablation ONLY. Never used as runtime output repair. Probe
 * responses cannot earn Pilot credit; the candidate decoder stays unchanged. */
export function debugProbeSchema<T>(input:T,mode:DebugProbeMode):T{
 if(!DEBUG_PROBE_MODES.includes(mode))throw Error("DEBUG_PROBE_SCOPE");
 const s=structuredClone(input) as Node;
 if(isR02Turn1ProbeMode(mode)){
  if(hash(JSON.stringify(s))!=="635f4734b667e0827e1975135b1eaae4bfaf43ac4e5b729b6612dba8113b3e48"||s.properties?.uncertainties.maxItems!==4||!Array.isArray(s.$defs?.__sources.enum)||s.$defs!.__sources.enum.length!==7||!Array.isArray(s.$defs?.__current.enum)||s.$defs!.__current.enum.length!==1)throw Error("DEBUG_PROBE_SHAPE");
  const checkRefs=(n:unknown)=>{if(!n||typeof n!=="object")return;const node=n as Node;if(node.$ref!==undefined&&(typeof node.$ref!=="string"||!/^#\/\$defs\/[A-Za-z0-9_]+$/u.test(node.$ref)||Object.keys(node).length!==1||!s.$defs?.[node.$ref.slice(8)]))throw Error("DEBUG_PROBE_SHAPE");Object.values(n).forEach(checkRefs)};
  checkRefs(s);
  if(mode==="R02_TURN1_GENERAL_SOURCE_STRING_BASELINE")s.$defs!.__sources={type:"string"};
  if(mode==="R02_TURN1_GENERAL_SOURCE_COMPACT_BASELINE"){
   const codes=(s.$defs!.__sources.enum as unknown[]).map(text=>{
    if(typeof text!=="string")throw Error("DEBUG_PROBE_SHAPE");
    let pointer:unknown;try{pointer=JSON.parse(text)}catch{throw Error("DEBUG_PROBE_SHAPE")}
    if(!pointer||typeof pointer!=="object"||Array.isArray(pointer))throw Error("DEBUG_PROBE_SHAPE");
    const p=pointer as Record<string,unknown>,keys=Object.keys(p).sort().join(","),turn=typeof p.turn==="number"&&Number.isSafeInteger(p.turn)&&p.turn>=0&&p.turn<=11;
    if(p.kind==="USER_TURN"&&keys==="kind,turn"&&turn)return `U${p.turn}`;
    if(p.kind==="USER_SEGMENT"&&keys==="kind,segment,turn"&&turn&&typeof p.segment==="number"&&Number.isSafeInteger(p.segment)&&p.segment>=0)return `S${p.turn}.${p.segment}`;
    if(p.kind==="CONTEXT_FACT"&&keys==="kind,ref"&&typeof p.ref==="string"&&p.ref.length<=16&&/^f[1-9][0-9]*$/u.test(p.ref))return `F${p.ref}`;
    throw Error("DEBUG_PROBE_SHAPE");
   });
   if(new Set(codes).size!==codes.length)throw Error("DEBUG_PROBE_SHAPE");
   s.$defs!.__sources={type:"string",enum:codes};
  }
  if(mode==="R02_TURN1_UNCERTAINTY_UNBOUNDED_BASELINE")delete s.properties!.uncertainties.maxItems;
  if(mode==="R02_TURN1_CURRENT_KEY_BASELINE"){
   const ec=s.$defs!.__ec;
   ec.properties=Object.fromEntries(Object.entries(ec.properties!).map(([key,value])=>[key==="primaryEvidence"?"currentPrimaryEvidence":key,value]));
   ec.required=(ec.required as string[]).map(key=>key==="primaryEvidence"?"currentPrimaryEvidence":key);
  }
  if(mode==="R02_TURN1_REPLACE_COALESCED_BASELINE"){
   const branches=s.$defs!.__schema5.anyOf;
   if(!branches||branches.length!==4)throw Error("DEBUG_PROBE_SHAPE");
   const left=branches[1],right=branches[2];
   if(left.type!=="object"||right.type!=="object"||!left.properties||!right.properties||!isDeepStrictEqual(left.properties.field,{type:"string",enum:["notes"]})||!isDeepStrictEqual(right.properties.field,{type:"string",enum:["title"]})||!isDeepStrictEqual(left.properties.operation,{type:"string",enum:["REPLACE"]})||!isDeepStrictEqual(left.properties.evidence,{$ref:"#/$defs/__ec"})||!isDeepStrictEqual(left.properties.value,{$ref:"#/$defs/__schema3"})||!isDeepStrictEqual({...left,properties:{...left.properties,field:undefined}},{...right,properties:{...right.properties,field:undefined}}))throw Error("DEBUG_PROBE_SHAPE");
   left.properties.field={type:"string",enum:["notes","title"]};branches.splice(2,1);
  }
  const expected=mode==="R02_TURN1_GENERAL_SOURCE_COMPACT_BASELINE"?"2d1b14bd9c08fa5ad646270f216816b2f538f8a25ec9a663cf30d09ad8ea7cd1":mode==="R02_TURN1_GENERAL_SOURCE_STRING_BASELINE"?"8e1d159043ecdb9a73d3d28a9e4d22c06d773923f95f591dcc66cda6dcd30a9e":mode==="R02_TURN1_REPLACE_COALESCED_BASELINE"?"2740170b5dd2d4fe9868016766e37ea9b233254be73f7156f72dcd906cfaaafe":mode==="R02_TURN1_CURRENT_KEY_BASELINE"?"6a9790bcaa4f2ef63f458fb87b8ac353c8541ca893f4c925525a192d5882a117":mode==="R02_TURN1_SCHEMA_CONTROL"?"635f4734b667e0827e1975135b1eaae4bfaf43ac4e5b729b6612dba8113b3e48":"ecfc0b1b680d667f5bfa3e4fa7f841dfd6bbd157f67ab5b2e4e3d7575b53f53d";
  if(hash(JSON.stringify(s))!==expected)throw Error("DEBUG_PROBE_SHAPE");
  return s as T;
 }
 if(isSourceProbeMode(mode)){
  if(hash(JSON.stringify(s))!=="d30093b5ce25aed6f05ba17a4ae8018c196adc29acc0412328f217f917451a24"||!isDeepStrictEqual(s.$defs?.__sources,{type:"string",enum:['{"kind":"USER_TURN","turn":0}','{"kind":"USER_TURN","turn":2}','{"kind":"CONTEXT_FACT","ref":"f1"}']}))throw Error("DEBUG_PROBE_SHAPE");
  const checkRefs=(n:unknown)=>{if(!n||typeof n!=="object")return;const node=n as Node;if(node.$ref!==undefined&&(typeof node.$ref!=="string"||!/^#\/\$defs\/[A-Za-z0-9_]+$/u.test(node.$ref)||Object.keys(node).length!==1||!s.$defs?.[node.$ref.slice(8)]))throw Error("DEBUG_PROBE_SHAPE");Object.values(n).forEach(checkRefs)};
  checkRefs(s);s.$defs!.__sources=mode==="SOURCE_STRING_BASELINE"?{type:"string"}:{type:"string",enum:['{"kind":"USER_TURN","turn":0}']};
  if(mode==="SOURCE_T0_SCHEMA_BASELINE")s.$defs!.__current={type:"string",enum:['{"kind":"USER_TURN","turn":0}']};
  if(mode==="SOURCE_COMPACT_BASELINE"){s.$defs!.__sources={type:"string",enum:["p0","p1","p2"]};s.$defs!.__current={type:"string",enum:["p1"]};}
  if(mode==="SOURCE_CURRENT_INLINE_BASELINE"){
   s.$defs!.__sources=structuredClone((input as Node).$defs!.__sources);
   if(!isDeepStrictEqual(s.$defs!.__ec.properties?.primaryEvidence,{$ref:"#/$defs/__current"}))throw Error("DEBUG_PROBE_SHAPE");
   s.$defs!.__ec.properties!.primaryEvidence=structuredClone(s.$defs!.__current);delete s.$defs!.__current;checkRefs(s);
  }
  if(mode==="SOURCE_INTEGER_BASELINE"){s.$defs!.__sources={type:"integer",minimum:0,maximum:2};s.$defs!.__current={type:"integer",minimum:1,maximum:1};}
  if(mode==="SOURCE_CURRENT_KEY_BASELINE"){
   s.$defs!.__sources=structuredClone((input as Node).$defs!.__sources);
   const e=s.$defs!.__ec;e.properties=Object.fromEntries(Object.entries(e.properties!).map(([key,value])=>[key==="primaryEvidence"?"currentPrimaryEvidence":key,value]));
   e.required=(e.required as string[]).map(key=>key==="primaryEvidence"?"currentPrimaryEvidence":key);
  }
  if(mode==="DATE_CURRENT_STRING_BASELINE"){
   s.$defs!.__sources=structuredClone((input as Node).$defs!.__sources);
   s.$defs!.__d={type:"string"};
  }
  if(mode==="DATE_CURRENT_NO_SCALAR_BOUNDS"){
   s.$defs!.__sources=structuredClone((input as Node).$defs!.__sources);
   for(const slot of Object.values(s.$defs!.__d.properties!))if(slot.type==="integer"){delete slot.minimum;delete slot.maximum;}
  }
  const expected=mode==="DATE_CURRENT_NO_SCALAR_BOUNDS"?"2391f41bbdfd87bf57d8e742a559464ace84850b3cfae5cfda2854e7673ec679":mode==="DATE_CURRENT_STRING_BASELINE"?"1781ee604f3b9014059c649cede4d7429c8cba729342c22f4875ddc68b3f7c52":mode==="SOURCE_CURRENT_KEY_BASELINE"?"f5f44a4a12451fd3e13355e7aa3f03dac31d84b949878bbcedb3a02837965779":mode==="SOURCE_INTEGER_BASELINE"?"637e8368ebdc70b5672eb06ba939058b563049815092d1eafa03a3faeb4e8611":mode==="SOURCE_CURRENT_INLINE_BASELINE"?"30634b9033dc0ca036320c41062e1707bda62f8e8a438db5304b033d6b87528f":mode==="SOURCE_COMPACT_BASELINE"?"3ae3b2fe8ed22d1283e44996c0f56acdb3486789e5cff36bf3a9d2a366324579":mode==="SOURCE_STRING_BASELINE"?"2856d278ef3bf80bc16800e980200425da346295fab155da2ec2363e9d76c145":mode==="SOURCE_SINGLETON_BASELINE"?"af84ca46d1cecf819e041c8fd77051f48b229db7502cb62ba385288c56155a8a":"dc1bf84c3102747748df9951acd99219e85ef31127a1d344c136261b3932b05e";
  if(hash(JSON.stringify(s))!==expected)throw Error("DEBUG_PROBE_SHAPE");return s as T;
 }
 if(mode==="DATE_STRING_BASELINE"||mode==="DATE_NO_NULL_UNIONS"||mode==="DATE_NO_SCALAR_BOUNDS"){
  const nullable=(value:Node):Node=>({anyOf:[value,{type:"null"}]}),integer=(minimum:number,maximum:number)=>nullable({type:"integer",minimum,maximum});
  const expected:Node={type:"object",properties:{kind:{type:"string",enum:["C","R","W"]},calendar:nullable({type:"string",enum:["GREGORIAN","LUNAR_VN"]}),day:integer(1,31),month:integer(1,12),year:integer(1,9999),leapMonth:nullable({type:"boolean"}),offsetDays:integer(-366,366),weekday:integer(1,7),qualifier:nullable({type:"string",enum:["THIS_WEEK","NEXT_WEEK","UNRESOLVED"]})},required:["kind","calendar","day","month","year","leapMonth","offsetDays","weekday","qualifier"],additionalProperties:false};
  const date=s.$defs?.__d;
  if(!isDeepStrictEqual(date,expected))throw Error("DEBUG_PROBE_SHAPE");
  const dateReferences:string[]=[];
  const checkRefs=(value:unknown,path:string[]=[])=>{
   if(!value||typeof value!=="object")return;
   if(Array.isArray(value)){value.forEach((child,index)=>checkRefs(child,[...path,String(index)]));return;}
   const n=value as Node;
   if(n.$ref!==undefined){
    if(typeof n.$ref!=="string"||!/^#\/\$defs\/[A-Za-z0-9_]+$/u.test(n.$ref)||Object.keys(n).length!==1||!s.$defs?.[n.$ref.slice(8)])throw Error("DEBUG_PROBE_SHAPE");
    if(n.$ref==="#/$defs/__d")dateReferences.push(path.join("."));
   }
   Object.entries(n).forEach(([key,child])=>checkRefs(child,[...path,key]));
  };
  checkRefs(s);
  const expectedReferences=["properties.query.anyOf.0.properties.date.anyOf.1",... ["reminderDateChange","eventDateChange"].flatMap(field=>[0,1].map(index=>`properties.${field}.anyOf.0.properties.change.anyOf.${index}.properties.value`)),... [2,3].map(index=>`$defs.__schema5.anyOf.${index}.properties.value`),"$defs.__schema21.anyOf.0.properties.date.anyOf.0","$defs.__schema21.anyOf.3.properties.from.anyOf.0","$defs.__schema21.anyOf.3.properties.through.anyOf.0"];
  if(!isDeepStrictEqual(dateReferences.sort(),expectedReferences.sort()))throw Error("DEBUG_PROBE_SHAPE");
  if(mode==="DATE_STRING_BASELINE")s.$defs!.__d={type:"string"};
  else for(const slot of Object.values(date!.properties!)){
   if(!slot.anyOf)continue;
   if(mode==="DATE_NO_NULL_UNIONS")slot.anyOf=slot.anyOf.filter(branch=>branch.type!=="null");
   else for(const branch of slot.anyOf){delete branch.minimum;delete branch.maximum;}
  }
  return s as T;
 }
 if(mode==="OPERATION_STRING"){
  const selector=s.properties?.operationCode;
  if(selector?.type!=="integer"||!Array.isArray(selector.enum)||selector.enum.length!==12||selector.enum.some((value,index)=>value!==index))throw Error("DEBUG_PROBE_SHAPE");
  s.properties!.operationCode={type:"string",enum:selector.enum.map(String)};
  return s as T;
 }
 if(mode==="R02_TURN0"||mode==="CANONICAL_WIRE"||mode==="V14")return s as T;
 const change=s.properties?.changes?.items,definition=change?.$ref?s.$defs?.[change.$ref.split("/").at(-1)!]:undefined;
 const groups:Record<string,string[]>={CHANGE_TEXT_ONLY:["title","location","notes"],CHANGE_DATE_ONLY:["eventDate","reminderDate","endDate"],CHANGE_TIME_ONLY:["eventTime","reminderTime"],CHANGE_SCALAR_ONLY:["calendar","frequency","occurrenceCount","leadOffsetDays","eventRelation"]};
 const unslot=(n:Node)=>{
  let e=n.properties?.evidence;
  if(e?.$ref){
   const name=e.$ref==="#/$defs/__e"?"__e":e.$ref==="#/$defs/__ec"?"__ec":null;
   if(!name||Object.keys(e).length!==1)throw Error("DEBUG_PROBE_SHAPE");
   const sourceName=name==="__e"?"__sources":"__current";e=s.$defs?.[name];
   const primary=e?.properties?.primaryEvidence,extra=e?.properties?.additionalEvidenceJson,sources=s.$defs?.[sourceName];
   if(e?.type!=="object"||Object.keys(e).length!==4||e.additionalProperties!==false||!Array.isArray(e.required)||e.required.length!==2||!e.required.includes("primaryEvidence")||!e.required.includes("additionalEvidenceJson")||Object.keys(e.properties??{}).length!==2||extra?.type!=="string"||Object.keys(extra).length!==1||primary?.$ref!==`#/$defs/${sourceName}`||Object.keys(primary).length!==1||sources?.type!=="string"||!Array.isArray(sources.enum)||sources.enum.length===0||sources.enum.some(value=>typeof value!=="string"))throw Error("DEBUG_PROBE_SHAPE");
  }
  if(!e?.properties?.primaryEvidence)throw Error("DEBUG_PROBE_SHAPE");
  n.properties!.evidence={type:"array",items:e.properties.primaryEvidence};
 };
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
 let attempts=0,next=0;const targets=mode==="FORMAL_PILOT"?manifest.targets:[{fixtureId:mode==="R02_TURN0"||isR02Turn1ProbeMode(mode)?"R02":"R01",turnIndex:isSourceProbeMode(mode)||isR02Turn1ProbeMode(mode)?1:0}];
 const singleTarget=mode==="R02_TURN0"?resolveSingleValidationTarget(g.root,{fixture:"R02",turn:0}):isR02Turn1ProbeMode(mode)?resolveSingleValidationTarget(g.root,{fixture:"R02",turn:1}):isSourceProbeMode(mode)?resolveSingleValidationTarget(g.root,{fixture:"R01",turn:1}):undefined;
 if(isR02Turn1ProbeMode(mode)&&(singleTarget?.contextSeedDigest!=="5b19cc0eb33a1563ba429087550c72446eaf3545f256fa9d1d408e089b2dcdde"||singleTarget.manifestSha256!=="7d9a0e1ea2a8d48c559989770905e21256b81ba81a0d0706b48c0148eaa2ba59"))throw Error("DEBUG_R02_SEED_BINDING");
 if(isSourceProbeMode(mode)&&(singleTarget?.contextSeedDigest!=="9db3317cac2e32828ffa743a21ab344cf3e3d761d7c72465a792d174e484302b"||singleTarget.manifestSha256!=="7d9a0e1ea2a8d48c559989770905e21256b81ba81a0d0706b48c0148eaa2ba59"))throw Error("DEBUG_SOURCE_SEED_BINDING");
 const check=()=>{const checked=grant(a);if(fresh)verifyFreshRun(checked,candidate,false);const p=candidateValidationProof(g.root,candidate);if(JSON.stringify(p)!==JSON.stringify(proof))throw Error("DEBUG_SOURCE_BINDING");loadedChecks.get(a!)?.(candidate,proof.harnessRevisionSha)};
 const hooks={manifestSha256:r.manifestSha256,maxRequests:targets.length,beforeDispatch(t:{fixtureId:string;turnIndex:number},reservationId:string){check();if(JSON.stringify(t)!==JSON.stringify(targets[next])||attempts!==next)throw Error("DEBUG_TARGET_FENCE");inspectDebugLoop(a);appendCandidateValidationRecord(r.accountRoot,join(leaf,`target-${next}.claim.json`),{target:t,reservationId});next++},settled(){},outcome(){}};
 const input={root:g.root,directory:leaf,profile:"PILOT" as const,sourceSha:candidate,provenanceDigest:proof.candidateProofSha256,runId:id,accountingPolicy:"CONFIRMED_COST_V1" as const,debugBudgetAuthoritySha256:g.trust.reviewedRecordSha256,cumulativeAuthorizedMicrounits:r.hardCapMicrounits,cumulativeRetainedMicrounits:before.confirmedMicrounits,now:options.now,
 transport:async(request:Parameters<SemanticTransport>[0],requestOptions:Parameters<SemanticTransport>[1])=>{
 check();if(attempts>=targets.length||request.model!==r.model||request.provider.only.join("|")!==r.provider||request.stream!==false||request.provider.allow_fallbacks!==false||request.provider.require_parameters!==true||request.provider.zdr!==true||request.provider.data_collection!=="deny"||request.max_tokens!==1536||request.response_format.json_schema.strict!==true)throw Error("DEBUG_HTTP_ROUTE_FENCE");
 // For probes the runner has already durably marked DISPATCH. It contains
 // exactly one selected frozen turn; check budget without counting its pending
 // claim twice (the before-execution inspection reserved full headroom).
 if(isSourceProbeMode(mode)){const context=JSON.parse(request.messages[1].content);delete context.evidenceSources;delete context.numericOwnership;delete context.fieldCapability;if(hash(JSON.stringify(context))!=="fc84b34e2d9c9490b37ffbf0e3f2674fd7c357a84bc0b997311e06a39d775142")throw Error("DEBUG_SOURCE_CONTEXT_BINDING");}
 if(isR02Turn1ProbeMode(mode)){const context=JSON.parse(request.messages[1].content);delete context.evidenceSources;delete context.numericOwnership;delete context.fieldCapability;if(hash(JSON.stringify(context))!=="560569f4bc260b7921602f5e5a892b87f5a384e856ea2b845e5b473df3af2c08"||hash(JSON.stringify(request))!=="e48c60f318f0f3c920692b25b921d8e961d02de076cf5877ea5305e0f4555c8c")throw Error("DEBUG_R02_CONTEXT_BINDING");}
 const outbound=mode==="FORMAL_PILOT"?request:{...request,response_format:{...request.response_format,json_schema:{...request.response_format.json_schema,schema:debugProbeSchema(request.response_format.json_schema.schema,mode)}}};
 appendCandidateValidationRecord(r.accountRoot,join(leaf,`http-${attempts}.json`),{requestSha256:hash(JSON.stringify(outbound)),schemaSha256:hash(JSON.stringify(outbound.response_format.json_schema.schema)),mode});attempts++;return transport(outbound,requestOptions);
 }};
 try{const result=mode==="FORMAL_PILOT"?await executeObservableCampaign({...input,boundedPilot:hooks}):singleTarget?await executeObservableSingleTargetValidation({...input,singleTarget:{fixture:singleTarget.fixture,turn:singleTarget.turn,manifestSha256:singleTarget.manifestSha256,...(singleTarget.turn>0?{contextSeedDigest:singleTarget.contextSeedDigest}:{})}}):await executeObservableR01Turn0Replay(input);
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

/** Trusted one-use diagnostic boundary. Import/load/inspect are read-only.
 * No proposal or policy approval is an execution grant. No ambient credential. */
import {createHash} from 'node:crypto';
import {readFileSync,lstatSync,realpathSync,existsSync,readdirSync,mkdirSync} from 'node:fs';
import {join,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {z} from 'zod';
import {candidateValidationProof,appendCandidateValidationRecord} from './context-contract-candidate-validation';
import {auditCampaignAccountRoot,withAccountRootLock,readCampaignLedger} from './context-contract-live';
import {inspectConservativeDebugCost} from './context-confirmed-cost';
import {deriveBoundedPilotManifest} from './context-bounded-pilot';
import {runTypedCompilerDiagnosticExecution,isTypedCompilerBridgeKey,verifyContextRequestSchema,type ObservableExecution} from './context-contract-runner';
import {createContextHttpTransport} from '../../src/modules/intelligence/infrastructure/openrouter/semantic-gateway';
const hash=(v:string)=>createHash('sha256').update(v).digest('hex'),digest=z.string().regex(/^[a-f0-9]{64}$/u),sha=z.string().regex(/^[a-f0-9]{40}$/u),natural=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const schema=z.strictObject({version:z.literal('typed-compiler-launch-authority-1'),paid:z.literal('AUTHORIZED_ONE_COMPILER_DIAGNOSTIC'),operation:z.literal('TYPED105_COMPILER_R01_TURN0'),wireProtocol:z.literal('TYPED_105'),accountRoot:z.string(),campaignRoot:z.string(),evaluationCandidateSha:sha,harnessRevisionSha:sha,candidateProofSha256:digest,harnessProofSha256:digest,manifestSha256:digest,inventoryDigest:digest,lifecycleSha256:digest,expectedUnknown:natural,expectedRetainedMicrounits:natural,expectedRemainingMicrounits:natural,payloadPath:z.string(),payloadSha256:digest,schemaSha256:digest,ownerMessagePath:z.string(),ownerMessageSha256:digest,proposalPath:z.string(),proposalSha256:digest,notBefore:natural,expiresAt:natural,hardCapMicrounits:z.literal(10000000),maximumRequestExposureMicrounits:z.literal(105472),accountingPolicy:z.literal('CONSERVATIVE_DEBUG_V1'),fixture:z.literal('R01'),turn:z.literal(0),maxProviderHttpRequests:z.literal(1),model:z.literal('google/gemini-2.5-flash-lite'),provider:z.literal('google-vertex/eu'),retry:z.literal(0),fallback:z.literal('none'),stream:z.literal(false)});
type LaunchRecord=z.infer<typeof schema>;
const pinKeys=['accountRoot','campaignRoot','evaluationCandidateSha','harnessRevisionSha','candidateProofSha256','harnessProofSha256','manifestSha256','inventoryDigest','lifecycleSha256','expectedUnknown','expectedRetainedMicrounits','expectedRemainingMicrounits','payloadSha256','schemaSha256'] as const;
export type TypedCompilerTrust=Pick<LaunchRecord,typeof pinKeys[number]>&{reviewedRecordSha256:string;reviewedOwnerMessageSha256:string;reviewedProposalSha256:string};
const brand:unique symbol=Symbol('TypedCompilerLaunch');
export interface TypedCompilerLaunch{readonly [brand]:true}
type Grant={root:string;path:string;trust:Readonly<TypedCompilerTrust>};
const grants=new WeakMap<object,Grant>(),active=new WeakMap<object,ObservableExecution>();
function contained(root:string,path:string){const rel=relative(root,path);if(!isAbsolute(path)||!rel||rel.startsWith('..')||isAbsolute(rel)||realpathSync(path)!==path||lstatSync(path).isSymbolicLink())throw Error('COMPILER_PATH_BINDING');}
function read(root:string,path:string,max=16384){contained(root,path);const stat=lstatSync(path);if(!stat.isFile()||stat.size>max)throw Error('COMPILER_FILE_BINDING');return readFileSync(path,'utf8');}
function paths(r:LaunchRecord){const runId=`compiler-${hash(r.ownerMessageSha256).slice(0,40)}`;return {runId,executionDirectory:join(r.campaignRoot,'compiler-diagnostics',runId,'PILOT'),ownerMarker:join(r.accountRoot,`.typed-compiler-owner-${r.ownerMessageSha256}.consumed.json`),proposalMarker:join(r.accountRoot,`.typed-compiler-proposal-${r.proposalSha256}.consumed.json`)};}
function markerValue(r:LaunchRecord,g:Grant){return {ownerMessageSha256:r.ownerMessageSha256,proposalSha256:r.proposalSha256,recordSha256:g.trust.reviewedRecordSha256};}
function verify(g:Grant,owned=false,lockedUnused=false){
 const {root,trust:t}=g;
 if(realpathSync(root)!==root||realpathSync(process.cwd())!==root||fileURLToPath(new URL('../../',import.meta.url)).replace(/\/$/u,'')!==root)throw Error('COMPILER_EXECUTING_ROOT');
 if(!isAbsolute(t.accountRoot)||realpathSync(t.accountRoot)!==t.accountRoot)throw Error('COMPILER_ACCOUNT_BINDING');
 const text=read(t.accountRoot,g.path);if(hash(text)!==t.reviewedRecordSha256)throw Error('COMPILER_RECORD_BINDING');
 const r=schema.parse(JSON.parse(text)),p=paths(r);
 for(const key of pinKeys)if(r[key]!==t[key])throw Error('COMPILER_TRUST_BINDING');
 contained(r.accountRoot,r.campaignRoot);
 if(r.ownerMessageSha256!==t.reviewedOwnerMessageSha256||hash(read(r.accountRoot,r.ownerMessagePath))!==t.reviewedOwnerMessageSha256||r.proposalSha256!==t.reviewedProposalSha256||hash(read(r.accountRoot,r.proposalPath,65536))!==t.reviewedProposalSha256)throw Error('COMPILER_OWNER_PROPOSAL_BINDING');
 const now=Date.now();if(now<r.notBefore||now>=r.expiresAt||r.expiresAt-r.notBefore>1200000)throw Error('COMPILER_AUTHORITY_EXPIRED');
 const lock=join(r.accountRoot,'account.lock');if(!owned&&!lockedUnused&&existsSync(lock))throw Error('ACCOUNT_LOCKED');
 if((owned||lockedUnused)&&(!existsSync(lock)||JSON.parse(readFileSync(lock,'utf8')).pid!==process.pid))throw Error('COMPILER_LOCK_OWNERSHIP');
 const ownMarkers=[p.ownerMarker,p.proposalMarker];
 if(owned){for(const path of ownMarkers)if(read(r.accountRoot,path)!==JSON.stringify(markerValue(r,g)))throw Error('COMPILER_MARKER_BINDING');}
 else {
  if(ownMarkers.some(existsSync)||existsSync(p.executionDirectory))throw Error('COMPILER_CONSUMED');
  for(const name of readdirSync(r.accountRoot).filter(n=>n.startsWith('.')&&n.endsWith('.consumed.json'))){const v=JSON.parse(read(r.accountRoot,join(r.accountRoot,name)));if(v.ownerMessageSha256===r.ownerMessageSha256||v.ownerApprovalSha256===r.ownerMessageSha256)throw Error('COMPILER_OWNER_CONSUMED');}
 }
 const lifecycle=readdirSync(r.accountRoot).filter(n=>n.startsWith('.')&&n.endsWith('.json')&&(!owned||!ownMarkers.includes(join(r.accountRoot,n)))).sort().map(name=>({name,sha256:hash(read(r.accountRoot,join(r.accountRoot,name),65536))}));
 if(hash(JSON.stringify(lifecycle))!==r.lifecycleSha256)throw Error('COMPILER_LIFECYCLE_DRIFT');
 const proof=candidateValidationProof(root,r.evaluationCandidateSha);for(const key of ['evaluationCandidateSha','harnessRevisionSha','candidateProofSha256','harnessProofSha256'] as const)if(proof[key]!==r[key])throw Error('COMPILER_SOURCE_BINDING');
 if(deriveBoundedPilotManifest(root).manifestSha256!==r.manifestSha256)throw Error('COMPILER_MANIFEST_BINDING');
 const inventory=auditCampaignAccountRoot(r.accountRoot,owned?p.executionDirectory:undefined);
 if(inventory.inventoryDigest!==r.inventoryDigest||!inventory.bindings.some(b=>b.directory===join(r.campaignRoot,'PILOT')))throw Error('COMPILER_INVENTORY_DRIFT');
 const bytes=read(r.accountRoot,r.payloadPath,262144);if(hash(bytes)!==r.payloadSha256)throw Error('COMPILER_PAYLOAD_BINDING');
 const payload=JSON.parse(bytes);verifyContextRequestSchema(payload,'TYPED_105');
 if(payload.model!==r.model||JSON.stringify(payload.provider)!==JSON.stringify({only:[r.provider],allow_fallbacks:false,require_parameters:true,data_collection:'deny',zdr:true,max_price:{prompt:.1,completion:.4}}))throw Error('COMPILER_ROUTE_BINDING');if(hash(JSON.stringify(payload.response_format.json_schema.schema))!==r.schemaSha256)throw Error('COMPILER_SCHEMA_BINDING');
 const cost=inspectConservativeDebugCost(r.accountRoot,10000000,105472,false);
 if(!owned&&(cost.unknownCount!==r.expectedUnknown||cost.conservativeRetainedMicrounits!==r.expectedRetainedMicrounits||cost.remainingConservativeMicrounits!==r.expectedRemainingMicrounits))throw Error('COMPILER_BALANCE_DRIFT');
 if(r.expectedRetainedMicrounits+r.expectedRemainingMicrounits!==10000000||r.expectedRemainingMicrounits<105472||cost.conservativeRetainedMicrounits>10000000)throw Error('COMPILER_BUDGET_INSUFFICIENT');
 return {record:r,...p,cost};
}
function grant(a:TypedCompilerLaunch|undefined){const g=a&&grants.get(a);if(!g)throw Error('COMPILER_AUTHORITY_REQUIRED');return g;}
export function loadTypedCompilerLaunch(root:string,path:string,trust:TypedCompilerTrust):TypedCompilerLaunch{const g={root,path,trust:Object.freeze({...trust})};verify(g);const a=Object.freeze({}) as TypedCompilerLaunch;grants.set(a,g);return a;}
export function inspectTypedCompilerLaunch(a:TypedCompilerLaunch|undefined){return verify(grant(a));}
export function takeTypedCompilerExecution(a:TypedCompilerLaunch,key:unknown){if(!isTypedCompilerBridgeKey(key))throw Error('COMPILER_PRIVATE_BRIDGE_REQUIRED');const execution=active.get(a);if(!execution)throw Error('COMPILER_ACTIVE_LAUNCH_REQUIRED');return execution;}
async function credential(callback:(signal:AbortSignal)=>Promise<string>,signal:AbortSignal){
 if(signal.aborted)throw Error('COMPILER_CREDENTIAL_ABORTED');
 return new Promise<string>((resolve,reject)=>{const aborted=()=>reject(Error('COMPILER_CREDENTIAL_ABORTED'));signal.addEventListener('abort',aborted,{once:true});Promise.resolve().then(()=>callback(signal)).then(resolve,()=>reject(Error('COMPILER_CREDENTIAL_FAILED'))).finally(()=>signal.removeEventListener('abort',aborted));});
}
export async function runTypedCompilerLaunch(a:TypedCompilerLaunch|undefined,acquireCredential:(signal:AbortSignal)=>Promise<string>){
 const g=grant(a),initial=verify(g);let rejected=false,rejectionCode='COMPILER_LAUNCH_REJECTED';
 const outcome=await withAccountRootLock(initial.record.accountRoot,async()=>{
  // Admission exceptions are returned through the lock owner, not thrown across
  // withAccountRootLock (which deliberately retains locks on uncertain failure).
  let mutationStarted=false,physicalProviderHttpAttempts=0,key:string|undefined;
  const loaded=await import('./register-conversation-loader.mjs');
  const checkLoaded=()=>loaded.assertLoadedCandidateModules(g.root,initial.record.evaluationCandidateSha,initial.record.harnessRevisionSha);
  try {
   // No marker yet: validate using the owned lock but otherwise unused identity.
   const lock=join(initial.record.accountRoot,'account.lock');
   if(JSON.parse(readFileSync(lock,'utf8')).pid!==process.pid)throw Error('COMPILER_LOCK_OWNERSHIP');
   // Recheck immutable preflight under lock; verify's unused branch accepts only
   // the lock created by this operation through the explicit parameter below.
   const r=initial.record;
   const underLock=verify(g,false,true);checkLoaded();
   mutationStarted=true;
   for(const path of [underLock.ownerMarker,underLock.proposalMarker])appendCandidateValidationRecord(r.accountRoot,path,markerValue(r,g));
   mkdirSync(underLock.executionDirectory,{recursive:true,mode:0o700});
   appendCandidateValidationRecord(r.accountRoot,join(underLock.executionDirectory,'execution.json'),{recordSha256:g.trust.reviewedRecordSha256,operation:r.operation,paid:'HOLD_AFTER_ONE_DIAGNOSTIC',payloadSha256:r.payloadSha256,schemaSha256:r.schemaSha256,accounting:underLock.cost});
   const execution:ObservableExecution={root:g.root,directory:underLock.executionDirectory,sourceSha:r.evaluationCandidateSha,provenanceDigest:r.candidateProofSha256,profile:'PILOT',wireProtocol:'TYPED_105',debugBudgetAuthoritySha256:g.trust.reviewedRecordSha256,runId:underLock.runId,singleTarget:{fixture:'R01',turn:0,manifestSha256:r.manifestSha256},accountingPolicy:'CONFIRMED_COST_V1',cumulativeAuthorizedMicrounits:10000000,cumulativeRetainedMicrounits:underLock.cost.confirmedMicrounits,startedAt:Date.now(),expiresAt:r.expiresAt,httpRequestCount:()=>physicalProviderHttpAttempts,transport:async(request,options)=>{
    verify(g,true);checkLoaded();
    if(physicalProviderHttpAttempts||options.signal.aborted||hash(JSON.stringify(request))!==r.payloadSha256||hash(JSON.stringify(request.response_format.json_schema.schema))!==r.schemaSha256)throw Error('COMPILER_DISPATCH_FENCE');
    const rows=readCampaignLedger(underLock.executionDirectory);
    if(rows.filter(row=>row.event==='RESERVE').length!==1||rows.filter(row=>row.event==='DISPATCH').length!==1||rows.some(row=>row.event==='FINISH'))throw Error('COMPILER_RESERVATION_FENCE');
    key=await credential(acquireCredential,options.signal);
    if(!key||key.length>8192||/\s|[\x00-\x1f\x7f]/u.test(key))throw Error('COMPILER_CREDENTIAL_FORMAT');
    verify(g,true);checkLoaded();if(options.signal.aborted||!active.has(a!))throw Error('COMPILER_DISPATCH_ABORTED');
    return createContextHttpTransport(key,async(url,init)=>{if(physicalProviderHttpAttempts||options.signal.aborted||!active.has(a!))throw Error('COMPILER_PHYSICAL_HTTP_FENCE');physicalProviderHttpAttempts++;return fetch(url,{...init,redirect:'error'});})(request,options);
   }};
   active.set(a!,execution);
   const result=await runTypedCompilerDiagnosticExecution(a!);
   const finalRows=readCampaignLedger(underLock.executionDirectory);
   if(finalRows.some(row=>row.event==='RESERVE'&&!finalRows.some(finish=>finish.event==='FINISH'&&finish.reservationId===row.reservationId)))throw Error('COMPILER_UNSETTLED_LOCK_RETAINED');
   const cost=inspectConservativeDebugCost(r.accountRoot,10000000,105472,false);
   const summary={terminal:true,paid:'HOLD' as const,pilotCredit:false,score:null,fullStarted:false,deployed:false,physicalProviderHttpAttempts,directory:underLock.executionDirectory,compilerAdmission:physicalProviderHttpAttempts===1&&result.responses[0]?.httpStatus===200?'HTTP_200_OBSERVED':'NOT_OBSERVED',strictOracle:result.applicationEvidence[0]?.oracle??'NOT_ACCEPTED',accounting:cost};
   appendCandidateValidationRecord(r.accountRoot,join(underLock.executionDirectory,'terminal.json'),summary);
   return summary;
  }catch(error) {
   rejectionCode=error instanceof Error&&/^[A-Z][A-Z0-9_]{2,80}$/u.test(error.message)?error.message:'COMPILER_INTERNAL_STOP';
   // Every expected credential/transport failure is settled by the runner.
   // Any exception crossing this boundary after mutation may be a write/fsync
   // failure. Preserve the account lock for explicit evidence-based recovery.
   if(mutationStarted)throw Error('COMPILER_STORAGE_OR_EXECUTION_UNCERTAIN_LOCK_RETAINED');
   rejected=true;return undefined;
  }finally{active.delete(a!);key=undefined;}
 });
 if(rejected||!outcome)throw Error(rejectionCode);return outcome;
}

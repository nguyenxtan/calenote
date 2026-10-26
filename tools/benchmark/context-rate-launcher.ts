import {boundedRateRecord,rateEvidenceChunks} from './context-rate-artifacts';
import {acquireRateCredential} from './context-rate-credential';
import {assertRateHarnessCommit} from './context-rate-source';
import {rateSchedulingClock,rateSchedulingJitter,waitRateScheduler} from './context-rate-clock';
import {rateFrozenIdentity} from './context-rate-identity';
import {createRateExecution,closeRateExecution} from './context-rate-execution';
/** Dormant v5 orchestration. No CLI, bootstrap, env switch or live owner grant
 * is installed here. A proposal, credentials and hashes copied from it alone
 * cannot create this reviewed owner capability. Legacy launchers are unchanged. */
import {createHash} from 'node:crypto';
import {readFileSync,lstatSync,realpathSync,existsSync,mkdirSync,readdirSync,openSync,closeSync,fsyncSync} from 'node:fs';
import {join,relative,isAbsolute} from 'node:path';import {fileURLToPath} from 'node:url';
import {z} from 'zod';
import {candidateValidationProof,appendCandidateValidationRecord} from './context-contract-candidate-validation';
import {auditCampaignAccountRoot,withAccountRootLock,readCampaignLedger,appendCampaignEvent,completeCampaign} from './context-contract-live';
import {inspectConservativeDebugCost} from './context-confirmed-cost';import {deriveBoundedPilotManifest} from './context-bounded-pilot';
import {executeObservableCampaign} from './context-contract-runner';import {RateBatchController} from './context-rate-batch';
import {CURRENT_RATE_SCOPE as C,createCurrentRateBudget} from './context-rate-current-policy';
import {RATE_POLICY as P,parseRateHint} from './context-rate-policy';
import {captureRateReceipt,type RateReceipt} from './context-rate-receipt';import {verifyRateSuccessor,verifyRateParentForSource,readRateArtifact} from './context-rate-successor';
import {sealProviderFailure,PILOT_FAILURE_PUBLIC_KEY} from './context-failure-forensics';
import {createContextHttpTransport,AI_STUDIO_PILOT_RETENTION_POLICY} from '../../src/modules/intelligence/infrastructure/openrouter/semantic-gateway';
const hash=(v:string|Uint8Array)=>createHash('sha256').update(v).digest('hex'),digest=z.string().regex(/^[a-f0-9]{64}$/u),sha=z.string().regex(/^[a-f0-9]{40}$/u);
const schema=z.strictObject({version:z.literal('formal-pilot-rate-launch-authority-5'),paid:z.literal('AUTHORIZED_RATE_AWARE_FRESH_BATCH'),scopeSha256:z.literal(P.scopeDigest),
 accountRoot:z.string(),campaignRoot:z.string(),evaluationCandidateSha:z.literal(P.app),harnessRevisionSha:sha,candidateProofSha256:digest,harnessProofSha256:digest,manifestSha256:digest,inventoryDigest:digest,
 ownerDecisionPath:z.string(),ownerDecisionSha256:digest,proposalPath:z.string(),proposalSha256:digest,parentDirectory:z.string(),parentVerificationPath:z.string(),parentVerificationSha256:digest,parentProjectionPath:z.string(),parentProjectionSha256:digest,
 parentArtifactHashes:z.record(z.string(),digest)});
export type RateLaunchRecord=z.infer<typeof schema>;
const currentSchema=schema.extend({version:z.literal('formal-pilot-rate-launch-authority-6'),paid:z.literal('AUTHORIZED_CURRENT_PACED_FORMAL'),scopeSha256:z.literal(C.scopeDigest),evaluationCandidateSha:sha,parentEvaluationCandidateSha:sha,retainedBaselineMicrounits:z.number().int().safe().min(C.minBaseline),unknownBaseline:z.number().int().safe().min(C.minUnknown)});
export type CurrentRateLaunchRecord=z.infer<typeof currentSchema>;
type AnyRecord=RateLaunchRecord|CurrentRateLaunchRecord;
type ExecutionPolicy=Omit<typeof P,'app'|'version'|'scopeDigest'|'baseline'|'unknown'|'subcap'|'runs'|'batchRequests'|'batchMs'>&{app:string;version:typeof P.version|typeof C.version;scopeDigest:string;baseline:number;unknown:number;subcap:number;runs:number;batchRequests:number;batchMs:number;phaseEnvelope?:true};
export interface RateLaunchTrust{accountRoot:string;campaignRoot:string;reviewedRecordSha256:string;reviewedOwnerDecisionSha256:string;reviewedProposalSha256:string;expectedParentDirectory:string;reviewedParentVerificationSha256:string;reviewedParentProjectionSha256:string;harnessRevisionSha:string;harnessProofSha256:string;candidateProofSha256:string;manifestSha256:string;inventoryDigest:string}
export interface CurrentRateLaunchTrust extends RateLaunchTrust{evaluationCandidateSha:string;expectedParentEvaluationCandidateSha:string;expectedRetainedMicrounits:number;expectedUnknownCount:number}
const brand:unique symbol=Symbol('RateAwareLaunch');export interface RateAwareLaunch{readonly [brand]:true}
type Grant={root:string;path:string;trust:Readonly<RateLaunchTrust>;record:AnyRecord;policy:ExecutionPolicy;current:boolean;baseline:ReturnType<typeof auditCampaignAccountRoot>['bindings'];parent:{receiptAt:number;hint:ReturnType<typeof parseRateHint>}};
const grants=new WeakMap<object,Grant>(),active=new WeakSet<object>();
function persistRateRecord(root:string,path:string,value:unknown){const text=boundedRateRecord(value);appendCandidateValidationRecord(root,path,text);if(hash(readFileSync(path))!==hash(text))throw Error('RATE_PERSISTENCE_UNCERTAIN');}
function readPinned(path:string,pin:string,maximum=16384,parse=true){if(realpathSync(path)!==path||lstatSync(path).isSymbolicLink()||!lstatSync(path).isFile()||lstatSync(path).size>maximum||hash(readFileSync(path))!==pin)throw Error('RATE_PIN');return parse?readRateArtifact(path,maximum):undefined;}
function inside(root:string,path:string){const r=relative(root,path);if(!isAbsolute(path)||!r||r.startsWith('..')||isAbsolute(r)||realpathSync(path)!==path)throw Error('RATE_PATH');}
function batchPath(r:AnyRecord){return join(r.accountRoot,`.rate-batch-${hash(r.ownerDecisionSha256+r.proposalSha256).slice(0,40)}`);}
function ownerMarker(r:AnyRecord){return join(r.accountRoot,`.rate-owner-${r.ownerDecisionSha256}.consumed.json`);}
function verifySource(g:Grant){
 const {root,record:r,trust:t}=g;
 if(realpathSync(root)!==root||realpathSync(process.cwd())!==root||!fileURLToPath(import.meta.url).startsWith(root+'/tools/benchmark/'))throw Error('RATE_EXECUTING_ROOT');
 readPinned(g.path,t.reviewedRecordSha256);readPinned(r.ownerDecisionPath,t.reviewedOwnerDecisionSha256,16384,false);readPinned(r.proposalPath,t.reviewedProposalSha256,16384,false);
 assertRateHarnessCommit(root,r.harnessRevisionSha);
 const proof=candidateValidationProof(root,g.policy.app);for(const key of ['evaluationCandidateSha','harnessRevisionSha','candidateProofSha256','harnessProofSha256'] as const)if(proof[key]!==r[key])throw Error('RATE_SOURCE');
 const m=deriveBoundedPilotManifest(root);if(m.manifestSha256!==r.manifestSha256||m.maxProviderHttpRequests!==76||m.totalFixtures!==32||m.totalTurns!==84)throw Error('RATE_MANIFEST');
}
function initialParent(r:AnyRecord){
 const current=r.version==='formal-pilot-rate-launch-authority-6',source=current?r.parentEvaluationCandidateSha:P.app,unknown=current?r.unknownBaseline:P.unknown;
 inside(r.accountRoot,r.parentDirectory);
 const verification=readPinned(r.parentVerificationPath,r.parentVerificationSha256) as {source:string;terminal:boolean;pilotPass:boolean;ownerConsumed:boolean;proposalConsumed:boolean;ledgerHashChain:string;accountLockPresent:boolean;unknownCount:number;physicalProviderHttpAttempts:number;failure:{httpStatus:number;category:string;hasModelSemanticPayload:boolean;completeOuterBytes:number;outerSha256:string;mutations:number};artifactHashes:Record<string,string>};
 const projection=readPinned(r.parentProjectionPath,r.parentProjectionSha256) as {source:string;bodySha256:string;httpStatus:number;limitSource:string;isByok:boolean;headerReceiptStatus:string};
 const required=['campaign.jsonl','report.json','responses.json','terminal.json'];
 for(const name of required)if(!r.parentArtifactHashes[name])throw Error('RATE_PARENT_PINS');
 if(Object.keys(r.parentArtifactHashes).length>16)throw Error('RATE_PARENT_PINS');
 for(const [name,pin] of Object.entries(r.parentArtifactHashes)){if(!/^[a-z0-9.-]+$/u.test(name))throw Error('RATE_PARENT_PINS');readPinned(join(r.parentDirectory,name),pin,4194304,false);const external=verification.artifactHashes[join(r.parentDirectory,name)];if(external!==pin)throw Error('RATE_PARENT_PINS');}
 if(verification.source!==source||!verification.terminal||verification.pilotPass!==false||verification.ownerConsumed!==true||verification.proposalConsumed!==true||verification.ledgerHashChain!=='PASS'||verification.accountLockPresent!==false||verification.unknownCount!==unknown||verification.failure.httpStatus!==429||verification.failure.category!=='RATE_LIMITED'||verification.failure.hasModelSemanticPayload!==false||verification.failure.mutations!==0||projection.source!==source||projection.httpStatus!==429||projection.limitSource!=='upstream_provider_shared_pool'||projection.isByok!==false||projection.bodySha256!==verification.failure.outerSha256||projection.headerReceiptStatus!=='NOT_CAPTURED_CANNOT_INFER_HEADER_ABSENCE')throw Error('RATE_PARENT_BINDING');
 const finish=readCampaignLedger(r.parentDirectory).filter(x=>x.event==='FINISH').at(-1);if(!finish)throw Error('RATE_PARENT_BINDING');
 return verifyRateParentForSource(r.parentDirectory,r.manifestSha256,{status:429,receivedAt:finish.at,complete:true,capturedBytes:verification.failure.completeOuterBytes,capturedSha256:projection.bodySha256,matchedPool:true,hint:parseRateHint(undefined,finish.at)},source);
}
/** Caller pins originate in one actual owner decision plus independent packet
 * review. This module never discovers or infers that decision from raw files. */
export function loadRateAwareLaunch(root:string,path:string,trust:RateLaunchTrust):RateAwareLaunch{
 if(!trust||![trust.reviewedOwnerDecisionSha256,trust.reviewedRecordSha256,trust.reviewedProposalSha256,trust.reviewedParentVerificationSha256,trust.reviewedParentProjectionSha256].every(v=>/^[a-f0-9]{64}$/u.test(v??'')))throw Error('RATE_OWNER_REVIEW_REQUIRED');
 const t=Object.freeze({...trust}),r=schema.parse(readPinned(path,t.reviewedRecordSha256));
 const fixed=rateFrozenIdentity();for(const k of ['accountRoot','parentDirectory','parentVerificationSha256','parentProjectionSha256'] as const)if(r[k]!==fixed[k])throw Error('RATE_NAMESPACE');
 for(const k of ['accountRoot','campaignRoot','harnessRevisionSha','candidateProofSha256','harnessProofSha256','manifestSha256','inventoryDigest'] as const)if(r[k]!==t[k])throw Error('RATE_TRUST');
 if(r.ownerDecisionSha256!==t.reviewedOwnerDecisionSha256||r.proposalSha256!==t.reviewedProposalSha256||r.parentDirectory!==t.expectedParentDirectory||r.parentVerificationSha256!==t.reviewedParentVerificationSha256||r.parentProjectionSha256!==t.reviewedParentProjectionSha256)throw Error('RATE_OWNER_BINDING');
 if(realpathSync(r.accountRoot)!==r.accountRoot)throw Error('RATE_PATH');inside(r.accountRoot,r.campaignRoot);inside(r.accountRoot,path);inside(r.accountRoot,r.ownerDecisionPath);inside(r.accountRoot,r.proposalPath);
 const baseline=auditCampaignAccountRoot(r.accountRoot);if(baseline.inventoryDigest!==r.inventoryDigest)throw Error('RATE_INVENTORY');
 const parent=initialParent(r),g:Grant={root,path,record:r,trust:t,policy:P,current:false,baseline:baseline.bindings,parent};verifySource(g);
 const budget=inspectConservativeDebugCost(r.accountRoot,P.cap,P.reserve,false);if(budget.conservativeRetainedMicrounits!==P.baseline||budget.unknownCount!==64)throw Error('RATE_BASELINE');
 if(existsSync(ownerMarker(r))||existsSync(batchPath(r))||existsSync(join(r.accountRoot,'account.lock')))throw Error('RATE_CONSUMED_OR_LOCKED');
 for(const name of readdirSync(r.accountRoot).filter(n=>n.startsWith('.')&&n.endsWith('.consumed.json'))){const old=readRateArtifact(join(r.accountRoot,name),16384) as {ownerMessageSha256?:string;ownerApprovalSha256?:string;ownerDecisionSha256?:string};if([old.ownerMessageSha256,old.ownerApprovalSha256,old.ownerDecisionSha256].includes(r.ownerDecisionSha256))throw Error('RATE_OWNER_CONSUMED');}
 const a=Object.freeze({}) as RateAwareLaunch;grants.set(a,g);return a;
}
/** Current-source capability: separately reviewed source, baseline and historical parent; no fallback. */
export function loadCurrentRateAwareLaunch(root:string,path:string,trust:CurrentRateLaunchTrust):RateAwareLaunch{
 if(!trust||![trust.reviewedOwnerDecisionSha256,trust.reviewedRecordSha256,trust.reviewedProposalSha256,trust.reviewedParentVerificationSha256,trust.reviewedParentProjectionSha256].every(v=>/^[a-f0-9]{64}$/u.test(v??'')))throw Error('RATE_OWNER_REVIEW_REQUIRED');
 const t=Object.freeze({...trust}),r=currentSchema.parse(readPinned(path,t.reviewedRecordSha256));
 if(r.accountRoot!==rateFrozenIdentity().accountRoot)throw Error('RATE_NAMESPACE');
 for(const k of ['accountRoot','campaignRoot','evaluationCandidateSha','harnessRevisionSha','candidateProofSha256','harnessProofSha256','manifestSha256','inventoryDigest'] as const)if(r[k]!==t[k])throw Error('RATE_TRUST');
 if(r.parentEvaluationCandidateSha!==t.expectedParentEvaluationCandidateSha||r.retainedBaselineMicrounits!==t.expectedRetainedMicrounits||r.unknownBaseline!==t.expectedUnknownCount)throw Error('RATE_CURRENT_BASELINE');
 if(r.ownerDecisionSha256!==t.reviewedOwnerDecisionSha256||r.proposalSha256!==t.reviewedProposalSha256||r.parentDirectory!==t.expectedParentDirectory||r.parentVerificationSha256!==t.reviewedParentVerificationSha256||r.parentProjectionSha256!==t.reviewedParentProjectionSha256)throw Error('RATE_OWNER_BINDING');
 if(realpathSync(r.accountRoot)!==r.accountRoot)throw Error('RATE_PATH');for(const p of [r.campaignRoot,path,r.ownerDecisionPath,r.proposalPath,r.parentVerificationPath,r.parentProjectionPath])inside(r.accountRoot,p);
 const budget=createCurrentRateBudget({baseline:r.retainedBaselineMicrounits,unknown:r.unknownBaseline});
 const policy:ExecutionPolicy=Object.freeze({...P,...budget,version:C.version,scopeDigest:C.scopeDigest,app:r.evaluationCandidateSha,batchRequests:C.batchRequests,phaseEnvelope:true});
 const baseline=auditCampaignAccountRoot(r.accountRoot);if(baseline.inventoryDigest!==r.inventoryDigest)throw Error('RATE_INVENTORY');
 const parent=initialParent(r),g:Grant={root,path,record:r,trust:t,policy,current:true,baseline:baseline.bindings,parent};verifySource(g);
 const actual=inspectConservativeDebugCost(r.accountRoot,P.cap,P.reserve,false);if(actual.conservativeRetainedMicrounits!==policy.baseline||actual.unknownCount!==policy.unknown)throw Error('RATE_BASELINE');
 if(existsSync(ownerMarker(r))||existsSync(batchPath(r))||existsSync(join(r.accountRoot,'account.lock')))throw Error('RATE_CONSUMED_OR_LOCKED');
 for(const name of readdirSync(r.accountRoot).filter(n=>n.startsWith('.')&&n.endsWith('.consumed.json'))){const old=readRateArtifact(join(r.accountRoot,name),16384) as {ownerMessageSha256?:string;ownerApprovalSha256?:string;ownerDecisionSha256?:string};if([old.ownerMessageSha256,old.ownerApprovalSha256,old.ownerDecisionSha256].includes(r.ownerDecisionSha256))throw Error('RATE_OWNER_CONSUMED');}
 const a=Object.freeze({}) as RateAwareLaunch;grants.set(a,g);return a;
}
export async function runCurrentRateAwareLaunch(authority:RateAwareLaunch|undefined,acquireCredential:(signal:AbortSignal)=>Promise<string>,options:RateRunOptions={}){
 if(!authority||!grants.get(authority)?.current)throw Error('RATE_CURRENT_AUTHORITY_REQUIRED');return runRateAwareLaunch(authority,acquireCredential,options);
}
const rateBridgeKey=Object.freeze({});
export function isRateAwareBridgeKey(key:unknown){return key===rateBridgeKey;}
export interface RateRunOptions{signal?:AbortSignal}
export async function runRateAwareLaunch(authority:RateAwareLaunch|undefined,acquireCredential:(signal:AbortSignal)=>Promise<string>,options:RateRunOptions={}){
 const g=authority&&grants.get(authority);if(!g)throw Error('RATE_AUTHORITY_REQUIRED');if(Object.keys(options).some(k=>k!=='signal'))throw Error('RATE_RUNTIME_OVERRIDE');if(active.has(authority!))throw Error('RATE_EXECUTION_IN_PROGRESS');active.add(authority!);
 try{
  verifySource(g);
  if(existsSync(ownerMarker(g.record))||existsSync(batchPath(g.record))||existsSync(join(g.record.accountRoot,'account.lock')))throw Error('RATE_CONSUMED_OR_LOCKED');
  if(auditCampaignAccountRoot(g.record.accountRoot).inventoryDigest!==g.record.inventoryDigest)throw Error('RATE_INVENTORY');
  return await withAccountRootLock(g.record.accountRoot,async()=>{
  const policy=g.policy,r=g.record,dir=batchPath(r),allowed=new Set<string>();verifySource(g);initialParent(r);
  if(existsSync(ownerMarker(r))||existsSync(dir))throw Error('RATE_CONSUMED_OR_LOCKED');
  const loader=await import('./register-conversation-loader.mjs');const loaded=()=>loader.assertLoadedCandidateModules(g.root,policy.app,r.harnessRevisionSha);loaded();
  const verify=()=>{verifySource(g);loaded();const audit=auditCampaignAccountRoot(r.accountRoot);
   for(const old of g.baseline)if(JSON.stringify(audit.bindings.find(b=>b.directory===old.directory))!==JSON.stringify(old))throw Error('RATE_PRIOR_HISTORY_DRIFT');
   if(audit.bindings.some(b=>!g.baseline.some(old=>old.directory===b.directory)&&!allowed.has(b.directory)))throw Error('RATE_INVENTORY_DRIFT');
   const b=inspectConservativeDebugCost(r.accountRoot,P.cap,P.reserve,false);return {retained:b.conservativeRetainedMicrounits,unknown:b.unknownCount};};
  verify();persistRateRecord(r.accountRoot,ownerMarker(r),{ownerDecisionSha256:r.ownerDecisionSha256,recordDigest:g.trust.reviewedRecordSha256,policy:policy.scopeDigest});
  const signal=options.signal??new AbortController().signal,clock=rateSchedulingClock;
  const controller=new RateBatchController({accountRoot:r.accountRoot,directory:dir,recordDigest:g.trust.reviewedRecordSha256,clock,signal,jitter:rateSchedulingJitter,wait:waitRateScheduler,verify,...(g.current?{budget:createCurrentRateBudget({baseline:policy.baseline,unknown:policy.unknown})}:{})});
  let parent=g.parent;const results:Array<{directory:string;pilotCredit:boolean;physicalProviderHttpAttempts:number;status:string}>=[];let persistenceUncertain=false;
  const persist=(path:string,value:unknown)=>{try{persistRateRecord(r.accountRoot,path,value);}catch(e){persistenceUncertain=true;throw e;}};
  for(let ordinal=1;ordinal<=policy.runs;ordinal++){
   try{await controller.startRun(parent.receiptAt,parent.hint);}catch(error){
    const code=error instanceof Error?error.message:'';
    const aborted=signal.aborted&&(error===signal.reason||(error instanceof Error&&error.name==='AbortError'));
    if(!aborted&&!['RATE_BATCH_EXPIRY','RATE_RUN_EXPIRY','RATE_COOLDOWN_LIMIT','RATE_CLOCK','RATE_BASELINE','RATE_SUBCAP','RATE_PHASE_CAP','RATE_GLOBAL_CAP','RATE_RUN_LIMIT','RATE_REQUEST_LIMIT','RATE_CIRCUIT'].includes(code))throw error;
    controller.stopIdle(aborted?'ABORTED':code);
    for(const leaf of allowed){const rows=readCampaignLedger(leaf);const n=rows.filter(r=>r.event==='RESERVE').length;if(rows.filter(r=>r.event==='DISPATCH').length!==n||rows.filter(r=>r.event==='FINISH').length!==n)throw Error('RATE_UNSETTLED_ACCOUNTING');}
    persist(join(dir,'batch-terminal.json'),{version:'rate-batch-terminal-2',status:'STOP',reason:aborted?'ABORTED':code,results,recordDigest:g.trust.reviewedRecordSha256,policy:policy.scopeDigest,journalFinalHash:controller.journalHead()});
    return {batchDirectory:dir,results,pilotCredit:false,terminal:true,accounting:inspectConservativeDebugCost(r.accountRoot,P.cap,P.reserve,false)};
   }verify();loaded();
   const child=join(dir,`run-${ordinal}`),leaf=join(child,'PILOT');if(existsSync(child))throw Error('RATE_CHILD_CONSUMED');mkdirSync(child,{mode:0o700});mkdirSync(leaf,{mode:0o700});allowed.add(leaf);
   persist(join(leaf,'execution.json'),{version:'rate-fresh-child-2',batchRecordSha256:g.trust.reviewedRecordSha256,ordinal,...candidateValidationProof(g.root,policy.app),manifestSha256:r.manifestSha256,mode:'FORMAL_PILOT'});
   const execution=createRateExecution(controller,rateBridgeKey,{directory:leaf,provenanceDigest:r.candidateProofSha256,manifestSha256:r.manifestSha256,targets:deriveBoundedPilotManifest(g.root).targets,...(g.current?{current:{applicationSha:policy.app,timingPolicy:C.version}}:{})});
   let key:string|undefined;let physical=0;const receipts:RateReceipt[]=[];let next=0;
   try{
    // Durable owner/batch/child consumption is established before this callback.
    key=await acquireRateCredential(acquireCredential,signal,controller.remainingMilliseconds());if(!key||/[\r\n]/u.test(key))throw Error('CREDENTIAL_INVALID');verify();loaded();signal.throwIfAborted();
    const targets=deriveBoundedPilotManifest(g.root).targets;
    const result=await executeObservableCampaign({root:g.root,directory:leaf,sourceSha:policy.app,provenanceDigest:r.candidateProofSha256,profile:'PILOT',runId:`rate-${hash(g.trust.reviewedRecordSha256).slice(0,32)}-${ordinal}`,wireProtocol:'SMALL_106',pilotRoute:AI_STUDIO_PILOT_RETENTION_POLICY,rateExecution:execution,accountingPolicy:'CONFIRMED_COST_V1',debugBudgetAuthoritySha256:g.trust.reviewedRecordSha256,cumulativeAuthorizedMicrounits:P.cap,cumulativeRetainedMicrounits:inspectConservativeDebugCost(r.accountRoot,P.cap,P.reserve,false).confirmedMicrounits,
     boundedPilot:{manifestSha256:r.manifestSha256,maxRequests:76,async beforeDispatch(target,id){if(JSON.stringify(target)!==JSON.stringify(targets[next]))throw Error('RATE_TARGET');persist(join(leaf,`target-${next}.claim.json`),{target,reservationId:id});next++;},settled(_t,id){controller.settled(id);},outcome(){}},
     transport:async(request,requestOptions)=>{
      verifySource(g);loaded();signal.throwIfAborted();if(request.model!=='google/gemini-2.5-flash-lite'||request.provider.only.join('|')!=='google-ai-studio'||request.provider.zdr!==false||request.provider.data_collection!=='deny'||request.provider.allow_fallbacks!==false||request.provider.require_parameters!==true||request.stream!==false||request.max_tokens!==1536)throw Error('RATE_ROUTE');
      let fetched=false;return createContextHttpTransport(key!,async(url,init)=>{
       if(fetched)throw Error('RATE_HIDDEN_RETRY');fetched=true;controller.dispatched(`call-${physical+1}`);physical++;
       let response:Response;
       try{response=await fetch(url,{...init,signal:AbortSignal.any([requestOptions.signal,signal]),redirect:'error'});}catch{
        const receipt:RateReceipt={status:0,receivedAt:clock().wall,complete:false,capturedBytes:0,capturedSha256:null,matchedPool:false,hint:null};receipts.push(receipt);persist(join(leaf,`rate-receipt-${physical}.json`),receipt);throw Error('RATE_TRANSPORT_FAILED');
       }
       const receipt=await captureRateReceipt(response,clock().wall);receipts.push(receipt);persist(join(leaf,`rate-receipt-${physical}.json`),receipt);
       const sealed=await sealProviderFailure(response,PILOT_FAILURE_PUBLIC_KEY,true);persist(join(leaf,`provider-failure-${physical}.sealed.json`),sealed);return response;
      })(request,requestOptions);
     }});
    if(persistenceUncertain)throw Error('RATE_PERSISTENCE_UNCERTAIN');controller.assertChildSettled(physical);verify();
    for(const name of ['report.json','responses.json','application-evidence.json','action-evidence.json']){const file=join(leaf,name);if(existsSync(file)){const fd=openSync(file,'r');try{fsyncSync(fd);}finally{closeSync(fd);}}}
    const ledger=readCampaignLedger(leaf),reserves=ledger.filter(e=>e.event==='RESERVE'),dispatches=ledger.filter(e=>e.event==='DISPATCH'),finishes=ledger.filter(e=>e.event==='FINISH');
    if(reserves.length!==physical||dispatches.length!==physical||finishes.length!==physical||receipts.length!==physical||result.actualProviderCalls!==physical)throw Error('RATE_UNSETTLED_ACCOUNTING');
    // Complete diagnostics remain in immutable files. Index every evidence file
    // in <=16KiB chunks; the mutable campaign is bound by its final hash chain.
    const evidenceEntries=readdirSync(leaf,{withFileTypes:true}).filter(e=>e.name!=='campaign.jsonl'&&e.name!=='campaign.lock').sort((a,b)=>a.name.localeCompare(b.name)).map(e=>{const path=join(leaf,e.name);if(!e.isFile()||e.isSymbolicLink())throw Error('RATE_ARTIFACT');return {file:e.name,sha256:hash(readFileSync(path)),bytes:lstatSync(path).size};});
    const evidenceIndexes=rateEvidenceChunks(evidenceEntries).map((chunk,index)=>{const file=`evidence-index-${index}.json`,path=join(leaf,file);persist(path,chunk);return {file,sha256:hash(readFileSync(path)),bytes:lstatSync(path).size};});
    const batchJournalPrefixHash=controller.journalHead();
    const finalBudget=inspectConservativeDebugCost(r.accountRoot,P.cap,P.reserve,false);
    const withinBudget=finalBudget.conservativeRetainedMicrounits<=P.cap&&finalBudget.conservativeRetainedMicrounits-policy.baseline<=policy.subcap&&finalBudget.unknownCount>=policy.unknown&&(!g.current||finalBudget.conservativeRetainedMicrounits-C.phaseBaseline<=C.phaseCap);
    const withinWindow=controller.canCredit();
    let pass=withinWindow&&withinBudget&&result.status==='PENDING_RATE_FINALIZATION'&&result.score?.gate==='PASS'&&result.score.passedScripts===32&&result.score.passedTurns===84&&result.score.safetyFailures===0&&physical===76&&result.actionEvidence.length===5&&result.actionEvidence.every(a=>a.oracle==='PASS'&&!a.unsafe);
    // COMPLETE is the credit commitpoint after all proof/accounting fsyncs.
    // Later append-only metadata derives from this hash; it cannot extend time.
    verifySource(g);loaded();
    const committedAt=controller.executionState().now;
    pass=pass&&controller.canCredit();
    if(pass){completeCampaign(leaf,{runId:ledger[0].runId,at:committedAt});}
    else if(!ledger.some(e=>e.event==='STOP'))appendCampaignEvent(leaf,{event:'STOP',runId:ledger[0].runId,at:committedAt,reason:'RATE_FINALIZATION_STOP'});
    const committed=readCampaignLedger(leaf).at(-1)!;
    persist(join(leaf,'final-report.json'),{version:'rate-final-report-2',status:pass?'PASS':'STOP',rateFinalization:'FINAL',evaluationCandidateSha:policy.app,harnessRevisionSha:r.harnessRevisionSha,candidateProofSha256:r.candidateProofSha256,manifestSha256:r.manifestSha256,physicalProviderHttpAttempts:physical,evidenceIndexes,batchJournalPrefixHash,provisionalReportSha256:hash(readFileSync(join(leaf,'report.json'))),responseSha256:existsSync(join(leaf,'responses.json'))?hash(readFileSync(join(leaf,'responses.json'))):null,applicationEvidenceSha256:existsSync(join(leaf,'application-evidence.json'))?hash(readFileSync(join(leaf,'application-evidence.json'))):null,actionEvidenceSha256:existsSync(join(leaf,'action-evidence.json'))?hash(readFileSync(join(leaf,'action-evidence.json'))):null,score:result.score?{gate:result.score.gate,passedScripts:result.score.passedScripts,passedTurns:result.score.passedTurns,safetyFailures:result.score.safetyFailures,healthyPlanned:result.score.healthyPlanned,healthyFullSchemaValid:result.score.healthyFullSchemaValid,detailPassed:result.score.detailPassed,detailPlanned:result.score.detailPlanned,failedMandatoryCount:result.score.failedMandatory.length}:null,finalLedgerHash:committed.hash,creditCommittedAt:pass?committedAt:null});
    persist(join(leaf,'terminal.json'),{status:pass?'PASS':'STOP',attempts:physical,mode:'FORMAL_PILOT',pilotCredit:pass,finalLedgerHash:committed.hash,creditCommittedAt:pass?committedAt:null});
    let successor=false;if(!pass&&ordinal<policy.runs&&controller.canCredit()){try{const checkedParent=verifyRateSuccessor(leaf,r.manifestSha256,receipts.at(-1)!);verify();if(controller.canCredit()){parent=checkedParent;successor=true;}}catch{/* Any ineligible failure opens circuit; never retry this child. */}}
    successor=controller.finishRun(successor);results.push({directory:leaf,pilotCredit:pass,physicalProviderHttpAttempts:physical,status:pass?'PASS':'STOP'});
    if(pass||!successor){persist(join(dir,'batch-terminal.json'),{version:'rate-batch-terminal-2',status:pass?'PASS':'STOP',results,recordDigest:g.trust.reviewedRecordSha256,policy:policy.scopeDigest,journalFinalHash:controller.journalHead()});return {batchDirectory:dir,results,pilotCredit:pass,terminal:true,accounting:inspectConservativeDebugCost(r.accountRoot,P.cap,P.reserve,false)};}
   }catch(error){
    const code=error instanceof Error?error.message:'';
    const aborted=signal.aborted&&(error===signal.reason||(error instanceof Error&&error.name==='AbortError'));
    if(physical!==0||persistenceUncertain||(!aborted&&!['RATE_RUN_EXPIRY','CREDENTIAL_INVALID','RATE_CREDENTIAL_FAILURE'].includes(code)))throw error;
    controller.assertChildSettled(0);
    const ledgerPath=join(leaf,'campaign.jsonl');if(existsSync(ledgerPath)){const rows=readCampaignLedger(leaf);if(rows.some(e=>e.event==='RESERVE'))throw Error('RATE_UNSETTLED_ACCOUNTING');if(!rows.some(e=>e.event==='STOP'))appendCampaignEvent(leaf,{event:'STOP',runId:rows[0].runId,at:controller.executionState().now,reason:aborted?'ABORTED':code});}
    controller.finishRun(false);controller.stopIdle(aborted?'ABORTED':code);
    persist(join(leaf,'terminal.json'),{status:'STOP',attempts:0,mode:'FORMAL_PILOT',pilotCredit:false,reason:aborted?'ABORTED':code});
    results.push({directory:leaf,pilotCredit:false,physicalProviderHttpAttempts:0,status:'STOP'});
    persist(join(dir,'batch-terminal.json'),{version:'rate-batch-terminal-2',status:'STOP',reason:aborted?'ABORTED':code,results,recordDigest:g.trust.reviewedRecordSha256,policy:policy.scopeDigest,journalFinalHash:controller.journalHead()});
    return {batchDirectory:dir,results,pilotCredit:false,terminal:true,accounting:inspectConservativeDebugCost(r.accountRoot,P.cap,P.reserve,false)};
   }finally{key=undefined;closeRateExecution(execution,rateBridgeKey);}
  }
  throw Error('RATE_RUN_LIMIT');
 });}finally{active.delete(authority!);}
}

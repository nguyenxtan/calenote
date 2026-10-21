/** Trusted orchestration boundary only. Import/preflight never reads a key or
 * calls a provider. A fresh directly approved, independently reviewed record is
 * required; policy approval or a proposal file is not paid authority. */
import {createHash} from 'node:crypto';
import {readFileSync,lstatSync,realpathSync,existsSync,readdirSync} from 'node:fs';
import {join,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {z} from 'zod';
import {candidateValidationProof,appendCandidateValidationRecord} from './context-contract-candidate-validation';
import {deriveBoundedPilotManifest} from './context-bounded-pilot';
import {auditCampaignAccountRoot} from './context-contract-live';
import {createDebugLoopLoader,inspectDebugLoop,runDebugLoopExecution,runFormalPilotDebugExecution,isFormalPilotBridgeKey} from './context-debug-loop';
import type {DebugLoopAuthority} from './context-debug-loop';
import {AI_STUDIO_PILOT_RETENTION_POLICY,createContextHttpTransport,type SemanticTransport} from '../../src/modules/intelligence/infrastructure/openrouter/semantic-gateway';
const hash=(v:string)=>createHash('sha256').update(v).digest('hex');
const digest=z.string().regex(/^[a-f0-9]{64}$/u),sha=z.string().regex(/^[a-f0-9]{40}$/u);
const historicalRecordSchema=z.strictObject({version:z.literal('formal-pilot-launch-authority-1'),paid:z.literal('AUTHORIZED_ONE_FORMAL_PILOT'),mode:z.literal('FORMAL_PILOT'),executions:z.literal(1),
 accountRoot:z.string(),campaignRoot:z.string(),evaluationCandidateSha:sha,harnessRevisionSha:sha,candidateProofSha256:digest,harnessProofSha256:digest,manifestSha256:digest,inventoryDigest:digest,
 proposalPath:z.string(),proposalSha256:digest,ownerMessagePath:z.string(),ownerMessageSha256:digest,debugRecordPath:z.string(),debugRecordSha256:digest,
 hardCapMicrounits:z.literal(10000000),accountingPolicy:z.literal('CONSERVATIVE_DEBUG_V1'),model:z.literal('google/gemini-2.5-flash-lite'),provider:z.literal('google-vertex/eu'),retry:z.literal(0),fallback:z.literal('none'),stream:z.literal(false),maxProviderHttpRequests:z.literal(76),totalFixtures:z.literal(32),totalTurns:z.literal(84),timeCeilingMinutes:z.literal(20)});
const recordSchema=z.discriminatedUnion('version',[
 historicalRecordSchema,
 historicalRecordSchema.extend({version:z.literal('formal-pilot-launch-authority-2'),wireProtocol:z.literal('TYPED_105')}),
 historicalRecordSchema.extend({version:z.literal('formal-pilot-launch-authority-3'),wireProtocol:z.literal('SMALL_106')}),
 historicalRecordSchema.extend({version:z.literal('formal-pilot-launch-authority-4'),wireProtocol:z.literal('SMALL_106'),provider:z.literal('google-ai-studio'),privacyPolicy:z.literal(AI_STUDIO_PILOT_RETENTION_POLICY)}),
]);
export interface FormalPilotTrust {
 pilotRoute?:typeof AI_STUDIO_PILOT_RETENTION_POLICY;
 wireProtocol?:"TYPED_105"|"SMALL_106";accountRoot:string;campaignRoot:string;evaluationCandidateSha:string;harnessRevisionSha:string;candidateProofSha256:string;harnessProofSha256:string;manifestSha256:string;inventoryDigest:string;
 reviewedRecordSha256:string;reviewedOwnerMessageSha256:string;reviewedProposalSha256:string;
}
const brand:unique symbol=Symbol('FormalPilotLaunch');
export interface FormalPilotLaunch {readonly [brand]:true}
type Record=z.infer<typeof recordSchema>;
type Grant={root:string;path:string;trust:Readonly<FormalPilotTrust>;debug:DebugLoopAuthority};
const grants=new WeakMap<object,Grant>();
function contained(root:string,path:string){const rel=relative(root,path);if(!isAbsolute(path)||!rel||rel.startsWith('..')||isAbsolute(rel)||realpathSync(path)!==path||lstatSync(path).isSymbolicLink())throw Error('FORMAL_PATH_BINDING');}
function read(root:string,path:string){contained(root,path);const stat=lstatSync(path);if(!stat.isFile()||stat.size>16384)throw Error('FORMAL_RECORD_SIZE');return readFileSync(path,'utf8');}
function paths(r:Record){const id=`debug-${hash(r.ownerMessageSha256+r.evaluationCandidateSha+'FORMAL_PILOT').slice(0,40)}`;return {executionDirectory:join(r.campaignRoot,'debug-loop-executions',id,'PILOT'),proposalMarker:join(r.accountRoot,`.formal-pilot-proposal-${r.proposalSha256}.consumed.json`),ownerMarker:join(r.accountRoot,`.formal-pilot-owner-${r.ownerMessageSha256}.consumed.json`)};}
function verify(g:Grant,options:{underLock?:boolean;owned?:boolean;excluded?:string}={}){
 const {trust:t,root}=g;if(realpathSync(root)!==root||realpathSync(process.cwd())!==root||!fileURLToPath(import.meta.url).startsWith(root+'/tools/benchmark/'))throw Error('FORMAL_EXECUTING_ROOT');
 if(realpathSync(t.accountRoot)!==t.accountRoot)throw Error('FORMAL_PATH_BINDING');contained(t.accountRoot,t.campaignRoot);
 const text=read(t.accountRoot,g.path);if(hash(text)!==t.reviewedRecordSha256)throw Error('FORMAL_RECORD_BINDING');const r=recordSchema.parse(JSON.parse(text));
 const wireProtocol=r.version!=='formal-pilot-launch-authority-1'?r.wireProtocol:undefined;
 if(t.pilotRoute!==(r.version==='formal-pilot-launch-authority-4'?AI_STUDIO_PILOT_RETENTION_POLICY:undefined))throw Error('FORMAL_PILOT_POLICY_BINDING');
 if(wireProtocol!==t.wireProtocol)throw Error('FORMAL_PROTOCOL_BINDING');
 for(const k of ['accountRoot','campaignRoot','evaluationCandidateSha','harnessRevisionSha','candidateProofSha256','harnessProofSha256','manifestSha256','inventoryDigest'] as const)if(r[k]!==t[k])throw Error('FORMAL_TRUST_BINDING');
 if(r.ownerMessageSha256!==t.reviewedOwnerMessageSha256||r.proposalSha256!==t.reviewedProposalSha256||hash(read(r.accountRoot,r.ownerMessagePath))!==r.ownerMessageSha256||hash(read(r.accountRoot,r.proposalPath))!==r.proposalSha256)throw Error('FORMAL_APPROVAL_BINDING');
 if(hash(read(r.accountRoot,r.debugRecordPath))!==r.debugRecordSha256)throw Error('FORMAL_DEBUG_BINDING');
 const debug=JSON.parse(read(r.accountRoot,r.debugRecordPath));
 if(wireProtocol!==debug.wireProtocol||debug.version!==(r.version==='formal-pilot-launch-authority-4'?'t11-debug-loop-authority-4':wireProtocol==='SMALL_106'?'t11-debug-loop-authority-3':wireProtocol==='TYPED_105'?'t11-debug-loop-authority-2':'t11-debug-loop-authority-1'))throw Error('FORMAL_PROTOCOL_BINDING');
 if(r.version==='formal-pilot-launch-authority-4'&&debug.privacyPolicy!==r.privacyPolicy)throw Error('FORMAL_PILOT_POLICY_BINDING');
 for(const k of ['accountRoot','campaignRoot','ownerMessagePath','ownerMessageSha256','hardCapMicrounits','accountingPolicy','model','provider','retry','fallback','stream','manifestSha256'] as const)if(debug[k]!==r[k])throw Error('FORMAL_DEBUG_BINDING');
 const proof=candidateValidationProof(root,r.evaluationCandidateSha);
 for(const k of ['evaluationCandidateSha','harnessRevisionSha','candidateProofSha256','harnessProofSha256'] as const)if(proof[k]!==r[k])throw Error('FORMAL_SOURCE_BINDING');
 const manifest=deriveBoundedPilotManifest(root);if(manifest.manifestSha256!==r.manifestSha256||manifest.maxProviderHttpRequests!==76||manifest.totalFixtures!==32||manifest.totalTurns!==84)throw Error('FORMAL_MANIFEST_BINDING');
 const p=paths(r);if(options.excluded!==undefined&&options.excluded!==p.executionDirectory)throw Error('FORMAL_EXCLUSION_SCOPE');
 if(auditCampaignAccountRoot(r.accountRoot,options.excluded).inventoryDigest!==r.inventoryDigest)throw Error('FORMAL_INVENTORY_DRIFT');
 if(!options.underLock&&existsSync(join(r.accountRoot,'account.lock')))throw Error('ACCOUNT_LOCKED');
 if(!options.owned&&(existsSync(p.proposalMarker)||existsSync(p.ownerMarker)||existsSync(p.executionDirectory)))throw Error('FORMAL_CONSUMED');
 if(!options.owned)for(const name of readdirSync(r.accountRoot).filter(n=>n.startsWith('.')&&n.endsWith('.consumed.json'))){const prior=JSON.parse(read(r.accountRoot,join(r.accountRoot,name)));if(prior.ownerMessageSha256===r.ownerMessageSha256||prior.ownerApprovalSha256===r.ownerMessageSha256)throw Error('FORMAL_CONSUMED');}
 return {record:r,...p};
}
/** Trust pins are supplied only by the reviewed direct-owner orchestration,
 * never inferred from an authority file, CLI arguments or credentials. */
export function loadFormalPilotLaunch(root:string,path:string,trust:FormalPilotTrust):FormalPilotLaunch{
 const g:Grant={root,path,trust:Object.freeze({...trust}),debug:undefined as unknown as DebugLoopAuthority};
 const {record:r}=verify(g);
 g.debug=createDebugLoopLoader({...(r.version==='formal-pilot-launch-authority-4'?{pilotRoute:AI_STUDIO_PILOT_RETENTION_POLICY}:{}),accountRoot:r.accountRoot,campaignRoot:r.campaignRoot,reviewedRecordSha256:r.debugRecordSha256,reviewedOwnerMessageSha256:r.ownerMessageSha256,...(r.version!=='formal-pilot-launch-authority-1'?{wireProtocol:r.wireProtocol}:{})})(r.debugRecordPath,root);
 inspectDebugLoop(g.debug);const a=Object.freeze({}) as FormalPilotLaunch;grants.set(a,g);return a;
}
function grant(a:FormalPilotLaunch|undefined){const g=a&&grants.get(a);if(!g)throw Error('FORMAL_AUTHORITY_REQUIRED');return g;}
export function inspectFormalPilotLaunch(a:FormalPilotLaunch|undefined){const g=grant(a),v=verify(g);inspectDebugLoop(g.debug);return {...v,paid:'AUTHORIZED_ONE_FORMAL_PILOT' as const};}
type FormalExecution={debug:DebugLoopAuthority;candidate:string;transport:SemanticTransport;beforeExecution:(directory:string)=>Promise<void>};
const activeExecutions=new WeakMap<FormalPilotLaunch,Readonly<FormalExecution>>();
const running=new WeakSet<FormalPilotLaunch>();
/** Internal bridge: the private debug key and active branded launch are both required. */
export function takeFormalPilotExecution(a:FormalPilotLaunch,key:unknown){
 if(!isFormalPilotBridgeKey(key))throw Error('FORMAL_BRIDGE_REQUIRED');
 const g=grant(a),execution=activeExecutions.get(a);
 if(!running.has(a)||!execution)throw Error('FORMAL_EXECUTION_DELEGATION_REQUIRED');
 const v=verify(g);
 if(v.record.version==='formal-pilot-launch-authority-1'||execution.debug!==g.debug||execution.candidate!==v.record.evaluationCandidateSha)throw Error('FORMAL_PROTOCOL_BINDING');
 activeExecutions.delete(a);return execution;
}
export async function runFormalPilotLaunch(a:FormalPilotLaunch|undefined,acquireCredential:()=>Promise<string>){
 const g=grant(a),initial=verify(g);inspectDebugLoop(g.debug);
 if(running.has(a!))throw Error('FORMAL_EXECUTION_IN_PROGRESS');running.add(a!);
 let key:string|undefined,executionDirectory:string|undefined,physicalProviderHttpAttempts=0;
 try{
  const loader=await import('./register-conversation-loader.mjs');const loaded=()=>loader.assertLoadedCandidateModules(g.root,initial.record.evaluationCandidateSha,initial.record.harnessRevisionSha);loaded();
  const execution:Readonly<FormalExecution>=Object.freeze({debug:g.debug,candidate:initial.record.evaluationCandidateSha,transport:async(request,options)=>{
   if(!key||!executionDirectory)throw Error('FORMAL_CREDENTIAL_FENCE');
   verify(g,{underLock:true,owned:true,excluded:executionDirectory});loaded();
   let fetched=false;return createContextHttpTransport(key,async(url,init)=>{if(fetched)throw Error('FORMAL_PHYSICAL_HTTP_FENCE');fetched=true;physicalProviderHttpAttempts++;return fetch(url,{...init,redirect:'error'});})(request,options);
  },beforeExecution:async directory=>{
   const v=verify(g,{underLock:true});loaded();if(directory!==v.executionDirectory)throw Error('FORMAL_EXECUTION_BINDING');
   appendCandidateValidationRecord(v.record.accountRoot,v.proposalMarker,{ownerMessageSha256:v.record.ownerMessageSha256,proposalSha256:v.record.proposalSha256,recordSha256:g.trust.reviewedRecordSha256});
   appendCandidateValidationRecord(v.record.accountRoot,v.ownerMarker,{ownerMessageSha256:v.record.ownerMessageSha256,proposalSha256:v.record.proposalSha256,recordSha256:g.trust.reviewedRecordSha256});
   executionDirectory=directory;key=await acquireCredential();
   if(!key||/[\r\n]/u.test(key))throw Error('CREDENTIAL_INVALID');
   verify(g,{underLock:true,owned:true});loaded();
  }});
  if(initial.record.version!=='formal-pilot-launch-authority-1')activeExecutions.set(a!,execution);
  const result=initial.record.version!=='formal-pilot-launch-authority-1'
   ? await runFormalPilotDebugExecution(a!)
   : await runDebugLoopExecution(g.debug,execution.candidate,'FORMAL_PILOT',execution.transport,{beforeExecution:execution.beforeExecution});
  return {...result,physicalProviderHttpAttempts};
 }finally{activeExecutions.delete(a!);running.delete(a!);key=undefined;}
}

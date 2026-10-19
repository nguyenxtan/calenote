/** Read-only proposal preparation. This descriptor is never paid authority. */
import {createHash} from 'node:crypto';
import {readFileSync,readdirSync,lstatSync,existsSync,realpathSync} from 'node:fs';
import {isAbsolute,relative,join} from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {fileURLToPath} from 'node:url';
import {candidateValidationProof} from './context-contract-candidate-validation';
import {auditCampaignAccountRoot} from './context-contract-live';
import {inspectConservativeDebugCost} from './context-confirmed-cost';
import {deriveBoundedPilotManifest} from './context-bounded-pilot';
import {contextCampaignMaximumReservation} from './context-contract-runner';
import {CONTEXT_TYPED_PROTOCOL_V3} from '../../src/modules/conversation/context-contract/typed-protocol';
import {CONTEXT_TYPED_PROMPT} from '../../src/modules/conversation/context-contract/typed-prompt';
import {InterpretationJsonSchema} from '../../src/modules/conversation/context-contract/contracts';
const hash=(value:string|Uint8Array)=>createHash('sha256').update(value).digest('hex');
function checkRoot(root:string){if(realpathSync(root)!==root||realpathSync(process.cwd())!==root||fileURLToPath(new URL('../../',import.meta.url)).replace(/\/$/u,'')!==root)throw Error('PREPARATION_EXECUTING_ROOT');}
function lifecycle(accountRoot:string){return readdirSync(accountRoot).filter(name=>name.startsWith('.')&&name.endsWith('.json')).sort().map(name=>{
 const path=join(accountRoot,name),stat=lstatSync(path);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>65536)throw Error('PREPARATION_LIFECYCLE_BINDING');return {name,sha256:hash(readFileSync(path))};
});}
export function prepareTypedFormalPilot(root:string,evaluationCandidateSha:string,accountRoot:string,campaignRoot:string){
 // Preparation is read-only. Immutable source proof below binds the caller's
 // exact candidate; a historical preparation SHA is not a standing grant.
 checkRoot(root);if(!/^[a-f0-9]{40}$/u.test(evaluationCandidateSha))throw Error('PREPARATION_CANDIDATE_BINDING');
 const path=relative(accountRoot,campaignRoot);
 if(!isAbsolute(accountRoot)||realpathSync(accountRoot)!==accountRoot||!isAbsolute(campaignRoot)||!path||path.startsWith('..')||isAbsolute(path)||realpathSync(campaignRoot)!==campaignRoot)throw Error('PREPARATION_PATH_BINDING');
 if(existsSync(join(accountRoot,'account.lock')))throw Error('PREPARATION_ACCOUNT_LOCKED');
 const proof=candidateValidationProof(root,evaluationCandidateSha),inventory=auditCampaignAccountRoot(accountRoot),manifest=deriveBoundedPilotManifest(root);
 if(!inventory.bindings.some(binding=>binding.directory===join(campaignRoot,'PILOT')))throw Error('PREPARATION_HISTORY_BINDING');
 if(manifest.maxProviderHttpRequests!==76||manifest.totalFixtures!==32||manifest.totalTurns!==84)throw Error('PREPARATION_MANIFEST_BINDING');
 const accounting=inspectConservativeDebugCost(accountRoot,10000000,contextCampaignMaximumReservation);
 const lifecycleSnapshot=lifecycle(accountRoot);
 return {version:'formal-pilot-preparation-105-1' as const,status:'PREPARED_HOLD' as const,paid:'HOLD' as const,mode:'FORMAL_PILOT' as const,executions:1 as const,
  root,accountRoot,campaignRoot,...proof,wireProtocol:'TYPED_105' as const,protocol:CONTEXT_TYPED_PROTOCOL_V3,promptSha256:hash(CONTEXT_TYPED_PROMPT),canonicalSchemaSha256:hash(JSON.stringify(InterpretationJsonSchema)),
  typedCodecSha256:hash(readFileSync(join(root,'src/modules/intelligence/infrastructure/openrouter/context-provider-typed-wire.ts'))),
  inventoryDigest:inventory.inventoryDigest,historyCount:inventory.bindings.length,lifecycleSnapshot,lifecycleSha256:hash(JSON.stringify(lifecycleSnapshot)),accounting,
  ...manifest,hardCapMicrounits:10000000 as const,accountingPolicy:'CONSERVATIVE_DEBUG_V1' as const,model:'google/gemini-2.5-flash-lite' as const,provider:'google-vertex/eu' as const,
  retry:0 as const,fallback:'none' as const,stream:false as const,timeCeilingMinutes:20 as const,maximumRequestExposureMicrounits:contextCampaignMaximumReservation,
  formalSatisfiedTurns:0 as const,formalRemainingTurns:manifest.totalTurns,fullStarted:false as const,deployed:false as const,
  paidAuthorityCreated:false as const,credentialChecked:false as const,providerAdmission:'UNVERIFIED' as const,
  requiredBeforeExecution:['FRESH_DIRECT_OWNER_APPROVAL','REVIEWED_AUTHORITY_V2_AND_TRUST_PINS','REVALIDATE_SOURCE_HARNESS_HISTORY_AND_CAP','KEYCHAIN_KEY_AND_QUOTA_PREFLIGHT'] as const};
}
/** Exact shape/bytes are rederived; adding authorization labels cannot grant rights. */
export function inspectTypedFormalPilotPreparation(root:string,raw:unknown){
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('PREPARATION_SHAPE');
 const value=raw as Record<string,unknown>;
 if(typeof value.evaluationCandidateSha!=='string'||typeof value.accountRoot!=='string'||typeof value.campaignRoot!=='string')throw Error('PREPARATION_SHAPE');
 const expected=prepareTypedFormalPilot(root,value.evaluationCandidateSha,value.accountRoot,value.campaignRoot);
 if(!isDeepStrictEqual(raw,expected))throw Error('PREPARATION_DRIFT');return expected;
}

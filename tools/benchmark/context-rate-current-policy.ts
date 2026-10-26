/** Current-source completion policy only; neither data nor this module is paid authority. */
import {createHash} from 'node:crypto';
import type {RateBatchBudget} from './context-rate-batch';
const descriptor={version:'RATE_AWARE_CURRENT_V3' as const,attemptCap:250000,phaseBaseline:7767153,phaseCap:500000,minBaseline:7878194,minUnknown:65,runs:1,requests:76,batchRequests:76,runMs:2700000,batchMs:5400000,spacing:15000,jitter:3000,cooldown:900000,maxCooldown:1800000};
export const CURRENT_RATE_SCOPE=Object.freeze({...descriptor,scopeDigest:createHash('sha256').update(JSON.stringify(descriptor)).digest('hex')});
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
export function createCurrentRateBudget(raw:unknown):Readonly<RateBatchBudget>{
 if(!record(raw)||Object.keys(raw).length!==2||!Object.hasOwn(raw,'baseline')||!Object.hasOwn(raw,'unknown'))throw Error('RATE_CURRENT_SCOPE');
 const {baseline,unknown}=raw,c=CURRENT_RATE_SCOPE;
 if(typeof baseline!=='number'||!Number.isSafeInteger(baseline)||baseline<c.minBaseline||typeof unknown!=='number'||!Number.isSafeInteger(unknown)||unknown<c.minUnknown)throw Error('RATE_CURRENT_BASELINE');
 if(baseline+c.attemptCap>10000000||baseline+c.attemptCap-c.phaseBaseline>c.phaseCap)throw Error('RATE_PHASE_CAP');
 return Object.freeze({baseline,unknown,subcap:c.attemptCap,runs:c.runs,batchMs:c.batchMs,phaseEnvelope:true});
}
/** The current recovery workflow has no legacy-normal fallback or raw timing override. */
export function requireCurrentPacedMode(raw:unknown):'RATE_AWARE_CURRENT_V3'{
 if(!record(raw)||Object.keys(raw).length!==3||raw.mode!==CURRENT_RATE_SCOPE.version||raw.provider!=='google-ai-studio'||raw.sharedPoolParent!==true)throw Error('RATE_CURRENT_PACED_REQUIRED');
 return CURRENT_RATE_SCOPE.version;
}

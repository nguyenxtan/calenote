import {isRateAwareBridgeKey} from './context-rate-launcher';
import type {RateBatchController} from './context-rate-batch';
const brand:unique symbol=Symbol('RateExecution');export interface RateExecution{readonly [brand]:true}
export interface RateExecutionBinding{directory:string;provenanceDigest:string;manifestSha256:string;targets:ReadonlyArray<{fixtureId:string;turnIndex:number}>}
const executions=new WeakMap<object,{controller:RateBatchController;recordDigest:string;ordinal:number;startedAt:number;binding:Readonly<RateExecutionBinding>;next:number}>();
/** Only the private validated launcher bridge can mint a child timing token. */
export function createRateExecution(controller:RateBatchController,key:unknown,binding:RateExecutionBinding):RateExecution{
 if(!isRateAwareBridgeKey(key))throw Error('RATE_EXECUTION_BRIDGE');
 const c=controller.executionState(),a=Object.freeze({}) as RateExecution;executions.set(a,{controller,recordDigest:c.recordDigest,ordinal:c.ordinal,startedAt:c.startedAt,binding:Object.freeze({...binding,targets:Object.freeze(binding.targets.map(t=>Object.freeze({...t})))}),next:0});return a;
}
export function rateExecutionState(a:RateExecution){const b=a&&executions.get(a);if(!b)throw Error('RATE_EXECUTION_REQUIRED');const c=b.controller.executionState();if(c.recordDigest!==b.recordDigest||c.ordinal!==b.ordinal||c.startedAt!==b.startedAt)throw Error('RATE_EXECUTION_DRIFT');return {...c,directory:b.binding.directory,provenanceDigest:b.binding.provenanceDigest,manifestSha256:b.binding.manifestSha256};}
export function closeRateExecution(a:RateExecution,key:unknown){if(!isRateAwareBridgeKey(key))throw Error('RATE_EXECUTION_BRIDGE');executions.delete(a);}

export async function awaitRateExecutionAdmission(a:RateExecution,target:{fixtureId:string;turnIndex:number},id:string){rateExecutionState(a);const b=executions.get(a)!;if(JSON.stringify(target)!==JSON.stringify(b.binding.targets[b.next])||id!==`call-${b.next+1}`)throw Error('RATE_EXECUTION_TARGET');await b.controller.beforeClaim(id);b.next++;}
export function rateExecutionCanCredit(a:RateExecution){rateExecutionState(a);return executions.get(a)!.controller.canCredit();}

export type ComparisonClockSample={wallMs:number;monotonicMs:number};
export class ComparisonContinuityError extends Error {
 constructor(){super('SUSPEND_SUSPECTED');this.name='ComparisonContinuityError';}
}
/** Harness clock continuity only; never affects model input or business time. */
export function createComparisonContinuityGuard(sample:()=>ComparisonClockSample=()=>({wallMs:Date.now(),monotonicMs:performance.now()}),maximumDivergenceMs=30000):()=>void {
 const valid=(value:ComparisonClockSample)=>Number.isFinite(value.wallMs)&&Number.isFinite(value.monotonicMs);
 let previous=sample();if(!Number.isFinite(maximumDivergenceMs)||maximumDivergenceMs<=0||!valid(previous))throw Error('COMPARISON_CLOCK_INVALID');
 return ()=>{const current=sample();if(!valid(current))throw Error('COMPARISON_CLOCK_INVALID');const divergence=(current.wallMs-previous.wallMs)-(current.monotonicMs-previous.monotonicMs);previous=current;if(Math.abs(divergence)>maximumDivergenceMs)throw new ComparisonContinuityError();};
}

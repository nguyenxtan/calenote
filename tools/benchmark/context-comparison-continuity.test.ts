// @vitest-environment node
import {expect,it} from 'vitest';
import {createComparisonContinuityGuard} from './context-comparison-continuity';
it('accepts a normal long HTTP wait when wall and monotonic clocks agree',()=>{
 const samples=[{wallMs:1000,monotonicMs:100},{wallMs:46000,monotonicMs:45100},{wallMs:64000,monotonicMs:63100}];
 const check=createComparisonContinuityGuard(()=>samples.shift()!);expect(check).not.toThrow();expect(check).not.toThrow();
});
it('refuses a sleep-sized wall-clock gap before the next dispatch',()=>{
 const samples=[{wallMs:1000,monotonicMs:100},{wallMs:945000,monotonicMs:1100}];
 const check=createComparisonContinuityGuard(()=>samples.shift()!);expect(check).toThrow('SUSPEND_SUSPECTED');
});
it('refuses a large backwards wall-clock change and invalid probe configuration',()=>{
 const samples=[{wallMs:100000,monotonicMs:100},{wallMs:1000,monotonicMs:1100}];expect(createComparisonContinuityGuard(()=>samples.shift()!)).toThrow('SUSPEND_SUSPECTED');
 for(const limit of [0,-1,NaN,Infinity])expect(()=>createComparisonContinuityGuard(()=>({wallMs:0,monotonicMs:0}),limit)).toThrow('COMPARISON_CLOCK_INVALID');
 expect(()=>createComparisonContinuityGuard(()=>({wallMs:NaN,monotonicMs:0}))).toThrow('COMPARISON_CLOCK_INVALID');
});

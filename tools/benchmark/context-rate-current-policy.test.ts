// @vitest-environment node
import {it,expect} from 'vitest';
import {CURRENT_RATE_SCOPE,createCurrentRateBudget,requireCurrentPacedMode} from './context-rate-current-policy';
import {RATE_POLICY} from './context-rate-policy';
it('current scope carries tested pacing with one narrower attempt and fixed outer phase envelope',()=>{
 expect(CURRENT_RATE_SCOPE).toMatchObject({version:'RATE_AWARE_CURRENT_V3',attemptCap:250000,phaseBaseline:7767153,phaseCap:500000,minBaseline:7878194,minUnknown:65,runs:1,requests:76,batchRequests:76,runMs:2700000,batchMs:5400000,spacing:15000,jitter:3000,cooldown:900000,maxCooldown:1800000});
 expect(CURRENT_RATE_SCOPE.scopeDigest).toMatch(/^[a-f0-9]{64}$/u);
 const budget=createCurrentRateBudget({baseline:7878194,unknown:65});expect(budget).toEqual({baseline:7878194,unknown:65,subcap:250000,runs:1,batchMs:5400000,phaseEnvelope:true});expect(Object.isFrozen(budget)).toBe(true);
});
it('does not turn missing current pacing authority into normal fast execution',()=>{
 expect(requireCurrentPacedMode({mode:'RATE_AWARE_CURRENT_V3',provider:'google-ai-studio',sharedPoolParent:true})).toBe('RATE_AWARE_CURRENT_V3');
 for(const raw of [{mode:'NORMAL20',provider:'google-ai-studio',sharedPoolParent:true},{mode:'RATE_AWARE_FRESH_V2',provider:'google-ai-studio',sharedPoolParent:true},{mode:'RATE_AWARE_CURRENT_V3',provider:'other',sharedPoolParent:true},{mode:'RATE_AWARE_CURRENT_V3',provider:'google-ai-studio',sharedPoolParent:false},{mode:'RATE_AWARE_CURRENT_V3',provider:'google-ai-studio',sharedPoolParent:true,fallback:'NORMAL20'}])expect(()=>requireCurrentPacedMode(raw)).toThrow();
});
it('cannot reset UNKNOWN or phase baseline or widen the current attempt through extra input',()=>{
 for(const v of [{baseline:7878194,unknown:64},{baseline:7767153,unknown:65},{baseline:7878194.5,unknown:65},{baseline:7878194,unknown:65,runs:2},{baseline:7878194,unknown:65,subcap:500000},{baseline:7878194,unknown:65,phaseBaseline:7878194},{baseline:8100000,unknown:66}])expect(()=>createCurrentRateBudget(v)).toThrow();
 expect(createCurrentRateBudget({baseline:8017153,unknown:66}).baseline).toBe(8017153);expect(()=>createCurrentRateBudget({baseline:8017154,unknown:66})).toThrow('RATE_PHASE_CAP');
});
it('legacy V2 source/budget/timing constants remain frozen unchanged',()=>{
 expect(Object.isFrozen(RATE_POLICY)).toBe(true);expect(RATE_POLICY).toMatchObject({version:'RATE_AWARE_FRESH_V2',app:'13804ae8962852cc1e9108d0d166e4ade90e511d',baseline:7767153,unknown:64,subcap:500000,runs:2,batchRequests:152,runMs:2700000,batchMs:10800000,spacing:15000,jitter:3000});
});

import {mkdtempSync,realpathSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {RateBatchController,readRateBatchJournal} from './context-rate-batch';import {parseRateHint} from './context-rate-policy';
function currentController(baseline=7878194){const root=realpathSync(mkdtempSync(join(tmpdir(),'current-rate-budget-')));let wall=1800000000000,mono=1000,retained=baseline,unknown=65;const directory=join(root,'batch'),c=new RateBatchController({accountRoot:root,directory,recordDigest:'a'.repeat(64),budget:createCurrentRateBudget({baseline,unknown}),clock:()=>({wall,mono}),wait:async ms=>{wall+=ms;mono+=ms;},jitter:()=>0,verify:()=>({retained,unknown}),signal:new AbortController().signal});return {c,directory,start:()=>c.startRun(wall-900000,parseRateHint(undefined,wall-900000)),set:(v:number,u=65)=>{retained=v;unknown=u;},cleanup:()=>rmSync(root,{recursive:true,force:true})};}
it('current controller cannot create a second child despite legacy V2 allowing two',async()=>{const s=currentController();try{await s.start();s.c.finishRun(true);await expect(s.start()).rejects.toThrow('RATE_RUN_LIMIT');}finally{s.cleanup();}});
it('current attempt reserve cap is enforced before any next claim',async()=>{const s=currentController();try{await s.start();s.set(8022723);await expect(s.c.beforeClaim('call-1')).rejects.toThrow('RATE_SUBCAP');expect(readRateBatchJournal(s.directory).some(x=>x.event==='CLAIM')).toBe(false);}finally{s.cleanup();}});
it('phase growth is not reset by a later higher attempt baseline',async()=>{const s=currentController(8017153);try{await s.start();s.set(8170000);await expect(s.c.beforeClaim('call-1')).rejects.toThrow('RATE_PHASE_CAP');expect(readRateBatchJournal(s.directory).some(x=>x.event==='CLAIM')).toBe(false);}finally{s.cleanup();}});
it('current UNKNOWN baseline cannot decrease to legacy64',async()=>{const s=currentController();try{await s.start();s.set(7878194,64);await expect(s.c.beforeClaim('call-1')).rejects.toThrow('RATE_BASELINE');}finally{s.cleanup();}});

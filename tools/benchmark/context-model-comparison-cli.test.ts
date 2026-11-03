// @vitest-environment node
import {execFileSync} from 'node:child_process';
import {expect,it} from 'vitest';
it('preflights the complete frozen Pilot corpus without credentials or network dispatch',()=>{
 const env={...process.env};Reflect.deleteProperty(env,'OPENROUTER_API_KEY');
 const output=execFileSync(process.execPath,['--experimental-transform-types','--import','./tools/benchmark/register-typescript-loader.mjs','tools/benchmark/run-context-model-comparison.mjs'],{env,encoding:'utf8',timeout:20000});
 expect(JSON.parse(output)).toMatchObject({status:'PREFLIGHT_ONLY',approvedLifetimeLimitUsd:1,kind:'SYNTHETIC_MODEL_COMPARISON_NOT_FORMAL_PILOT',scripts:32,turns:84,maxRequests:76,maxAdditionalUsd:.95,zdr:true,model:'openai/gpt-5-mini',maximumPerRequestUsd:.116759});
 const explicit=execFileSync(process.execPath,['--experimental-transform-types','--import','./tools/benchmark/register-typescript-loader.mjs','tools/benchmark/run-context-model-comparison.mjs','--approved-key-ceiling=2'],{env,encoding:'utf8',timeout:20000});
 expect(JSON.parse(explicit)).toMatchObject({status:'PREFLIGHT_ONLY',approvedLifetimeLimitUsd:2,maxAdditionalUsd:.95,scripts:32,zdr:true});
});

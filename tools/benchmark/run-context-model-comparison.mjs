import {parseJsonWithoutDuplicateMembers} from '../../src/modules/intelligence/infrastructure/openrouter/strict-json.ts';
/** Explicit, synthetic-only comparison; never a historical Formal Pilot or deployment. */
import {readFileSync,writeFileSync,appendFileSync,mkdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createContextHttpTransport} from '../../src/modules/intelligence/infrastructure/openrouter/semantic-gateway.ts';
import {CONTEXT_KEYED_COMPARISON_PROTOCOL} from '../../src/modules/conversation/context-contract/keyed-small-wire.ts';
import {createGptMiniComparisonGateway,createGptMiniMediumComparisonGateway,GPT_MINI_MEDIUM_COMPARISON,createFlashComparisonGateway,createGpt41ComparisonGateway,GPT_MINI_COMPARISON,FLASH_COMPARISON,GPT41_COMPARISON,NANO54_COMPARISON,createNano54ComparisonGateway,MINI54_FLEX_COMPARISON,createMini54FlexComparisonGateway,MINI54_AZURE_COMPARISON,createMini54AzureComparisonGateway} from './context-model-comparison-gateway.ts';
import {admitCanonicalCampaign,diagnoseContextTurn,scoreContextCampaign,scoreContextAction} from './context-contract.ts';
import {runContextFixtureCampaign} from './context-contract-probe.ts';
import {frozenContextProposal} from './context-contract-fixtures.ts';
import {admitComparisonKey} from './context-comparison-key.ts';
import {createComparisonContinuityGuard,ComparisonContinuityError} from './context-comparison-continuity.ts';
import {comparisonGenerationFailure} from './context-comparison-response.ts';

process.chdir(fileURLToPath(new URL('../../',import.meta.url)));
const args=process.argv.slice(2),medium=args.includes('--profile=gpt5medium'),flash=args.includes('--profile=flash'),flex=args.includes('--profile=mini54flex'),miniAzure=args.includes('--profile=mini54azure'),nano=args.includes('--profile=nano54'),gpt5=!miniAzure&&!flex&&!nano&&!flash&&!args.includes('--profile=gpt41'),comparison=medium?GPT_MINI_MEDIUM_COMPARISON:miniAzure?MINI54_AZURE_COMPARISON:flex?MINI54_FLEX_COMPARISON:nano?NANO54_COMPARISON:flash?FLASH_COMPARISON:gpt5?GPT_MINI_COMPARISON:GPT41_COMPARISON,selected=args.find(a=>a.startsWith('--fixture='))?.slice(10);
const approvedLifetimeLimitUsd=args.includes('--approved-key-ceiling=2')?2:1;
if(args.filter(a=>a.startsWith('--approved-key-ceiling=')).length>1)throw Error('ONE_APPROVED_CEILING_ONLY');
if(args.filter(a=>a.startsWith('--profile=')).length>1)throw Error('ONE_EXPLICIT_PROFILE_ONLY');
if(args.some(a=>a!=='--live'&&a!=='--approved-key-ceiling=2'&&a!=='--profile=flash'&&a!=='--profile=gpt5'&&a!=='--profile=gpt5medium'&&a!=='--profile=gpt41'&&a!=='--profile=nano54'&&a!=='--profile=mini54flex'&&a!=='--profile=mini54azure'&&!/^--fixture=R\d{2}$/.test(a)))throw Error('USAGE: [--live] [--approved-key-ceiling=2] [--fixture=R01] [--profile=gpt5|gpt5medium|gpt41|flash|nano54|mini54flex|mini54azure]');
const corpus={version:'context-contract-corpus-1',cases:['regressions','development','heldout'].flatMap(n=>JSON.parse(readFileSync(`src/modules/conversation/context-contract/benchmark/${n}.json`,'utf8')).cases)};
const planned=admitCanonicalCampaign(corpus,'PILOT').filter(s=>!selected||s.executionId===selected).sort((a,b)=>a.id.localeCompare(b.id)||a.executionId.localeCompare(b.executionId));
if(!planned.length)throw Error('EMPTY_CAMPAIGN');
const baseSha=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
function digest(){
 const paths=execFileSync('git',['ls-files','-c','-o','--exclude-standard','--','src','tools/benchmark'],{encoding:'utf8'}).trim().split('\n').filter(Boolean);
 return createHash('sha256').update(JSON.stringify([...new Set(paths)].sort().map(p=>[p,createHash('sha256').update(readFileSync(p)).digest('hex')]))).digest('hex');
}
const sourceDigest=digest(),maxRequests=76,maxAdditionalUsd=.95,deadlineMs=(comparison.timeoutMs>30000?60:30)*60*1000;
const scope={clockGuard:{kind:'WALL_VS_MONOTONIC',maximumDivergenceMs:30000},approvedLifetimeLimitUsd,kind:'SYNTHETIC_MODEL_COMPARISON_NOT_FORMAL_PILOT',profile:medium?'GPT5_MINI_MEDIUM_AZURE_SWEDEN_ZDR_KEYED_136':miniAzure?'GPT54_MINI_AZURE_ZDR_REGION_UNEXPOSED_SYNTHETIC_KEYED_136':flex?'GPT54_MINI_OPENAI_FLEX_NON_EU_NON_ZDR_SYNTHETIC_KEYED_136':nano?'GPT54_NANO_AZURE_ZDR_REGION_UNEXPOSED_SYNTHETIC_KEYED_136':flash?'GEMINI_FLASH_AI_STUDIO_KEYED_136':gpt5?'GPT5_MINI_LOW_AZURE_SWEDEN_ZDR_KEYED_136':'GPT41_MINI_AZURE_SWEDEN_ZDR_KEYED_136',model:comparison.model,provider:comparison.provider,zdr:comparison.requireZdr,configuredRegion:comparison.provider==='azure/swedencentral'?'EU_SWEDEN':'UNEXPOSED',codec:CONTEXT_KEYED_COMPARISON_PROTOCOL,baseSha,sourceDigest,limits:{maxInputTokens:comparison.maxInputTokens,maxOutputTokens:comparison.maxOutputTokens,maxResponseBytes:comparison.maxResponseBytes,timeoutMs:comparison.timeoutMs},scripts:planned.length,turns:planned.reduce((n,s)=>n+s.turns.length,0),maxRequests,maxAdditionalUsd,maximumPerRequestUsd:comparison.maximumCostMicrounits/1e6,deadlineMs,stopOnFirstOracleFailure:true,executionOrder:'GROUP_REPEATS_FOR_PREFIX_CACHING',executionIds:planned.map(s=>s.executionId)};
if(!args.includes('--live')){console.log(JSON.stringify({status:'PREFLIGHT_ONLY',...scope}));process.exit(0);}
const key=process.env.OPENROUTER_API_KEY;
if(!key)throw Error('INFERENCE_KEY_REQUIRED');
// A new run cannot silently reset the server-enforced lifetime key limit.
const keyResponse=await fetch('https://openrouter.ai/api/v1/key',{headers:{Authorization:`Bearer ${key}`},signal:AbortSignal.timeout(15000),redirect:'error'});
if(!keyResponse.ok)throw Error('KEY_PREFLIGHT_FAILED');
const {data:keyData}=await keyResponse.json();
const keyCap=admitComparisonKey(keyData,scope.maximumPerRequestUsd,approvedLifetimeLimitUsd);
if(keyCap.remaining<scope.maximumPerRequestUsd)throw Error('INSUFFICIENT_ROUTE_RESERVATION');
const directory=`/tmp/calenote-model-comparison-${Date.now()}`;
mkdirSync(directory,{mode:0o700});
const save=(name,value)=>writeFileSync(`${directory}/${name}`,JSON.stringify(value,null,2),{mode:0o600});
const ledger=event=>appendFileSync(`${directory}/accounting.jsonl`,JSON.stringify({...event,at:new Date().toISOString()})+'\n',{mode:0o600});
save('scope.json',{...scope,keyLimitUsd:keyCap.limit,keyRemainingAtStartUsd:keyCap.remaining});
let calls=0,previous=0,knownUsd=0,unknownUsd=0;
const begunAt=Date.now(),reserve=scope.maximumPerRequestUsd;
const underlying=createContextHttpTransport(key,fetch,comparison.maxResponseBytes);
const continuity=createComparisonContinuityGuard();let infrastructureStop=null,generationStop=null;
const checkContinuity=stage=>{try{continuity();}catch(error){infrastructureStop=error instanceof ComparisonContinuityError?'SUSPEND_SUSPECTED':'COMPARISON_CLOCK_INVALID';ledger({event:'INFRA_STOP',stage,reason:infrastructureStop});throw error;}};
const transport=async(request,options)=>{
 checkContinuity('BEFORE_DISPATCH');
 if(calls>=maxRequests||Date.now()-begunAt>deadlineMs)throw Error('RUN_LIMIT');
 if(digest()!==sourceDigest)throw Error('SOURCE_CHANGED');
 if(knownUsd+unknownUsd+reserve>Math.min(maxAdditionalUsd,keyCap.remaining))throw Error('RUN_BUDGET');
 const call=++calls;previous=Date.now();
 ledger({event:'RESERVE',call,maximumUsd:reserve});
 let settled=false;
 try{
  const response=await underlying(request,options);
  let billed=null;
  try{const envelope=parseJsonWithoutDuplicateMembers(response.body),cost=envelope.usage?.cost;if(typeof cost==='number'&&Number.isFinite(cost)&&cost>=0)billed=cost;if(response.status===200)generationStop??=comparisonGenerationFailure(envelope);}catch{}
  if(billed===null)unknownUsd+=reserve;else knownUsd+=billed;
  ledger({event:'SETTLE',call,observedUsd:billed,unknownReservedUsd:billed===null?reserve:0,knownUsd,unknownUsd});settled=true;
  // Bounded HTTP boundary has already removed credentials and limited body bytes.
  save(`exchange-${call}.json`,{request,...response,body:response.body.replaceAll(key,'[REDACTED]')});
  if(generationStop)ledger({event:'GENERATION_STOP',call,reason:generationStop});
  checkContinuity('AFTER_RESPONSE');return response;
 }catch{
  if(!infrastructureStop){try{checkContinuity('AFTER_EXCEPTION');}catch{}}
  infrastructureStop??=options.signal.aborted?'ABORTED':'TRANSPORT_EXCEPTION';
  if(!settled){unknownUsd+=reserve;ledger({event:'UNKNOWN',call,kind:infrastructureStop,unknownReservedUsd:reserve,knownUsd,unknownUsd});}
  throw Error('COMPARISON_TRANSPORT_FAILED');
 }
};
const rawGateway=(medium?createGptMiniMediumComparisonGateway:miniAzure?createMini54AzureComparisonGateway:flex?createMini54FlexComparisonGateway:nano?createNano54ComparisonGateway:flash?createFlashComparisonGateway:gpt5?createGptMiniComparisonGateway:createGpt41ComparisonGateway)(transport,'SYNTHETIC_MODEL_COMPARISON_ONLY');
const gateway={...rawGateway,prepare(tier,input){const attempt=rawGateway.prepare(tier,input);if(attempt.status!=='READY')return attempt;return {...attempt,async dispatch(){if(previous)await new Promise(r=>setTimeout(r,Math.max(0,18000-(Date.now()-previous))));return attempt.dispatch();}};}};
try{
 const observations=await runContextFixtureCampaign(planned,{sourceSha:baseSha,referenceNow:Date.parse('2026-09-28T03:00:00Z'),wireProtocol:'SMALL_106',liveBudgetProfile:medium?'GPT5_MINI_MEDIUM_AZURE_SWEDEN':miniAzure?'MINI54_AZURE_ZDR_SYNTHETIC':flex?'MINI54_FLEX_SYNTHETIC':nano?'NANO54_AZURE_ZDR_SYNTHETIC':flash?'GEMINI_FLASH_AI_STUDIO':gpt5?'GPT5_MINI_AZURE_SWEDEN':'GPT41_MINI_AZURE_SWEDEN'},frozenContextProposal,{gateway,async onAction(script,index,actionIndex,actual){const proof=scoreContextAction(script.turns[index].actionsAfter[actionIndex],actual);save(`action-${script.executionId}-${index}-${actionIndex}.json`,{proof,actual});if(!proof.passed||proof.unsafe)throw Error('ACTION_ORACLE_FAILED');},async onTurn(script,index,actual){const diagnostics=diagnoseContextTurn(script.turns[index],actual,true);save(`turn-${script.executionId}-${index}.json`,{diagnostics,actual});console.log(JSON.stringify({fixture:script.executionId,turn:index,status:actual.status,calls,diagnostics}));if(!diagnostics.passed)throw Error('ORACLE_FAILED');}});
 const score=scoreContextCampaign(planned,observations);
 if(score.failedScripts.length||planned.length===32&&score.gate!=='PASS'||digest()!==sourceDigest)throw Error('FINAL_ORACLE_FAILED');
 save('result.json',{status:'PASS',score,calls,knownUsd,unknownUsd,sourceDigest});
 console.log(JSON.stringify({status:'PASS',directory,calls,knownUsd,unknownUsd}));
}catch(error){save('result.json',{status:'STOP',classification:infrastructureStop?'INFRASTRUCTURE':generationStop?'GENERATION':'ORACLE',reason:infrastructureStop??generationStop??error.message,calls,knownUsd,unknownUsd,sourceDigest});console.log(JSON.stringify({status:'STOP',classification:infrastructureStop?'INFRASTRUCTURE':generationStop?'GENERATION':'ORACLE',reason:infrastructureStop??generationStop??error.message,directory,calls,knownUsd,unknownUsd}));process.exitCode=1;}

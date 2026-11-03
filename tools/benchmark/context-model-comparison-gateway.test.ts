// @vitest-environment node
import {readFileSync} from 'node:fs';
import {expect,it,vi} from 'vitest';
import {ContextInputSchema,ConversationInterpretationV3Schema} from '../../src/modules/conversation/context-contract/contracts';
import {frozenContextProposal} from './context-contract-fixtures';
import {encodeKeyedSmallComparison} from '../../src/modules/intelligence/infrastructure/openrouter/context-provider-keyed-small-wire';
import {createGptMiniComparisonGateway,createGptMiniMediumComparisonGateway,createFlashComparisonGateway,createGpt41ComparisonGateway,createNano54ComparisonGateway,createMini54FlexComparisonGateway} from './context-model-comparison-gateway';
const input=ContextInputSchema.parse(JSON.parse(readFileSync(new URL('../../src/modules/intelligence/infrastructure/openrouter/__fixtures__/typed105-r01-before.json',import.meta.url),'utf8')).input);
const scope='SYNTHETIC_MODEL_COMPARISON_ONLY' as const;
it('emits the provider-supported union dialect without changing typed alternative semantics',async()=>{
 let schema:unknown;
 const attempt=createGptMiniComparisonGateway(async request=>{schema=request.response_format.json_schema.schema;return {status:200,body:JSON.stringify(body())};},scope).prepare('PRIMARY',input);if(attempt.status!=='READY')throw Error('EXPECTED_READY');
 expect(await attempt.dispatch()).toMatchObject({status:'SUCCESS'});expect(JSON.stringify(schema)).not.toContain('"oneOf":');
});
it('bounds an explicit medium-reasoning comparison on the same EU/ZDR route',async()=>{
 const attempt=createGptMiniMediumComparisonGateway(async(request)=>{
  expect(request).toMatchObject({model:'openai/gpt-5-mini',max_completion_tokens:4096,reasoning:{effort:'medium',exclude:true},provider:{only:['azure/swedencentral'],zdr:true,allow_fallbacks:false}});
  return {status:200,body:JSON.stringify(body())};
 },scope).prepare('PRIMARY',input);expect(attempt).toMatchObject({status:'READY',maximumCostMicrounits:119012});if(attempt.status!=='READY')throw Error('EXPECTED_READY');expect(await attempt.dispatch()).toMatchObject({status:'SUCCESS'});
});
it('keeps the explicitly authorized synthetic flex comparison outside the ZDR/EU claim',async()=>{
 const attempt=createMini54FlexComparisonGateway(async request=>{
  expect(request).toMatchObject({model:'openai/gpt-5.4-mini',service_tier:'flex',max_tokens:1536,reasoning:{effort:'none',exclude:true},seed:113,provider:{only:['openai/flex'],allow_fallbacks:false,max_price:{prompt:.375,completion:2.25}}});expect(request.provider).not.toHaveProperty('zdr');expect(request).not.toHaveProperty('max_completion_tokens');
  return {status:200,body:JSON.stringify({...body(),model:'openai/gpt-5.4-mini',provider:'OpenAI',service_tier:'flex'})};
 },scope).prepare('PRIMARY',input);expect(attempt).toMatchObject({status:'READY',maximumCostMicrounits:153456});if(attempt.status!=='READY')throw Error('EXPECTED_READY');
 expect(await attempt.dispatch()).toMatchObject({status:'SUCCESS',providerEvidence:{model:'openai/gpt-5.4-mini',provider:'OpenAI',location:'UNEXPOSED'}});
});
it.each([[408,'TIMEOUT'],[429,'RATE_LIMITED'],[404,'UNAVAILABLE']] as const)('classifies an HTTP %s boundary without requiring an error body',async(status,category)=>{
 const attempt=createGptMiniComparisonGateway(async()=>({status,body:''}),scope).prepare('PRIMARY',input);if(attempt.status!=='READY')throw Error('EXPECTED_READY');expect(await attempt.dispatch()).toMatchObject({status:'FAILURE',category,usage:{costMicrounits:null}});
});
it('retains independent known billing when token metadata has the wrong type',async()=>{
 const response=body();Object.assign(response.usage,{prompt_tokens:'PRIVATE_SENTINEL'});
 const attempt=createGptMiniComparisonGateway(async()=>({status:200,body:JSON.stringify(response)}),scope).prepare('PRIMARY',input);if(attempt.status!=='READY')throw Error('EXPECTED_READY');const result=await attempt.dispatch();expect(result).toMatchObject({status:'FAILURE',category:'SCHEMA_INVALID',usage:{costMicrounits:4000}});expect(JSON.stringify(result)).not.toContain('PRIVATE_SENTINEL');
});
it('bounds the cheaper synthetic ZDR route without claiming an EU region',async()=>{
 const attempt=createNano54ComparisonGateway(async request=>{
  expect(request).toMatchObject({model:'openai/gpt-5.4-nano',max_completion_tokens:3072,reasoning:{effort:'low',exclude:true},provider:{only:['azure'],zdr:true,allow_fallbacks:false,max_price:{prompt:.2,completion:1.25}}});
  return {status:200,body:JSON.stringify({...body(),model:'openai/gpt-5.4-nano'})};
 },scope).prepare('PRIMARY',input);expect(attempt).toMatchObject({status:'READY',maximumCostMicrounits:83840});if(attempt.status!=='READY')throw Error('EXPECTED_READY');
 expect(await attempt.dispatch()).toMatchObject({status:'SUCCESS',providerEvidence:{model:'openai/gpt-5.4-nano',provider:'Azure',location:'UNEXPOSED'}});
});
it('keeps the nonreasoning Azure comparison dialect and exposure explicit',async()=>{
 const attempt=createGpt41ComparisonGateway(async request=>{
  expect(request).toMatchObject({model:'openai/gpt-4.1-mini',max_completion_tokens:1536,temperature:0,provider:{only:['azure/swedencentral'],zdr:true,max_price:{prompt:.44,completion:1.76}}});expect(request).not.toHaveProperty('reasoning');expect(request).not.toHaveProperty('max_tokens');
  return {status:200,body:JSON.stringify({...body(),model:'openai/gpt-4.1-mini'})};
 },scope).prepare('PRIMARY',input);expect(attempt).toMatchObject({status:'READY',maximumCostMicrounits:463637});if(attempt.status!=='READY')throw Error('EXPECTED_READY');
 expect(await attempt.dispatch()).toMatchObject({status:'SUCCESS',providerEvidence:{model:'openai/gpt-4.1-mini',provider:'Azure'}});
});
it('keeps the explicitly scoped Flash comparison route and its larger reservation separate',async()=>{
 const attempt=createFlashComparisonGateway(async request=>{
  expect(request).toMatchObject({model:'google/gemini-2.5-flash',max_tokens:1536,temperature:0,provider:{only:['google-ai-studio'],allow_fallbacks:false,max_price:{prompt:.3,completion:2.5}}});expect(request).not.toHaveProperty('reasoning_effort');expect(request.provider).not.toHaveProperty('zdr');
  const response={...body(),model:'google/gemini-2.5-flash',provider:'Google AI Studio'};return {status:200,body:JSON.stringify(response)};
 },scope).prepare('PRIMARY',input);
 expect(attempt).toMatchObject({status:'READY',maximumCostMicrounits:318413});if(attempt.status!=='READY')throw Error('EXPECTED_READY');
 expect(await attempt.dispatch()).toMatchObject({status:'SUCCESS',providerEvidence:{model:'google/gemini-2.5-flash',provider:'Google AI Studio'}});
});
function body(){return {model:'openai/gpt-5-mini',provider:'Azure',id:'gen-comparison-1',usage:{cost:.004,prompt_tokens:10000,completion_tokens:600},choices:[{finish_reason:'stop',message:{content:JSON.stringify(encodeKeyedSmallComparison(ConversationInterpretationV3Schema.parse(frozenContextProposal(input,'R01',0)),input))}}]};}
it('pins the reviewed EU/ZDR route and exposure and permits one physical dispatch',async()=>{
 let calls=0;
 const gateway=createGptMiniComparisonGateway(async request=>{
  calls++;expect(request).toMatchObject({model:'openai/gpt-5-mini',stream:false,max_completion_tokens:3072,reasoning:{effort:'low',exclude:true},provider:{only:['azure/swedencentral'],zdr:true,data_collection:'deny',allow_fallbacks:false,require_parameters:true,max_price:{prompt:.275,completion:2.2}}});
  expect(request).not.toHaveProperty('max_tokens');expect(request).not.toHaveProperty('temperature');expect(request).not.toHaveProperty('reasoning_effort');
  return {status:200,body:JSON.stringify(body())};
 },scope);
 const attempt=gateway.prepare('PRIMARY',input);expect(attempt).toMatchObject({status:'READY',maximumCostMicrounits:116759});if(attempt.status!=='READY')throw Error('EXPECTED_READY');
 const [one,two]=await Promise.all([attempt.dispatch(),attempt.dispatch()]);
 expect(one).toMatchObject({status:'SUCCESS',usage:{costMicrounits:4000},providerEvidence:{model:'openai/gpt-5-mini',provider:'Azure'}});
 expect(two).toMatchObject({status:'FAILURE',category:'UNAVAILABLE'});expect(calls).toBe(1);
});
it('requires explicit synthetic scope and refuses invalid input without transport',()=>{
 let calls=0;const transport=async()=>{calls++;return {status:200,body:'{}'};};
 expect(()=>createGptMiniComparisonGateway(transport)).toThrow();
 const gateway=createGptMiniComparisonGateway(transport,scope);
 expect(gateway.prepare('PRIMARY',{...input,currentTurn:99})).toMatchObject({status:'FAILURE',category:'INVALID_INPUT'});expect(calls).toBe(0);
});
it.each(['model','provider','length','input-overflow','output-overflow','known-cost-overflow'] as const)('refuses %s while retaining independent known billing',async mode=>{
 const response=body();if(mode==='model')response.model='google/gemini-2.5-flash-lite';if(mode==='provider')response.provider='Google';if(mode==='length')response.choices[0].finish_reason='length';if(mode==='input-overflow')response.usage.prompt_tokens=12001;if(mode==='output-overflow')response.usage.completion_tokens=3073;if(mode==='known-cost-overflow')response.usage.cost=.2;
 const gateway=createGptMiniComparisonGateway(async()=>({status:200,body:JSON.stringify(response)}),scope),attempt=gateway.prepare('PRIMARY',input);if(attempt.status!=='READY')throw Error('EXPECTED_READY');
 expect(await attempt.dispatch()).toMatchObject({status:'FAILURE',category:'SCHEMA_INVALID',usage:{costMicrounits:mode==='known-cost-overflow'?200000:4000}});
});
it('refuses invalid optional advice as a full-envelope comparison failure',async()=>{
 const response=body(),wire=JSON.parse(response.choices[0].message.content);wire.directive=[{kind:'ASK_FOR_FIELD',field:'PRIVATE_SENTINEL',reason:null,issue:null,topic:null}];response.choices[0].message.content=JSON.stringify(wire);
 const attempt=createGptMiniComparisonGateway(async()=>({status:200,body:JSON.stringify(response)}),scope).prepare('PRIMARY',input);if(attempt.status!=='READY')throw Error('EXPECTED_READY');
 const result=await attempt.dispatch();expect(result).toMatchObject({status:'FAILURE',category:'SCHEMA_INVALID',usage:{costMicrounits:4000}});expect(JSON.stringify(result)).not.toContain('PRIVATE_SENTINEL');
});
it.each([
 {kind:'ASK_FOR_FIELD',field:'reminderTime'},
 {kind:'ASK_FOR_FIELD',field:'reminderTime',reason:'CONFLICT',issue:null,topic:null},
])('quarantines malformed producer advice before full-envelope acceptance (%j)',async advice=>{
 const response=body(),wire=JSON.parse(response.choices[0].message.content);wire.directive=[advice];response.choices[0].message.content=JSON.stringify(wire);
 const attempt=createGptMiniComparisonGateway(async()=>({status:200,body:JSON.stringify(response)}),scope).prepare('PRIMARY',input);if(attempt.status!=='READY')throw Error('EXPECTED_READY');
 expect(await attempt.dispatch()).toMatchObject({status:'FAILURE',category:'SCHEMA_INVALID',usage:{costMicrounits:4000}});
});
it('permits the observed thirty-second latency and bounds a hung comparison at forty-five seconds without a retry',async()=>{
 vi.useFakeTimers();try{
  let calls=0,signal:AbortSignal|undefined;
  const attempt=createGptMiniComparisonGateway(async(_request,options)=>{calls++;signal=options.signal;return new Promise(()=>{});},scope).prepare('PRIMARY',input);
  if(attempt.status!=='READY')throw Error('EXPECTED_READY');
  let settled=false;const waiting=attempt.dispatch().then(result=>{settled=true;return result;});await vi.advanceTimersByTimeAsync(30000);expect(settled).toBe(false);await vi.advanceTimersByTimeAsync(15000);
  expect(await waiting).toMatchObject({status:'FAILURE',category:'TIMEOUT',usage:{costMicrounits:null}});expect(signal?.aborted).toBe(true);expect(calls).toBe(1);
 }finally{vi.useRealTimers();}
});
it('rejects secrets before transport and duplicate JSON before decoding',async()=>{
 let calls=0;const gateway=createGptMiniComparisonGateway(async()=>{calls++;return {status:200,body:'{"usage":{},"usage":{}}'};},scope);
 const secret=structuredClone(input);secret.turns[secret.currentTurn].text='api_key=PRIVATE_SENTINEL';
 expect(gateway.prepare('PRIMARY',secret)).toMatchObject({status:'FAILURE',category:'INVALID_INPUT'});expect(calls).toBe(0);
 const attempt=gateway.prepare('PRIMARY',input);if(attempt.status!=='READY')throw Error('EXPECTED_READY');
 expect(await attempt.dispatch()).toMatchObject({status:'FAILURE',category:'INVALID_JSON'});expect(calls).toBe(1);
});

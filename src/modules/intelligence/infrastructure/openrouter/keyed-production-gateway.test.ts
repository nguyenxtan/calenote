// @vitest-environment node
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import * as gateways from './semantic-gateway';
import * as configuration from './config';
import {ContextInputSchema,ConversationInterpretationV3Schema} from '../../../conversation/context-contract/contracts';
import {encodeKeyedSmallComparison} from './context-provider-keyed-small-wire';
import {frozenContextProposal} from '../../../../../tools/benchmark/context-contract-fixtures';
import type {SemanticTransport} from './semantic-gateway';
import type {SemanticGateway} from '../../semantic-gateway';
const qualified=JSON.parse(readFileSync(new URL('./__fixtures__/keyed160-request-hashes.json',import.meta.url),'utf8')) as Array<{fixture:string;turn?:number;input:unknown;requestSha256:string}>;
type Factory=(transport:SemanticTransport,admission?:{status:'OBSERVABLE_CANARY';advertisedContextTokens:number})=>SemanticGateway;
function factory(){const value=Reflect.get(gateways,'createKeyedContextContractGateway');expect(value).toBeTypeOf('function');return value as Factory;}
it('refuses dispatch without exact route admission before exposing a reservation',()=>{
 let calls=0;const create=factory(),transport:SemanticTransport=async()=>{calls++;return {status:500,body:''};};
 expect(create(transport).prepare('PRIMARY',qualified[0].input as never)).toEqual({status:'FAILURE',category:'ROUTE_ADMISSION_UNVERIFIED'});
 expect(create(transport,{status:'OBSERVABLE_CANARY',advertisedContextTokens:1048576}).prepare('PRIMARY',qualified[0].input as never)).toEqual({status:'FAILURE',category:'ROUTE_ADMISSION_UNVERIFIED'});expect(calls).toBe(0);
});
it.each(qualified)('preserves the reviewed keyed160 $fixture/$turn request exactly and decodes real typed fields once',async row=>{
 const input=ContextInputSchema.parse(row.input);let calls=0;
 const create=factory();const gateway=create(async request=>{
  calls++;expect(createHash('sha256').update(JSON.stringify(request)).digest('hex')).toBe(row.requestSha256);
  const content=encodeKeyedSmallComparison(ConversationInterpretationV3Schema.parse(frozenContextProposal(input,row.fixture,row.turn??0)),input);
  return {status:200,body:JSON.stringify({model:'openai/gpt-5-mini',provider:'Azure',usage:{cost:.003,prompt_tokens:8000,completion_tokens:500},choices:[{finish_reason:'stop',message:{content:JSON.stringify(content)}}]})};
 },{status:'OBSERVABLE_CANARY',advertisedContextTokens:400000});
 const attempt=gateway.prepare('PRIMARY',input as never);expect(attempt).toMatchObject({status:'READY',maximumCostMicrounits:116759});if(attempt.status!=='READY')throw Error('ready');
 expect(await attempt.dispatch()).toMatchObject({status:'SUCCESS',usage:{costMicrounits:3000},providerEvidence:{model:'openai/gpt-5-mini',provider:'Azure'}});
 expect(await attempt.dispatch()).toEqual({status:'FAILURE',category:'UNAVAILABLE'});expect(calls).toBe(1);
});
it.each([{tokens:16000,accepted:true},{tokens:16001,accepted:false}])('bounds selected-schema input overhead at $tokens tokens',async({tokens,accepted})=>{
 const row=qualified[0],input=ContextInputSchema.parse(row.input);
 const gateway=factory()(async()=>({status:200,body:JSON.stringify({model:'openai/gpt-5-mini',provider:'Azure',usage:{cost:.003,prompt_tokens:tokens,completion_tokens:500},choices:[{finish_reason:'stop',message:{content:JSON.stringify(encodeKeyedSmallComparison(ConversationInterpretationV3Schema.parse(frozenContextProposal(input,row.fixture,row.turn??0)),input))}}]})}),{status:'OBSERVABLE_CANARY',advertisedContextTokens:400000});
 const ready=gateway.prepare('PRIMARY',input as never);expect(ready.status).toBe('READY');if(ready.status!=='READY')throw Error('ready');
 expect((await ready.dispatch()).status).toBe(accepted?'SUCCESS':'FAILURE');
});
const env={AI_MODE:'privacy',OPENROUTER_API_KEY:'synthetic-test-key',OPENROUTER_PRIVACY_MODEL:'openai/gpt-5-mini',OPENROUTER_PRIVACY_PROVIDER:'azure/swedencentral',AI_MAX_PRIVACY_PRICE:'2.2',AI_TIMEOUT_MS:'45000',AI_MAX_INPUT_CHARS:'1800',AI_MAX_OUTPUT_TOKENS:'3072'};
function parse(value:Record<string,string|undefined>){const fn=Reflect.get(configuration,'parseKeyedContextRuntimeConfig');expect(fn).toBeTypeOf('function');return fn(value);}
it('admits only the qualified EU/ZDR runtime and preserves hard account ceilings',()=>{
 expect(parse(env)).toMatchObject({status:'READY',model:'openai/gpt-5-mini',provider:'azure/swedencentral',budgetLimits:{ownerDailyFallbackLimit:50,ownerMonthlyCostMicrounits:500000,globalDailyCostMicrounits:2000000,reservationInputTokenExposure:400000,maxOutputTokens:3072,promptPriceMicrounitsPerMillionTokens:275000,completionPriceMicrounitsPerMillionTokens:2200000}});
 expect(parse({...env,AI_MODE:'off'})).toEqual({status:'OFF'});
 for(const patch of [{OPENROUTER_PRIVACY_PROVIDER:'azure'},{OPENROUTER_PRIVACY_MODEL:'google/gemini-2.5-flash-lite'},{AI_TIMEOUT_MS:'30000'},{AI_MAX_OUTPUT_TOKENS:'1536'},{AI_MAX_PRIVACY_PRICE:'9'},{OPENROUTER_API_KEY:''},{OPENROUTER_FALLBACK_MODELS:'other/model'},{OWNER_DAILY_CALL_LIMIT:'51'},{OWNER_MONTHLY_COST_MICROUNITS:'500001'},{GLOBAL_DAILY_COST_MICROUNITS:'2000001'}])expect(parse({...env,...patch})).toEqual({status:'UNAVAILABLE'});
});

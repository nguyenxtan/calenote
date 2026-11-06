/** Shared qualified keyed transport; alternative profiles require explicit synthetic scope. */
import {z} from 'zod';
import {ContextInputSchema} from '../../../conversation/context-contract/contracts';
import {containsForbiddenControl} from '../../../conversation/context-contract/projection';
import {serializeKeyedSmallComparison} from '../../../conversation/context-contract/keyed-small-wire';
import {isUnreconciledListInterpretation,listTransportGuidanceValid,type ContextGatewayInterpretation} from '../../../conversation/context-contract/list-period-transport';
import {contextInputContainsSensitiveValue,type SemanticJsonRequest,type SemanticTransport} from './semantic-gateway';
import type {SemanticGateway,SemanticUsage,SemanticAttemptResult} from '../../semantic-gateway';
import {decodeKeyedSmallComparison} from './context-provider-keyed-small-wire';
import {parseJsonWithoutDuplicateMembers} from './strict-json';
import {factorContextSchema} from './context-schema-factor';
import {openAiComparisonAdmissionSchema} from './context-openai-admission-schema';
import {constrainComparisonDateSchema} from './context-comparison-date-schema';
import {googleComparisonAdmissionSchema} from './context-google-admission-schema';

export const GPT_MINI_COMPARISON=Object.freeze({model:'openai/gpt-5-mini',provider:'azure/swedencentral',maximumCostMicrounits:116759,maxInputTokens:12000,maxOutputTokens:3072,maxResponseBytes:32768,timeoutMs:45000,requireZdr:true,reasoning:true,promptPrice:.275,completionPrice:2.2});
export const GPT_MINI_MEDIUM_COMPARISON=Object.freeze({...GPT_MINI_COMPARISON,reasoningEffort:'medium' as const,maximumCostMicrounits:119012,maxOutputTokens:4096,maxResponseBytes:65536,timeoutMs:45000});
export const FLASH_COMPARISON=Object.freeze({model:'google/gemini-2.5-flash',provider:'google-ai-studio',maximumCostMicrounits:318413,maxInputTokens:12000,maxOutputTokens:1536,maxResponseBytes:32768,timeoutMs:30000,requireZdr:false,reasoning:false,promptPrice:.3,completionPrice:2.5});
export const GPT41_COMPARISON=Object.freeze({model:'openai/gpt-4.1-mini',provider:'azure/swedencentral',maximumCostMicrounits:463637,maxInputTokens:12000,maxOutputTokens:1536,maxResponseBytes:32768,timeoutMs:30000,requireZdr:true,reasoning:false,promptPrice:.44,completionPrice:1.76});
export const NANO54_COMPARISON=Object.freeze({model:'openai/gpt-5.4-nano',provider:'azure',maximumCostMicrounits:83840,maxInputTokens:12000,maxOutputTokens:3072,maxResponseBytes:32768,timeoutMs:30000,requireZdr:true,reasoning:true,promptPrice:.2,completionPrice:1.25});
export const MINI54_FLEX_COMPARISON=Object.freeze({model:'openai/gpt-5.4-mini',provider:'openai/flex',observedProvider:'OpenAI',serviceTier:'flex',maximumCostMicrounits:153456,maxInputTokens:12000,maxOutputTokens:1536,maxResponseBytes:32768,timeoutMs:60000,requireZdr:false,reasoning:true,reasoningEffort:'none',seed:113,promptPrice:.375,completionPrice:2.25});
export const MINI54_AZURE_COMPARISON=Object.freeze({model:'openai/gpt-5.4-mini',provider:'azure',maximumCostMicrounits:306912,maxInputTokens:12000,maxOutputTokens:1536,maxResponseBytes:32768,timeoutMs:30000,requireZdr:true,reasoning:true,reasoningEffort:'none',promptPrice:.75,completionPrice:4.5});
type ComparisonProfile=typeof GPT_MINI_COMPARISON|typeof GPT_MINI_MEDIUM_COMPARISON|typeof FLASH_COMPARISON|typeof GPT41_COMPARISON|typeof NANO54_COMPARISON|typeof MINI54_FLEX_COMPARISON|typeof MINI54_AZURE_COMPARISON;
const responseEnvelope=(profile:ComparisonProfile)=>z.object({...('serviceTier' in profile?{service_tier:z.literal(profile.serviceTier)}:{}),model:z.literal(profile.model),provider:'observedProvider' in profile?z.literal(profile.observedProvider):profile.requireZdr?z.literal('Azure'):z.enum(['Google AI Studio','Google','google-ai-studio']),id:z.string().regex(/^gen-[A-Za-z0-9_-]+$/).optional(),choices:z.array(z.object({finish_reason:z.literal('stop'),message:z.object({content:z.string(),refusal:z.null().optional(),tool_calls:z.never().optional(),function_call:z.never().optional()})})).length(1)});
function knownUsage(raw:unknown):SemanticUsage {
 if(!raw||typeof raw!=='object')return {costMicrounits:null};
 const value=raw as Record<string,unknown>,cost=z.number().finite().nonnegative().safeParse(value.cost);
 if(!cost.success)return {costMicrounits:null};
 const amount=Math.ceil(cost.data*1e6),tokens=(v:unknown)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0?v:undefined;
 const prompt=tokens(value.prompt_tokens),completion=tokens(value.completion_tokens);
 return {costMicrounits:Number.isSafeInteger(amount)?amount:null,reportedCostUsd:cost.data,...(prompt===undefined?{}:{promptTokens:prompt}),...(completion===undefined?{}:{completionTokens:completion})};
}
const httpFailure=(status:number)=>status===408?'TIMEOUT' as const:status===429?'RATE_LIMITED' as const:status===404?'UNAVAILABLE' as const:'PROVIDER_FAILURE' as const;
function createProfileGateway(transport:SemanticTransport,profile:ComparisonProfile):SemanticGateway<ContextGatewayInterpretation,unknown> & {contextWire:'KEYED_COMPARISON_137'} {
 return {contextWire:'KEYED_COMPARISON_137',prepare(tier,raw){
  if(tier!=='PRIMARY')return {status:'FAILURE',category:'UNAVAILABLE'};
  const parsed=ContextInputSchema.safeParse(raw);
  if(!parsed.success||parsed.data.turns[parsed.data.currentTurn].text.length>1800||parsed.data.turns.some(t=>t.role==='USER'&&t.text.length>2000)||contextInputContainsSensitiveValue(parsed.data)||containsForbiddenControl(parsed.data,[]))return {status:'FAILURE',category:'INVALID_INPUT'};
  const input=parsed.data,wire=serializeKeyedSmallComparison(input);
  const dateSchema=constrainComparisonDateSchema(wire.response_format.json_schema.schema);
  const request:SemanticJsonRequest={model:profile.model,stream:false,messages:wire.messages,...(profile.reasoning?{...(profile.provider.startsWith('openai/')?{max_tokens:profile.maxOutputTokens}:{max_completion_tokens:profile.maxOutputTokens}),reasoning:{effort:'reasoningEffort' in profile?profile.reasoningEffort:'low' as const,exclude:true as const}}:profile.requireZdr?{max_completion_tokens:1536,temperature:0}:{max_tokens:1536,temperature:0}),...('seed' in profile?{seed:profile.seed}:{}),...('serviceTier' in profile?{service_tier:profile.serviceTier}:{}),response_format:{type:'json_schema',json_schema:{name:'calenote_context_keyed_137',strict:true,schema:factorContextSchema(profile.provider==='google-ai-studio'?googleComparisonAdmissionSchema(dateSchema):openAiComparisonAdmissionSchema(dateSchema)).schema}},provider:{only:[profile.provider],allow_fallbacks:false,require_parameters:true,data_collection:'deny',...(profile.requireZdr?{zdr:true}:{}),max_price:{prompt:profile.promptPrice,completion:profile.completionPrice}}};
  let used=false;
  return {status:'READY',model:request.model,provider:profile.provider,maximumCostMicrounits:profile.maximumCostMicrounits,routeAdmission:'OBSERVABLE_CANARY',async dispatch(){
   if(used)return {status:'FAILURE',category:'UNAVAILABLE'};used=true;
   const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
   try{
    const timeout=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('COMPARISON_TIMEOUT'));},profile.timeoutMs);});
    const response=await Promise.race([transport(request,{signal:controller.signal}),timeout]);
    if(response.oversized||new TextEncoder().encode(response.body).byteLength>profile.maxResponseBytes)return {status:'FAILURE',category:'SCHEMA_INVALID',usage:{costMicrounits:null}};
    let raw:unknown;
    try{raw=parseJsonWithoutDuplicateMembers(response.body);}catch{return {status:'FAILURE',category:response.status===200?'INVALID_JSON':httpFailure(response.status),usage:{costMicrounits:null},failureDiagnostics:response.failureDiagnostics};}
    const usage=knownUsage(raw&&typeof raw==='object'?'usage' in raw?raw.usage:undefined:undefined);
    if(response.status!==200)return {status:'FAILURE',category:httpFailure(response.status),usage,failureDiagnostics:response.failureDiagnostics};
    const decodedEnvelope=responseEnvelope(profile).safeParse(raw);
    const fail=():SemanticAttemptResult<ContextGatewayInterpretation>=>({status:'FAILURE',category:'SCHEMA_INVALID',usage});
    if(!decodedEnvelope.success||usage.costMicrounits===null||usage.costMicrounits>profile.maximumCostMicrounits||usage.promptTokens===undefined||usage.promptTokens>profile.maxInputTokens||usage.completionTokens===undefined||usage.completionTokens>profile.maxOutputTokens)return fail();
    let content:unknown;try{content=parseJsonWithoutDuplicateMembers(decodedEnvelope.data.choices[0].message.content);}catch{return {status:'FAILURE',category:'INVALID_JSON',usage};}
    const result=decodeKeyedSmallComparison(content,input);
    if(result.status!=='PARSED'||!(isUnreconciledListInterpretation(result.value)?listTransportGuidanceValid(result.value):result.value.fullSchemaValid))return fail();
    return {status:'SUCCESS',interpretation:result.value,usage,rawResponseBytes:response.rawResponseBytes,providerEvidence:{model:profile.model,provider:decodedEnvelope.data.provider,location:'UNEXPOSED',generationId:decodedEnvelope.data.id??null}};
   }catch{return {status:'FAILURE',category:controller.signal.aborted?'TIMEOUT':'PROVIDER_FAILURE',usage:{costMicrounits:null}};}finally{if(timer)clearTimeout(timer);}
  }};
 }};
}

function createComparisonGateway(transport:SemanticTransport,scope:'SYNTHETIC_MODEL_COMPARISON_ONLY'|undefined,profile:ComparisonProfile) {
 if(scope!=='SYNTHETIC_MODEL_COMPARISON_ONLY'||typeof transport!=='function')throw Error('EXPLICIT_SYNTHETIC_SCOPE_REQUIRED');
 return createProfileGateway(transport,profile);
}
/** Explicit reviewed runtime selection. Admission is never supplied by an env flag. */
export function createKeyedContextContractGateway(transport:SemanticTransport,admission?:{status:'OBSERVABLE_CANARY';advertisedContextTokens:number}) {
 if(typeof transport!=='function')throw TypeError('TRANSPORT_REQUIRED');
 const gateway=createProfileGateway(transport,GPT_MINI_COMPARISON);
 const admitted=admission?.status==='OBSERVABLE_CANARY'&&admission.advertisedContextTokens===400000;
 return {...gateway,contextWire:'KEYED_OBJECTS_136' as const,prepare:((tier,raw)=>admitted?gateway.prepare(tier,raw):{status:'FAILURE' as const,category:'ROUTE_ADMISSION_UNVERIFIED' as const}) as typeof gateway.prepare};
}

export function createGptMiniComparisonGateway(transport:SemanticTransport,scope?:'SYNTHETIC_MODEL_COMPARISON_ONLY'){return createComparisonGateway(transport,scope,GPT_MINI_COMPARISON);}
export function createGptMiniMediumComparisonGateway(transport:SemanticTransport,scope?:'SYNTHETIC_MODEL_COMPARISON_ONLY'){return createComparisonGateway(transport,scope,GPT_MINI_MEDIUM_COMPARISON);}
export function createFlashComparisonGateway(transport:SemanticTransport,scope?:'SYNTHETIC_MODEL_COMPARISON_ONLY'){return createComparisonGateway(transport,scope,FLASH_COMPARISON);}

export function createGpt41ComparisonGateway(transport:SemanticTransport,scope?:'SYNTHETIC_MODEL_COMPARISON_ONLY'){return createComparisonGateway(transport,scope,GPT41_COMPARISON);}

export function createNano54ComparisonGateway(transport:SemanticTransport,scope?:'SYNTHETIC_MODEL_COMPARISON_ONLY'){return createComparisonGateway(transport,scope,NANO54_COMPARISON);}

export function createMini54FlexComparisonGateway(transport:SemanticTransport,scope?:'SYNTHETIC_MODEL_COMPARISON_ONLY'){return createComparisonGateway(transport,scope,MINI54_FLEX_COMPARISON);}

export function createMini54AzureComparisonGateway(transport:SemanticTransport,scope?:'SYNTHETIC_MODEL_COMPARISON_ONLY'){return createComparisonGateway(transport,scope,MINI54_AZURE_COMPARISON);}

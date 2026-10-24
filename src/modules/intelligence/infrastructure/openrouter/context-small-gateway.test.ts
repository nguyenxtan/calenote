// @vitest-environment node
import {readFileSync} from 'node:fs';
import {expect,it,vi} from 'vitest';
import {ContextInputSchema,ConversationInterpretationV3Schema} from '../../../conversation/context-contract/contracts';
import {CONTEXT_SMALL_PROTOCOL_V3} from '../../../conversation/context-contract/small-protocol';
import {CONTEXT_TYPED_PROTOCOL_V3} from '../../../conversation/context-contract/typed-protocol';
import {serializeSmallContextRequest} from '../../../conversation/context-contract/small-wire';
import {frozenContextProposal} from '../../../../../tools/benchmark/context-contract-fixtures';
import {encodeSmallContextV3} from './context-provider-small-wire';
import {createSmallContextContractGateway} from './semantic-gateway';
const input=ContextInputSchema.parse(JSON.parse(readFileSync(new URL('./__fixtures__/typed105-r01-before.json',import.meta.url),'utf8')).input);
const config={protocol:CONTEXT_SMALL_PROTOCOL_V3,maxInputChars:1800,maxInputTokens:12000,maxOutputTokens:1536,maxResponseBytes:32768,timeoutMs:30000,primary:{model:'google/gemini-2.5-flash-lite',provider:'google-vertex/eu',requireZdr:true,promptPriceMicrounitsPerMillionTokens:100000,completionPriceMicrounitsPerMillionTokens:400000}};
it('pairs small106 grammar and strict decoder with unchanged route and one dispatch',async()=>{
 const wire=encodeSmallContextV3(ConversationInterpretationV3Schema.parse(frozenContextProposal(input,'R01',0)),input);
 const transport=vi.fn(async(request)=>{expect(request.messages).toEqual(serializeSmallContextRequest(input).messages);expect(request.response_format).toEqual(serializeSmallContextRequest(input).response_format);expect(request.provider).toEqual({only:['google-vertex/eu'],allow_fallbacks:false,require_parameters:true,data_collection:'deny',zdr:true,max_price:{prompt:.1,completion:.4}});return {status:200,body:JSON.stringify({model:config.primary.model,provider:'Google',id:'gen-synthetic-106',usage:{cost:.001,prompt_tokens:100,completion_tokens:100},choices:[{finish_reason:'stop',message:{content:JSON.stringify(wire)}}]})};});
 const gateway=createSmallContextContractGateway(config,transport,{status:'OBSERVABLE_CANARY',advertisedContextTokens:1048576});
 const attempt=gateway.prepare('PRIMARY',input);if(attempt.status!=='READY')throw Error('EXPECTED_READY');
 const result=await attempt.dispatch(); expect(result).toMatchObject({status:'SUCCESS'});expect(await attempt.dispatch()).toMatchObject({status:'FAILURE',category:'UNAVAILABLE'});expect(transport).toHaveBeenCalledTimes(1);
 expect(()=>createSmallContextContractGateway({...config,protocol:CONTEXT_TYPED_PROTOCOL_V3} as never,transport)).toThrow();
 expect(createSmallContextContractGateway(config,transport).prepare('PRIMARY',input)).toMatchObject({status:'FAILURE',category:'ROUTE_ADMISSION_UNVERIFIED'});
});

it('labels small106 table refusal without leaking raw content',async()=>{
 const payload=encodeSmallContextV3(ConversationInterpretationV3Schema.parse(frozenContextProposal(input,'R01',0)),input);(payload.x as string[]).push('unused private payload');
 const gateway=createSmallContextContractGateway(config,async()=>({status:200,body:JSON.stringify({model:config.primary.model,provider:'Google',id:'gen-synthetic-106-invalid',usage:{cost:.001,prompt_tokens:100,completion_tokens:100},choices:[{finish_reason:'stop',message:{content:JSON.stringify(payload)}}]})}),{status:'OBSERVABLE_CANARY',advertisedContextTokens:1048576});
 const attempt=gateway.prepare('PRIMARY',input);if(attempt.status!=='READY')throw Error('EXPECTED_READY');
 const result=await attempt.dispatch();expect(result).toMatchObject({status:'FAILURE',category:'SCHEMA_INVALID',canonicalValidationDiagnostics:{state:'WIRE_DECODE_FAILED',providerWireSchemaVersion:CONTEXT_SMALL_PROTOCOL_V3.wireVersion}});expect(JSON.stringify(result)).not.toContain('unused private payload');
});

it('rejects contradictory LIST target at the schema boundary without retry or leaked payload',async()=>{
 const payload=encodeSmallContextV3(ConversationInterpretationV3Schema.parse(frozenContextProposal(input,'R01',0)),input);
 (payload.o as Record<string,unknown>).e=['U0'];
 const transport=vi.fn(async()=>({status:200,body:JSON.stringify({model:config.primary.model,provider:'Google',id:'gen-synthetic-106-target',usage:{cost:.001,prompt_tokens:100,completion_tokens:100},choices:[{finish_reason:'stop',message:{content:JSON.stringify(payload)}}]})}));
 const gateway=createSmallContextContractGateway(config,transport,{status:'OBSERVABLE_CANARY',advertisedContextTokens:1048576});
 const attempt=gateway.prepare('PRIMARY',input);if(attempt.status!=='READY')throw Error('EXPECTED_READY');
 const before=JSON.stringify(payload),result=await attempt.dispatch();
 expect(result).toMatchObject({status:'FAILURE',category:'SCHEMA_INVALID',canonicalValidationDiagnostics:{state:'WIRE_DECODE_FAILED',validation:{issues:[{smallTables:{reason:'GENERATION_SHAPE_INVALID'}}]}}});
 expect(JSON.stringify(payload)).toBe(before);expect(transport).toHaveBeenCalledTimes(1);
 expect(await attempt.dispatch()).toMatchObject({status:'FAILURE',category:'UNAVAILABLE'});
 expect(transport).toHaveBeenCalledTimes(1);
});

it('AI Studio non-ZDR is an explicit isolated Pilot entry and leaves legacy factories strict',async()=>{
 const {createAiStudioPilotContextGateway}=await import('./semantic-gateway');
 const studio={...config,primary:{...config.primary,provider:'google-ai-studio',requireZdr:false}};
 const wire=encodeSmallContextV3(ConversationInterpretationV3Schema.parse(frozenContextProposal(input,'R01',0)),input);
 const transport=vi.fn(async(request)=>{expect(request.provider).toEqual({only:['google-ai-studio'],allow_fallbacks:false,require_parameters:true,data_collection:'deny',zdr:false,max_price:{prompt:.1,completion:.4}});return {status:200,body:JSON.stringify({model:config.primary.model,provider:'Google AI Studio',id:'gen-studio-fake',usage:{cost:.001,prompt_tokens:100,completion_tokens:100},choices:[{finish_reason:'stop',message:{content:JSON.stringify(wire)}}]})};});
 expect(()=>createSmallContextContractGateway(studio,transport)).toThrow();
 expect(()=>createAiStudioPilotContextGateway(studio,transport,'WRONG' as never)).toThrow();
 const gateway=createAiStudioPilotContextGateway(studio,transport,'AI_STUDIO_PILOT_RETENTION_55D',{status:'OBSERVABLE_CANARY',advertisedContextTokens:1048576});
 const attempt=gateway.prepare('PRIMARY',input);if(attempt.status!=='READY')throw Error('EXPECTED_READY');
 expect(await attempt.dispatch()).toMatchObject({status:'SUCCESS',providerEvidence:{provider:'Google AI Studio',location:'UNEXPOSED'}});
 expect(await attempt.dispatch()).toMatchObject({status:'FAILURE',category:'UNAVAILABLE'});expect(transport).toHaveBeenCalledTimes(1);
 expect(()=>createAiStudioPilotContextGateway(config,transport,'AI_STUDIO_PILOT_RETENTION_55D')).toThrow();
});

it('Studio Pilot refuses Vertex/ambiguous provider evidence and EU location claims',async()=>{
 const {createAiStudioPilotContextGateway}=await import('./semantic-gateway');
 const studio={...config,primary:{...config.primary,provider:'google-ai-studio',requireZdr:false}};
 const wire=encodeSmallContextV3(ConversationInterpretationV3Schema.parse(frozenContextProposal(input,'R01',0)),input);
 for(const evidence of [{provider:'Google'},{provider:'google-vertex/eu'},{provider:'Google AI Studio',location:'eu'}]){
  const gateway=createAiStudioPilotContextGateway(studio,async()=>({status:200,body:JSON.stringify({model:config.primary.model,...evidence,usage:{cost:.001,prompt_tokens:100,completion_tokens:100},choices:[{finish_reason:'stop',message:{content:JSON.stringify(wire)}}]})}),'AI_STUDIO_PILOT_RETENTION_55D',{status:'OBSERVABLE_CANARY',advertisedContextTokens:1048576});
  const attempt=gateway.prepare('PRIMARY',input);if(attempt.status!=='READY')throw Error('EXPECTED_READY');
  expect(await attempt.dispatch()).toMatchObject({status:'FAILURE',category:'SCHEMA_INVALID'});
 }
});

it.each(['WHITESPACE_TRUNCATED','COMPLETE_VALID_JSON'] as const)('refuses %s content with a length finish without salvage or loss of independent usage',async(kind)=>{
 const {createAiStudioPilotContextGateway}=await import('./semantic-gateway');
 const studio={...config,primary:{...config.primary,provider:'google-ai-studio',requireZdr:false}};
 const wire=encodeSmallContextV3(ConversationInterpretationV3Schema.parse(frozenContextProposal(input,'R01',0)),input);
 const content=kind==='WHITESPACE_TRUNCATED'?'{"o":{"c":"3","e":[]},"c":{"a":['+' '.repeat(7662):JSON.stringify(wire);
 const transport=vi.fn(async()=>({status:200,body:JSON.stringify({model:config.primary.model,provider:'Google AI Studio',usage:{cost:.00032818,prompt_tokens:8568,completion_tokens:64},choices:[{finish_reason:'length',native_finish_reason:'MAX_TOKENS',message:{content}}]})}));
 const attempt=createAiStudioPilotContextGateway(studio,transport,'AI_STUDIO_PILOT_RETENTION_55D',{status:'OBSERVABLE_CANARY',advertisedContextTokens:1048576}).prepare('PRIMARY',input);if(attempt.status!=='READY')throw Error('EXPECTED_READY');
 const result=await attempt.dispatch();expect(result).toMatchObject({status:'FAILURE',category:'SCHEMA_INVALID',usage:{costMicrounits:329,reportedCostUsd:.00032818,completionTokens:64},canonicalValidationDiagnostics:{state:'PROVIDER_ENVELOPE_FAILED',providerEnvelope:{firstChoice:{finishReason:{token:'length'},nativeFinishReason:{token:'MAX_TOKENS'}}}}});expect(await attempt.dispatch()).toMatchObject({status:'FAILURE',category:'UNAVAILABLE'});expect(transport).toHaveBeenCalledTimes(1);
});

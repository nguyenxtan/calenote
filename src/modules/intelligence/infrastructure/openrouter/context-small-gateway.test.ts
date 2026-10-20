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
 const payload=encodeSmallContextV3(ConversationInterpretationV3Schema.parse(frozenContextProposal(input,'R01',0)),input);payload.texts.push('unused private payload');
 const gateway=createSmallContextContractGateway(config,async()=>({status:200,body:JSON.stringify({model:config.primary.model,provider:'Google',id:'gen-synthetic-106-invalid',usage:{cost:.001,prompt_tokens:100,completion_tokens:100},choices:[{finish_reason:'stop',message:{content:JSON.stringify(payload)}}]})}),{status:'OBSERVABLE_CANARY',advertisedContextTokens:1048576});
 const attempt=gateway.prepare('PRIMARY',input);if(attempt.status!=='READY')throw Error('EXPECTED_READY');
 const result=await attempt.dispatch();expect(result).toMatchObject({status:'FAILURE',category:'SCHEMA_INVALID',canonicalValidationDiagnostics:{state:'WIRE_DECODE_FAILED',providerWireSchemaVersion:CONTEXT_SMALL_PROTOCOL_V3.wireVersion}});expect(JSON.stringify(result)).not.toContain('unused private payload');
});

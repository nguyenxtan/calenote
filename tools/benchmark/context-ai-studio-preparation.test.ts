// @vitest-environment node
import {expect,it} from 'vitest';
import {prepareAiStudioCandidate} from './context-ai-studio-preparation';
const ep=(parameters=['structured_outputs','response_format'])=>({model_id:'google/gemini-2.5-flash-lite',tag:'google-ai-studio',supported_parameters:parameters});
const metadata=(parameters?:string[])=>({data:{id:'google/gemini-2.5-flash-lite',endpoints:[ep(parameters)]}});
it('blocks the advertised structured-output route when absent from the public ZDR list',()=>{
 expect(prepareAiStudioCandidate(metadata(),{data:[]})).toMatchObject({state:'BLOCKED_ZDR',model:'google/gemini-2.5-flash-lite',candidateProvider:'google-ai-studio',structuredOutputs:'ADVERTISED',zdr:'NOT_LISTED',paid:'HOLD',dispatchAllowed:false,capMicrounits:10000000,unknownCount:49,candidatePreferences:{only:['google-ai-studio'],zdr:true,allow_fallbacks:false,require_parameters:true,data_collection:'deny'}});
});
it('fails closed for missing structured parameters, another region/provider/model and malformed metadata',()=>{
 for(const raw of [metadata(['response_format']),metadata([]),{data:{id:'other/model',endpoints:[ep()]}},{data:{id:'google/gemini-2.5-flash-lite',endpoints:[{...ep(),tag:'google-vertex/eu'}]}},{}])expect(prepareAiStudioCandidate(raw,{data:[]}).state).toBe('BLOCKED_METADATA');
 expect(prepareAiStudioCandidate(metadata(),{}).state).toBe('BLOCKED_METADATA');
});
it('even a matching ZDR advertisement grants no key, paid, compiler or runtime authority',()=>{
 expect(prepareAiStudioCandidate(metadata(),{data:[ep()]})).toMatchObject({state:'PREPARED_HOLD',zdr:'ADVERTISED',dispatchAllowed:false,compilerAdmission:'UNVERIFIED',paid:'HOLD',runtimeChanged:false,credentialReads:0,inferenceRequests:0});
 for(const other of [{...ep(),model_id:'other/model'},{...ep(),tag:'google-ai-studio/priority'},{...ep(),tag:'google-vertex/eu'}])expect(prepareAiStudioCandidate(metadata(),{data:[other]}).zdr).toBe('NOT_LISTED');
});

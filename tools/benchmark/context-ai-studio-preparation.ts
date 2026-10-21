/** Offline migration preparation only. No runtime selection, key or transport. */
import {z} from 'zod';
const model='google/gemini-2.5-flash-lite',provider='google-ai-studio';
const tag=z.string().max(128).regex(/^[a-z0-9]+(?:[-/][a-z0-9]+)*$/u);
const endpoints=z.object({data:z.object({id:z.literal(model),endpoints:z.array(z.object({model_id:z.literal(model),tag,supported_parameters:z.array(z.string().max(64)).max(64)})).max(128)})});
const zdrEndpoints=z.object({data:z.array(z.object({model_id:z.string().max(256),tag})).max(10000)});
export function prepareAiStudioCandidate(endpointMetadata:unknown,zdrMetadata:unknown,privacyPolicy?:'AI_STUDIO_PILOT_RETENTION_55D'){
 if(privacyPolicy!==undefined&&privacyPolicy!=='AI_STUDIO_PILOT_RETENTION_55D')throw Error('AI_STUDIO_PILOT_POLICY_REQUIRED');
 const accepted=privacyPolicy==='AI_STUDIO_PILOT_RETENTION_55D';
 const base={version:'ai-studio-migration-preparation-2',model,candidateProvider:provider,paid:'HOLD',dispatchAllowed:false,compilerAdmission:'UNVERIFIED',runtimeChanged:false,credentialReads:0,inferenceRequests:0,capMicrounits:10000000,unknownCount:49,candidatePreferences:{only:[provider],zdr:!accepted,allow_fallbacks:false,require_parameters:true,data_collection:'deny',max_price:{prompt:.1,completion:.4}}} as const;
 const inventory=endpoints.safeParse(endpointMetadata),zdrInventory=zdrEndpoints.safeParse(zdrMetadata);
 if(!inventory.success||!zdrInventory.success)return {...base,state:'BLOCKED_METADATA',structuredOutputs:'UNVERIFIED',zdr:'UNVERIFIED'} as const;
 const endpoint=inventory.data.data.endpoints.find(endpoint=>endpoint.tag===provider);
 if(!endpoint||!['structured_outputs','response_format'].every(parameter=>endpoint.supported_parameters.includes(parameter)))return {...base,state:'BLOCKED_METADATA',structuredOutputs:'UNVERIFIED',zdr:'UNVERIFIED'} as const;
 const listed=zdrInventory.data.data.some(endpoint=>endpoint.model_id===model&&endpoint.tag===provider);
 return {...base,...(accepted?{privacyPolicy,retentionDaysAccepted:55}:{}),state:listed||accepted?'PREPARED_HOLD':'BLOCKED_ZDR',structuredOutputs:'ADVERTISED',zdr:listed?'ADVERTISED':'NOT_LISTED'} as const;
}

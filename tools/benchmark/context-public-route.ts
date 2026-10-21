/** Read-only public route inventory, never credential access or inference.
 * Advertisement cannot establish account, ZDR, compiler or paid admission. */
import {z} from 'zod';
export const PINNED_PUBLIC_ROUTE=Object.freeze({model:'google/gemini-2.5-flash-lite',provider:'google-vertex/eu',url:'https://openrouter.ai/api/v1/models/google/gemini-2.5-flash-lite/endpoints'} as const);
const inventory=z.object({data:z.object({id:z.literal(PINNED_PUBLIC_ROUTE.model),endpoints:z.array(z.object({tag:z.string().max(128).regex(/^[a-z0-9]+(?:[-/][a-z0-9]+)*$/u),supported_parameters:z.array(z.string().max(64)).max(64)})).max(128)})});
type Reason='PINNED_PUBLIC_ENDPOINT_ABSENT'|'PINNED_PUBLIC_ENDPOINT_LISTED'|'PUBLIC_METADATA_INVALID'|'PUBLIC_METADATA_HTTP_REJECTED'|'PUBLIC_METADATA_UNAVAILABLE';
function result(status:'BLOCKED'|'ADVERTISED'|'UNVERIFIED',reason:Reason){return {status,reason,model:PINNED_PUBLIC_ROUTE.model,provider:PINNED_PUBLIC_ROUTE.provider,inferenceAdmission:'UNVERIFIED' as const,credentialReads:0 as const,inferenceRequests:0 as const};}
export function inspectPinnedPublicRoute(raw:unknown){
 const parsed=inventory.safeParse(raw);if(!parsed.success)return result('UNVERIFIED','PUBLIC_METADATA_INVALID');
 const tags=parsed.data.data.endpoints.map(endpoint=>endpoint.tag);
 // Exact pin only. Another region, base slug or AI Studio is no substitute.
 return {...(tags.includes(PINNED_PUBLIC_ROUTE.provider)?result('ADVERTISED','PINNED_PUBLIC_ENDPOINT_LISTED'):result('BLOCKED','PINNED_PUBLIC_ENDPOINT_ABSENT')),advertisedProviderTags:tags};
}
export async function fetchPinnedPublicRoute(network:typeof fetch=fetch){
 try{
  const response=await network(PINNED_PUBLIC_ROUTE.url,{method:'GET',headers:{Accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(15000)});
  if(response.status!==200)return {...result('UNVERIFIED','PUBLIC_METADATA_HTTP_REJECTED'),metadataHttpStatus:response.status};
  const reader=response.body?.getReader();if(!reader)return {...result('UNVERIFIED','PUBLIC_METADATA_INVALID'),metadataHttpStatus:200};
  const chunks:Uint8Array[]=[];let size=0;
  for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>2097152){void reader.cancel().catch(()=>{});return {...result('UNVERIFIED','PUBLIC_METADATA_INVALID'),metadataHttpStatus:200};}chunks.push(part.value);}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  const decoded=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  return {...inspectPinnedPublicRoute(JSON.parse(decoded)),metadataHttpStatus:200};
 }catch{return result('UNVERIFIED','PUBLIC_METADATA_UNAVAILABLE');}
}

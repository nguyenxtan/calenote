// @vitest-environment node
import {expect,it,vi} from 'vitest';
import {inspectPinnedPublicRoute,fetchPinnedPublicRoute} from './context-public-route';
const endpoint=(tag:string)=>({tag,supported_parameters:['response_format','structured_outputs','max_tokens','temperature']});
const inventory=(tags:string[])=>({data:{id:'google/gemini-2.5-flash-lite',endpoints:tags.map(endpoint)}});
it('blocks the pinned Vertex EU route when only AI Studio or another Vertex region exists',()=>{
 for(const tags of [['google-ai-studio','google-ai-studio/flex'],['google-vertex','google-vertex/us'],[]])expect(inspectPinnedPublicRoute(inventory(tags))).toMatchObject({status:'BLOCKED',reason:'PINNED_PUBLIC_ENDPOINT_ABSENT',model:'google/gemini-2.5-flash-lite',provider:'google-vertex/eu',inferenceAdmission:'UNVERIFIED'});
});
it('advertisement is not paid admission and never selects a substitute',()=>{
 const result=inspectPinnedPublicRoute(inventory(['google-ai-studio','google-vertex/eu']));
 expect(result).toMatchObject({status:'ADVERTISED',reason:'PINNED_PUBLIC_ENDPOINT_LISTED',inferenceAdmission:'UNVERIFIED'});
 expect(inspectPinnedPublicRoute({data:{id:'another/model',endpoints:[endpoint('google-vertex/eu')]}}).status).toBe('UNVERIFIED');
 expect(inspectPinnedPublicRoute({data:{id:'google/gemini-2.5-flash-lite',endpoints:[{tag:'google-vertex/eu'}]}}).status).toBe('UNVERIFIED');
});
it('issues only one unauthenticated GET to the fixed public inventory URL',async()=>{
 const network=vi.fn(async(url:unknown,init:RequestInit|undefined)=>{
  expect(url).toBe('https://openrouter.ai/api/v1/models/google/gemini-2.5-flash-lite/endpoints');
  expect(init?.method).toBe('GET');expect(new Headers(init?.headers).has('Authorization')).toBe(false);expect(init?.body).toBeUndefined();expect(init?.redirect).toBe('error');
  return new Response(JSON.stringify(inventory(['google-ai-studio'])),{status:200});
 });
 expect(await fetchPinnedPublicRoute(network)).toMatchObject({status:'BLOCKED',metadataHttpStatus:200,credentialReads:0,inferenceRequests:0});expect(network).toHaveBeenCalledTimes(1);
});
it('fails closed on malformed, oversized and non-200 metadata without retries',async()=>{
 for(const response of [new Response('bad-json'),new Response('{}',{status:503}),new Response('x'.repeat(2097153)),new Response(JSON.stringify({data:{id:'google/gemini-2.5-flash-lite',endpoints:[{tag:'private\nvalue'}]}}))]){
  const network=vi.fn(async()=>response);
  expect((await fetchPinnedPublicRoute(network)).status).toBe('UNVERIFIED');expect(network).toHaveBeenCalledTimes(1);
 }
 const network=vi.fn(async()=>{throw Error('private transport error');});
 expect(JSON.stringify(await fetchPinnedPublicRoute(network))).not.toContain('private transport error');expect(network).toHaveBeenCalledTimes(1);
});

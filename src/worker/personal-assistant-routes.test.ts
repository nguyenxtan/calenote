import { expect, it, vi } from 'vitest';
import { initialPersonalAssistantDocument } from '@/contracts/api/personal-assistant';
import { createRouter } from './router';
const origin='https://calenote.iconiclogs.com';
const context={waitUntil:vi.fn()} as unknown as ExecutionContext;
const env={APP_ORIGIN:origin,CALENOTE_RUNTIME_ENVIRONMENT:'production',ASSETS:{fetch:vi.fn()},DB:{},JOBS:{send:vi.fn()},CALENOTE_MASTER_KEY:'A'.repeat(43)} as unknown as Env;
const path='/api/v1/personal-assistant';
function request(suffix='',method='GET',body?:unknown,options:{anonymous?:boolean;origin?:string}={}) {
 return new Request(origin+path+suffix,{method,headers:{...(options.anonymous?{}:{cookie:'__Host-calenote_session='+'A'.repeat(43)}),origin:options.origin??origin,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
}
function fixture() {
 const document=initialPersonalAssistantDocument();
 const brief={date:'2026-10-20',openCount:1,overdueCount:0,doneTodayCount:0,next:[]};
 const ops={requireUser:vi.fn(async()=>({userId:'owned'})),consume:vi.fn(async()=>{}),store:{get:vi.fn(async()=>({revision:0,document})),put:vi.fn(async()=>({revision:1,document}))},getBrief:vi.fn(async()=>brief)};
 const create=vi.fn(async()=>ops);
 return {route:createRouter({personalAssistantOperations:create}),create,ops,document,brief};
}
it('returns private 401 responses for anonymous document and brief requests before factory access',async()=>{
 const {route,create}=fixture();
 for(const req of [request('','GET',undefined,{anonymous:true}),request('','PUT',{expectedRevision:0,document:initialPersonalAssistantDocument()},{anonymous:true}),request('/brief','GET',undefined,{anonymous:true})]) {
  const response=await route(req,env,context);
  expect(response.status).toBe(401);expect(response.headers.get('cache-control')).toBe('no-store');expect(response.headers.get('vary')).toBe('Cookie');
 }
 expect(create).not.toHaveBeenCalled();
});
it('matches GET, PUT and brief routes using authenticated ownership',async()=>{
 const {route,ops,document,brief}=fixture();
 const get=await route(request(),env,context);expect(get.status).toBe(200);expect(await get.json()).toEqual({data:{revision:0,document}});
 const put=await route(request('','PUT',{expectedRevision:0,document}),env,context);expect(put.status).toBe(200);expect(await put.json()).toEqual({data:{revision:1,document}});
 const result=await route(request('/brief'),env,context);expect(result.status).toBe(200);expect(await result.json()).toEqual({data:brief});
 expect(ops.store.get).toHaveBeenCalledWith('owned');expect(ops.store.put).toHaveBeenCalledWith('owned',0,document);expect(ops.getBrief).toHaveBeenCalledWith('owned');
 expect(ops.consume).toHaveBeenCalledTimes(3);expect(ops.consume).toHaveBeenLastCalledWith('owned');
 for(const response of [get,put,result]){expect(response.headers.get('cache-control')).toBe('no-store');expect(response.headers.get('vary')).toBe('Cookie');}
});
it('rejects cross-origin writes before factory access and returns 404 for unsupported methods',async()=>{
 const {route,create,ops,document}=fixture();
 const blocked=await route(request('','PUT',{expectedRevision:0,document},{origin:'https://evil.example'}),env,context);
 expect(blocked.status).toBe(403);expect(blocked.headers.get('vary')).toBe('Cookie');expect(ops.store.put).not.toHaveBeenCalled();
 for(const req of [request('','POST',{}),request('','DELETE'),request('/brief','PUT',{})]) expect((await route(req,env,context)).status).toBe(404);
 expect(create).not.toHaveBeenCalled();
});

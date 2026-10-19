import {it,expect,vi} from 'vitest';
import {createRouter} from './router';
const origin='https://calenote.iconiclogs.com';
const context={waitUntil:vi.fn()} as unknown as ExecutionContext;
const env={APP_ORIGIN:origin,CALENOTE_RUNTIME_ENVIRONMENT:'production',ASSETS:{fetch:vi.fn()},DB:{},JOBS:{send:vi.fn()},CALENOTE_MASTER_KEY:'A'.repeat(43)} as unknown as Env;
function request(path:string,method='GET',body?:unknown,options:{cookie?:boolean;origin?:string}={}) {
 return new Request(origin+path,{method,headers:{...(options.cookie===false?{}:{cookie:'__Host-calenote_session='+'A'.repeat(43)}),origin:options.origin??origin,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
}
it('rejects missing sessions before creating follow-through operations',async()=>{
 const create=vi.fn();const route=createRouter({followThroughOperations:create});
 const response=await route(request('/api/v1/follow-through','GET',undefined,{cookie:false}),env,context);
 expect((await route(request('/api/v1/follow-through/history?publicId=work','GET',undefined,{cookie:false}),env,context)).status).toBe(401);
 expect(response.status).toBe(401);expect(response.headers.get('vary')).toBe('Cookie');expect(create).not.toHaveBeenCalled();
});
it('rejects cross-origin actions and oversized JSON before accessing work',async()=>{
 const create=vi.fn();const route=createRouter({followThroughOperations:create});
 expect((await route(request('/api/v1/follow-through/actions','POST',{}, {origin:'https://evil.example'}),env,context)).status).toBe(403);
 expect((await route(request('/api/v1/follow-through/actions','POST',{value:'x'.repeat(3000)}),env,context)).status).toBe(413);
 expect(create).not.toHaveBeenCalled();
});

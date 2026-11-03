import {expect,it,vi} from 'vitest';
import {createRouter} from './router';
import {releaseCatalog} from '@/modules/releases/catalog';
import {SessionAuthError} from '@/modules/auth/session';
const origin='https://calenote.iconiclogs.com',env={APP_ORIGIN:origin,CALENOTE_RUNTIME_ENVIRONMENT:'production'} as unknown as Env,context={} as ExecutionContext;
function fixture(){
 const requireUser=vi.fn(async()=>({userId:'member-owned'}));
 const factory=vi.fn(async()=>({requireUser}));
 return {requireUser,factory,route:createRouter({authOperations:factory as never})};
}
function request(cookie?:string,method='GET'){return new Request(origin+'/api/product-updates',{method,headers:cookie?{cookie}:{}});}
it('returns authenticated shared notes with no-store and no other account state',async()=>{
 const s=fixture(),response=await s.route(request('__Host-calenote_session='+'A'.repeat(43)),env,context);
 expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toBe('no-store');expect(response.headers.get('vary')).toBe('Cookie');
 expect(await response.json()).toEqual({data:{readerId:'member-owned',catalog:releaseCatalog}});expect(s.requireUser).toHaveBeenCalledOnce();
});
it('rejects anonymous/expired sessions and unsupported methods',async()=>{
 const s=fixture();const anonymous=await s.route(request(),env,context);expect(anonymous.status).toBe(401);expect(s.factory).not.toHaveBeenCalled();
 expect(anonymous.headers.get('cache-control')).toBe('no-store');expect(anonymous.headers.get('vary')).toBe('Cookie');
 s.requireUser.mockRejectedValue(new SessionAuthError());
 expect((await s.route(request('__Host-calenote_session='+'A'.repeat(43)),env,context)).status).toBe(401);
 expect((await s.route(request(undefined,'POST'),env,context)).status).toBe(404);
});

it('exposes opt-in runtime identity from the responding Worker, keeping legacy/member responses compatible',async()=>{
 const s=fixture(),versionId='5479e5bc-6cd0-4628-b7ca-8f249cfc0ef9',tag='78334ca3bb6703164cffa1e42b408c321687d959';
 const current={...env,CF_VERSION_METADATA:{id:versionId,tag,timestamp:'2026-10-20T09:38:00Z'}} as Env;
 const url=origin+'/api/product-updates/runtime';
 const response=await s.route(new Request(url,{headers:{cookie:'__Host-calenote_session='+'A'.repeat(43)}}),current,context);
 expect(await response.json()).toEqual({data:{readerId:'member-owned',catalog:releaseCatalog,runtime:{status:'SERVING',versionId,tag}}});
 expect(response.headers.get('cache-control')).toBe('no-store');expect(response.headers.get('vary')).toBe('Cookie');
 const legacy=await s.route(request('__Host-calenote_session='+'A'.repeat(43)),current,context);
 expect((await legacy.json() as {data:object}).data).not.toHaveProperty('runtime');
 const anonymous=await s.route(new Request(url),current,context);expect(anonymous.status).toBe(401);expect(await anonymous.text()).not.toContain(versionId);
});

it('varies anonymous and expired runtime errors by Cookie without leaking runtime identity',async()=>{
 const s=fixture();const url=origin+'/api/product-updates/runtime';
 for(const cookie of [undefined,'__Host-calenote_session='+'A'.repeat(43)]){
  s.requireUser.mockRejectedValue(new SessionAuthError());
  const response=await s.route(new Request(url,{headers:cookie?{cookie}:{}}),env,context);
  expect(response.status).toBe(401);expect(response.headers.get('cache-control')).toBe('no-store');expect(response.headers.get('vary')).toBe('Cookie');
 }
});

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

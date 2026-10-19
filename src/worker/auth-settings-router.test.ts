import {describe,it,expect,vi} from 'vitest';
import {createRouter} from './router';
import {SessionAuthError} from '@/modules/auth/session';
import {InvalidAccountInputError} from '@/modules/account/service';
const origin='https://calenote.iconiclogs.com';
const user={displayName:'Mai',email:'mai@example.test',timezone:'Asia/Ho_Chi_Minh'} as const;
const env={APP_ORIGIN:origin,CALENOTE_RUNTIME_ENVIRONMENT:'production',ASSETS:{fetch:vi.fn(()=>new Response('asset'))}} as unknown as Env;
const ctx={waitUntil:vi.fn()} as unknown as ExecutionContext;
const req=(path:string,method='GET',body?:unknown)=>new Request(origin+path,{method,headers:{origin,'content-type':'application/json',cookie:'__Host-calenote_session='+ 'A'.repeat(43)},...(body===undefined?{}:{body:JSON.stringify(body)})});
const account=()=>({requireUser:vi.fn(async()=>({userId:'owner',sessionId:'current'})),getProfile:vi.fn(async()=>user),updateProfile:vi.fn(async()=>user),listSessions:vi.fn(async()=>[]),revokeOtherSessions:vi.fn(async()=>({revoked:1}))});
describe('auth and account public router wiring',()=>{
 it('classifies new email without issuing login credentials',async()=>{
  const continueEmail=vi.fn(async()=>({next:'SETUP' as const}));
  const route=createRouter({emailDiscoveryOperations:async()=>({continueEmail})});
  const r=await route(req('/api/auth/continue','POST',{email:'new@example.test'}),env,ctx);
  expect(r.status).toBe(200);expect(await r.json()).toEqual({data:{next:'SETUP'}});expect(r.headers.has('set-cookie')).toBe(false);
 });
 it('routes profile and session endpoints through authenticated operations',async()=>{
  const ops=account(),route=createRouter({accountOperations:async()=>ops});
  for(const [path,method,body] of [['/api/account/profile','GET',undefined],['/api/account/profile','PATCH',{displayName:'Mai'}],['/api/account/sessions','GET',undefined],['/api/account/sessions/revoke-others','POST',{}]] as const){
   const r=await route(req(path,method,body),env,ctx);expect(r.status).toBe(200);expect(r.headers.get('vary')).toContain('Cookie');expect(r.headers.get('cache-control')).toContain('no-store');
  }
  expect(ops.updateProfile).toHaveBeenCalledWith('owner',{displayName:'Mai'});
 });
 it('preserves safe error statuses and private response headers',async()=>{
  const ops=account();ops.requireUser.mockRejectedValue(new SessionAuthError());
  const route=createRouter({accountOperations:async()=>ops});const denied=await route(req('/api/account/profile'),env,ctx);expect(denied.status).toBe(401);expect(denied.headers.get('vary')).toContain('Cookie');
  ops.requireUser.mockResolvedValue({userId:'owner',sessionId:'current'});ops.updateProfile.mockRejectedValue(new InvalidAccountInputError());
  expect((await route(req('/api/account/profile','PATCH',{displayName:'Mai'}),env,ctx)).status).toBe(400);
 });
});

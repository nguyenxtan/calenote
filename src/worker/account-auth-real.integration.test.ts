import {expect,it,vi} from 'vitest';
import {SqliteD1Database} from '@/testing/sqlite-d1.test-support';
import {createKeyring} from '@/modules/security/keyring';
import {prepareSession} from '@/modules/auth/session';
import {createRouter} from './router';

it('executes discovery and profile/session operations through the real router, keyring and SQLite',async()=>{
 const db=new SqliteD1Database(),now=Date.now(),master='A'.repeat(43);try{
  db.sqlite.prepare("INSERT INTO users VALUES('owner','owner@example.test','Old name','Asia/Ho_Chi_Minh',?,?)").run(now,now);
  db.sqlite.prepare("INSERT INTO users VALUES('foreign','foreign@example.test','Foreign','Asia/Ho_Chi_Minh',?,?)").run(now,now);
  const keyring=await createKeyring(master);const current=await prepareSession('owner',{keyring,now:()=>now});const other=await prepareSession('owner',{keyring,now:()=>now});const foreign=await prepareSession('foreign',{keyring,now:()=>now});
  for(const [owner,session] of [['owner',current],['owner',other],['foreign',foreign]] as const)db.sqlite.prepare('INSERT INTO sessions VALUES(?,?,?,?,NULL,?)').run(session.record.id,owner,session.record.digest,session.record.expiresAt,now);
  const origin='https://calenote.iconiclogs.com',env={DB:db,CALENOTE_MASTER_KEY:master,APP_ORIGIN:origin,CALENOTE_RUNTIME_ENVIRONMENT:'production',JOBS:{send:vi.fn()},ASSETS:{fetch:vi.fn()}} as unknown as Env;
  const route=createRouter(),ctx={waitUntil:vi.fn()} as unknown as ExecutionContext;
  const req=(path:string,method='GET',body?:unknown,cookie=current.cookie.split(';')[0])=>new Request(origin+path,{method,headers:{origin,cookie,'content-type':'application/json','CF-Connecting-IP':'192.0.2.10'},...(body===undefined?{}:{body:JSON.stringify(body)})});
  let r=await route(req('/api/auth/continue','POST',{email:'new@example.test'}),env,ctx);expect(r.status).toBe(200);expect(await r.json()).toEqual({data:{next:'SETUP'}});expect(r.headers.has('set-cookie')).toBe(false);expect(env.JOBS.send).not.toHaveBeenCalled();
  r=await route(req('/api/account/profile','PATCH',{displayName:'  Updated  '}),env,ctx);expect(r.status).toBe(200);expect(await r.json()).toEqual({data:{user:{displayName:'Updated',email:'owner@example.test',timezone:'Asia/Ho_Chi_Minh'}}});
  r=await route(req('/api/session'),env,ctx);expect((await r.json() as {data:{user:{displayName:string}}}).data.user.displayName).toBe('Updated');
  r=await route(req('/api/account/sessions'),env,ctx);const sessions=await r.json();expect(JSON.stringify(sessions)).not.toContain('digest');expect(JSON.stringify(sessions)).not.toContain(foreign.record.id);
  r=await route(req('/api/account/sessions/revoke-others','POST',{}),env,ctx);expect(r.status).toBe(200);expect(await r.json()).toEqual({data:{revoked:1}});
  expect((await route(req('/api/account/profile'),env,ctx)).status).toBe(200);
  expect((await route(req('/api/account/profile','GET',undefined,other.cookie.split(';')[0]),env,ctx)).status).toBe(401);
  expect((await route(req('/api/account/profile','GET',undefined,foreign.cookie.split(';')[0]),env,ctx)).status).toBe(200);
 }finally{db.close();}
});

// @vitest-environment node
import { expect,it,vi } from 'vitest';
import { createRouter } from '@/worker/router';
import { createKeyring } from '@/modules/security/keyring';
import { prepareSession } from '@/modules/auth/session';
import { SqliteD1Database } from '@/testing/sqlite-d1.test-support';
it('dispatches the actual admin route with real auth and default deny before any aggregate query',async()=>{
 const db=new SqliteD1Database({conversationV2:true});
 try{
 const now=Date.now();const master='A'.repeat(43);const keyring=await createKeyring(master);
 db.sqlite.prepare("INSERT INTO users VALUES ('admin-fixture','not-returned@example.invalid','Fixture','Asia/Ho_Chi_Minh',?,?)").run(now,now);
 const session=await prepareSession('admin-fixture',{keyring,now:()=>now});
 db.sqlite.prepare('INSERT INTO sessions VALUES (?,?,?,?,NULL,?)').run(session.record.id,'admin-fixture',session.record.digest,session.record.expiresAt,now);
 const env={APP_ORIGIN:'https://calenote.iconiclogs.com',CALENOTE_RUNTIME_ENVIRONMENT:'production',DB:db,CALENOTE_MASTER_KEY:master} as unknown as Env;
 const prepare=vi.spyOn(db,'prepare');const aggregates=()=>prepare.mock.calls.filter(([sql])=>/FROM users|FROM audit_events|FROM semantic_budget_reservations/.test(sql));
 const router=createRouter();const request=(cookie?:string)=>new Request('https://calenote.iconiclogs.com/api/admin/overview',{headers:cookie?{cookie}:{}});
 expect((await router(request(),env,{} as ExecutionContext)).status).toBe(401);expect(aggregates()).toHaveLength(0);
 const cookie=session.cookie.split(';')[0];expect((await router(request(cookie),env,{} as ExecutionContext)).status).toBe(403);expect(aggregates()).toHaveLength(0);
 const allowed={...env,CALENOTE_ADMIN_USER_IDS:'admin-fixture'};
 expect((await router(request('__Host-calenote_session='+ 'B'.repeat(43)),allowed,{} as ExecutionContext)).status).toBe(401);expect(aggregates()).toHaveLength(0);
 const response=await router(request(cookie),allowed,{} as ExecutionContext);
 expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toBe('no-store');expect(aggregates()).toHaveLength(3);
 const text=await response.text();expect(text).not.toMatch(/not-returned@example|admin-fixture|bearer|digest/);
 }finally{db.close();}
});

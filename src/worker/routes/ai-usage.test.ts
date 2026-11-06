import {expect,it,vi} from 'vitest';
import {createRouter} from '../router';
const origin='https://calenote.iconiclogs.com',cookie=`__Host-calenote_session=${'A'.repeat(43)}`;
const principal={userId:'owner',sessionId:'session',expiresAt:9999999999999};
const period={key:'2026-11',dispatchedCalls:0,knownCalls:0,knownCostMicrounits:0,unknownCalls:0,unknownMaximumMicrounits:0,pendingCalls:0,pendingMaximumMicrounits:0,budgetedCalls:0,budgetedCostMicrounits:0};
it('authenticates first, selects the principal only and serves private no-store aggregates',async()=>{
 const snapshot={schemaVersion:'ai-usage-1' as const,asOf:'2026-11-06T00:00:00Z',timezone:'UTC' as const,currency:'USD' as const,runtime:'OFF' as const,limits:null,day:{...period,key:'2026-11-06'},month:period};
 const ops={requireUser:vi.fn(async()=>principal),readUsage:vi.fn(async()=>snapshot)};
 const factory=vi.fn(async()=>ops),router=createRouter({aiUsageOperations:factory});
 const request=(headers:HeadersInit={})=>router(new Request(`${origin}/api/ai-usage?ownerId=foreign`,{headers}),{APP_ORIGIN:origin,CALENOTE_RUNTIME_ENVIRONMENT:"production"} as Env,{} as ExecutionContext);
 expect((await request()).status).toBe(401);expect(factory).not.toHaveBeenCalled();
 const response=await request({cookie});expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toContain('no-store');
 expect(response.headers.get('vary')).toContain('Cookie');expect(await response.json()).toEqual({data:snapshot});expect(ops.readUsage).toHaveBeenCalledExactlyOnceWith(principal);
});

it('uses actual cookie authentication and owner SQL guard without calling an external service',async()=>{
 const {SqliteD1Database}=await import('@/testing/sqlite-d1.test-support');
 const {createKeyring}=await import('@/modules/security/keyring');
 const {prepareSession}=await import('@/modules/auth/session');
 const {createAiUsageOperations}=await import('../composition-root');
 const db=new SqliteD1Database({conversationV2:true}),now=Date.now(),master='A'.repeat(43);
 try{
  db.sqlite.prepare("INSERT INTO users VALUES ('owner','private@example.invalid','Private','Asia/Ho_Chi_Minh',?,?)").run(now,now);
  const session=await prepareSession('owner',{keyring:await createKeyring(master),now:()=>now});
  db.sqlite.prepare('INSERT INTO sessions VALUES (?,?,?,?,NULL,?)').run(session.record.id,'owner',session.record.digest,session.record.expiresAt,now);
  const send=vi.fn(),fetchAsset=vi.fn(),env={DB:db,CALENOTE_MASTER_KEY:master,JOBS:{send},ASSETS:{fetch:fetchAsset},AI_MODE:'off',APP_ORIGIN:origin,CALENOTE_RUNTIME_ENVIRONMENT:'production'} as unknown as Env;
  const ops=await createAiUsageOperations(env),router=createRouter({aiUsageOperations:async()=>ops});
  const read=(cookie:string)=>router(new Request(`${origin}/api/ai-usage`,{headers:{cookie}}),env,{} as ExecutionContext);
  const response=await read(session.cookie.split(';')[0]);expect(response.status).toBe(200);
  const body=await response.text();expect(body).not.toMatch(/private@example|digest|session|owner/);expect(JSON.parse(body).data.runtime).toBe('OFF');
  expect((await read(`__Host-calenote_session=${'B'.repeat(43)}`)).status).toBe(401);
  db.sqlite.prepare('UPDATE sessions SET revoked_at=?').run(now);
  expect((await read(session.cookie.split(';')[0])).status).toBe(401);expect(send).not.toHaveBeenCalled();expect(fetchAsset).not.toHaveBeenCalled();
 }finally{db.close();}
});

// @vitest-environment node
import {expect,it,vi} from 'vitest';
import {readFileSync,readdirSync} from 'node:fs';
import {SqliteD1Database} from '@/testing/sqlite-d1.test-support';
import {createKeyring} from '@/modules/security/keyring';
import {prepareSession} from '@/modules/auth/session';
import {createRouter} from './router';
import {createCalendarExportOperations,createCalendarSyncOperations} from './composition-root';
import {runScheduledWork} from './index';
const origin='https://calenote.iconiclogs.com';
it('composes real owner cookie export and disabled sync without any provider or queue side effect',async()=>{
 const db=new SqliteD1Database({skipInit:true}),now=Date.now(),master='A'.repeat(43),external=vi.spyOn(globalThis,'fetch');
 try{
  for(const file of readdirSync('migrations').filter(name=>name.endsWith('.sql')).sort())db.sqlite.exec(readFileSync('migrations/'+file,'utf8'));
  db.sqlite.prepare("INSERT INTO users VALUES ('owner','private@example.invalid','Private','Asia/Ho_Chi_Minh',?,?)").run(now,now);
  const session=await prepareSession('owner',{keyring:await createKeyring(master),now:()=>now});
  db.sqlite.prepare('INSERT INTO sessions VALUES (?,?,?,?,NULL,?)').run(session.record.id,'owner',session.record.digest,session.record.expiresAt,now);
  const send=vi.fn(),env={DB:db,CALENOTE_MASTER_KEY:master,JOBS:{send},ASSETS:{fetch:vi.fn()},AI_MODE:'off',APP_ORIGIN:origin,CALENOTE_RUNTIME_ENVIRONMENT:'production'} as unknown as Env;
  const exportOps=await createCalendarExportOperations(env),syncOps=await createCalendarSyncOperations(env);
  const router=createRouter({calendarExportOperations:async()=>exportOps,calendarSyncOperations:async()=>syncOps});
  const read=(path:string,cookie=session.cookie.split(';')[0])=>router(new Request(origin+path,{headers:{cookie}}),env,{} as ExecutionContext);
  const exported=await read('/api/calendar/export.ics?ownerId=foreign');expect(exported.status).toBe(200);
  expect(exported.headers.get('content-type')).toContain('text/calendar');expect(exported.headers.get('cache-control')).toBe('no-store');
  expect(await exported.text()).toContain('BEGIN:VCALENDAR\r\n');
  const status=await read('/api/calendar/sync');expect(status.status).toBe(200);expect(await status.json()).toMatchObject({data:{available:false,state:'UNAVAILABLE'}});
  const csrf=await router(new Request(origin+'/api/calendar/sync/begin',{method:'POST',headers:{cookie:session.cookie.split(';')[0],'content-type':'application/json'},body:'{}'}),env,{} as ExecutionContext);
  expect(csrf.status).toBe(403);expect(csrf.headers.get('vary')).toContain('Cookie');
  db.sqlite.prepare('UPDATE sessions SET revoked_at=?').run(now);
  for(const path of ['/api/calendar/export.ics','/api/calendar/sync']){const denied=await read(path);expect(denied.status).toBe(401);expect(denied.headers.get('vary')).toContain('Cookie');}
  expect(send).not.toHaveBeenCalled();expect(external).not.toHaveBeenCalled();
 }finally{external.mockRestore();db.close();}
});
it('runs bounded sync redrive independently of reminder scheduling failures',async()=>{
 const redriveCalendarSync=vi.fn(async()=>{}),scheduledTime=Date.now();
 await runScheduledWork({scheduledTime} as ScheduledController,{claimDueReminders:vi.fn(async()=>{throw Error('synthetic failure');}),redriveInboundOrphans:vi.fn(async()=>{}),redriveLoginCodes:vi.fn(async()=>{}),redriveCalendarSync});
 expect(redriveCalendarSync).toHaveBeenCalledExactlyOnceWith(scheduledTime,5);
});

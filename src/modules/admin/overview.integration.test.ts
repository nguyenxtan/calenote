// @vitest-environment node
import { expect,it } from 'vitest';
import { SqliteD1Database } from '@/testing/sqlite-d1.test-support';
import { readAdminOverview } from './overview';
it('counts distinct successful user actions in named VN periods, excluding background cancellations',async()=>{
 const db=new SqliteD1Database({conversationV2:true});
 try{
 const now=Date.parse('2026-03-01T00:30:00+07:00');
 for(const id of ['u1','u2'])db.sqlite.prepare("INSERT INTO users VALUES (?,?,?,'Asia/Ho_Chi_Minh',1,1)").run(id,`${id}@example.invalid`,id);
 const insert=db.sqlite.prepare("INSERT INTO audit_events VALUES (?,?,?,NULL,NULL,NULL,?,?)");
 insert.run('old','u1','LOGIN_VERIFIED','SUCCESS',now-3600000);
 insert.run('one','u1','LOGIN_VERIFIED','SUCCESS',now-1000);insert.run('two','u1','REMINDER_CREATED','SUCCESS',now-500);
 insert.run('scheduler','u2','REMINDER_CANCELLED','SUCCESS',now);insert.run('failed','u2','LOGIN_VERIFIED','FAILURE',now);
 insert.run('future','u2','LOGIN_VERIFIED','SUCCESS',now+1000);insert.run('anonymous',null,'REMINDER_CONFIRMED','SUCCESS',now);
 const r=await readAdminOverview(db as unknown as D1Database,now);
 expect(r.accounts).toEqual({status:'KNOWN',value:2});expect(r.activity.counts).toEqual({status:'KNOWN',value:{dau:1,mau:1}});
 expect(r.budget.ledger).toEqual({status:'KNOWN',value:{reservedOutstanding:0,finalizedInMonth:0}});
 expect(r.providerReportedCost).toEqual({status:'UNKNOWN'});expect(r.activity.coverage).toBe('PARTIAL');expect(r.activity.passiveWebIncluded).toBe(false);
 expect(JSON.stringify(r)).not.toMatch(/u1|example.invalid|scheduler/);
 }finally{db.close();}
});
it('uses reservation grain once despite overlapping budget windows and ceiling finalization',async()=>{
 const db=new SqliteD1Database({conversationV2:true});
 try{
 // Only aggregate semantics are under test: fixture foreign keys are disabled, never production code.
 db.sqlite.exec('PRAGMA foreign_keys=OFF');
 for(const [kind,scope,key] of [['USER_DAILY','u1','2026-03-01'],['USER_MONTHLY','u1','2026-03'],['GLOBAL_DAILY','global','2026-03-01']])db.sqlite.prepare('INSERT INTO semantic_budget_windows VALUES (?,?,?,1,1,100,200)').run(kind,scope,key);
 const insert=db.sqlite.prepare('INSERT INTO semantic_budget_reservations VALUES (?,?,?,?,?,?,?,?,?,?,?)');
 insert.run('r1','u1','i1','2026-03-01','2026-03',100,null,'RESERVED',1001,1,1);
 insert.run('r2','u1','i2','2026-03-01','2026-03',200,200,'FINALIZED',1001,1,1);
 insert.run('r3','u1','i3','2026-02-01','2026-02',300,300,'FINALIZED',1001,1,1);
 const r=await readAdminOverview(db as unknown as D1Database,Date.parse('2026-03-01T00:30:00+07:00'));
 expect(r.budget.ledger).toEqual({status:'KNOWN',value:{reservedOutstanding:100,finalizedInMonth:200}});
 expect(r.budget.finalizedMayIncludeCeilings).toBe(true);expect(r.providerReportedCost.status).toBe('UNKNOWN');
 }finally{db.close();}
});

it('uses the real session/keyring guard, default-denies a valid user and serves only aggregates for an exact test allowlist',async()=>{
 const {createKeyring}=await import('@/modules/security/keyring');
 const {prepareSession}=await import('@/modules/auth/session');
 const {createAdminOverviewOperations}=await import('./composition');
 const {handleAdminOverview}=await import('@/worker/routes/admin-overview');
 const {vi}=await import('vitest');
 const db=new SqliteD1Database({conversationV2:true});
 try{
 const now=Date.now();const master='A'.repeat(43);const keyring=await createKeyring(master);
 db.sqlite.prepare("INSERT INTO users VALUES ('u1','private@example.invalid','Private','Asia/Ho_Chi_Minh',?,?)").run(now,now);
 const session=await prepareSession('u1',{keyring,now:()=>now});
 db.sqlite.prepare('INSERT INTO sessions VALUES (?,?,?,?,NULL,?)').run(session.record.id,'u1',session.record.digest,session.record.expiresAt,now);
 const request=(cookie:string)=>new Request('https://calenote.example/api/admin/overview',{headers:{cookie}});
 const env={DB:db,CALENOTE_MASTER_KEY:master} as unknown as Parameters<typeof createAdminOverviewOperations>[0];
 const ops=createAdminOverviewOperations(env);const read=vi.spyOn(ops,'readOverview');
 expect((await handleAdminOverview(request(session.cookie.split(';')[0]),ops)).status).toBe(403);expect(read).not.toHaveBeenCalled();
 const allowed=createAdminOverviewOperations({...env,CALENOTE_ADMIN_USER_IDS:'u1'});const allowedRead=vi.spyOn(allowed,'readOverview');
 expect((await handleAdminOverview(request('__Host-calenote_session='+ 'B'.repeat(43)),allowed)).status).toBe(401);expect(allowedRead).not.toHaveBeenCalled();
 const response=await handleAdminOverview(request(session.cookie.split(';')[0]),allowed);
 expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toBe('no-store');expect(response.headers.get('vary')).toBe('Cookie');
 const text=await response.text();expect(text).not.toMatch(/private@example|Private|userId|digest/);const data=JSON.parse(text).data;
 expect(data.accounts).toEqual({status:'KNOWN',value:1});expect(data.activity.counts).toEqual({status:'KNOWN',value:{dau:0,mau:0}});expect(allowedRead).toHaveBeenCalledOnce();
 }finally{db.close();}
});

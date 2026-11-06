// @vitest-environment node
import {afterEach,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {SqliteD1Database} from '@/testing/sqlite-d1.test-support';
import {readOwnerAiUsage} from './usage';
const fixtures:SqliteD1Database[]=[];afterEach(()=>fixtures.splice(0).forEach(db=>db.close()));
const now=Date.parse('2026-11-06T01:00:00Z');
const config={runtime:'READY' as const,limits:{dailyCalls:50,monthlyCostMicrounits:500000}};
const principal={userId:'owner',sessionId:'session',expiresAt:now+1000000};
function fixture(){
 const db=new SqliteD1Database({conversationV2:true});fixtures.push(db);db.sqlite.exec(readFileSync('migrations/0023_owner_ai_usage_index.sql','utf8'));db.sqlite.exec('PRAGMA foreign_keys=OFF');
 for(const user of ['owner','foreign'])db.sqlite.prepare("INSERT INTO users VALUES (?,?,?,'Asia/Ho_Chi_Minh',1,1)").run(user,`${user}@example.invalid`,user);
 db.sqlite.prepare("INSERT INTO sessions VALUES ('session','owner','digest',?,NULL,1)").run(now+1000000);
 const add=(id:string,day:string,maximum:number,cost:number|null,state:string,known:number|null,owner='owner',createdAt=now-1000)=>{
  db.sqlite.prepare('INSERT INTO semantic_budget_reservations VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(id,owner,`inbound-${id}`,day,day.slice(0,7),maximum,cost,state,createdAt+300000,createdAt,createdAt);
  if(known!==null)db.sqlite.prepare('INSERT INTO semantic_budget_dispatches VALUES (?,?,?)').run(id,createdAt,known);
 };
 return {db,add,read:(time=now,configuration=config)=>readOwnerAiUsage(db as unknown as D1Database,principal,time,configuration)};
}
it('separates known cost, unknown charges and pending capacity once per reservation in both UTC periods',async()=>{
 const h=fixture();
 h.add('known','2026-11-06',100000,5000,'FINALIZED',1);
 h.add('unknown-final','2026-11-06',50000,50000,'FINALIZED',0);
 h.add('unknown-open','2026-11-06',80000,null,'RESERVED',0);
 h.add('pending','2026-11-06',100000,null,'RESERVED',null);
 h.add('released','2026-11-06',111111,null,'RELEASED',null);
 h.add('earlier','2026-11-05',20000,20000,'FINALIZED',1);
 h.add('old','2026-10-31',3000,3000,'FINALIZED',1);
 h.add('foreign','2026-11-06',999999,999999,'FINALIZED',1,'foreign');
 h.add('future','2026-11-06',100000,100000,'FINALIZED',1,'owner',now+1000);
 for(const [kind,owner,key,rc,fc,rm,fm] of [['USER_DAILY','owner','2026-11-06',2,2,180000,55000],['USER_MONTHLY','owner','2026-11',2,3,180000,75000],['GLOBAL_DAILY','global','2026-11-06',100,100,999999,999999]] as const)
  h.db.sqlite.prepare('INSERT INTO semantic_budget_windows VALUES (?,?,?,?,?,?,?)').run(kind,owner,key,rc,fc,rm,fm);
 const result=await h.read();
 expect(result).toMatchObject({schemaVersion:'ai-usage-1',timezone:'UTC',currency:'USD',runtime:'READY',limits:config.limits,
  day:{key:'2026-11-06',dispatchedCalls:3,knownCalls:1,knownCostMicrounits:5000,unknownCalls:2,unknownMaximumMicrounits:130000,pendingCalls:1,pendingMaximumMicrounits:100000,budgetedCalls:4,budgetedCostMicrounits:235000},
  month:{key:'2026-11',dispatchedCalls:4,knownCalls:2,knownCostMicrounits:25000,unknownCalls:2,unknownMaximumMicrounits:130000,pendingCalls:1,pendingMaximumMicrounits:100000,budgetedCalls:5,budgetedCostMicrounits:255000}});
 expect(JSON.stringify(result)).not.toMatch(/foreign|inbound|digest|example.invalid|reservation|session/);
});
it('uses UTC quota boundaries and returns no invented known costs when empty or AI is off',async()=>{
 const h=fixture(),time=Date.parse('2026-11-01T00:30:00+07:00');
 const result=await readOwnerAiUsage(h.db as unknown as D1Database,principal,time,{runtime:'OFF',limits:null});
 expect(result).toMatchObject({runtime:'OFF',limits:null,day:{key:'2026-10-31',knownCalls:0,knownCostMicrounits:0},month:{key:'2026-10',dispatchedCalls:0,unknownCalls:0}});
});
it.each(['revoked','expired','foreign'] as const)('rechecks %s session ownership inside the aggregate',async type=>{
 const h=fixture();h.add('known','2026-11-06',5000,5000,'FINALIZED',1);
 if(type==='revoked')h.db.sqlite.prepare('UPDATE sessions SET revoked_at=?').run(now-1);
 if(type==='expired')h.db.sqlite.prepare('UPDATE sessions SET expires_at=?').run(now);
 if(type==='foreign')h.db.sqlite.prepare("UPDATE sessions SET user_id='foreign'").run();
 await expect(h.read()).rejects.toMatchObject({name:'SessionAuthError'});
});

it('retains historical finalized charges without dispatch metadata as unknown rather than free',async()=>{
 const h=fixture();h.add('historical','2026-11-06',70000,5000,'FINALIZED',null);
 expect((await h.read()).day).toMatchObject({dispatchedCalls:1,knownCalls:0,knownCostMicrounits:0,unknownCalls:1,unknownMaximumMicrounits:70000});
});

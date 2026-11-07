// @vitest-environment node
import { readFileSync,readdirSync } from 'node:fs';
import { afterEach,expect,it } from 'vitest';
import { semanticRuntime } from '@/modules/semantic/infrastructure/d1/runtime.test-support';
import { migrationStatements } from '@/testing/sqlite-d1.test-support';
import { harness,proposal } from '@/modules/conversation/context-contract/service-test-support';
import { date,now,time } from '@/modules/conversation/context-contract/resolution-test-support';
import { D1CanonicalSeriesStore } from './canonical-series-store';
const disposers:Array<()=>Promise<void>>=[];afterEach(async()=>{await Promise.all(disposers.splice(0).map(fn=>fn()));});
it('real workerd/D1 with all production migrations confirms and atomically cancels an advance group',async()=>{
 const {db,runtime}=await semanticRuntime();disposers.push(()=>runtime.dispose());
 for(const file of readdirSync('migrations').filter(n=>n.endsWith('.sql')).sort())for(const sql of migrationStatements(readFileSync('migrations/'+file,'utf8')))if(sql.replace(/--[^\n]*/gu,'').trim())await db.prepare(sql).run();
 const h=await harness([proposal({title:'họp QA',eventDate:date(2,10,2026),eventTime:time(15)})],undefined,false,db);
 expect(h.f.db).toBe(db);
 h.deps.getReplyPreferences=async()=>({addressStyle:'sep',customDisplayName:null,advanceReminderDays:2,advanceReminderHours:3});
 expect(await h.turn(0,'Ngày02/10/2026 lúc15h có cuộc họp QA, nhắc giúp tôi.')).toEqual({status:'DRAFT_CREATED'});
 expect(await h.turn(1,'Có.')).toEqual({status:'CONFIRMED'});
 const store=new D1CanonicalSeriesStore(db,h.f.keyring),principal={userId:'owner',sessionId:'session',expiresAt:now+1000000};const [series]=await store.list(principal,now+3);
 expect(series.occurrences).toHaveLength(2);
 await db.prepare("CREATE TRIGGER test_cancel_rollback BEFORE UPDATE ON reminder_series BEGIN SELECT RAISE(ABORT,'ROLLBACK_PROBE'); END").run();
 await expect(store.cancel(principal,{publicId:series.publicId,expectedRevision:1},now+4)).rejects.toThrow('ROLLBACK_PROBE');
 expect((await store.list(principal,now+5))[0]).toMatchObject({state:'ACTIVE',revision:1,occurrences:[{status:'PENDING'},{status:'PENDING'}]});
 expect(await db.prepare("SELECT count(*) n FROM audit_events WHERE action='CANONICAL_REMINDER_SERIES_CANCELLED'").first('n')).toBe(0);
 await db.prepare('DROP TRIGGER test_cancel_rollback').run();
 expect(await store.cancel(principal,{publicId:series.publicId,expectedRevision:1},now+6)).toMatchObject({result:'CANCELLED',revision:2,cancelledReminders:2,stoppedTasks:2});
 expect((await store.list(principal,now+7))[0]).toMatchObject({state:'CANCELLED',occurrences:[{status:'CANCELLED'},{status:'CANCELLED'}]});
 expect(await store.cancel(principal,{publicId:series.publicId,expectedRevision:1},now+8)).toMatchObject({result:'ALREADY_CANCELLED'});
 expect(await db.prepare("SELECT count(*) n FROM conversation_contract_write_permits").first('n')).toBe(0);
},30000);

// @vitest-environment node
import {readFileSync,readdirSync} from 'node:fs';
import {afterEach,expect,it} from 'vitest';
import {semanticRuntime} from '@/modules/semantic/infrastructure/d1/runtime.test-support';
import {migrationStatements} from '@/testing/sqlite-d1.test-support';
import {harness,proposal} from '@/modules/conversation/context-contract/service-test-support';
import {date,now,time} from '@/modules/conversation/context-contract/resolution-test-support';
import {D1CalendarExportStore} from './export-store';
const disposers:Array<()=>Promise<void>>=[];afterEach(async()=>{await Promise.all(disposers.splice(0).map(fn=>fn()));});
it('reads one actual event from a service-created advance group on real D1/workerd',async()=>{
 const {db,runtime}=await semanticRuntime();disposers.push(()=>runtime.dispose());
 for(const file of readdirSync('migrations').filter(n=>n.endsWith('.sql')).sort())for(const sql of migrationStatements(readFileSync('migrations/'+file,'utf8')))if(sql.replace(/--[^\n]*/gu,'').trim())await db.prepare(sql).run();
 const h=await harness([proposal({title:'họp QA',eventDate:date(2,10,2026),eventTime:time(15)})],undefined,false,db);
 h.deps.getReplyPreferences=async()=>({addressStyle:'sep',customDisplayName:null,advanceReminderDays:2,advanceReminderHours:3});
 expect(await h.turn(0,'Ngày02/10/2026 lúc15h có cuộc họp QA, nhắc giúp tôi.')).toEqual({status:'DRAFT_CREATED'});
 expect(await h.turn(1,'Có.')).toEqual({status:'CONFIRMED'});
 const result=await new D1CalendarExportStore(db,h.f.keyring).read({userId:'owner',sessionId:'session',expiresAt:now+1_000_000},now+3);
 expect(result).toMatchObject({skipped:0,truncated:false});expect(result.events).toHaveLength(1);expect(result.events[0]).toMatchObject({title:'họp QA',start:{kind:'UTC',timestamp:Date.UTC(2026,9,2,8)}});
},30_000);

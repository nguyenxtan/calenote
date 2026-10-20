// @vitest-environment node
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { fixture } from '@/modules/conversation/context-contract/infrastructure/d1/test-support';
import { initialPersonalAssistantDocument, type PersonalLifeEvent } from '@/contracts/api/personal-assistant';
import { D1PersonalAssistantStore } from './store';
import { D1PersonalAssistantRuntime, personalBrief } from './runtime';
let h: Awaited<ReturnType<typeof fixture>>, store: D1PersonalAssistantStore, runtime: D1PersonalAssistantRuntime;
const now = Date.parse('2026-10-20T00:00:00Z');
const event = (id='birthday'): PersonalLifeEvent => ({id,title:'Sinh nhật riêng tư',kind:'BIRTHDAY',calendar:'SOLAR',month:10,day:20,time:'07:00',leapPolicy:'REGULAR',missingDayPolicy:'SKIP',leadDays:[0],enabled:true});
beforeEach(async()=>{
 h=await fixture();
 for(const migration of ['0014_reminder_follow_through.sql','0015_personal_assistant.sql','0016_personal_assistant_dispatch.sql']) h.sqlite!.sqlite.exec(readFileSync(`migrations/${migration}`,'utf8'));
 await h.db.prepare("INSERT INTO primary_login_channels VALUES('owner','connection','fixture',1)").run();
 store=new D1PersonalAssistantStore(h.db,h.keyring);runtime=new D1PersonalAssistantRuntime(h.db,h.keyring);
});
afterEach(()=>h.close());
async function count(table:string){return h.db.prepare(`SELECT COUNT(*) n FROM ${table}`).first<number>('n');}
it('atomically deduplicates reruns and concurrent dispatch; events track tasks while briefs do not',async()=>{
 const document=initialPersonalAssistantDocument();document.events=[event()];document.daily.morningEnabled=true;
 await store.put('owner',0,document,now);
 const results=await Promise.all([runtime.processDue(now),runtime.processDue(now)]);
 expect(results.reduce((n,r)=>n+r.created,0)).toBe(2);
 expect(results.every(r=>r.failed===0)).toBe(true);
 expect(await count('reminders')).toBe(2);expect(await count('personal_assistant_occurrences')).toBe(2);
 expect(await count('personal_assistant_spawn_permits')).toBe(0);
 expect(await count('follow_through_items')).toBe(1);
 expect(await count('follow_through_runs')).toBe(1);
 expect(await runtime.processDue(now)).toEqual({processed:1,created:0,failed:0});
 const brief=await personalBrief(h.db,h.keyring,'owner',now);
 expect(brief.openCount).toBe(1);expect(brief.next[0].title).toContain('Sinh nhật riêng tư');
 expect((await personalBrief(h.db,h.keyring,'someone-else',now)).next).toEqual([]);
 const raw=JSON.stringify(await h.db.prepare('SELECT * FROM reminders').all());expect(raw).not.toContain('Sinh nhật riêng tư');
});
it('requires owned active primary channel and usable private chat identity',async()=>{
 const document=initialPersonalAssistantDocument();document.events=[event()];await store.put('owner',0,document,now);
 await h.db.prepare("DELETE FROM primary_login_channels WHERE user_id='owner'").run();
 expect((await runtime.processDue(now)).created).toBe(0);
 await h.db.prepare("INSERT INTO primary_login_channels VALUES('owner','connection','fixture',1)").run();
 await h.db.prepare("UPDATE bot_connections SET state='SUSPENDED' WHERE id='connection'").run();
 expect((await runtime.processDue(now)).created).toBe(0);
 await h.db.prepare("UPDATE bot_connections SET state='ACTIVE_BOUND' WHERE id='connection'").run();
 await h.db.prepare("UPDATE chat_identities SET private_chat_id='' WHERE id='identity'").run();
 expect((await runtime.processDue(now)).created).toBe(0);expect(await count('reminders')).toBe(0);
});
it('cancels pending generated work on disable and stops its follow-through',async()=>{
 const document=initialPersonalAssistantDocument();document.events=[event()];await store.put('owner',0,document,now);
 expect((await runtime.processDue(now)).created).toBe(1);
 document.events[0].enabled=false;await store.put('owner',1,document,now+1);
 expect(await h.db.prepare('SELECT status FROM reminders').first('status')).toBe('CANCELLED');
 expect(await h.db.prepare('SELECT progress FROM follow_through_items').first('progress')).toBe('STOPPED');
 expect((await runtime.processDue(now+1)).created).toBe(0);
});
it('bounds owner scans and rotates to later owners without a channel',async()=>{
 const document=initialPersonalAssistantDocument();await store.put('owner',0,document,now);
 await h.db.prepare("INSERT INTO users VALUES('z-owner','z@example.test','Z','Asia/Ho_Chi_Minh',1,1)").run();
 await store.put('z-owner',0,document,now);
 expect(await runtime.processDue(now,1)).toEqual({processed:1,created:0,failed:0});
 expect(await h.db.prepare('SELECT user_id FROM personal_assistant_dispatch_cursor').first('user_id')).toBe('owner');
 expect(await runtime.processDue(now,1)).toEqual({processed:1,created:0,failed:0});
 expect(await h.db.prepare('SELECT user_id FROM personal_assistant_dispatch_cursor').first('user_id')).toBe('z-owner');
 await expect(runtime.processDue(now,101)).rejects.toThrow('Invalid scheduler bound');
});
it('drains more than twenty due annual events across bounded reruns',async()=>{
 const document=initialPersonalAssistantDocument();document.events=Array.from({length:21},(_,i)=>event(`event-${String(i).padStart(2,'0')}`));
 await store.put('owner',0,document,now);
 await runtime.processDue(now);await runtime.processDue(now+1);
 expect(await count('personal_assistant_occurrences')).toBe(21);
});

it('recreates cancelled occurrences only after an enabled document revision; sent work never repeats',async()=>{
 const document=initialPersonalAssistantDocument();document.events=[event()];await store.put('owner',0,document,now);
 await runtime.processDue(now);
 const original=await h.db.prepare('SELECT id FROM reminders').first<string>('id');
 document.events[0].enabled=false;await store.put('owner',1,document,now+1);
 document.events[0].enabled=true;await store.put('owner',2,document,now+2);
 expect((await runtime.processDue(now+3)).created).toBe(1);
 expect(await count('reminders')).toBe(2);expect(await count('personal_assistant_occurrences')).toBe(1);
 expect(await h.db.prepare('SELECT status FROM reminders WHERE id=?').bind(original).first('status')).toBe('CANCELLED');
 await h.db.prepare("UPDATE reminders SET status='SENT' WHERE status='PENDING'").run();
 document.events[0].title='New title';await store.put('owner',3,document,now+5);
 expect((await runtime.processDue(now+6)).created).toBe(0);expect(await count('reminders')).toBe(2);
});
it('catches a delayed scan beyond fifteen minutes without cancelling its current revision',async()=>{
 const document=initialPersonalAssistantDocument();document.events=[{...event(),time:'06:41'}];
 await store.put('owner',0,document,now-20*60_000);
 await h.db.prepare("UPDATE personal_assistant_documents SET last_dispatch_at=? WHERE owner_user_id='owner'").bind(now-20*60_000).run();
 expect(await runtime.processDue(now)).toEqual({processed:1,created:1,failed:0});
 expect(await h.db.prepare('SELECT scheduled_at FROM reminders').first('scheduled_at')).toBe(now-19*60_000);
 expect(await h.db.prepare('SELECT status FROM reminders').first('status')).toBe('PENDING');
 expect(await h.db.prepare("SELECT last_dispatch_at FROM personal_assistant_documents WHERE owner_user_id='owner'").first('last_dispatch_at')).toBe(now);
 expect((await runtime.processDue(now+1)).created).toBe(0);
 expect(await h.db.prepare('SELECT status FROM reminders').first('status')).toBe('PENDING');
});
it('preserves a manual snooze through memory edits and never respawns its overridden annual lineage',async()=>{
 const {D1FollowThroughService}=await import('@/modules/follow-through/service');
 const service=new D1FollowThroughService(h.db,h.keyring,{now:()=>now});
 const document=initialPersonalAssistantDocument();document.events=[event()];await store.put('owner',0,document,now);
 expect((await runtime.processDue(now)).created).toBe(1);
 const root=(await service.list({userId:'owner'})).items[0];
 const snoozed=await service.act({userId:'owner'},{action:'SNOOZE',publicId:root.publicId,expectedRevision:0,idempotencyKey:'manual-snooze',scheduledAt:now+900000});
 expect(snoozed.history).toHaveLength(2);
 document.memories=[{id:'note',label:'Gia đình',value:'Thông tin riêng'}];await store.put('owner',1,document,now+1);
 expect((await runtime.processDue(now+2)).created).toBe(0);
 expect(await count('reminders')).toBe(2);
 expect(await h.db.prepare('SELECT status FROM reminders WHERE public_id=?').bind(snoozed.currentReminderPublicId).first('status')).toBe('PENDING');
 document.events[0].enabled=false;await store.put('owner',2,document,now+3);
 expect(await h.db.prepare('SELECT status FROM reminders WHERE public_id=?').bind(snoozed.currentReminderPublicId).first('status')).toBe('CANCELLED');
 expect((await service.list({userId:'owner'})).items[0].progress).toBe('STOPPED');
 document.events[0].enabled=true;await store.put('owner',3,document,now+4);
 expect((await runtime.processDue(now+5)).created).toBe(0);expect(await count('reminders')).toBe(2);
});
it('excludes daily delivery briefs from personal follow-through lists rather than showing them untracked',async()=>{
 const {D1FollowThroughService}=await import('@/modules/follow-through/service');
 const service=new D1FollowThroughService(h.db,h.keyring,{now:()=>now});
 const document=initialPersonalAssistantDocument();document.events=[event()];document.daily.morningEnabled=true;
 await store.put('owner',0,document,now);expect((await runtime.processDue(now)).created).toBe(2);
 const list=await service.list({userId:'owner'});
 expect(list.items).toHaveLength(1);expect(list.items[0].progress).toBe('OPEN');
 expect(list.items[0].title).toContain('Sinh nhật');expect(list.items.some(item=>item.progress==='UNTRACKED')).toBe(false);
});
it('never resends an already sent event or daily brief when its saved time changes',async()=>{
 const document=initialPersonalAssistantDocument();document.events=[event()];document.daily.morningEnabled=true;
 await store.put('owner',0,document,now);expect((await runtime.processDue(now)).created).toBe(2);
 await h.db.prepare("UPDATE reminders SET status='SENT'").run();
 document.events[0].time='07:01';document.daily.morningTime='07:01';
 await store.put('owner',1,document,now+30_000);
 expect((await runtime.processDue(now+60_000)).created).toBe(0);
 expect(await count('reminders')).toBe(2);
 expect(await count('personal_assistant_occurrences')).toBe(2);
 expect((await h.db.prepare("SELECT status FROM reminders").all<{status:string}>()).results.every(row=>row.status==='SENT')).toBe(true);
});

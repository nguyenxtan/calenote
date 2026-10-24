// @vitest-environment node
import {readFileSync} from 'node:fs';
import {beforeEach,afterEach,it,expect} from 'vitest';
import type {Miniflare} from 'miniflare';
import {semanticRuntime} from '@/modules/semantic/infrastructure/d1/runtime.test-support';
import {createKeyring} from '@/modules/security/keyring';
import {FeedbackCreateSchema,FeedbackPatchSchema} from '@/contracts/api/feedback';
import {D1FeedbackStore} from './store';
let runtime:Miniflare,db:D1Database,store:D1FeedbackStore;
const input=(n=1)=>({requestId:`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,kind:'BUG' as const,title:'Không mở được lịch',description:'Mở trang lịch nhưng không thấy dữ liệu.',page:'/app/calendar' as const});
beforeEach(async()=>{({runtime,db}=await semanticRuntime());await db.prepare('CREATE TABLE users(id TEXT PRIMARY KEY)').run();await db.prepare("INSERT INTO users VALUES('one'),('two'),('admin')").run();await db.exec(readFileSync('migrations/0019_feedback_intake.sql','utf8').replace(/^--.*$/gm,'').replace(/\n/g,' '));store=new D1FeedbackStore(db,await createKeyring('A'.repeat(43)));},20000);
afterEach(async()=>{await runtime?.dispose();});
it('rejects owner/status injection, unbounded text and invalid closure',()=>{
 expect(FeedbackCreateSchema.safeParse({...input(),owner:'two'}).success).toBe(false);
 expect(FeedbackCreateSchema.safeParse({...input(),title:'x'.repeat(121)}).success).toBe(false);
 expect(FeedbackCreateSchema.safeParse({...input(),page:'https://evil.test/?token=secret'}).success).toBe(false);
 expect(FeedbackPatchSchema.safeParse({expectedRevision:1,status:'CLOSED',reply:'',disposition:null}).success).toBe(false);
});
it('stores encrypted text, scopes detail/list and atomically audits without content',async()=>{
 const ticket=await store.create('one',input(),1000);
 expect(ticket).toMatchObject({kind:'BUG',title:input().title,status:'NEW',revision:1,createdAt:1000});
 expect(await store.get('one',ticket.id)).toEqual(ticket);
 await expect(store.get('two',ticket.id)).rejects.toMatchObject({code:'NOT_FOUND'});
 expect((await store.list('two',{})).items).toEqual([]);
 expect((await store.list('one',{})).items[0].id).toBe(ticket.id);
 const raw=JSON.stringify(await db.prepare('SELECT * FROM feedback_tickets').all());
 expect(raw).not.toContain(input().title);expect(raw).not.toContain(input().description);
 const audit=await db.prepare('SELECT * FROM feedback_audit').all();
 expect(audit.results).toHaveLength(1);expect(JSON.stringify(audit)).not.toContain(input().title);
});
it('concurrent replay creates one ticket/audit; changed payload conflicts even at limit',async()=>{
 const tickets=await Promise.all(Array.from({length:5},()=>store.create('one',input(),1000)));
 expect(new Set(tickets.map(t=>t.id)).size).toBe(1);
 expect(await db.prepare('SELECT count(*) AS n FROM feedback_audit').first('n')).toBe(1);
 await expect(store.create('one',{...input(),description:'Nội dung khác không được ghi đè yêu cầu.'},1001)).rejects.toMatchObject({code:'CONFLICT'});
 await Promise.all([store.create('one',input(2),1002),store.create('one',input(3),1003)]);
 expect((await store.create('one',input(),1004)).id).toBe(tickets[0].id);
 await expect(store.create('one',input(4),1005)).rejects.toMatchObject({code:'RATE_LIMITED',status:429});
 expect((await store.list('one',{})).items).toHaveLength(3);
});
it('rolling windows reject concurrent excess, allow after ten minutes and enforce daily20',async()=>{
 const results=await Promise.allSettled(Array.from({length:8},(_,i)=>store.create('one',input(i+1),1000)));
 expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(3);
 await store.create('one',input(100),601001);
 for(let i=4;i<20;i++)await store.create('one',input(100+i),601001+i*601000);
 await expect(store.create('one',input(200),20*601000)).rejects.toMatchObject({code:'RATE_LIMITED'});
 expect((await store.create('one',input(201),86401001)).status).toBe('NEW');
});
it('CAS update commits exactly one audit and requires closure disposition/reply',async()=>{
 const ticket=await store.create('one',input(),1000);
 const patch={expectedRevision:1,status:'IN_PROGRESS' as const,reply:'Đang tái hiện lỗi này.',disposition:null};
 const outcomes=await Promise.allSettled([store.update('admin',ticket.id,patch,2000),store.update('admin',ticket.id,patch,2000)]);
 expect(outcomes.filter(r=>r.status==='fulfilled')).toHaveLength(1);
 expect(outcomes.filter(r=>r.status==='rejected')).toHaveLength(1);
 const closed=await store.update('admin',ticket.id,{expectedRevision:2,status:'CLOSED',reply:'Đã sửa và kiểm tra lại.',disposition:'RESOLVED'},3000);
 expect(closed).toMatchObject({revision:3,status:'CLOSED',disposition:'RESOLVED'});
 expect(await store.get('one',ticket.id)).toEqual(closed);
 const audit=await db.prepare('SELECT * FROM feedback_audit ORDER BY revision').all();expect(audit.results).toHaveLength(3);
 expect(JSON.stringify(audit)).not.toContain('Đã sửa');
 expect(await db.prepare('PRAGMA foreign_key_check').all()).toMatchObject({results:[]});
});
it('paginates and filters within owner scope; rejects tampered ciphertext',async()=>{
 const a=await store.create('one',input(),1000);await store.create('two',input(),1001);
 await store.create('one',{...input(2),kind:'FEATURE'},1002);
 expect((await store.list('one',{kind:'BUG'})).items.map(x=>x.id)).toEqual([a.id]);
 expect((await store.list(null,{status:'NEW'})).items).toHaveLength(3);
 expect((await store.list('one',{after:a.id})).items).toEqual([]);
 await db.prepare('UPDATE feedback_tickets SET content_iv=zeroblob(12),revision=revision+1 WHERE id=?').bind(a.id).run();
 await expect(store.get('one',a.id)).rejects.toThrow();
});
it('rolls back ticket and CAS update when audit persistence fails',async()=>{
 await db.exec("CREATE TRIGGER deny_create BEFORE INSERT ON feedback_audit BEGIN SELECT RAISE(ABORT,'audit unavailable'); END;");
 await expect(store.create('one',input(),1000)).rejects.toThrow();expect(await db.prepare('SELECT count(*) AS n FROM feedback_tickets').first('n')).toBe(0);
 await db.exec('DROP TRIGGER deny_create');const ticket=await store.create('one',input(),1001);
 await db.exec("CREATE TRIGGER deny_update BEFORE INSERT ON feedback_audit WHEN NEW.action='TRIAGE' BEGIN SELECT RAISE(ABORT,'audit unavailable'); END;");
 await expect(store.update('admin',ticket.id,{expectedRevision:1,status:'REVIEWING',reply:'Đang xem xét.',disposition:null},1002)).rejects.toThrow();expect((await store.get('one',ticket.id)).revision).toBe(1);expect(await db.prepare('SELECT count(*) AS n FROM feedback_audit').first('n')).toBe(1);
});
it('paginates all21 matching tickets without duplicate or foreign-owner entries',async()=>{
 for(let i=0;i<21;i++)await store.create('one',input(i+1),1000+i*86400001);
 await store.create('two',input(),22*86400001);
 const first=await store.list('one',{});expect(first.items).toHaveLength(20);expect(first.next).toBe(first.items[19].id);
 const second=await store.list('one',{after:first.next!});expect(second.items).toHaveLength(1);expect(second.next).toBeNull();expect(new Set([...first.items,...second.items].map(t=>t.id)).size).toBe(21);
});

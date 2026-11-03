// @vitest-environment node
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it } from 'vitest';
import type { Miniflare } from 'miniflare';
import { semanticRuntime } from '@/modules/semantic/infrastructure/d1/runtime.test-support';
import { createKeyring } from '@/modules/security/keyring';
import { initialPersonalAssistantDocument } from '@/contracts/api/personal-assistant';
import { D1PersonalAssistantStore } from './store';
let runtime: Miniflare, db: D1Database, store: D1PersonalAssistantStore;
beforeEach(async () => {
  ({runtime, db} = await semanticRuntime());
  await db.prepare('CREATE TABLE users(id TEXT PRIMARY KEY)').run();
  await db.prepare('CREATE TABLE reminders(id TEXT PRIMARY KEY)').run();
  await db.prepare("INSERT INTO users VALUES ('one'), ('two')").run();
  for (const sql of readFileSync('migrations/0015_personal_assistant.sql', 'utf8').split(';').map(s=>s.trim()).filter(Boolean)) await db.prepare(sql).run();
  store = new D1PersonalAssistantStore(db, await createKeyring('A'.repeat(43)));
}, 20000);
afterEach(async () => { await runtime?.dispose(); });
const document = () => ({...initialPersonalAssistantDocument(), memories: [{id:'private', label:'Gia đình', value:'Bí mật của tôi'}]});
it('encrypts the complete document, scopes owners, and supports explicit deletion', async () => {
  expect((await store.get('one')).revision).toBe(0);
  expect(await store.put('one',0,document())).toEqual({revision:1, document:document()});
  expect(JSON.stringify(await db.prepare('SELECT * FROM personal_assistant_documents').first())).not.toContain('Bí mật');
  expect(await store.get('one')).toEqual({revision:1, document:document()});
  expect(await store.get('two')).toEqual({revision:0,document:initialPersonalAssistantDocument()});
  await store.put('one',1,initialPersonalAssistantDocument());
  expect((await store.get('one')).document.memories).toEqual([]);
});
it('rejects stale updates and simultaneous initial writes without overwriting', async () => {
  const results=await Promise.allSettled([store.put('one',0,document()),store.put('one',0,initialPersonalAssistantDocument())]);
  expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
  expect(results.filter(r=>r.status==='rejected')).toHaveLength(1);
  await expect(store.put('one',0,document())).rejects.toMatchObject({code:'CONFLICT'});
  expect((await store.get('one')).revision).toBe(1);
});
it('fails closed for missing schema, unknown owners and swapped owner ciphertext', async () => {
  await expect(store.get('unknown')).rejects.toMatchObject({code:'NOT_FOUND'});
  await store.put('one',0,document());
  await db.prepare(`INSERT INTO personal_assistant_documents SELECT 'two',document_ciphertext,document_iv,document_key_version,schedule_fingerprint,revision,updated_at FROM personal_assistant_documents WHERE owner_user_id='one'`).run();
  await expect(store.get('two')).rejects.toMatchObject({code:'BLOCKED'});
  await db.prepare('DROP TABLE personal_assistant_documents').run();
  await expect(store.get('one')).rejects.toMatchObject({code:'BLOCKED'});
  await expect(store.put('one',0,document())).rejects.toMatchObject({code:'BLOCKED'});
});
it('commits a revision while its migration trigger cancels queued generated work', async () => {
  const { fixture } = await import('@/modules/conversation/context-contract/infrastructure/d1/test-support');
  const h = await fixture();
  try {
    for (const migration of ['0014_reminder_follow_through.sql', '0015_personal_assistant.sql', '0016_personal_assistant_dispatch.sql']) h.sqlite!.sqlite.exec(readFileSync(`migrations/${migration}`, 'utf8'));
    const persisted = new D1PersonalAssistantStore(h.db, h.keyring);
    await persisted.put('owner', 0, document(), 1);
    const title = await h.keyring.encryptSensitive('reminder-title', 'generated', 1, 'Queued private work');
    await h.db.prepare(`INSERT INTO reminders(id,public_id,workspace_id,chat_identity_id,title_ciphertext,title_iv,title_key_version,scheduled_at,timezone,status,created_at,updated_at) VALUES('generated','generated-public','workspace','identity',?,?,1,60000,'Asia/Ho_Chi_Minh','PENDING',1,1)`).bind(title.ciphertext,title.iv).run();
    await h.db.prepare(`INSERT INTO personal_assistant_occurrences(owner_user_id,occurrence_key,reminder_id,kind,document_revision,workspace_id,chat_identity_id,connection_id,scheduled_at,created_at) VALUES('owner','event-one','generated','EVENT',1,'workspace','identity','connection',60000,1)`).run();
    const memoryEdit={...document(), memories:[{id:'private',label:'Gia đình',value:'Thông tin mới'}]};
    expect((await persisted.put('owner',1,memoryEdit,2)).revision).toBe(2);
    expect(await h.db.prepare("SELECT status FROM reminders WHERE id='generated'").first('status')).toBe('PENDING');
    expect(await h.db.prepare("SELECT progress FROM follow_through_items WHERE root_reminder_id='generated'").first('progress')).toBe('OPEN');
    const scheduleEdit={...initialPersonalAssistantDocument(),daily:{...initialPersonalAssistantDocument().daily,morningTime:'09:00'}};
    expect(await persisted.put('owner',2,scheduleEdit,3)).toEqual({revision:3,document:scheduleEdit});
    expect(await h.db.prepare("SELECT status FROM reminders WHERE id='generated'").first('status')).toBe('CANCELLED');
    expect(await h.db.prepare("SELECT progress FROM follow_through_items WHERE root_reminder_id='generated'").first('progress')).toBe('STOPPED');
    await expect(persisted.put('owner',1,document(),3)).rejects.toMatchObject({code:'CONFLICT'});
    expect((await persisted.get('owner')).revision).toBe(3);
  } finally { h.close(); }
});

it('persists private categories without changing reminder scheduling fingerprint',async()=>{
 const base={...document(),events:[{id:'event',title:'Xe',kind:'BIRTHDAY' as const,calendar:'SOLAR' as const,month:1,day:1,time:'08:00',leapPolicy:'REGULAR' as const,missingDayPolicy:'SKIP' as const,leadDays:[0],enabled:false}]};
 await store.put('one',0,base);
 const before=await db.prepare('SELECT schedule_fingerprint FROM personal_assistant_documents').first();
 await store.put('one',1,{...base,categories:[{id:'car',name:'Chăm xe'}],events:[{...base.events[0],kind:'OTHER',categoryId:'car'}]});
 expect(await db.prepare('SELECT schedule_fingerprint FROM personal_assistant_documents').first()).toEqual(before);
 expect((await store.get('one')).document.categories).toEqual([{id:'car',name:'Chăm xe'}]);
 expect((await store.get('two')).document.categories).toBeUndefined();
});

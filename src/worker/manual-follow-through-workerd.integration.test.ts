// @vitest-environment node
import {it,expect} from 'vitest';
import {readFileSync,readdirSync} from 'node:fs';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {migrationStatements} from '@/testing/sqlite-d1.test-support';
import {fixture} from '@/modules/conversation/context-contract/infrastructure/d1/test-support';
import {D1ReminderApiStore} from '@/modules/reminders/infrastructure/d1/api-store';
it('reports the committed manual reminder when workerd counts follow-through trigger writes',async()=>{
 const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:"export default {fetch(){return new Response('ok')}}",compatibilityDate:'2026-09-03',d1Databases:{DB:'00000000-0000-0000-0000-000000000015'},port:0}));
 try{
 const db=await mf.getD1Database('DB') as unknown as D1Database;
 for(const file of readdirSync('migrations').filter(n=>/^00\d\d_.*\.sql$/u.test(n)).sort())for(const sql of migrationStatements(readFileSync('migrations/'+file,'utf8').split('\n').filter(l=>!l.trimStart().startsWith('--')).join('\n')))await db.prepare(sql).run();
 const h=await fixture(db),now=Date.now(),encrypted=await h.keyring.encryptSensitive('reminder-title','manual-root',1,'Release smoke');
 const store=new D1ReminderApiStore(db);
 const committed=await store.createManual({id:'manual-root',publicId:'manual-public',userId:'owner',encryptedTitle:encrypted,titleKeyVersion:1,scheduledAt:now+86400000,timezone:'Asia/Ho_Chi_Minh',auditId:'manual-audit',intentId:'manual_intent_1234',payloadDigest:'digest',now});
 expect(await db.prepare('SELECT count(*) AS n FROM reminders').first('n')).toBe(1);
 expect(await db.prepare('SELECT count(*) AS n FROM follow_through_items').first('n')).toBe(1);
 expect(await db.prepare('SELECT count(*) AS n FROM follow_through_runs').first('n')).toBe(1);
 expect(committed).toBe(true);
 expect(await store.findManualIntent('owner','manual_intent_1234')).toMatchObject({state:'CREATED',public_id:'manual-public'});
 expect(await store.createManual({id:'wrong-owner',publicId:'wrong-public',userId:'missing',encryptedTitle:encrypted,titleKeyVersion:1,scheduledAt:now+86400000,timezone:'Asia/Ho_Chi_Minh',auditId:'wrong-audit',now})).toBe(false);
 expect(await db.prepare('SELECT count(*) AS n FROM reminders').first('n')).toBe(1);
 // An audit uniqueness failure after the root/trigger writes rolls the whole batch back.
 await expect(store.createManual({id:'rollback-root',publicId:'rollback-public',userId:'owner',encryptedTitle:encrypted,titleKeyVersion:1,scheduledAt:now+86400000,timezone:'Asia/Ho_Chi_Minh',auditId:'manual-audit',intentId:'rollback_intent_1234',payloadDigest:'other-digest',now})).rejects.toThrow();
 for(const table of ['reminders','follow_through_items','follow_through_runs','audit_events','manual_reminder_intents'])expect(await db.prepare(`SELECT count(*) AS n FROM ${table}`).first('n')).toBe(1);
 expect((await db.prepare('PRAGMA foreign_key_check').all()).results).toHaveLength(0);
 }finally{await mf.dispose();}
},30000);

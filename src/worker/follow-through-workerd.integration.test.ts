// @vitest-environment node
import {it,expect} from 'vitest';
import {readFileSync,readdirSync} from 'node:fs';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {migrationStatements} from '@/testing/sqlite-d1.test-support';
import {fixture} from '@/modules/conversation/context-contract/infrastructure/d1/test-support';
import {D1FollowThroughService} from '@/modules/follow-through/service';
import {D1ReminderDeliveryStore} from '@/modules/reminders/infrastructure/d1/delivery-store';
it('applies immutable0014 and races independent work mutations on actual workerd D1',async()=>{
 const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:"export default { fetch() { return new Response('ok'); } }",compatibilityDate:'2026-09-03',d1Databases:{DB:'00000000-0000-0000-0000-000000000014'},port:0}));
 try {
 const db=await mf.getD1Database('DB') as unknown as D1Database;
 for(const file of readdirSync('migrations').filter(name=>/^00\d\d_.*\.sql$/u.test(name)).sort())for(const sql of migrationStatements(readFileSync('migrations/'+file,'utf8').split('\n').filter(line=>!line.trimStart().startsWith('--')).join('\n')))await db.prepare(sql).run();
 const h=await fixture(db),now=Date.now(),e=await h.keyring.encryptSensitive('reminder-title','workerd-root',1,'Workerd task');
 await db.prepare("INSERT INTO reminders(id,public_id,workspace_id,chat_identity_id,title_ciphertext,title_iv,title_key_version,scheduled_at,timezone,status,created_at,updated_at) VALUES('workerd-root','workerd-public','workspace','identity',?,?,1,?,'Asia/Ho_Chi_Minh','PENDING',?,?)").bind(e.ciphertext,e.iv,now+60000,now,now).run();
 const a=new D1FollowThroughService(db,h.keyring),b=new D1FollowThroughService(db,h.keyring),scope={userId:'owner'};
 const results=await Promise.allSettled([a.act(scope,{action:'DONE',publicId:'workerd-public',expectedRevision:0,idempotencyKey:'done'}),b.act(scope,{action:'SNOOZE',publicId:'workerd-public',expectedRevision:0,idempotencyKey:'snooze',scheduledAt:now+900000})]);
 expect(results.filter(result=>result.status==='fulfilled')).toHaveLength(1);
 expect(results.filter(result=>result.status==='rejected')).toHaveLength(1);
 const item=(await a.list(scope)).items[0];expect(item.revision).toBe(1);expect(item.history.length).toBe(item.progress==='DONE'?1:2);
 if(item.progress==='OPEN')await a.act(scope,{action:'DONE',publicId:item.publicId,expectedRevision:1,idempotencyKey:'finish'});
 const current=await db.prepare('SELECT current_reminder_id FROM follow_through_items').first<string>('current_reminder_id');
 expect(await new D1ReminderDeliveryStore(db).acquire(current!,'delivery-new','acquire-marker',now+1000000,{publicId:item.publicId,revision:item.progress==='OPEN'?2:1})).not.toMatchObject({status:'OWNED'});
 // More than46 lifetime runs must not exceed D1's100 bound parameters, even for Done.
 const longTitle=await h.keyring.encryptSensitive('reminder-title','long-root',1,'Long-lived task');
 await db.prepare("INSERT INTO reminders(id,public_id,workspace_id,chat_identity_id,title_ciphertext,title_iv,title_key_version,scheduled_at,timezone,status,created_at,updated_at) VALUES('long-root','long-public','workspace','identity',?,?,1,?,'Asia/Ho_Chi_Minh','PENDING',?,?)").bind(longTitle.ciphertext,longTitle.iv,now+60000,now,now).run();
 for(let index=1;index<=48;index++) {
 const id=`historical-${index}`,cipher=await h.keyring.encryptSensitive('reminder-title',id,1,'Long-lived task');
 await db.batch([
 db.prepare('INSERT INTO follow_through_spawn_permits VALUES(?,?,?)').bind(id,'long-root',id),
 db.prepare("INSERT INTO reminders(id,public_id,workspace_id,chat_identity_id,title_ciphertext,title_iv,title_key_version,scheduled_at,timezone,status,created_at,updated_at) VALUES(?,?,'workspace','identity',?,?,1,?,'Asia/Ho_Chi_Minh','CANCELLED',?,?)").bind(id,id,cipher.ciphertext,cipher.iv,now-60000,now,now),
 db.prepare("INSERT INTO follow_through_runs VALUES(?,?,'SNOOZE',?,?)").bind('long-root',id,index,id),
 db.prepare('DELETE FROM follow_through_spawn_permits WHERE reminder_id=?').bind(id),
 ]);
 }
 const finished=await a.act(scope,{action:'DONE',publicId:'long-public',expectedRevision:0,idempotencyKey:'long-done'});
 expect(finished.progress).toBe('DONE');expect(finished.history).toHaveLength(49);
 expect((await db.prepare('PRAGMA foreign_key_check').all()).results).toHaveLength(0);
 expect(await db.prepare('SELECT count(*) FROM follow_through_spawn_permits').first('count(*)')).toBe(0);
 }finally{await mf.dispose();}
},60000);

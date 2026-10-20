import { randomOpaqueId } from '@/modules/platform/types';
import type { Keyring } from '@/modules/security/keyring';
import { persistedD1Blob } from '@/modules/db/persisted-blob';
import { D1PersonalAssistantStore } from './store';
import { planLifeEvents } from './calendar';

const DAY=86_400_000, OFFSET=7*3_600_000;
export async function personalBrief(db:D1Database,keyring:Keyring,userId:string,now:number) {
 const start=Math.floor((now+OFFSET)/DAY)*DAY-OFFSET;
 const scope=`FROM follow_through_items i JOIN reminders r ON r.id=i.current_reminder_id WHERE i.owner_user_id=?`;
 const counts=await db.prepare(`SELECT SUM(CASE WHEN i.progress='OPEN' THEN 1 ELSE 0 END) openCount,SUM(CASE WHEN i.progress='OPEN' AND r.scheduled_at<? THEN 1 ELSE 0 END) overdueCount,SUM(CASE WHEN i.progress='DONE' AND i.completed_at>=? AND i.completed_at<? THEN 1 ELSE 0 END) doneTodayCount ${scope}`).bind(now,start,start+DAY,userId).first<{openCount:number|null;overdueCount:number|null;doneTodayCount:number|null}>();
 const rows=(await db.prepare(`SELECT r.id,r.title_ciphertext,r.title_iv,r.title_key_version,r.scheduled_at ${scope} AND i.progress='OPEN' ORDER BY r.scheduled_at,i.id LIMIT 5`).bind(userId).all<{id:string;title_ciphertext:unknown;title_iv:unknown;title_key_version:number;scheduled_at:number}>()).results;
 const next=await Promise.all(rows.map(async r=>({title:await keyring.decryptSensitive('reminder-title',r.id,r.title_key_version,{ciphertext:persistedD1Blob(r.title_ciphertext),iv:persistedD1Blob(r.title_iv)}),scheduledAt:r.scheduled_at})));
 return {date:new Date(now+OFFSET).toISOString().slice(0,10),openCount:counts?.openCount??0,overdueCount:counts?.overdueCount??0,doneTodayCount:counts?.doneTodayCount??0,next};
}
export class D1PersonalAssistantRuntime {
 constructor(private db:D1Database,private keyring:Keyring){}
 async processDue(now:number,limit=20) {
  if(!Number.isSafeInteger(now)||!Number.isInteger(limit)||limit<1||limit>100)throw new TypeError('Invalid scheduler bound');
  if(!await this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='personal_assistant_occurrences'").first())return {processed:0,created:0,failed:0};
  const cursor=await this.db.prepare('SELECT user_id FROM personal_assistant_dispatch_cursor WHERE id=1').first<{user_id:string}>();
  let owners=(await this.db.prepare('SELECT owner_user_id,updated_at,last_dispatch_at FROM personal_assistant_documents WHERE owner_user_id>? ORDER BY owner_user_id LIMIT ?').bind(cursor?.user_id??'',limit).all<{owner_user_id:string;updated_at:number;last_dispatch_at:number|null}>()).results;
  if(!owners.length)owners=(await this.db.prepare('SELECT owner_user_id,updated_at,last_dispatch_at FROM personal_assistant_documents ORDER BY owner_user_id LIMIT ?').bind(limit).all<{owner_user_id:string;updated_at:number;last_dispatch_at:number|null}>()).results;
  let created=0,failed=0;
  for(const owner of owners){try{created+=await this.processOwner(owner.owner_user_id,now,Math.max(now-7*DAY,Math.min(now,owner.last_dispatch_at??owner.updated_at)-60_000));}catch{failed++;}}
  if(owners.length)await this.db.prepare('INSERT INTO personal_assistant_dispatch_cursor(id,user_id) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET user_id=excluded.user_id').bind(owners.at(-1)!.owner_user_id).run();
  return {processed:owners.length,created,failed};
 }
 private async processOwner(userId:string,now:number,windowStart:number) {
  const envelope=await new D1PersonalAssistantStore(this.db,this.keyring).get(userId);
  const channel=await this.db.prepare(`SELECT c.id connectionId,ci.id chatIdentityId,w.id workspaceId FROM primary_login_channels p JOIN bot_connections c ON c.id=p.connection_id AND c.user_id=p.user_id AND c.state='ACTIVE_BOUND' JOIN chat_identities ci ON ci.connection_id=c.id JOIN workspaces w ON w.owner_user_id=p.user_id AND w.kind='PERSONAL' JOIN memberships m ON m.workspace_id=w.id AND m.user_id=p.user_id AND m.role='OWNER' WHERE p.user_id=? AND length(ci.private_chat_id)>0 AND length(ci.provider_user_id)>0`).bind(userId).all<{connectionId:string;chatIdentityId:string;workspaceId:string}>();
  if(channel.results.length!==1){await this.db.prepare('UPDATE personal_assistant_documents SET last_dispatch_at=? WHERE owner_user_id=? AND revision=?').bind(now,userId,envelope.revision).run();return 0;}
  const targets:{key:string;title:string;scheduledAt:number;kind:'EVENT'|'MORNING'|'EVENING'}[]=planLifeEvents(envelope.document,windowStart,Math.min(366,Math.max(1,Math.ceil((now+60_000-windowStart)/DAY)))).filter(x=>x.scheduledAt<=now+60_000).map(x=>({key:`event:${x.occurrenceKey}`,title:`${x.title} — ${x.leadDays===0?'hôm nay':`còn ${x.leadDays} ngày`} (${x.eventDate})`,scheduledAt:x.scheduledAt,kind:'EVENT'}));
  const date=new Date(now+OFFSET).toISOString().slice(0,10);
  for(const kind of ['MORNING','EVENING'] as const){const morning=kind==='MORNING',d=envelope.document.daily;if(!(morning?d.morningEnabled:d.eveningEnabled))continue;const scheduledAt=Date.parse(`${date}T${morning?d.morningTime:d.eveningTime}:00+07:00`);if(scheduledAt<windowStart||scheduledAt>now+60_000)continue;const brief=await personalBrief(this.db,this.keyring,userId,now);const titles=brief.next.slice(0,3).map(x=>x.title.slice(0,70)).join('; ');targets.push({key:`${kind}:${date}`,kind,scheduledAt,title:`${morning?'Chào buổi sáng':'Nhìn lại hôm nay'}: ${brief.openCount} việc chưa xong, ${brief.overdueCount} việc quá giờ, ${brief.doneTodayCount} việc đã xong hôm nay.${titles?' Đang chờ: '+titles:''}`.slice(0,500)});}
  let created=0;
  const consumed=(await this.db.prepare(`SELECT a.occurrence_key FROM personal_assistant_occurrences a LEFT JOIN reminders r ON r.id=a.reminder_id WHERE a.owner_user_id=? AND a.scheduled_at BETWEEN ? AND ? AND (r.status IS NULL OR r.status!='CANCELLED' OR a.document_revision>=? OR EXISTS(SELECT 1 FROM follow_through_items i JOIN follow_through_runs run ON run.item_id=i.id JOIN reminders child ON child.id=run.reminder_id WHERE i.root_reminder_id=a.reminder_id AND (child.status IN ('SENT','CLAIMED','UNCERTAIN') OR run.kind!='ORIGINAL')))`).bind(userId,windowStart,now+60_000,envelope.revision).all<{occurrence_key:string}>()).results;
  const consumedKeys=new Set(consumed.map(r=>r.occurrence_key));
  const remaining=targets.filter(t=>!consumedKeys.has(t.key));
  for(const target of remaining.slice(0,20)){
   const id=randomOpaqueId(),publicId=randomOpaqueId(),marker=randomOpaqueId(),c=channel.results[0];
   const encrypted=await this.keyring.encryptSensitive('reminder-title',id,1,target.title);
   const s=(sql:string,...args:unknown[])=>this.db.prepare(sql).bind(...args);
   const result=await this.db.batch([
    s(`INSERT INTO personal_assistant_occurrences(owner_user_id,occurrence_key,reminder_id,kind,document_revision,workspace_id,chat_identity_id,connection_id,scheduled_at,created_at) SELECT ?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM personal_assistant_documents WHERE owner_user_id=? AND revision=?) AND EXISTS(SELECT 1 FROM primary_login_channels p JOIN bot_connections c ON c.id=p.connection_id AND c.user_id=p.user_id AND c.state='ACTIVE_BOUND' WHERE p.user_id=? AND p.connection_id=?) ON CONFLICT(owner_user_id,occurrence_key) DO UPDATE SET reminder_id=excluded.reminder_id,document_revision=excluded.document_revision,workspace_id=excluded.workspace_id,chat_identity_id=excluded.chat_identity_id,connection_id=excluded.connection_id,scheduled_at=excluded.scheduled_at,created_at=excluded.created_at WHERE personal_assistant_occurrences.document_revision<excluded.document_revision AND EXISTS(SELECT 1 FROM reminders WHERE id=personal_assistant_occurrences.reminder_id AND status='CANCELLED') AND NOT EXISTS(SELECT 1 FROM follow_through_items i JOIN follow_through_runs run ON run.item_id=i.id JOIN reminders child ON child.id=run.reminder_id WHERE i.root_reminder_id=personal_assistant_occurrences.reminder_id AND (child.status IN ('SENT','CLAIMED','UNCERTAIN') OR run.kind!='ORIGINAL'))`,userId,target.key,id,target.kind,envelope.revision,c.workspaceId,c.chatIdentityId,c.connectionId,target.scheduledAt,now,userId,envelope.revision,userId,c.connectionId),
    s('INSERT INTO personal_assistant_spawn_permits(reminder_id,marker) SELECT reminder_id,? FROM personal_assistant_occurrences WHERE reminder_id=?',marker,id),
    s(`INSERT INTO reminders(id,public_id,workspace_id,chat_identity_id,title_ciphertext,title_iv,title_key_version,scheduled_at,timezone,status,created_at,updated_at,context_write_marker) SELECT reminder_id,?,workspace_id,chat_identity_id,?,?,1,scheduled_at,'Asia/Ho_Chi_Minh','PENDING',?,?,? FROM personal_assistant_occurrences WHERE reminder_id=?`,publicId,encrypted.ciphertext,encrypted.iv,now,now,marker,id),
    s('INSERT INTO personal_assistant_generated(user_id,occurrence_key,reminder_id,kind) SELECT owner_user_id,occurrence_key,reminder_id,kind FROM personal_assistant_occurrences WHERE reminder_id=? ON CONFLICT(user_id,occurrence_key) DO UPDATE SET reminder_id=excluded.reminder_id',id),
    s('DELETE FROM personal_assistant_spawn_permits WHERE reminder_id=?',id),
   ]);
   if(result[0].meta.changes)created++;
  }
  if(remaining.length<=20)await this.db.prepare('UPDATE personal_assistant_documents SET last_dispatch_at=? WHERE owner_user_id=? AND revision=?').bind(now,userId,envelope.revision).run();
  return created;
 }
}

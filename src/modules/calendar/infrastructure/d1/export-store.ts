import {SessionAuthError,type SessionPrincipal} from '@/modules/auth/session';
import type {Keyring} from '@/modules/security/keyring';
import {persistedD1Blob} from '@/modules/db/persisted-blob';
import {CanonicalDetailsV1Schema,type CanonicalDetailsV1} from '@/modules/conversation/context-contract/state';
import {contextContractEncryptionIdentity} from '@/modules/conversation/context-contract/store';
import {randomOpaqueId} from '@/modules/platform/types';
import {boundCalendarProjection,calendarExportWindow,projectCalendarReminder,type CalendarProjection,type ProjectedCalendarEvent} from '../../projection';
const SOURCE_LIMIT=301;
interface Row {
 root_public_id:string;id:string;chat_identity_id:string;scheduled_at:number;status:string;created_at:number;updated_at:number;
 title_ciphertext:unknown;title_iv:unknown;title_key_version:number;
 series_id:string|null;series_public_id:string|null;occurrence_index:number|null;contract_version:number|null;advance_group:number;
 details_id:string|null;details_owner:string|null;details_chat:string|null;details_entity:string|null;payload_version:string|null;payload_ciphertext:unknown;payload_iv:unknown;key_version:number|null;
}
const roots=`FROM reminders root
 JOIN workspaces w ON w.id=root.workspace_id AND w.kind='PERSONAL' AND w.owner_user_id=?
 JOIN memberships m ON m.workspace_id=w.id AND m.user_id=w.owner_user_id AND m.role='OWNER'
 JOIN chat_identities ci ON ci.id=root.chat_identity_id
 JOIN bot_connections c ON c.id=ci.connection_id AND c.user_id=w.owner_user_id
 LEFT JOIN follow_through_items f ON f.root_reminder_id=root.id
 JOIN reminders r ON r.id=COALESCE(f.current_reminder_id,root.id) AND r.workspace_id=root.workspace_id AND r.chat_identity_id=root.chat_identity_id
 LEFT JOIN reminder_series_occurrences o ON o.reminder_id=root.id
 LEFT JOIN reminder_series s ON s.id=o.series_id AND s.owner_id=w.owner_user_id AND s.chat_identity_id=root.chat_identity_id
 LEFT JOIN reminder_series_proposals p ON p.id=s.proposal_id AND p.owner_id=s.owner_id AND p.chat_identity_id=s.chat_identity_id`;
const fence=`(f.id IS NULL OR (f.owner_user_id=w.owner_user_id AND f.workspace_id=w.id AND f.chat_identity_id=ci.id AND f.connection_id=c.id))
 AND NOT EXISTS(SELECT 1 FROM follow_through_runs run WHERE run.reminder_id=root.id AND run.kind<>'ORIGINAL')
 AND NOT EXISTS(SELECT 1 FROM follow_through_items child WHERE child.current_reminder_id=root.id AND child.root_reminder_id<>root.id)
 AND (o.series_id IS NULL OR (s.id IS NOT NULL AND p.id IS NOT NULL))`;
const common=(status="CASE WHEN s.status='CANCELLED' THEN 'CANCELLED' ELSE r.status END",updatedAt='MAX(r.updated_at,root.updated_at,COALESCE(f.updated_at,0),COALESCE(s.updated_at,0))')=>`root.public_id root_public_id,r.id,r.chat_identity_id,r.scheduled_at,
 ${status} status,
 root.created_at,${updatedAt} updated_at,
 CASE WHEN length(r.title_ciphertext)<=8192 THEN r.title_ciphertext ELSE NULL END title_ciphertext,r.title_iv,r.title_key_version,
 s.id series_id,s.public_id series_public_id,o.occurrence_index,p.contract_version`;
// A group represents the actual event, so notification settlement does not
// cancel it. Its version nevertheless observes every bounded member/head.
const groupUpdatedAt=`MAX(s.updated_at,COALESCE((
 SELECT MAX(MAX(child_root.updated_at,COALESCE(child_head.updated_at,0),COALESCE(child_f.updated_at,0)))
 FROM reminder_series_occurrences child_o JOIN reminders child_root ON child_root.id=child_o.reminder_id
 JOIN workspaces child_w ON child_w.id=child_root.workspace_id AND child_w.kind='PERSONAL' AND child_w.owner_user_id=s.owner_id
 JOIN memberships child_m ON child_m.workspace_id=child_w.id AND child_m.user_id=child_w.owner_user_id AND child_m.role='OWNER'
 LEFT JOIN follow_through_items child_f ON child_f.root_reminder_id=child_root.id AND child_f.owner_user_id=s.owner_id
   AND child_f.workspace_id=child_w.id AND child_f.chat_identity_id=s.chat_identity_id AND child_f.connection_id=c.id
 LEFT JOIN reminders child_head ON child_head.id=child_f.current_reminder_id AND child_head.workspace_id=child_w.id AND child_head.chat_identity_id=s.chat_identity_id
 WHERE child_o.series_id=s.id AND child_root.chat_identity_id=s.chat_identity_id
),s.updated_at))`;
const details=(alias:string,identity:string)=>`${identity} details_id,${alias}.owner_id details_owner,${alias}.chat_identity_id details_chat,${alias}.encryption_entity_id details_entity,${alias}.payload_version,${alias}.payload_ciphertext,${alias}.payload_iv,${alias}.key_version`;
const order=`ORDER BY CASE WHEN r.scheduled_at>=? THEN 0 ELSE 1 END,
 CASE WHEN r.scheduled_at>=? THEN r.scheduled_at ELSE -r.scheduled_at END,root.public_id LIMIT ${SOURCE_LIMIT+1}`;
export class D1CalendarExportStore{
 constructor(private readonly db:D1Database,private readonly keyring:Keyring){}
 private async assertSession(principal:SessionPrincipal,now:number):Promise<void>{
  if(!await this.db.prepare('SELECT 1 FROM sessions WHERE id=? AND user_id=? AND revoked_at IS NULL AND expires_at>?').bind(principal.sessionId,principal.userId,now).first())throw new SessionAuthError();
 }
 async recordExport(principal:SessionPrincipal,now:number):Promise<void>{
  const result=await this.db.prepare(`INSERT INTO audit_events(id,actor_user_id,action,target_user_id,result,created_at)
    SELECT ?,user_id,'CALENDAR_EXPORTED',user_id,'SUCCESS',? FROM sessions WHERE id=? AND user_id=? AND revoked_at IS NULL AND expires_at>?`)
    .bind(randomOpaqueId(),now,principal.sessionId,principal.userId,now).run();
  if(result.meta.changes!==1)throw new SessionAuthError();
 }
 async read(principal:SessionPrincipal,now:number):Promise<CalendarProjection>{
  calendarExportWindow(now);await this.assertSession(principal,now);
  const result=await this.readOwner(principal.userId,now,principal);
  // Reject revocation during decrypt/projection as well as before the SQL read.
  await this.assertSession(principal,now);return result;
 }
 /** Internal only: caller MUST hold the actual ACTIVE sync-connection lease for
  * this owner. Never bind an HTTP owner selector to this capability. */
 async readForSyncAuthorizedOwner(ownerId:string,now:number):Promise<CalendarProjection>{return this.readOwner(ownerId,now);}
 private async readOwner(ownerId:string,now:number,principal?:SessionPrincipal):Promise<CalendarProjection>{
  const {from,to}=calendarExportWindow(now);
  const session=principal?'AND EXISTS(SELECT 1 FROM sessions se WHERE se.id=? AND se.user_id=w.owner_user_id AND se.revoked_at IS NULL AND se.expires_at>?)':'';
  const sessionArgs=principal?[principal.sessionId,now]:[];
  const normal=(await this.db.prepare(`SELECT ${common()},0 advance_group,
    CASE WHEN s.id IS NULL THEN d.reminder_id ELSE sd.series_id END details_id,
    CASE WHEN s.id IS NULL THEN d.owner_id ELSE sd.owner_id END details_owner,
    CASE WHEN s.id IS NULL THEN d.chat_identity_id ELSE sd.chat_identity_id END details_chat,
    CASE WHEN s.id IS NULL THEN d.encryption_entity_id ELSE sd.encryption_entity_id END details_entity,
    CASE WHEN s.id IS NULL THEN d.payload_version ELSE sd.payload_version END payload_version,
    CASE WHEN s.id IS NULL THEN d.payload_ciphertext ELSE sd.payload_ciphertext END payload_ciphertext,
    CASE WHEN s.id IS NULL THEN d.payload_iv ELSE sd.payload_iv END payload_iv,
    CASE WHEN s.id IS NULL THEN d.key_version ELSE sd.key_version END key_version
    ${roots} LEFT JOIN reminder_context_details d ON d.reminder_id=r.id
    LEFT JOIN reminder_series_context_details sd ON sd.series_id=s.id
    WHERE ${fence} AND NOT EXISTS(SELECT 1 FROM advance_notification_groups g WHERE g.series_id=s.id)
    AND r.scheduled_at>=? AND r.scheduled_at<=? ${session} ${order}`)
    .bind(ownerId,from,to,...sessionArgs,now,now).all<Row>()).results;
  // Actual group dates are encrypted. Bound the source scan independently and
  // report partial when exceeded; final ordering uses decrypted actual dates.
  const groups=(await this.db.prepare(`SELECT ${common("CASE WHEN s.status='CANCELLED' THEN 'CANCELLED' ELSE 'CONFIRMED' END",groupUpdatedAt)},1 advance_group,${details('sd','sd.series_id')}
    ${roots} JOIN advance_notification_groups g ON g.series_id=s.id AND g.owner_user_id=w.owner_user_id AND g.chat_identity_id=ci.id
    LEFT JOIN reminder_series_context_details sd ON sd.series_id=s.id
    WHERE ${fence} AND o.occurrence_index=(SELECT MIN(first.occurrence_index) FROM reminder_series_occurrences first WHERE first.series_id=s.id)
    ${session} ${order}`).bind(ownerId,...sessionArgs,now,now).all<Row>()).results;
  const events:ProjectedCalendarEvent[]=[];let skipped=0;
  for(const row of [...normal.slice(0,SOURCE_LIMIT),...groups.slice(0,SOURCE_LIMIT)]){
   try{
    let canonical:CanonicalDetailsV1|null=null;
    const entity=row.series_id??row.id;
    if(row.details_id!==null){
     if(row.details_id!==entity||row.details_owner!==ownerId||row.details_chat!==row.chat_identity_id||row.details_entity!==entity||row.payload_version!=='calenote-reminder-details-1'||row.key_version===null)throw new TypeError('Calendar detail binding');
     canonical=CanonicalDetailsV1Schema.parse(JSON.parse(await this.keyring.decryptSensitive(row.series_id?'context-contract-series-details':'context-contract-reminder-details',contextContractEncryptionIdentity({ownerId,chatIdentityId:row.chat_identity_id},entity),row.key_version,{ciphertext:persistedD1Blob(row.payload_ciphertext),iv:persistedD1Blob(row.payload_iv)})));
    }else if(row.advance_group===1||row.contract_version===2)throw new TypeError('Missing calendar details');
    const title=await this.keyring.decryptSensitive('reminder-title',row.id,row.title_key_version,{ciphertext:persistedD1Blob(row.title_ciphertext),iv:persistedD1Blob(row.title_iv)});
    events.push(projectCalendarReminder({rootPublicId:row.root_public_id,seriesPublicId:row.series_public_id,occurrenceIndex:row.occurrence_index,advanceGroup:row.advance_group===1,scheduledAt:row.scheduled_at,title,details:canonical,status:row.status,createdAt:row.created_at,updatedAt:row.updated_at}));
   }catch{skipped++;}
  }
  const result=boundCalendarProjection(events,now);
  return {...result,skipped,truncated:result.truncated||normal.length>SOURCE_LIMIT||groups.length>SOURCE_LIMIT};
 }
}

import {persistedD1Blob} from '@/modules/db/persisted-blob';
import {newerConversationOutcomeSql} from '@/modules/semantic/infrastructure/d1/conversation-order';
import {isLocalMonthQuery,type LocalMonthQuery,type LocalMonthResult,LOCAL_MONTH_STATUSES} from '@/modules/conversation/local-read-only';
/** Independent V2 read path: no successor schema or model authority. */
export class D1LocalMonthQueryStore{
 constructor(private readonly database:D1Database){}
 async list(input:LocalMonthQuery):Promise<LocalMonthResult>{
  if(!isLocalMonthQuery(input))return {status:'INVALID'};
  try{
   const rows=await this.database.prepare(`WITH authority AS (
    SELECT ci.id chat_identity_id,w.id workspace_id,
      (i.state<>'PROCESSING' OR i.transition_marker IS NULL OR i.transition_marker<>? OR i.received_at<>? OR i.rowid<>? OR ${newerConversationOutcomeSql('i')}) stale
    FROM inbound_updates i
    JOIN bot_connections c ON c.id=i.connection_id AND c.state='ACTIVE_BOUND'
    JOIN chat_identities ci ON ci.connection_id=c.id AND ci.provider_user_id=i.provider_user_id AND ci.private_chat_id=i.private_chat_id
    JOIN workspaces w ON w.owner_user_id=c.user_id AND w.kind='PERSONAL'
    JOIN memberships m ON m.workspace_id=w.id AND m.user_id=c.user_id AND m.role='OWNER'
    WHERE i.id=? AND i.connection_id=? AND i.provider_user_id=? AND i.private_chat_id=? AND c.user_id=? AND ci.id=? AND w.id=?
   ) SELECT a.stale,r.id,r.title_ciphertext,r.title_iv,r.title_key_version,r.scheduled_at,r.status
   FROM authority a LEFT JOIN reminders r ON a.stale=0 AND r.workspace_id=a.workspace_id AND r.chat_identity_id=a.chat_identity_id
    AND r.scheduled_at>=? AND r.scheduled_at<? AND r.status IN ('PENDING','CLAIMED','RETRYABLE','SENT','FAILED','UNCERTAIN')
   ORDER BY r.scheduled_at,r.id LIMIT 6`).bind(input.message.claimMarker,input.message.receivedAt,input.context.inboundRowId,input.message.id,input.message.connectionId,input.message.providerUserId,input.message.privateChatId,input.context.userId,input.context.chatIdentityId,input.context.workspaceId,input.range.start,input.range.end)
    .all<{stale:number;id:string|null;title_ciphertext:unknown;title_iv:unknown;title_key_version:number;scheduled_at:number;status:keyof typeof LOCAL_MONTH_STATUSES}>();
   if(!rows.results.length)return {status:'UNAUTHORIZED'};if(rows.results[0].stale)return {status:'STALE'};
   const selected=rows.results.filter(row=>row.id!==null);
   return {status:'RESULTS',hasMore:selected.length>5,rows:selected.slice(0,5).map(row=>({id:row.id!,scheduledAt:row.scheduled_at,status:row.status,titleKeyVersion:row.title_key_version,encryptedTitle:{ciphertext:persistedD1Blob(row.title_ciphertext),iv:persistedD1Blob(row.title_iv)}}))};
  }catch{return {status:'UNAVAILABLE'}}
 }
}

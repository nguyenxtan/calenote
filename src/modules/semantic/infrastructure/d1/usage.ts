import {AiUsageSchema,type AiUsage,type AiUsageConfiguration} from '@/contracts/api/ai-usage';
import {SessionAuthError,type SessionPrincipal} from '@/modules/auth/session';

/** Reservation-grain accounting only. No provider reconciliation or mutations. */
export async function readOwnerAiUsage(db:D1Database,principal:SessionPrincipal,now:number,configuration:AiUsageConfiguration):Promise<AiUsage>{
 if(!Number.isSafeInteger(now)||!Number.isFinite(new Date(now).getTime()))throw new TypeError('Invalid usage time');
 const asOf=new Date(now).toISOString(),day=asOf.slice(0,10),month=day.slice(0,7);
 const rows=(await db.prepare(`WITH authorized AS (
   SELECT user_id FROM sessions WHERE id=? AND user_id=? AND revoked_at IS NULL AND expires_at>?
 ), periods(kind,key) AS (VALUES ('USER_DAILY',?),('USER_MONTHLY',?))
 SELECT p.key,
   SUM(CASE WHEN r.state='FINALIZED' OR (r.state='RESERVED' AND d.reservation_id IS NOT NULL) THEN 1 ELSE 0 END) dispatchedCalls,
   SUM(CASE WHEN r.state='FINALIZED' AND d.usage_known=1 THEN 1 ELSE 0 END) knownCalls,
   SUM(CASE WHEN r.state='FINALIZED' AND d.usage_known=1 THEN r.finalized_microunits ELSE 0 END) knownCostMicrounits,
   SUM(CASE WHEN (r.state='FINALIZED' AND COALESCE(d.usage_known,0)=0) OR (r.state='RESERVED' AND d.reservation_id IS NOT NULL) THEN 1 ELSE 0 END) unknownCalls,
   SUM(CASE WHEN (r.state='FINALIZED' AND COALESCE(d.usage_known,0)=0) OR (r.state='RESERVED' AND d.reservation_id IS NOT NULL) THEN r.reserved_maximum_microunits ELSE 0 END) unknownMaximumMicrounits,
   SUM(CASE WHEN r.state='RESERVED' AND d.reservation_id IS NULL THEN 1 ELSE 0 END) pendingCalls,
   SUM(CASE WHEN r.state='RESERVED' AND d.reservation_id IS NULL THEN r.reserved_maximum_microunits ELSE 0 END) pendingMaximumMicrounits,
   COALESCE((SELECT reserved_calls+finalized_calls FROM semantic_budget_windows w WHERE w.kind=p.kind AND w.scope_id=? AND w.window_key=p.key),0) budgetedCalls,
   COALESCE((SELECT reserved_microunits+finalized_microunits FROM semantic_budget_windows w WHERE w.kind=p.kind AND w.scope_id=? AND w.window_key=p.key),0) budgetedCostMicrounits
 FROM periods p LEFT JOIN semantic_budget_reservations r ON r.owner_id=(SELECT user_id FROM authorized)
   AND r.monthly_window_key=substr(p.key,1,7) AND (p.kind='USER_MONTHLY' OR r.daily_window_key=p.key) AND r.created_at<=?
 LEFT JOIN semantic_budget_dispatches d ON d.reservation_id=r.id
 WHERE EXISTS(SELECT 1 FROM authorized) GROUP BY p.kind,p.key ORDER BY p.kind`)
 .bind(principal.sessionId,principal.userId,now,day,month,principal.userId,principal.userId,now).all<AiUsage['day']>()).results;
 if(rows.length!==2)throw new SessionAuthError();
 return AiUsageSchema.parse({...configuration,schemaVersion:'ai-usage-1',asOf,timezone:'UTC',currency:'USD',day:rows[0],month:rows[1]});
}

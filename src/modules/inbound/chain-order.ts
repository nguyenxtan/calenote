/** Additive migration selection; pre-migration/rollback fixtures keep their
 * existing behavior. The production release requires migration0024. */
export async function hasInboundChainFence(db:D1Database):Promise<boolean>{
 return !!await db.prepare("SELECT 1 FROM pragma_table_info('inbound_updates') WHERE name='chain_released_at'").first();
}
export function inboundChainBlockedSql(alias:string,leaseCutoff:number):string{
 if(!/^[a-z_]+$/u.test(alias)||!Number.isSafeInteger(leaseCutoff))throw new TypeError('Invalid inbound chain predicate');
 const scope=(peer:string)=>`${peer}.connection_id=${alias}.connection_id AND ${peer}.provider_user_id=${alias}.provider_user_id AND ${peer}.private_chat_id=${alias}.private_chat_id AND ${peer}.rowid<>${alias}.rowid`;
 return `(EXISTS(SELECT 1 FROM bot_connections chain_c WHERE chain_c.id=${alias}.connection_id AND chain_c.state='ACTIVE_BOUND') AND (
  EXISTS(SELECT 1 FROM inbound_updates earlier WHERE ${scope('earlier')} AND earlier.state IN ('PENDING','PROCESSING')
   AND (earlier.received_at<${alias}.received_at OR (earlier.received_at=${alias}.received_at AND earlier.rowid<${alias}.rowid)))
  OR EXISTS(SELECT 1 FROM inbound_updates busy WHERE ${scope('busy')} AND busy.chain_released_at IS NULL AND busy.processing_started_at>${leaseCutoff})
 ))`;
}
export async function recoverExhaustedChainHeads(db:D1Database,id:string,now:number,leaseCutoff:number,maxAttempts:number):Promise<void>{
 await db.prepare(`UPDATE inbound_updates SET state='FAILED',processed_at=?,chain_released_at=?,dispatch_started_at=NULL,dispatch_marker=NULL,
   safe_error_code=CASE WHEN attempt_count>=? THEN 'INBOUND_PROCESSING_EXHAUSTED' ELSE 'INBOUND_DISPATCH_EXHAUSTED' END
  WHERE id<>? AND state IN ('PENDING','PROCESSING')
   AND connection_id=(SELECT connection_id FROM inbound_updates WHERE id=?)
   AND provider_user_id=(SELECT provider_user_id FROM inbound_updates WHERE id=?)
   AND private_chat_id=(SELECT private_chat_id FROM inbound_updates WHERE id=?)
   AND EXISTS(SELECT 1 FROM bot_connections c WHERE c.id=inbound_updates.connection_id AND c.state='ACTIVE_BOUND')
   AND (state='PENDING' OR processing_started_at IS NULL OR processing_started_at<=?)
   AND (attempt_count>=? OR (dispatch_attempt_count>=? AND (dispatch_started_at IS NULL OR dispatch_started_at<=?)))`)
 .bind(now,now,maxAttempts,id,id,id,id,leaseCutoff,maxAttempts,maxAttempts,leaseCutoff).run();
}

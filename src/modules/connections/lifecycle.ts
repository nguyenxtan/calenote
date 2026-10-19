import { d1Changes } from "@/modules/platform/types";

export class ConnectionDisconnectError extends Error {
  readonly code = "CONNECTION_DISCONNECT_BLOCKED";
  readonly status = 409;
  constructor() { super("Chưa thể ngắt kết nối. Chọn một bot khác đã kết nối làm kênh đăng nhập và đợi các tin đang xử lý hoàn tất."); }
}

/** Reservation and disconnect serialize in D1. Never expire a provider send lease:
 * a timeout cannot prove the provider did not accept the message. */
export class D1ConnectionLifecycleStore {
  constructor(private readonly db: D1Database) {}

  async reserveEgress(connectionId: string, id: string, now: number): Promise<boolean> {
    const result = await this.db.prepare(`INSERT INTO connection_egress(id,connection_id,created_at)
      SELECT ?,id,? FROM bot_connections WHERE id=? AND state IN ('ACTIVE_BOUND','ACTIVE_UNBOUND')`)
      .bind(id,now,connectionId).run();
    return d1Changes(result)===1;
  }
  async finishEgress(id: string): Promise<void> {
    await this.db.prepare("DELETE FROM connection_egress WHERE id=?").bind(id).run();
  }

  async disconnect(userId: string, publicId: string, now: number, marker: string): Promise<boolean> {
    const disconnectMarker=`disconnected:${marker}`;
    const changed="EXISTS(SELECT 1 FROM bot_connections c WHERE c.user_id=? AND c.public_id=? AND c.transition_marker=?)";
    const values=[userId,publicId,disconnectMarker];
    try {
      const results=await this.db.batch([
        this.db.prepare(`UPDATE bot_connections SET state='SUSPENDED',transition_marker=?,updated_at=?
          WHERE user_id=? AND public_id=? AND (transition_marker IS NULL OR transition_marker NOT LIKE 'disconnected:%')
            AND state <> 'VALIDATING'
            AND NOT EXISTS(SELECT 1 FROM primary_login_channels p WHERE p.user_id=bot_connections.user_id AND p.connection_id=bot_connections.id)
            AND EXISTS(SELECT 1 FROM bot_connections alternate JOIN chat_identities ci ON ci.connection_id=alternate.id
              WHERE alternate.user_id=bot_connections.user_id AND alternate.id<>bot_connections.id AND alternate.state='ACTIVE_BOUND'
                AND length(ci.private_chat_id)>0 AND length(ci.provider_user_id)>0)
            AND NOT EXISTS(SELECT 1 FROM inbound_updates i WHERE i.connection_id=bot_connections.id AND i.state='PROCESSING')
            AND NOT EXISTS(SELECT 1 FROM connection_egress e WHERE e.connection_id=bot_connections.id)
            AND NOT EXISTS(SELECT 1 FROM login_codes l WHERE l.connection_id=bot_connections.id AND l.delivery_status='SENDING')
            AND NOT EXISTS(SELECT 1 FROM reminder_deliveries d JOIN reminders r ON r.id=d.reminder_id JOIN chat_identities ci ON ci.id=r.chat_identity_id
              WHERE ci.connection_id=bot_connections.id AND d.status='SENDING') RETURNING id`)
          .bind(disconnectMarker,now,userId,publicId),
        this.db.prepare(`UPDATE connect_codes SET consumed_at=COALESCE(consumed_at,?) WHERE connection_id IN
          (SELECT id FROM bot_connections WHERE user_id=? AND public_id=?) AND ${changed}`)
          .bind(now,userId,publicId,...values),
        this.db.prepare(`UPDATE login_codes SET consumed_at=COALESCE(consumed_at,?),updated_at=?,delivery_status=CASE
          WHEN delivery_status IN ('PENDING','RETRYABLE') THEN 'CANCELLED' ELSE delivery_status END
          WHERE connection_id IN(SELECT id FROM bot_connections WHERE user_id=? AND public_id=?) AND ${changed}`)
          .bind(now,now,userId,publicId,...values),
        this.db.prepare(`UPDATE inbound_updates SET state='REJECTED',processed_at=?,safe_error_code='CONNECTION_DISCONNECTED'
          WHERE connection_id IN(SELECT id FROM bot_connections WHERE user_id=? AND public_id=?) AND state='PENDING' AND ${changed}`)
          .bind(now,userId,publicId,...values),
        this.db.prepare(`INSERT INTO audit_events(id,actor_user_id,action,target_user_id,target_connection_id,result,created_at)
          VALUES((SELECT transition_marker FROM bot_connections WHERE user_id=? AND public_id=? AND transition_marker=?),?,'CONNECTION_DISCONNECTED',?,
            (SELECT id FROM bot_connections WHERE user_id=? AND public_id=?),'SUCCESS',?)`)
          .bind(...values,userId,userId,userId,publicId,now),
      ]);
      return d1Changes(results[0])===1;
    } catch(error) {
      if(error instanceof Error && /NOT NULL constraint failed:\s*audit_events\.id/u.test(error.message)) return false;
      throw error;
    }
  }
}

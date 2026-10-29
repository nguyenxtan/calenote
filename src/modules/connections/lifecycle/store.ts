import { d1Changes } from "@/modules/platform/types";

export interface LifecycleCas {
  authRevision: number;
  primary: { revision: number; generation: string } | null;
}
export interface LifecycleSnapshot {
  publicId: string;
  state: string;
  paused: boolean;
  cas: LifecycleCas;
  heldReminders: number;
  heldInbound: number;
  inFlight: { reminders: number; login: number; inbound: number };
}

export class D1ConnectionLifecycleStore {
  constructor(private readonly db: D1Database) {}

  async get(userId: string, publicId: string): Promise<LifecycleSnapshot | null> {
    const row = await this.db.prepare(`SELECT c.id,c.public_id,c.state,c.processing_paused,c.auth_revision,
      p.revision AS primary_revision,p.generation AS primary_generation,
      (SELECT COUNT(*) FROM reminders r JOIN chat_identities ci ON ci.id=r.chat_identity_id WHERE ci.connection_id=c.id AND r.lifecycle_hold=1 AND r.status IN ('PENDING','CLAIMED','RETRYABLE')) AS held_reminders,
      (SELECT COUNT(*) FROM inbound_updates i WHERE i.connection_id=c.id AND i.lifecycle_hold=1) AS held_inbound,
      (SELECT COUNT(*) FROM reminder_deliveries d JOIN reminders r ON r.id=d.reminder_id JOIN chat_identities ci ON ci.id=r.chat_identity_id WHERE ci.connection_id=c.id AND d.status='SENDING') AS sending_reminders,
      (SELECT COUNT(*) FROM login_codes l WHERE l.connection_id=c.id AND l.delivery_status='SENDING') AS sending_login,
      (SELECT COUNT(*) FROM inbound_egress e WHERE e.connection_id=c.id AND e.status='SENDING') AS sending_inbound
      FROM bot_connections c LEFT JOIN primary_login_channels p ON p.user_id=c.user_id
      WHERE c.user_id=? AND c.public_id=?`).bind(userId,publicId).first<{
        public_id:string;state:string;processing_paused:number;auth_revision:number;primary_revision:number|null;primary_generation:string|null;
        held_reminders:number;held_inbound:number;sending_reminders:number;sending_login:number;sending_inbound:number;
      }>();
    if (!row) return null;
    return {publicId:row.public_id,state:row.state,paused:row.processing_paused===1,
      cas:{authRevision:row.auth_revision,primary:row.primary_revision===null ? null : {revision:row.primary_revision,generation:row.primary_generation!}},
      heldReminders:row.held_reminders,heldInbound:row.held_inbound,
      inFlight:{reminders:row.sending_reminders,login:row.sending_login,inbound:row.sending_inbound}};
  }

  async change(input: {userId:string;publicId:string;paused:boolean;expected:LifecycleCas;marker:string;now:number}):Promise<boolean> {
    const {userId,publicId,paused,expected,marker,now}=input;
    const primaryGuard=expected.primary
      ? "EXISTS(SELECT 1 FROM primary_login_channels p WHERE p.user_id=bot_connections.user_id AND p.revision=? AND p.generation=?)"
      : "NOT EXISTS(SELECT 1 FROM primary_login_channels p WHERE p.user_id=bot_connections.user_id)";
    const primaryValues=expected.primary ? [expected.primary.revision,expected.primary.generation] : [];
    const changedGuard="EXISTS(SELECT 1 FROM bot_connections c WHERE c.user_id=? AND c.public_id=? AND c.transition_marker=? AND c.processing_paused=?)";
    const changedValues=[userId,publicId,marker,paused?1:0];
    const target="chat_identity_id IN (SELECT ci.id FROM chat_identities ci JOIN bot_connections c ON c.id=ci.connection_id WHERE c.user_id=? AND c.public_id=?)";
    try {
      const results=await this.db.batch([
        this.db.prepare(`UPDATE bot_connections SET processing_paused=?,transition_marker=?,updated_at=?
          WHERE user_id=? AND public_id=? AND auth_revision=? AND processing_paused=? AND (state='ACTIVE_BOUND' OR (?=0 AND state='SUSPENDED'))
            AND EXISTS(SELECT 1 FROM chat_identities ci WHERE ci.connection_id=bot_connections.id AND length(ci.private_chat_id)>0 AND length(ci.provider_user_id)>0)
            AND ${primaryGuard}
            AND (?=0 OR EXISTS(SELECT 1 FROM primary_login_channels p JOIN bot_connections alternate ON alternate.id=p.connection_id AND alternate.user_id=p.user_id
              JOIN chat_identities ci ON ci.connection_id=alternate.id
              WHERE p.user_id=bot_connections.user_id AND alternate.id<>bot_connections.id AND alternate.state='ACTIVE_BOUND' AND alternate.processing_paused=0
                AND length(ci.private_chat_id)>0 AND length(ci.provider_user_id)>0)) RETURNING id`)
          .bind(paused?1:0,marker,now,userId,publicId,expected.authRevision,paused?0:1,paused?1:0,...primaryValues,paused?1:0),
        this.db.prepare(`UPDATE reminders SET lifecycle_hold=? WHERE ${target} AND status IN ('PENDING','CLAIMED','RETRYABLE')
          AND (?=1 OR (scheduled_at>? AND EXISTS(SELECT 1 FROM bot_connections c WHERE c.user_id=? AND c.public_id=? AND c.state='ACTIVE_BOUND') AND NOT EXISTS(SELECT 1 FROM reminder_deliveries d WHERE d.reminder_id=reminders.id AND d.status='SENDING'))) AND NOT EXISTS(SELECT 1 FROM reminder_deliveries d WHERE d.reminder_id=reminders.id AND d.status IN ('SENT','UNCERTAIN','FAILED','CANCELLED'))
          AND ${changedGuard}`).bind(paused?1:0,userId,publicId,paused?1:0,now,userId,publicId,...changedValues),
        this.db.prepare(`UPDATE inbound_updates SET lifecycle_hold=1 WHERE ?=1 AND connection_id IN (SELECT id FROM bot_connections WHERE user_id=? AND public_id=?) AND ${changedGuard}`)
          .bind(paused?1:0,userId,publicId,...changedValues),
        this.db.prepare(`UPDATE login_codes SET consumed_at=COALESCE(consumed_at,?),updated_at=?,delivery_status=CASE WHEN delivery_status IN ('PENDING','RETRYABLE') THEN 'CANCELLED' ELSE delivery_status END
          WHERE connection_id IN (SELECT id FROM bot_connections WHERE user_id=? AND public_id=?) AND ${changedGuard}`)
          .bind(now,now,userId,publicId,...changedValues),
        this.db.prepare(`INSERT INTO audit_events(id,actor_user_id,action,target_user_id,target_connection_id,result,created_at)
          VALUES((SELECT transition_marker FROM bot_connections WHERE user_id=? AND public_id=? AND transition_marker=? AND processing_paused=?),?,?,?,
            (SELECT id FROM bot_connections WHERE user_id=? AND public_id=?),'SUCCESS',?)`)
          .bind(...changedValues,userId,paused?"CONNECTION_PAUSED":"CONNECTION_RESUMED",userId,userId,publicId,now),
      ]);
      return d1Changes(results[0])===1 && d1Changes(results[4])===1;
    } catch(error) {
      if(error instanceof Error && /NOT NULL constraint failed:\s*audit_events\.id/iu.test(error.message)) return false;
      throw error;
    }
  }
}

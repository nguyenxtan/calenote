import { d1Changes } from "@/modules/platform/types";
import type { ClaimedInboundMessage } from "@/modules/inbound/processor";

export type InboundEgressKind = "REPLY" | "TYPING" | "SEMANTIC_FREE" | "SEMANTIC_PAID";
export class D1InboundEgressStore {
  constructor(private readonly db:D1Database) {}
  async acquire(message:ClaimedInboundMessage,kind:InboundEgressKind,index:number,now:number):Promise<boolean> {
    if(!Number.isSafeInteger(index)||index<0) return false;
    // This INSERT is the in-flight boundary. The caller must use only the
    // captured credential/chat after acquisition, even if pause then commits.
    const result=await this.db.prepare(`INSERT INTO inbound_egress(inbound_id,kind,action_index,connection_id,auth_revision,status,acquired_at)
      SELECT i.id,?,?,c.id,c.auth_revision,'SENDING',? FROM inbound_updates i JOIN bot_connections c ON c.id=i.connection_id AND c.provider=i.provider
      WHERE i.id=? AND i.connection_id=? AND i.transition_marker=? AND i.provider_user_id=? AND i.private_chat_id=?
        AND i.lifecycle_hold=0 AND c.processing_paused=0 AND c.user_id=? AND c.provider=?
        AND c.credential_version=? AND c.encrypted_token=? AND c.encrypted_token_iv=?
        AND ((c.auth_revision=? AND c.state=?) OR (
          ?='ACTIVE_UNBOUND' AND c.state='ACTIVE_BOUND' AND c.auth_revision=?+2 AND c.transition_marker=i.transition_marker
          AND i.state='PROCESSED' AND EXISTS(SELECT 1 FROM chat_identities ci WHERE ci.connection_id=c.id AND ci.linked_at=i.processed_at
            AND ci.provider_user_id=i.provider_user_id AND ci.private_chat_id=i.private_chat_id)))
      ON CONFLICT(inbound_id,kind,action_index) DO NOTHING RETURNING inbound_id`)
      .bind(kind,index,now,message.id,message.connectionId,message.claimMarker,message.providerUserId,message.privateChatId,
        message.connectionUserId,message.provider,message.credentialVersion,message.encryptedToken,message.encryptedTokenIv,
        message.authRevision,message.connectionState,message.connectionState,message.authRevision).run();
    return d1Changes(result)===1;
  }
  async finalize(inboundId:string,kind:InboundEgressKind,index:number,status:"SENT"|"FAILED"|"UNCERTAIN",now:number):Promise<void> {
    await this.db.prepare("UPDATE inbound_egress SET status=?,completed_at=? WHERE inbound_id=? AND kind=? AND action_index=? AND status='SENDING'")
      .bind(status,now,inboundId,kind,index).run();
  }
  async reconcile(now:number,leaseMs:number):Promise<void> {
    if(!Number.isSafeInteger(leaseMs)||leaseMs<=0) throw new TypeError("Invalid egress lease");
    await this.db.prepare("UPDATE inbound_egress SET status='UNCERTAIN',completed_at=? WHERE status='SENDING' AND acquired_at<?")
      .bind(now,now-leaseMs).run();
  }
}

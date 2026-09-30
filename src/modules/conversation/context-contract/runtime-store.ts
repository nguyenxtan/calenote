import type { ConversationScope } from "../contracts";
import type { ContextObservation } from "./state";
import { ContextObservationBindingSchema } from "./state";
import { ownedInbound, auth } from "../infrastructure/d1/context-store";
import { newerConversationOutcomeSql } from "@/modules/semantic/infrastructure/d1/conversation-order";

export interface ContextRuntimeStore {
  claimAttempt(scope: ConversationScope, observation: ContextObservation, bindingDigest: string): Promise<boolean>;
  complete(scope: ConversationScope): Promise<boolean>;
  canSend(scope: ConversationScope, expected?: { contextId: string; contextRevision: number }): Promise<boolean>;
  ownsContext(scope: ConversationScope): Promise<boolean>;
  ownsLegacyContext(scope: ConversationScope): Promise<boolean>;
}

export class D1ContextRuntimeStore implements ContextRuntimeStore {
  constructor(private readonly db: D1Database) {}
  async claimAttempt(scope: ConversationScope, observation: ContextObservation, bindingDigest: string): Promise<boolean> {
    const parsed = ContextObservationBindingSchema.safeParse(observation);
    if (!parsed.success || !/^[0-9a-f]{64}$/u.test(bindingDigest)) return false;
    const o = parsed.data;
    if (o.scope.ownerId !== scope.ownerId || o.scope.chatIdentityId !== scope.chatIdentityId
      || o.inbound.id !== scope.sourceInboundId || o.inbound.claimMarker !== scope.claimMarker) return false;
    const presence = o.observed.presence === "PRESENT"
      ? { sql: "EXISTS(SELECT 1 FROM conversation_contexts WHERE id=? AND chat_identity_id=? AND owner_id=? AND revision=? AND contract_version=2 AND status IN ('CLARIFYING','DRAFT_READY') AND expires_at>?)", args: [o.observed.contextId, scope.chatIdentityId, scope.ownerId, o.observed.contextRevision, scope.now] }
      : { sql: "NOT EXISTS(SELECT 1 FROM conversation_contexts WHERE chat_identity_id=? AND status IN ('CLARIFYING','DRAFT_READY'))", args: [scope.chatIdentityId] };
    const terminal = o.lastTerminalOutcome;
    const terminalSql = o.observed.presence === "PRESENT" ? "1=1" : terminal
      ? "EXISTS(SELECT 1 FROM conversation_contexts WHERE id=? AND revision=? AND last_inbound_id=? AND status=?)"
      : "NOT EXISTS(SELECT 1 FROM conversation_contexts WHERE chat_identity_id=? AND status NOT IN ('CLARIFYING','DRAFT_READY'))";
    try {
      // Fixed cross-contract inbound key; the bounded digest is protected
      // binding data, never a dynamic dedupe key or public event category.
      const result = await this.db.prepare(`INSERT INTO audit_events(id,actor_user_id,action,target_user_id,result,created_at)
        SELECT ?,?,?,?,'SUCCESS',? WHERE EXISTS(${ownedInbound}) AND ${presence.sql} AND ${terminalSql}
        AND EXISTS(SELECT 1 FROM inbound_updates i JOIN chat_identities ci ON ci.id=?
          JOIN workspaces w ON w.id=? AND w.owner_user_id=? AND w.kind='PERSONAL'
          JOIN memberships m ON m.workspace_id=w.id AND m.user_id=w.owner_user_id AND m.role='OWNER'
          WHERE i.id=? AND i.rowid=? AND i.received_at=? AND ci.connection_id=? AND ci.private_chat_id=?)
        AND NOT EXISTS(SELECT 1 FROM command_drafts WHERE chat_identity_id=? AND contract_version=1 AND status='PENDING')
        AND NOT EXISTS(SELECT 1 FROM reminder_series_proposals WHERE chat_identity_id=? AND contract_version=1 AND status='PENDING')
        AND NOT EXISTS(SELECT 1 FROM semantic_contexts WHERE chat_identity_id=? AND status='PENDING')
        ON CONFLICT(id) DO NOTHING`).bind(`semantic-attempt:${scope.sourceInboundId}`, scope.ownerId, `CONTEXT_ATTEMPT:${bindingDigest}`, scope.ownerId, scope.now,
        ...auth(scope), ...presence.args, ...(o.observed.presence === "PRESENT" ? [] : terminal ? [terminal.contextId, terminal.contextRevision, terminal.inboundId, terminal.status] : [scope.chatIdentityId]),
        scope.chatIdentityId, o.scope.workspaceId, scope.ownerId, scope.sourceInboundId, o.inbound.rowid, Date.parse(o.inbound.receivedAt), o.scope.connectionId, o.scope.chatId,
        scope.chatIdentityId, scope.chatIdentityId, scope.chatIdentityId).run();
      return result.meta.changes === 1;
    } catch { return false; }
  }
  async complete(scope: ConversationScope): Promise<boolean> {
    try { return (await this.db.prepare(`UPDATE inbound_updates SET state='PROCESSED',processed_at=? WHERE id=? AND EXISTS(${ownedInbound})`)
      .bind(scope.now, scope.sourceInboundId, ...auth(scope)).run()).meta.changes === 1; } catch { return false; }
  }
  async canSend(scope: ConversationScope, expected?: { contextId: string; contextRevision: number }): Promise<boolean> {
    try { return !!await this.db.prepare(`SELECT 1 FROM inbound_updates i
      JOIN chat_identities ci ON ci.connection_id=i.connection_id AND ci.provider_user_id=i.provider_user_id AND ci.private_chat_id=i.private_chat_id
      JOIN bot_connections c ON c.id=ci.connection_id AND c.state='ACTIVE_BOUND'
      WHERE i.id=? AND i.transition_marker=? AND i.state IN ('PROCESSED','REJECTED') AND ci.id=? AND c.user_id=?
      AND NOT ${newerConversationOutcomeSql("i", true)}
      ${expected ? "AND EXISTS(SELECT 1 FROM conversation_contexts WHERE id=? AND owner_id=? AND chat_identity_id=? AND revision=? AND last_inbound_id=? AND contract_version=2 AND (expires_at>? OR status IN ('COMPLETED','CANCELLED')))" : ""}`)
      .bind(scope.sourceInboundId, scope.claimMarker, scope.chatIdentityId, scope.ownerId,
        ...(expected ? [expected.contextId, scope.ownerId, scope.chatIdentityId, expected.contextRevision, scope.sourceInboundId, scope.now] : [])).first(); } catch { return false; }
  }
  async ownsContext(scope: ConversationScope): Promise<boolean> {
    try { return !!await this.db.prepare(`SELECT 1 FROM conversation_contract_ownership WHERE chat_identity_id=? AND owner_id=? AND contract_version=2 AND EXISTS(${ownedInbound})`)
      .bind(scope.chatIdentityId, scope.ownerId, ...auth(scope)).first(); } catch { return false; }
  }
  async ownsLegacyContext(scope: ConversationScope): Promise<boolean> {
    try { return !!await this.db.prepare(`SELECT 1 FROM conversation_contexts c
      WHERE c.owner_id=? AND c.chat_identity_id=? AND c.contract_version=1 AND c.status IN ('CLARIFYING','DRAFT_READY') AND c.expires_at>?
      AND NOT EXISTS(SELECT 1 FROM conversation_contract_ownership WHERE chat_identity_id=c.chat_identity_id)
      AND EXISTS(${ownedInbound})
      AND (c.status='CLARIFYING' OR EXISTS(SELECT 1 FROM reminder_series_proposals p WHERE p.owner_id=c.owner_id AND p.chat_identity_id=c.chat_identity_id AND p.contract_version=1 AND p.status='PENDING' AND p.expires_at>?)
        OR EXISTS(SELECT 1 FROM command_drafts d WHERE d.chat_identity_id=c.chat_identity_id AND d.contract_version=1 AND d.status='PENDING' AND d.expires_at>?))`)
      .bind(scope.ownerId, scope.chatIdentityId, scope.now, ...auth(scope), scope.now, scope.now).first(); } catch { return false; }
  }
}

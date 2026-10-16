import type { ConversationScope } from "../contracts";
import type { ContextObservation } from "./state";
import { ContextObservationBindingSchema } from "./state";
import { ownedInbound, auth } from "../infrastructure/d1/context-store";
import { newerConversationOutcomeSql } from "@/modules/semantic/infrastructure/d1/conversation-order";
import { contextObservationProtocol } from "./infrastructure/d1/store";
import { CONTEXT_PROTOCOL_V3, isContextProtocolV3, type ContextProtocolV3 } from "./protocol";
import { contextContractEncryptionIdentity } from "./store";
import { decodeContextSnapshotV2 } from "./state";
import { persistedD1Blob } from "@/modules/db/persisted-blob";
import type { Keyring } from "@/modules/security/keyring";

export interface ContextRuntimeStore {
  claimAttempt(scope: ConversationScope, observation: ContextObservation, bindingDigest: string): Promise<boolean>;
  complete(scope: ConversationScope): Promise<boolean>;
  canSend(scope: ConversationScope, expected?: { contextId: string; contextRevision: number }, observation?: ContextObservation): Promise<boolean>;
  ownsContext(scope: ConversationScope): Promise<boolean>;
}

export class D1ContextRuntimeStore implements ContextRuntimeStore {
  constructor(private readonly db: D1Database, private readonly selection?: { protocol: Readonly<ContextProtocolV3>; keyring: Keyring }) {
    if(selection && !isContextProtocolV3(selection.protocol))throw new Error("UNSUPPORTED_CONTEXT_PROTOCOL");
  }
  private async selectedContext(scope: ConversationScope, expected?: { contextId: string; contextRevision: number }): Promise<boolean> {
    if(!this.selection)return true;
    try {
      const row=await this.db.prepare("SELECT id,revision,key_version,payload_ciphertext,payload_iv FROM conversation_contexts WHERE owner_id=? AND chat_identity_id=? AND contract_version=2 AND status IN ('CLARIFYING','DRAFT_READY') AND expires_at>?")
        .bind(scope.ownerId,scope.chatIdentityId,scope.now).first<{id:string;revision:number;key_version:number;payload_ciphertext:unknown;payload_iv:unknown}>();
      if(!row)return false;
      const value=decodeContextSnapshotV2(await this.selection.keyring.decryptSensitive("context-contract-state",contextContractEncryptionIdentity(scope,row.id,this.selection.protocol),row.key_version,{ciphertext:persistedD1Blob(row.payload_ciphertext),iv:persistedD1Blob(row.payload_iv)}));
      return value.id===row.id && value.contextRevision===row.revision && value.scope.ownerId===scope.ownerId && value.scope.chatIdentityId===scope.chatIdentityId
        && (!expected || expected.contextId===row.id && expected.contextRevision===row.revision);
    }catch{return false;}
  }
  async claimAttempt(scope: ConversationScope, observation: ContextObservation, bindingDigest: string): Promise<boolean> {
    if(contextObservationProtocol(observation)!==(this.selection?"calenote-context-3":"calenote-context-2"))return false;
    if(this.selection && observation.observed.presence==="PRESENT" && !await this.selectedContext(scope,{contextId:observation.observed.contextId,contextRevision:observation.observed.contextRevision}))return false;
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
  async canSend(scope: ConversationScope, expected?: { contextId: string; contextRevision: number }, observation?: ContextObservation): Promise<boolean> {
    try {
    if (this.selection) {
      // The selected store minted this observation before any payload cleanup.
      // SQL family2 alone cannot attest the encrypted protocol or grant a send.
      if (!observation || contextObservationProtocol(observation) !== "calenote-context-3"
        || observation.scope.ownerId !== scope.ownerId || observation.scope.chatIdentityId !== scope.chatIdentityId
        || observation.inbound.id !== scope.sourceInboundId || observation.inbound.claimMarker !== scope.claimMarker) return false;
      if (!await this.selectedContext(scope, expected)) {
        const row = await this.db.prepare("SELECT id,revision,status,last_inbound_id FROM conversation_contexts WHERE owner_id=? AND chat_identity_id=? ORDER BY updated_at DESC LIMIT 1")
          .bind(scope.ownerId, scope.chatIdentityId).first<{ id: string; revision: number; status: string; last_inbound_id: string }>();
        if (observation.observed.presence === "PRESENT") {
          if (!row || !["COMPLETED", "CANCELLED", "INVALID"].includes(row.status) || row.last_inbound_id !== scope.sourceInboundId
            || row.id !== observation.observed.contextId || row.revision !== observation.observed.contextRevision + 1
            || expected && (row.id !== expected.contextId || row.revision !== expected.contextRevision)) return false;
        } else {
          if (expected) return false;
          const terminal = observation.lastTerminalOutcome;
          if (terminal ? !row || row.id !== terminal.contextId || row.revision !== terminal.contextRevision || row.status !== terminal.status || row.last_inbound_id !== terminal.inboundId : row !== null) return false;
        }
      }
    }
    return !!await this.db.prepare(`SELECT 1 FROM inbound_updates i
      JOIN chat_identities ci ON ci.connection_id=i.connection_id AND ci.provider_user_id=i.provider_user_id AND ci.private_chat_id=i.private_chat_id
      JOIN bot_connections c ON c.id=ci.connection_id AND c.state='ACTIVE_BOUND'
      WHERE i.id=? AND i.transition_marker=? AND i.state IN ('PROCESSED','REJECTED') AND ci.id=? AND c.user_id=?
      AND NOT ${newerConversationOutcomeSql("i", true)}
      ${expected ? "AND EXISTS(SELECT 1 FROM conversation_contexts WHERE id=? AND owner_id=? AND chat_identity_id=? AND revision=? AND last_inbound_id=? AND contract_version=2 AND (expires_at>? OR status IN ('COMPLETED','CANCELLED')))" : ""}`)
      .bind(scope.sourceInboundId, scope.claimMarker, scope.chatIdentityId, scope.ownerId,
        ...(expected ? [expected.contextId, scope.ownerId, scope.chatIdentityId, expected.contextRevision, scope.sourceInboundId, scope.now] : [])).first(); } catch { return false; }
  }
  async ownsContext(scope: ConversationScope): Promise<boolean> {
    // This answers the shared SQL ownership fence, not decoder eligibility.
    // A legacy/corrupt family2 owner must still block parallel request routing.
    try { return !!await this.db.prepare(`SELECT 1 FROM conversation_contract_ownership WHERE chat_identity_id=? AND owner_id=? AND contract_version=2 AND EXISTS(${ownedInbound})`)
      .bind(scope.chatIdentityId, scope.ownerId, ...auth(scope)).first(); } catch { return false; }
  }
}
export function createD1ContextRuntimeStoreV3(args:{db:D1Database;keyring:Keyring;protocol:ContextProtocolV3}):ContextRuntimeStore {
  if(!isContextProtocolV3(args.protocol))throw new Error("UNSUPPORTED_CONTEXT_PROTOCOL");
  return new D1ContextRuntimeStore(args.db,{protocol:CONTEXT_PROTOCOL_V3,keyring:args.keyring});
}

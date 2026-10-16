/** Compare durable outcomes, including the interval before inbound terminalization.
 * Pending/processing arrivals alone do not supersede an earlier request: a queued
 * confirmation may legitimately follow a create that has not finished yet.
 */
export async function hasContextContract(database: D1Database): Promise<boolean> {
  return !!await database.prepare("SELECT name FROM pragma_table_info('conversation_contexts') WHERE name='contract_version'").first<{name:string}>();
}
/** Allows pre-0009 local fixtures/rollback binaries to retain legacy semantics.
 * Migrated databases additionally enforce all writes through SQL triggers. */
export async function legacyContractGuard(database:D1Database, alias:string):Promise<string> {
  if (!/^[a-z_]+$/u.test(alias)) throw new TypeError("Invalid SQL alias");
  return await hasContextContract(database) ? ` AND ${alias}.contract_version=1` : "";
}
export function newerConversationOutcomeSql(current: "current" | "i" | "inbound_updates", successor = false): string {
  return `EXISTS (
    SELECT 1 FROM inbound_updates later
    WHERE later.connection_id = ${current}.connection_id
      AND later.provider_user_id = ${current}.provider_user_id
      AND later.private_chat_id = ${current}.private_chat_id
      AND (later.received_at > ${current}.received_at
        OR (later.received_at = ${current}.received_at AND later.rowid > ${current}.rowid))
      AND (later.state IN ('PROCESSED', 'REJECTED')
        ${successor ? "OR EXISTS (SELECT 1 FROM conversation_context_outcomes history WHERE history.source_inbound_id = later.id)" : ""}
        OR EXISTS (SELECT 1 FROM semantic_contexts history
          WHERE history.source_inbound_id = later.id OR history.resolution_inbound_id = later.id)
        OR EXISTS (SELECT 1 FROM command_drafts history
          WHERE history.source_inbound_id = later.id OR history.resolution_inbound_id = later.id))
  )${successor ? ` OR EXISTS (SELECT 1 FROM conversation_contexts wc JOIN chat_identities ci ON ci.id=wc.chat_identity_id
    WHERE ci.connection_id=${current}.connection_id AND ci.provider_user_id=${current}.provider_user_id
      AND ci.private_chat_id=${current}.private_chat_id AND wc.claim_marker LIKE 'web:%' AND wc.updated_at>=${current}.received_at)` : ""}`.replace(/^/u, "(") + ")";
}

/** Terminalize only this still-owned stale inbound, without touching newer state. */
export async function rejectSupersededSemanticInbound(
  database: D1Database, message: { id: string; claimMarker: string }, now: number,
): Promise<boolean> {
  const result = await database.prepare(
    `UPDATE inbound_updates SET state = 'REJECTED', processed_at = ?
     WHERE id = ? AND state = 'PROCESSING' AND transition_marker = ?
       AND ${newerConversationOutcomeSql("inbound_updates", await hasContextContract(database))}`,
  ).bind(now, message.id, message.claimMarker).run();
  return result.meta.changes === 1;
}

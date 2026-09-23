/** Compare durable outcomes, including the interval before inbound terminalization.
 * Pending/processing arrivals alone do not supersede an earlier request: a queued
 * confirmation may legitimately follow a create that has not finished yet.
 */
export function newerConversationOutcomeSql(current: "current" | "i" | "inbound_updates"): string {
  return `EXISTS (
    SELECT 1 FROM inbound_updates later
    WHERE later.connection_id = ${current}.connection_id
      AND later.provider_user_id = ${current}.provider_user_id
      AND later.private_chat_id = ${current}.private_chat_id
      AND (later.received_at > ${current}.received_at
        OR (later.received_at = ${current}.received_at AND later.rowid > ${current}.rowid))
      AND (later.state IN ('PROCESSED', 'REJECTED')
        OR EXISTS (SELECT 1 FROM semantic_contexts history
          WHERE history.source_inbound_id = later.id OR history.resolution_inbound_id = later.id)
        OR EXISTS (SELECT 1 FROM command_drafts history
          WHERE history.source_inbound_id = later.id OR history.resolution_inbound_id = later.id))
  )`;
}

/** Terminalize only this still-owned stale inbound, without touching newer state. */
export async function rejectSupersededSemanticInbound(
  database: D1Database, message: { id: string; claimMarker: string }, now: number,
): Promise<boolean> {
  const result = await database.prepare(
    `UPDATE inbound_updates SET state = 'REJECTED', processed_at = ?
     WHERE id = ? AND state = 'PROCESSING' AND transition_marker = ?
       AND ${newerConversationOutcomeSql("inbound_updates")}`,
  ).bind(now, message.id, message.claimMarker).run();
  return result.meta.changes === 1;
}

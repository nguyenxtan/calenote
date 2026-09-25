import { z } from "zod";
import { PendingRequestSchema, type ConversationScope, type PendingRequest } from "@/modules/conversation/contracts";
import { D1ConversationStore, ownedInbound, auth } from "@/modules/conversation/infrastructure/d1/context-store";
import { persistedD1Blob } from "@/modules/db/persisted-blob";
import type { Keyring } from "@/modules/security/keyring";
import { randomOpaqueId } from "@/modules/platform/types";
import { expandFiniteSeries, type SeriesStore } from "../../series";

const createPayload = z.object({ request: PendingRequestSchema,
  occurrences: z.array(z.object({ index: z.number().int(), scheduledAt: z.number().int(), localDate: z.string() }).strict()).min(2).max(30),
}).strict();
const cancelPayload = z.object({ seriesId: z.string(), revision: z.number().int().positive() }).strict();
interface ProposalRow {
  id: string; action: "CREATE" | "CANCEL"; revision: number; status: string; context_id: string | null;
  context_revision: number | null; target_series_id: string | null; target_revision: number | null;
  source_inbound_id: string; expires_at: number; payload_ciphertext: unknown; payload_iv: unknown; key_version: number;
}
const binding = (scope: ConversationScope, id: string) => JSON.stringify([scope.ownerId, scope.chatIdentityId, id]);
const token = () => randomOpaqueId();
// Statements following a claim depend on a fresh, unique transaction marker.
// A concurrent loser's no-op UPDATE cannot authorize any subsequent insert.
const claimed = "EXISTS (SELECT 1 FROM reminder_series_proposals p WHERE p.id = ? AND p.transaction_marker = ?)";
const afterSource = `EXISTS (SELECT 1 FROM inbound_updates current JOIN inbound_updates source
  ON source.id = reminder_series_proposals.source_inbound_id WHERE current.id = ?
  AND (source.received_at < current.received_at OR (source.received_at = current.received_at AND source.rowid < current.rowid)))`;

export class D1SeriesStore implements SeriesStore {
  constructor(private readonly db: D1Database, private readonly keyring: Keyring) {}

  private async read(scope: ConversationScope, id: string, revision: number): Promise<ProposalRow | null> {
    if (!Number.isSafeInteger(revision) || revision < 1 || !Number.isSafeInteger(scope.now)) return null;
    return this.db.prepare(`SELECT * FROM reminder_series_proposals WHERE id = ? AND revision = ?
      AND owner_id = ? AND chat_identity_id = ? AND EXISTS (${ownedInbound})`)
      .bind(id, revision, scope.ownerId, scope.chatIdentityId, ...auth(scope)).first<ProposalRow>();
  }
  private async decrypt(scope: ConversationScope, row: ProposalRow): Promise<unknown> {
    return JSON.parse(await this.keyring.decryptSensitive("series-proposal", binding(scope, row.id), row.key_version, {
      ciphertext: persistedD1Blob(row.payload_ciphertext), iv: persistedD1Blob(row.payload_iv),
    }));
  }
  private invalidateOld(scope: ConversationScope) {
    return this.db.prepare(`UPDATE reminder_series_proposals SET status = 'INVALID' WHERE chat_identity_id = ? AND owner_id = ?
      AND status = 'PENDING' AND (expires_at <= ? OR (action = 'CREATE' AND NOT EXISTS
        (SELECT 1 FROM conversation_contexts c WHERE c.id = context_id AND c.revision = context_revision
          AND c.status = 'DRAFT_READY' AND c.expires_at > ?))) AND EXISTS (${ownedInbound})`)
      .bind(scope.chatIdentityId, scope.ownerId, scope.now, scope.now, ...auth(scope));
  }
  async propose(scope: ConversationScope, request: PendingRequest, contextId: string, contextRevision: number) {
    const parsedRequest = PendingRequestSchema.safeParse(request);
    if (!parsedRequest.success) return null;
    request = parsedRequest.data;
    const context = await new D1ConversationStore(this.db, this.keyring).load(scope);
    if (!context || context.id !== contextId || context.revision !== contextRevision || context.status !== "DRAFT_READY"
      || JSON.stringify(context.request) !== JSON.stringify(request)) return null;
    const expansion = expandFiniteSeries(request, scope.now);
    if (expansion.status !== "READY") return null;
    const id = token();
    const encrypted = await this.keyring.encryptSensitive("series-proposal", binding(scope, id), 1,
      JSON.stringify({ request, occurrences: expansion.occurrences }));
    const expires = Math.min(context.expiresAt, scope.now + 600_000);
    try {
      const results = await this.db.batch([this.invalidateOld(scope), this.db.prepare(`INSERT INTO reminder_series_proposals
        (id,owner_id,chat_identity_id,context_id,context_revision,revision,source_inbound_id,action,status,
          payload_ciphertext,payload_iv,key_version,created_at,expires_at)
        SELECT ?,?,?,?,?,1,?,'CREATE','PENDING',?,?,1,?,? WHERE EXISTS (${ownedInbound})
          AND EXISTS (SELECT 1 FROM conversation_contexts WHERE id = ? AND revision = ? AND status = 'DRAFT_READY'
            AND last_inbound_id = ? AND expires_at = ? AND owner_id = ? AND chat_identity_id = ?)
          AND NOT EXISTS (SELECT 1 FROM command_drafts WHERE chat_identity_id = ? AND status = 'PENDING' AND expires_at > ?)`)
        .bind(id, scope.ownerId, scope.chatIdentityId, contextId, contextRevision, scope.sourceInboundId,
          encrypted.ciphertext, encrypted.iv, scope.now, expires, ...auth(scope), contextId, contextRevision,
          scope.sourceInboundId, context.expiresAt, scope.ownerId, scope.chatIdentityId, scope.chatIdentityId, scope.now)]);
      return results[1].meta.changes === 1 ? { proposalId: id, revision: 1 } : null;
    } catch (error) {
      if (!(error instanceof Error) || !/UNIQUE constraint failed/u.test(error.message)) throw error;
      const prior = await this.db.prepare(`SELECT id, revision FROM reminder_series_proposals WHERE context_id = ? AND context_revision = ?
        AND owner_id = ? AND chat_identity_id = ? AND status = 'PENDING' AND EXISTS (${ownedInbound})`)
        .bind(contextId, contextRevision, scope.ownerId, scope.chatIdentityId, ...auth(scope)).first<{ id: string; revision: number }>();
      return prior ? { proposalId: prior.id, revision: prior.revision } : null;
    }
  }

  async confirm(scope: ConversationScope, proposalId: string, revision: number): ReturnType<SeriesStore["confirm"]> {
    const row = await this.read(scope, proposalId, revision);
    if (!row || row.action !== "CREATE") return { status: "STALE" };
    const existing = await this.db.prepare("SELECT id FROM reminder_series WHERE proposal_id = ?").bind(row.id).first<string>("id");
    if (row.status === "CONFIRMED" && existing) return { status: "ALREADY_CONFIRMED", seriesId: existing };
    if (row.expires_at <= scope.now) return { status: "EXPIRED" };
    let payload: z.infer<typeof createPayload>;
    try { payload = createPayload.parse(await this.decrypt(scope, row)); } catch { return { status: "REJECTED" }; }
    const expansion = expandFiniteSeries(payload.request, scope.now);
    if (expansion.status !== "READY" || JSON.stringify(expansion.occurrences) !== JSON.stringify(payload.occurrences)) return { status: "REJECTED" };
    const marker = token();
    const seriesId = token();
    const claimArgs = [proposalId, marker];
    const statements = [this.db.prepare(`UPDATE reminder_series_proposals SET status = 'CONFIRMED', transaction_marker = ?, resolution_inbound_id = ?
      WHERE id = ? AND revision = ? AND status = 'PENDING' AND expires_at > ? AND owner_id = ? AND chat_identity_id = ?
        AND EXISTS (${ownedInbound}) AND ${afterSource}
        AND EXISTS (SELECT 1 FROM conversation_contexts c WHERE c.id = context_id AND c.revision = context_revision
          AND c.status = 'DRAFT_READY' AND c.expires_at > ? AND c.owner_id = ? AND c.chat_identity_id = ?)
        AND NOT EXISTS (SELECT 1 FROM command_drafts WHERE chat_identity_id = ? AND status = 'PENDING' AND expires_at > ?)`)
      .bind(marker, scope.sourceInboundId, row.id, revision, scope.now, scope.ownerId, scope.chatIdentityId,
        ...auth(scope), scope.sourceInboundId, scope.now, scope.ownerId, scope.chatIdentityId, scope.chatIdentityId, scope.now),
    this.db.prepare(`INSERT INTO reminder_series (id,public_id,owner_id,chat_identity_id,proposal_id,revision,status,created_at,updated_at)
      SELECT ?,?,?,?,?,1,'ACTIVE',?,? WHERE ${claimed}`)
      .bind(seriesId, token(), scope.ownerId, scope.chatIdentityId, proposalId, scope.now, scope.now, ...claimArgs)];
    const reminderRows: unknown[][] = [];
    const occurrenceRows: unknown[][] = [];
    const calendarRows: unknown[][] = [];
    for (const occurrence of expansion.occurrences) {
      const reminderId = token();
      const title = await this.keyring.encryptSensitive("reminder-title", reminderId, 1, payload.request.title!);
      const facts = await this.keyring.encryptSensitive("reminder-calendar", binding(scope, reminderId), 1,
        JSON.stringify({ calendar: payload.request.calendar, eventDate: payload.request.eventDate, reminderDate: payload.request.reminderDate, localDate: occurrence.localDate }));
      reminderRows.push([reminderId, token(), scope.ownerId, scope.ownerId, scope.chatIdentityId, title.ciphertext, title.iv, occurrence.scheduledAt, scope.now, scope.now, ...claimArgs]);
      occurrenceRows.push([seriesId, occurrence.index, reminderId, ...claimArgs]);
      calendarRows.push([reminderId, reminderId, facts.ciphertext, facts.iv, ...claimArgs]);
    }
    // D1 has a 100-binding statement ceiling and tier-dependent invocation
    // query ceilings. Group rows below 96 bindings, but keep every group in
    // this same atomic batch and every SELECT fenced to the winning claim.
    const appendRows = (prefix: string, select: string, rows: unknown[][]) => {
      const size = Math.floor(96 / rows[0].length);
      for (let offset = 0; offset < rows.length; offset += size) {
        const group = rows.slice(offset, offset + size);
        const columns = group[0].map((_, index) => `c${index}`);
        let column = 0;
        const projection = select.replace(` WHERE ${claimed}`, ` FROM data WHERE ${claimed}`)
          .replace(/\?/gu, () => `data.c${column++}`);
        const tuple = `(${columns.map(() => "?").join(",")})`;
        // VALUES avoids workerd's separate compound-SELECT term ceiling.
        statements.push(this.db.prepare(`WITH data(${columns.join(",")}) AS (VALUES ${group.map(() => tuple).join(",")}) ${prefix}${projection}`)
          .bind(...group.flat()));
      }
    };
    appendRows(`INSERT INTO reminders
        (id,public_id,workspace_id,chat_identity_id,source_draft_id,title_ciphertext,title_iv,title_key_version,scheduled_at,timezone,status,created_at,updated_at)
        `, `SELECT ?,?,(SELECT w.id FROM workspaces w JOIN memberships m ON m.workspace_id = w.id AND m.user_id = ? AND m.role = 'OWNER'
          WHERE w.owner_user_id = ? AND w.kind = 'PERSONAL'),?,NULL,?,?,1,?,'Asia/Ho_Chi_Minh','PENDING',?,? WHERE ${claimed}`, reminderRows);
    appendRows("INSERT INTO reminder_series_occurrences (series_id,occurrence_index,reminder_id) ", `SELECT ?,?,? WHERE ${claimed}`, occurrenceRows);
    appendRows("INSERT INTO reminder_calendar_facts (reminder_id,encryption_entity_id,payload_ciphertext,payload_iv,key_version) ", `SELECT ?,?,?,?,1 WHERE ${claimed}`, calendarRows);
    statements.push(this.db.prepare(`UPDATE conversation_contexts SET status = 'COMPLETED', revision = revision + 1, updated_at = ?,
      last_inbound_id = ?, claim_marker = ?, payload_ciphertext = NULL, payload_iv = NULL, key_version = NULL WHERE id = ? AND ${claimed}`)
      .bind(scope.now, scope.sourceInboundId, scope.claimMarker, row.context_id, ...claimArgs),
    this.db.prepare(`INSERT INTO conversation_context_outcomes (context_id,revision,source_inbound_id,operation,created_at)
      SELECT ?,?,?,'FINISH',? WHERE ${claimed}`).bind(row.context_id, row.context_revision! + 1, scope.sourceInboundId, scope.now, ...claimArgs),
    ...this.finishInbound(scope, proposalId, marker, "REMINDER_SERIES_CONFIRMED"));
    const results = await this.db.batch(statements);
    if (results[0].meta.changes === 1) return { status: "CONFIRMED", seriesId };
    const winner = await this.db.prepare(`SELECT s.id FROM reminder_series s JOIN reminder_series_proposals p ON p.id = s.proposal_id
      WHERE p.id = ? AND p.status = 'CONFIRMED' AND s.owner_id = ? AND s.chat_identity_id = ?`)
      .bind(proposalId, scope.ownerId, scope.chatIdentityId).first<string>("id");
    return winner ? { status: "ALREADY_CONFIRMED", seriesId: winner } : { status: "STALE" };
  }
  private finishInbound(scope: ConversationScope, id: string, marker: string, action: string) {
    return [this.db.prepare(`UPDATE inbound_updates SET state = 'PROCESSED', processed_at = ? WHERE id = ? AND state = 'PROCESSING'
      AND transition_marker = ? AND ${claimed}`).bind(scope.now, scope.sourceInboundId, scope.claimMarker, id, marker),
    this.db.prepare(`INSERT INTO audit_events (id,actor_user_id,action,target_user_id,result,created_at)
      SELECT ?,?,?,?,'SUCCESS',? WHERE ${claimed}`).bind(token(), scope.ownerId, action, scope.ownerId, scope.now, id, marker)];
  }

  async proposeCancellation(scope: ConversationScope, seriesId: string) {
    const series = await this.db.prepare(`SELECT revision FROM reminder_series WHERE id = ? AND owner_id = ? AND chat_identity_id = ?
      AND status = 'ACTIVE' AND EXISTS (${ownedInbound})`).bind(seriesId, scope.ownerId, scope.chatIdentityId, ...auth(scope)).first<{ revision: number }>();
    if (!series) return null;
    const id = token();
    const encrypted = await this.keyring.encryptSensitive("series-proposal", binding(scope, id), 1, JSON.stringify({ seriesId, revision: series.revision }));
    try {
      const result = await this.db.batch([this.invalidateOld(scope), this.db.prepare(`INSERT INTO reminder_series_proposals
        (id,owner_id,chat_identity_id,revision,source_inbound_id,action,target_series_id,target_revision,status,payload_ciphertext,payload_iv,key_version,created_at,expires_at)
        SELECT ?,?,?,1,?,'CANCEL',?,?,'PENDING',?,?,1,?,? WHERE EXISTS (${ownedInbound})
        AND EXISTS (SELECT 1 FROM reminder_series WHERE id = ? AND revision = ? AND status = 'ACTIVE')
        AND NOT EXISTS (SELECT 1 FROM conversation_contexts WHERE chat_identity_id = ? AND status IN ('CLARIFYING','DRAFT_READY') AND expires_at > ?)
        AND NOT EXISTS (SELECT 1 FROM command_drafts WHERE chat_identity_id = ? AND status = 'PENDING' AND expires_at > ?)`)
        .bind(id, scope.ownerId, scope.chatIdentityId, scope.sourceInboundId, seriesId, series.revision, encrypted.ciphertext, encrypted.iv,
          scope.now, scope.now + 600_000, ...auth(scope), seriesId, series.revision, scope.chatIdentityId, scope.now, scope.chatIdentityId, scope.now)]);
      return result[1].meta.changes === 1 ? { proposalId: id, revision: 1 } : null;
    } catch (error) { if (error instanceof Error && /UNIQUE constraint failed/u.test(error.message)) return null; throw error; }
  }
  async cancelRemaining(scope: ConversationScope, proposalId: string, revision: number): ReturnType<SeriesStore["cancelRemaining"]> {
    const row = await this.read(scope, proposalId, revision);
    if (!row || row.action !== "CANCEL") return "STALE";
    if (row.status === "CONFIRMED") return "ALREADY_CANCELLED";
    if (row.status !== "PENDING" || row.expires_at <= scope.now) return "STALE";
    try {
      const payload = cancelPayload.parse(await this.decrypt(scope, row));
      if (payload.seriesId !== row.target_series_id || payload.revision !== row.target_revision) return "STALE";
    } catch { return "STALE"; }
    const marker = token();
    const claimArgs = [proposalId, marker];
    const results = await this.db.batch([
      this.db.prepare(`UPDATE reminder_series_proposals SET status = 'CONFIRMED', transaction_marker = ?, resolution_inbound_id = ?
        WHERE id = ? AND revision = ? AND status = 'PENDING' AND expires_at > ? AND EXISTS (${ownedInbound}) AND ${afterSource}
          AND EXISTS (SELECT 1 FROM reminder_series WHERE id = target_series_id AND revision = target_revision AND status = 'ACTIVE'
            AND owner_id = ? AND chat_identity_id = ?)
          AND NOT EXISTS (SELECT 1 FROM conversation_contexts WHERE chat_identity_id = ? AND status IN ('CLARIFYING','DRAFT_READY') AND expires_at > ?)
          AND NOT EXISTS (SELECT 1 FROM command_drafts WHERE chat_identity_id = ? AND status = 'PENDING' AND expires_at > ?)`)
        .bind(marker, scope.sourceInboundId, proposalId, revision, scope.now, ...auth(scope), scope.sourceInboundId, scope.ownerId, scope.chatIdentityId,
          scope.chatIdentityId, scope.now, scope.chatIdentityId, scope.now),
      this.db.prepare(`UPDATE reminders SET status = 'CANCELLED', cancelled_at = ?, updated_at = ?
        WHERE id IN (SELECT reminder_id FROM reminder_series_occurrences WHERE series_id = ?)
        AND scheduled_at > ? AND status IN ('PENDING','RETRYABLE') AND claimed_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM reminder_deliveries WHERE reminder_id = reminders.id AND status NOT IN ('PENDING','RETRYABLE')) AND ${claimed}`)
        .bind(scope.now, scope.now, row.target_series_id, scope.now, ...claimArgs),
      this.db.prepare(`UPDATE reminder_deliveries SET status = 'CANCELLED', updated_at = ? WHERE status IN ('PENDING','RETRYABLE')
        AND reminder_id IN (SELECT r.id FROM reminders r JOIN reminder_series_occurrences o ON o.reminder_id = r.id
          WHERE o.series_id = ? AND r.status = 'CANCELLED') AND ${claimed}`).bind(scope.now, row.target_series_id, ...claimArgs),
      this.db.prepare(`UPDATE reminder_series SET status = 'CANCELLED', revision = revision + 1, updated_at = ? WHERE id = ? AND ${claimed}`)
        .bind(scope.now, row.target_series_id, ...claimArgs),
      ...this.finishInbound(scope, proposalId, marker, "REMINDER_SERIES_CANCELLED"),
    ]);
    return results[0].meta.changes === 1 ? "CANCELLED" : "STALE";
  }
}

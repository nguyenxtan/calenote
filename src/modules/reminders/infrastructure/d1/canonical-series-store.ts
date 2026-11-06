import type { SessionPrincipal } from "@/modules/auth/session";
import { CanonicalSeriesCancelRequestSchema, CanonicalSeriesViewSchema,decodeCanonicalSeriesCursor,encodeCanonicalSeriesCursor, type CanonicalSeriesPage, type CanonicalSeriesCancelRequest, type CanonicalSeriesCancelResult, type CanonicalSeriesView } from "@/contracts/api/canonical-series";
import { CanonicalDetailsV1Schema } from "@/modules/conversation/context-contract/state";
import { contextContractEncryptionIdentity } from "@/modules/conversation/context-contract/store";
import { persistedD1Blob } from "@/modules/db/persisted-blob";
import { randomOpaqueId } from "@/modules/platform/types";
import type { Keyring } from "@/modules/security/keyring";
import { hasContextContract } from "@/modules/semantic/infrastructure/d1/conversation-order";

/** Corrupt, missing or foreign-bound canonical metadata. Never carries content. */
export class CanonicalSeriesIntegrityError extends Error {
  constructor() { super("CANONICAL_SERIES_INTEGRITY"); }
}
const AUDIT_ACTION = "CANONICAL_REMINDER_SERIES_CANCELLED";
type Status = CanonicalSeriesView["occurrences"][number]["status"];
interface SeriesRow {
  id: string; public_id: string; revision: number; status: "ACTIVE" | "CANCELLED"; chat_identity_id: string;
  d_series: string | null; d_owner: string | null; d_chat: string | null; encryption_entity_id: string | null; payload_version: string | null;
  payload_ciphertext: unknown; payload_iv: unknown; key_version: number | null;created_at:number;
}
interface ChildRow { id: string; scheduled_at: number; status: Status; title_ciphertext: unknown; title_iv: unknown; title_key_version: number }

// Only successor (contract_version=2) series, owned through an unrevoked,
// unexpired session of the same user. Legacy rows remain with D1SeriesStore.
const owned = `FROM reminder_series s
  JOIN reminder_series_proposals p ON p.id=s.proposal_id AND p.contract_version=2 AND p.owner_id=s.owner_id AND p.chat_identity_id=s.chat_identity_id
  JOIN sessions se ON se.id=? AND se.user_id=s.owner_id AND se.revoked_at IS NULL AND se.expires_at>?
  JOIN chat_identities ci ON ci.id=s.chat_identity_id
  JOIN bot_connections c ON c.id=ci.connection_id AND c.user_id=s.owner_id
    AND EXISTS(SELECT 1 FROM reminder_series_occurrences owned_o JOIN reminders owned_r ON owned_r.id=owned_o.reminder_id
      JOIN workspaces owned_w ON owned_w.id=owned_r.workspace_id AND owned_w.kind='PERSONAL' AND owned_w.owner_user_id=s.owner_id
      JOIN memberships owned_m ON owned_m.workspace_id=owned_w.id AND owned_m.user_id=s.owner_id AND owned_m.role='OWNER'
      WHERE owned_o.series_id=s.id AND owned_r.chat_identity_id=s.chat_identity_id)`;
const personal = `JOIN workspaces w ON w.owner_user_id=s.owner_id AND w.kind='PERSONAL'
  JOIN memberships m ON m.workspace_id=w.id AND m.user_id=s.owner_id AND m.role='OWNER'`;
const acquired = "('SENDING','SENT','FAILED','UNCERTAIN','CANCELLED')";
const terminal = new Set<Status>(["SENT", "CANCELLED", "FAILED"]);
const wallTime=(scheduledAt:number)=>{try{return new Date(scheduledAt+7*3_600_000).toISOString();}catch{throw new CanonicalSeriesIntegrityError();}};

export class D1CanonicalSeriesStore {
  constructor(private readonly db: D1Database, private readonly keyring: Keyring) {}

  async list(principal: SessionPrincipal, now: number): Promise<CanonicalSeriesView[]> {
    return (await this.listPage(principal,now)).series;
  }
  async listPage(principal:SessionPrincipal,now:number,cursor?:string):Promise<CanonicalSeriesPage>{
    const empty={series:[],hasMore:false,nextCursor:null,skipped:0};
    if (!Number.isSafeInteger(now) || !await hasContextContract(this.db)) return empty;
    const after=cursor===undefined?null:decodeCanonicalSeriesCursor(cursor);if(cursor!==undefined&&!after)throw new TypeError('INVALID_SERIES_CURSOR');
    const rank="CASE WHEN s.status='ACTIVE' THEN 0 ELSE 1 END";
    const paging=after?`AND (${rank}>? OR (${rank}=? AND (s.created_at<? OR (s.created_at=? AND s.public_id>?))))`:'';
    const rows = (await this.db.prepare(`SELECT s.id,s.public_id,s.revision,s.status,s.chat_identity_id,s.created_at,
        d.series_id d_series,d.owner_id d_owner,d.chat_identity_id d_chat,d.encryption_entity_id,d.payload_version,d.payload_ciphertext,d.payload_iv,d.key_version
      ${owned} LEFT JOIN reminder_series_context_details d ON d.series_id=s.id
      WHERE s.owner_id=? ${paging} ORDER BY ${rank},s.created_at DESC,s.public_id LIMIT 11`)
      .bind(principal.sessionId, now, principal.userId,...(after?[after[0],after[0],after[1],after[1],after[2]]:[])).all<SeriesRow>()).results;
    const result: CanonicalSeriesView[] = [];
    let skipped=0;for (const row of rows.slice(0,10))try{result.push(await this.view(principal.userId,row));}catch(error){if(error instanceof CanonicalSeriesIntegrityError)skipped++;else throw error;}
    const last=rows[9],hasMore=rows.length>10;
    return {series:result,hasMore,nextCursor:hasMore?encodeCanonicalSeriesCursor([last.status==='ACTIVE'?0:1,last.created_at,last.public_id]):null,skipped};
  }

  private async view(ownerId: string, row: SeriesRow): Promise<CanonicalSeriesView> {
    if (row.d_series !== row.id || row.d_owner !== ownerId || row.d_chat !== row.chat_identity_id || row.encryption_entity_id !== row.id
      || row.payload_version !== "calenote-reminder-details-1" || row.key_version === null) throw new CanonicalSeriesIntegrityError();
    const scope = { ownerId, chatIdentityId: row.chat_identity_id };
    let details;
    try {
      details = CanonicalDetailsV1Schema.parse(JSON.parse(await this.keyring.decryptSensitive("context-contract-series-details",
        contextContractEncryptionIdentity(scope, row.id), row.key_version, { ciphertext: persistedD1Blob(row.payload_ciphertext), iv: persistedD1Blob(row.payload_iv) })));
    } catch { throw new CanonicalSeriesIntegrityError(); }
    const total = Number(await this.db.prepare("SELECT count(*) n FROM reminder_series_occurrences WHERE series_id=?").bind(row.id).first("n"));
    const children = (await this.db.prepare(`SELECT r.id,r.scheduled_at,r.status,r.title_ciphertext,r.title_iv,r.title_key_version
      FROM reminder_series_occurrences o JOIN reminders r ON r.id=o.reminder_id
      JOIN workspaces w ON w.id=r.workspace_id AND w.owner_user_id=? AND w.kind='PERSONAL'
      JOIN memberships m ON m.workspace_id=w.id AND m.user_id=w.owner_user_id AND m.role='OWNER'
      WHERE o.series_id=? AND r.chat_identity_id=? ORDER BY o.occurrence_index LIMIT 31`)
      .bind(ownerId, row.id, row.chat_identity_id).all<ChildRow>()).results;
    if (!children.length || children.length > 30 || children.length !== total) throw new CanonicalSeriesIntegrityError();
    let title: string;
    try {
      title = await this.keyring.decryptSensitive("reminder-title", children[0].id, children[0].title_key_version,
        { ciphertext: persistedD1Blob(children[0].title_ciphertext), iv: persistedD1Blob(children[0].title_iv) });
    } catch { throw new CanonicalSeriesIntegrityError(); }
    const occurrences = children.map(child => {
      const wall = wallTime(child.scheduled_at);
      return { localDate: wall.slice(0, 10), localTime: wall.slice(11, 16), status: child.status };
    });
    const current = (await this.db.prepare(`SELECT f.root_reminder_id,r.id,r.scheduled_at,r.status,f.progress,f.follow_up_enabled,f.next_follow_up_at
      FROM follow_through_items f JOIN reminders r ON r.id=f.current_reminder_id
      JOIN workspaces w ON w.id=r.workspace_id AND w.owner_user_id=f.owner_user_id AND w.kind='PERSONAL'
      JOIN memberships m ON m.workspace_id=w.id AND m.user_id=w.owner_user_id AND m.role='OWNER'
      WHERE f.owner_user_id=? AND f.chat_identity_id=? AND r.chat_identity_id=f.chat_identity_id
      AND f.root_reminder_id IN (SELECT reminder_id FROM reminder_series_occurrences WHERE series_id=?) ORDER BY r.scheduled_at,r.id LIMIT 31`)
      .bind(ownerId,row.chat_identity_id,row.id).all<{root_reminder_id:string;id:string;scheduled_at:number;status:Status;progress:string;follow_up_enabled:number;next_follow_up_at:number|null}>()).results;
    if(current.length>30)throw new CanonicalSeriesIntegrityError();
    const currentReminders = current.filter(r=>r.id!==r.root_reminder_id).map(child=>{
      const wall=wallTime(child.scheduled_at);
      return {localDate:wall.slice(0,10),localTime:wall.slice(11,16),status:child.status};
    });
    const pendingFollowUps=current.filter(r=>r.progress==='OPEN'&&r.follow_up_enabled===1&&r.next_follow_up_at!==null).length;
    const state = row.status === "CANCELLED" ? "CANCELLED" : occurrences.every(o => terminal.has(o.status)) && currentReminders.every(o=>terminal.has(o.status)) && !pendingFollowUps ? "COMPLETED" : "ACTIVE";
    const parsed = CanonicalSeriesViewSchema.safeParse({ publicId: row.public_id, revision: row.revision, state, title,
      calendar: details.calendarProvenance.calendar, eventDate: details.eventDate, eventTime: details.eventTime, occurrences,
      ...(currentReminders.length?{currentReminders}:{}),...(pendingFollowUps?{pendingFollowUps}:{}) });
    if (!parsed.success) throw new CanonicalSeriesIntegrityError();
    return parsed.data;
  }

  private async locate(principal: SessionPrincipal, publicId: string, now: number) {
    return this.db.prepare(`SELECT s.id,s.revision,s.status,s.chat_identity_id ${owned} WHERE s.public_id=? AND s.owner_id=?`)
      .bind(principal.sessionId, now, publicId, principal.userId).first<{ id: string; revision: number; status: "ACTIVE" | "CANCELLED"; chat_identity_id: string }>();
  }

  /** One atomic batch. A fresh audit id is the CAS-winner marker; a concurrent
   * loser inserts no audit row and therefore authorizes no child mutation. */
  async cancel(principal: SessionPrincipal, raw: CanonicalSeriesCancelRequest, now: number): Promise<CanonicalSeriesCancelResult> {
    const parsed = CanonicalSeriesCancelRequestSchema.safeParse(raw);
    if (!parsed.success || !Number.isSafeInteger(now) || !await hasContextContract(this.db)) return { result: "NOT_FOUND" };
    const request = parsed.data, owner = principal.userId;
    const series = await this.locate(principal, request.publicId, now);
    if (!series) return { result: "NOT_FOUND" };
    if (series.status === "CANCELLED") return { result: "ALREADY_CANCELLED", revision: series.revision };
    if (series.revision !== request.expectedRevision) return { result: "CONFLICT" };
    const marker = randomOpaqueId();
    const won = "EXISTS(SELECT 1 FROM audit_events a WHERE a.id=? AND a.actor_user_id=? AND a.action=?)";
    const wonArgs = [marker, owner, AUDIT_ACTION];
    const targets = `SELECT o.reminder_id FROM reminder_series_occurrences o JOIN reminder_series s ON s.id=o.series_id WHERE s.id=? AND s.owner_id=?
      UNION SELECT run.reminder_id FROM follow_through_runs run JOIN follow_through_items f ON f.id=run.item_id
        JOIN reminder_series_occurrences o ON o.reminder_id=f.root_reminder_id WHERE o.series_id=? AND f.owner_user_id=?
      UNION SELECT f.current_reminder_id FROM follow_through_items f JOIN reminder_series_occurrences o ON o.reminder_id=f.root_reminder_id
        WHERE o.series_id=? AND f.owner_user_id=?`;
    const targetArgs = [series.id, owner, series.id, owner, series.id, owner];
    const scopeFor = (alias="") => `${alias}chat_identity_id=? AND ${alias}workspace_id IN (SELECT w.id FROM workspaces w JOIN memberships m ON m.workspace_id=w.id AND m.user_id=w.owner_user_id AND m.role='OWNER' WHERE w.owner_user_id=? AND w.kind='PERSONAL')`;
    const scoped = scopeFor();
    const scopedArgs = [series.chat_identity_id, owner];
    const results = await this.db.batch([
      this.db.prepare(`INSERT INTO audit_events(id,actor_user_id,action,target_user_id,result,created_at)
        SELECT ?,?,?,?,'SUCCESS',? WHERE EXISTS(SELECT 1 ${owned} ${personal} WHERE s.id=? AND s.owner_id=? AND s.revision=? AND s.status='ACTIVE' AND s.chat_identity_id=?)`)
        .bind(marker, owner, AUDIT_ACTION, owner, now, principal.sessionId, now, series.id, owner, request.expectedRevision, series.chat_identity_id),
      this.db.prepare(`UPDATE reminders SET status='CANCELLED',cancelled_at=?,claimed_at=NULL,updated_at=?,transition_marker=?
        WHERE status IN ('PENDING','CLAIMED','RETRYABLE') AND id IN (${targets}) AND ${scoped}
        AND NOT EXISTS(SELECT 1 FROM reminder_deliveries d WHERE d.reminder_id=reminders.id AND d.status IN ${acquired}) AND ${won}`)
        .bind(now, now, marker, ...targetArgs, ...scopedArgs, ...wonArgs),
      this.db.prepare(`UPDATE reminder_deliveries SET status='CANCELLED',retry_not_before=NULL,updated_at=?
        WHERE status IN ('PENDING','RETRYABLE') AND reminder_id IN (SELECT r.id FROM reminders r WHERE r.status='CANCELLED' AND r.cancelled_at=? AND r.transition_marker=? AND r.id IN (${targets}) AND ${scopeFor("r.")}) AND ${won}`)
        .bind(now, now, marker, ...targetArgs, ...scopedArgs, ...wonArgs),
      this.db.prepare(`UPDATE follow_through_items SET mutation_marker=?
        WHERE progress='OPEN' AND owner_user_id=? AND chat_identity_id=? AND root_reminder_id IN (SELECT reminder_id FROM reminder_series_occurrences WHERE series_id=?) AND ${won}`)
        .bind(marker,owner,series.chat_identity_id,series.id,...wonArgs),
      this.db.prepare(`UPDATE follow_through_items SET progress='STOPPED',completed_at=NULL,revision=revision+1,follow_up_enabled=0,next_follow_up_at=NULL,updated_at=?
        WHERE progress='OPEN' AND owner_user_id=? AND chat_identity_id=? AND root_reminder_id IN (SELECT o.reminder_id FROM reminder_series_occurrences o WHERE o.series_id=?) AND ${won}`)
        .bind(now, owner, series.chat_identity_id, series.id, ...wonArgs),
      this.db.prepare(`UPDATE reminder_series SET status='CANCELLED',revision=revision+1,updated_at=?
        WHERE id=? AND owner_id=? AND revision=? AND status='ACTIVE' AND ${won}`)
        .bind(now, series.id, owner, request.expectedRevision, ...wonArgs),
    ]);
    if (results[0].meta.changes === 1 && results[5].meta.changes === 1) {
      // Readback only: acquired/uncertain sends that cancellation cannot recall.
      const preserved = Number(await this.db.prepare(`SELECT count(*) n FROM reminders WHERE id IN (${targets}) AND ${scoped} AND status NOT IN ('CANCELLED','SENT','FAILED')`)
        .bind(...targetArgs,...scopedArgs).first("n"));
      // D1 meta.changes includes trigger effects. Pre-marking the OPEN tasks
      // also identifies siblings stopped by the advance-group trigger once.
      const stopped = Number(await this.db.prepare(`SELECT count(*) n FROM follow_through_items WHERE owner_user_id=? AND chat_identity_id=? AND progress='STOPPED' AND mutation_marker=?`)
        .bind(owner,series.chat_identity_id,marker).first("n"));
      return { result: "CANCELLED", revision: request.expectedRevision + 1, cancelledReminders: results[1].meta.changes,
        cancelledDeliveries: results[2].meta.changes, stoppedTasks: stopped, preservedUnchanged: preserved };
    }
    const after = await this.locate(principal, request.publicId, now);
    if (!after) return { result: "NOT_FOUND" };
    return after.status === "CANCELLED" ? { result: "ALREADY_CANCELLED", revision: after.revision } : { result: "CONFLICT" };
  }
}

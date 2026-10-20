import {serializeSmallContextRequest} from "../../src/modules/conversation/context-contract/small-wire";
import {CONTEXT_SMALL_PROTOCOL_V3} from "../../src/modules/conversation/context-contract/small-protocol";
import {encodeSmallContextV3} from "../../src/modules/intelligence/infrastructure/openrouter/context-provider-small-wire";
import { serializeTypedContextRequest } from "../../src/modules/conversation/context-contract/typed-wire";
import { CONTEXT_TYPED_PROTOCOL_V3 } from "../../src/modules/conversation/context-contract/typed-protocol";
import { encodeGoogleLiteEuTypedContextV3 } from "../../src/modules/intelligence/infrastructure/openrouter/context-provider-typed-wire";
import { ContextInputSchema, ConversationInterpretationV3Schema } from "../../src/modules/conversation/context-contract/contracts";
import type {ContextGatewayInterpretation} from "../../src/modules/conversation/context-contract/list-period-transport";
/** Isolated synthetic D1 probe through the production successor service and
 * gateway. The only substituted boundaries are the provider exchange and the
 * outbound messaging receipt. No semantic outcome is reconstructed here. */
import { SqliteD1Database } from "../../src/testing/sqlite-d1.test-support";
import { createKeyring } from "../../src/modules/security/keyring";
import { D1ContextContractStore, createD1ContextContractStoreV3 } from "../../src/modules/conversation/context-contract/infrastructure/d1/store";
import { createD1ContextRuntimeStoreV3 } from "../../src/modules/conversation/context-contract/runtime-store";
import { createContextContractService } from "../../src/modules/conversation/context-contract/service";
import { createSmallContextContractGateway, createTypedContextContractGateway, createContextContractGateway, CONTEXT_FINANCIAL_RESERVATION_MICROUNITS, type ContextOfflineTransport, type ContextGatewayConfig } from "../../src/modules/intelligence/infrastructure/openrouter/semantic-gateway";
import { D1SemanticBudgetStore } from "../../src/modules/semantic/infrastructure/d1/budget-store";
import { D1SemanticReminderQueryStore } from "../../src/modules/reminders/infrastructure/d1/semantic-query-store";
import { D1ReminderApiStore } from "../../src/modules/reminders/infrastructure/d1/api-store";
import { listDetailedReminders } from "../../src/modules/reminders/details-api-service";
import { lunarCalendar } from "../../src/modules/conversation/lunar-calendar";
import { serializeContextRequest } from "../../src/modules/conversation/context-contract/wire";
import { decodeContextSnapshotV2, encodeContextSnapshotV2, type ContextSnapshotV2 } from "../../src/modules/conversation/context-contract/state";
import { isDeepStrictEqual } from "node:util";
import { persistedD1Blob } from "../../src/modules/db/persisted-blob";
import type { ContextInput } from "../../src/modules/conversation/context-contract/contracts";
import type { SemanticGateway } from "../../src/modules/intelligence/semantic-gateway";
import type { ReplyPlan, ReplyReceipt } from "../../src/modules/conversation/context-contract/responses";
import type { ContextObservationEvent } from "../../src/modules/conversation/context-contract/observability";
import type { ContextObservation, PlannedContextCase } from "./context-contract";
import { CONTEXT_PROTOCOL_V3 } from "../../src/modules/conversation/context-contract/protocol";
import { encodeFixtureV3 } from "./context-pointer-fixtures";
import type { CheckpointState } from "./context-seed";
import { contextContractEncryptionIdentity } from "../../src/modules/conversation/context-contract/store";

const gatewayConfig: ContextGatewayConfig = { protocol: CONTEXT_PROTOCOL_V3, maxInputChars: 1800, maxInputTokens: 12000, maxOutputTokens: 1536, maxResponseBytes: 32768, timeoutMs: 30000,
  primary: { model: "google/gemini-2.5-flash-lite", provider: "google-vertex/eu", requireZdr: true,
    promptPriceMicrounitsPerMillionTokens: 100000, completionPriceMicrounitsPerMillionTokens: 400000 } };
const budgetLimits = { ownerDailyFallbackLimit: 50, ownerMonthlyCostMicrounits: 500000, globalDailyCostMicrounits: 2000000,
  maxInputTokens: 12000, maxOutputTokens: 1536, promptPriceMicrounitsPerMillionTokens: 100000,
  completionPriceMicrounitsPerMillionTokens: 400000, reservationTtlMs: 300000 };
const scalar = (s: unknown) => s && typeof s === "object" ? structuredClone(s) : s;
export type FixtureProposal = (input: ContextInput, index: number) => unknown;
export interface ProbeConfig { wireProtocol?: "TYPED_105" | "SMALL_106"; sourceSha: string; referenceNow: number; budgetRefusal?: boolean;
  liveGateway?: SemanticGateway<ContextGatewayInterpretation, ContextInput>; syntheticFaultControl?: boolean; offlineSeedTurns?: number; contextSeed?: CheckpointState | null; }

export async function createContextContractProbe(config: ProbeConfig, fixture: FixtureProposal) {
  if (!/^[0-9a-f]{40}$/u.test(config.sourceSha) || !Number.isSafeInteger(config.referenceNow)) throw new TypeError("INVALID_PROBE_CONFIG");
  const sqlite = new SqliteD1Database({ contextContract: true });
  const db = sqlite as unknown as D1Database;
  try {
    const keyring = await createKeyring("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
    for (const sql of [
      "INSERT INTO users VALUES('owner','owner@example.test','Probe','Asia/Ho_Chi_Minh',1,1)",
      "INSERT INTO workspaces VALUES('workspace','owner','PERSONAL',1,1)",
      "INSERT INTO memberships VALUES('workspace','owner','OWNER',1)",
      "INSERT INTO bot_connections(id,user_id,provider,public_id,provider_bot_id,display_name,encrypted_token,encrypted_token_iv,token_fingerprint,credential_version,state,created_at,updated_at) VALUES('connection','owner','telegram','public','bot','Probe',x'01',zeroblob(12),'fingerprint',1,'ACTIVE_BOUND',1,1)",
      "INSERT INTO chat_identities(id,connection_id,provider_user_id,private_chat_id,linked_at) VALUES('identity','connection','provider-user','chat',1)",
    ]) await db.prepare(sql).run();
    const sessionExpiry = config.referenceNow + 24 * 3600000;
    await db.prepare("INSERT INTO sessions VALUES('probe-session','owner','digest',?,NULL,1)").bind(sessionExpiry).run();
    const principal = { sessionId: "probe-session", userId: "owner", expiresAt: sessionExpiry };
    let now = config.referenceNow, index = 0, selected: ReplyPlan | null = null, delivery: ReplyReceipt | null = null;
    let deliveryFault: "FAILED" | "UNCERTAIN" | undefined;
    let lastInbound: { id: string; text: string; receivedAt: number; claimMarker: string; rowid: number } | null = null;
    let delayed: { started: Promise<void>; signalStarted: () => void; waiting: Promise<void>; release: () => void } | null = null;
    const currentDelivery = (): ReplyReceipt | null => delivery;
    const events: ContextObservationEvent[] = [], inputs: ContextInput[] = [], sends: Array<{ plan: ReplyPlan; receipt: ReplyReceipt }> = [];
    let queryRange: { start: number; end: number } | null = null, listStoreReads = 0;
    let issuedToken: string | null = null;
    let lastSnapshot: ContextSnapshotV2 | null = null;
    const store = new D1ContextContractStore(db, keyring, () => now, CONTEXT_PROTOCOL_V3);
    const service = createContextContractService({ store: createD1ContextContractStoreV3({ db, keyring, clock: () => now, protocol: CONTEXT_PROTOCOL_V3 }), runtimeStore: createD1ContextRuntimeStoreV3({ db, keyring, protocol: CONTEXT_PROTOCOL_V3 }),
      gateway: { ...(config.wireProtocol === "SMALL_106" ? {contextWire:"SMALL_TABLES_106" as const} : config.wireProtocol === "TYPED_105" ? {contextWire: "TYPED_OBJECTS_105" as const} : {}), prepare(tier, input) {
        inputs.push(structuredClone(input));
        if (config.liveGateway && index > (config.offlineSeedTurns ?? 0)) {
          const prepared = config.liveGateway.prepare(tier, input), hold = delayed;
          if (!hold || prepared.status !== "READY") return prepared;
          delayed = null;
          return { ...prepared, dispatch: async () => { hold.signalStarted(); await hold.waiting; return prepared.dispatch(); } };
        }
        const proposed = fixture(input, index);
        const wire = config.wireProtocol === "SMALL_106" ? serializeSmallContextRequest(input) : config.wireProtocol === "TYPED_105" ? serializeTypedContextRequest(input) : serializeContextRequest(input);
        const request = { model: gatewayConfig.primary!.model, ...wire, provider: {
          only: [gatewayConfig.primary!.provider], allow_fallbacks: false, require_parameters: true, data_collection: "deny", zdr: true,
          max_price: { prompt: 0.1, completion: 0.4 },
        } };
        const response = proposed && typeof proposed === "object" && "fixtureFault" in proposed
          ? proposed.fixtureFault === "TIMEOUT" ? { status: 408, body: "" }
            : proposed.fixtureFault === "INVALID_JSON" ? { status: 200, body: "not-json" }
              : { status: 200, body: JSON.stringify({ choices: [{ message: { content: "{}" }, finish_reason: "stop" }] }) }
          : { status: 200, body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(config.wireProtocol === "SMALL_106" ? encodeSmallContextV3(ConversationInterpretationV3Schema.parse(proposed),ContextInputSchema.parse(input)) : config.wireProtocol === "TYPED_105" ? encodeGoogleLiteEuTypedContextV3(ConversationInterpretationV3Schema.parse(proposed), ContextInputSchema.parse(input)) : encodeFixtureV3(proposed,input)) }, finish_reason: "stop" }] }) };
        const transport: ContextOfflineTransport = { kind: "OFFLINE_FIXTURE", exchanges: [{ requestJson: JSON.stringify(request),
          admission: { fullInputTokens: 12000, billableOverheadMicrounits: 0 }, response }] };
        const offlinePrepared = (config.wireProtocol === "SMALL_106" ? createSmallContextContractGateway({...gatewayConfig,protocol:CONTEXT_SMALL_PROTOCOL_V3},transport) : config.wireProtocol === "TYPED_105" ? createTypedContextContractGateway({...gatewayConfig, protocol: CONTEXT_TYPED_PROTOCOL_V3}, transport) : createContextContractGateway(gatewayConfig, transport)).prepare(tier, input);
        // Same local reservation exposure as the later observable turn, while
        // the seed dispatch remains declarative OFFLINE_FIXTURE only.
        const prepared = config.liveGateway && offlinePrepared.status === "READY"
          ? { ...offlinePrepared, maximumCostMicrounits: CONTEXT_FINANCIAL_RESERVATION_MICROUNITS } : offlinePrepared;
        const hold = delayed;
        if (!hold || prepared.status !== "READY") return prepared;
        delayed = null;
        return { ...prepared, dispatch: async () => { hold.signalStarted(); await hold.waiting; return prepared.dispatch(); } };
      } }, budgetStore: new D1SemanticBudgetStore(db, { ...budgetLimits,
        ...(config.liveGateway ? { reservationInputTokenExposure: 1048576 } : {}),
        ...(config.budgetRefusal ? { ownerDailyFallbackLimit: 0 } : {}) }), keyring, calendar: lunarCalendar,
      channel: "TELEGRAM", sourceSha: config.sourceSha,
      get mode() { return config.liveGateway && index > (config.offlineSeedTurns ?? 0) ? "LIVE" as const : "OFFLINE_FIXTURE" as const; }, now: () => now,
      list: query => { listStoreReads++; queryRange = query.range; return new D1SemanticReminderQueryStore(db).listContext(query); }, observe: event => events.push(event),
      reply: async plan => { selected = plan; delivery = deliveryFault ? { status: deliveryFault } : { status: "SENT", messageRef: `synthetic-receipt-${index}` }; sends.push({ plan, receipt: delivery }); return delivery; } });
    const scope = (id: string, claimMarker: string) => ({ ownerId: "owner", chatIdentityId: "identity", sourceInboundId: id, claimMarker, now });
    if (config.contextSeed) {
      const seed = config.contextSeed;
      if (seed.snapshot && (seed.snapshot.scope.ownerId !== "owner" || seed.snapshot.scope.chatIdentityId !== "identity" || seed.snapshot.pendingDecision || seed.snapshot.previewReceipt || seed.snapshot.pendingSemanticCandidate)) throw Error("CONTEXT_SEED_SCOPE_OR_DEPENDENCY_INVALID");
      for (const row of seed.inbounds) {
        await db.prepare("INSERT INTO inbound_updates(rowid,id,connection_id,provider,provider_message_id,provider_user_id,private_chat_id,message_ciphertext,message_iv,message_key_version,state,received_at,transition_marker) VALUES(?,?,'connection','telegram',?,'provider-user','chat',x'01',zeroblob(12),1,?,?,?)")
          .bind(row.rowid, row.id, row.id, row.state, row.received_at, row.transition_marker).run();
      }
      for (const row of seed.contexts) {
        const active = row.status === "CLARIFYING";
        if (row.status === "DRAFT_READY" || active && seed.snapshot?.id !== row.id) throw Error("CONTEXT_SEED_DEPENDENCY_UNSUPPORTED");
        const encrypted = active ? await keyring.encryptSensitive("context-contract-state", contextContractEncryptionIdentity(seed.snapshot!.scope, String(row.id), CONTEXT_PROTOCOL_V3), 1, encodeContextSnapshotV2(seed.snapshot!)) : null;
        await db.prepare("INSERT INTO conversation_contract_write_permits(chat_identity_id,context_id,marker,operation) VALUES('identity',?,'seed-import','APPLY')").bind(row.id).run();
        await db.prepare("INSERT INTO conversation_contexts(id,owner_id,chat_identity_id,source_inbound_id,last_inbound_id,claim_marker,revision,status,created_at,updated_at,expires_at,payload_ciphertext,payload_iv,key_version,contract_version,write_marker) VALUES(?,'owner','identity',?,?,?,?,?,?,?,?,?,?,?,2,'seed-import')")
          .bind(row.id, row.source_inbound_id, row.last_inbound_id, row.claim_marker, row.revision, row.status, row.created_at, row.updated_at, row.expires_at, encrypted?.ciphertext ?? null, encrypted?.iv ?? null, active ? 1 : null).run();
        await db.prepare("DELETE FROM conversation_contract_write_permits WHERE marker='seed-import'").run();
      }
      for (const row of seed.outcomes) await db.prepare("INSERT INTO conversation_context_outcomes(rowid,context_id,revision,source_inbound_id,operation,created_at,operation_key,proof_hash,result_json,web_session_id) VALUES(?,?,?,?,?,?,?,?,?,?)")
        .bind(row.rowid, row.context_id, row.revision, row.source_inbound_id, row.operation, row.created_at, row.operation_key, row.proof_hash, row.result_json, row.web_session_id).run();
      for (const row of seed.ownership) {
        if (row.owner_id !== "owner" || row.chat_identity_id !== "identity" || row.contract_version !== 2) throw Error("CONTEXT_SEED_SCOPE_INVALID");
        await db.prepare("INSERT INTO conversation_contract_ownership VALUES(?,?,?,?)").bind(row.chat_identity_id, row.owner_id, row.context_id, row.contract_version).run();
      }
      const read = seed.inbounds.at(-1);
      if (!read || typeof read.id !== "string" || typeof read.transition_marker !== "string" || typeof read.received_at !== "number") throw Error("CONTEXT_SEED_READ_BINDING_INVALID");
      now = read.received_at + 1;
      const observed = await store.observeSuccessor(scope(read.id, read.transition_marker));
      if ("failure" in observed || !isDeepStrictEqual(observed.snapshot, seed.snapshot)) throw Error("CONTEXT_SEED_APPLICATION_READBACK_FAILED");
      lastSnapshot = observed.snapshot;
      index = seed.completedTurns;
    }
    return {
      inputs, events,
      async turn(text: string, receipt: string, fault?: "FAILED" | "UNCERTAIN", processingAt = receipt): Promise<ContextObservation["turns"][number]> {
        if (!text || !Number.isSafeInteger(Date.parse(receipt))) throw new TypeError("INVALID_PROBE_TURN");
        if (!Number.isSafeInteger(Date.parse(processingAt)) || Date.parse(processingAt) < Date.parse(receipt)) throw new TypeError("INVALID_PROCESSING_TIME");
        now = Date.parse(processingAt); const turnNumber = ++index; deliveryFault = fault; selected = null; delivery = null; queryRange = null;
        const beforeEvents = events.length, beforeListReads = listStoreReads, id = `probe-${turnNumber}`, claimMarker = `probe-claim-${turnNumber}`;
        const before = await db.prepare("SELECT count(*) n FROM reminders").first<number>("n") ?? 0;
        await db.prepare("INSERT INTO inbound_updates(id,connection_id,provider,provider_message_id,provider_user_id,private_chat_id,message_ciphertext,message_iv,message_key_version,state,received_at,transition_marker) VALUES(?,'connection','telegram',?,'provider-user','chat',x'01',zeroblob(12),1,'PROCESSING',?,?)")
          .bind(id, id, Date.parse(receipt), claimMarker).run();
        const rowid = await db.prepare("SELECT rowid FROM inbound_updates WHERE id=?").bind(id).first<number>("rowid");
        lastInbound = { id, text, receivedAt: Date.parse(receipt), claimMarker, rowid: rowid! };
        const result = await service.handle({ id, text, receivedAt: Date.parse(receipt), connectionId: "connection", providerUserId: "provider-user", privateChatId: "chat", claimMarker },
          { chatIdentityId: "identity", userId: "owner", workspaceId: "workspace", timezone: "Asia/Ho_Chi_Minh", inboundRowId: rowid! });
        const readId = `probe-read-${turnNumber}`;
        await db.prepare("INSERT INTO inbound_updates(id,connection_id,provider,provider_message_id,provider_user_id,private_chat_id,message_ciphertext,message_iv,message_key_version,state,received_at,transition_marker) VALUES(?,'connection','telegram',?,'provider-user','chat',x'01',zeroblob(12),1,'PROCESSING',?,?)")
          .bind(readId, readId, now + 1, "probe-read-claim").run();
        const traceId = events[beforeEvents]?.traceId;
        const actualEvents = events.slice(beforeEvents).filter(e => e.traceId === traceId), observed = await store.observeSuccessor({ ...scope(readId, "probe-read-claim"), now: now + 1 });
        const snapshot = "failure" in observed ? null : observed.snapshot;
        lastSnapshot = snapshot;
        issuedToken = snapshot?.pendingDecision?.tokenHandle ?? null;
        const fields = Object.fromEntries(Object.entries(snapshot?.slots ?? {}).map(([name, slot]) => [name, slot.state === "MISSING" ? null : scalar(slot.value)]));
        const after = await db.prepare("SELECT count(*) n FROM reminders").first<number>("n") ?? 0;
        const previews = await store.listWebPreviews(principal);
        const detailed = await listDetailedReminders(principal, { store: new D1ReminderApiStore(db), contextStore: store, keyring });
        const structural = actualEvents.find(e => e.event === "STRUCTURE_VALIDATED");
        const dispatches = actualEvents.filter(e => e.event === "REQUEST_DISPATCHED").length;
        const commits = actualEvents.filter(e => e.event === "MUTATION_COMMITTED").length;
        const selectedPlan = actualEvents.some(e => e.event === "REPLY_SELECTED") ? selected as ReplyPlan | null : null;
        const ready = selectedPlan?.status === "READY" ? selectedPlan : null;
        const cipherRow = snapshot ? await db.prepare("SELECT payload_ciphertext,payload_iv,key_version FROM conversation_contexts WHERE id=?").bind(snapshot.id)
          .first<{ payload_ciphertext: unknown; payload_iv: unknown; key_version: number }>() : null;
        const cipher = cipherRow ? Buffer.from(persistedD1Blob(cipherRow.payload_ciphertext)) : null;
        const detailFields = detailed.reminders[0]?.details ?? {};
        const preview = previews.previews[0];
        const previewFields = preview ? { title: preview.title, location: preview.details.location, notes: preview.details.notes,
          eventDate: preview.details.eventDate, eventTime: preview.details.eventTime, calendar: preview.details.calendarProvenance.calendar } : {};
        const canonicalReminders = detailed.reminders.map(r => ({ title: r.title,
          scheduled: new Date(r.scheduledAt + 7 * 3600000).toISOString().slice(0, 16).replace("T", " "),
          location: r.details?.location ?? null, notes: r.details?.notes ?? null, eventDate: r.details?.eventDate ?? null,
          eventTime: r.details?.eventTime ?? null, calendar: r.details?.calendarProvenance.calendar ?? null }));
        const occurrences = previews.previews[0]?.occurrences.map(occurrence => new Date(occurrence.scheduledAt + 7 * 3600000).toISOString().slice(0, 16).replace("T", " ")) ?? [];
        return { status: result.status, dispatches, actualDispatches: config.syntheticFaultControl ? 0 : dispatches, mutations: after - before, fields,
          source: ready?.source, kind: ready?.kind, selectedText: ready?.text,
          delivery: actualEvents.some(e => e.event === "REPLY_DISPATCHED") ? currentDelivery()?.status : undefined,
          decisionKind: snapshot?.pendingDecision?.kind ?? null, apiPreviews: previews.previews.length, detailFields, previewFields, canonicalReminders,
          coreValidity: structural?.event === "STRUCTURE_VALIDATED" ? structural.semanticPatchValidation
            : actualEvents.some(e => e.event === "RESPONSE_RECEIVED" && e.reason === "SCHEMA_INVALID") ? "INVALID" : "NOT_EVALUATED",
          directiveValidity: structural?.event === "STRUCTURE_VALIDATED" ? structural.directiveValidation : "NOT_EVALUATED",
          replyValidity: structural?.event === "STRUCTURE_VALIDATED" ? structural.replyEligibility : "NOT_EVALUATED",
          effectiveDirective: actualEvents.find(e => e.event === "EFFECTIVE_DIRECTIVE_COMPUTED")?.kind,
          directiveMatch: actualEvents.find(e => e.event === "DIRECTIVE_VALIDATED")?.result,
          replyEligibility: actualEvents.find(e => e.event === "REPLY_ELIGIBILITY_EVALUATED")?.result,
          occurrences, pendingField: snapshot?.pendingReminderQuestion?.field ?? snapshot?.pendingQueryQuestion?.field ?? null,
          contextRevision: snapshot?.contextRevision ?? null, draftRevision: snapshot?.draftRevision ?? null,
          idleExpiresAt: snapshot?.idleExpiresAt ?? null, absoluteExpiresAt: snapshot?.absoluteExpiresAt ?? null,
          draftExpiresAt: snapshot?.draftExpiresAt ?? null, queryRange, childCount: detailed.reminders.length,
          transactionCommits: commits, sendAttempts: actualEvents.filter(e => e.event === "REPLY_DISPATCHED").length,
          snapshotEncodedBytes: snapshot ? Buffer.byteLength(encodeContextSnapshotV2(snapshot)) : null,
          snapshotLogicalBytes: snapshot ? Buffer.byteLength(JSON.stringify(snapshot)) : null,
          fullSchemaValid: structural?.event === "STRUCTURE_VALIDATED" ? structural.fullSchemaValid : false,
          downstreamDiagnostics: actualEvents.filter(e => e.event === "POST_CANONICAL_STAGE").map(e => e.diagnostic),
          rawSchemaValid: structural?.event === "STRUCTURE_VALIDATED" ? structural.fullSchemaValid : false,
          assertions: { persistedSelectedText: !ready || snapshot?.transcript.at(-1)?.text === ready.text || ["CONFIRMED", "REJECTED", "CANCELLED"].includes(result.status),
            completeLogicalRoundTrip: !snapshot || isDeepStrictEqual(decodeContextSnapshotV2(encodeContextSnapshotV2(snapshot)), snapshot),
            encryptedStateBoundary: !snapshot || !!cipherRow && cipherRow.key_version === 1 && persistedD1Blob(cipherRow.payload_iv).byteLength === 12
              && cipher!.byteLength === Buffer.byteLength(encodeContextSnapshotV2(snapshot)) + 16 && (!ready || !cipher!.includes(Buffer.from(ready.text))),
            persistedDeliveryReceipt: !snapshot || !ready || (snapshot.transcript.at(-1)?.deliveryState === currentDelivery()?.status && snapshot.transcript.at(-1)?.messageRef === (currentDelivery()?.status === "SENT" ? (currentDelivery() as Extract<ReplyReceipt, { status: "SENT" }>).messageRef : null)),
          },
          listStoreReads: listStoreReads - beforeListReads,
          snapshotDigest: snapshot ? Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(encodeContextSnapshotV2(snapshot)))).toString("hex") : null,
          safetyFailures: after < before ? 1 : 0 };
      },
      issuedControlToken() { if (!issuedToken) throw new Error("NO_ISSUED_CONTROL_TOKEN"); return issuedToken; },
      snapshot() { return structuredClone(lastSnapshot); },
      /** Offline checkpoint preparation only. This captures application-owned
       * state, not an interpretation/provider envelope. Unsupported dependent
       * preview/reminder state fails closed rather than exporting a partial DB. */
      async checkpoint() {
        for (const table of ["command_drafts", "reminder_series_proposals", "reminders", "semantic_contexts"])
          if ((sqlite.sqlite.prepare(`SELECT count(*) n FROM ${table}`).get() as { n: number }).n !== 0)
            throw new Error("CONTEXT_SEED_DEPENDENCY_UNSUPPORTED");
        if (lastSnapshot?.pendingDecision || lastSnapshot?.previewReceipt || lastSnapshot?.pendingSemanticCandidate)
          throw new Error("CONTEXT_SEED_DEPENDENCY_UNSUPPORTED");
        const inbounds = sqlite.sqlite.prepare("SELECT rowid,id,received_at,transition_marker,state FROM inbound_updates ORDER BY rowid").all();
        const contexts = sqlite.sqlite.prepare("SELECT id,source_inbound_id,last_inbound_id,claim_marker,revision,status,created_at,updated_at,expires_at,contract_version FROM conversation_contexts ORDER BY rowid").all();
        const outcomes = sqlite.sqlite.prepare("SELECT rowid,context_id,revision,source_inbound_id,operation,created_at,operation_key,proof_hash,result_json,web_session_id FROM conversation_context_outcomes ORDER BY rowid").all();
        const ownership = sqlite.sqlite.prepare("SELECT * FROM conversation_contract_ownership ORDER BY rowid").all();
        return { snapshot: structuredClone(lastSnapshot), inbounds, contexts, outcomes, ownership, completedTurns: index };
      },
      async beginDeferredTurn(text: string, receipt: string) {
        if (delayed) throw new TypeError("ALREADY_DEFERRED");
        let signalStarted!: () => void, release!: () => void;
        const started = new Promise<void>(resolve => { signalStarted = resolve; });
        const waiting = new Promise<void>(resolve => { release = resolve; });
        delayed = { started, signalStarted, waiting, release };
        const pending = this.turn(text, receipt);
        await started;
        return { pending, release };
      },
      async releaseDeferredTurn(held: { pending: Promise<ContextObservation["turns"][number]>; release: () => void }, at?: string) {
        if (at) {
          if (!Number.isSafeInteger(Date.parse(at)) || Date.parse(at) < now) throw new TypeError("INVALID_RELEASE_TIME");
          now = Date.parse(at);
        }
        const beforeEvents = events.length, beforeSends = sends.length;
        const before = await db.prepare("SELECT count(*) n FROM reminders").first<number>("n") ?? 0;
        held.release();
        const completed = await held.pending;
        const after = await db.prepare("SELECT count(*) n FROM reminders").first<number>("n") ?? 0;
        const details = await listDetailedReminders(principal, { store: new D1ReminderApiStore(db), contextStore: store, keyring });
        return { status: completed.status, dispatches: events.slice(beforeEvents).filter(e => e.event === "REQUEST_DISPATCHED").length,
          mutations: after - before, sendAttempts: sends.length - beforeSends, childCount: details.reminders.length };
      },
      async replayLastInbound(processingAt: string) {
        if (!lastInbound || !Number.isSafeInteger(Date.parse(processingAt)) || Date.parse(processingAt) < lastInbound.receivedAt) throw new TypeError("INVALID_REPLAY");
        now = Date.parse(processingAt);
        const beforeEvents = events.length, beforeSends = sends.length;
        const before = await db.prepare("SELECT count(*) n FROM reminders").first<number>("n") ?? 0;
        const { id, text, receivedAt, claimMarker, rowid } = lastInbound;
        const result = await service.handle({ id, text, receivedAt, connectionId: "connection", providerUserId: "provider-user", privateChatId: "chat", claimMarker },
          { chatIdentityId: "identity", userId: "owner", workspaceId: "workspace", timezone: "Asia/Ho_Chi_Minh", inboundRowId: rowid });
        const after = await db.prepare("SELECT count(*) n FROM reminders").first<number>("n") ?? 0;
        const details = await listDetailedReminders(principal, { store: new D1ReminderApiStore(db), contextStore: store, keyring });
        return { status: result.status, dispatches: events.slice(beforeEvents).filter(e => e.event === "REQUEST_DISPATCHED").length,
          mutations: after - before, sendAttempts: sends.length - beforeSends, childCount: details.reminders.length };
      },
      async readBack() { return { previews: await store.listWebPreviews(principal), reminders: await listDetailedReminders(principal,
        { store: new D1ReminderApiStore(db), contextStore: store, keyring }) }; },
      dispose() { sqlite.close(); },
    };
  } catch (error) { sqlite.close(); throw error; }
}

/** Executes every declared USER turn through a fresh isolated service per
 * script. A declared R04 branch reset allocates a new service and synthetic D1.
 * The fixture callback supplies proposed wire data only; observed decisions
 * always come from service outputs and read-back. */
export interface LiveProbeCampaignHooks {
  gateway: SemanticGateway<ContextGatewayInterpretation, ContextInput>;
  beforeTurn?(script: PlannedContextCase, turnIndex: number): void;
  onAction?(script: PlannedContextCase, turnIndex: number, actionIndex: number, actual: NonNullable<ContextObservation["actions"]>[number], releasedTurnIndex?: number): Promise<void>;
  onTurn(script: PlannedContextCase, turnIndex: number, actual: ContextObservation["turns"][number]): Promise<void>;
}
export async function runContextFixtureCampaign(planned: readonly PlannedContextCase[], config: ProbeConfig,
  fixture: (input: ContextInput, executionId: string, turnIndex: number) => unknown, live?: LiveProbeCampaignHooks): Promise<ContextObservation[]> {
  const observations: ContextObservation[] = [];
  for (const script of planned) {
    let turnIndex = 0;
    // Declared injected-refusal controls remain Layer1. They cannot receive a
    // provider response, enter route admission or inflate actual HTTP counters.
    const syntheticControl = !!live && script.turns.every(t => t.model === "INJECTED_REFUSAL");
    const probeConfig = { ...config, ...(live && !syntheticControl ? { liveGateway: live.gateway } : {}), syntheticFaultControl: syntheticControl };
    let probe = await createContextContractProbe(probeConfig, input => {
      const declared = script.turns[turnIndex];
      if (declared.fault === "TIMEOUT" || declared.fault === "INVALID_JSON" || declared.fault === "SCHEMA_INVALID") return { fixtureFault: declared.fault };
      return fixture(input, script.executionId, turnIndex);
    });
    const turns: ContextObservation["turns"] = [], actions: NonNullable<ContextObservation["actions"]> = [];
    let held: Awaited<ReturnType<typeof probe.beginDeferredTurn>> | null = null, heldIndex = -1;
    try {
      for (const [index, turn] of script.turns.entries()) {
        if (turn.resetBefore) {
          probe.dispose();
          probe = await createContextContractProbe(probeConfig, input => {
            const declared = script.turns[turnIndex];
            if (declared.fault === "TIMEOUT" || declared.fault === "INVALID_JSON" || declared.fault === "SCHEMA_INVALID") return { fixtureFault: declared.fault };
            return fixture(input, script.executionId, turnIndex);
          });
        }
        turnIndex = index;
        live?.beforeTurn?.(script,index);
        const issuedToken = turn.text.includes("{{ISSUED_TOKEN}}") ? probe.issuedControlToken() : null;
        const text = issuedToken ? turn.text.replaceAll("{{ISSUED_TOKEN}}", issuedToken) : turn.text;
        if (turn.deferResponse) {
          if (held) throw new Error("ALREADY_DEFERRED");
          held = await probe.beginDeferredTurn(text, turn.receipt);
          heldIndex = index;
          turns.push(undefined as unknown as ContextObservation["turns"][number]);
        } else turns.push(await probe.turn(text, turn.receipt, turn.fault === "DELIVERY_FAILED" ? "FAILED" : turn.fault === "DELIVERY_UNCERTAIN" ? "UNCERTAIN" : undefined, turn.processingAt));
        if (issuedToken) {
          turns.at(-1)!.assertions!.issuedControlSubstituted = text.includes(issuedToken);
          turns.at(-1)!.assertions!.controlRedacted = !JSON.stringify(probe.inputs.at(-1)).includes(issuedToken)
            && !turns.at(-1)!.selectedText?.includes(issuedToken);
        }
        if (!turn.deferResponse) await live?.onTurn(script, index, turns[index]);
        for (const [actionIndex, action] of (turn.actionsAfter ?? []).entries()) {
          let releasedTurnIndex: number | undefined;
          if (action.kind === "REPLAY_LAST") actions.push(await probe.replayLastInbound(action.at));
          else {
            if (!held) throw new Error("NO_DEFERRED_TURN");
            const pending = held;
            releasedTurnIndex = heldIndex;
            actions.push(await probe.releaseDeferredTurn(pending, action.at));
            turns[heldIndex] = await pending.pending;
            await live?.onTurn(script, heldIndex, turns[heldIndex]);
            held = null;
          }
          await live?.onAction?.(script, index, actionIndex, actions.at(-1)!, releasedTurnIndex);
        }
      }
      if (held) throw new Error("UNRELEASED_DEFERRED_TURN");
      observations.push({ id: script.executionId, turns, actions });
    } finally { probe.dispose(); }
  }
  return observations;
}

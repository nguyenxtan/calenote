import {CONTEXT_SMALL_PROTOCOL_V3} from "./small-protocol";
import {CONTEXT_SMALL_PROMPT} from "./small-wire";
import {isUnreconciledListInterpretation, type ContextGatewayInterpretation} from "./list-period-transport";
import {reconcileListPeriodV3} from "./list-period-reconciliation";
import type { BoundChatContext, BoundChatMessage, ProcessBoundChatResult } from "@/modules/reminders/command-service";
import type { Keyring } from "@/modules/security/keyring";
import type { SemanticBudgetStore } from "@/modules/semantic/budget-store";
import type { SemanticGateway } from "@/modules/intelligence/semantic-gateway";
import type { LunarCalendarAdapter } from "../lunar-calendar";
import type { ContextContractStoreV3 } from "./store";
import type { ContextRuntimeStore } from "./runtime-store";
import type { ContextInput } from "./contracts";
import type { ContextReminderQuery, ContextQueryResult } from "./query";
import type { ReplyPlan, ReplyReceipt } from "./responses";
import type { ContextObservationEvent } from "./observability";
import { createContextTraceId } from "./observability";
import type { ConversationScope } from "../contracts";
import { buildContextInputV2 } from "./context";
import { selectControl } from "./decisions";
import { transitionConversationV3, type ConversationTransitionV3 } from "./transition";
import { composeContextReply, type FailureReason, type ReadyReplyPlan } from "./responses";
import { validateEvidenceV3, validateGuidancePrivacy } from "./evidence";
import { mergePatchV3 } from "./merge";
import { resolveRequest } from "./resolve";
import { resolveQuery } from "./query";
import { computeEffectiveDirectiveV3, validateDirectiveV3, selectGuidance } from "./guidance";
import { digest } from "./confirmation";
import { CONTEXT_CONTRACT_PROMPT } from "./prompt";
import { CONTEXT_TYPED_PROMPT } from "./typed-prompt";
import { CONTEXT_TYPED_PROTOCOL_V3 } from "./typed-protocol";
import { InterpretationJsonSchema } from "./contracts";
import type { ContextSnapshotV2 } from "./state";
import { projectSemanticView } from "./projection";
import { createControlProof } from "./control-proof";
import { isPreviewRecoveryResponse } from "./preview-control";
import { SLOT_NAMES } from "./contracts";
import { SlotsSchema, encodeContextSnapshotV2 } from "./state";
import type { DecisionProof } from "./store";
import { evidenceReason, type DownstreamDiagnostic } from "./downstream";
import { CONTEXT_PROTOCOL_V3, isContextProtocolV3 } from "./protocol";
import type { ContextObservation } from "./state";

export interface ContextContractServiceDependencies {
  store: ContextContractStoreV3; runtimeStore: ContextRuntimeStore;
  gateway: SemanticGateway<ContextGatewayInterpretation, ContextInput> & {readonly contextWire?: "TYPED_OBJECTS_105" | "SMALL_TABLES_106"}; budgetStore: SemanticBudgetStore;
  keyring: Pick<Keyring, "decryptSensitive">; calendar: LunarCalendarAdapter;
  channel: "ZALO" | "TELEGRAM"; sourceSha: string; mode: "LIVE" | "OFFLINE_FIXTURE";
  now(): number; reply(plan: ReplyPlan): Promise<ReplyReceipt>;
  list(input: ContextReminderQuery): Promise<ContextQueryResult>;
  processingFeedback?: () => void | Promise<void>;
  observe?: (event: ContextObservationEvent) => void;
}
const normalizedControl = (text: string) => text.normalize("NFC").trim().toLocaleLowerCase("vi").replace(/[.!]$/u, "");
const localWords = new Set(["có", "ok", "1", "xác nhận", "không", "2", "bỏ", "hủy", "huỷ"]);
const helpWords = new Set(["help", "/help", "trợ giúp", "hướng dẫn"]);
const greeting = /^(?:chào(?: bạn| calenote)?|xin chào(?: bạn| calenote)?|hello|hi)[!.\s]*$/u;
export function createContextContractService(deps: ContextContractServiceDependencies) {
  if (!isContextProtocolV3(deps.store.protocol)) throw new TypeError("Selected context protocol required");
  if (!/^[0-9a-f]{40}$/u.test(deps.sourceSha)) throw new TypeError("Source SHA required");
  const scopeFor = (message: BoundChatMessage, context: BoundChatContext): ConversationScope => ({ ownerId: context.userId,
    chatIdentityId: context.chatIdentityId, sourceInboundId: message.id, claimMarker: message.claimMarker, now: deps.now() });
  return {
    async ownsContext(message: BoundChatMessage, context: BoundChatContext): Promise<boolean> { return deps.runtimeStore.ownsContext(scopeFor(message, context)); },
    async ownsPendingDraft(message: BoundChatMessage, context: BoundChatContext, draftId: string): Promise<boolean> {
      const observed = await deps.store.observe(scopeFor(message, context));
      return !("failure" in observed) && observed.snapshot?.requestId === draftId;
    },
    async handle(message: BoundChatMessage, context: BoundChatContext): Promise<ProcessBoundChatResult> {
      const scope = scopeFor(message, context), authority = { kind: "CHAT", scope } as const;
      const traceId = createContextTraceId();
      type EventFields = ContextObservationEvent extends infer E ? E extends ContextObservationEvent ? Omit<E, "traceId" | "sourceSha" | "contractVersion" | "promptVersion" | "mode"> : never : never;
      const emit = (event: EventFields) => { try { deps.observe?.({ traceId, sourceSha: deps.sourceSha, mode: deps.mode,
        contractVersion: "calenote-context-3", promptVersion: deps.gateway.contextWire === "SMALL_TABLES_106" ? CONTEXT_SMALL_PROTOCOL_V3.promptVersion : deps.gateway.contextWire === "TYPED_OBJECTS_105" ? CONTEXT_TYPED_PROTOCOL_V3.promptVersion : "calenote-context-3", ...event } as ContextObservationEvent); } catch { /* telemetry is non-authoritative */ } };
      let sendObservation: ContextObservation | undefined;
      let failureSnapshot: ContextSnapshotV2 | null = null, failureReceived: ContextSnapshotV2 | undefined;
      let downstreamCount = 0;
      const downstream = (diagnostic: DownstreamDiagnostic) => { if (downstreamCount++ < 24) emit({ event: "POST_CANONICAL_STAGE", diagnostic }); };
      const send = async (plan: ReadyReplyPlan, expected?: { contextId: string; contextRevision: number }): Promise<ReplyReceipt | null> => {
        if (!await deps.runtimeStore.canSend({ ...scope, now: deps.now() }, expected, sendObservation)) { emit({ event: "TRANSITION_REJECTED", reason: "STALE" }); return null; }
        emit({ event: "REPLY_SELECTED", source: plan.source }); emit({ event: "REPLY_DISPATCHED" });
        let receipt: ReplyReceipt;
        try { receipt = await deps.reply(plan); } catch { receipt = { status: "UNCERTAIN" }; }
        if (receipt.status === "SENT") emit({ event: "REPLY_SENT" });
        else emit({ event: receipt.status === "FAILED" ? "REPLY_FAILED" : "REPLY_UNCERTAIN", reason: receipt.status === "FAILED" ? "DELIVERY_FAILED" : "UNCERTAIN" });
        return receipt;
      };
      const finish = async (reason: FailureReason): Promise<ProcessBoundChatResult> => {
        if (downstreamCount > 0) downstream({ stage: "TRANSITION", result: "REJECTED", reason: evidenceReason(reason, "TRANSITION_REJECTED"), transition: "REPLY_ONLY" });
        // Only prior selected state needs durable revocation/preservation.
        // A fresh builder candidate is not accepted semantic context. A prior
        // no-A grounded candidate still is, even when requestId is null.
        if (sendObservation && failureSnapshot && failureReceived) {
          const transition = await transitionConversationV3({ snapshot: failureSnapshot, received: failureReceived, failure: reason, control: { kind: "NONE" }, authority, now: deps.now(), channel: deps.channel });
          if (!("kind" in transition)) {
            const { reply, ...stored } = transition;
            const applied = await deps.store.apply(scope, sendObservation, stored);
            if (applied.status !== "APPLIED") return { status: "SUPERSEDED" };
            if (downstreamCount > 0) downstream({ stage: "REPLY", result: "PASS", reason: "NONE", replySource: reply.source });
            const receipt = await send(reply, applied);
            if (receipt) await deps.store.recordDelivery({ ...scope, now: deps.now() }, { ...applied, draftRevision: stored.snapshot.draftRevision,
              outboundId: stored.snapshot.transcript.at(-1)!.id, decisionId: null, deliveryState: receipt.status, messageRef: receipt.status === "SENT" ? receipt.messageRef : null });
            return { status: "REJECTED" };
          }
        }
        if (!await deps.runtimeStore.complete({ ...scope, now: deps.now() })) return { status: "SUPERSEDED" };
        const reply = composeContextReply({ kind: "FAILURE", reason });
        if (reply.status === "READY") { if (downstreamCount > 0) downstream({ stage: "REPLY", result: "PASS", reason: "NONE", replySource: reply.source }); await send(reply); }
        return { status: "REJECTED" };
      };
      const confirm = async (proof: DecisionProof): Promise<ProcessBoundChatResult> => {
        let result = await deps.store.confirm(authority, proof);
        if (result.status === "UNCERTAIN") result = await deps.store.readOutcome(authority, proof.operationKey) ?? result;
        const success = result.status === "COMMITTED" || result.status === "IDEMPOTENT";
        emit({ event: "CONFIRMATION_VALIDATED", result: success ? "VALID" : "INVALID" });
        if (success) emit({ event: result.status === "COMMITTED" ? "MUTATION_COMMITTED" : "MUTATION_IDEMPOTENT_SKIP" });
        else if (!await deps.runtimeStore.complete({ ...scope, now: deps.now() })) return { status: "SUPERSEDED" };
        const reply = composeContextReply({ kind: "MUTATION", result }); if (reply.status === "READY") await send(reply);
        return { status: success ? "CONFIRMED" : "REJECTED" };
      };
      try {
        const observed = await deps.store.observe(scope);
        if ("failure" in observed) {
          emit({ event: "MODEL_BYPASSED", reason: observed.failure === "UNAUTHORIZED" ? "AUTH_INVALID" : "CONTEXT_INVALID" });
          return observed.failure === "UNAUTHORIZED" ? { status: "SUPERSEDED" } : finish(observed.failure === "EXPIRED" ? "EXPIRED" : "CONTEXT");
        }
        emit({ event: "INBOUND_ACCEPTED" }); emit({ event: "CONTEXT_LOADED", presence: observed.snapshot ? "PRESENT" : "ABSENT" });
        sendObservation = observed.observation;
        const prior = observed.snapshot;
        if (observed.observation.scope.workspaceId !== context.workspaceId || observed.observation.scope.connectionId !== message.connectionId
          || observed.observation.scope.chatId !== message.privateChatId || observed.observation.inbound.rowid !== context.inboundRowId
          || Date.parse(observed.observation.inbound.receivedAt) !== message.receivedAt || context.timezone !== "Asia/Ho_Chi_Minh") return finish("CONTEXT");
        const control = selectControl(message.text, prior?.pendingDecision ?? null, authority, { snapshot: prior ?? undefined, now: scope.now });
        const normalized = normalizedControl(message.text);
        // UI vocabulary without a decision is not authority over an active
        // clarification: e.g. "2" may be an occurrence count or offset.
        const staleControl = localWords.has(normalized) && !prior?.pendingReminderQuestion && !prior?.pendingQueryQuestion;
        const local = control.kind !== "NONE" || staleControl || greeting.test(normalized) || helpWords.has(normalized);
        const recovery = control.kind === "NONE" && isPreviewRecoveryResponse(prior, message.text);
        if (prior && control.kind === "APPROVE" && control.decisionKind === "SAVE_PREVIEW") {
          emit({ event: "MODEL_BYPASSED", reason: "LOCAL_CONTROL" });
          const proof = await createControlProof(prior, observed.observation.inbound, message.text, control, authority, scope.now);
          return proof ? confirm(proof) : finish("STALE");
        }
        const built = buildContextInputV2({ message, context, snapshot: prior, observation: observed.observation });
        if (built.status === "READY") { failureSnapshot = prior; failureReceived = built.candidateSnapshot; }
        else if (prior) {
          // Refused content never enters the accepted semantic transcript.
          // Retain validated facts/candidate/lifetimes, bind only the actual
          // inbound receipt, and let the selected failure transition revoke
          // old actionable proof before completing this inbound.
          failureSnapshot = prior;
          failureReceived = { ...structuredClone(prior), inbound: observed.observation.inbound, modelAttemptBinding: null, webDeclineReceipt: null };
        }
        let transition: ConversationTransitionV3;
        if (built.status !== "READY") {
          const capacity = built.reason === "CONTEXT_TURN_COUNT_EXCEEDED" || built.reason === "CONTEXT_SNAPSHOT_TOO_LARGE";
          const restart = control.kind === "APPROVE" && control.decisionKind === "RESTART_PENDING";
          if (capacity && prior && (control.kind === "ABANDON" || restart)) {
            const proof = restart ? await createControlProof(prior, observed.observation.inbound, message.text, control, authority, scope.now) : null;
            if (restart && !proof) return finish("STALE");
            emit({ event: "MODEL_BYPASSED", reason: "LOCAL_CONTROL" });
            transition = await terminalOverflow(prior, observed.observation.inbound, restart, proof);
          } else if (capacity && prior && (control.kind === "DECLINE" || control.kind === "AMBIGUOUS_TARGET" || recovery)) {
            emit({ event: "MODEL_BYPASSED", reason: "LOCAL_CONTROL" });
            transition = await transitionConversationV3({ snapshot: prior, received: { ...structuredClone(prior), inbound: observed.observation.inbound, modelAttemptBinding: null, webDeclineReceipt: null },
              ...(recovery ? { previewRecoveryText: message.text } : { localControlText: message.text }), control, authority, now: scope.now, channel: deps.channel });
          } else { emit({ event: "REQUEST_REJECTED", reason: "INVALID_INPUT" }); return finish(built.reason.includes("EXPIRED") ? "EXPIRED" : built.reason.includes("LARGE") || built.reason.includes("LONG") || built.reason.includes("COUNT") ? "SIZE" : "CONTEXT"); }
        } else if (local) {
          emit({ event: "MODEL_BYPASSED", reason: control.kind !== "NONE" || staleControl ? "LOCAL_CONTROL" : helpWords.has(normalized) ? "HELP" : "GREETING" });
          if (control.kind !== "NONE" || recovery) transition = await transitionConversationV3({ snapshot: prior, received: built.candidateSnapshot,
            ...(recovery ? { previewRecoveryText: message.text } : {}), control, authority, now: scope.now, channel: deps.channel });
          else {
            const reply = composeContextReply(staleControl ? { kind: "FAILURE", reason: "STALE" } : { kind: "NOTICE", notice: "HELP" });
            if (reply.status !== "READY") return finish("CONTEXT");
            transition = await localTransition(prior, built.candidateSnapshot, reply);
          }
        } else {
          emit({ event: "MODEL_REQUIRED" });
          try { void Promise.resolve(deps.processingFeedback?.()).catch(() => {}); } catch { /* best effort */ }
          const attempt = deps.gateway.prepare("PRIMARY", built.input);
          if (attempt.status !== "READY") { emit({ event: "REQUEST_REJECTED", reason: attempt.category }); return finish("CONFIG"); }
          emit({ event: "REQUEST_PREPARED", configuredModel: "google/gemini-2.5-flash-lite", configuredProvider: "google-vertex/eu", routeAdmission: deps.mode === "OFFLINE_FIXTURE" ? "OFFLINE_FIXTURE" : attempt.routeAdmission ?? "UNVERIFIED" });
          const inputDigest = await digest(built.input), promptDigest = await digest(deps.gateway.contextWire === "SMALL_TABLES_106" ? CONTEXT_SMALL_PROMPT : deps.gateway.contextWire === "TYPED_OBJECTS_105" ? CONTEXT_TYPED_PROMPT : CONTEXT_CONTRACT_PROMPT), contractDigest = await digest(InterpretationJsonSchema);
          const bindingDigest = await digest({ observation: observed.observation, inputDigest, promptDigest, contractDigest, protocol: deps.gateway.contextWire === "SMALL_TABLES_106" ? CONTEXT_SMALL_PROTOCOL_V3 : deps.gateway.contextWire === "TYPED_OBJECTS_105" ? CONTEXT_TYPED_PROTOCOL_V3 : CONTEXT_PROTOCOL_V3 });
          if (!await deps.runtimeStore.claimAttempt(scope, observed.observation, bindingDigest)) { emit({ event: "REQUEST_REJECTED", reason: "DUPLICATE" }); return { status: "SUPERSEDED" }; }
          const reservation = await deps.budgetStore.reservePaidCall({ ownerId: scope.ownerId, sourceInboundId: message.id, now: deps.now() });
          if (reservation.status !== "RESERVED") { emit({ event: "REQUEST_REJECTED", reason: "BUDGET_EXHAUSTED" }); return finish("BUDGET"); }
          const budget = { ownerId: scope.ownerId, reservationId: reservation.reservationId };
          if (!Number.isSafeInteger(attempt.maximumCostMicrounits) || reservation.reservedMaximumMicrounits !== attempt.maximumCostMicrounits) {
            await deps.budgetStore.releaseOrExpireReservation({ ...budget, now: deps.now(), reason: "SAFE_FAILURE" }); return finish("BUDGET");
          }
          emit({ event: "BUDGET_RESERVED", maximumCostMicrounits: reservation.reservedMaximumMicrounits });
          if (!await deps.budgetStore.markDispatched({ ...budget, now: deps.now() })) return finish("BUDGET");
          const started = performance.now(); emit({ event: "REQUEST_DISPATCHED" });
          const result = await attempt.dispatch().catch(() => ({ status: "FAILURE", category: "PROVIDER_FAILURE" } as const));
          const usage = "usage" in result ? result.usage : undefined;
          try { await deps.budgetStore.finalizeUsage({ ...budget, actualCostMicrounits: usage?.costMicrounits ?? null, now: deps.now() }); } catch { /* Dispatched reservation retains ceiling. */ }
          const providerEvidence = "providerEvidence" in result ? result.providerEvidence : undefined;
          emit({ event: "RESPONSE_RECEIVED", outcome: result.status, latencyMs: Math.round(performance.now() - started), observedModel: providerEvidence?.model ?? "UNKNOWN", observedProvider: providerEvidence?.provider ?? "UNKNOWN",
            promptTokens: usage?.promptTokens ?? null, completionTokens: usage?.completionTokens ?? null, costMicrounits: usage?.costMicrounits ?? null, ...(result.status === "FAILURE" ? { reason: result.category } : {}) });
          if (result.status !== "SUCCESS") { if (result.category === "SCHEMA_INVALID") downstream({ stage: "CANONICAL", result: "REJECTED", reason: "SCHEMA_INVALID" }); return finish("PROVIDER"); }
          const reconciled=isUnreconciledListInterpretation(result.interpretation)?reconcileListPeriodV3(result.interpretation,built,downstream):{status:"PARSED" as const,value:result.interpretation};
          if(reconciled.status!=="PARSED") {downstream({stage:"CANONICAL",result:"REJECTED",reason:"SCHEMA_INVALID"});return finish("SEMANTIC");}
          const parsed = reconciled.value;
          downstream({ stage: "CANONICAL", result: parsed.fullSchemaValid ? "PASS" : "QUARANTINED_GUIDANCE", reason: parsed.fullSchemaValid ? "NONE" : "SCHEMA_INVALID" });
          emit({ event: "STRUCTURE_VALIDATED", fullSchemaValid: parsed.fullSchemaValid, semanticPatchValidation: "VALID", directiveValidation: parsed.directive.status, replyEligibility: parsed.reply.status });
          const evidence = validateEvidenceV3(parsed.semantic, built, downstream);
          emit({ event: "PROVENANCE_DOMAIN_VALIDATED", result: evidence.status === "VALID" ? "VALID" : "INVALID", ...(evidence.status !== "VALID" ? { reason: "EVIDENCE_INVALID" as const } : {}) });
          if (evidence.status !== "VALID") return finish("SEMANTIC");
          const merge = mergePatchV3(prior, evidence.patch);
          downstream({ stage: "MERGE", result: merge.status === "REJECTED" ? "REJECTED" : merge.status === "CLARIFY_OPERATION" ? "CLARIFY" : "PASS", reason: merge.status === "REJECTED" ? evidenceReason(merge.reason, "PATCH_REJECTED") : "NONE" });
          const resolution = merge.status === "MERGED" ? resolveRequest(merge.candidate, deps.now(), deps.calendar) : undefined;
          const queryResolution = merge.status === "MERGED" && merge.query ? resolveQuery(merge.query, Date.parse(merge.queryReferenceTime ?? new Date(message.receivedAt).toISOString()), deps.calendar) : undefined;
          downstream({ stage: "QUERY_RESOLUTION", result: !queryResolution ? "NOT_APPLICABLE" : queryResolution.status === "REJECTED" ? "REJECTED" : queryResolution.status === "CLARIFY" ? "CLARIFY" : "PASS",
            reason: queryResolution && "reason" in queryResolution ? evidenceReason(queryResolution.reason, "RESOLUTION_REJECTED") : "NONE" });
          const ambiguousQueryRange = merge.status === "MERGED" && merge.uncertainties.some(u => u.field === "queryRange" && u.reason === "AMBIGUOUS");
          downstream({ stage: "QUERY_RANGE", result: merge.status === "MERGED" && merge.query?.kind === "LIST" ? ambiguousQueryRange ? "AMBIGUOUS" : merge.query.period ? "PASS" : "UNSPECIFIED" : "NOT_APPLICABLE", reason: ambiguousQueryRange ? "QUERY_RANGE_AMBIGUOUS" : queryResolution?.status === "CLARIFY" && queryResolution.reason === "MISSING_RANGE" ? "MISSING_RANGE" : "NONE" });
          let queryResult: ContextQueryResult | undefined;
          const queryTitles = new Map<string, string>();
          if (queryResolution?.status === "RANGE") {
            queryResult = await deps.list({ message, context, referenceTime: message.receivedAt, range: { start: queryResolution.start, end: queryResolution.end } });
            if (queryResult.status === "RESULTS") {
              try { for (const row of queryResult.rows) queryTitles.set(row.id, await deps.keyring.decryptSensitive("reminder-title", row.id, row.titleKeyVersion, row.encryptedTitle)); }
              catch { queryResult = { status: "UNAVAILABLE", reason: "DETAIL_UNAVAILABLE" }; }
            }
            emit({ event: "QUERY_EXECUTED", result: queryResult.status !== "RESULTS" ? "FAILURE" : queryResult.hasMore ? "PARTIAL" : "SUCCESS", hasMore: queryResult.status === "RESULTS" ? queryResult.hasMore : null });
          }
          if (merge.status === "MERGED" && !merge.query && resolution) emit({ event: "SCHEDULE_RESOLVED", result: resolution.status });
          const effective = computeEffectiveDirectiveV3({ semantic: evidence.patch, merge, resolution, queryResolution, queryResult });
          const directiveValidation = validateDirectiveV3(parsed.directive, effective);
          downstream({ stage: "DIRECTIVE", result: effective.kind === "BACKEND_ONLY" && effective.reason === "FAILURE" ? "REJECTED" : effective.kind === "ASK_FOR_FIELD" || effective.kind === "ASK_FOR_DISAMBIGUATION" ? "CLARIFY" : "PASS", reason: directiveValidation.status === "VALID" ? "NONE" : directiveValidation.reason, directive: effective.kind,
            ...("field" in effective ? { field: effective.field } : {}) });
          const guidance = selectGuidance({ effectiveDirective: effective, directiveValidation, replyProposal: parsed.reply,
            privacyValidation: validateGuidancePrivacy({ conversationDirective: parsed.directive.status === "VALID" ? parsed.directive.value : null,
              replyProposal: parsed.reply.status === "VALID" ? parsed.reply.value : null }, built), language: "vi" });
          emit({ event: "EFFECTIVE_DIRECTIVE_COMPUTED", kind: effective.kind });
          emit({ event: "DIRECTIVE_VALIDATED", result: directiveValidation.status === "VALID" ? "MATCH" : directiveValidation.reason });
          emit({ event: "REPLY_ELIGIBILITY_EVALUATED", result: guidance.source === "MODEL_GUIDANCE" ? "ELIGIBLE" : guidance.reason });
          transition = await transitionConversationV3({ snapshot: prior, interpretation: evidence.patch, merge, resolution, queryResolution, queryResult, queryTitles, guidance, control, authority, now: deps.now(), channel: deps.channel });
          const transitionRejected = "kind" in transition && !transition.confirmationProof || effective.kind === "BACKEND_ONLY" && effective.reason === "FAILURE";
          downstream({ stage: "TRANSITION", result: transitionRejected ? "REJECTED" : transition.reply.kind === "CLARIFICATION" ? "CLARIFY" : "PASS", reason: "kind" in transition && transition.reason ? evidenceReason(transition.reason, "TRANSITION_REJECTED") : transitionRejected ? "TRANSITION_REJECTED" : "NONE", transition: "kind" in transition ? transition.confirmationProof ? "CONFIRMATION" : "REPLY_ONLY" : "STORED" });
          downstream({ stage: "REPLY", result: "PASS", reason: "NONE", replySource: transition.reply.source, replyKind: transition.reply.kind });
          if (!("kind" in transition)) transition.snapshot.modelAttemptBinding = { attemptId: traceId, observationId: bindingDigest, contextRevision: prior?.contextRevision ?? null,
            sourceInboundId: message.id, claimMarker: message.claimMarker, inputDigest, promptDigest, contractDigest, contractVersion: "calenote-context-3", status: "ACCEPTED" };
          if (!("kind" in transition) && new TextEncoder().encode(encodeContextSnapshotV2(transition.snapshot)).length > 16384) return finish("SIZE");
        }
        if ("kind" in transition) {
          if (!transition.confirmationProof) return finish("STALE");
          return confirm(transition.confirmationProof);
        }
        const { reply, ...stored } = transition;
        const applied = await deps.store.apply(scope, observed.observation, stored);
        if (applied.status !== "APPLIED") { emit({ event: "TRANSITION_REJECTED", reason: applied.status === "IDEMPOTENT" ? "DUPLICATE" : applied.status }); return { status: "SUPERSEDED" }; }
        emit({ event: "TRANSITION_ACCEPTED", contextRevisionBefore: prior?.contextRevision ?? null, contextRevisionAfter: applied.contextRevision });
        const receipt = await send(reply, applied);
        if (receipt) await deps.store.recordDelivery({ ...scope, now: deps.now() }, { contextId: applied.contextId, contextRevision: applied.contextRevision,
          draftRevision: stored.snapshot.draftRevision, outboundId: stored.snapshot.transcript.at(-1)!.id, decisionId: stored.snapshot.pendingDecision?.decisionId ?? null,
          deliveryState: receipt.status, messageRef: receipt.status === "SENT" ? receipt.messageRef : null });
        return { status: stored.terminal === "CANCELLED" ? "CANCELLED" : stored.preview ? "DRAFT_CREATED" : reply.kind === "QUERY_RESULT" ? "REMINDERS_LISTED" : "CLARIFICATION_REQUESTED" };
      } catch { emit({ event: "REQUEST_REJECTED", reason: "UNCERTAIN" }); return finish("CONTEXT"); }
    },
  };
}

/** Terminal discard may erase its unconfirmed payload; active evidence is never
 * evicted to make a semantic request fit. The unchanged T4 CAS owns finality. */
async function terminalOverflow(prior: ContextSnapshotV2, inbound: ContextSnapshotV2["inbound"], restart: boolean, proof: DecisionProof | null): Promise<ConversationTransitionV3> {
  const received: ContextSnapshotV2 = { ...structuredClone(prior), inbound, requestId: null, draftRevision: null, draftCreatedAt: null, draftExpiresAt: null,
    slots: SlotsSchema.parse(Object.fromEntries(SLOT_NAMES.map(field => [field, { state: "MISSING", value: null, fact: null, evidence: [], provenance: null, resolution: null, proposalRevision: 1 }]))),
    pendingSemanticCandidate: null, facts: [], ambiguities: [], transcript: [], controlRegistry: [], pendingDecision: null, previewReceipt: null, pendingQueryQuestion: null, pendingReminderQuestion: null, modelAttemptBinding: null };
  const reply = composeContextReply({ kind: "NOTICE", notice: restart ? "RESTARTED" : "ABANDONED" });
  if (reply.status !== "READY") throw new Error("Invalid terminal reply");
  const result = await localTransition(prior, received, reply);
  if ("kind" in result) return result;
  result.snapshot.lifecycle = "CANCELLED"; result.terminal = "CANCELLED";
  if (proof) result.decisionProof = proof;
  return result;
}

async function localTransition(prior: ContextSnapshotV2 | null, received: ContextSnapshotV2, reply: ReadyReplyPlan): Promise<ConversationTransitionV3> {
  const snapshot = structuredClone(received);
  snapshot.contextRevision = (prior?.contextRevision ?? 0) + 1;
  snapshot.webDeclineReceipt = null;
  snapshot.pendingDecision = null; snapshot.previewReceipt = null;
  snapshot.pendingReminderQuestion = null; snapshot.pendingQueryQuestion = null;
  snapshot.lifecycle = snapshot.requestId ? "CLARIFYING" : "NONE";
  const projected = projectSemanticView(reply.text, snapshot.controlRegistry.map(c => c.handle));
  if (projected.status !== "READY") return { kind: "REPLY_ONLY", reply };
  snapshot.transcript.push({ id: `out-${await digest([snapshot.inbound.id, snapshot.contextRevision])}`, role: "ASSISTANT", kind: reply.kind,
    text: reply.text, semanticView: projected.text, sourceMap: projected.sourceMap, controlSpans: projected.controlSpans,
    deliveryState: "UNCERTAIN", messageRef: null, receivedAt: snapshot.inbound.receivedAt });
  return { expectedContextRevision: prior?.contextRevision ?? null, expectedDraftRevision: prior?.draftRevision ?? null, snapshot, preview: null, terminal: null, inboundOutcome: "PROCESSED", reply };
}

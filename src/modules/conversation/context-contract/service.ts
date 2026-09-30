import type { BoundChatContext, BoundChatMessage, ProcessBoundChatResult } from "@/modules/reminders/command-service";
import type { Keyring } from "@/modules/security/keyring";
import type { SemanticBudgetStore } from "@/modules/semantic/budget-store";
import type { SemanticGateway } from "@/modules/intelligence/semantic-gateway";
import type { LunarCalendarAdapter } from "../lunar-calendar";
import type { ContextContractStore } from "./store";
import type { ContextRuntimeStore } from "./runtime-store";
import type { ContextInput, ParsedInterpretation } from "./contracts";
import type { ContextReminderQuery, ContextQueryResult } from "./query";
import type { ReplyPlan, ReplyReceipt } from "./responses";
import type { ContextObservationEvent } from "./observability";
import { createContextTraceId } from "./observability";
import type { ConversationScope } from "../contracts";
import { buildContextInput } from "./context";
import { selectControl } from "./decisions";
import { transitionConversation, type ConversationTransition } from "./transition";
import { composeContextReply, type FailureReason, type ReadyReplyPlan } from "./responses";
import { validateEvidence, validateGuidancePrivacy } from "./evidence";
import { mergePatch } from "./merge";
import { resolveRequest } from "./resolve";
import { resolveQuery } from "./query";
import { computeEffectiveDirective, validateDirective, selectGuidance } from "./guidance";
import { digest } from "./confirmation";
import { CONTEXT_CONTRACT_PROMPT } from "./prompt";
import { InterpretationJsonSchema } from "./contracts";
import type { ContextSnapshotV1 } from "./state";
import { projectSemanticView } from "./projection";
import { createControlProof } from "./control-proof";
import { isPreviewRecoveryResponse } from "./preview-control";
import { SLOT_NAMES } from "./contracts";
import { SlotsSchema, encodeContextSnapshot } from "./state";
import type { DecisionProof } from "./store";

export interface ContextContractServiceDependencies {
  store: ContextContractStore; runtimeStore: ContextRuntimeStore;
  gateway: SemanticGateway<ParsedInterpretation, ContextInput>; budgetStore: SemanticBudgetStore;
  keyring: Pick<Keyring, "decryptSensitive">; calendar: LunarCalendarAdapter;
  channel: "ZALO" | "TELEGRAM"; sourceSha: string; mode: "LIVE" | "OFFLINE_FIXTURE";
  now(): number; reply(plan: ReplyPlan): Promise<ReplyReceipt>;
  list(input: ContextReminderQuery): Promise<ContextQueryResult>;
  processingFeedback?: () => void | Promise<void>;
  observe?: (event: ContextObservationEvent) => void;
  legacy?: { handle(message: BoundChatMessage, context: BoundChatContext): Promise<ProcessBoundChatResult> };
}
const normalizedControl = (text: string) => text.normalize("NFC").trim().toLocaleLowerCase("vi").replace(/[.!]$/u, "");
const localWords = new Set(["có", "ok", "1", "xác nhận", "không", "2", "bỏ", "hủy", "huỷ"]);
const helpWords = new Set(["help", "/help", "trợ giúp", "hướng dẫn"]);
const greeting = /^(?:chào(?: bạn| calenote)?|xin chào(?: bạn| calenote)?|hello|hi)[!.\s]*$/u;
export function createContextContractService(deps: ContextContractServiceDependencies) {
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
        contractVersion: "calenote-context-2", promptVersion: "calenote-context-2", ...event } as ContextObservationEvent); } catch { /* telemetry is non-authoritative */ } };
      const send = async (plan: ReadyReplyPlan, expected?: { contextId: string; contextRevision: number }): Promise<ReplyReceipt | null> => {
        if (!await deps.runtimeStore.canSend({ ...scope, now: deps.now() }, expected)) { emit({ event: "TRANSITION_REJECTED", reason: "STALE" }); return null; }
        emit({ event: "REPLY_SELECTED", source: plan.source }); emit({ event: "REPLY_DISPATCHED" });
        let receipt: ReplyReceipt;
        try { receipt = await deps.reply(plan); } catch { receipt = { status: "UNCERTAIN" }; }
        if (receipt.status === "SENT") emit({ event: "REPLY_SENT" });
        else emit({ event: receipt.status === "FAILED" ? "REPLY_FAILED" : "REPLY_UNCERTAIN", reason: receipt.status === "FAILED" ? "DELIVERY_FAILED" : "UNCERTAIN" });
        return receipt;
      };
      const finish = async (reason: FailureReason): Promise<ProcessBoundChatResult> => {
        if (!await deps.runtimeStore.complete({ ...scope, now: deps.now() })) return { status: "SUPERSEDED" };
        const reply = composeContextReply({ kind: "FAILURE", reason });
        if (reply.status === "READY") await send(reply);
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
          const legacyControl = ["có", "ok", "1", "xác nhận", "hủy", "huỷ", "không", "2"].includes(message.text.normalize("NFC").trim().toLocaleLowerCase("vi"));
          if (observed.failure === "OTHER_CONTRACT" && legacyControl && deps.legacy && await deps.runtimeStore.ownsLegacyContext(scope)) return deps.legacy.handle(message, context);
          emit({ event: "MODEL_BYPASSED", reason: observed.failure === "UNAUTHORIZED" ? "AUTH_INVALID" : "CONTEXT_INVALID" });
          return observed.failure === "UNAUTHORIZED" ? { status: "SUPERSEDED" } : finish(observed.failure === "EXPIRED" ? "EXPIRED" : "CONTEXT");
        }
        emit({ event: "INBOUND_ACCEPTED" }); emit({ event: "CONTEXT_LOADED", presence: observed.snapshot ? "PRESENT" : "ABSENT" });
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
        const built = buildContextInput({ message, context, snapshot: prior, observation: observed.observation });
        let transition: ConversationTransition;
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
            transition = await transitionConversation({ snapshot: prior, received: { ...structuredClone(prior), inbound: observed.observation.inbound, modelAttemptBinding: null, webDeclineReceipt: null },
              ...(recovery ? { previewRecoveryText: message.text } : { localControlText: message.text }), control, authority, now: scope.now, channel: deps.channel });
          } else { emit({ event: "REQUEST_REJECTED", reason: "INVALID_INPUT" }); return finish(built.reason.includes("EXPIRED") ? "EXPIRED" : built.reason.includes("LARGE") || built.reason.includes("LONG") || built.reason.includes("COUNT") ? "SIZE" : "CONTEXT"); }
        } else if (local) {
          emit({ event: "MODEL_BYPASSED", reason: control.kind !== "NONE" || staleControl ? "LOCAL_CONTROL" : helpWords.has(normalized) ? "HELP" : "GREETING" });
          if (control.kind !== "NONE" || recovery) transition = await transitionConversation({ snapshot: prior, received: built.candidateSnapshot,
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
          const inputDigest = await digest(built.input), promptDigest = await digest(CONTEXT_CONTRACT_PROMPT), contractDigest = await digest(InterpretationJsonSchema);
          const bindingDigest = await digest({ observation: observed.observation, inputDigest, promptDigest, contractDigest, contractVersion: "calenote-context-2", promptVersion: "calenote-context-2" });
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
          if (result.status !== "SUCCESS") return finish("PROVIDER");
          const parsed = result.interpretation;
          emit({ event: "STRUCTURE_VALIDATED", fullSchemaValid: parsed.fullSchemaValid, semanticPatchValidation: "VALID", directiveValidation: parsed.directive.status, replyEligibility: parsed.reply.status });
          const evidence = validateEvidence(parsed.semantic, built);
          emit({ event: "PROVENANCE_DOMAIN_VALIDATED", result: evidence.status === "VALID" ? "VALID" : "INVALID", ...(evidence.status !== "VALID" ? { reason: "EVIDENCE_INVALID" as const } : {}) });
          if (evidence.status !== "VALID") return finish("SEMANTIC");
          const merge = mergePatch(prior, evidence.patch);
          const resolution = merge.status === "MERGED" ? resolveRequest(merge.candidate, deps.now(), deps.calendar) : undefined;
          const queryResolution = merge.status === "MERGED" && merge.query ? resolveQuery(merge.query, Date.parse(merge.queryReferenceTime ?? new Date(message.receivedAt).toISOString()), deps.calendar) : undefined;
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
          const effective = computeEffectiveDirective({ semantic: evidence.patch, merge, resolution, queryResolution, queryResult });
          const directiveValidation = validateDirective(parsed.directive, effective);
          const guidance = selectGuidance({ effectiveDirective: effective, directiveValidation, replyProposal: parsed.reply,
            privacyValidation: validateGuidancePrivacy({ conversationDirective: parsed.directive.status === "VALID" ? parsed.directive.value : null,
              replyProposal: parsed.reply.status === "VALID" ? parsed.reply.value : null }, built), language: "vi" });
          emit({ event: "EFFECTIVE_DIRECTIVE_COMPUTED", kind: effective.kind });
          emit({ event: "DIRECTIVE_VALIDATED", result: directiveValidation.status === "VALID" ? "MATCH" : directiveValidation.reason });
          emit({ event: "REPLY_ELIGIBILITY_EVALUATED", result: guidance.source === "MODEL_GUIDANCE" ? "ELIGIBLE" : guidance.reason });
          transition = await transitionConversation({ snapshot: prior, interpretation: evidence.patch, merge, resolution, queryResolution, queryResult, queryTitles, guidance, control, authority, now: deps.now(), channel: deps.channel });
          if (!("kind" in transition)) transition.snapshot.modelAttemptBinding = { attemptId: traceId, observationId: bindingDigest, contextRevision: prior?.contextRevision ?? null,
            sourceInboundId: message.id, claimMarker: message.claimMarker, inputDigest, promptDigest, contractDigest, contractVersion: "calenote-context-2", status: "ACCEPTED" };
          if (!("kind" in transition) && new TextEncoder().encode(encodeContextSnapshot(transition.snapshot)).length > 16384) return finish("SIZE");
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
async function terminalOverflow(prior: ContextSnapshotV1, inbound: ContextSnapshotV1["inbound"], restart: boolean, proof: DecisionProof | null): Promise<ConversationTransition> {
  const received: ContextSnapshotV1 = { ...structuredClone(prior), inbound, requestId: null, draftRevision: null, draftCreatedAt: null, draftExpiresAt: null,
    slots: SlotsSchema.parse(Object.fromEntries(SLOT_NAMES.map(field => [field, { state: "MISSING", value: null, fact: null, evidence: [], provenance: null, resolution: null, proposalRevision: 1 }]))),
    facts: [], ambiguities: [], transcript: [], controlRegistry: [], pendingDecision: null, previewReceipt: null, pendingQueryQuestion: null, pendingReminderQuestion: null, modelAttemptBinding: null };
  const reply = composeContextReply({ kind: "NOTICE", notice: restart ? "RESTARTED" : "ABANDONED" });
  if (reply.status !== "READY") throw new Error("Invalid terminal reply");
  const result = await localTransition(prior, received, reply);
  if ("kind" in result) return result;
  result.snapshot.lifecycle = "CANCELLED"; result.terminal = "CANCELLED";
  if (proof) result.decisionProof = proof;
  return result;
}

async function localTransition(prior: ContextSnapshotV1 | null, received: ContextSnapshotV1, reply: ReadyReplyPlan): Promise<ConversationTransition> {
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

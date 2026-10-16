import { isLegacyV2ValidatedPatch as isValidatedPatch, isValidatedPatchV3, type ValidatedPatch, type ValidatedPatchV3 } from "./evidence";
import { mergeLegacyV2Patch as mergePatch, mergePatchV3, type MergeResult, type MergeResultV3 } from "./merge";
import { resolveRequest, RESOLUTION_VERSION, type RequestResolution } from "./resolve";
import { ContextSnapshotV1Schema, ContextSnapshotV2Schema, PendingDecisionSchema, PendingDecisionV2Schema, SlotsSchema, encodeContextSnapshot, encodeContextSnapshotV2, type ContextSnapshotV1, type ContextSnapshotV2, type ControlAuthority, type PendingDecision, type SourceEvidence } from "./state";
import type { StoredTransition, StoredTransitionV2, DecisionProof, CanonicalPreview } from "./store";
import type { ControlSelection } from "./decisions";
import { selectControl } from "./decisions";
import { computeLegacyV2EffectiveDirective as computeEffectiveDirective, computeEffectiveDirectiveV3, selectGuidance, type GuidanceSelection } from "./guidance";
import { composeContextReply, formatPendingFact, type ReplyOutcome, type ReadyReplyPlan, type FailureReason } from "./responses";
import { resolveQuery, type ContextQueryResult, type QueryResolution } from "./query";
import { digest, previewHash } from "./confirmation";
import { createControlProof } from "./control-proof";
import { isPreviewRecoveryResponse, SAVE_APPROVAL_REPLIES } from "./preview-control";
import { projectSemanticView } from "./projection";
import { lunarCalendar } from "../lunar-calendar";
import { SLOT_NAMES, LegacyV2SemanticPatchProposalSchema as SemanticPatchProposalSchema, SemanticPatchProposalV3Schema, type EvidenceRef } from "./contracts";

export interface TransitionInput {
  snapshot: ContextSnapshotV1 | null;
  /** T2's current retained transcript, including the actual inbound control. */
  received?: ContextSnapshotV1;
  /** Exact non-semantic settlement at context capacity; never source evidence. */
  localControlText?: string;
  /** User-driven re-presentation of an unconfirmed preview, not auto resend. */
  previewRecoveryText?: string;
  interpretation?: ValidatedPatch;
  merge?: MergeResult;
  resolution?: RequestResolution;
  control: ControlSelection;
  authority?: ControlAuthority;
  now: number;
  channel?: "ZALO" | "TELEGRAM" | "WEB";
  guidance?: GuidanceSelection;
  failure?: FailureReason;
  queryResolution?: QueryResolution;
  queryResult?: ContextQueryResult;
  queryTitles?: ReadonlyMap<string, string>;
}
export type ReplyOnly = { kind: "REPLY_ONLY"; reply: ReadyReplyPlan; confirmationProof?: DecisionProof; reason?: string };
export type ConversationTransition = (StoredTransition & { reply: ReadyReplyPlan }) | ReplyOnly;
export type TransitionInputV3 = Omit<TransitionInput, "snapshot" | "received" | "interpretation" | "merge"> & { snapshot: ContextSnapshotV2 | null; received?: ContextSnapshotV2; interpretation?: ValidatedPatchV3; merge?: MergeResultV3 };
export type ConversationTransitionV3 = (StoredTransitionV2 & { reply: ReadyReplyPlan }) | ReplyOnly;
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
function replyOnly(outcome: ReplyOutcome, reason?: string): ReplyOnly {
  const reply = composeContextReply(outcome);
  if (reply.status !== "READY") throw new Error("Invalid backend fallback");
  return { kind: "REPLY_ONLY", reply, ...(reason ? { reason } : {}) };
}
const fail = (reason: FailureReason, detail: string = reason) => replyOnly({ kind: "FAILURE", reason }, detail);
function expiry(s: ContextSnapshotV1 | ContextSnapshotV2): string {
  return new Date(Math.min(Date.parse(s.idleExpiresAt), Date.parse(s.absoluteExpiresAt), s.draftExpiresAt ? Date.parse(s.draftExpiresAt) : Infinity)).toISOString();
}
function recap(s: ContextSnapshotV1 | ContextSnapshotV2): string[] {
  return SLOT_NAMES.flatMap(field => { const slot = s.slots[field]; return slot.value === null ? [] : [formatPendingFact(field, slot.value)]; });
}
function clearDecision(s: ContextSnapshotV1 | ContextSnapshotV2) {
  s.pendingDecision = null; s.previewReceipt = null;
  s.lifecycle = s.requestId ? "CLARIFYING" : "NONE";
  // Old handles stay only as transcript redaction metadata. No current
  // decision points to them and neither T4 validator searches old handles.
}
function emptySlots() {
  return SlotsSchema.parse(Object.fromEntries(SLOT_NAMES.map(field => [field, { state: "MISSING", value: null, fact: null, evidence: [], provenance: null, resolution: null, proposalRevision: 1 }])));
}
type Candidate = NonNullable<PendingDecision["candidate"]>;
function candidateFromPatch(patch: ValidatedPatch, proposalId: string): Candidate | null {
  // An unrelated request may use only its own grounded user evidence. A's
  // context aliases cannot become B's facts through a replacement proposal.
  if (patch.changeEvidence.some(e => !e.current || e.provenance.kind !== "EXPLICIT_USER" || !e.sources.length)
    || patch.proposal.changes.some(c => c.evidence.some(e => e.kind === "CONTEXT_FACT"))
    || patch.alternativeEvidence.some(e => e.provenance.kind !== "EXPLICIT_USER" || !e.sources.length)) return null;
  const s = patch.candidateSnapshot;
  const refs = (sources: readonly SourceEvidence[]): EvidenceRef[] => sources.map(e => ({ kind: "USER_QUOTE", turn: s.transcript.findIndex(t => t.id === e.sourceTurnId), quote: e.quote, occurrence: e.occurrence }));
  const evidenceIndex = patch.changeEvidence.map(e => ({ field: SLOT_NAMES.find(f => f === e.field)!, evidence: structuredClone([...e.sources]) }));
  const sources = [...evidenceIndex.flatMap(e => e.evidence), ...patch.alternativeEvidence.flatMap(e => [...e.sources])].filter((e, i, all) => all.findIndex(other => equal(e, other)) === i);
  if (!sources.length || sources.length > 3) return null;
  let alternativeIndex = 0;
  const uncertainties = patch.resolvedUncertainties.map(u => ({ ...u, alternatives: u.alternatives.map(a => ({ ...a, evidence: refs(patch.alternativeEvidence[alternativeIndex++].sources) })) }));
  const proposal = SemanticPatchProposalSchema.safeParse({ ...patch.proposal, uncertainties, changes: patch.resolvedChanges.map((c, i) => ({ ...c, evidence: refs(patch.changeEvidence[i].sources) })) });
  if (!proposal.success) return null;
  return { proposalId, proposalRevision: 1, proposal: proposal.data, sourceEvidence: sources, evidenceIndex, createdAt: s.inbound.receivedAt, expiresAt: new Date(Math.min(Date.parse(s.inbound.receivedAt) + 600000, Date.parse(s.absoluteExpiresAt), Date.parse(s.idleExpiresAt))).toISOString() };
}

type CandidateV3 = NonNullable<NonNullable<ContextSnapshotV2["pendingDecision"]>["candidate"]>;
function candidateFromPatchV3(patch: ValidatedPatchV3, proposalId: string): CandidateV3 | null {
  if (patch.changeEvidence.some(e => e.provenance.kind !== "EXPLICIT_USER" || !e.sources.length)
    || patch.alternativeEvidence.some(e => e.provenance.kind !== "EXPLICIT_USER" || !e.sources.length)) return null;
  const s = patch.candidateSnapshot;
  const refs = (sources: readonly SourceEvidence[]): EvidenceRef[] => sources.map(e => ({ kind: "USER_QUOTE", turn: s.transcript.findIndex(t => t.id === e.sourceTurnId), quote: e.quote, occurrence: e.occurrence }));
  const evidenceIndex = patch.changeEvidence.map(e => ({ field: SLOT_NAMES.find(f => f === e.field)!, evidence: structuredClone([...e.sources]) }));
  const sources = [...patch.requestTargetEvidence, ...evidenceIndex.flatMap(e => e.evidence), ...patch.alternativeEvidence.flatMap(e => [...e.sources])].filter((e, i, all) => all.findIndex(other => equal(e, other)) === i);
  if (!sources.length || sources.length > 3) return null;
  let alternativeIndex = 0;
  const uncertainties = patch.resolvedUncertainties.map(u => ({ ...u, alternatives: u.alternatives.map(a => ({ ...a, evidence: refs(patch.alternativeEvidence[alternativeIndex++].sources) })) }));
  const proposal = SemanticPatchProposalV3Schema.safeParse({ ...patch.proposal, requestTarget: { kind: "NEW", evidence: refs(patch.requestTargetEvidence) }, uncertainties, changes: patch.resolvedChanges.map((c, i) => ({ ...c, evidence: refs(patch.changeEvidence[i].sources) })) });
  if (!proposal.success) return null;
  // Adoption retains the original candidate's receipt and expiry. A targeting
  // answer cannot renew a pending proposal or its relative-date anchor.
  const original = patch.adoptedCandidate ? s.pendingSemanticCandidate : null;
  const createdAt = original?.createdAt ?? s.inbound.receivedAt;
  return { proposalId, proposalRevision: original?.proposalRevision ?? 1, proposal: proposal.data, sourceEvidence: structuredClone(sources), evidenceIndex, createdAt, expiresAt: original?.expiresAt ?? new Date(Math.min(Date.parse(createdAt) + 600000, Date.parse(s.idleExpiresAt), Date.parse(s.absoluteExpiresAt))).toISOString() };
}

/** Successor state is never converted to context2. Decisions are constructed
 * after grounded merge/resolution and persist UNCERTAIN until real delivery. */
async function transitionSelected(input: TransitionInput | TransitionInputV3, successor: boolean): Promise<ConversationTransition | ConversationTransitionV3> {
  const prior = input.snapshot, patch = input.interpretation;
  if (input.failure && !input.received) return fail(input.failure);
  if (!Number.isSafeInteger(input.now) || (prior && !(successor ? ContextSnapshotV2Schema : ContextSnapshotV1Schema).safeParse(prior).success)) return fail("CONTEXT");
  if (prior && Date.parse(expiry(prior)) <= input.now) return fail("EXPIRED");
  if (patch && !(successor ? isValidatedPatchV3(patch) : isValidatedPatch(patch))) return fail("SEMANTIC");
  const received = input.received ?? patch?.candidateSnapshot;
  if (!received || !(successor ? ContextSnapshotV2Schema : ContextSnapshotV1Schema).safeParse(received).success || (prior && (received.id !== prior.id || !equal(received.scope, prior.scope)
    || received.contextRevision !== prior.contextRevision || received.requestId !== prior.requestId || received.draftRevision !== prior.draftRevision)) || Date.parse(received.inbound.receivedAt) > input.now) return fail("CONTEXT");
  let s = structuredClone(received), preview: CanonicalPreview | null = null, proof: DecisionProof | undefined, terminal: StoredTransition["terminal"] = null;
  const revision = (prior?.contextRevision ?? 0) + 1;
  const seed = await digest([s.scope.ownerId, s.scope.chatIdentityId, s.id, s.inbound.id, revision]);
  let outboundId = `out-${seed}`;
  const decisionId = `decision-${seed}`, token = `CN-${seed.slice(0, 20)}`, proposalId = `proposal-${seed}`;
  let outcome: ReplyOutcome | null = null, guidance = input.guidance;
  const issue = (kind: PendingDecision["kind"], candidate: Candidate | CandidateV3 | null = null) => {
    clearDecision(s); clearSemanticCandidate(s);
    s.pendingDecision = (successor ? PendingDecisionV2Schema : PendingDecisionSchema).parse({ decisionId, kind, target: { ownerId: s.scope.ownerId, chatIdentityId: s.scope.chatIdentityId, chatId: s.scope.chatId, requestId: s.requestId, proposalId: candidate?.proposalId ?? null }, questionId: outboundId, previewId: kind === "SAVE_PREVIEW" ? outboundId : null, draftRevision: s.draftRevision, contextRevision: revision, issuedAfterInbound: { receivedAt: s.inbound.receivedAt, rowid: s.inbound.rowid }, deliveryState: "UNCERTAIN", expiresAt: new Date(Math.min(Date.parse(expiry(s)), candidate ? Date.parse(candidate.expiresAt) : Infinity)).toISOString(), acceptedReplies: ["có", "ok", "1"], replyReference: null, tokenHandle: token, candidate });
    outcome = { kind: "DECISION", decisionKind: kind, token, facts: candidate ? candidate.proposal.changes.filter(c => c.value !== null).map(c => formatPendingFact(c.field, c.value)) : recap(s) };
  };
  const suspendSelectedOffer = () => {
    const retained = s.pendingDecision?.candidate ? structuredClone(s.pendingDecision) : null;
    clearDecision(s);
    if (retained) { retained.contextRevision = revision; retained.deliveryState = "UNCERTAIN"; retained.replyReference = null; retained.tokenHandle = null; s.pendingDecision = retained; }
  };
  const composeQuery = (patch: ValidatedPatch | ValidatedPatchV3, query: NonNullable<ValidatedPatch["resolvedQuery"]>, referenceTime: string, supplied?: QueryResolution) => {
    const qr = supplied ?? resolveQuery(query, Date.parse(referenceTime), lunarCalendar);
    const effective = effectiveSelected(patch, s, undefined, qr, input.queryResult);
    if (effective.kind === "ASK_FOR_FIELD" || effective.kind === "ASK_FOR_DISAMBIGUATION") {
      const fallback = selectGuidance({ effectiveDirective: effective, directiveValidation: { status: "INVALID", reason: "DIRECTIVE_INVALID" }, replyProposal: { status: "VALID", value: null }, privacyValidation: { status: "VALID" }, language: "vi" });
      const field = effective.field === "queryRange" ? "queryRange" : "intent";
      outcome = { kind: "QUESTION", question: fallback.text!, facts: [], field };
      s.pendingQueryQuestion = { scope: "QUERY", field, questionId: outboundId, text: fallback.text!, decisionKind: null, reason: effective.kind === "ASK_FOR_FIELD" ? "MISSING" : effective.reason, noProgressCount: 0, deliveryState: "UNCERTAIN", issuedAfterOrder: { receivedAt: s.inbound.receivedAt, rowid: s.inbound.rowid } };
    } else if (effective.kind === "ANSWER_QUERY") { s.pendingQueryQuestion = null; outcome = { kind: "QUERY", resolution: qr, result: input.queryResult, titles: input.queryTitles }; }
    else outcome = { kind: "FAILURE", reason: input.queryResult && input.queryResult.status !== "RESULTS" ? "PROVIDER" : "SEMANTIC" };
  };
  const control = input.control;
  // Operational refusal invalidates actionable proofs, not grounded pending
  // facts or their original question/delivery/expiry binding.
  if (input.failure) { clearDecision(s); outcome = { kind: "FAILURE", reason: input.failure }; }
  else if (control.kind !== "NONE") {
    if (!prior || !input.authority || input.authority.kind !== "CHAT") return fail("STALE");
    const inbound = s.transcript.find(t => t.id === s.inbound.id && t.role === "USER") ?? (input.localControlText !== undefined && ["DECLINE", "AMBIGUOUS_TARGET"].includes(control.kind) ? { text: input.localControlText } : undefined);
    if (!inbound || input.authority.scope.sourceInboundId !== s.inbound.id || input.authority.scope.claimMarker !== s.inbound.claimMarker
      || Date.parse(s.inbound.receivedAt) < Date.parse(prior.inbound.receivedAt) || (s.inbound.receivedAt === prior.inbound.receivedAt && s.inbound.rowid <= prior.inbound.rowid)) return fail("STALE");
    const selected = selectControl(inbound.text, prior.pendingDecision, input.authority, { snapshot: prior, now: input.now, replyReference: control.kind === "APPROVE" && control.response.kind === "REPLY" ? control.response.reference : null });
    if (!equal(selected, control)) return fail("STALE");
    if (control.kind !== "AMBIGUOUS_TARGET") clearSemanticCandidate(s);
    if (control.kind === "AMBIGUOUS_TARGET") {
      suspendSelectedOffer();
      outcome = { kind: "NOTICE", notice: s.schemaVersion === "calenote-context-state-2" && s.pendingSemanticCandidate ? "AMBIGUOUS_SEMANTIC_TARGET" : "AMBIGUOUS_TARGET" };
    } else if (control.kind === "ABANDON") { clearDecision(s); s.pendingReminderQuestion = null; s.pendingQueryQuestion = null; terminal = "CANCELLED"; s.lifecycle = "CANCELLED"; outcome = { kind: "NOTICE", notice: "ABANDONED" }; }
    else if (control.kind === "DECLINE") { clearDecision(s); outcome = { kind: "NOTICE", notice: "DECLINED" }; }
    else {
      const d = prior.pendingDecision!;
      proof = await createControlProof(prior, s.inbound, inbound.text, control, input.authority, input.now) ?? undefined;
      if (!proof) return fail("STALE");
      if (d.kind === "SAVE_PREVIEW") return { ...replyOnly({ kind: "NOTICE", notice: "CHECKING" }), confirmationProof: proof };
      clearDecision(s);
      if (d.kind === "RESTART_PENDING") { s.pendingReminderQuestion = null; s.pendingQueryQuestion = null; terminal = "CANCELLED"; s.lifecycle = "CANCELLED"; outcome = { kind: "NOTICE", notice: "RESTARTED" }; }
      else if (d.kind === "REPLACE_PENDING" || d.kind === "ACCEPT_ONE_TIME_ALTERNATIVE") {
        const candidate = d.kind === "ACCEPT_ONE_TIME_ALTERNATIVE" && d.candidate ? acceptSelected(d.candidate, s) : d.candidate;
        if (!candidate) return fail("CONTEXT");
        if (d.kind === "ACCEPT_ONE_TIME_ALTERNATIVE" && prior.requestId) issue("REPLACE_PENDING", candidate);
        else { const adopted = adoptSelected(s, candidate); if (!adopted) return fail("CONTEXT"); s = adopted; }
      }
    }
  } else if (patch) {
    if (isValidatedPatch(patch)) {
      if (patch.proposal.dialogueAct === "ABANDON_PENDING") { suspendSelectedOffer(); outcome = { kind: "NOTICE", notice: "ESCAPE_REQUIRED" }; }
      else {
        if (prior && prior.schemaVersion !== "calenote-context-state-1") return fail("CONTEXT");
        const merge = mergePatch(prior, patch);
        if (merge.status === "REJECTED") {
          if (merge.reason === "AMBIGUOUS_OPERATION" && prior?.requestId) issue("RESUME_PENDING");
          else {
            if (merge.reason !== "REPLACEMENT_REQUIRED") return fail("SEMANTIC", merge.reason);
            const candidate = candidateFromPatch(patch, proposalId);
            if (!candidate) return fail("SEMANTIC", "CANDIDATE_EVIDENCE");
            const adopted = adoptSelected(s, candidate);
            if (!adopted) return fail("CONTEXT");
            const resolution = resolveRequest(adopted, input.now, lunarCalendar);
            if (resolution.status === "UNSUPPORTED" && resolution.capability !== "YEARLY") { clearDecision(s); outcome = { kind: "UNSUPPORTED", capability: resolution.capability }; }
            else issue(resolution.status === "UNSUPPORTED" ? "ACCEPT_ONE_TIME_ALTERNATIVE" : "REPLACE_PENDING", candidate);
          }
        } else {
          s = structuredClone(merge.candidate);
          clearDecision(s);
          if (merge.query) {
            composeQuery(patch, merge.query, merge.queryReferenceTime!, input.queryResolution);
          } else if (patch.proposal.intent === "HELP") outcome = { kind: "NOTICE", notice: "HELP" };
          else if (patch.proposal.intent === "UNSUPPORTED") outcome = { kind: "UNSUPPORTED", capability: "ASSISTANT_SCOPE" };
        }
      }
    } else {
      // Recompute instead of trusting a caller-supplied unbranded merge outcome.
      if (!isValidatedPatchV3(patch) || (prior && prior.schemaVersion !== "calenote-context-state-2")) return fail("SEMANTIC");
      const merge = mergePatchV3(prior, patch);
      if (merge.status === "REJECTED") return fail("SEMANTIC", merge.reason);
      s = structuredClone(merge.candidate); clearDecision(s);
      if (merge.status === "CLARIFY_OPERATION") {
        const operation = patch.resolvedUncertainties[0];
        const emptyCurrentOperation = !patch.adoptedCandidate && patch.requestTarget?.kind === "UNRESOLVED" && patch.resolvedChanges.length === 0
          && patch.resolvedUncertainties.length === 1 && operation.field === "operation" && operation.reason === "AMBIGUOUS"
          && operation.alternatives.length === 2 && ["CURRENT", "NEW"].every(value => operation.alternatives.some(a => a.value === value))
          && patch.requestTargetEvidence.every(e => e.sourceTurnId === s.inbound.id)
          && patch.alternativeEvidence.every(e => e.current);
        if (emptyCurrentOperation && prior?.pendingDecision?.candidate) {
          s = structuredClone(received); suspendSelectedOffer();
          outcome = { kind: "NOTICE", notice: "AMBIGUOUS_TARGET" };
        } else if (emptyCurrentOperation && prior?.requestId && !prior.pendingSemanticCandidate) {
          // This asks only whether to resume A. Preserve its unrelated field/
          // query questions and uncertainties; never adopt the empty meaning.
          s = structuredClone(received); issue("RESUME_PENDING");
        } else {
          const pending = merge.candidate.pendingSemanticCandidate, q = merge.candidate.pendingReminderQuestion;
          if (!pending || !q || pending.questionId !== q.questionId) return fail("CONTEXT");
          outboundId = q.questionId;
          outcome = { kind: "QUESTION", field: "operation", question: q.text, facts: recap(s) };
        }
      } else if (merge.status === "NEEDS_REPLACEMENT") {
        const candidate = candidateFromPatchV3(merge.proposed, proposalId);
        if (!candidate) return fail("SEMANTIC", "CANDIDATE_EVIDENCE");
        const adopted = adoptSelected(s, candidate); if (!adopted) return fail("CONTEXT");
        const resolution = resolveRequest(adopted, input.now, lunarCalendar);
        if (resolution.status === "UNSUPPORTED" && resolution.capability !== "YEARLY") outcome = { kind: "UNSUPPORTED", capability: resolution.capability };
        else issue(resolution.status === "UNSUPPORTED" ? "ACCEPT_ONE_TIME_ALTERNATIVE" : "REPLACE_PENDING", candidate);
      } else if (merge.query) {
        composeQuery(patch, merge.query, merge.queryReferenceTime!);
      } else if (patch.proposal.intent === "HELP") outcome = { kind: "NOTICE", notice: "HELP" };
      else if (patch.proposal.intent === "UNSUPPORTED") outcome = { kind: "UNSUPPORTED", capability: "ASSISTANT_SCOPE" };
    }
  } else if (input.previewRecoveryText !== undefined) {
    if (!prior || !input.authority || input.authority.kind !== "CHAT" || !isPreviewRecoveryResponse(prior, input.previewRecoveryText)
      || input.authority.scope.sourceInboundId !== s.inbound.id || input.authority.scope.claimMarker !== s.inbound.claimMarker
      || Date.parse(s.inbound.receivedAt) < Date.parse(prior.inbound.receivedAt) || (s.inbound.receivedAt === prior.inbound.receivedAt && s.inbound.rowid <= prior.inbound.rowid)) return fail("STALE");
    clearDecision(s);
  } else { clearDecision(s); outcome = { kind: "NOTICE", notice: "RESUME" }; }
  if (!outcome) {
    const resolution = resolveRequest(s, input.now, lunarCalendar);
    if (resolution.status === "UNSUPPORTED") {
      if (resolution.capability === "YEARLY" && patch && !prior?.requestId) {
        const candidate = candidateSelected(patch, proposalId); if (!candidate) return fail("SEMANTIC", "CANDIDATE_EVIDENCE");
        s = structuredClone(received); issue("ACCEPT_ONE_TIME_ALTERNATIVE", candidate);
      } else { if (prior?.requestId) { s = structuredClone(received); clearDecision(s); } outcome = { kind: "UNSUPPORTED", capability: resolution.capability }; }
    } else {
      const localField = resolution.status === "CLARIFY" ? SLOT_NAMES.find(f => f === resolution.fields[0]) : undefined;
      if (!patch && resolution.status === "CLARIFY" && !localField) return fail("SEMANTIC", "UNKNOWN_DIRECTIVE");
      const effective = patch ? effectiveSelected(patch, s, resolution) : resolution.status === "READY" ? { kind: "PRESENT_PREVIEW" as const } : { kind: "ASK_FOR_FIELD" as const, field: localField! };
      if (effective.kind === "PRESENT_PREVIEW" && resolution.status === "READY") {
        if (!input.channel) return fail("CONFIG", "PREVIEW_CHANNEL_REQUIRED");
        s.slots = structuredClone(resolution.resolvedSlots); s.facts = structuredClone(resolution.resolvedFacts);
        if (prior?.requestId === s.requestId && !equal(prior.slots, s.slots)) s.draftRevision = (prior.draftRevision ?? 0) + 1;
        preview = { schemaVersion: "calenote-context-preview-1", title: s.slots.title.value!, details: resolution.details, occurrences: resolution.occurrences, prefix: "Bản nháp chưa lưu:\n", suffix: `\nXác nhận ${token}\nTrả lời 2 để từ chối.` };
        issue("SAVE_PREVIEW"); s.lifecycle = "AWAITING_CONFIRMATION"; s.pendingReminderQuestion = null; s.pendingQueryQuestion = null;
        s.pendingDecision!.previewId = outboundId; s.pendingDecision!.acceptedReplies = [...SAVE_APPROVAL_REPLIES];
        s.pendingDecision!.target.proposalId = resolution.occurrences.length > 1 ? proposalId : null;
        s.previewReceipt = { previewId: outboundId, requestId: s.requestId!, draftRevision: s.draftRevision!, draftHash: await previewHash(preview), ownerId: s.scope.ownerId, chatIdentityId: s.scope.chatIdentityId, chatId: s.scope.chatId, channel: input.channel, issuedAfterOrder: { receivedAt: s.inbound.receivedAt, rowid: s.inbound.rowid }, expiresAt: expiry(s), deliveryState: "UNCERTAIN", replyReference: null };
        outcome = { kind: "PREVIEW", preview, token };
      } else if (effective.kind === "ASK_FOR_FIELD" || effective.kind === "ASK_FOR_DISAMBIGUATION") {
        if (effective.field === "queryRange") return fail("SEMANTIC");
        const fallback = selectGuidance({ effectiveDirective: effective, directiveValidation: { status: "INVALID", reason: "DIRECTIVE_INVALID" }, replyProposal: { status: "VALID", value: null }, privacyValidation: { status: "VALID" }, language: "vi" });
        const field = effective.field, progressed = !prior || !equal(prior.slots, s.slots) || !equal(prior.ambiguities, s.ambiguities);
        const count = !progressed && prior?.pendingReminderQuestion?.field === field ? Math.min(3, prior.pendingReminderQuestion.noProgressCount + 1) : 0;
        s.pendingReminderQuestion = { scope: "REMINDER", field, questionId: outboundId, text: fallback.text!, decisionKind: null, reason: effective.kind === "ASK_FOR_FIELD" ? "MISSING" : effective.reason, noProgressCount: count, deliveryState: "UNCERTAIN", issuedAfterOrder: { receivedAt: s.inbound.receivedAt, rowid: s.inbound.rowid } };
        const alternatives = s.ambiguities.find(u => u.field === field)?.alternatives.map(a => formatPendingFact(field, a.value));
        if (count >= 2) { if (count === 3) { issue("RESTART_PENDING"); s.pendingReminderQuestion!.decisionKind = "RESTART_PENDING"; } outcome = { kind: "RECOVERY", count: count as 2 | 3, question: fallback.text!, facts: recap(s), ...(count === 3 ? { token } : {}) }; guidance = undefined; }
        else outcome = { kind: "QUESTION", field, question: fallback.text!, facts: recap(s), alternatives };
      } else if (effective.kind === "EXPLAIN_UNSUPPORTED") outcome = { kind: "UNSUPPORTED", capability: effective.issue };
      else return fail("SEMANTIC", "UNKNOWN_DIRECTIVE");
    }
  }
  if (!outcome) return fail("SEMANTIC");
  const reply = composeContextReply(outcome, guidance); if (reply.status !== "READY") return fail("SIZE", reply.status);
  const questionSpan = reply.spans.find(span => span.kind === "QUESTION");
  if (questionSpan) {
    const text = reply.text.slice(questionSpan.start, questionSpan.end);
    if (s.pendingReminderQuestion?.questionId === outboundId) s.pendingReminderQuestion.text = text;
    if (s.pendingQueryQuestion?.questionId === outboundId) s.pendingQueryQuestion.text = text;
  }
  s.contextRevision = revision;
  if (s.schemaVersion === "calenote-context-state-2" && s.pendingSemanticCandidate) s.pendingSemanticCandidate.baseContextRevision = revision;
  if (s.pendingDecision?.tokenHandle) s.controlRegistry.push({ handle: s.pendingDecision.tokenHandle, kind: "TOKEN", ownerId: s.scope.ownerId, chatIdentityId: s.scope.chatIdentityId, chatId: s.scope.chatId, decisionId: s.pendingDecision.decisionId, contextRevision: revision, draftRevision: s.draftRevision, expiresAt: s.pendingDecision.expiresAt });
  const projected = projectSemanticView(reply.text, s.controlRegistry.map(c => c.handle)); if (projected.status !== "READY") return fail("SIZE");
  const oldTurns = [...s.transcript.map(t => t.id), outboundId];
  // An undelivered targeting question keeps its application identity. Replace
  // its inert transcript presentation rather than storing duplicate IDs; source
  // refs are remapped from the pre-replacement transcript below.
  if (successor) s.transcript = s.transcript.filter(t => t.role !== "ASSISTANT" || t.id !== outboundId);
  s.transcript.push({ id: outboundId, text: reply.text, semanticView: projected.text, controlSpans: projected.controlSpans, sourceMap: projected.sourceMap, role: "ASSISTANT", kind: reply.kind, deliveryState: "UNCERTAIN", messageRef: null, receivedAt: s.inbound.receivedAt });
  while (s.transcript.filter(t => t.role === "ASSISTANT").length > 6) s.transcript.splice(s.transcript.findIndex(t => t.role === "ASSISTANT"), 1);
  const remap = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(remap);
    if (!value || typeof value !== "object") return value;
    if ("kind" in value && value.kind === "USER_QUOTE" && "turn" in value && typeof value.turn === "number") return { ...value, turn: s.transcript.findIndex(t => t.id === oldTurns[value.turn as number]) };
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, remap(child)]));
  };
  const parsed = (successor ? ContextSnapshotV2Schema : ContextSnapshotV1Schema).safeParse(remap(s)); if (!parsed.success) return fail("CONTEXT", "TRANSITION_STATE_INVALID");
  if (new TextEncoder().encode(parsed.data.schemaVersion === "calenote-context-state-2" ? encodeContextSnapshotV2(parsed.data) : encodeContextSnapshot(parsed.data)).byteLength > 16384) return fail("SIZE", "CONTEXT_SNAPSHOT_TOO_LARGE");
  const stored = { expectedContextRevision: prior?.contextRevision ?? null, expectedDraftRevision: prior?.draftRevision ?? null, preview, terminal, inboundOutcome: "PROCESSED" as const, ...(proof ? { decisionProof: proof } : {}), reply };
  return parsed.data.schemaVersion === "calenote-context-state-2" ? { ...stored, snapshot: parsed.data } : { ...stored, snapshot: parsed.data };
}

type SelectedSnapshot = ContextSnapshotV1 | ContextSnapshotV2;
function clearSemanticCandidate(s: SelectedSnapshot): void {
  if (s.schemaVersion === "calenote-context-state-2") s.pendingSemanticCandidate = null;
}
function candidateSelected(patch: ValidatedPatch | ValidatedPatchV3, id: string): Candidate | CandidateV3 | null {
  return isValidatedPatchV3(patch) ? candidateFromPatchV3(patch, id) : isValidatedPatch(patch) ? candidateFromPatch(patch, id) : null;
}
function adoptSelected(s: SelectedSnapshot, candidate: Candidate | CandidateV3): SelectedSnapshot | null {
  const proposal = (s.schemaVersion === "calenote-context-state-2" ? SemanticPatchProposalV3Schema : SemanticPatchProposalSchema).safeParse(candidate.proposal);
  if (!proposal.success) return null;
  const result = structuredClone(s);
  clearDecision(result); clearSemanticCandidate(result);
  result.slots = emptySlots(); result.facts = []; result.ambiguities = structuredClone(proposal.data.uncertainties);
  result.requestId = candidate.proposalId; result.draftRevision = (s.draftRevision ?? 0) + 1;
  result.draftCreatedAt = candidate.createdAt; result.draftExpiresAt = candidate.expiresAt;
  result.pendingReminderQuestion = null; result.pendingQueryQuestion = null; result.lifecycle = "CLARIFYING";
  for (const change of proposal.data.changes) {
    if (change.operation === "CLEAR") continue;
    const evidence = candidate.evidenceIndex.find(e => e.field === change.field)?.evidence;
    if (!evidence?.length) return null;
    const referenceTime = evidence.map(e => result.transcript.find(t => t.id === e.sourceTurnId)?.receivedAt).filter((t): t is string => !!t).sort().at(-1);
    if (!referenceTime) return null;
    Object.assign(result.slots[change.field], { state: "RESOLVED", value: structuredClone(change.value), evidence: structuredClone(evidence), provenance: { kind: "EXPLICIT_USER" }, resolution: { method: "EXPLICIT_OPERAND", version: RESOLUTION_VERSION, referenceTime, timezone: "Asia/Ho_Chi_Minh", dependencies: [] } });
  }
  const facts = SLOT_NAMES.flatMap(field => {
    const slot = result.slots[field]; if (slot.value === null) return [];
    slot.fact = `f${SLOT_NAMES.indexOf(field) + 1}`;
    return [{ alias: slot.fact, scope: "REMINDER", field, value: slot.value, evidenceSlot: field, provenance: slot.provenance, sourceReferenceTime: slot.resolution!.referenceTime, dependencies: [] }];
  });
  const parsed = (s.schemaVersion === "calenote-context-state-2" ? ContextSnapshotV2Schema : ContextSnapshotV1Schema).safeParse({ ...result, facts });
  return parsed.success ? parsed.data : null;
}
function acceptSelected(candidate: Candidate | CandidateV3, s: SelectedSnapshot): Candidate | CandidateV3 | null {
  const turn = s.transcript.find(t => t.id === s.inbound.id && t.role === "USER");
  if (!turn?.text) return null;
  const firstControl = turn.sourceMap.segments.find(segment => segment.kind === "CONTROL_REPLACEMENT");
  const sourceText = [...turn.text].slice(0, firstControl?.sourceStart).join("").trimEnd(), quote = sourceText.normalize("NFC");
  const n = [...sourceText].length, v = [...quote].length;
  if (!quote || [...turn.semanticView].slice(0, v).join("") !== quote) return null;
  const source: SourceEvidence = { kind: "USER_QUOTE", sourceTurnId: turn.id, sourceMapTurnId: turn.id, quote, occurrence: 1, sourceSpan: { start: 0, end: n }, viewSpan: { start: 0, end: v }, normalizationVersion: "nfc-codepoint-v1" };
  const evidence: EvidenceRef[] = [{ kind: "USER_QUOTE", turn: s.transcript.indexOf(turn), quote, occurrence: 1 }];
  const changes = [...candidate.proposal.changes.filter(c => !["frequency", "occurrenceCount", "endDate"].includes(c.field)), { field: "frequency", operation: "SET", value: "ONCE", evidence }];
  const proposal = { ...candidate.proposal, changes };
  const rest = { ...structuredClone(candidate), proposalRevision: candidate.proposalRevision + 1, evidenceIndex: [...candidate.evidenceIndex.filter(e => !["frequency", "occurrenceCount", "endDate"].includes(e.field)), { field: "frequency" as const, evidence: [source] }] };
  if (s.schemaVersion === "calenote-context-state-2") {
    const parsed = SemanticPatchProposalV3Schema.safeParse(proposal);
    return parsed.success ? { ...rest, proposal: parsed.data } : null;
  }
  const parsed = SemanticPatchProposalSchema.safeParse(proposal);
  return parsed.success ? { ...rest, proposal: parsed.data } : null;
}
function effectiveSelected(semantic: ValidatedPatch | ValidatedPatchV3, candidate: SelectedSnapshot, resolution?: RequestResolution, queryResolution?: QueryResolution, queryResult?: ContextQueryResult) {
  if (isValidatedPatchV3(semantic) && candidate.schemaVersion === "calenote-context-state-2") {
    return computeEffectiveDirectiveV3({ semantic, merge: { status: "MERGED", candidate, changedFields: [], uncertainties: candidate.ambiguities, query: semantic.resolvedQuery, queryReferenceTime: semantic.queryReferenceTime }, resolution, queryResolution, queryResult });
  }
  if (isValidatedPatch(semantic) && candidate.schemaVersion === "calenote-context-state-1") {
    return computeEffectiveDirective({ semantic, merge: { status: "MERGED", candidate, changedFields: [], uncertainties: candidate.ambiguities, query: semantic.resolvedQuery, queryReferenceTime: semantic.queryReferenceTime }, resolution, queryResolution, queryResult });
  }
  return { kind: "BACKEND_ONLY" as const, reason: "FAILURE" as const };
}
export async function transitionLegacyV2Conversation(input: TransitionInput): Promise<ConversationTransition> {
  const result = await transitionSelected(input, false);
  if ("kind" in result) return result;
  const snapshot = ContextSnapshotV1Schema.safeParse(result.snapshot);
  return snapshot.success ? { ...result, snapshot: snapshot.data } : fail("CONTEXT");
}
export async function transitionConversationV3(input: TransitionInputV3): Promise<ConversationTransitionV3> {
  const result = await transitionSelected(input, true);
  if ("kind" in result) return result;
  const snapshot = ContextSnapshotV2Schema.safeParse(result.snapshot);
  return snapshot.success ? { ...result, snapshot: snapshot.data } : fail("CONTEXT");
}

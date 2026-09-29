import { isValidatedPatch, type ValidatedPatch } from "./evidence";
import { mergePatch, type MergeResult } from "./merge";
import { resolveRequest, RESOLUTION_VERSION, type RequestResolution } from "./resolve";
import { ContextSnapshotV1Schema, SlotsSchema, encodeContextSnapshot, type ContextSnapshotV1, type ControlAuthority, type PendingDecision, type SourceEvidence } from "./state";
import type { StoredTransition, DecisionProof, CanonicalPreview } from "./store";
import type { ControlSelection } from "./decisions";
import { selectControl } from "./decisions";
import { computeEffectiveDirective, selectGuidance, type GuidanceSelection } from "./guidance";
import { composeContextReply, formatPendingFact, type ReplyOutcome, type ReadyReplyPlan, type FailureReason } from "./responses";
import { resolveQuery, type ContextQueryResult, type QueryResolution } from "./query";
import { digest, previewHash, validDecision } from "./confirmation";
import { projectSemanticView } from "./projection";
import { lunarCalendar } from "../lunar-calendar";
import { SLOT_NAMES, SemanticPatchProposalSchema, type EvidenceRef, type FieldChange } from "./contracts";

export interface TransitionInput {
  snapshot: ContextSnapshotV1 | null;
  /** T2's current retained transcript, including the actual inbound control. */
  received?: ContextSnapshotV1;
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
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
function replyOnly(outcome: ReplyOutcome, reason?: string): ReplyOnly {
  const reply = composeContextReply(outcome);
  if (reply.status !== "READY") throw new Error("Invalid backend fallback");
  return { kind: "REPLY_ONLY", reply, ...(reason ? { reason } : {}) };
}
const fail = (reason: FailureReason, detail: string = reason) => replyOnly({ kind: "FAILURE", reason }, detail);
function expiry(s: ContextSnapshotV1): string {
  return new Date(Math.min(Date.parse(s.idleExpiresAt), Date.parse(s.absoluteExpiresAt), s.draftExpiresAt ? Date.parse(s.draftExpiresAt) : Infinity)).toISOString();
}
function recap(s: ContextSnapshotV1): string[] {
  return SLOT_NAMES.flatMap(field => { const slot = s.slots[field]; return slot.value === null ? [] : [formatPendingFact(field, slot.value)]; });
}
function clearDecision(s: ContextSnapshotV1) {
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
function adoptCandidate(s: ContextSnapshotV1, candidate: Candidate): ContextSnapshotV1 | null {
  const result = structuredClone(s);
  clearDecision(result); result.slots = emptySlots(); result.facts = []; result.ambiguities = structuredClone(candidate.proposal.uncertainties);
  // Replacing a draft must retain the existing bound-confirmation requirement.
  result.requestId = candidate.proposalId; result.draftRevision = (s.draftRevision ?? 0) + 1; result.draftCreatedAt = candidate.createdAt; result.draftExpiresAt = candidate.expiresAt;
  result.pendingReminderQuestion = null; result.pendingQueryQuestion = null; result.lifecycle = "CLARIFYING";
  for (const change of candidate.proposal.changes) {
    if (change.operation === "CLEAR") continue;
    const evidence = candidate.evidenceIndex.find(e => e.field === change.field)?.evidence;
    if (!evidence?.length) return null;
    const referenceTime = evidence.map(e => result.transcript.find(t => t.id === e.sourceTurnId)?.receivedAt).filter((t): t is string => !!t).sort().at(-1);
    if (!referenceTime) return null;
    Object.assign(result.slots[change.field], { state: "RESOLVED", value: structuredClone(change.value), evidence: structuredClone(evidence), provenance: { kind: "EXPLICIT_USER" }, resolution: { method: "EXPLICIT_OPERAND", version: RESOLUTION_VERSION, referenceTime, timezone: "Asia/Ho_Chi_Minh", dependencies: [] } });
  }
  const facts = SLOT_NAMES.flatMap(field => {
    const slot = result.slots[field];
    if (slot.value === null) return [];
    slot.fact = `f${SLOT_NAMES.indexOf(field) + 1}`;
    return [{ alias: slot.fact, scope: "REMINDER", field, value: slot.value, evidenceSlot: field, provenance: slot.provenance, sourceReferenceTime: slot.resolution!.referenceTime, dependencies: [] }];
  });
  const parsed = ContextSnapshotV1Schema.safeParse({ ...result, facts });
  return parsed.success ? parsed.data : null;
}
function acceptOnce(candidate: Candidate, s: ContextSnapshotV1): Candidate | null {
  const turn = s.transcript.find(t => t.id === s.inbound.id && t.role === "USER");
  if (!turn || !turn.text) return null;
  const firstControl = turn.sourceMap.segments.find(segment => segment.kind === "CONTROL_REPLACEMENT");
  const sourceText = [...turn.text].slice(0, firstControl?.sourceStart).join("").trimEnd();
  const quote = sourceText.normalize("NFC"), n = [...sourceText].length, v = [...quote].length;
  if (!quote || [...turn.semanticView].slice(0, v).join("") !== quote) return null;
  const source: SourceEvidence = { kind: "USER_QUOTE", sourceTurnId: turn.id, sourceMapTurnId: turn.id, quote, occurrence: 1, sourceSpan: { start: 0, end: n }, viewSpan: { start: 0, end: v }, normalizationVersion: "nfc-codepoint-v1" };
  const evidence: EvidenceRef[] = [{ kind: "USER_QUOTE", turn: s.transcript.indexOf(turn), quote, occurrence: 1 }];
  const changes: FieldChange[] = [...candidate.proposal.changes.filter(c => !["frequency", "occurrenceCount", "endDate"].includes(c.field)), { field: "frequency", operation: "SET", value: "ONCE", evidence }];
  return { ...structuredClone(candidate), proposalRevision: candidate.proposalRevision + 1, proposal: { ...candidate.proposal, changes }, evidenceIndex: [...candidate.evidenceIndex.filter(e => !["frequency", "occurrenceCount", "endDate"].includes(e.field)), { field: "frequency", evidence: [source] }] };
}

/** Pure state construction; crypto hashes are deterministic and perform no IO.
 * Persist this transition before sending reply; then settle via recordDelivery.
 * Only confirmationProof is a handoff to store.confirm, never a success claim. */
export async function transitionConversation(input: TransitionInput): Promise<ConversationTransition> {
  const prior = input.snapshot;
  if (input.failure && !input.received) return fail(input.failure);
  if (!Number.isSafeInteger(input.now) || (prior && !ContextSnapshotV1Schema.safeParse(prior).success)) return fail("CONTEXT");
  if (prior && Date.parse(expiry(prior)) <= input.now) return fail("EXPIRED");
  const patch = input.interpretation;
  if (patch && !isValidatedPatch(patch)) return fail("SEMANTIC");
  const received = input.received ?? patch?.candidateSnapshot;
  if (!received || !ContextSnapshotV1Schema.safeParse(received).success || (prior && (received.id !== prior.id || !equal(received.scope, prior.scope)))
    || (prior && (received.contextRevision !== prior.contextRevision || received.requestId !== prior.requestId || received.draftRevision !== prior.draftRevision))
    || Date.parse(received.inbound.receivedAt) > input.now) return fail("CONTEXT");
  let s = structuredClone(received), preview: CanonicalPreview | null = null, proof: DecisionProof | undefined;
  let terminal: StoredTransition["terminal"] = null;
  const revision = (prior?.contextRevision ?? 0) + 1;
  const seed = await digest([s.scope.ownerId, s.scope.chatIdentityId, s.id, s.inbound.id, revision]);
  const outboundId = `out-${seed}`, decisionId = `decision-${seed}`, token = `CN-${seed.slice(0, 20)}`;
  const proposalId = `proposal-${seed}`;
  let outcome: ReplyOutcome | null = null;
  let guidance = input.guidance;
  const suspendOffer = () => {
    const retained = s.pendingDecision?.candidate ? structuredClone(s.pendingDecision) : null;
    clearDecision(s);
    if (retained) {
      // Keep the offered facts without an approvable question. The old
      // questionId intentionally cannot match this notice's delivery receipt.
      retained.contextRevision = revision; retained.deliveryState = "UNCERTAIN";
      retained.replyReference = null; retained.tokenHandle = null;
      s.pendingDecision = retained;
    }
  };
  const issue = (kind: PendingDecision["kind"], candidate: Candidate | null = null) => {
    clearDecision(s);
    s.pendingDecision = { decisionId, kind, target: { ownerId: s.scope.ownerId, chatIdentityId: s.scope.chatIdentityId, chatId: s.scope.chatId, requestId: s.requestId, proposalId: candidate?.proposalId ?? null }, questionId: outboundId, previewId: null, draftRevision: s.draftRevision, contextRevision: revision, issuedAfterInbound: { receivedAt: s.inbound.receivedAt, rowid: s.inbound.rowid }, deliveryState: "UNCERTAIN", expiresAt: new Date(Math.min(Date.parse(expiry(s)), candidate ? Date.parse(candidate.expiresAt) : Infinity)).toISOString(), acceptedReplies: ["có", "ok", "1"], replyReference: null, tokenHandle: token, candidate };
    outcome = { kind: "DECISION", decisionKind: kind, token, facts: candidate ? candidate.proposal.changes.filter(c => c.value !== null).map(c => formatPendingFact(c.field, c.value)) : recap(s) };
  };
  const control = input.control;
  if (input.failure) { clearDecision(s); outcome = { kind: "FAILURE", reason: input.failure }; }
  else if (control.kind !== "NONE") {
    if (!prior || !input.authority || input.authority.kind !== "CHAT") return fail("STALE");
    const inbound = s.transcript.find(t => t.id === s.inbound.id && t.role === "USER");
    if (!inbound || input.authority.scope.sourceInboundId !== s.inbound.id || input.authority.scope.claimMarker !== s.inbound.claimMarker) return fail("STALE");
    const selected = selectControl(inbound.text, prior.pendingDecision, input.authority, { snapshot: prior, now: input.now, replyReference: control.kind === "APPROVE" && control.response.kind === "REPLY" ? control.response.reference : null });
    if (!equal(selected, control)) return fail("STALE");
    if (control.kind === "AMBIGUOUS_TARGET") { suspendOffer(); outcome = { kind: "NOTICE", notice: "AMBIGUOUS_TARGET" }; }
    else if (control.kind === "ABANDON") { clearDecision(s); terminal = "CANCELLED"; s.lifecycle = "CANCELLED"; outcome = { kind: "NOTICE", notice: "ABANDONED" }; }
    else if (control.kind === "DECLINE") { clearDecision(s); outcome = { kind: "NOTICE", notice: "DECLINED" }; }
    else {
      const d = prior.pendingDecision!;
      if (Date.parse(s.inbound.receivedAt) < Date.parse(d.issuedAfterInbound.receivedAt) || (Date.parse(s.inbound.receivedAt) === Date.parse(d.issuedAfterInbound.receivedAt) && s.inbound.rowid <= d.issuedAfterInbound.rowid)) return fail("STALE");
      proof = { operationKey: `operation-${seed}`, contextId: prior.id, contextRevision: prior.contextRevision, decisionId: d.decisionId, kind: d.kind, requestId: d.target.requestId, proposalId: d.target.proposalId, draftRevision: d.draftRevision, draftHash: prior.previewReceipt?.draftHash ?? null, response: control.response };
      if (!validDecision(prior, proof, input.authority, input.now)) return fail("STALE");
      if (d.kind === "SAVE_PREVIEW") return { ...replyOnly({ kind: "NOTICE", notice: "CHECKING" }), confirmationProof: proof };
      clearDecision(s);
      if (d.kind === "RESTART_PENDING") { terminal = "CANCELLED"; s.lifecycle = "CANCELLED"; outcome = { kind: "NOTICE", notice: "RESTARTED" }; }
      else if (d.kind === "REPLACE_PENDING" || d.kind === "ACCEPT_ONE_TIME_ALTERNATIVE") {
        const candidate = d.kind === "ACCEPT_ONE_TIME_ALTERNATIVE" && d.candidate ? acceptOnce(d.candidate, s) : d.candidate;
        if (!candidate) return fail("CONTEXT");
        if (d.kind === "ACCEPT_ONE_TIME_ALTERNATIVE" && prior.requestId) issue("REPLACE_PENDING", candidate);
        else { const adopted = adoptCandidate(s, candidate); if (!adopted) return fail("CONTEXT"); s = adopted; }
      }
      // RESUME_PENDING falls through to fresh resolution/question issuance.
    }
  } else if (patch) {
    if (patch.proposal.dialogueAct === "ABANDON_PENDING") { suspendOffer(); outcome = { kind: "NOTICE", notice: "ESCAPE_REQUIRED" }; }
    else {
      const merge = input.merge ?? mergePatch(prior, patch);
      if (merge.status === "REJECTED") {
        if (merge.reason === "AMBIGUOUS_OPERATION" && prior?.requestId) issue("RESUME_PENDING");
        else {
          if (merge.reason !== "REPLACEMENT_REQUIRED") return fail("SEMANTIC", merge.reason);
          const candidate = candidateFromPatch(patch, proposalId);
          if (!candidate) return fail("SEMANTIC", "CANDIDATE_EVIDENCE");
          const adopted = adoptCandidate(s, candidate);
          if (!adopted) return fail("CONTEXT");
          const resolution = resolveRequest(adopted, input.now, lunarCalendar);
          if (resolution.status === "UNSUPPORTED" && resolution.capability !== "YEARLY") { clearDecision(s); outcome = { kind: "UNSUPPORTED", capability: resolution.capability }; }
          else issue(resolution.status === "UNSUPPORTED" ? "ACCEPT_ONE_TIME_ALTERNATIVE" : "REPLACE_PENDING", candidate);
        }
      } else {
        s = structuredClone(merge.candidate);
        clearDecision(s);
        if (merge.query) {
          const qr = input.queryResolution ?? resolveQuery(merge.query, Date.parse(merge.queryReferenceTime!), lunarCalendar);
          const effective = computeEffectiveDirective({ semantic: patch, merge: { ...merge, candidate: s }, queryResolution: qr, queryResult: input.queryResult });
          if (effective.kind === "ASK_FOR_FIELD" || effective.kind === "ASK_FOR_DISAMBIGUATION") {
            const fallback = selectGuidance({ effectiveDirective: effective, directiveValidation: { status: "INVALID", reason: "DIRECTIVE_INVALID" }, replyProposal: { status: "VALID", value: null }, privacyValidation: { status: "VALID" }, language: "vi" });
            const field = effective.field === "queryRange" ? "queryRange" : "intent";
            outcome = { kind: "QUESTION", question: fallback.text!, facts: [], field };
            s.pendingQueryQuestion = { scope: "QUERY", field, questionId: outboundId, text: fallback.text!, decisionKind: null, reason: effective.kind === "ASK_FOR_FIELD" ? "MISSING" : effective.reason, noProgressCount: 0, deliveryState: "UNCERTAIN", issuedAfterOrder: { receivedAt: s.inbound.receivedAt, rowid: s.inbound.rowid } };
          } else if (effective.kind === "ANSWER_QUERY") { s.pendingQueryQuestion = null; outcome = { kind: "QUERY", resolution: qr, result: input.queryResult, titles: input.queryTitles }; }
          else outcome = { kind: "FAILURE", reason: input.queryResult && input.queryResult.status !== "RESULTS" ? "PROVIDER" : "SEMANTIC" };
        } else if (patch.proposal.intent === "HELP") outcome = { kind: "NOTICE", notice: "HELP" };
        else if (patch.proposal.intent === "UNSUPPORTED") outcome = { kind: "UNSUPPORTED", capability: "ASSISTANT_SCOPE" };
      }
    }
  } else { clearDecision(s); outcome = { kind: "NOTICE", notice: "RESUME" }; }

  if (!outcome) {
    const resolution = (patch ? input.resolution : undefined) ?? resolveRequest(s, input.now, lunarCalendar);
    if (resolution.status === "UNSUPPORTED") {
      if (resolution.capability === "YEARLY" && patch && !prior?.requestId) {
        const candidate = candidateFromPatch(patch, proposalId);
        if (!candidate) return fail("SEMANTIC", "CANDIDATE_EVIDENCE");
        s = structuredClone(received); issue("ACCEPT_ONE_TIME_ALTERNATIVE", candidate);
      } else { if (prior?.requestId) { s = structuredClone(received); clearDecision(s); } outcome = { kind: "UNSUPPORTED", capability: resolution.capability }; }
    } else {
      const merged: MergeResult = { status: "MERGED", candidate: s, changedFields: [], uncertainties: s.ambiguities, query: null, queryReferenceTime: null };
      const localField = resolution.status === "CLARIFY" ? SLOT_NAMES.find(f => f === resolution.fields[0]) : undefined;
      if (!patch && resolution.status === "CLARIFY" && !localField) return fail("SEMANTIC", "UNKNOWN_DIRECTIVE");
      const effective = patch ? computeEffectiveDirective({ semantic: patch, merge: merged, resolution }) : resolution.status === "READY" ? { kind: "PRESENT_PREVIEW" as const } : { kind: "ASK_FOR_FIELD" as const, field: localField! };
      if (effective.kind === "PRESENT_PREVIEW" && resolution.status === "READY") {
        if (!input.channel) return fail("CONFIG", "PREVIEW_CHANNEL_REQUIRED");
        s.slots = structuredClone(resolution.resolvedSlots); s.facts = structuredClone(resolution.resolvedFacts);
        if (prior?.requestId === s.requestId && !equal(prior.slots, s.slots)) s.draftRevision = (prior.draftRevision ?? 0) + 1;
        const suffix = `\nXác nhận ${token}\nTrả lời 2 để từ chối.`;
        preview = { schemaVersion: "calenote-context-preview-1", title: s.slots.title.value!, details: resolution.details, occurrences: resolution.occurrences, prefix: "Bản nháp chưa lưu:\n", suffix };
        issue("SAVE_PREVIEW"); s.lifecycle = "AWAITING_CONFIRMATION"; s.pendingReminderQuestion = null; s.pendingQueryQuestion = null;
        s.pendingDecision!.previewId = outboundId; s.pendingDecision!.acceptedReplies = ["có", "ok", "1", "xác nhận"];
        s.pendingDecision!.target.proposalId = resolution.occurrences.length > 1 ? proposalId : null;
        s.previewReceipt = { previewId: outboundId, requestId: s.requestId!, draftRevision: s.draftRevision!, draftHash: await previewHash(preview), ownerId: s.scope.ownerId, chatIdentityId: s.scope.chatIdentityId, chatId: s.scope.chatId, channel: input.channel, issuedAfterOrder: { receivedAt: s.inbound.receivedAt, rowid: s.inbound.rowid }, expiresAt: expiry(s), deliveryState: "UNCERTAIN", replyReference: null };
        outcome = { kind: "PREVIEW", preview, token };
      } else if (effective.kind === "ASK_FOR_FIELD" || effective.kind === "ASK_FOR_DISAMBIGUATION") {
        const fallback = selectGuidance({ effectiveDirective: effective, directiveValidation: { status: "INVALID", reason: "DIRECTIVE_INVALID" }, replyProposal: { status: "VALID", value: null }, privacyValidation: { status: "VALID" }, language: "vi" });
        const field = effective.field;
        if (field === "queryRange") return fail("SEMANTIC");
        const previousQuestion = prior?.pendingReminderQuestion;
        const progressed = !prior || !equal(prior.slots, s.slots) || !equal(prior.ambiguities, s.ambiguities);
        const count = !progressed && previousQuestion?.field === field ? Math.min(3, previousQuestion.noProgressCount + 1) : 0;
        const reason = effective.kind === "ASK_FOR_FIELD" ? "MISSING" : effective.reason;
        s.pendingReminderQuestion = { scope: "REMINDER", field, questionId: outboundId, text: fallback.text!, decisionKind: null, reason, noProgressCount: count, deliveryState: "UNCERTAIN", issuedAfterOrder: { receivedAt: s.inbound.receivedAt, rowid: s.inbound.rowid } };
        const alternatives = s.ambiguities.find(u => u.field === field)?.alternatives.map(a => formatPendingFact(field, a.value));
        if (count >= 2) {
          if (count === 3) { issue("RESTART_PENDING"); s.pendingReminderQuestion!.decisionKind = "RESTART_PENDING"; }
          outcome = { kind: "RECOVERY", count: count as 2 | 3, question: fallback.text!, facts: recap(s), ...(count === 3 ? { token } : {}) }; guidance = undefined;
        } else outcome = { kind: "QUESTION", field, question: fallback.text!, facts: recap(s), alternatives };
      } else if (effective.kind === "EXPLAIN_UNSUPPORTED") outcome = { kind: "UNSUPPORTED", capability: effective.issue };
      else return fail("SEMANTIC", "UNKNOWN_DIRECTIVE");
    }
  }
  if (!outcome) return fail("SEMANTIC");
  const reply = composeContextReply(outcome, guidance);
  if (reply.status !== "READY") return fail("SIZE", reply.status);
  const questionSpan = reply.spans.find(span => span.kind === "QUESTION");
  if (questionSpan) {
    const selectedQuestion = reply.text.slice(questionSpan.start, questionSpan.end);
    if (s.pendingReminderQuestion?.questionId === outboundId) s.pendingReminderQuestion.text = selectedQuestion;
    if (s.pendingQueryQuestion?.questionId === outboundId) s.pendingQueryQuestion.text = selectedQuestion;
  }
  s.contextRevision = revision;
  if (s.pendingDecision?.tokenHandle) s.controlRegistry.push({ handle: s.pendingDecision.tokenHandle, kind: "TOKEN", ownerId: s.scope.ownerId, chatIdentityId: s.scope.chatIdentityId, chatId: s.scope.chatId, decisionId: s.pendingDecision.decisionId, contextRevision: revision, draftRevision: s.draftRevision, expiresAt: s.pendingDecision.expiresAt });
  const projected = projectSemanticView(reply.text, s.controlRegistry.map(c => c.handle));
  if (projected.status !== "READY") return fail("SIZE");
  s.transcript.push({ id: outboundId, text: reply.text, semanticView: projected.text, controlSpans: projected.controlSpans, sourceMap: projected.sourceMap, role: "ASSISTANT", kind: reply.kind, deliveryState: "UNCERTAIN", messageRef: null, receivedAt: s.inbound.receivedAt });
  // Only assistant turns can be removed here: never discard user evidence.
  // Internal quote indices must follow that lossless transcript compaction.
  const oldTurns = s.transcript.map(t => t.id);
  while (s.transcript.filter(t => t.role === "ASSISTANT").length > 6) s.transcript.splice(s.transcript.findIndex(t => t.role === "ASSISTANT"), 1);
  const remap = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(remap);
    if (!value || typeof value !== "object") return value;
    if ("kind" in value && value.kind === "USER_QUOTE" && "turn" in value && typeof value.turn === "number") return { ...value, turn: s.transcript.findIndex(t => t.id === oldTurns[value.turn as number]) };
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, remap(child)]));
  };
  const parsed = ContextSnapshotV1Schema.safeParse(remap(s));
  if (!parsed.success) return fail("CONTEXT", "TRANSITION_STATE_INVALID");
  if (new TextEncoder().encode(encodeContextSnapshot(parsed.data)).byteLength > 16384) return fail("SIZE", "CONTEXT_SNAPSHOT_TOO_LARGE");
  return { expectedContextRevision: prior?.contextRevision ?? null, expectedDraftRevision: prior?.draftRevision ?? null, snapshot: parsed.data, preview, terminal, inboundOutcome: "PROCESSED", ...(proof ? { decisionProof: proof } : {}), reply };
}

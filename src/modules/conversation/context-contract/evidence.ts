import { evidenceContextFor, type BoundContextFact, type ReadyContext } from "./context";
import { SemanticPatchProposalSchema, FieldChangeSchema, QueryOperandSchema, UncertaintySchema, SLOT_NAMES, type SemanticPatchProposal, type EvidenceRef, type FieldChange, type QueryOperand, type ContextInput } from "./contracts";
import type { ContextObservation, ContextSnapshotV1, SourceEvidence, SlotProvenance } from "./state";
import { containsForbiddenControl, containsForbiddenGuidanceMaterial } from "./projection";
import { verifyListRangeEvidence } from "./list-range-evidence";
import { observeDownstream, evidenceReason, type DownstreamObserver } from "./downstream";
const validatedPatchBrand: unique symbol = Symbol("ValidatedPatch");
type EvidenceProvenance = SlotProvenance | ContextInput["facts"][number]["provenance"];
export interface ValidatedFieldEvidence {
  field: string;
  sources: readonly SourceEvidence[];
  current: boolean;
  provenance: EvidenceProvenance;
  referenceTime: string;
}
export type ValidatedPatch = {
  readonly [validatedPatchBrand]: true;
  /** The validated provider representation, never the operands to persist. */
  readonly proposal: SemanticPatchProposal;
  /** Backend values restore exact accepted facts only after alias validation. */
  readonly resolvedChanges: readonly FieldChange[];
  readonly resolvedQuery: QueryOperand | null;
  readonly resolvedUncertainties: SemanticPatchProposal["uncertainties"];
  readonly queryReferenceTime: string | null;
  readonly changeEvidence: readonly ValidatedFieldEvidence[];
  readonly queryEvidence: readonly SourceEvidence[];
  readonly controlEvidence: readonly SourceEvidence[];
  readonly alternativeEvidence: readonly ValidatedFieldEvidence[];
  readonly observation: ContextObservation;
  readonly candidateSnapshot: ContextSnapshotV1;
};
export type EvidenceValidation = { status: "VALID"; patch: ValidatedPatch } | { status: "REFUSED"; reason: string };
const issuedPatches = new WeakSet<object>();
export function isValidatedPatch(value: unknown): value is ValidatedPatch { return typeof value === "object" && value !== null && issuedPatches.has(value); }
class EvidenceFailure extends Error {}
const fail = (reason: string): never => { throw new EvidenceFailure(reason); };
const equal = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const operand = (v: unknown): unknown => v && typeof v === "object" ? Array.isArray(v) ? v.map(operand) : Object.fromEntries(Object.entries(v).filter(([k]) => k !== "evidence").map(([k, x]) => [k, operand(x)])) : v;
function freeze<T>(value: T): T { if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
type ResolvedEvidence = ValidatedFieldEvidence & { resolvedValue: unknown };
function evidenceMetadata(resolved: ResolvedEvidence): ValidatedFieldEvidence {
  return {
    field: resolved.field, sources: resolved.sources, current: resolved.current,
    provenance: resolved.provenance, referenceTime: resolved.referenceTime,
  };
}

function needsTemporalAnchor(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const object = value as Record<string, unknown>;
  if (["RELATIVE_DAY", "WEEKDAY", "WEEK", "MONTH", "WEEKEND", "REST_OF_MONTH", "NEXT_7_DAYS", "UPCOMING"].includes(String(object.kind))) return true;
  if (object.kind === "CIVIL_DATE" && object.year === null) return true;
  return Object.values(object).some(needsTemporalAnchor);
}

/** Select authority over the whole evidence set, never by model array order. */
function selectReferenceTime(facts: readonly BoundContextFact[], quotes: readonly SourceEvidence[], requested: unknown, built: ReadyContext, editsExistingOperand: boolean): string {
  if (facts.length) {
    const anchors = new Set(facts.map(f => f.referenceTime));
    if (anchors.size !== 1) return fail("EVIDENCE_ANCHOR_CONFLICT");
    return facts[0].referenceTime;
  }
  const currentId = built.evidenceIndex[built.input.currentTurn].id;
  const hasCurrentSource = quotes.some(q => q.sourceTurnId === currentId);
  // A grounded EDIT of an existing operand makes the current source
  // authoritative. Incidental quotes never override exact fact reuse above.
  if (editsExistingOperand && hasCurrentSource) return built.input.reference.instant;
  const receipts = [...new Set(quotes.map(q => built.evidenceIndex.find(t => t.id === q.sourceTurnId)!.receivedAt))].sort();
  const localDays = new Set(receipts.map(at => new Date(Date.parse(at) + 7 * 3600000).toISOString().slice(0, 10)));
  if (needsTemporalAnchor(requested) && localDays.size > 1) return fail("EVIDENCE_ANCHOR_CONFLICT");
  return hasCurrentSource ? built.input.reference.instant
    : receipts[0] ?? built.input.reference.instant;
}

/** Whole-patch authority validation. This proves exact source/scope and edit
 * freshness, not general natural-language entailment or user confirmation. */
export function validateEvidence(proposal: unknown, built: ReadyContext, observe?: DownstreamObserver): EvidenceValidation {
  const refused = (reason: string): EvidenceValidation => {
    observeDownstream(observe, { stage: "EVIDENCE", result: "REJECTED", reason: evidenceReason(reason) });
    observeDownstream(observe, { stage: "PATCH", result: "REJECTED", reason: "PATCH_REJECTED" });
    return { status: "REFUSED", reason };
  };
  const internal = evidenceContextFor(built);
  if (!internal) return refused("CONTEXT_NOT_BUILT");
  const parsed = SemanticPatchProposalSchema.safeParse(proposal);
  if (!parsed.success) return refused("PROPOSAL_SCHEMA_INVALID");
  if (containsForbiddenControl(parsed.data, internal.handles)) return refused("CONTROL_IN_PROPOSAL");
  const value = parsed.data;
  const quoteSource = (ref: Extract<EvidenceRef, { kind: "USER_QUOTE" }>): SourceEvidence => {
    const turn = built.evidenceIndex[ref.turn];
    if (!turn || turn.role !== "USER") return fail("EVIDENCE_NOT_USER");
    let at = -1, from = 0;
    for (let count = 0; count < ref.occurrence; count++) {
      at = turn.semanticView.indexOf(ref.quote, from);
      if (at < 0) return fail("EVIDENCE_QUOTE_NOT_FOUND");
      from = at + ref.quote.length;
    }
    const start = [...turn.semanticView.slice(0, at)].length, end = start + [...ref.quote].length;
    const segments = turn.sourceMap.segments.filter(s => s.viewStart < end && s.viewEnd > start);
    if (!segments.length || segments.some(s => s.kind === "CONTROL_REPLACEMENT")) return fail("EVIDENCE_REMOVED_SPAN");
    const mapBoundary = (point: number, side: "start" | "end") => {
      const s = side === "start" ? segments[0] : segments.at(-1)!;
      const offset = point - s.viewStart;
      if (offset % s.viewStride !== 0) return fail("EVIDENCE_NORMALIZATION_BOUNDARY");
      return s.sourceStart + offset / s.viewStride * s.sourceStride;
    };
    const sourceStart = mapBoundary(start, "start"), sourceEnd = mapBoundary(end, "end");
    if ([...turn.text].slice(sourceStart, sourceEnd).join("").normalize("NFC") !== ref.quote) return fail("EVIDENCE_SOURCE_MISMATCH");
    return { kind: "USER_QUOTE", sourceTurnId: turn.id, sourceMapTurnId: turn.id, quote: ref.quote, occurrence: ref.occurrence, sourceSpan: { start: sourceStart, end: sourceEnd }, viewSpan: { start, end }, normalizationVersion: "nfc-codepoint-v1" };
  };
  const resolve = (refs: EvidenceRef[], scope: "REMINDER" | "QUERY" | "CONTROL", field: string, requested: unknown, editsExistingOperand = false, listRangeCandidate = false): ResolvedEvidence => {
    const quotes: SourceEvidence[] = [];
    const factBindings: BoundContextFact[] = [];
    for (const ref of refs) {
      if (ref.kind === "USER_QUOTE") {
        quotes.push(quoteSource(ref));
      } else {
        const binding = internal.facts.get(ref.ref);
        if (!binding || binding.supplied.scope !== scope || binding.supplied.field !== field || !equal(operand(binding.supplied.value), operand(requested))) return fail("EVIDENCE_FACT_SCOPE_OR_VALUE");
        factBindings.push(binding);
      }
    }
    const firstFact = factBindings[0];
    if (factBindings.some(f => !equal(operand(f.internal.value), operand(firstFact.internal.value)))) fail("EVIDENCE_FACT_VALUE_CONFLICT");
    const resolvedValue = firstFact ? firstFact.internal.value : requested;
    // Placeholders are not user facts. Only an exact alias-bound reuse may
    // contain a supplied placeholder, and its internal value is preserved.
    if (!firstFact && JSON.stringify(requested)?.includes("[CONTROL]")) fail("EVIDENCE_PLACEHOLDER_VALUE");
    const current = refs.some(ref => ref.kind === "USER_QUOTE" && ref.turn === built.input.currentTurn);
    let provenance: EvidenceProvenance = { kind: "EXPLICIT_USER" };
    if (firstFact?.internal.scope === "REMINDER") {
      const slot = internal.snapshot?.slots[firstFact.internal.field];
      if (!slot || slot.state !== "RESOLVED" || !equal(slot.value, firstFact.internal.value) || !slot.provenance) return fail("EVIDENCE_FACT_INVALID");
      provenance = slot.provenance;
    } else if (firstFact) provenance = firstFact.internal.provenance;
    const referenceTime = selectReferenceTime(factBindings, quotes, requested, built, editsExistingOperand);
    const sources = [...factBindings.flatMap(f => f.sources), ...quotes];
    const distinct = sources.filter((source, i) => sources.findIndex(other => equal(source, other)) === i);
    distinct.sort((a, b) => built.evidenceIndex.findIndex(t => t.id === a.sourceTurnId) - built.evidenceIndex.findIndex(t => t.id === b.sourceTurnId) || a.sourceSpan.start - b.sourceSpan.start || a.sourceSpan.end - b.sourceSpan.end);
    if (distinct.length > 3) return fail("EVIDENCE_SOURCE_LIMIT");
    // Lexical presence only, not a second date parser: an unstated year must
    // remain null for the deterministic year policy. Exact fact reuse retains
    // its existing explicit/derived provenance.
    const checkYear = (v: unknown): void => {
      if (!v || typeof v !== "object") return;
      const object = v as Record<string, unknown>;
      if (object.kind === "CIVIL_DATE" && typeof object.year === "number" && !refs.some(e => e.kind === "CONTEXT_FACT") && !distinct.some(s => new RegExp(`(?:^|[^0-9])${object.year}(?:$|[^0-9])`, "u").test(s.quote))) fail("YEAR_NOT_EXPLICIT");
      Object.values(object).forEach(checkYear);
    };
    // LIST range authority belongs to its deterministic verifier after exact
    // quote/fact identity validation above. An ungrounded optional year must
    // reach that verifier so it can discard the range while retaining intent.
    // Reminder and calendar operands keep the existing explicit-year gate.
    if (!listRangeCandidate) checkYear(requested);
    return { field, sources: distinct, current, provenance, referenceTime, resolvedValue };
  };
  try {
    const resolvedChanges: FieldChange[] = [];
    const changeEvidence = value.changes.map(change => {
      const old = internal.snapshot?.slots[change.field].value ?? null;
      const evidence = resolve(change.evidence, "REMINDER", change.field, change.value, old !== null && value.dialogueAct === "EDIT");
      const resolved = FieldChangeSchema.parse({ ...change, value: evidence.resolvedValue });
      if ((resolved.operation === "CLEAR" || (old !== null && !equal(old, resolved.value))) && !evidence.current) fail("CURRENT_USER_EVIDENCE_REQUIRED");
      if (resolved.field === "notes" && resolved.operation === "SET" && typeof old === "string" && !resolved.value.includes(old) && (value.dialogueAct !== "EDIT" || !evidence.current)) fail("NOTES_LOSS_REQUIRES_CLARIFICATION");
      resolvedChanges.push(resolved);
      return evidenceMetadata(evidence);
    });
    const query = value.query ? resolve(value.query.evidence, "QUERY", "queryRange", value.query, false, value.query.kind === "LIST") : null;
    if (query && !query.current && !value.query!.evidence.some(e => e.kind === "CONTEXT_FACT")) fail("CURRENT_USER_EVIDENCE_REQUIRED");
    let resolvedQuery = query ? QueryOperandSchema.parse(query.resolvedValue) : null;
    if (resolvedQuery?.kind !== "LIST" || !resolvedQuery.period) observeDownstream(observe, { stage: "LIST_RANGE", result: resolvedQuery?.kind === "LIST" ? "UNSPECIFIED" : "NOT_APPLICABLE", reason: "NONE" });
    let rangeIssue: SemanticPatchProposal["uncertainties"][number] | null = null;
    if (resolvedQuery?.kind === "LIST" && resolvedQuery.period) {
      const inherited = value.query!.evidence.some(e => e.kind === "CONTEXT_FACT");
      const scopedContinuation = built.input.pendingQuestion?.scope === "QUERY" && built.input.pendingQuestion.field === "queryRange" && value.continuation === "YES" && ["CONTINUE", "EDIT"].includes(value.dialogueAct);
      const support = inherited && !scopedContinuation ? "UNSUPPORTED" : verifyListRangeEvidence({ candidateRange: resolvedQuery.period, evidence: query!.sources, turns: built.evidenceIndex, currentTurnId: built.evidenceIndex[built.input.currentTurn].id, referenceTime: query!.referenceTime });
      observeDownstream(observe, { stage: "LIST_RANGE", result: support, reason: "NONE", candidateRange: resolvedQuery.period.kind, field: "queryRange" });
      if (support !== "SUPPORTED") {
        resolvedQuery = { ...resolvedQuery, period: null };
        rangeIssue = { field: "queryRange", reason: support === "AMBIGUOUS" ? "AMBIGUOUS" : "MISSING", alternatives: [] };
      }
    }
    const control = resolve(value.controlEvidence, "CONTROL", "operation", value.dialogueAct);
    if (value.controlEvidence.length && !control.current) fail("CURRENT_USER_EVIDENCE_REQUIRED");
    const alternativeEvidence: ValidatedFieldEvidence[] = [];
    let resolvedUncertainties = value.uncertainties.map(uncertainty => {
      const scope = uncertainty.field === "queryRange" ? "QUERY"
        : SLOT_NAMES.includes(uncertainty.field as typeof SLOT_NAMES[number]) ? "REMINDER" : "CONTROL";
      const alternatives = uncertainty.alternatives.map(alternative => {
        const resolved = resolve(alternative.evidence, scope, uncertainty.field, alternative.value);
        alternativeEvidence.push(evidenceMetadata(resolved));
        return { ...alternative, value: resolved.resolvedValue };
      });
      return UncertaintySchema.parse({ ...uncertainty, alternatives });
    });
    if (rangeIssue) resolvedUncertainties = [...resolvedUncertainties.filter(u => u.field !== "queryRange"), rangeIssue];
    const patch: ValidatedPatch = freeze({
      [validatedPatchBrand]: true as const,
      proposal: value,
      resolvedChanges,
      resolvedQuery,
      resolvedUncertainties,
      queryReferenceTime: query?.referenceTime ?? null,
      changeEvidence,
      queryEvidence: query?.sources ?? [],
      controlEvidence: control.sources,
      alternativeEvidence,
      observation: built.observation,
      candidateSnapshot: built.candidateSnapshot,
    });
    issuedPatches.add(patch);
    observeDownstream(observe, { stage: "EVIDENCE", result: "PASS", reason: "NONE" });
    observeDownstream(observe, { stage: "PATCH", result: "PASS", reason: "NONE" });
    return { status: "VALID", patch };
  } catch (error) { return refused(error instanceof EvidenceFailure ? error.message : "EVIDENCE_INVALID"); }
}

export type GuidancePrivacyValidation = { status: "VALID" } | { status: "REFUSED"; reason: "GUIDANCE_PRIVACY" | "CONTEXT_NOT_BUILT" };
/** Privacy only: never a semantic/directive approval or a redacted sendable reply. */
export function validateGuidancePrivacy(proposal: unknown, built: ReadyContext): GuidancePrivacyValidation {
  const internal = evidenceContextFor(built);
  if (!internal) return { status: "REFUSED", reason: "CONTEXT_NOT_BUILT" };
  const state = built.candidateSnapshot, decision = state.pendingDecision;
  const protectedValues = [
    ...internal.handles, ...Object.values(built.observation.scope), built.observation.inbound.id, built.observation.inbound.claimMarker, state.id, state.requestId,
    state.inbound.id, state.inbound.claimMarker, decision?.decisionId, decision?.questionId, decision?.previewId, decision?.replyReference, decision?.tokenHandle, decision?.target.proposalId,
    decision?.candidate?.proposalId, state.previewReceipt?.previewId, state.previewReceipt?.replyReference, state.previewReceipt?.draftHash,
    state.pendingReminderQuestion?.questionId, state.pendingQueryQuestion?.questionId,
    ...state.transcript.flatMap(t => [t.id, t.messageRef]), ...state.controlRegistry.map(c => c.decisionId),
    ...(state.modelAttemptBinding ? Object.values(state.modelAttemptBinding).filter(v => typeof v === "string") : []),
    ...[built.observation.lastTerminalOutcome, state.lastTerminalOutcome].flatMap(terminal => terminal ? [terminal.outcomeId, terminal.contextId, terminal.inboundId] : []),
  ].filter((s): s is string => typeof s === "string" && s.length > 0);
  const object = proposal && typeof proposal === "object" ? proposal as Record<string, unknown> : {};
  return containsForbiddenGuidanceMaterial([object.conversationDirective, object.replyProposal], protectedValues)
    ? { status: "REFUSED", reason: "GUIDANCE_PRIVACY" } : { status: "VALID" };
}

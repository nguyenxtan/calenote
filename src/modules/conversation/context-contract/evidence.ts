import { evidenceContextFor, type BoundContextFact, type ReadyContext } from "./context";
import { LegacyV2SemanticPatchProposalSchema as SemanticPatchProposalSchema, LegacyV2FieldChangeSchema as FieldChangeSchema, QueryOperandSchema, LegacyV2UncertaintySchema as UncertaintySchema, SLOT_NAMES, type LegacyV2SemanticPatchProposal as SemanticPatchProposal, type EvidenceRef, type LegacyV2FieldChange as FieldChange, type QueryOperand, type LegacyV2ContextInput as ContextInput } from "./contracts";
import type { ContextObservation, ContextSnapshotV1, SourceEvidence, SlotProvenance } from "./state";
import { containsForbiddenControl, containsForbiddenGuidanceMaterial } from "./projection";
import { explicitListPeriod, verifyListRangeEvidence } from "./list-range-evidence";
import { supportsEventRelation, type EventRelation } from "./event-relation-evidence";
import { observeDownstream, evidenceReason, type DownstreamObserver, type EvidenceFailureDiagnostic } from "./downstream";
import { createHash } from "node:crypto";
import { classifyQuoteMismatch } from "./quote-classification";
import { supportsLeadOffset } from "./lead-offset-evidence";
import { locationCoverageComplete, titleCoverageComplete } from "./semantic-completeness";
import { extractTemporalEvidence } from "../../semantic/temporal-evidence";
import { supportsCadenceOperand, leadDistanceCovered } from "./cadence-count-evidence";
import { evidenceContextForV2, type ReadyContextV2 } from "./context";
import { SemanticPatchProposalV3Schema, FieldChangeV3Schema, UncertaintyV3Schema, type SemanticPatchProposalV3, type FieldChangeV3 } from "./contracts";
import type { ContextSnapshotV2 } from "./state";
const validatedPatchBrand: unique symbol = Symbol("ValidatedPatch");
type EvidenceProvenance = SlotProvenance | ContextInput["facts"][number]["provenance"];
export interface ValidatedFieldEvidence {
  field: string;
  sources: readonly SourceEvidence[];
  current: boolean;
  provenance: EvidenceProvenance;
  referenceTime: string;
  /** Internal resolver proof, never supplied by the model. */
  factBound?: boolean;
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
export function isLegacyV2ValidatedPatch(value: unknown): value is ValidatedPatch { return typeof value === "object" && value !== null && issuedPatches.has(value); }
class EvidenceFailure extends Error {}
const fail = (reason: string): never => { throw new EvidenceFailure(reason); };
const equal = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const operand = (v: unknown): unknown => v && typeof v === "object" ? Array.isArray(v) ? v.map(operand) : Object.fromEntries(Object.entries(v).filter(([k]) => k !== "evidence").map(([k, x]) => [k, operand(x)])) : v;
function freeze<T>(value: T): T { if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
type ResolvedEvidence = ValidatedFieldEvidence & { resolvedValue: unknown };
function evidenceMetadata(resolved: ResolvedEvidence): ValidatedFieldEvidence {
  return {
    field: resolved.field, sources: resolved.sources, current: resolved.current,
    provenance: resolved.provenance, referenceTime: resolved.referenceTime, factBound: resolved.factBound,
  };
}

/** Observe the existing resolver's outcome, without re-running a verifier or
 * making any admission decision. Never retain raw evidence or business text. */
function traceLeadOffsetResolution(field: string, refs: EvidenceRef[], requested: unknown,
  path: EvidenceFailureDiagnostic["path"], built: ReadyContext | ReadyContextV2,
  validatorBranch: "LEGACY_V2_RESOLVER" | "V3_RESOLVER", observe: DownstreamObserver | undefined,
  run: () => ResolvedEvidence): ResolvedEvidence {
  if (field !== "leadOffsetDays") return run();
  let resolved: ResolvedEvidence | undefined, failure: unknown;
  try { resolved = run(); return resolved; }
  catch (error) { failure = error; throw error; }
  finally {
    try {
      const code = failure instanceof EvidenceFailure ? failure.message : null;
      const checkedFailure = code === "LEAD_OFFSET_NOT_SUPPORTED";
      const sourceFailure = ["EVIDENCE_NOT_USER", "EVIDENCE_QUOTE_NOT_FOUND", "EVIDENCE_REMOVED_SPAN", "EVIDENCE_NORMALIZATION_BOUNDARY", "EVIDENCE_SOURCE_MISMATCH"].includes(code ?? "");
      const kinds = refs.map(ref => ref.kind);
      // Fact/mixed failures can short-circuit before comparison, or fail a
      // later source after an exact fact comparison. Final error alone cannot
      // distinguish those milestones: report UNKNOWN rather than inventing one.
      const ambiguousFactFailure = !resolved && kinds.includes("CONTEXT_FACT");
      const turns = [...new Set([
        ...refs.flatMap(ref => ref.kind === "USER_QUOTE" ? [ref.turn] : []),
        ...(resolved?.sources ?? []).map(s => built.evidenceIndex.findIndex(t => t.id === s.sourceTurnId)).filter(i => i >= 0),
      ])];
      observeDownstream(observe, {
        stage: "EVIDENCE_BINDING", result: resolved ? "PASS" : "REJECTED", reason: resolved ? "NONE" : evidenceReason(code ?? "EVIDENCE_INVALID"),
        offsetBinding: {
          field: "leadOffsetDays", path, valueType: requested === null ? "null" : "number",
          numericValue: typeof requested === "number" && Number.isSafeInteger(requested) && requested >= 1 && requested <= 366 ? requested : null,
          evidenceKinds: kinds, sourceTurnOrdinals: turns, validatorBranch,
          bindingBranch: kinds.every(k => k === "USER_QUOTE") ? "USER_QUOTE" : kinds.every(k => k === "CONTEXT_FACT") ? "CONTEXT_FACT" : "MIXED",
          sourceIdentityValidated: !!resolved || code === "LEAD_OFFSET_NOT_SUPPORTED",
          fieldValueCheckExecuted: requested === null ? false : ambiguousFactFailure ? null : resolved || checkedFailure ? true : sourceFailure ? false : null,
          fieldValueCheckResult: requested === null ? "NOT_APPLICABLE" : ambiguousFactFailure ? "UNKNOWN" : resolved ? "PASS" : checkedFailure ? "FAIL" : sourceFailure ? "NOT_RUN" : "UNKNOWN",
        },
      });
    } catch { /* Instrumentation never changes return, rejection, or authority. */ }
  }
}

function needsTemporalAnchor(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const object = value as Record<string, unknown>;
  if (["RELATIVE_DAY", "WEEKDAY", "WEEK", "MONTH", "WEEKEND", "REST_OF_MONTH", "NEXT_7_DAYS", "UPCOMING"].includes(String(object.kind))) return true;
  if (object.kind === "CIVIL_DATE" && object.year === null) return true;
  return Object.values(object).some(needsTemporalAnchor);
}

/** Select authority over the whole evidence set, never by model array order. */
function selectReferenceTime(facts: readonly BoundContextFact[], quotes: readonly SourceEvidence[], requested: unknown, built: ReadyContext | ReadyContextV2, editsExistingOperand: boolean): string {
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
export function validateLegacyV2Evidence(proposal: unknown, built: ReadyContext, observe?: DownstreamObserver): EvidenceValidation {
  let evidenceFailure: EvidenceFailureDiagnostic | undefined;
  const refused = (reason: string): EvidenceValidation => {
    observeDownstream(observe, { stage: "EVIDENCE", result: "REJECTED", reason: evidenceReason(reason), ...(evidenceFailure ? { evidenceFailure } : {}) });
    observeDownstream(observe, { stage: "PATCH", result: "REJECTED", reason: "PATCH_REJECTED" });
    return { status: "REFUSED", reason };
  };
  const internal = evidenceContextFor(built);
  if (!internal) return refused("CONTEXT_NOT_BUILT");
  const parsed = SemanticPatchProposalSchema.safeParse(proposal);
  if (!parsed.success) return refused("PROPOSAL_SCHEMA_INVALID");
  if (containsForbiddenControl(parsed.data, internal.handles)) return refused("CONTROL_IN_PROPOSAL");
  const value = parsed.data;
  type Site = Pick<EvidenceFailureDiagnostic, "field" | "path" | "referenceOrdinal">;
  // Failure-only identity telemetry. Hashes never participate in acceptance.
  const traceFailure = (reason: string, code: EvidenceFailureDiagnostic["reason"], ref: EvidenceRef, site: Site, sourceMapStatus: EvidenceFailureDiagnostic["sourceMapStatus"] = "NOT_CHECKED"): never => {
    try {
      const turn = ref.kind === "USER_QUOTE" ? built.evidenceIndex[ref.turn] : undefined;
      let matchCount = 0, from = 0;
      if (ref.kind === "USER_QUOTE" && turn?.role === "USER") {
        for (;;) { const at = turn.semanticView.indexOf(ref.quote, from); if (at < 0) break; matchCount++; from = at + ref.quote.length; }
      }
      const hash = (text: string) => createHash("sha256").update(text.normalize("NFC"), "utf8").digest("hex");
      evidenceFailure = {
        ...site, sourceAlias: ref.kind === "USER_QUOTE" ? `t${ref.turn}` : ref.ref,
        expectedSourceRole: ref.kind === "USER_QUOTE" ? "USER" : "CONTEXT_FACT",
        resolvedSourceRole: ref.kind === "USER_QUOTE" ? turn?.role ?? "UNKNOWN" : internal.facts.has(ref.ref) ? "CONTEXT_FACT" : "UNKNOWN",
        sourceTurnOrdinal: ref.kind === "USER_QUOTE" ? ref.turn : null,
        requestedOccurrence: ref.kind === "USER_QUOTE" ? ref.occurrence : null,
        matchCount: ref.kind === "USER_QUOTE" && turn?.role === "USER" ? matchCount : null,
        quoteBytes: ref.kind === "USER_QUOTE" ? new TextEncoder().encode(ref.quote).length : null,
        quoteCodePoints: ref.kind === "USER_QUOTE" ? [...ref.quote].length : null,
        quoteSha256: ref.kind === "USER_QUOTE" ? hash(ref.quote) : null,
        sourceViewSha256: turn ? hash(turn.semanticView) : null,
        sourceMapStatus, reason: code === "QUOTE_NOT_FOUND" && matchCount > 0 ? "QUOTE_OCCURRENCE_OUT_OF_RANGE" : code,
        ...(ref.kind === "USER_QUOTE" ? { quoteClassification: classifyQuoteMismatch(ref.quote, ref.turn, built.evidenceIndex, built.candidateSnapshot.transcript) } : {}),
      };
    } catch { /* Telemetry must not change the public rejection or authority. */ }
    return fail(reason);
  };
  const quoteSource = (ref: Extract<EvidenceRef, { kind: "USER_QUOTE" }>, site: Site): SourceEvidence => {
    const turn = built.evidenceIndex[ref.turn];
    if (!turn || turn.role !== "USER") return traceFailure("EVIDENCE_NOT_USER", !turn ? "SOURCE_ALIAS_UNKNOWN" : "SOURCE_ROLE_NOT_USER", ref, site);
    let at = -1, from = 0;
    for (let count = 0; count < ref.occurrence; count++) {
      at = turn.semanticView.indexOf(ref.quote, from);
      if (at < 0) return traceFailure("EVIDENCE_QUOTE_NOT_FOUND", "QUOTE_NOT_FOUND", ref, site);
      from = at + ref.quote.length;
    }
    const start = [...turn.semanticView.slice(0, at)].length, end = start + [...ref.quote].length;
    const segments = turn.sourceMap.segments.filter(s => s.viewStart < end && s.viewEnd > start);
    if (!segments.length || segments.some(s => s.kind === "CONTROL_REPLACEMENT")) return traceFailure("EVIDENCE_REMOVED_SPAN", segments.length ? "QUOTE_REMOVED_CONTROL_SPAN" : "QUOTE_SOURCE_MAP_INVALID", ref, site, segments.length ? "REMOVED_CONTROL_SPAN" : "INVALID");
    const mapBoundary = (point: number, side: "start" | "end") => {
      const s = side === "start" ? segments[0] : segments.at(-1)!;
      const offset = point - s.viewStart;
      if (offset % s.viewStride !== 0) return traceFailure("EVIDENCE_NORMALIZATION_BOUNDARY", "QUOTE_NORMALIZATION_MISMATCH", ref, site, "NORMALIZATION_BOUNDARY");
      return s.sourceStart + offset / s.viewStride * s.sourceStride;
    };
    const sourceStart = mapBoundary(start, "start"), sourceEnd = mapBoundary(end, "end");
    if ([...turn.text].slice(sourceStart, sourceEnd).join("").normalize("NFC") !== ref.quote) return traceFailure("EVIDENCE_SOURCE_MISMATCH", "QUOTE_SOURCE_MAP_INVALID", ref, site, "INVALID");
    return { kind: "USER_QUOTE", sourceTurnId: turn.id, sourceMapTurnId: turn.id, quote: ref.quote, occurrence: ref.occurrence, sourceSpan: { start: sourceStart, end: sourceEnd }, viewSpan: { start, end }, normalizationVersion: "nfc-codepoint-v1" };
  };
  const rawResolve = (refs: EvidenceRef[], scope: "REMINDER" | "QUERY" | "CONTROL", field: EvidenceFailureDiagnostic["field"], requested: unknown, path: Site["path"], editsExistingOperand = false, listRangeCandidate = false): ResolvedEvidence => {
    const quotes: SourceEvidence[] = [];
    const factBindings: BoundContextFact[] = [];
    for (const [referenceOrdinal, ref] of refs.entries()) {
      const site = { field, path, referenceOrdinal };
      if (ref.kind === "USER_QUOTE") {
        quotes.push(quoteSource(ref, site));
      } else {
        const binding = internal.facts.get(ref.ref);
        if (!binding || binding.supplied.scope !== scope || binding.supplied.field !== field || !equal(operand(binding.supplied.value), operand(requested))) return traceFailure("EVIDENCE_FACT_SCOPE_OR_VALUE", !binding ? "SOURCE_ALIAS_UNKNOWN" : binding.supplied.scope !== scope ? "SOURCE_SCOPE_MISMATCH" : "EVIDENCE_TARGET_MISMATCH", ref, site);
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
    if (field === "leadOffsetDays" && requested !== null && !firstFact
      && !supportsLeadOffset(requested as number, distinct, built.candidateSnapshot.transcript)) fail("LEAD_OFFSET_NOT_SUPPORTED");
    return { field, sources: distinct, current, provenance, referenceTime, resolvedValue, factBound: !!firstFact };
  };
  const resolve: typeof rawResolve = (...args) => traceLeadOffsetResolution(args[2], args[0], args[3], args[4], built, "LEGACY_V2_RESOLVER", observe, () => rawResolve(...args));
  try {
    const resolvedChanges: FieldChange[] = [];
    const changeEvidence = value.changes.map((change, index) => {
      const old = internal.snapshot?.slots[change.field].value ?? null;
      const evidence = resolve(change.evidence, "REMINDER", change.field, change.value, ["changes", index, "evidence"], old !== null && value.dialogueAct === "EDIT");
      const resolved = FieldChangeSchema.parse({ ...change, value: evidence.resolvedValue });
      if ((resolved.operation === "CLEAR" || (old !== null && !equal(old, resolved.value))) && !evidence.current) fail("CURRENT_USER_EVIDENCE_REQUIRED");
      if (resolved.field === "notes" && resolved.operation === "SET" && typeof old === "string" && !resolved.value.includes(old) && (value.dialogueAct !== "EDIT" || !evidence.current)) fail("NOTES_LOSS_REQUIRES_CLARIFICATION");
      resolvedChanges.push(resolved);
      return evidenceMetadata(evidence);
    });
    const query = value.query ? resolve(value.query.evidence, "QUERY", "queryRange", value.query, ["query", "evidence"], false, value.query.kind === "LIST") : null;
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
    const control = resolve(value.controlEvidence, "CONTROL", "operation", value.dialogueAct, ["controlEvidence"]);
    if (value.controlEvidence.length && !control.current) fail("CURRENT_USER_EVIDENCE_REQUIRED");
    const alternativeEvidence: ValidatedFieldEvidence[] = [];
    let resolvedUncertainties = value.uncertainties.map((uncertainty, index) => {
      const scope = uncertainty.field === "queryRange" ? "QUERY"
        : SLOT_NAMES.includes(uncertainty.field as typeof SLOT_NAMES[number]) ? "REMINDER" : "CONTROL";
      const alternatives = uncertainty.alternatives.map((alternative, alternativeIndex) => {
        const resolved = resolve(alternative.evidence, scope, uncertainty.field, alternative.value, ["uncertainties", index, "alternatives", alternativeIndex, "evidence"]);
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
const validatedPatchV3Brand: unique symbol = Symbol("ValidatedPatchV3");
export type ValidatedPatchV3 = {
  readonly [validatedPatchV3Brand]: true;
  /** The validated provider representation, never the operands to persist. */
  readonly proposal: SemanticPatchProposalV3;
  /** Backend values restore exact accepted facts only after alias validation. */
  readonly resolvedChanges: readonly FieldChangeV3[];
  readonly resolvedQuery: QueryOperand | null;
  readonly resolvedUncertainties: SemanticPatchProposalV3["uncertainties"];
  readonly queryReferenceTime: string | null;
  readonly changeEvidence: readonly ValidatedFieldEvidence[];
  readonly queryEvidence: readonly SourceEvidence[];
  readonly requestTarget: SemanticPatchProposalV3["requestTarget"];
  readonly requestTargetEvidence: readonly SourceEvidence[];
  /** Exact pending question answered by the current scoped targeting source. */
  readonly adoptedCandidate: boolean;
  readonly adoptedChangeFields: readonly FieldChangeV3["field"][];
  readonly alternativeEvidence: readonly ValidatedFieldEvidence[];
  readonly observation: ContextObservation;
  readonly candidateSnapshot: ContextSnapshotV2;
};
export type EvidenceValidationV3 = { status: "VALID"; patch: ValidatedPatchV3 } | { status: "REFUSED"; reason: string };
const issuedPatchesV3 = new WeakSet<object>();
export function isValidatedPatchV3(value: unknown): value is ValidatedPatchV3 { return typeof value === "object" && value !== null && issuedPatchesV3.has(value); }
function createEvidenceResolverV3(built:ReadyContextV2,onFailure:(value:EvidenceFailureDiagnostic)=>void,observe?:DownstreamObserver,target?:SemanticPatchProposalV3["requestTarget"]) {
  const internal=evidenceContextForV2(built);
  if(!internal) return fail("CONTEXT_NOT_BUILT");
  const frequency = internal.snapshot?.slots.frequency;
  const count = internal.snapshot?.slots.occurrenceCount;
  const seriesCount = target?.kind === "CURRENT" && frequency && count
    && ["PROPOSED", "RESOLVED"].includes(frequency.state) && frequency.value === "DAILY"
    && ["PROPOSED", "RESOLVED"].includes(count.state) && typeof count.value === "number"
    ? count.value : undefined;
  type Site = Pick<EvidenceFailureDiagnostic, "field" | "path" | "referenceOrdinal" | "operation" | "currentTurnOrdinal" | "referenceSelection">;
  // Failure-only identity telemetry. Hashes never participate in acceptance.
  const traceFailure = (reason: string, code: EvidenceFailureDiagnostic["reason"], ref: EvidenceRef, site: Site, sourceMapStatus: EvidenceFailureDiagnostic["sourceMapStatus"] = "NOT_CHECKED"): never => {
    try {
      const turn = ref.kind === "USER_QUOTE" ? built.evidenceIndex[ref.turn] : undefined;
      let matchCount = 0, from = 0;
      if (ref.kind === "USER_QUOTE" && turn?.role === "USER") {
        for (;;) { const at = turn.semanticView.indexOf(ref.quote, from); if (at < 0) break; matchCount++; from = at + ref.quote.length; }
      }
      const hash = (text: string) => createHash("sha256").update(text.normalize("NFC"), "utf8").digest("hex");
      onFailure({
        ...site, sourceAlias: ref.kind === "USER_QUOTE" ? `t${ref.turn}` : ref.ref,
        expectedSourceRole: ref.kind === "USER_QUOTE" ? "USER" : "CONTEXT_FACT",
        resolvedSourceRole: ref.kind === "USER_QUOTE" ? turn?.role ?? "UNKNOWN" : internal.facts.has(ref.ref) ? "CONTEXT_FACT" : "UNKNOWN",
        sourceTurnOrdinal: ref.kind === "USER_QUOTE" ? ref.turn : null,
        requestedOccurrence: ref.kind === "USER_QUOTE" ? ref.occurrence : null,
        matchCount: ref.kind === "USER_QUOTE" && turn?.role === "USER" ? matchCount : null,
        quoteBytes: ref.kind === "USER_QUOTE" ? new TextEncoder().encode(ref.quote).length : null,
        quoteCodePoints: ref.kind === "USER_QUOTE" ? [...ref.quote].length : null,
        quoteSha256: ref.kind === "USER_QUOTE" ? hash(ref.quote) : null,
        sourceViewSha256: turn ? hash(turn.semanticView) : null,
        sourceMapStatus, reason: code === "QUOTE_NOT_FOUND" && matchCount > 0 ? "QUOTE_OCCURRENCE_OUT_OF_RANGE" : code,
        ...(ref.kind === "USER_QUOTE" ? { quoteClassification: classifyQuoteMismatch(ref.quote, ref.turn, built.evidenceIndex, built.candidateSnapshot.transcript) } : {}),
      });
    } catch { /* Telemetry must not change the public rejection or authority. */ }
    return fail(reason);
  };
  const traceCurrentFailure=(ref:EvidenceRef,site:Site,referenceSelection:NonNullable<EvidenceFailureDiagnostic["referenceSelection"]>,operation?:EvidenceFailureDiagnostic["operation"]):never=>traceFailure("CURRENT_USER_EVIDENCE_REQUIRED","CURRENT_USER_EVIDENCE_REQUIRED",ref,{...site,currentTurnOrdinal:built.input.currentTurn,referenceSelection,...(operation?{operation}:{})});
  const quoteSource = (ref: Extract<EvidenceRef, { kind: "USER_QUOTE" }>, site: Site): SourceEvidence => {
    const turn = built.evidenceIndex[ref.turn];
    if (!turn || turn.role !== "USER") return traceFailure("EVIDENCE_NOT_USER", !turn ? "SOURCE_ALIAS_UNKNOWN" : "SOURCE_ROLE_NOT_USER", ref, site);
    let at = -1, from = 0;
    for (let count = 0; count < ref.occurrence; count++) {
      at = turn.semanticView.indexOf(ref.quote, from);
      if (at < 0) return traceFailure("EVIDENCE_QUOTE_NOT_FOUND", "QUOTE_NOT_FOUND", ref, site);
      from = at + ref.quote.length;
    }
    const start = [...turn.semanticView.slice(0, at)].length, end = start + [...ref.quote].length;
    const segments = turn.sourceMap.segments.filter(s => s.viewStart < end && s.viewEnd > start);
    if (!segments.length || segments.some(s => s.kind === "CONTROL_REPLACEMENT")) return traceFailure("EVIDENCE_REMOVED_SPAN", segments.length ? "QUOTE_REMOVED_CONTROL_SPAN" : "QUOTE_SOURCE_MAP_INVALID", ref, site, segments.length ? "REMOVED_CONTROL_SPAN" : "INVALID");
    const mapBoundary = (point: number, side: "start" | "end") => {
      const s = side === "start" ? segments[0] : segments.at(-1)!;
      const offset = point - s.viewStart;
      if (offset % s.viewStride !== 0) return traceFailure("EVIDENCE_NORMALIZATION_BOUNDARY", "QUOTE_NORMALIZATION_MISMATCH", ref, site, "NORMALIZATION_BOUNDARY");
      return s.sourceStart + offset / s.viewStride * s.sourceStride;
    };
    const sourceStart = mapBoundary(start, "start"), sourceEnd = mapBoundary(end, "end");
    if ([...turn.text].slice(sourceStart, sourceEnd).join("").normalize("NFC") !== ref.quote) return traceFailure("EVIDENCE_SOURCE_MISMATCH", "QUOTE_SOURCE_MAP_INVALID", ref, site, "INVALID");
    return { kind: "USER_QUOTE", sourceTurnId: turn.id, sourceMapTurnId: turn.id, quote: ref.quote, occurrence: ref.occurrence, sourceSpan: { start: sourceStart, end: sourceEnd }, viewSpan: { start, end }, normalizationVersion: "nfc-codepoint-v1" };
  };
  const rawResolve = (refs: EvidenceRef[], scope: "REMINDER" | "QUERY" | "CONTROL", field: EvidenceFailureDiagnostic["field"], requested: unknown, path: Site["path"], editsExistingOperand = false, listRangeCandidate = false): ResolvedEvidence => {
    const quotes: SourceEvidence[] = [];
    const factBindings: BoundContextFact[] = [];
    for (const [referenceOrdinal, ref] of refs.entries()) {
      const site = { field, path, referenceOrdinal };
      if (ref.kind === "USER_QUOTE") {
        quotes.push(quoteSource(ref, site));
      } else {
        const binding = internal.facts.get(ref.ref);
        if (!binding || binding.supplied.scope !== scope || binding.supplied.field !== field || !equal(operand(binding.supplied.value), operand(requested))) return traceFailure("EVIDENCE_FACT_SCOPE_OR_VALUE", !binding ? "SOURCE_ALIAS_UNKNOWN" : binding.supplied.scope !== scope ? "SOURCE_SCOPE_MISMATCH" : "EVIDENCE_TARGET_MISMATCH", ref, site);
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
    if (field === "leadOffsetDays" && requested !== null && !firstFact
      && !supportsLeadOffset(requested as number, distinct, built.candidateSnapshot.transcript, seriesCount)) fail("LEAD_OFFSET_NOT_SUPPORTED");
    // Reject-only fidelity check for a single explicit Gregorian civil source.
    // Never supply a date/year or infer event/reminder ownership from the scan.
    // Exact facts and unknown, ambiguous, lunar or relative forms retain their
    // existing authority path; LIST has its own range verifier.
    if (["eventDate", "reminderDate", "endDate"].includes(field) && !firstFact && distinct.length === 1
      && requested && typeof requested === "object") {
      const civil = requested as Record<string, unknown>;
      if (civil.kind === "CIVIL_DATE" && civil.calendar === "GREGORIAN") {
        for (const source of distinct) {
          // The scanner does not establish calendar ownership. A bounded
          // lunar marker, including abbreviated âm, excludes this veto.
          if (/(?:^|[^\p{L}\p{M}\p{N}_])âm(?:$|[^\p{L}\p{M}\p{N}_])/iu.test(source.quote)) continue;
          const date = extractTemporalEvidence({ text: source.quote, referenceNow: Date.parse(referenceTime) }).date;
          if (date.state !== "RESOLVED" || !["DAY_MONTH", "EXPLICIT_DATE"].includes(date.source)) continue;
          const [, month, day] = date.localDate.split("-").map(Number);
          if (civil.day !== day || civil.month !== month) fail("CIVIL_DATE_SOURCE_MISMATCH");
        }
      }
    }
    if ((field === "frequency" || field === "occurrenceCount") && requested !== null && !firstFact
      && !supportsCadenceOperand(field, requested, distinct, built.evidenceIndex,
        target?.kind === "CURRENT" && internal.snapshot?.pendingReminderQuestion?.field === "occurrenceCount" ? built.evidenceIndex[built.input.currentTurn].id : undefined,
        target?.kind === "CURRENT" ? built.evidenceIndex[built.input.currentTurn].id : undefined)) fail("CADENCE_COUNT_NOT_SUPPORTED");
    // Necessary source-presence veto only: never turn scanner output into a
    // proposed value or assign event/reminder ownership. Exact fact bindings
    // already prove their value and do not need a fresh clock in the text.
    if ((field === "eventTime" || field === "reminderTime") && requested !== null && !firstFact
      && distinct.every(source => {
        // Complete named clocks are expressions, not absence. The existing
        // scanner's bounded numeric grammar does not cover these; this cue
        // supplies no value and cannot independently authorize a clock.
        if (/(?:^|[^\p{L}\p{M}\p{N}_])(?:nửa\s+đêm|midnight|noon)(?:$|[^\p{L}\p{M}\p{N}_])/iu.test(source.quote)) return false;
        const time = extractTemporalEvidence({ text: source.quote, referenceNow: Date.parse(referenceTime) }).time;
        return time.state === "MISSING" || (time.state === "AMBIGUOUS" && time.reason === "DAYPART_WITHOUT_EXACT_TIME");
      })) fail("CLOCK_SOURCE_MISSING");
    return { field, sources: distinct, current, provenance, referenceTime, resolvedValue, factBound: !!firstFact };
  };
  const resolve: typeof rawResolve = (...args) => traceLeadOffsetResolution(args[2], args[0], args[3], args[4], built, "V3_RESOLVER", observe, () => rawResolve(...args));
  return {resolve,quoteSource,traceCurrentFailure};
}
export function resolveListQuerySourcesV3(query:Extract<QueryOperand,{kind:"LIST"}>,uncertainties:SemanticPatchProposalV3["uncertainties"],built:ReadyContextV2,observe?:DownstreamObserver) {
  let failure:EvidenceFailureDiagnostic|undefined;
  try {
    const {resolve,quoteSource,traceCurrentFailure}=createEvidenceResolverV3(built,diagnostic=>{failure=diagnostic;},observe);
    const bound=resolve(query.evidence,"QUERY","queryRange",query,["query","evidence"],false,true);
    if(!bound.current && !query.evidence.some(ref=>ref.kind==="CONTEXT_FACT"))traceCurrentFailure(query.evidence[0],{field:"queryRange",path:["query","evidence"],referenceOrdinal:0},"REPRESENTATIVE_NO_CURRENT");
    // Check every alternative before any obsolete query-range instruction is
    // discarded. Preserve the same field/path/reference ordinals as V3.
    for(const [index,raw] of uncertainties.entries()) {
      const u=UncertaintyV3Schema.parse(raw);
      const scope=u.field==="queryRange"?"QUERY":SLOT_NAMES.includes(u.field as typeof SLOT_NAMES[number])?"REMINDER":"CONTROL";
      for(const [ordinal,a] of u.alternatives.entries()) {
        resolve(a.evidence,scope,u.field,a.value,["uncertainties",index,"alternatives",ordinal,"evidence"]);
        const offending=a.evidence.findIndex(ref=>ref.kind!=="USER_QUOTE" || ref.turn!==built.input.currentTurn);
        if(u.field==="operation" && offending>=0)traceCurrentFailure(a.evidence[offending],{field:u.field,path:["uncertainties",index,"alternatives",ordinal,"evidence"],referenceOrdinal:offending},"FIRST_OFFENDING");
      }
    }
    const resolved=QueryOperandSchema.parse(bound.resolvedValue);
    if(resolved.kind!=="LIST")fail("EVIDENCE_FACT_SCOPE_OR_VALUE");
    const turn=built.evidenceIndex[built.input.currentTurn];
    const explicit=bound.current?explicitListPeriod(turn,turn.receivedAt):null;
    let deterministicPeriod:Extract<QueryOperand,{kind:"LIST"}>["period"]=null;
    if(explicit) {
      const valid=QueryOperandSchema.safeParse({...resolved,period:explicit.period});
      const source=quoteSource({kind:"USER_QUOTE",turn:built.input.currentTurn,quote:explicit.quote,occurrence:explicit.occurrence},{field:"queryRange",path:["query","evidence"],referenceOrdinal:0});
      if(valid.success && verifyListRangeEvidence({candidateRange:explicit.period,evidence:[source],turns:[turn],currentTurnId:turn.id,referenceTime:turn.receivedAt})==="SUPPORTED")deterministicPeriod=explicit.period;
    }
    return {status:"VALID" as const,query:resolved,deterministicPeriod};
  } catch(error) {
    const reason=error instanceof EvidenceFailure?error.message:"EVIDENCE_INVALID";
    observeDownstream(observe,{stage:"EVIDENCE",result:"REJECTED",reason:evidenceReason(reason),...(failure?{evidenceFailure:failure}:{})});
    return {status:"REFUSED" as const,reason};
  }
}
export function validateEvidenceV3(proposal: SemanticPatchProposalV3, built: ReadyContextV2, observe?: DownstreamObserver): EvidenceValidationV3 {
  let evidenceFailure: EvidenceFailureDiagnostic | undefined;
  const refused = (reason: string): EvidenceValidationV3 => {
    observeDownstream(observe, { stage: "EVIDENCE", result: "REJECTED", reason: evidenceReason(reason), ...(evidenceFailure ? { evidenceFailure } : {}) });
    observeDownstream(observe, { stage: "PATCH", result: "REJECTED", reason: "PATCH_REJECTED" });
    return { status: "REFUSED", reason };
  };
  const internal = evidenceContextForV2(built);
  if (!internal) return refused("CONTEXT_NOT_BUILT");
  if (built.input.schemaVersion !== "calenote-context-input-2" || built.candidateSnapshot.schemaVersion !== "calenote-context-state-2") return refused("CONTEXT_PROTOCOL_MISMATCH");
  const parsed = SemanticPatchProposalV3Schema.safeParse(proposal);
  if (!parsed.success) return refused("PROPOSAL_SCHEMA_INVALID");
  if (containsForbiddenControl(parsed.data, internal.handles)) return refused("CONTROL_IN_PROPOSAL");
  const value = parsed.data;
  const {resolve,quoteSource,traceCurrentFailure} = createEvidenceResolverV3(built, diagnostic => { evidenceFailure = diagnostic; },observe,value.requestTarget);
  try {
    const resolvedChanges: FieldChangeV3[] = [];
    const changeEvidence = value.changes.map((change, index) => {
      const old = internal.snapshot?.slots[change.field].value ?? null;
      const evidence = resolve(change.evidence, "REMINDER", change.field, change.value, ["changes", index, "evidence"], old !== null && change.operation === "REPLACE");
      const resolved = FieldChangeV3Schema.parse({ ...change, value: evidence.resolvedValue });
      if (resolved.operation !== "SET" && !evidence.current) traceCurrentFailure(change.evidence[0],{field:change.field,path:["changes",index,"evidence"],referenceOrdinal:0},"REPRESENTATIVE_NO_CURRENT",resolved.operation);
      resolvedChanges.push(resolved);
      return evidenceMetadata(evidence);
    });
    let query = value.query ? resolve(value.query.evidence, "QUERY", "queryRange", value.query, ["query", "evidence"], false, value.query.kind === "LIST") : null;
    if (query && !query.current && !value.query!.evidence.some(e => e.kind === "CONTEXT_FACT")) traceCurrentFailure(value.query!.evidence[0],{field:"queryRange",path:["query","evidence"],referenceOrdinal:0},"REPRESENTATIVE_NO_CURRENT");
    let resolvedQuery = query ? QueryOperandSchema.parse(query.resolvedValue) : null;
    let deterministicRange = false;
    if (resolvedQuery?.kind === "LIST" && query?.current && value.intent === "LIST_REMINDERS") {
      const turn = built.evidenceIndex[built.input.currentTurn];
      const explicit = explicitListPeriod(turn, turn.receivedAt);
      const canonical = explicit ? QueryOperandSchema.safeParse({...resolvedQuery, period: explicit.period}) : null;
      if (explicit && canonical?.success) {
        const source = quoteSource({kind: "USER_QUOTE", turn: built.input.currentTurn, quote: explicit.quote, occurrence: explicit.occurrence}, {field: "queryRange", path: ["query", "evidence"], referenceOrdinal: 0});
        if (verifyListRangeEvidence({candidateRange: explicit.period, evidence: [source], turns: [turn], currentTurnId: turn.id, referenceTime: turn.receivedAt}) === "SUPPORTED") {
          resolvedQuery = canonical.data;
          query = {...query, sources: [source], referenceTime: turn.receivedAt};
          deterministicRange = true;
        }
      }
    }
    if (resolvedQuery?.kind !== "LIST" || !resolvedQuery.period) observeDownstream(observe, { stage: "LIST_RANGE", result: resolvedQuery?.kind === "LIST" ? "UNSPECIFIED" : "NOT_APPLICABLE", reason: "NONE" });
    let rangeIssue: SemanticPatchProposalV3["uncertainties"][number] | null = null;
    if (resolvedQuery?.kind === "LIST" && resolvedQuery.period) {
      const inherited = !deterministicRange && value.query!.evidence.some(e => e.kind === "CONTEXT_FACT");
      const scopedContinuation = built.input.pendingQuestion?.scope === "QUERY" && built.input.pendingQuestion.field === "queryRange" && value.intent === "LIST_REMINDERS" && query!.current && built.candidateSnapshot.pendingQueryQuestion?.deliveryState === "SENT";
      const support = inherited && !scopedContinuation ? "UNSUPPORTED" : verifyListRangeEvidence({ candidateRange: resolvedQuery.period, evidence: query!.sources, turns: built.evidenceIndex, currentTurnId: built.evidenceIndex[built.input.currentTurn].id, referenceTime: query!.referenceTime });
      observeDownstream(observe, { stage: "LIST_RANGE", result: support, reason: "NONE", candidateRange: resolvedQuery.period.kind, field: "queryRange" });
      if (support !== "SUPPORTED") {
        resolvedQuery = { ...resolvedQuery, period: null };
        rangeIssue = { field: "queryRange", reason: support === "AMBIGUOUS" ? "AMBIGUOUS" : "MISSING", alternatives: [] };
      }
    }
    const target = value.requestTarget ? resolve(value.requestTarget.evidence, "CONTROL", "operation", value.requestTarget.kind, ["requestTarget", "evidence"]) : null;
    const offendingTarget=value.requestTarget?.evidence.findIndex(ref=>ref.kind!=="USER_QUOTE"||ref.turn!==built.input.currentTurn)??-1;
    if (target && offendingTarget>=0) traceCurrentFailure(value.requestTarget!.evidence[offendingTarget],{field:"operation",path:["requestTarget","evidence"],referenceOrdinal:offendingTarget},"FIRST_OFFENDING");
    // Current USER evidence grounds the instruction, not target existence.
    // Only the builder's privately retained, scope/revision/lifetime-checked
    // draft grants CURRENT. Never reinterpret an unavailable target as NEW.
    if (value.requestTarget?.kind === "CURRENT") {
      const retained = internal.snapshot;
      if (!retained?.requestId || retained.draftRevision === null || retained.draftCreatedAt === null
        || retained.draftExpiresAt === null || !["CLARIFYING", "AWAITING_CONFIRMATION"].includes(retained.lifecycle)
        || Date.parse(retained.draftExpiresAt) <= Date.parse(built.candidateSnapshot.inbound.receivedAt)) fail("REQUEST_TARGET_NOT_AVAILABLE");
    }
    // Fresh B operands, including alternatives, cannot borrow A's sources.
    // Original pending-candidate adoption is revalidated separately below.
    const freshOperandEvidence = [
      ...value.changes.map(change => change.evidence),
      ...value.uncertainties.flatMap(uncertainty => uncertainty.alternatives.map(alternative => alternative.evidence)),
    ];
    if (value.requestTarget?.kind === "NEW" && freshOperandEvidence.some(refs => refs.some(ref => ref.kind !== "USER_QUOTE" || ref.turn !== built.input.currentTurn))) fail("NEW_REQUEST_FACT_REUSE");
    const pending = built.candidateSnapshot.pendingSemanticCandidate;
    const question = built.candidateSnapshot.pendingReminderQuestion;
    const retainedUncertainties: SemanticPatchProposalV3["uncertainties"] = [];
    const retainedAlternativeEvidence: ValidatedFieldEvidence[] = [];
    const adoptedChangeFields: FieldChangeV3["field"][] = [];
    const adoptedCandidate = !!(pending && target?.current && value.requestTarget?.kind !== "UNRESOLVED"
      && question?.field === "operation" && question.questionId === pending.questionId && question.deliveryState === "SENT"
      && pending.baseContextRevision === built.candidateSnapshot.contextRevision && Date.parse(pending.expiresAt) > Date.parse(built.candidateSnapshot.inbound.receivedAt)
      && (question.issuedAfterOrder.receivedAt < built.candidateSnapshot.inbound.receivedAt || (question.issuedAfterOrder.receivedAt === built.candidateSnapshot.inbound.receivedAt && question.issuedAfterOrder.rowid < built.candidateSnapshot.inbound.rowid)));
    if (adoptedCandidate && pending) {
      // Resolve original retained sources again; current answer grants targeting,
      // never rewrites the receipt or labels old quotes as current.
      const fields = new Set(value.changes.map(c => c.field));
      const providerRefs = (refs: EvidenceRef[]): EvidenceRef[] => refs.map(ref => {
        if (ref.kind === "CONTEXT_FACT") {
          const binding = [...internal.facts.values()].find(f => f.internal.alias === ref.ref);
          if (!binding) return fail("EVIDENCE_FACT_INVALID");
          return { kind: "CONTEXT_FACT", ref: binding.supplied.alias };
        }
        const original = built.candidateSnapshot.transcript[ref.turn];
        const turn = built.evidenceIndex.findIndex(t => t.id === original?.id);
        if (turn < 0) return fail("EVIDENCE_NOT_USER");
        return { ...ref, turn };
      });
      const retainedOperand = (refs: EvidenceRef[], scope: "REMINDER" | "QUERY" | "CONTROL", field: string, requested: unknown): unknown => {
        const facts = refs.flatMap(ref => ref.kind === "CONTEXT_FACT" ? [internal.facts.get(ref.ref)!] : []);
        if (facts.some(fact => fact.internal.scope !== scope || fact.internal.field !== field || !equal(operand(fact.internal.value), operand(requested)))) fail("EVIDENCE_FACT_SCOPE_OR_VALUE");
        return facts[0]?.supplied.value ?? requested;
      };
      const originalTarget = pending.proposal.requestTarget;
      if (!originalTarget) return fail("CURRENT_USER_EVIDENCE_REQUIRED");
      if (originalTarget.evidence.some(ref => ref.kind !== "USER_QUOTE" || built.candidateSnapshot.transcript[ref.turn]?.receivedAt !== pending.createdAt)) fail("CURRENT_USER_EVIDENCE_REQUIRED");
      resolve(providerRefs(originalTarget.evidence), "CONTROL", "operation", originalTarget.kind, ["requestTarget", "evidence"]);
      for (const [index, change] of pending.proposal.changes.entries()) {
        const refs = providerRefs(change.evidence);
        const requested = retainedOperand(refs, "REMINDER", change.field, change.value);
        const bound = resolve(refs, "REMINDER", change.field, requested, ["changes", index, "evidence"]);
        const originalCurrent = bound.sources.some(source => pending.sourceEvidence.some(target => target.sourceTurnId === source.sourceTurnId)
          && built.candidateSnapshot.transcript.find(t => t.id === source.sourceTurnId)?.receivedAt === pending.createdAt);
        if (change.operation !== "SET" && !originalCurrent) fail("CURRENT_USER_EVIDENCE_REQUIRED");
        if (value.requestTarget?.kind === "NEW" && (!bound.sources.length || bound.sources.some(source => !pending.sourceEvidence.some(target => target.sourceTurnId === source.sourceTurnId)
          || built.candidateSnapshot.transcript.find(t => t.id === source.sourceTurnId)?.receivedAt !== pending.createdAt))) fail("NEW_REQUEST_FACT_REUSE");
        if (fields.has(change.field)) continue;
        resolvedChanges.push(FieldChangeV3Schema.parse({ ...change, value: bound.resolvedValue }));
        changeEvidence.push(evidenceMetadata(bound));
        adoptedChangeFields.push(change.field);
      }
      for (const [index, uncertainty] of pending.proposal.uncertainties.entries()) {
        // Targeting was answered; factual ambiguity still needs its own answer.
        const keep = uncertainty.field !== "operation" && !value.uncertainties.some(u => u.field === uncertainty.field);
        const scope = uncertainty.field === "queryRange" ? "QUERY" : SLOT_NAMES.includes(uncertainty.field as typeof SLOT_NAMES[number]) ? "REMINDER" : "CONTROL";
        const alternatives = uncertainty.alternatives.map((alternative, alternativeIndex) => {
          const refs = providerRefs(alternative.evidence);
          const requested = retainedOperand(refs, scope, uncertainty.field, alternative.value);
          const resolved = resolve(refs, scope, uncertainty.field, requested, ["uncertainties", index, "alternatives", alternativeIndex, "evidence"]);
          if (uncertainty.field === "operation" && resolved.sources.some(source => built.candidateSnapshot.transcript.find(t => t.id === source.sourceTurnId)?.receivedAt !== pending.createdAt)) fail("CURRENT_USER_EVIDENCE_REQUIRED");
          if (value.requestTarget?.kind === "NEW" && (!resolved.sources.length || resolved.sources.some(source => !pending.sourceEvidence.some(target => target.sourceTurnId === source.sourceTurnId)
            || built.candidateSnapshot.transcript.find(t => t.id === source.sourceTurnId)?.receivedAt !== pending.createdAt))) fail("NEW_REQUEST_FACT_REUSE");
          if (keep) retainedAlternativeEvidence.push(evidenceMetadata(resolved));
          return { ...alternative, value: resolved.resolvedValue };
        });
        if (keep) retainedUncertainties.push(UncertaintyV3Schema.parse({ ...uncertainty, alternatives }));
      }
    }
    const alternativeEvidence: ValidatedFieldEvidence[] = [];
    let resolvedUncertainties = value.uncertainties.map((uncertainty, index) => {
      const scope = uncertainty.field === "queryRange" ? "QUERY"
        : SLOT_NAMES.includes(uncertainty.field as typeof SLOT_NAMES[number]) ? "REMINDER" : "CONTROL";
      const alternatives = uncertainty.alternatives.map((alternative, alternativeIndex) => {
        const resolved = resolve(alternative.evidence, scope, uncertainty.field, alternative.value, ["uncertainties", index, "alternatives", alternativeIndex, "evidence"]);
        const offending=alternative.evidence.findIndex(ref=>ref.kind!=="USER_QUOTE"||ref.turn!==built.input.currentTurn);
        if (uncertainty.field === "operation" && offending>=0) traceCurrentFailure(alternative.evidence[offending],{field:uncertainty.field,path:["uncertainties",index,"alternatives",alternativeIndex,"evidence"],referenceOrdinal:offending},"FIRST_OFFENDING");
        alternativeEvidence.push(evidenceMetadata(resolved));
        return { ...alternative, value: resolved.resolvedValue };
      });
      return UncertaintyV3Schema.parse({ ...uncertainty, alternatives });
    });
    resolvedUncertainties.push(...retainedUncertainties);
    alternativeEvidence.push(...retainedAlternativeEvidence);
    const relationSupported = (field: string, requested: unknown, bound: ValidatedFieldEvidence) => {
      if (field !== "eventRelation" || requested === null) return true;
      // Only the existing resolver's exact alias/scope/value check can grant
      // inherited authority. A same-valued USER_QUOTE does not become a fact.
      const old = internal.snapshot?.slots.eventRelation;
      const inherited = value.requestTarget?.kind !== "NEW" && bound.factBound === true
        && old?.state === "RESOLVED" && equal(old.value, requested);
      const retainedEvent = value.requestTarget?.kind === "CURRENT" && internal.snapshot?.slots.eventDate.state === "RESOLVED";
      return inherited || supportsEventRelation(requested as EventRelation, bound.sources, built.evidenceIndex, retainedEvent);
    };
    const keptChanges = resolvedChanges.map((change, index) => ({ change, bound: changeEvidence[index] }))
      .filter(({ change, bound }) => relationSupported(change.field, change.value, bound));
    let alternativeIndex = 0;
    const keptAlternativeEvidence: ValidatedFieldEvidence[] = [];
    resolvedUncertainties = resolvedUncertainties.flatMap(u => {
      const alternatives = u.alternatives.filter(a => {
        const bound = alternativeEvidence[alternativeIndex++];
        if ((rangeIssue || deterministicRange) && u.field === "queryRange") return false;
        if (!relationSupported(u.field, a.value, bound)) return false;
        keptAlternativeEvidence.push(bound);
        return true;
      });
      return (rangeIssue || deterministicRange) && u.field === "queryRange" ? [] : [UncertaintyV3Schema.parse({ ...u, alternatives })];
    });
    if (rangeIssue) resolvedUncertainties.push(rangeIssue);
    if (!titleCoverageComplete({ intent:value.intent,target:value.requestTarget,currentTurn:built.evidenceIndex[built.input.currentTurn],
      changes:keptChanges.map(p=>p.change),changeEvidence:keptChanges.map(p=>p.bound),uncertainties:resolvedUncertainties,alternativeEvidence:keptAlternativeEvidence,
      retainedTitle:internal.snapshot?.slots.title.state==="RESOLVED" && typeof internal.snapshot.slots.title.value==="string" ? internal.snapshot.slots.title.value : null,
    })) fail("SEMANTIC_TITLE_OMITTED");
    if (!locationCoverageComplete({ intent: value.intent, target: value.requestTarget,
      currentTurn: built.evidenceIndex[built.input.currentTurn],
      changes: keptChanges.map(p => p.change), changeEvidence: keptChanges.map(p => p.bound),
      uncertainties: resolvedUncertainties, alternativeEvidence: keptAlternativeEvidence,
      retainedLocation: internal.snapshot?.slots.location.state === "RESOLVED" && typeof internal.snapshot.slots.location.value === "string" ? internal.snapshot.slots.location.value : null,
    })) fail("SEMANTIC_LOCATION_OMITTED");
    if (value.intent === "CREATE_REMINDER" && !leadDistanceCovered(built.evidenceIndex[built.input.currentTurn],
      keptChanges.map(p => p.change), resolvedUncertainties.flatMap(u => u.alternatives.map(a => ({ field: u.field, value: a.value }))),
      value.requestTarget?.kind === "CURRENT" && internal.snapshot?.slots.leadOffsetDays.state !== "CONFLICT" ? internal.snapshot?.slots.leadOffsetDays.value : null,
      value.requestTarget?.kind === "CURRENT" && internal.snapshot?.slots.frequency.value === "DAILY" && internal.snapshot.slots.frequency.state !== "CONFLICT" && internal.snapshot.slots.occurrenceCount.state !== "CONFLICT" ? internal.snapshot.slots.occurrenceCount.value ?? undefined : undefined)) fail("SEMANTIC_LEAD_OFFSET_OMITTED");
    const patch: ValidatedPatchV3 = freeze({
      [validatedPatchV3Brand]: true as const,
      proposal: value,
      resolvedChanges: keptChanges.map(p => p.change),
      resolvedQuery,
      resolvedUncertainties,
      queryReferenceTime: query?.referenceTime ?? null,
      changeEvidence: keptChanges.map(p => p.bound),
      queryEvidence: query?.sources ?? [],
      requestTarget: value.requestTarget,
      requestTargetEvidence: target?.sources ?? [],
      adoptedCandidate,
      adoptedChangeFields: adoptedChangeFields.filter(field => keptChanges.some(p => p.change.field === field)),
      alternativeEvidence: keptAlternativeEvidence,
      observation: built.observation,
      candidateSnapshot: built.candidateSnapshot,
    });
    issuedPatchesV3.add(patch);
    observeDownstream(observe, { stage: "EVIDENCE", result: "PASS", reason: "NONE" });
    observeDownstream(observe, { stage: "PATCH", result: "PASS", reason: "NONE" });
    return { status: "VALID", patch };
  } catch (error) { return refused(error instanceof EvidenceFailure ? error.message : "EVIDENCE_INVALID"); }
}


/** Privacy only: never a semantic/directive approval or a redacted sendable reply. */
export function validateGuidancePrivacy(proposal: unknown, built: ReadyContext | ReadyContextV2): GuidancePrivacyValidation {
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

import { SLOT_NAMES, UncertaintySchema, type ConversationInterpretation, type EvidenceRef, type QueryOperand } from "./contracts";
import { isValidatedPatch, type ValidatedFieldEvidence, type ValidatedPatch } from "./evidence";
import { ContextSnapshotV1Schema, encodeContextSnapshot, type ContextSnapshotV1, type SlotProvenance, type SourceEvidence } from "./state";
import { RESOLUTION_VERSION } from "./resolve";

export type MergeResult = { status: "MERGED"; candidate: ContextSnapshotV1; changedFields: typeof SLOT_NAMES[number][]; uncertainties: ConversationInterpretation["uncertainties"]; query: QueryOperand | null; queryReferenceTime: string | null }
  | { status: "REJECTED"; reason: string };
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Pure candidate construction. No draft is persisted or confirmed here. */
export function mergePatch(previous: ContextSnapshotV1 | null, patch: ValidatedPatch): MergeResult {
  if (!isValidatedPatch(patch)) return { status: "REJECTED", reason: "UNVALIDATED_PATCH" };
  const reject = (reason: string): MergeResult => ({ status: "REJECTED", reason });
  const observation = patch.observation.observed;
  if (previous ? observation.presence !== "PRESENT" || previous.id !== observation.contextId || previous.contextRevision !== observation.contextRevision || !equal(previous.scope, patch.observation.scope) : observation.presence !== "ABSENT") return reject("STALE_BASE");
  const candidate = structuredClone(patch.candidateSnapshot), proposal = patch.proposal;
  const changedFields: typeof SLOT_NAMES[number][] = [];
  const policyConflicts = new Set<typeof SLOT_NAMES[number]>();
  const refs = (sources: readonly SourceEvidence[]): EvidenceRef[] => sources.map(s => ({ kind: "USER_QUOTE", turn: candidate.transcript.findIndex(t => t.id === s.sourceTurnId), quote: s.quote, occurrence: s.occurrence }));
  const policyFact = (field: string, value: unknown, authority?: Pick<ValidatedFieldEvidence, "provenance" | "referenceTime">) => {
    return candidate.facts.find(f => {
      if (f.scope !== "REMINDER" || f.field !== field || !equal(f.value, value) || f.provenance.kind !== "DERIVED_POLICY") return false;
      const slot = candidate.slots[f.field];
      if (slot.state !== "RESOLVED" || slot.fact !== f.alias || slot.provenance?.kind !== "DERIVED_POLICY" || !equal(slot.value, value)) return false;
      if (slot.provenance.policyVersion !== f.provenance.policyVersion || slot.provenance.referenceTime !== f.sourceReferenceTime || slot.resolution?.referenceTime !== f.sourceReferenceTime) return false;
      return !authority || (equal(slot.provenance, authority.provenance) && f.sourceReferenceTime === authority.referenceTime);
    });
  };
  // Direct quotes retain stable source spans. A source-less policy fact instead
  // retains its exact internal alias; it must never become a fabricated quote.
  const alternativeRefs = (field: string, value: unknown, bound: Pick<ValidatedFieldEvidence, "sources" | "provenance" | "referenceTime">): EvidenceRef[] | null => {
    if (bound.sources.length) return refs(bound.sources);
    const fact = policyFact(field, value, bound);
    return fact ? [{ kind: "CONTEXT_FACT", ref: fact.alias }] : null;
  };
  let alternativeIndex = 0;
  const uncertainties: ConversationInterpretation["uncertainties"] = [];
  for (const uncertainty of patch.resolvedUncertainties) {
    const alternatives = [];
    for (const alternative of uncertainty.alternatives) {
      const evidence = alternativeRefs(uncertainty.field, alternative.value, patch.alternativeEvidence[alternativeIndex++]);
      if (!evidence) return reject("UNCERTAINTY_EVIDENCE_UNAVAILABLE");
      alternatives.push({ ...alternative, evidence });
    }
    const parsed = UncertaintySchema.safeParse({ ...uncertainty, alternatives });
    if (!parsed.success) return reject("UNCERTAINTY_INVALID");
    uncertainties.push(parsed.data);
  }
  const finish = (query: QueryOperand | null): MergeResult => {
    // Edits may remove or invalidate a fact used by an alternative. Refuse the
    // whole candidate rather than keeping a dangling or repurposed alias.
    for (const uncertainty of candidate.ambiguities) for (const alternative of uncertainty.alternatives) {
      for (const ref of alternative.evidence) if (ref.kind === "CONTEXT_FACT") {
        if (policyFact(uncertainty.field, alternative.value)?.alias !== ref.ref) return reject("UNCERTAINTY_FACT_INVALIDATED");
      }
    }
    const parsed = ContextSnapshotV1Schema.safeParse(candidate);
    if (!parsed.success) return reject("MERGED_STATE_INVALID");
    if (new TextEncoder().encode(encodeContextSnapshot(parsed.data)).length > 16384) return reject("CONTEXT_SNAPSHOT_TOO_LARGE");
    return { status: "MERGED", candidate: parsed.data, changedFields, uncertainties: parsed.data.ambiguities, query, queryReferenceTime: patch.queryReferenceTime };
  };
  if (patch.resolvedQuery) {
    const query = { ...structuredClone(patch.resolvedQuery), evidence: refs(patch.queryEvidence) };
    candidate.facts = candidate.facts.filter(f => f.scope !== "QUERY");
    const used = new Set(candidate.facts.map(f => f.alias)); let n = 1; while (used.has(`f${n}`)) n++;
    candidate.facts.push({ alias: `f${n}`, scope: "QUERY", field: "queryRange", value: query, provenance: { kind: "EXPLICIT_USER" }, sourceReferenceTime: patch.queryReferenceTime!, dependencies: [], evidenceSlot: null });
    // Keep reminder ambiguity and lifetime verbatim; query uncertainties have
    // separate ownership and can never rewrite accepted reminder facts.
    candidate.ambiguities = [...candidate.ambiguities.filter(u => u.field !== "queryRange"), ...uncertainties.filter(u => !SLOT_NAMES.includes(u.field as typeof SLOT_NAMES[number]))];
    if (candidate.ambiguities.length > 4) return reject("UNCERTAINTY_LIMIT");
    return finish(query);
  }
  if (proposal.intent !== "CREATE_REMINDER" || proposal.dialogueAct === "ABANDON_PENDING") return finish(null);
  if (previous?.requestId && (proposal.dialogueAct === "NEW_REQUEST" || proposal.continuation === "NO")) return reject("REPLACEMENT_REQUIRED");
  if (proposal.continuation === "UNCERTAIN" || proposal.dialogueAct === "AMBIGUOUS") return reject("AMBIGUOUS_OPERATION");
  if (candidate.requestId === null) {
    candidate.requestId = candidate.inbound.id;
    candidate.draftRevision = 1;
    candidate.draftCreatedAt = candidate.inbound.receivedAt;
    candidate.draftExpiresAt = new Date(Math.min(Date.parse(candidate.inbound.receivedAt) + 600000, Date.parse(candidate.absoluteExpiresAt))).toISOString();
    candidate.lifecycle = "CLARIFYING";
  }
  // A proposal (including an EDIT label or a replacement uncertainty) is not
  // an answer. Keep the retained question until a change is actually accepted
  // with current evidence below; exact context-fact echoes convey no decision.
  candidate.ambiguities.push(...uncertainties.filter(u => !candidate.ambiguities.some(old => old.field === u.field)));
  for (const [index, change] of patch.resolvedChanges.entries()) {
    const slot = candidate.slots[change.field], bound = patch.changeEvidence[index];
    const date = change.value && typeof change.value === "object" && "kind" in change.value ? change.value : null;
    const anchored = date && (date.kind === "RELATIVE_DAY" || date.kind === "WEEKDAY" || (date.kind === "CIVIL_DATE" && date.year === null));
    const localDay = (at: string | undefined) => at ? new Date(Date.parse(at) + 7 * 3600000).toISOString().slice(0, 10) : null;
    const anchorChanged = anchored && localDay(slot.resolution?.referenceTime) !== localDay(bound.referenceTime);
    const sameValue = equal(slot.value, change.value);
    const stableState = slot.state === "RESOLVED" || slot.state === "MISSING";
    const sameAuthority = slot.provenance?.kind === bound.provenance.kind;
    const outstanding = candidate.ambiguities.find(u => u.field === change.field);
    const conflict = slot.state === "CONFLICT" || outstanding?.reason === "CONFLICT";
    const canResolve = bound.current && (!conflict || proposal.dialogueAct === "EDIT");
    if (sameValue && !anchorChanged && conflict && !canResolve) continue;
    if (sameValue && !anchorChanged && stableState && (sameAuthority || slot.state === "MISSING") && !(outstanding && canResolve)) continue;
    changedFields.push(change.field);
    if (slot.value !== null && proposal.dialogueAct !== "EDIT" && (!sameValue || anchorChanged || slot.state === "CONFLICT")) {
      const acceptedEvidence = slot.provenance && slot.resolution ? alternativeRefs(change.field, slot.value, {
        sources: slot.evidence, provenance: slot.provenance, referenceTime: slot.resolution.referenceTime,
      }) : null;
      const incomingEvidence = change.value === null ? null : alternativeRefs(change.field, change.value, bound);
      if (!acceptedEvidence || (change.value !== null && !incomingEvidence)) return reject("UNCERTAINTY_EVIDENCE_UNAVAILABLE");
      const uncertainty = UncertaintySchema.safeParse({ field: change.field, reason: "CONFLICT", alternatives: [
        { value: slot.value, evidence: acceptedEvidence },
        ...(change.value === null ? [] : [{ value: change.value, evidence: incomingEvidence }]),
      ] });
      if (!uncertainty.success) return reject("UNCERTAINTY_INVALID");
      candidate.ambiguities = candidate.ambiguities.filter(u => u.field !== change.field);
      candidate.ambiguities.push(uncertainty.data);
      // RESOLVED describes the accepted fact, not permission to execute. The
      // request's CONFLICT uncertainty blocks resolution. Retaining this exact
      // policy fact also keeps T1/T2's strict next-turn binding valid.
      if (acceptedEvidence.some(e => e.kind === "CONTEXT_FACT")) policyConflicts.add(change.field);
      else slot.state = "CONFLICT";
      continue;
    }
    if (canResolve) {
      candidate.ambiguities = candidate.ambiguities.filter(u => u.field !== change.field);
      // A newly supplied uncertainty still blocks execution even when the
      // accepted change answers a retained question about that field.
      candidate.ambiguities.push(...uncertainties.filter(u => u.field === change.field));
    }
    if (change.operation === "CLEAR") Object.assign(slot, { state: "MISSING", value: null, fact: null, evidence: [], provenance: null, resolution: null });
    else Object.assign(slot, { state: "RESOLVED", value: structuredClone(change.value), fact: null, evidence: structuredClone(bound.sources), provenance: bound.provenance as SlotProvenance, resolution: { method: "EXPLICIT_OPERAND", version: RESOLUTION_VERSION, referenceTime: bound.referenceTime, timezone: "Asia/Ho_Chi_Minh", dependencies: [] } });
  }
  if (candidate.ambiguities.length > 4) return reject("UNCERTAINTY_LIMIT");
  if (changedFields.length) {
    if (previous?.draftRevision) candidate.draftRevision = previous.draftRevision + 1;
    for (const field of changedFields) if (!policyConflicts.has(field)) candidate.slots[field].proposalRevision = candidate.draftRevision!;
    candidate.previewReceipt = null; candidate.pendingDecision = null; candidate.lifecycle = "CLARIFYING";
  }
  const invalidated = new Set<typeof SLOT_NAMES[number]>(changedFields.filter(field => !policyConflicts.has(field)));
  // Derived values remain proposed operands until their dependencies are
  // resolved again. Never retain a context-fact alias for a stale derivation.
  for (let pass = 0; pass < SLOT_NAMES.length; pass++) {
    for (const field of SLOT_NAMES) {
      if (invalidated.has(field)) continue;
      const slot = candidate.slots[field];
      if (slot.provenance?.kind !== "DERIVED_POLICY" || !slot.provenance.dependencies.some(d => invalidated.has(d))) continue;
      invalidated.add(field); slot.state = "PROPOSED"; slot.fact = null;
    }
  }
  // Keep stable fact IDs for omitted facts. Rebuild only touched slots, so a
  // query and a later continuation retain their original receipt authority.
  candidate.facts = candidate.facts.filter(f => f.scope !== "REMINDER" || !invalidated.has(f.field));
  const used = new Set(candidate.facts.map(f => f.alias));
  for (const field of changedFields) {
    if (policyConflicts.has(field)) continue;
    const slot = candidate.slots[field]; slot.fact = null;
    if (slot.state !== "RESOLVED" || slot.value === null) continue;
    let n = 1; while (used.has(`f${n}`)) n++; const alias = `f${n}`; used.add(alias); slot.fact = alias;
    const provenance = slot.provenance!;
    candidate.facts.push({ alias, scope: "REMINDER", field, value: slot.value, evidenceSlot: field, provenance: provenance.kind === "DERIVED_POLICY" ? { ...provenance, dependencies: [] } : provenance, sourceReferenceTime: slot.resolution!.referenceTime, dependencies: [] } as ContextSnapshotV1["facts"][number]);
  }
  return finish(null);
}

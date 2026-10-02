import type { BoundChatMessage, BoundChatContext } from "@/modules/reminders/command-service";
import { ContextInputSchema, SLOT_NAMES, type ContextInput, type EvidenceRef } from "./contracts";
import { ContextInputV2Schema, InterpretationJsonSchemaV3, type ContextInputV2 } from "./contracts";
import { ContextSnapshotV2Schema, encodeContextSnapshotV2, type ContextSnapshotV2 } from "./state";
import { ContextObservationBindingSchema, ContextSnapshotV1Schema, encodeContextSnapshot, type ContextObservation, type ContextSnapshotV1, type TranscriptEntry, type SourceEvidence } from "./state";
import { measureEnvelope, type EnvelopeMeasurement } from "./admission";
import { containsForbiddenControl, projectSemanticView } from "./projection";
export type ContextBuildArgs = { message: BoundChatMessage; context: BoundChatContext; snapshot: ContextSnapshotV1 | null; observation: ContextObservation };
export type ReadyContext = { status: "READY"; input: ContextInput; observation: ContextObservation; evidenceIndex: readonly TranscriptEntry[]; sourceMap: readonly TranscriptEntry["sourceMap"][]; candidateSnapshot: ContextSnapshotV1; candidateSnapshotJson: string; measurement: EnvelopeMeasurement };
export type ContextBuildResult = ReadyContext | { status: "REFUSED"; reason: string };
export type ContextBuildArgsV2 = Omit<ContextBuildArgs, "snapshot"> & { snapshot: ContextSnapshotV2 | null };
export type ReadyContextV2 = Omit<ReadyContext, "input" | "candidateSnapshot"> & { input: ContextInputV2; candidateSnapshot: ContextSnapshotV2 };
export type ContextBuildResultV2 = ReadyContextV2 | { status: "REFUSED"; reason: string };
type AnyReadyContext = Omit<ReadyContext, "input" | "candidateSnapshot"> & { input: ContextInput | ContextInputV2; candidateSnapshot: ContextSnapshotV1 | ContextSnapshotV2 };
/** A call-local alias binds two different representations to one source. Never
 * compare a supplied operand to the internal value, or persist the supplied
 * placeholder as user content. Source spans do not depend on quote occurrences. */
export interface BoundContextFact {
  supplied: ContextInput["facts"][number];
  internal: ContextSnapshotV1["facts"][number];
  sources: readonly SourceEvidence[];
  referenceTime: string;
}
type EvidenceContext = {
  snapshot: ContextSnapshotV1 | ContextSnapshotV2 | null;
  handles: string[];
  facts: ReadonlyMap<string, BoundContextFact>;
};
const builtContexts = new WeakMap<AnyReadyContext, EvidenceContext>();
/** @internal Only locally constructed, frozen payloads can validate evidence. */
export const evidenceContextFor = (built: ReadyContext) => builtContexts.get(built);
export const evidenceContextForV2 = (built: ReadyContextV2) => builtContexts.get(built);
function freeze<T>(value: T): T {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
export function buildContextInput(args: ContextBuildArgs): ContextBuildResult {
  const result = buildContext(args, false);
  if (result.status === "REFUSED") return result;
  const ready = freeze({ ...result, input: ContextInputSchema.parse(result.input), candidateSnapshot: ContextSnapshotV1Schema.parse(result.candidateSnapshot) });
  const evidence = builtContexts.get(result); if (evidence) builtContexts.set(ready, evidence);
  return ready;
}
export function buildContextInputV2(args: ContextBuildArgsV2): ContextBuildResultV2 {
  const result = buildContext(args, true);
  if (result.status === "REFUSED") return result;
  const ready = freeze({ ...result, input: ContextInputV2Schema.parse(result.input), candidateSnapshot: ContextSnapshotV2Schema.parse(result.candidateSnapshot) });
  const evidence = builtContexts.get(result); if (evidence) builtContexts.set(ready, evidence);
  return ready;
}
function buildContext(args: ContextBuildArgs | ContextBuildArgsV2, successor: boolean): AnyReadyContext | { status: "REFUSED"; reason: string } {
  const refused = (reason: string) => ({ status: "REFUSED" as const, reason });
  const stateSchema = successor ? ContextSnapshotV2Schema : ContextSnapshotV1Schema;
  const { message, context, observation } = args;
  if (!message.text.isWellFormed() || !Number.isFinite(message.receivedAt)) return refused("INPUT_INVALID");
  if (message.text.normalize("NFC").length > 1800) return refused("SEMANTIC_INPUT_TOO_LONG");
  const binding = ContextObservationBindingSchema.safeParse(observation);
  if (!binding.success) return refused("CONTEXT_UNAVAILABLE");
  const instant = new Date(message.receivedAt).toISOString();
  const scope = { ownerId: context.userId, workspaceId: context.workspaceId, chatIdentityId: context.chatIdentityId, connectionId: message.connectionId, chatId: message.privateChatId };
  const inbound = { id: message.id, receivedAt: instant, rowid: context.inboundRowId, claimMarker: message.claimMarker };
  const same = (a: object, b: object) => Object.entries(a).every(([key, value]) => (b as Record<string, unknown>)[key] === value);
  if (!same(scope, binding.data.scope) || !same(inbound, binding.data.inbound) || context.timezone !== "Asia/Ho_Chi_Minh") return refused("CONTEXT_SCOPE_MISMATCH");
  const stateResult = args.snapshot === null ? null : stateSchema.safeParse(args.snapshot);
  if (stateResult && !stateResult.success) return refused("CONTEXT_INVALID");
  const state = stateResult?.data ?? null;
  if (state ? binding.data.observed.presence !== "PRESENT" || binding.data.observed.contextId !== state.id || binding.data.observed.contextRevision !== state.contextRevision : binding.data.observed.presence !== "ABSENT") return refused("CONTEXT_STALE");
  const later = (a: { receivedAt: string; rowid: number }, b: { receivedAt: string; rowid: number }) => Date.parse(a.receivedAt) > Date.parse(b.receivedAt) || (a.receivedAt === b.receivedAt && a.rowid > b.rowid);
  if (binding.data.lastTerminalOutcome && !later(inbound, binding.data.lastTerminalOutcome.order)) return refused("CONTEXT_STALE");
  if (state) {
    if (!same(scope, state.scope)) return refused("CONTEXT_SCOPE_MISMATCH");
    if (state.requestId === null && (state.facts.some(f => f.scope === "REMINDER") || SLOT_NAMES.some(field => state.slots[field].state !== "MISSING"))) return refused("CONTEXT_INVALID");
    if (!later(inbound, state.inbound) || state.transcript.some(t => t.id === message.id)) return refused("CONTEXT_STALE");
    if (["COMPLETED", "CANCELLED", "EXPIRED", "INVALID"].includes(state.lifecycle)) return refused("CONTEXT_TERMINAL");
    if ([state.idleExpiresAt, state.absoluteExpiresAt, state.draftExpiresAt].some(t => t !== null && message.receivedAt >= Date.parse(t))) return refused("CONTEXT_EXPIRED");
    if (state.transcript.filter(t => t.role === "USER").length >= 6 || state.transcript.filter(t => t.role === "ASSISTANT").length > 6) return refused("CONTEXT_TURN_COUNT_EXCEEDED");
  }
  const handles = state?.controlRegistry.map(c => c.handle) ?? [];
  const current = projectSemanticView(message.text, handles);
  if (current.status === "REFUSED") return current;
  if (current.text.length > 1800) return refused("SEMANTIC_INPUT_TOO_LONG");
  const currentEntry: TranscriptEntry = { id: message.id, role: "USER", kind: "RECEIVED", deliveryState: "RECEIVED", text: message.text, semanticView: current.text, receivedAt: instant, messageRef: message.id, controlSpans: current.controlSpans, sourceMap: current.sourceMap };
  const evidenceIndex: TranscriptEntry[] = [];
  const retainedTranscript: TranscriptEntry[] = [];
  for (const t of [...(state?.transcript ?? []), currentEntry]) {
    const projection = projectSemanticView(t.text, handles, t.controlSpans);
    if (projection.status === "REFUSED") return projection;
    const projected = { ...t, semanticView: projection.text, sourceMap: projection.sourceMap, controlSpans: projection.controlSpans };
    retainedTranscript.push(projected);
    if (t.role === "USER" || t.deliveryState === "SENT") evidenceIndex.push(projected);
  }
  // The candidate retains the exact source while refreshing semantic maps.
  // Every accepted source span must still be representable, without controls.
  const remapSource = (e: SourceEvidence): SourceEvidence => {
    const t = retainedTranscript.find(t => t.id === e.sourceTurnId)!;
    const segments = t.sourceMap.segments.filter(s => s.sourceStart < e.sourceSpan.end && s.sourceEnd > e.sourceSpan.start);
    if (segments.some(s => s.kind === "CONTROL_REPLACEMENT")) fail("RETAINED_EVIDENCE_CONTROL_CONFLICT");
    const boundary = (p: number, s: typeof segments[number]) => {
      const offset = p - s.sourceStart;
      if (offset % s.sourceStride) fail("RETAINED_EVIDENCE_CONTROL_CONFLICT");
      return s.viewStart + offset / s.sourceStride * s.viewStride;
    };
    const start = boundary(e.sourceSpan.start, segments[0]), end = boundary(e.sourceSpan.end, segments.at(-1)!);
    if ([...t.semanticView].slice(start, end).join("") !== e.quote) fail("RETAINED_EVIDENCE_CONTROL_CONFLICT");
    let occurrence = 0, from = 0;
    const utf16Start = [...t.semanticView].slice(0, start).join("").length;
    for (;;) { const at = t.semanticView.indexOf(e.quote, from); if (at < 0 || at > utf16Start) fail("RETAINED_EVIDENCE_CONTROL_CONFLICT"); occurrence++; if (at === utf16Start) break; from = at + e.quote.length; }
    return { ...e, occurrence, viewSpan: { start, end } };
  };
  if (state) {
    try {
      for (const field of SLOT_NAMES) state.slots[field].evidence = state.slots[field].evidence.map(remapSource);
      if (state.pendingDecision?.candidate) {
        state.pendingDecision.candidate.sourceEvidence = state.pendingDecision.candidate.sourceEvidence.map(remapSource);
        state.pendingDecision.candidate.evidenceIndex.forEach(e => { e.evidence = e.evidence.map(remapSource); });
      }
      if ("pendingSemanticCandidate" in state && state.pendingSemanticCandidate) {
        state.pendingSemanticCandidate.sourceEvidence = state.pendingSemanticCandidate.sourceEvidence.map(remapSource);
        state.pendingSemanticCandidate.evidenceIndex.forEach(e => { e.evidence = e.evidence.map(remapSource); });
      }
    } catch (error) { return refused(error instanceof BuildFailure ? error.message : "CONTEXT_INVALID"); }
  }
  const originalFacts = state?.facts ?? [];
  const aliases = new Map(originalFacts.map((f, i) => [f.alias, `f${i + 1}`]));
  const facts = new Map<string, BoundContextFact>();

  // Resolve the OLD reference once into a stable source span. Both refreshed
  // representations derive their indexes/occurrences from that same span.
  const sourceForRetainedQuote = (ref: Extract<EvidenceRef, { kind: "USER_QUOTE" }>): SourceEvidence => {
    const source = state?.transcript[ref.turn];
    if (source?.role !== "USER") fail("CONTEXT_FACT_INVALID");
    let position = -1, from = 0;
    for (let n = 0; n < ref.occurrence; n++) {
      position = source.semanticView.indexOf(ref.quote, from);
      if (position < 0) fail("CONTEXT_FACT_INVALID");
      from = position + ref.quote.length;
    }
    const start = [...source.semanticView.slice(0, position)].length;
    const end = start + [...ref.quote].length;
    const segments = source.sourceMap.segments.filter(s => s.viewStart < end && s.viewEnd > start);
    if (!segments.length || segments.some(s => s.kind === "CONTROL_REPLACEMENT")) fail("RETAINED_EVIDENCE_CONTROL_CONFLICT");
    const boundary = (point: number, segment: typeof segments[number]) => {
      const offset = point - segment.viewStart;
      if (offset % segment.viewStride) fail("CONTEXT_FACT_INVALID");
      return segment.sourceStart + offset / segment.viewStride * segment.sourceStride;
    };
    return remapSource({
      kind: "USER_QUOTE", sourceTurnId: source.id, sourceMapTurnId: source.id,
      quote: ref.quote, occurrence: ref.occurrence, normalizationVersion: "nfc-codepoint-v1",
      viewSpan: { start, end },
      sourceSpan: { start: boundary(start, segments[0]), end: boundary(end, segments.at(-1)!) },
    });
  };
  const remapRefs = (value: unknown, target: "INTERNAL" | "PROVIDER"): unknown => {
    if (Array.isArray(value)) return value.map(v => remapRefs(v, target));
    if (value && typeof value === "object") {
      if ("kind" in value && value.kind === "USER_QUOTE" && "turn" in value && typeof value.turn === "number") {
        if (!("quote" in value) || typeof value.quote !== "string" || !("occurrence" in value) || typeof value.occurrence !== "number") fail("CONTEXT_FACT_INVALID");
        const mapped = sourceForRetainedQuote({ kind: "USER_QUOTE", turn: value.turn, quote: value.quote, occurrence: value.occurrence });
        const targetTranscript = target === "INTERNAL" ? retainedTranscript : evidenceIndex;
        const turn = targetTranscript.findIndex(t => t.id === mapped.sourceTurnId);
        if (turn < 0) fail("CONTEXT_FACT_INVALID");
        return { ...value, turn, occurrence: mapped.occurrence };
      }
      return Object.fromEntries(Object.entries(value).map(([key, v]) => [key,
        key === "ref" && typeof v === "string" && target === "PROVIDER"
          ? aliases.get(v) ?? fail("CONTEXT_FACT_INVALID") : remapRefs(v, target),
      ]));
    }
    return value;
  };
  try {
    const checked = new Set<string>();
    const checkDependencies = (fact: typeof originalFacts[number], visiting = new Set<string>()) => {
      if (visiting.has(fact.alias)) fail("CONTEXT_FACT_INVALID");
      if (checked.has(fact.alias)) return;
      visiting.add(fact.alias);
      const dependencies = [...fact.dependencies, ...(fact.provenance.kind === "DERIVED_POLICY" ? fact.provenance.dependencies : [])];
      for (const alias of dependencies) {
        const dependency = originalFacts.find(f => f.alias === alias);
        if (!dependency || dependency.scope !== fact.scope) fail("CONTEXT_FACT_INVALID");
        checkDependencies(dependency, visiting);
      }
      visiting.delete(fact.alias); checked.add(fact.alias);
    };
    originalFacts.forEach(f => checkDependencies(f));
    const projectedFacts = originalFacts.map(f => {
      if (f.scope === "REMINDER") {
        const slot = state!.slots[f.field];
        if (slot.state !== "RESOLVED" || slot.provenance?.kind !== f.provenance.kind) fail("CONTEXT_FACT_INVALID");
        if (f.provenance.kind === "EXPLICIT_USER" && !slot.evidence.some(e => state!.transcript.find(t => t.id === e.sourceTurnId)?.receivedAt === f.sourceReferenceTime)) fail("CONTEXT_FACT_INVALID");
        if (f.provenance.kind === "DERIVED_POLICY" && (slot.provenance?.kind !== "DERIVED_POLICY" || slot.provenance.policyVersion !== f.provenance.policyVersion || slot.provenance.referenceTime !== f.provenance.referenceTime || f.sourceReferenceTime !== f.provenance.referenceTime)) fail("CONTEXT_FACT_INVALID");
      } else {
        if (f.value.evidence.some(e => e.kind !== "USER_QUOTE")) fail("CONTEXT_FACT_INVALID");
        if (f.provenance.kind === "EXPLICIT_USER" && !f.value.evidence.some(e => e.kind === "USER_QUOTE" && state!.transcript[e.turn]?.receivedAt === f.sourceReferenceTime)) fail("CONTEXT_FACT_INVALID");
      }
      const alias = aliases.get(f.alias)!;
      const dependencies = f.dependencies.map(d => aliases.get(d) ?? fail("CONTEXT_FACT_INVALID"));
      const provenance = f.provenance.kind === "DERIVED_POLICY" ? { ...f.provenance, dependencies: f.provenance.dependencies.map(d => aliases.get(d) ?? fail("CONTEXT_FACT_INVALID")) } : f.provenance;
      return { alias, scope: f.scope, field: f.field, value: remapRefs(f.value, "PROVIDER"), provenance, sourceReferenceTime: f.sourceReferenceTime, dependencies };
    });
    const active = state && ["CLARIFYING", "AWAITING_CONFIRMATION"].includes(state.lifecycle) ? { lifecycle: state.lifecycle, slots: Object.fromEntries(SLOT_NAMES.map(field => {
      const slot = state.slots[field];
      const fact = originalFacts.find(f => f.scope === "REMINDER" && f.field === field);
      if (slot.state === "RESOLVED" && !fact) fail("CONTEXT_FACT_INVALID");
      return [field, { state: slot.state, value: slot.value, fact: fact ? aliases.get(fact.alias) : null }];
    })) } : null;
    const questions = [state?.pendingQueryQuestion, state?.pendingReminderQuestion].filter(q => q?.deliveryState === "SENT" && !later(q.issuedAfterOrder, inbound));
    // Latest query question takes priority; assistant receipt is never evidence.
    const question = questions[0];
    const raw = {
      schemaVersion: successor ? "calenote-context-input-2" : "calenote-context-input-1",
      reference: { instant, localDate: new Date(message.receivedAt + 7 * 3600000).toISOString().slice(0, 10), timezone: "Asia/Ho_Chi_Minh" },
      turns: evidenceIndex.map(t => ({ role: t.role, text: t.semanticView })),
      currentTurn: evidenceIndex.length - 1,
      activeRequest: active,
      facts: projectedFacts,
      pendingQuestion: question ? { text: question.text, scope: question.scope, field: question.field, decisionKind: question.decisionKind, reason: question.reason } : null,
      ambiguities: remapRefs(state?.ambiguities ?? [], "PROVIDER"),
      capabilities: { version: "capabilities-1", supported: ["ONCE", "FINITE_DAILY", "LIST", "CALENDAR_DATE", "CAPABILITY"], unsupported: ["WEEKLY", "MONTHLY", "YEARLY", "HOUR_OFFSET"], calendars: ["GREGORIAN", "LUNAR_VN"], limits: { dailyCount: 30, horizonDays: 366 } },
    };
    // Turns were already projected with maps. Project every other string too,
    // without running a second pass over the deliberately inserted placeholder.
    const project = (v: unknown): unknown => {
      if (typeof v === "string") { const p = projectSemanticView(v, handles); if (p.status === "REFUSED") fail(p.reason); return p.status === "READY" ? p.text : ""; }
      if (Array.isArray(v)) return v.map(project);
      if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, project(x)]));
      return v;
    };
    const input = (successor ? ContextInputV2Schema : ContextInputSchema).parse({ ...raw, activeRequest: project(raw.activeRequest), facts: project(raw.facts), pendingQuestion: project(raw.pendingQuestion), ambiguities: project(raw.ambiguities) });
    if (containsForbiddenControl(input, handles)) return refused("CONTROL_PROJECTION_AMBIGUOUS");

    // Refresh internal references BEFORE encoding. Internal turn indexes retain
    // failed assistant entries; provider indexes deliberately exclude them.
    const pendingDecision = state?.pendingDecision;
    const refreshedDecision = pendingDecision?.candidate ? {
      ...pendingDecision,
      candidate: {
        ...pendingDecision.candidate,
        proposal: remapRefs(pendingDecision.candidate.proposal, "INTERNAL"),
      },
    } : pendingDecision;
    const retainedCandidate = state && "pendingSemanticCandidate" in state ? state.pendingSemanticCandidate : null;
    const candidateSnapshot = stateSchema.parse(state ? {
      ...state, inbound, transcript: retainedTranscript, modelAttemptBinding: null, webDeclineReceipt: null,
      facts: remapRefs(state.facts, "INTERNAL"),
      ambiguities: remapRefs(state.ambiguities, "INTERNAL"),
      pendingDecision: refreshedDecision,
      ...(successor ? { pendingSemanticCandidate: retainedCandidate ? { ...retainedCandidate, proposal: remapRefs(retainedCandidate.proposal, "INTERNAL") } : null } : {}),
    } : {
      schemaVersion: successor ? "calenote-context-state-2" : "calenote-context-state-1", id: message.id, scope, inbound,
      requestId: null, contextRevision: 1, draftRevision: null, lifecycle: "NONE",
      slots: Object.fromEntries(SLOT_NAMES.map(field => [field, { state: "MISSING", value: null, fact: null, evidence: [], provenance: null, resolution: null, proposalRevision: 1 }])),
      facts: [], pendingReminderQuestion: null, pendingQueryQuestion: null, ambiguities: [],
      transcript: [currentEntry], pendingDecision: null, previewReceipt: null, controlRegistry: [],
      modelAttemptBinding: null, lastTerminalOutcome: binding.data.lastTerminalOutcome,
      ...(successor ? { pendingSemanticCandidate: null } : {}),
      createdAt: instant,
      idleExpiresAt: new Date(message.receivedAt + 1800000).toISOString(),
      absoluteExpiresAt: new Date(message.receivedAt + 7200000).toISOString(),
      draftCreatedAt: null, draftExpiresAt: null, capabilityVersion: "capabilities-1",
    });
    const candidateSnapshotJson = candidateSnapshot.schemaVersion === "calenote-context-state-2" ? encodeContextSnapshotV2(candidateSnapshot) : encodeContextSnapshot(candidateSnapshot);
    if (new TextEncoder().encode(candidateSnapshotJson).length > 16384) return refused("CONTEXT_SNAPSHOT_TOO_LARGE");

    for (const [index, original] of originalFacts.entries()) {
      const sources = original.scope === "REMINDER" ? state!.slots[original.field].evidence
        : original.value.evidence.map(ref => ref.kind === "USER_QUOTE" ? sourceForRetainedQuote(ref) : fail("CONTEXT_FACT_INVALID"));
      const supplied = input.facts[index];
      facts.set(supplied.alias, freeze({
        supplied,
        internal: candidateSnapshot.facts[index],
        sources,
        referenceTime: original.sourceReferenceTime,
      }));
    }
    // A2 has no successor prompt/dispatch. Measure its actual local envelope;
    // prompt/framing stay absent and token admission stays explicitly refused.
    const measurement = input.schemaVersion === "calenote-context-input-1" ? measureEnvelope(input, candidateSnapshotJson) : measureSuccessorEnvelope(input, candidateSnapshotJson);
    const localReason = measurement.reasons.find(r => r !== "TOKEN_BOUND_UNVERIFIED");
    if (localReason) return refused(localReason);
    const ready: AnyReadyContext = freeze({ status: "READY", input, observation, evidenceIndex, sourceMap: evidenceIndex.map(t => t.sourceMap), candidateSnapshot, candidateSnapshotJson, measurement });
    builtContexts.set(ready, { snapshot: state ? candidateSnapshot : null, handles, facts });
    return ready;
  } catch (error) { return refused(error instanceof BuildFailure ? error.message : "CONTEXT_INVALID"); }
}
function measureSuccessorEnvelope(input: ContextInputV2, snapshotJson: string): EnvelopeMeasurement {
  const counts = (text: string) => ({ utf16Units: text.length, codePoints: [...text].length });
  const bytes = (text: string) => new TextEncoder().encode(text).length;
  return { current: counts(input.turns[input.currentTurn].text), turns: input.turns.map(t => ({ role: t.role, ...counts(t.text) })),
    bytes: { snapshot: bytes(snapshotJson), prompt: 0, schema: bytes(JSON.stringify(InterpretationJsonSchemaV3)), input: bytes(JSON.stringify(input)), request: 0, framing: 0, output: null },
    tokenMethod: "gemini-2.5-flash-lite:UNVERIFIED", inputTokens: null, outputTokens: null, serverFramingTokens: null, admitted: false, reasons: ["TOKEN_BOUND_UNVERIFIED"] };
}
class BuildFailure extends Error {}
function fail(reason: string): never { throw new BuildFailure(reason); }

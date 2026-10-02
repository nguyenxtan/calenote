import { z } from "zod";
import type { SessionPrincipal } from "@/modules/auth/session";
import type { ConversationScope } from "../contracts";
import { CalendarSchema, contextFactSchema, SemanticPatchProposalSchema, DateOperandSchema, SLOT_NAMES, SlotNameSchema, SlotValueSchemas, UncertaintySchema } from "./contracts";
import { SemanticPatchProposalV3Schema, UncertaintyV3Schema } from "./contracts";

const id = z.string().min(1).max(512);
const revision = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const index = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const instant = z.iso.datetime();
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const nfc = (max: number) => z.string().max(max * 2).refine(v => v.isWellFormed() && v === v.normalize("NFC") && [...v].length <= max);
const span = z.strictObject({ start: index, end: index }).refine(v => v.end > v.start, "Empty/reversed span");
export const InboundOrderSchema = z.strictObject({ receivedAt: instant, rowid: revision });
export type InboundOrder = z.infer<typeof InboundOrderSchema>;
export const ContextScopeSchema = z.strictObject({ ownerId: id, chatIdentityId: id, workspaceId: id, connectionId: id, chatId: id });
export type ContextScope = z.infer<typeof ContextScopeSchema>;
const inbound = z.strictObject({ id, receivedAt: instant, rowid: revision, claimMarker: id });
const delivery = z.enum(["SENT", "FAILED", "UNCERTAIN"]);
const decisionKind = z.enum(["SAVE_PREVIEW", "REPLACE_PENDING", "ACCEPT_ONE_TIME_ALTERNATIVE", "RESUME_PENDING", "RESTART_PENDING"]);
const provenance = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("EXPLICIT_USER") }),
  z.strictObject({ kind: z.literal("DERIVED_POLICY"), policyVersion: id, dependencies: z.array(SlotNameSchema).max(13), referenceTime: instant }),
]);
export type SlotProvenance = z.infer<typeof provenance>;
const resolution = z.strictObject({ method: z.enum(["EXPLICIT_OPERAND", "POLICY_DEFAULT", "CALENDAR_CONVERSION", "EVENT_RELATIVE", "FINITE_RANGE"]), version: id, referenceTime: instant, timezone: z.literal("Asia/Ho_Chi_Minh"), dependencies: z.array(SlotNameSchema).max(13) });
export const SourceEvidenceSchema = z.strictObject({ kind: z.literal("USER_QUOTE"), sourceTurnId: id, sourceMapTurnId: id, quote: nfc(2000).min(1), occurrence: revision, sourceSpan: span, viewSpan: span, normalizationVersion: z.literal("nfc-codepoint-v1") });
export type SourceEvidence = z.infer<typeof SourceEvidenceSchema>;
export interface Slot<T> {
  state: "MISSING" | "PROPOSED" | "RESOLVED" | "CONFLICT";
  value: T | null;
  fact: string | null;
  evidence: SourceEvidence[];
  provenance: SlotProvenance | null;
  resolution: z.infer<typeof resolution> | null;
  proposalRevision: number;
}
function slot<T extends z.ZodType>(value: T) {
  return z.strictObject({ state: z.enum(["MISSING", "PROPOSED", "RESOLVED", "CONFLICT"]), value: value.nullable(), fact: z.string().regex(/^f[1-9][0-9]*$/u).max(16).nullable(), evidence: z.array(SourceEvidenceSchema).max(3), provenance: provenance.nullable(), resolution: resolution.nullable(), proposalRevision: revision }).superRefine((s, ctx) => {
    const v = "value" in s ? s.value : undefined;
    if (s.state === "MISSING" ? v !== null || s.fact !== null || s.provenance !== null || s.resolution !== null : s.state === "RESOLVED" && (v === null || s.provenance === null || s.resolution === null)) ctx.addIssue({ code: "custom", message: "Invalid slot state" });
    if (v !== null && s.provenance?.kind === "EXPLICIT_USER" && s.evidence.length === 0) ctx.addIssue({ code: "custom", message: "Explicit fact requires source evidence" });
  });
}
export const SlotsSchema = z.strictObject({ title: slot(SlotValueSchemas.title), location: slot(SlotValueSchemas.location), notes: slot(SlotValueSchemas.notes), eventDate: slot(SlotValueSchemas.eventDate), eventTime: slot(SlotValueSchemas.eventTime), reminderDate: slot(SlotValueSchemas.reminderDate), reminderTime: slot(SlotValueSchemas.reminderTime), calendar: slot(SlotValueSchemas.calendar), frequency: slot(SlotValueSchemas.frequency), occurrenceCount: slot(SlotValueSchemas.occurrenceCount), eventRelation: slot(SlotValueSchemas.eventRelation), leadOffsetDays: slot(SlotValueSchemas.leadOffsetDays), endDate: slot(SlotValueSchemas.endDate) });
export type ContextSlots = z.infer<typeof SlotsSchema>;

export const SourceMapSchema = z.strictObject({ normalizationVersion: z.literal("nfc-codepoint-v1"), sourceCodePoints: index, viewCodePoints: index, segments: z.array(z.strictObject({ sourceStart: index, sourceEnd: index, viewStart: index, viewEnd: index, kind: z.enum(["UNCHANGED", "NFC_COMPOSITION_RUN", "CONTROL_REPLACEMENT"]), sourceStride: index, viewStride: index })).max(128) }).superRefine((m, ctx) => {
  let sourceEnd = 0, viewEnd = 0;
  for (const segment of m.segments) {
    if (segment.sourceStart !== sourceEnd || segment.viewStart !== viewEnd || segment.sourceEnd <= sourceEnd || segment.viewEnd <= viewEnd || (segment.kind === "UNCHANGED" && (segment.sourceStride !== 1 || segment.viewStride !== 1 || segment.sourceEnd - sourceEnd !== segment.viewEnd - viewEnd)) || (segment.kind === "NFC_COMPOSITION_RUN" && (segment.sourceStride < 1 || segment.viewStride < 1 || (segment.sourceEnd - sourceEnd) / segment.sourceStride !== (segment.viewEnd - viewEnd) / segment.viewStride))) ctx.addIssue({ code: "custom", message: "Invalid contiguous source map" });
    sourceEnd = segment.sourceEnd; viewEnd = segment.viewEnd;
  }
  if (sourceEnd !== m.sourceCodePoints || viewEnd !== m.viewCodePoints) ctx.addIssue({ code: "custom", message: "Incomplete source map" });
});
export type SourceMap = z.infer<typeof SourceMapSchema>;
const turnFields = { id, text: z.string().max(32768).refine(v => v.isWellFormed()), receivedAt: instant, messageRef: id.nullable(), semanticView: nfc(16384), controlSpans: z.array(z.strictObject({ start: index, end: index, handle: id })).max(32), sourceMap: SourceMapSchema };
export const TranscriptEntrySchema = z.discriminatedUnion("role", [
  z.strictObject({ ...turnFields, role: z.literal("USER"), kind: z.literal("RECEIVED"), deliveryState: z.literal("RECEIVED") }),
  z.strictObject({ ...turnFields, role: z.literal("ASSISTANT"), kind: z.enum(["CLARIFICATION", "PREVIEW", "DECISION", "QUERY_RESULT", "RECOVERY", "NOTICE"]), deliveryState: delivery }),
]).superRefine((t, ctx) => {
  const source = [...t.text], view = [...t.semanticView];
  if (source.length !== t.sourceMap.sourceCodePoints || view.length !== t.sourceMap.viewCodePoints || (t.role === "USER" && ([...t.text.normalize("NFC")].length > 2000 || view.length > 2000))) ctx.addIssue({ code: "custom", message: "Transcript/source map length mismatch" });
  for (const s of t.sourceMap.segments) if (s.kind !== "CONTROL_REPLACEMENT" && source.slice(s.sourceStart, s.sourceEnd).join("").normalize("NFC") !== view.slice(s.viewStart, s.viewEnd).join("")) ctx.addIssue({ code: "custom", message: "Source map changes ordinary content" });
  for (const s of t.controlSpans) if (s.end <= s.start || s.end > source.length) ctx.addIssue({ code: "custom", message: "Invalid control span" });
});
export type TranscriptEntry = z.infer<typeof TranscriptEntrySchema>;
const questionFields = { questionId: id, text: nfc(2000).min(1), decisionKind: decisionKind.nullable(), reason: z.enum(["MISSING", "AMBIGUOUS", "CONFLICT", "UNSUPPORTED_COMBINATION"]), noProgressCount: z.number().int().min(0).max(3), deliveryState: delivery, issuedAfterOrder: InboundOrderSchema };
const reminderQuestion = z.strictObject({ ...questionFields, scope: z.literal("REMINDER"), field: z.enum([...SLOT_NAMES, "intent", "operation"]) });
const queryQuestion = z.strictObject({ ...questionFields, scope: z.literal("QUERY"), field: z.enum(["queryRange", "intent", "operation"]) });
const target = z.strictObject({ ownerId: id, chatIdentityId: id, chatId: id, requestId: id.nullable(), proposalId: id.nullable() }).refine(t => t.requestId !== null || t.proposalId !== null, "Decision has no target");
export const PreviewReceiptSchema = z.strictObject({ previewId: id, requestId: id, draftRevision: revision, draftHash: hash, ownerId: id, chatIdentityId: id, chatId: id, channel: z.enum(["ZALO", "TELEGRAM", "WEB"]), issuedAfterOrder: InboundOrderSchema, expiresAt: instant, deliveryState: delivery, replyReference: id.nullable() });
export type PreviewReceipt = z.infer<typeof PreviewReceiptSchema>;
const candidate = z.strictObject({ proposalId: id, proposalRevision: revision, proposal: SemanticPatchProposalSchema, sourceEvidence: z.array(SourceEvidenceSchema).min(1).max(3), evidenceIndex: z.array(z.strictObject({ field: SlotNameSchema, evidence: z.array(SourceEvidenceSchema).min(1).max(3) })).max(13), createdAt: instant, expiresAt: instant });
const candidateV3 = candidate.extend({ proposal: SemanticPatchProposalV3Schema });
const decisionBase = z.strictObject({ decisionId: id, kind: decisionKind, target, questionId: id, previewId: id.nullable(), draftRevision: revision.nullable(), contextRevision: revision, issuedAfterInbound: InboundOrderSchema, deliveryState: delivery, expiresAt: instant, acceptedReplies: z.array(z.enum(["có", "ok", "1", "xác nhận"])).min(1).max(4), replyReference: id.nullable(), tokenHandle: id.nullable(), candidate: candidate.nullable() });
const decisionV2Base = decisionBase.extend({ candidate: candidateV3.nullable() });
function validateDecision(d: z.infer<typeof decisionBase> | z.infer<typeof decisionV2Base>, ctx: z.RefinementCtx) {
  if (new Set(d.acceptedReplies).size !== d.acceptedReplies.length || (d.kind !== "SAVE_PREVIEW" && d.acceptedReplies.includes("xác nhận"))) ctx.addIssue({ code: "custom", message: "Invalid decision replies" });
  if (d.kind === "SAVE_PREVIEW" && (d.previewId === null || d.draftRevision === null || d.target.requestId === null || d.candidate !== null)) ctx.addIssue({ code: "custom", message: "Save requires a preview and draft binding" });
  if (d.candidate && (!["REPLACE_PENDING", "ACCEPT_ONE_TIME_ALTERNATIVE"].includes(d.kind) || d.target.proposalId !== d.candidate.proposalId || Date.parse(d.expiresAt) > Date.parse(d.candidate.expiresAt))) ctx.addIssue({ code: "custom", message: "Candidate binding mismatch" });
  if (["REPLACE_PENDING", "ACCEPT_ONE_TIME_ALTERNATIVE"].includes(d.kind) && !d.candidate) ctx.addIssue({ code: "custom", message: "Decision requires candidate" });
}
export const PendingDecisionSchema = decisionBase.superRefine(validateDecision);
export const PendingDecisionV2Schema = decisionV2Base.superRefine(validateDecision);
export type PendingDecision = z.infer<typeof PendingDecisionSchema>;
const terminal = z.strictObject({ outcomeId: id, status: z.enum(["COMPLETED", "CANCELLED", "EXPIRED", "INVALID"]), contextId: id, contextRevision: revision, inboundId: id, order: InboundOrderSchema });
export const ContextObservationBindingSchema = z.strictObject({ scope: ContextScopeSchema, inbound, observed: z.discriminatedUnion("presence", [z.strictObject({ presence: z.literal("ABSENT") }), z.strictObject({ presence: z.literal("PRESENT"), contextId: id, contextRevision: revision })]), lastTerminalOutcome: terminal.nullable() });
/** Only a store may mint this capability after an authoritative read. There is
 * deliberately no JSON parser or public factory returning the branded type. */
declare const observationBrand: unique symbol;
type DeepReadonly<T> = T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T;
export type ContextObservation = DeepReadonly<z.infer<typeof ContextObservationBindingSchema>> & { readonly [observationBrand]: true };
/** Only supplied after existing chat/session authentication. T4 rechecks owner
 * and expiry transactionally; these are never provider operands. */
export type ControlAuthority = { kind: "CHAT"; scope: ConversationScope } | { kind: "WEB"; principal: SessionPrincipal; chat: ContextScope };
const attempt = z.strictObject({ attemptId: id, observationId: id, contextRevision: revision.nullable(), sourceInboundId: id, claimMarker: id, inputDigest: hash, promptDigest: hash, contractDigest: hash, contractVersion: z.literal("calenote-context-2"), status: z.enum(["PREPARED", "DISPATCHED", "RECEIVED", "REJECTED", "ACCEPTED", "UNCERTAIN"]) });
const control = z.strictObject({ handle: id, kind: z.enum(["TOKEN", "ACTION_URL", "OPAQUE_HANDLE", "CONTROL_ID"]), ownerId: id, chatIdentityId: id, chatId: id, decisionId: id, contextRevision: revision, draftRevision: revision.nullable(), expiresAt: instant });

const snapshotV1Base = z.strictObject({
  schemaVersion: z.literal("calenote-context-state-1"), id, scope: ContextScopeSchema, inbound, requestId: id.nullable(), contextRevision: revision, draftRevision: revision.nullable(), lifecycle: z.enum(["NONE", "CLARIFYING", "AWAITING_CONFIRMATION", "COMPLETED", "CANCELLED", "EXPIRED", "INVALID"]),
  slots: SlotsSchema, facts: z.array(contextFactSchema({ evidenceSlot: SlotNameSchema.nullable() })).max(26), pendingReminderQuestion: reminderQuestion.nullable(), pendingQueryQuestion: queryQuestion.nullable(), ambiguities: z.array(UncertaintySchema).max(4), transcript: z.array(TranscriptEntrySchema).max(12), pendingDecision: PendingDecisionSchema.nullable(), previewReceipt: PreviewReceiptSchema.nullable(), controlRegistry: z.array(control).max(32), modelAttemptBinding: attempt.nullable(), lastTerminalOutcome: terminal.nullable(), createdAt: instant, idleExpiresAt: instant, absoluteExpiresAt: instant, draftCreatedAt: instant.nullable(), draftExpiresAt: instant.nullable(), capabilityVersion: id,
  webDeclineReceipt: z.strictObject({ publicId: z.string().regex(/^[A-Za-z0-9_-]{22}$/u), operationKey: hash, proofHash: hash, settledRevision: revision, settledAt: instant }).nullable().optional(),
});
const pendingSemanticCandidate = candidateV3.extend({ baseContextRevision: revision, questionId: id });
const snapshotV2Base = snapshotV1Base.extend({
  schemaVersion: z.literal("calenote-context-state-2"),
  pendingDecision: PendingDecisionV2Schema.nullable(),
  pendingSemanticCandidate: pendingSemanticCandidate.nullable(),
  ambiguities: z.array(UncertaintyV3Schema).max(4),
  modelAttemptBinding: attempt.extend({ contractVersion: z.literal("calenote-context-3") }).nullable(),
});
function validateSnapshot(s: z.infer<typeof snapshotV1Base> | z.infer<typeof snapshotV2Base>, ctx: z.RefinementCtx) {
  const fail = (message: string) => ctx.addIssue({ code: "custom", message });
  const created = Date.parse(s.createdAt), absolute = Date.parse(s.absoluteExpiresAt), idle = Date.parse(s.idleExpiresAt), latest = Date.parse(s.inbound.receivedAt);
  if (s.webDeclineReceipt && (s.webDeclineReceipt.settledRevision !== s.contextRevision || s.lifecycle !== "CLARIFYING" || s.pendingDecision !== null || s.previewReceipt !== null || Date.parse(s.webDeclineReceipt.settledAt) < latest || Date.parse(s.webDeclineReceipt.settledAt) >= absolute)) fail("Invalid web decline receipt");
  if (absolute <= created || absolute > created + 7200000 || idle <= created || idle > absolute || idle > latest + 1800000 || latest < created) fail("Invalid context lifetime");
  if (s.requestId === null ? s.draftRevision !== null || s.draftCreatedAt !== null || s.draftExpiresAt !== null : s.draftRevision === null || s.draftCreatedAt === null || s.draftExpiresAt === null) fail("Incomplete draft identity/lifetime");
  if (s.draftCreatedAt && s.draftExpiresAt && (Date.parse(s.draftCreatedAt) < created || Date.parse(s.draftExpiresAt) <= Date.parse(s.draftCreatedAt) || Date.parse(s.draftExpiresAt) > Date.parse(s.draftCreatedAt) + 600000 || Date.parse(s.draftExpiresAt) > absolute)) fail("Invalid draft lifetime");
  if (["CLARIFYING", "AWAITING_CONFIRMATION"].includes(s.lifecycle) && s.requestId === null) fail("Active lifecycle needs a request");
  if (new Set(s.transcript.map(t => t.id)).size !== s.transcript.length || ["USER", "ASSISTANT"].some(role => s.transcript.filter(t => t.role === role).length > 6)) fail("Invalid transcript identity/role bounds");
  for (const [i, t] of s.transcript.entries()) if (Date.parse(t.receivedAt) < Date.parse(s.transcript[i - 1]?.receivedAt ?? s.createdAt) || Date.parse(t.receivedAt) > latest) fail("Invalid transcript order");
  const checkEvidence = (e: SourceEvidence) => {
    const t = s.transcript.find(t => t.id === e.sourceTurnId);
    if (!t || t.role !== "USER" || e.sourceMapTurnId !== t.id || e.sourceSpan.end > t.sourceMap.sourceCodePoints || e.viewSpan.end > t.sourceMap.viewCodePoints || [...t.semanticView].slice(e.viewSpan.start, e.viewSpan.end).join("") !== e.quote || [...t.text].slice(e.sourceSpan.start, e.sourceSpan.end).join("").normalize("NFC") !== e.quote || t.sourceMap.segments.some(segment => segment.kind === "CONTROL_REPLACEMENT" && segment.viewStart < e.viewSpan.end && segment.viewEnd > e.viewSpan.start)) fail("Missing/invalid retained user evidence");
  };
  for (const field of SLOT_NAMES) { const slot = s.slots[field]; slot.evidence.forEach(checkEvidence); if (s.draftRevision !== null && slot.proposalRevision > s.draftRevision) fail("Future slot revision"); }
  if (new Set(s.facts.map(f => f.alias)).size !== s.facts.length) fail("Duplicate fact alias");
  for (const f of s.facts) if (f.scope === "REMINDER" && (f.evidenceSlot !== f.field || !SLOT_NAMES.includes(f.field as typeof SLOT_NAMES[number]) || JSON.stringify(s.slots[f.evidenceSlot!].value) !== JSON.stringify(f.value))) fail("Fact/slot mismatch");
  const ownerMatches = (t: { ownerId: string; chatIdentityId: string; chatId: string }) => t.ownerId === s.scope.ownerId && t.chatIdentityId === s.scope.chatIdentityId && t.chatId === s.scope.chatId;
  const boundExpiry = Math.min(idle, absolute, s.draftExpiresAt ? Date.parse(s.draftExpiresAt) : absolute);
  const checkSuccessorCandidate = (c: z.infer<typeof candidateV3>) => {
    const sources = [...c.sourceEvidence, ...c.evidenceIndex.flatMap(e => e.evidence)];
    sources.forEach(checkEvidence);
    for(const e of sources) {
      const t=s.transcript.find(t=>t.id===e.sourceTurnId);
      if(!t)continue;
      const segments=t.sourceMap.segments.filter(segment=>segment.sourceStart<e.sourceSpan.end && segment.sourceEnd>e.sourceSpan.start);
      const boundary=(point:number,segment:SourceMap["segments"][number]|undefined):number|null=>{
        if(!segment || segment.kind==="CONTROL_REPLACEMENT" || segment.sourceStride===0)return null;
        const offset=point-segment.sourceStart;
        return offset%segment.sourceStride===0 ? segment.viewStart+offset/segment.sourceStride*segment.viewStride : null;
      };
      if(boundary(e.sourceSpan.start,segments[0])!==e.viewSpan.start || boundary(e.sourceSpan.end,segments.at(-1))!==e.viewSpan.end)fail("Candidate source map mismatch");
      let count=0,from=0,found=-1;
      while(count<e.occurrence) { found=t.semanticView.indexOf(e.quote,from); if(found<0)break; count++;from=found+e.quote.length; }
      if(count!==e.occurrence || [...t.semanticView.slice(0,found)].length!==e.viewSpan.start)fail("Candidate quote occurrence mismatch");
    }
    if(Date.parse(c.createdAt)<created || Date.parse(c.createdAt)>latest || Date.parse(c.expiresAt)<=Date.parse(c.createdAt) || Date.parse(c.expiresAt)>boundExpiry)fail("Candidate lifetime mismatch");
    const refs = (v: unknown): void => {
      if(Array.isArray(v)){v.forEach(refs);return;}
      if(!v || typeof v!=="object")return;
      if("kind"in v && v.kind==="USER_QUOTE" && "turn"in v && typeof v.turn==="number" && "quote"in v && typeof v.quote==="string" && "occurrence"in v) {
        const t=s.transcript[v.turn];
        if(!t || t.role!=="USER" || !sources.some(e=>e.sourceTurnId===t.id && e.quote===v.quote && e.occurrence===v.occurrence))fail("Candidate source reference mismatch");
      }else if("kind"in v && v.kind==="CONTEXT_FACT" && "ref"in v && !s.facts.some(f=>f.alias===v.ref))fail("Candidate fact reference mismatch");
      Object.values(v).forEach(refs);
    };
    refs(c.proposal);
  };
  if ("pendingSemanticCandidate" in s && s.pendingSemanticCandidate) {
    const c = s.pendingSemanticCandidate, q = s.pendingReminderQuestion;
    if (!q || q.field !== "operation" || q.questionId !== c.questionId || q.decisionKind !== null
      || Date.parse(q.issuedAfterOrder.receivedAt)>latest || (q.issuedAfterOrder.receivedAt===s.inbound.receivedAt && q.issuedAfterOrder.rowid>s.inbound.rowid)
      || c.baseContextRevision !== s.contextRevision || c.proposalRevision > s.contextRevision
      || c.proposal.requestTarget?.kind !== "UNRESOLVED" || s.pendingDecision !== null
      || !["NONE", "CLARIFYING"].includes(s.lifecycle)
      || Date.parse(c.createdAt) < created || Date.parse(c.createdAt) > latest
      || Date.parse(c.expiresAt) <= latest || Date.parse(c.expiresAt) > boundExpiry) fail("Unresolved candidate binding mismatch");
    checkSuccessorCandidate(c);
  }
  const preview = s.previewReceipt;
  if (preview && (!ownerMatches(preview) || preview.requestId !== s.requestId || preview.draftRevision !== s.draftRevision || Date.parse(preview.expiresAt) > boundExpiry)) fail("Preview binding mismatch");
  const d = s.pendingDecision;
  if (d) {
    if (["COMPLETED", "CANCELLED", "EXPIRED", "INVALID"].includes(s.lifecycle)) fail("Terminal context cannot retain approval authority");
    if (Date.parse(d.issuedAfterInbound.receivedAt) > latest || (d.issuedAfterInbound.receivedAt === s.inbound.receivedAt && d.issuedAfterInbound.rowid > s.inbound.rowid) || Date.parse(d.expiresAt) <= Date.parse(d.issuedAfterInbound.receivedAt)) fail("Invalid decision issue order/lifetime");
    if (!ownerMatches(d.target) || d.contextRevision !== s.contextRevision || d.draftRevision !== s.draftRevision || d.target.requestId !== s.requestId || Date.parse(d.expiresAt) > boundExpiry) fail("Decision binding mismatch");
    if (d.kind === "SAVE_PREVIEW") {
      const outbound = s.transcript.filter(t => t.role === "ASSISTANT").at(-1);
      // Persist-before-send retains an inert prepared decision. Confirmation
      // still requires SENT; only the exact delivery receipt can enable it.
      if (!preview || d.previewId !== preview.previewId || !["SENT", "UNCERTAIN"].includes(d.deliveryState)
        || preview.deliveryState !== d.deliveryState || !outbound || outbound.kind !== "PREVIEW"
        || outbound.id !== preview.previewId || outbound.deliveryState !== d.deliveryState
        || (d.deliveryState === "UNCERTAIN" && (d.replyReference !== null || preview.replyReference !== null || outbound.messageRef !== null)))
        fail("Save decision needs a matching delivered or inert prepared preview");
    }
    d.candidate?.sourceEvidence.forEach(checkEvidence); d.candidate?.evidenceIndex.forEach(e => e.evidence.forEach(checkEvidence));
    if(s.schemaVersion==="calenote-context-state-2" && s.pendingDecision?.candidate)checkSuccessorCandidate(s.pendingDecision.candidate);
  }
  if (new Set(s.controlRegistry.map(c => c.handle)).size !== s.controlRegistry.length) fail("Duplicate issued handle");
  for (const c of s.controlRegistry) if (!ownerMatches(c) || Date.parse(c.expiresAt) > absolute || c.contextRevision > s.contextRevision) fail("Control scope/lifetime mismatch");
  if (d?.tokenHandle && !s.controlRegistry.some(c => c.handle === d.tokenHandle && c.decisionId === d.decisionId && c.contextRevision === d.contextRevision && c.draftRevision === d.draftRevision)) fail("Missing decision control binding");
  for (const t of s.transcript) for (const c of t.controlSpans) if (!s.controlRegistry.some(r => r.handle === c.handle)) fail("Control span lacks registry binding");
  if (s.modelAttemptBinding && (s.modelAttemptBinding.sourceInboundId !== s.inbound.id || s.modelAttemptBinding.claimMarker !== s.inbound.claimMarker || (s.modelAttemptBinding.contextRevision !== null && s.modelAttemptBinding.contextRevision > s.contextRevision))) fail("Attempt binding mismatch");
}
export const ContextSnapshotV1Schema = snapshotV1Base.superRefine(validateSnapshot);
export const ContextSnapshotV2Schema = snapshotV2Base.superRefine(validateSnapshot);
export type ContextSnapshotV2 = z.infer<typeof ContextSnapshotV2Schema>;
export type ContextSnapshotV1 = z.infer<typeof ContextSnapshotV1Schema>;
export const CanonicalDetailsV1Schema = z.strictObject({ schemaVersion: z.literal("calenote-reminder-details-1"), location: SlotValueSchemas.location.nullable(), notes: SlotValueSchemas.notes.nullable(), eventDate: z.iso.date().nullable(), eventTime: z.string().regex(/^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/u).nullable(), calendarProvenance: z.strictObject({ calendar: CalendarSchema, sourceDate: DateOperandSchema.nullable(), provenance }), resolutionVersion: id }).refine(d => d.calendarProvenance.sourceDate?.kind !== "CIVIL_DATE" || d.calendarProvenance.sourceDate.calendar === d.calendarProvenance.calendar, "Calendar provenance mismatch");
export type CanonicalDetailsV1 = z.infer<typeof CanonicalDetailsV1Schema>;

// Lossless storage only. The provider representation is unchanged. Strings,
// including identity source/views, are interned only when this reduces bytes.
// Strict logical schemas contain no $s object keys, so reference nodes cannot
// collide with user text or domain objects. Count this entire envelope at 16KiB.
const legacyStorageVersion = "calenote-context-storage-1";
const storageVersion = "calenote-context-storage-2";
// Persisted dictionary: append only; reordering/removal requires a new version.
// This changes JSON member names only, never any logical value or scope binding.
const storageKeys = ["normalizationVersion", "sourceTurnId", "sourceMapTurnId", "sourceSpan", "viewSpan", "proposalRevision", "deliveryState", "receivedAt", "semanticView", "sourceMap", "sourceCodePoints", "viewCodePoints", "sourceStart", "sourceEnd", "viewStart", "viewEnd", "sourceStride", "viewStride", "evidence", "provenance", "resolution", "dependencies", "referenceTime", "contextRevision", "draftRevision", "chatIdentityId", "ownerId", "chatId", "requestId", "decisionId", "expiresAt", "sourceReferenceTime", "evidenceSlot", "pendingReminderQuestion", "pendingQueryQuestion", "pendingDecision", "previewReceipt", "controlRegistry", "modelAttemptBinding", "lastTerminalOutcome", "createdAt", "idleExpiresAt", "absoluteExpiresAt", "draftCreatedAt", "draftExpiresAt", "capabilityVersion", "schemaVersion", "issuedAfterOrder", "issuedAfterInbound", "replyReference", "claimMarker", "sourceInboundId", "contractVersion", "questionId", "previewId", "draftHash", "acceptedReplies", "tokenHandle", "proposalId", "evidenceIndex"] as const;
const compactKeys = new Map<string, string>(storageKeys.map((key, i) => [key, `$k${i.toString(36)}`]));
const expandedKeys = new Map([...compactKeys].map(([key, compact]) => [compact, key]));
const bytes = (text: string) => new TextEncoder().encode(text).byteLength;
type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export function encodeContextSnapshot(value: unknown): string {
  return encodeSnapshot(ContextSnapshotV1Schema.parse(value));
}
export function encodeContextSnapshotV2(value: ContextSnapshotV2): string {
  return encodeSnapshot(ContextSnapshotV2Schema.parse(value));
}
function encodeSnapshot(state: ContextSnapshotV1 | ContextSnapshotV2): string {
  const counts = new Map<string, number>();
  const count = (v: Json): void => { if (typeof v === "string") counts.set(v, (counts.get(v) ?? 0) + 1); else if (v && typeof v === "object") Object.values(v).forEach(count); };
  count(state as Json);
  const strings: string[] = [], refs = new Map<string, number>();
  for (const [text, n] of counts) if (n > 1 && (n - 1) * bytes(JSON.stringify(text)) > n * 16 + 2) { refs.set(text, strings.length); strings.push(text); }
  const encode = (v: Json): Json => typeof v === "string" && refs.has(v) ? { $s: refs.get(v)! } : Array.isArray(v) ? v.map(encode) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, value]) => [compactKeys.get(k) ?? k, encode(value)])) : v;
  // Candidate encoding does not admit storage: measure the full string before
  // accepting a transition. Oversize never truncates fields.
  return JSON.stringify({ encoding: storageVersion, strings, snapshot: encode(state as Json) });
}
export function decodeContextSnapshot(encoded: string): ContextSnapshotV1 {
  return ContextSnapshotV1Schema.parse(decodeSnapshot(encoded));
}
export function decodeContextSnapshotV2(encoded: string): ContextSnapshotV2 {
  return ContextSnapshotV2Schema.parse(decodeSnapshot(encoded));
}
function decodeSnapshot(encoded: string): unknown {
  if (bytes(encoded) > 16384) throw new Error("Context snapshot exceeds storage limit");
  const parsed: unknown = JSON.parse(encoded);
  // Both persisted encoders write canonical JSON.stringify payloads. Refuse
  // ambiguous duplicate members (and alternate encodings) before expansion;
  // JSON.parse alone would silently discard a preceding corrupt member.
  if (JSON.stringify(parsed) !== encoded) throw new Error("Noncanonical encoded JSON");
  const envelope = z.strictObject({ encoding: z.enum([legacyStorageVersion, storageVersion]), strings: z.array(z.string()).max(512), snapshot: z.unknown() }).parse(parsed);
  if (new Set(envelope.strings).size !== envelope.strings.length) throw new Error("Duplicate string table entries");
  const used = new Set<number>();
  let nodes = 0, expandedBytes = 0;
  const decode = (v: unknown, depth: number): Json => {
    if (++nodes > 16384 || depth > 32) throw new Error("Excessive encoded structure");
    if (v && typeof v === "object" && !Array.isArray(v) && "$s" in v) {
      const ref = z.strictObject({ $s: index }).parse(v);
      if (ref.$s >= envelope.strings.length) throw new Error("Missing string reference");
      used.add(ref.$s);
      v = envelope.strings[ref.$s];
    }
    // Above the logical schema's bounded transcript/fact/evidence maxima. This
    // rejects malicious reference multiplication, not valid repeated evidence.
    if (typeof v === "string") { expandedBytes += bytes(v); if (expandedBytes > 4 * 1024 * 1024) throw new Error("Excessive decoded text"); return v; }
    if (v === null || typeof v === "boolean" || typeof v === "number") return v;
    if (Array.isArray(v)) return v.map(x => decode(x, depth + 1));
    if (typeof v === "object") {
      const entries: Array<[string, Json]> = [], keys = new Set<string>();
      for (const [key, value] of Object.entries(v)) {
        const expanded = envelope.encoding === storageVersion ? expandedKeys.get(key) ?? key : key;
        if ((key.startsWith("$") && !expandedKeys.has(key)) || keys.has(expanded)) throw new Error("Invalid/colliding encoded key");
        keys.add(expanded); entries.push([expanded, decode(value, depth + 1)]);
      }
      return Object.fromEntries(entries);
    }
    throw new Error("Invalid encoded value");
  };
  const decoded = decode(envelope.snapshot, 0);
  if (used.size !== envelope.strings.length) throw new Error("Unused string table entry");
  return decoded;
}

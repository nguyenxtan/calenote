import { ConversationDirectiveSchema, IssueFieldSchema, ReplyProposalSchema, SLOT_NAMES, type ConversationDirective, type ParsedInterpretation } from "./contracts";
import { isValidatedPatch, type GuidancePrivacyValidation, type ValidatedPatch } from "./evidence";
import type { MergeResult } from "./merge";
import type { RequestResolution } from "./resolve";
import type { ContextQueryResult, QueryResolution } from "./query";
import { containsForbiddenGuidanceMaterial } from "./projection";

export type EffectiveDirective = ConversationDirective | { kind: "BACKEND_ONLY"; reason: "CONTROL" | "RECOVERY" | "FAILURE" | "MUTATION" | "DELIVERY" };
type BackendReason = Extract<EffectiveDirective, { kind: "BACKEND_ONLY" }>["reason"];
type ApplicationOutcome = { semantic: ValidatedPatch; merge: MergeResult; resolution?: RequestResolution; queryResolution?: QueryResolution; queryResult?: ContextQueryResult; backendOnly?: BackendReason };
const failure = (): EffectiveDirective => ({ kind: "BACKEND_ONLY", reason: "FAILURE" });
const knownReasons = new Set(["MISSING", "AMBIGUOUS", "CONFLICT", "UNSUPPORTED_COMBINATION", "UNKNOWN_FREQUENCY", "AMBIGUOUS_TIME", "AMBIGUOUS_WEEK", "LUNAR_YEAR_REQUIRED", "LUNAR_LEAP_CHOICE_REQUIRED", "INVALID_DATE", "YEAR_REQUIRED_INVALID_DATE", "CALENDAR_CONFLICT", "ONCE_COUNT_CONFLICT", "COUNT_OFFSET_CONFLICT", "LIMIT", "INCOMPATIBLE_ABSOLUTE_AND_RELATIVE", "INCOMPATIBLE_RELATION", "OFFSET_REQUIRES_BEFORE_EVENT", "INCOMPATIBLE_RANGE", "COUNT_RANGE_CONFLICT", "PAST_OCCURRENCE", "HORIZON_LIMIT", "DETAILS_TOO_LONG"]);

/** Pure reply routing over accepted T3 results. Returning PRESENT_PREVIEW is
 * only a composition handoff; it creates no decision, token or save authority.
 * T5/T7 must supply current lifecycle/scope outcomes, never model directives. */
export function computeEffectiveDirective(outcome: ApplicationOutcome): EffectiveDirective {
  if (outcome.backendOnly) return { kind: "BACKEND_ONLY", reason: outcome.backendOnly };
  if (!isValidatedPatch(outcome.semantic) || outcome.merge.status !== "MERGED") return failure();
  const candidate = outcome.merge.candidate, semantic = outcome.semantic.proposal, isQuery = outcome.merge.query !== null;
  if (candidate.pendingDecision || candidate.lifecycle === "AWAITING_CONFIRMATION" || semantic.dialogueAct === "ABANDON_PENDING") return { kind: "BACKEND_ONLY", reason: "CONTROL" };
  const scopedNonSlotIssue = (): EffectiveDirective | null => {
    // T3 does not copy AMBIGUOUS/combined-action proposals into a reminder.
    // Consult their validated current uncertainties directly. A side query
    // owns only its current non-slot issues; retained reminder questions must
    // not contaminate it. Conversely, a reminder does not own queryRange.
    const issues = [...outcome.semantic.resolvedUncertainties,
      ...(!isQuery && semantic.intent === "CREATE_REMINDER" ? candidate.ambiguities : [])];
    const fields = semantic.intent === "CREATE_REMINDER" ? ["intent", "operation"] as const : ["intent", "queryRange", "operation"] as const;
    for (const missing of [false, true]) for (const field of fields) {
      const issue = issues.find(u => u.field === field && (u.reason === "MISSING") === missing);
      if (issue) return issue.reason === "MISSING" ? { kind: "ASK_FOR_FIELD", field } : { kind: "ASK_FOR_DISAMBIGUATION", field, reason: issue.reason };
    }
    return semantic.intent === "AMBIGUOUS" ? { kind: "ASK_FOR_DISAMBIGUATION", field: "intent", reason: "AMBIGUOUS" } : null;
  };
  if (semantic.intent === "HELP") return { kind: "HELP", topic: "GENERAL" };
  if (semantic.intent === "UNSUPPORTED") return { kind: "EXPLAIN_UNSUPPORTED", issue: "ASSISTANT_SCOPE" };
  if (outcome.merge.query) {
    const resolution = outcome.queryResolution;
    if (!resolution || resolution.status === "REJECTED") return failure();
    if (outcome.queryResult && outcome.queryResult.status !== "RESULTS") return failure();
    if (resolution.status === "CLARIFY" && !["MISSING_TOPIC", "MISSING_RANGE", "MISSING_CALENDAR_OPERAND", "LUNAR_YEAR_REQUIRED", "AMBIGUOUS_WEEK", "LUNAR_LEAP_CHOICE_REQUIRED"].includes(resolution.reason)) return failure();
    const uncertainty = scopedNonSlotIssue();
    if (uncertainty) return uncertainty;
    if (resolution.status === "CLARIFY") {
      const field = outcome.merge.query.kind === "CAPABILITY" ? "intent" : "queryRange";
      if (["MISSING_TOPIC", "MISSING_RANGE", "MISSING_CALENDAR_OPERAND", "LUNAR_YEAR_REQUIRED"].includes(resolution.reason)) return { kind: "ASK_FOR_FIELD", field };
      if (["AMBIGUOUS_WEEK", "LUNAR_LEAP_CHOICE_REQUIRED"].includes(resolution.reason)) return { kind: "ASK_FOR_DISAMBIGUATION", field, reason: "AMBIGUOUS" };
      return failure();
    }
    if (resolution.status === "RANGE" && outcome.queryResult?.status !== "RESULTS") return failure();
    return { kind: "ANSWER_QUERY", queryKind: resolution.status === "RANGE" ? "LIST" : resolution.status };
  }
  const resolution = outcome.resolution;
  if (!resolution) return failure();
  if (resolution.status === "UNSUPPORTED") return ["WEEKLY", "MONTHLY", "YEARLY"].includes(resolution.capability) ? { kind: "EXPLAIN_UNSUPPORTED", issue: "CAPABILITY" } : failure();
  if (resolution.status === "CLARIFY" && (!resolution.fields.length || !resolution.reasons.length || resolution.reasons.some(reason => !knownReasons.has(reason)) || resolution.fields.some(field => !IssueFieldSchema.safeParse(field).success))) return failure();
  const uncertainty = scopedNonSlotIssue();
  if (uncertainty) return uncertainty;
  if (resolution.status === "READY") return semantic.intent === "CREATE_REMINDER" ? { kind: "PRESENT_PREVIEW" } : failure();
  // Unresolved alternatives precede missing fields. Stable slot order does not
  // depend on the order in which the model emitted uncertainties.
  const order = [...SLOT_NAMES, "intent", "queryRange", "operation"] as const;
  for (const field of order) {
    if (!resolution.fields.includes(field)) continue;
    const slot = SLOT_NAMES.includes(field as typeof SLOT_NAMES[number]) ? candidate.slots[field as typeof SLOT_NAMES[number]] : null;
    const ambiguity = candidate.ambiguities.find(u => u.field === field && u.reason !== "MISSING");
    if (slot?.state === "CONFLICT") return { kind: "ASK_FOR_DISAMBIGUATION", field, reason: "CONFLICT" };
    if (ambiguity && ambiguity.reason !== "MISSING") return { kind: "ASK_FOR_DISAMBIGUATION", field, reason: ambiguity.reason };
  }
  const field = IssueFieldSchema.parse(resolution.fields[0]);
  if (resolution.reasons.some(r => ["LIMIT", "HORIZON_LIMIT", "DETAILS_TOO_LONG"].includes(r))) return { kind: "EXPLAIN_UNSUPPORTED", issue: "DOMAIN_LIMIT" };
  // T3's fields/reasons arrays are independently deduplicated, not zipped.
  // Fixed typed reason mappings prevent an earlier missing field acquiring a
  // later field's conflict. Ambiguous date/clock fields are identified from
  // their accepted typed operands, never by parsing user or model prose.
  const reasonFields = { ONCE_COUNT_CONFLICT: "occurrenceCount", COUNT_OFFSET_CONFLICT: "leadOffsetDays", COUNT_RANGE_CONFLICT: "occurrenceCount", INCOMPATIBLE_ABSOLUTE_AND_RELATIVE: "reminderDate", INCOMPATIBLE_RELATION: "leadOffsetDays", OFFSET_REQUIRES_BEFORE_EVENT: "eventRelation", INCOMPATIBLE_RANGE: "endDate" } as const;
  for (const [reason, target] of Object.entries(reasonFields)) if (resolution.reasons.includes(reason) && resolution.fields.includes(target)) return { kind: "ASK_FOR_DISAMBIGUATION", field: target, reason: "CONFLICT" };
  for (const target of SLOT_NAMES) {
    if (!resolution.fields.includes(target)) continue;
    const value = candidate.slots[target].value;
    if (resolution.reasons.includes("UNKNOWN_FREQUENCY") && target === "frequency") return { kind: "ASK_FOR_DISAMBIGUATION", field: target, reason: "AMBIGUOUS" };
    if (value && typeof value === "object") {
      if (resolution.reasons.includes("AMBIGUOUS_TIME") && "qualifier" in value && value.qualifier === "UNKNOWN") return { kind: "ASK_FOR_DISAMBIGUATION", field: target, reason: "AMBIGUOUS" };
      if ("kind" in value && ((resolution.reasons.includes("AMBIGUOUS_WEEK") && value.kind === "WEEKDAY" && value.qualifier === "UNRESOLVED") || (resolution.reasons.includes("LUNAR_LEAP_CHOICE_REQUIRED") && value.kind === "CIVIL_DATE" && value.calendar === "LUNAR_VN" && value.leapMonth === null))) return { kind: "ASK_FOR_DISAMBIGUATION", field: target, reason: "AMBIGUOUS" };
      if (resolution.reasons.includes("CALENDAR_CONFLICT") && "kind" in value && value.kind === "CIVIL_DATE" && value.calendar !== candidate.slots.calendar.value) return { kind: "ASK_FOR_DISAMBIGUATION", field: target, reason: "CONFLICT" };
    }
  }
  if (resolution.reasons.some(r => ["AMBIGUOUS", "CONFLICT", "UNSUPPORTED_COMBINATION", "AMBIGUOUS_TIME", "AMBIGUOUS_WEEK", "UNKNOWN_FREQUENCY", "LUNAR_LEAP_CHOICE_REQUIRED", "CALENDAR_CONFLICT"].includes(r))) return failure();
  return { kind: "ASK_FOR_FIELD", field };
}

export type DirectiveValidation = { status: "VALID" } | { status: "INVALID"; reason: "DIRECTIVE_INVALID" | "DIRECTIVE_MISMATCH" };
export function validateDirective(model: ParsedInterpretation["directive"], effective: EffectiveDirective): DirectiveValidation {
  if (model.status !== "VALID") return { status: "INVALID", reason: "DIRECTIVE_INVALID" };
  const parsed = ConversationDirectiveSchema.safeParse(model.value);
  if (!parsed.success) return { status: "INVALID", reason: "DIRECTIVE_INVALID" };
  const same = Object.keys(parsed.data).length === Object.keys(effective).length && Object.entries(parsed.data).every(([key, value]) => effective[key as keyof EffectiveDirective] === value);
  return same ? { status: "VALID" } : { status: "INVALID", reason: "DIRECTIVE_MISMATCH" };
}

export const OUTPUT_SAFETY_LINT_VERSION = "conversation-guidance-lint-1";
const forbiddenWords = new Set(["đã", "lưu", "tạo", "gửi", "xong", "saved", "save", "created", "create", "sent", "send", "done", "success", "confirmed", "confirm"]);
export function isEligibleGuidanceText(text: string): boolean {
  // Fixed approved output guard; never applied to input meaning or facts.
  if (containsForbiddenGuidanceMaterial(text) || /[\p{N}\p{Cf}\p{Cc}<>`*_\[\]{}\\%&]/u.test(text)) return false;
  const normalized = text.normalize("NFC").toLocaleLowerCase("vi").replace(/\s+/gu, " ");
  const words = normalized.match(/[\p{L}\p{M}]+/gu) ?? [];
  return !words.some(w => forbiddenWords.has(w)) && !/(?:^|[^\p{L}\p{M}])(?:thành công|xác nhận)(?:$|[^\p{L}\p{M}])/u.test(normalized);
}
type ReplyReason = "REPLY_ABSENT" | "REPLY_INVALID" | "REPLY_TOO_LONG" | "REPLY_FORBIDDEN" | "DIRECTIVE_INVALID" | "DIRECTIVE_MISMATCH" | "BACKEND_SURFACE";
export type GuidanceSelection = { source: "MODEL_GUIDANCE"; text: string } | { source: "BACKEND"; reason: ReplyReason; text: string | null };
const questions: Record<string, string> = {
  title: "Bạn muốn được nhắc việc gì?", location: "Địa điểm là ở đâu?", notes: "Bạn muốn ghi chú gì?", eventDate: "Sự kiện diễn ra ngày nào?", eventTime: "Sự kiện diễn ra lúc mấy giờ?", reminderDate: "Bạn muốn được nhắc vào ngày nào?", reminderTime: "Bạn muốn được nhắc lúc mấy giờ?", calendar: "Bạn muốn dùng lịch dương hay lịch âm?", frequency: "Bạn muốn nhắc một lần hay liên tiếp mỗi ngày?", occurrenceCount: "Bạn muốn được nhắc bao nhiêu lần?", eventRelation: "Bạn muốn được nhắc trước, trong hay từ ngày diễn ra sự kiện?", leadOffsetDays: "Bạn muốn được nhắc trước sự kiện bao nhiêu ngày?", endDate: "Bạn muốn kết thúc nhắc vào ngày nào?", intent: "Bạn muốn hỏi về nội dung nào?", queryRange: "Bạn muốn xem khoảng thời gian nào?", operation: "Bạn muốn thực hiện việc nào trước?",
};
function fallback(effective: EffectiveDirective): string | null {
  if (effective.kind === "ASK_FOR_FIELD") return questions[effective.field];
  if (effective.kind === "ASK_FOR_DISAMBIGUATION") return `Mình cần làm rõ thông tin này. ${questions[effective.field]}`;
  if (effective.kind === "EXPLAIN_UNSUPPORTED") return "Yêu cầu này chưa được hỗ trợ. Bạn có thể diễn đạt lại yêu cầu.";
  if (effective.kind === "HELP") return "Bạn có thể mô tả việc cần nhắc và thời điểm mong muốn.";
  // Facts/controls must be composed by the downstream backend from its actual
  // result. A null handoff is not a finished preview or delivery receipt.
  return null;
}
export function selectGuidance(input: { effectiveDirective: EffectiveDirective; directiveValidation: DirectiveValidation; replyProposal: ParsedInterpretation["reply"]; privacyValidation: GuidancePrivacyValidation; language: string }): GuidanceSelection {
  const backend = (reason: ReplyReason): GuidanceSelection => ({ source: "BACKEND", reason, text: fallback(input.effectiveDirective) });
  if (["PRESENT_PREVIEW", "ANSWER_QUERY", "BACKEND_ONLY"].includes(input.effectiveDirective.kind)) return backend("BACKEND_SURFACE");
  if (input.directiveValidation.status !== "VALID") return backend(input.directiveValidation.reason);
  if (input.replyProposal.status !== "VALID") return backend(input.replyProposal.reason);
  if (input.replyProposal.value === null) return backend("REPLY_ABSENT");
  const parsed = ReplyProposalSchema.safeParse(input.replyProposal.value);
  if (!parsed.success || parsed.data === null) return backend("REPLY_INVALID");
  if (input.privacyValidation.status !== "VALID" || !["vi", "en"].includes(input.language) || !isEligibleGuidanceText(parsed.data.text)) return backend("REPLY_FORBIDDEN");
  return { source: "MODEL_GUIDANCE", text: parsed.data.text };
}

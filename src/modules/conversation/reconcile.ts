import { ConversationModelSchema, PendingRequestSchema, type ConversationModel, type ConversationSnapshot, type DateFact, type MissingField, type PendingRequest } from "./contracts";
import type { ConversationTemporalEvidence, Evidence } from "./temporal";

export type ConversationDecision =
  | { kind: "CLARIFY"; request: PendingRequest; field: MissingField }
  | { kind: "PROPOSE"; request: PendingRequest }
  | { kind: "ABANDON_PENDING" }
  | { kind: "GREET" | "LUNAR_HELP" | "HELP" | "READ_ONLY_LIST" }
  | { kind: "SAFE_REJECT"; code: "CONFLICT" | "LIMIT" | "UNAVAILABLE" };

const blank = (): PendingRequest => ({ title: null, calendar: "GREGORIAN", eventDate: null, reminderDate: null,
  reminderTime: null, count: null, relation: null, missing: [] });
const conflict = (): ConversationDecision => ({ kind: "SAFE_REJECT", code: "CONFLICT" });
const sameDate = (left: DateFact, right: DateFact) => left.solarDate === right.solarDate && left.calendar === right.calendar
  && JSON.stringify(left.lunar) === JSON.stringify(right.lunar) && left.conversionVersion === right.conversionVersion;

/** Pure decision only: no clock reads, storage, identity, confirmation, or mutation. */
export function reconcileConversation(input: {
  model: ConversationModel; temporal: ConversationTemporalEvidence; previous: ConversationSnapshot | null;
  now: number; editRequested: boolean;
}): ConversationDecision {
  const parsed = ConversationModelSchema.safeParse(input.model);
  if (!parsed.success || !Number.isSafeInteger(input.now)) return { kind: "SAFE_REJECT", code: "UNAVAILABLE" };
  const model = parsed.data;
  const active = input.previous && ["CLARIFYING", "DRAFT_READY"].includes(input.previous.status)
    && input.previous.expiresAt > input.now ? input.previous : null;
  if (model.dialogueAct === "GREET") return { kind: "GREET" };
  if (model.dialogueAct === "CAPABILITY") return { kind: "LUNAR_HELP" };
  if (model.dialogueAct === "ABANDON") {
    if (!active) return { kind: "HELP" };
    if (model.continuation === "YES") return { kind: "ABANDON_PENDING" };
    return { kind: "CLARIFY", request: { ...active.request, missing: ["intent"] }, field: "intent" };
  }
  if (model.intent === "HELP") return { kind: "HELP" };
  if (model.intent === "LIST_REMINDERS") return { kind: "READ_ONLY_LIST" };
  if (model.intent === "UNSUPPORTED") return { kind: "SAFE_REJECT", code: "UNAVAILABLE" };
  const continuing = !!active && model.dialogueAct !== "NEW_REQUEST" && model.continuation === "YES";
  const request = continuing ? structuredClone(active.request) : blank();
  if (model.intent === "AMBIGUOUS" || (active && model.continuation === "UNCERTAIN")) {
    return { kind: "CLARIFY", request: { ...(active?.request ?? request), missing: ["intent"] }, field: "intent" };
  }
  const temporal = input.temporal;
  if (temporal.unsupportedCadence) return { kind: "SAFE_REJECT", code: "UNAVAILABLE" };
  if ([temporal.calendar, temporal.eventDate, temporal.reminderDate, temporal.time, temporal.count, temporal.relation]
    .some(fact => fact.state === "AMBIGUOUS")) return conflict();
  const edit = model.dialogueAct === "EDIT" && input.editRequested;
  if (temporal.calendar.state === "RESOLVED") {
    if (continuing && temporal.calendar.value !== request.calendar && !edit) return conflict();
    if (temporal.calendar.value !== request.calendar && (request.eventDate || request.reminderDate)) return conflict();
    request.calendar = temporal.calendar.value;
  }
  function merge<T>(old: T | null, evidence: Evidence<T>, equal: (left: T, right: T) => boolean = (a, b) => a === b): T | null | false {
    if (evidence.state !== "RESOLVED") return old;
    if (old !== null && !equal(old, evidence.value) && !edit) return false;
    return evidence.value;
  }
  let eventEvidence = temporal.eventDate;
  let reminderEvidence = temporal.reminderDate;
  // A bare date reply fills the requested event slot, not a second scheduling
  // slot. Both values are deterministic evidence, never provider fields.
  if (continuing && request.missing.includes("eventDate") && eventEvidence.state === "MISSING") {
    eventEvidence = reminderEvidence;
    reminderEvidence = { state: "MISSING" };
  }
  const eventDate = merge(request.eventDate, eventEvidence, sameDate);
  const reminderDate = merge(request.reminderDate, reminderEvidence, sameDate);
  const reminderTime = merge(request.reminderTime, temporal.time);
  const count = merge(request.count, temporal.count);
  const relation = merge(request.relation, temporal.relation);
  if (eventDate === false || reminderDate === false || reminderTime === false || count === false || relation === false) return conflict();
  Object.assign(request, { eventDate, reminderDate, reminderTime, count, relation });
  if (temporal.lunarInput) request.lunarInput = temporal.lunarInput;
  else if (temporal.eventDate.state === "RESOLVED" || temporal.reminderDate.state === "RESOLVED") delete request.lunarInput;
  if (model.titleState === "RESOLVED") {
    if (request.title && request.title !== model.title && !edit) return conflict();
    request.title = model.title;
  }
  if (model.titleState === "AMBIGUOUS") request.title = null;
  const missing: MissingField[] = [];
  if (!request.title || model.titleState === "AMBIGUOUS") missing.push("title");
  // Evidence describes this turn; absence in a relation-only answer must not
  // erase a previously resolved authoritative slot in the merged request.
  for (const field of temporal.missing) {
    const resolved = field === "eventDate" ? request.eventDate !== null
      : field === "date" ? request.reminderDate !== null
        : field === "time" ? request.reminderTime !== null
          : field === "seriesCount" ? request.count !== null : false;
    if (!resolved && !missing.includes(field)) missing.push(field);
  }
  if (request.lunarInput) {
    if (request.lunarInput.year === null) missing.push("year");
    else if (request.missing.includes("leapMonth")) missing.push("leapMonth");
  }
  if (continuing && request.missing.includes("seriesCount") && request.count === null) missing.push("seriesCount");
  const series = request.count !== null && request.count > 1;
  if (series && !request.relation) missing.push("seriesRelation");
  const needsEvent = request.relation === "BEFORE_EVENT" || request.relation === "INCLUDING_EVENT";
  if (needsEvent && !request.eventDate) missing.push("eventDate");
  if (!needsEvent && !request.reminderDate && !request.eventDate && !missing.some(field => ["year", "leapMonth", "eventDate"].includes(field))) missing.push("date");
  if (!request.reminderTime) missing.push("time");
  request.missing = [...new Set(missing)];
  if (!PendingRequestSchema.safeParse(request).success) return { kind: "SAFE_REJECT", code: "UNAVAILABLE" };
  if (request.missing.length) return { kind: "CLARIFY", request, field: request.missing[0] };
  return { kind: "PROPOSE", request };
}

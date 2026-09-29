import { ClockOperandSchema, DateOperandSchema, SLOT_NAMES, type DateOperand } from "./contracts";
import { encodeContextSnapshot, type CanonicalDetailsV1, type ContextSlots, type ContextSnapshotV1, type SlotProvenance } from "./state";
import type { LunarCalendarAdapter } from "../lunar-calendar";
import { isValidSemanticLocalDate } from "@/modules/semantic/validation";
import type { SeriesOccurrence } from "@/modules/reminders/series";
import { renderReminderDetails } from "@/modules/reminders/detail-presentation";

export const RESOLUTION_VERSION = "context-resolution-1";
export const DAY_MS = 86400000;
export const VN_OFFSET_MS = 7 * 3600000;
export const localMidnight = (instant: number) => Math.floor((instant + VN_OFFSET_MS) / DAY_MS) * DAY_MS - VN_OFFSET_MS;
const civil = (midnight: number) => new Date(midnight + VN_OFFSET_MS).toISOString().slice(0, 10);
export type DateResolution = { status: "RESOLVED"; date: string; inferredYear: boolean; method: "EXPLICIT_OPERAND" | "POLICY_DEFAULT" | "CALENDAR_CONVERSION" } | { status: "CLARIFY"; reason: string };

/** Calendar arithmetic over typed operands only; source receipt is mandatory. */
export function resolveDateOperand(operand: DateOperand, receipt: number, calendar: LunarCalendarAdapter): DateResolution {
  const parsed = DateOperandSchema.safeParse(operand);
  const clarify = (reason: string): DateResolution => ({ status: "CLARIFY", reason });
  if (!parsed.success || !Number.isSafeInteger(receipt) || !Number.isFinite(new Date(receipt).getTime())) return clarify("INVALID_DATE");
  const value = parsed.data, today = localMidnight(receipt);
  if (value.kind === "RELATIVE_DAY") return { status: "RESOLVED", date: civil(today + value.offsetDays * DAY_MS), inferredYear: false, method: "POLICY_DEFAULT" };
  if (value.kind === "WEEKDAY") {
    if (value.qualifier === "UNRESOLVED") return clarify("AMBIGUOUS_WEEK");
    const monday = today - ((new Date(today + VN_OFFSET_MS).getUTCDay() + 6) % 7) * DAY_MS;
    return { status: "RESOLVED", date: civil(monday + ((value.qualifier === "NEXT_WEEK" ? 7 : 0) + value.weekday - 1) * DAY_MS), inferredYear: false, method: "POLICY_DEFAULT" };
  }
  if (value.calendar === "LUNAR_VN") {
    if (value.year === null) return clarify("LUNAR_YEAR_REQUIRED");
    if (value.leapMonth === null && calendar.hasLeapMonth(value.year, value.month)) return clarify("LUNAR_LEAP_CHOICE_REQUIRED");
    const converted = calendar.toSolar({ year: value.year, month: value.month, day: value.day, leap: value.leapMonth ?? false });
    return converted.status === "RESOLVED" ? { status: "RESOLVED", date: converted.solarDate, inferredYear: false, method: "CALENDAR_CONVERSION" } : clarify(`LUNAR_${converted.status}`);
  }
  const local = new Date(today + VN_OFFSET_MS);
  const year = value.year ?? local.getUTCFullYear() + (value.month < local.getUTCMonth() + 1 || (value.month === local.getUTCMonth() + 1 && value.day < local.getUTCDate()) ? 1 : 0);
  const date = `${String(year).padStart(4, "0")}-${String(value.month).padStart(2, "0")}-${String(value.day).padStart(2, "0")}`;
  return isValidSemanticLocalDate(date) ? { status: "RESOLVED", date, inferredYear: value.year === null, method: value.year === null ? "POLICY_DEFAULT" : "EXPLICIT_OPERAND" } : clarify(value.year === null ? "YEAR_REQUIRED_INVALID_DATE" : "INVALID_DATE");
}

export type RequestResolution = { status: "CLARIFY"; fields: string[]; reasons: string[] }
  | { status: "UNSUPPORTED"; capability: string }
  | { status: "READY"; resolvedSlots: ContextSlots; resolvedFacts: ContextSnapshotV1["facts"]; occurrences: SeriesOccurrence[]; details: CanonicalDetailsV1 };

/** A resolved slot and its context fact are one projection. Returning both
 * prevents persistence consumers from retaining stale provenance/defaults. */
function projectResolvedFacts(slots: ContextSlots, previous: ContextSnapshotV1["facts"]): ContextSnapshotV1["facts"] {
  const facts: ContextSnapshotV1["facts"] = structuredClone(previous.filter(f => f.scope === "QUERY"));
  const used = new Set(facts.map(f => f.alias));
  for (const field of SLOT_NAMES) {
    const slot = slots[field];
    if (slot.state !== "RESOLVED" || slot.value === null) { slot.fact = null; continue; }
    let alias = slot.fact;
    if (!alias || used.has(alias)) { let n = 1; while (used.has(`f${n}`)) n++; alias = `f${n}`; }
    slot.fact = alias; used.add(alias);
  }
  for (const field of SLOT_NAMES) {
    const slot = slots[field]; if (!slot.fact) continue;
    const provenance = slot.provenance!;
    const dependencies = provenance.kind === "DERIVED_POLICY" ? provenance.dependencies.filter(d => d !== field).map(d => slots[d].fact).filter((d): d is string => d !== null) : [];
    facts.push({ alias: slot.fact, scope: "REMINDER", field, value: slot.value, evidenceSlot: field, provenance: provenance.kind === "DERIVED_POLICY" ? { ...provenance, dependencies } : provenance, sourceReferenceTime: slot.resolution!.referenceTime, dependencies } as ContextSnapshotV1["facts"][number]);
  }
  return facts;
}

export function resolveRequest(candidate: ContextSnapshotV1, now: number, calendar: LunarCalendarAdapter): RequestResolution {
  const slots = structuredClone(candidate.slots), fields: string[] = [], reasons: string[] = [];
  const issue = (field: string, reason: string) => { if (!fields.includes(field)) fields.push(field); if (!reasons.includes(reason)) reasons.push(reason); };
  const clarification = (): RequestResolution => ({ status: "CLARIFY", fields, reasons });
  if (!Number.isSafeInteger(now) || !Number.isFinite(new Date(now).getTime())) { issue("operation", "INVALID_PROCESSING_TIME"); return clarification(); }
  for (const field of SLOT_NAMES) if (slots[field].state === "CONFLICT") issue(field, "CONFLICT");
  for (const u of candidate.ambiguities) if (SLOT_NAMES.includes(u.field as typeof SLOT_NAMES[number])) issue(u.field, u.reason);
  const derive = (field: "frequency" | "calendar" | "occurrenceCount", value: unknown, dependencies: typeof SLOT_NAMES[number][] = []) => {
    const referenceTime = dependencies.map(d => slots[d].resolution?.referenceTime).find(Boolean) ?? candidate.createdAt;
    Object.assign(slots[field], { state: "RESOLVED", value, fact: null, evidence: [], provenance: { kind: "DERIVED_POLICY", policyVersion: RESOLUTION_VERSION, dependencies, referenceTime }, resolution: { method: field === "occurrenceCount" ? "FINITE_RANGE" : "POLICY_DEFAULT", version: RESOLUTION_VERSION, referenceTime, timezone: "Asia/Ho_Chi_Minh", dependencies } });
  };
  if (slots.frequency.value === null) derive("frequency", "ONCE");
  if (slots.calendar.value === null || slots.calendar.provenance?.kind === "DERIVED_POLICY") {
    const source = slots.eventDate.value ?? slots.reminderDate.value;
    derive("calendar", source?.kind === "CIVIL_DATE" ? source.calendar : "GREGORIAN", source ? [slots.eventDate.value ? "eventDate" : "reminderDate"] : []);
  }
  const frequency = slots.frequency.value ?? "ONCE";
  if (["WEEKLY", "MONTHLY", "YEARLY"].includes(frequency)) return { status: "UNSUPPORTED", capability: frequency };
  if (frequency === "UNKNOWN") issue("frequency", "UNKNOWN_FREQUENCY");
  if (!slots.title.value) issue("title", "MISSING");
  const clock = (field: "reminderTime" | "eventTime") => {
    const value = slots[field].value;
    if (!value) { if (field === "reminderTime") issue(field, "MISSING"); return null; }
    const parsed = ClockOperandSchema.safeParse(value);
    if (!parsed.success || value.qualifier === "UNKNOWN") { issue(field, "AMBIGUOUS_TIME"); return null; }
    const hour = value.qualifier === "PM" ? value.hour % 12 + 12 : value.qualifier === "AM" ? value.hour % 12 : value.hour;
    return `${String(hour).padStart(2, "0")}:${String(value.minute).padStart(2, "0")}`;
  };
  const reminderTime = clock("reminderTime"), eventTime = clock("eventTime");
  if (slots.eventTime.value !== null && slots.eventDate.value === null) issue("eventDate", "MISSING");
  const dates: Partial<Record<"eventDate" | "reminderDate" | "endDate", string>> = {};
  for (const field of ["eventDate", "reminderDate", "endDate"] as const) {
    const slot = slots[field]; if (!slot.value) continue;
    const receipt = Date.parse(slot.resolution?.referenceTime ?? candidate.transcript.find(t => t.id === slot.evidence[0]?.sourceTurnId)?.receivedAt ?? "");
    const result = resolveDateOperand(slot.value, receipt, calendar);
    if (result.status !== "RESOLVED") { issue(field, result.reason); continue; }
    if (slot.value.kind === "CIVIL_DATE" && slots.calendar.value && slot.value.calendar !== slots.calendar.value) { issue(field, "CALENDAR_CONFLICT"); continue; }
    dates[field] = result.date;
    slot.resolution = { method: result.method, version: RESOLUTION_VERSION, referenceTime: new Date(receipt).toISOString(), timezone: "Asia/Ho_Chi_Minh", dependencies: [] };
    if (result.inferredYear) slot.provenance = { kind: "DERIVED_POLICY", policyVersion: RESOLUTION_VERSION, referenceTime: new Date(receipt).toISOString(), dependencies: [] };
  }
  const relation = slots.eventRelation.value;
  let count = frequency === "ONCE" ? 1 : slots.occurrenceCount.provenance?.kind === "DERIVED_POLICY" ? null : slots.occurrenceCount.value;
  let start: number | null = null;
  const midnight = (value: string | undefined) => value ? Date.parse(`${value}T00:00:00+07:00`) : null;
  const event = midnight(dates.eventDate), reminder = midnight(dates.reminderDate), end = midnight(dates.endDate);
  const lead = slots.leadOffsetDays.value;
  if (frequency === "ONCE" && slots.occurrenceCount.value !== null && slots.occurrenceCount.value !== 1) issue("occurrenceCount", "ONCE_COUNT_CONFLICT");
  if (frequency === "DAILY" && lead !== null) issue("leadOffsetDays", "COUNT_OFFSET_CONFLICT");
  if (lead !== null && (!Number.isSafeInteger(lead) || lead < 1 || lead > 366)) issue("leadOffsetDays", "LIMIT");
  if (relation === "BEFORE_EVENT" || relation === "INCLUDING_EVENT") {
    if (event === null) issue("eventDate", "MISSING");
    if (reminder !== null || end !== null) issue("reminderDate", "INCOMPATIBLE_ABSOLUTE_AND_RELATIVE");
    if (frequency === "ONCE" && relation === "BEFORE_EVENT" && lead === null) issue("leadOffsetDays", "MISSING");
    if (relation === "INCLUDING_EVENT" && lead !== null) issue("leadOffsetDays", "INCOMPATIBLE_RELATION");
    if (event !== null && count !== null) start = event - (relation === "BEFORE_EVENT" ? (frequency === "ONCE" ? lead ?? 0 : count) : count - 1) * DAY_MS;
  } else {
    if (lead !== null) issue("eventRelation", "OFFSET_REQUIRES_BEFORE_EVENT");
    if (reminder === null) { issue("reminderDate", "MISSING"); if (relation === null) issue("eventRelation", "MISSING"); }
    start = reminder;
    if (frequency === "DAILY" && relation !== "STARTING_ON") issue("eventRelation", "MISSING");
    if (end !== null) {
      if (frequency !== "DAILY" || start === null) issue("endDate", "INCOMPATIBLE_RANGE");
      else {
        const derived = (end - start) / DAY_MS + 1;
        if (count !== null && count !== derived) issue("occurrenceCount", "COUNT_RANGE_CONFLICT");
        if (count === null) derive("occurrenceCount", derived, ["reminderDate", "endDate"]);
        count = derived;
      }
    }
  }
  if (count === null) issue("occurrenceCount", "MISSING");
  else if (!Number.isSafeInteger(count) || count < (frequency === "DAILY" ? 2 : 1) || count > 30) issue("occurrenceCount", "LIMIT");
  if (fields.length || start === null || reminderTime === null || count === null) return clarification();
  const [hour, minute] = reminderTime.split(":").map(Number);
  const occurrences: SeriesOccurrence[] = [];
  for (let index = 0; index < count; index++) {
    const day = start + index * DAY_MS, scheduledAt = day + (hour * 60 + minute) * 60000;
    if (scheduledAt <= now) issue("reminderDate", "PAST_OCCURRENCE");
    if (scheduledAt - now > 366 * DAY_MS) issue("reminderDate", "HORIZON_LIMIT");
    occurrences.push({ index, scheduledAt, localDate: civil(day) });
  }
  if (fields.length) return clarification();
  const source = slots.eventDate.value ?? slots.reminderDate.value;
  const selected = slots.eventDate.value ? slots.eventDate : slots.reminderDate;
  const provenance = selected.provenance ?? { kind: "DERIVED_POLICY", policyVersion: RESOLUTION_VERSION, dependencies: [], referenceTime: selected.resolution!.referenceTime } as SlotProvenance;
  const details: CanonicalDetailsV1 = { schemaVersion: "calenote-reminder-details-1", location: slots.location.value, notes: slots.notes.value, eventDate: dates.eventDate ?? null, eventTime,
    calendarProvenance: { calendar: source?.kind === "CIVIL_DATE" ? source.calendar : slots.calendar.value ?? "GREGORIAN", sourceDate: source, provenance: provenance.kind === "DERIVED_POLICY" ? { ...provenance, dependencies: [] } : provenance }, resolutionVersion: RESOLUTION_VERSION };
  const render = renderReminderDetails(slots.title.value!, details, occurrences);
  if (render.status === "TOO_LONG") {
    for (const field of ["title", "location", "notes"] as const) if (slots[field].value !== null) issue(field, "DETAILS_TOO_LONG");
    return clarification();
  }
  // A residual invariant failure is not evidence that the user's notes are
  // wrong. Known missing dependencies are targeted above before rendering.
  if (render.status === "INVALID") { issue("operation", "INVALID_DETAILS"); return clarification(); }
  const resolvedFacts = projectResolvedFacts(slots, candidate.facts);
  try {
    if (new TextEncoder().encode(encodeContextSnapshot({ ...candidate, slots, facts: resolvedFacts })).length > 16384) { issue("operation", "CONTEXT_SNAPSHOT_TOO_LARGE"); return clarification(); }
  } catch { issue("operation", "INVALID_RESOLVED_STATE"); return clarification(); }
  return { status: "READY", resolvedSlots: slots, resolvedFacts, occurrences, details };
}

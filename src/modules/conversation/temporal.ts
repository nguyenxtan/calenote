import type { CalendarKind, DateFact, MissingField, SeriesRelation } from "./contracts";
import type { LunarCalendarAdapter } from "./lunar-calendar";
import { extractTemporalEvidence } from "../semantic/temporal-evidence";
export type Evidence<T> = { state: "MISSING" } | { state: "RESOLVED"; value: T } | { state: "AMBIGUOUS"; reason: string };
export interface ConversationTemporalEvidence {
  calendar: Evidence<CalendarKind>; eventDate: Evidence<DateFact>; reminderDate: Evidence<DateFact>;
  time: Evidence<string>; count: Evidence<number>; relation: Evidence<SeriesRelation>; missing: MissingField[];
}
// Matching new dialogue productions must not rewrite the accepted scanner's
// vocabulary. Keep original NFC graphemes for every span we do not consume.
function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").replace(/đ/gu, "d").toLowerCase();
}
function replaceProduction(text: string, pattern: RegExp,
  replace: (span: string, ...groups: (string | undefined)[]) => string): string {
  const starts: number[] = [];
  let shadow = "";
  let position = 0;
  for (const character of text) {
    const folded = fold(character);
    for (let i = 0; i < folded.length; i++) starts.push(position);
    shadow += folded;
    position += character.length;
  }
  starts.push(text.length);
  let cursor = 0;
  let result = "";
  for (const match of shadow.matchAll(pattern)) {
    const start = starts[match.index];
    const end = starts[match.index + match[0].length];
    result += text.slice(cursor, start) + replace(text.slice(start, end), ...match.slice(1));
    cursor = end;
  }
  return result + text.slice(cursor);
}
export function extractConversationTemporalEvidence(input: {
  text: string; receivedAt: number; sourceInboundId: string; currentCalendar: CalendarKind;
}, calendar: LunarCalendarAdapter): ConversationTemporalEvidence {
  const result: ConversationTemporalEvidence = { calendar: { state: "MISSING" }, eventDate: { state: "MISSING" }, reminderDate: { state: "MISSING" },
    time: { state: "MISSING" }, count: { state: "MISSING" }, relation: { state: "MISSING" }, missing: [] };
  const original = input.text.normalize("NFC");
  const text = fold(original);
  const lunarRequested = /\b(?:am lich|lich am|ngay am)\b/u.test(text);
  const solarRequested = /\b(?:duong lich|lich duong)\b/u.test(text);
  // A question about the capability is not a scheduling request.
  if (lunarRequested && /\b(?:co|ho tro|luu|dung)\b/u.test(text) && /\b(?:khong|ko)\b/u.test(text)
    && !/\d/u.test(text)) return result;
  if (lunarRequested && solarRequested) {
    result.calendar = { state: "AMBIGUOUS", reason: "CONFLICTING_CALENDARS" };
    result.missing.push("intent");
    return result;
  }
  const calendarKind = lunarRequested ? "LUNAR_VN" : solarRequested ? "GREGORIAN" : input.currentCalendar;
  result.calendar = { state: "RESOLVED", value: calendarKind };
  let scanText = original;
  const counts: number[] = [];
  const cadenceRequested = /\b(?:lien tuc|moi ngay|nhac)\b/u.test(text);
  // Consume complete cadence productions, retaining every separator outside
  // them. Their count is not a date operand; incomplete productions remain for
  // the accepted Temporal Island scanner to reject rather than being erased.
  scanText = replaceProduction(scanText, /\b(\d+)\s+ngay\b(?:\s+(truoc\s+ngay\s+(?:thi|han)|lien\s+tuc))?/gu, (span, count, relation) => {
    if (!relation && !cadenceRequested) return span;
    counts.push(Number(count));
    if (relation?.startsWith("truoc")) result.relation = { state: "RESOLVED", value: "BEFORE_EVENT" };
    return " ".repeat(span.length);
  });
  if (counts.length) {
    result.count = counts.length === 1 && counts[0] >= 1 && counts[0] <= 30
      ? { state: "RESOLVED", value: counts[0] } : { state: "AMBIGUOUS", reason: "INVALID_OR_MULTIPLE_COUNTS" };
  }
  scanText = replaceProduction(scanText, /\b(khong\s+)?tinh\s+(?:ca\s+)?ngay\s+(?:thi|han)\b/gu, (span, excluded) => {
    const value = excluded ? "BEFORE_EVENT" : "INCLUDING_EVENT";
    result.relation = result.relation.state === "RESOLVED" && result.relation.value !== value
      ? { state: "AMBIGUOUS", reason: "CONFLICTING_RELATIONS" } : { state: "RESOLVED", value };
    return " ".repeat(span.length);
  });
  if (/\bbat dau\b/u.test(text)) {
    result.relation = result.relation.state === "MISSING" ? { state: "RESOLVED", value: "STARTING_ON" }
      : { state: "AMBIGUOUS", reason: "CONFLICTING_RELATIONS" };
  }

  const lunarFacts: DateFact[] = [];
  let lunarInvalid = false;
  let lunarIncomplete = false;
  if (calendarKind === "LUNAR_VN") {
    scanText = scanText.replace(/\b(\d{1,2})\s*\/\s*(\d{1,2})(?:\s*\/\s*(\d{4}))?\b/gu,
      (_span, day: string, month: string, year: string | undefined) => {
        // Replace only numeric operands with another complete numeric date.
        // Keep surrounding separators/starters untouched so malformed mixed
        // islands still own DATE/TIME. Never extract a clean prefix and discard
        // its continuation. Missing/invalid conversions cannot resolve DATE.
        if (!year) {
          result.missing.push("year"); lunarIncomplete = true; return "01/01/2000";
        }
        const explicitNormal = /\bthang (?:thuong|khong nhuan)\b/u.test(text);
        const explicitLeap = /\bthang nhuan\b/u.test(text);
        if (explicitNormal && explicitLeap) { lunarInvalid = true; return "01/01/2000"; }
        if (!explicitNormal && !explicitLeap && calendar.hasLeapMonth(Number(year), Number(month))) {
          result.missing.push("leapMonth"); lunarIncomplete = true; return "01/01/2000";
        }
        const lunar = { year: Number(year), month: Number(month), day: Number(day), leap: explicitLeap };
        const converted = calendar.toSolar(lunar);
        if (converted.status !== "RESOLVED") { lunarInvalid = true; return "01/01/2000"; }
        lunarFacts.push({ solarDate: converted.solarDate, calendar: "LUNAR_VN", lunar,
          conversionVersion: calendar.version, sourceInboundId: input.sourceInboundId });
        return converted.solarDate.split("-").reverse().join("/");
      });
    // These words are calendar grammar metadata, not incomplete DATE starters.
    scanText = replaceProduction(scanText, /\b(?:am lich|lich am|thang khong nhuan|thang thuong|thang nhuan)\b/gu, span => " ".repeat(span.length));
  }
  const evidence = extractTemporalEvidence({ text: scanText, referenceNow: input.receivedAt });
  result.time = evidence.time.state === "RESOLVED" ? { state: "RESOLVED", value: evidence.time.localTime }
    : evidence.time.state === "AMBIGUOUS" ? { state: "AMBIGUOUS", reason: evidence.time.reason } : { state: "MISSING" };
  let date: Evidence<DateFact> = { state: "MISSING" };
  if (lunarInvalid || evidence.date.state === "AMBIGUOUS") date = { state: "AMBIGUOUS", reason: "INVALID_OR_CONFLICTING_DATE" };
  else if (!lunarIncomplete && evidence.date.state === "RESOLVED") {
    if (calendarKind === "GREGORIAN") date = { state: "RESOLVED", value: { solarDate: evidence.date.localDate,
      calendar: "GREGORIAN", lunar: null, conversionVersion: null, sourceInboundId: input.sourceInboundId } };
    else if (lunarFacts.length === 1) date = { state: "RESOLVED", value: lunarFacts[0] };
    else date = { state: "AMBIGUOUS", reason: "LUNAR_REQUIRES_EXPLICIT_DATE" };
  }
  // Select the bounded utterance frame, not any keyword inside a title. A
  // reminder verb owns its following title; "nhắc ôn thi" is not an exam-date
  // declaration. Explicit event relations, however, require the event anchor.
  const eventStart = text.search(/\b(?:thi|deadline|han chot)\b/u);
  const reminderStart = text.search(/\bnhac\b/u);
  const eventFrame = (eventStart >= 0 && (reminderStart < 0 || eventStart < reminderStart))
    || (result.relation.state === "RESOLVED" && result.relation.value !== "STARTING_ON");
  if (eventFrame) {
    result.eventDate = date;
    if (date.state === "MISSING" && !lunarIncomplete) result.missing.push("eventDate");
  } else result.reminderDate = date;
  result.missing = [...new Set(result.missing)];
  return result;
}

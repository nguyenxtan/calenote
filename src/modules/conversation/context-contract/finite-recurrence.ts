import { isValidSemanticLocalDate } from "@/modules/semantic/validation";
import type { SeriesOccurrence } from "@/modules/reminders/series";

type Input = { frequency: "WEEKLY" | "MONTHLY"; startDate: string; endDate: string | null; count: number | null; reminderTime: string; now: number };
export type PeriodicExpansion = { status: "READY"; count: number; occurrences: SeriesOccurrence[] }
  | { status: "CLARIFY"; field: "reminderDate" | "reminderTime" | "endDate" | "occurrenceCount"; reason: string; invalidMonth?: string };
const DAY = 86_400_000;

/** Expand only accepted civil operands. Every month uses the original anchor;
 * neither overflow, clamping nor a skipped month can change user intent. */
export function expandPeriodicOccurrences(input: Input): PeriodicExpansion {
  const reject = (field: Extract<PeriodicExpansion, { status: "CLARIFY" }>["field"], reason: string, invalidMonth?: string): PeriodicExpansion =>
    ({ status: "CLARIFY", field, reason, ...(invalidMonth ? { invalidMonth } : {}) });
  if (!isValidSemanticLocalDate(input.startDate)) return reject("reminderDate", "INVALID_DATE");
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(input.reminderTime)) return reject("reminderTime", "AMBIGUOUS_TIME");
  const start = Date.parse(`${input.startDate}T00:00:00Z`);
  const [year, month, day] = input.startDate.split("-").map(Number);
  let count = input.count;
  if (input.endDate !== null) {
    if (!isValidSemanticLocalDate(input.endDate)) return reject("endDate", "INVALID_DATE");
    const end = Date.parse(`${input.endDate}T00:00:00Z`);
    if (end < start) return reject("endDate", "INCOMPATIBLE_RANGE");
    const [endYear, endMonth, endDay] = input.endDate.split("-").map(Number);
    const derived = input.frequency === "WEEKLY" ? Math.floor((end - start) / (7 * DAY)) + 1
      : (endYear - year) * 12 + endMonth - month + 1 - (endDay < day ? 1 : 0);
    if (count !== null && count !== derived) return reject("occurrenceCount", "COUNT_RANGE_CONFLICT");
    count = derived;
  }
  if (count === null) return reject("occurrenceCount", "MISSING");
  if (!Number.isSafeInteger(count) || count < 2 || count > 30) return reject("occurrenceCount", "LIMIT");
  const [hour, minute] = input.reminderTime.split(":").map(Number);
  const occurrences: SeriesOccurrence[] = [];
  for (let index = 0; index < count; index++) {
    let civilDay = start + index * 7 * DAY;
    if (input.frequency === "MONTHLY") {
      const absoluteMonth = year * 12 + month - 1 + index;
      const targetYear = Math.floor(absoluteMonth / 12), targetMonth = absoluteMonth % 12;
      civilDay = Date.UTC(targetYear, targetMonth, day);
      const actual = new Date(civilDay);
      if (actual.getUTCFullYear() !== targetYear || actual.getUTCMonth() !== targetMonth || actual.getUTCDate() !== day) {
        return reject("reminderDate", "MONTH_DAY_MISSING", `${targetYear}-${String(targetMonth + 1).padStart(2, "0")}`);
      }
    }
    const scheduledAt = civilDay + ((hour - 7) * 60 + minute) * 60_000;
    if (scheduledAt <= input.now) return reject("reminderDate", "PAST_OCCURRENCE");
    if (scheduledAt - input.now > 366 * DAY) return reject("reminderDate", "HORIZON_LIMIT");
    occurrences.push({ index, scheduledAt, localDate: new Date(civilDay).toISOString().slice(0, 10) });
  }
  return { status: "READY", count, occurrences };
}

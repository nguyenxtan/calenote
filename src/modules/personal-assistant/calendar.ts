import { PersonalAssistantDocumentSchema, type PersonalAssistantDocument, type PersonalLifeEvent } from "../../contracts/api/personal-assistant";
import { lunarCalendar } from "../conversation/lunar-calendar";

const DAY = 86_400_000;
const VN_OFFSET = 7 * 60 * 60 * 1000;
export interface PlannedLifeEvent {
  eventId: string;
  title: string;
  eventDate: string;
  scheduledAt: number;
  leadDays: number;
  occurrenceKey: string;
}
function annualDate(event: PersonalLifeEvent, year: number): string | null {
  if (event.calendar === "SOLAR") {
    const lastDay = new Date(Date.UTC(year, event.month, 0)).getUTCDate();
    if (event.day > lastDay && event.missingDayPolicy === "SKIP") return null;
    return `${year}-${String(event.month).padStart(2, "0")}-${String(Math.min(event.day, lastDay)).padStart(2, "0")}`;
  }
  const leap = event.leapPolicy === "LEAP_OR_REGULAR" && lunarCalendar.hasLeapMonth(year, event.month);
  const resolved = lunarCalendar.toSolar({ year, month: event.month, day: event.day, leap });
  if (resolved.status === "RESOLVED") return resolved.solarDate;
  if (event.day === 30 && event.missingDayPolicy === "LAST_DAY") {
    const fallback = lunarCalendar.toSolar({ year, month: event.month, day: 29, leap });
    if (fallback.status === "RESOLVED") return fallback.solarDate;
  }
  return null;
}
/** Plans strictly future reminder instants within a bounded horizon, in Vietnam civil time. */
export function planLifeEvents(document: PersonalAssistantDocument, nowMs: number, horizonDays = 366): PlannedLifeEvent[] {
  const parsed = PersonalAssistantDocumentSchema.parse(document);
  if (!Number.isFinite(nowMs) || !Number.isInteger(horizonDays) || horizonDays < 1 || horizonDays > 366) throw new RangeError("Invalid planning horizon");
  const endMs = nowMs + horizonDays * DAY;
  if (!Number.isFinite(endMs) || Number.isNaN(new Date(nowMs).getTime())) throw new RangeError("Invalid planning instant");
  // Include the following event year: a lead offset can put its reminder inside this horizon.
  const startYear = Math.max(1900, new Date(nowMs + VN_OFFSET).getUTCFullYear() - 1);
  const endYear = Math.min(2100, new Date(endMs + 365 * DAY + VN_OFFSET).getUTCFullYear());
  const planned: PlannedLifeEvent[] = [];
  for (const event of parsed.events.filter(item => item.enabled)) {
    const firstYear = event.year ?? startYear;
    const lastYear = event.year ?? endYear;
    for (let year = firstYear; year <= lastYear; year++) {
      const eventDate = annualDate(event, year);
      if (!eventDate) continue;
      const eventMs = Date.parse(`${eventDate}T${event.time}:00+07:00`);
      for (const leadDays of event.leadDays) {
        const scheduledAt = eventMs - leadDays * DAY;
        if (scheduledAt <= nowMs || scheduledAt > endMs) continue;
        planned.push({ eventId: event.id, title: event.title, eventDate, scheduledAt, leadDays, occurrenceKey: `${event.id}:${eventDate}:${leadDays}` });
      }
    }
  }
  return planned.sort((a, b) => a.scheduledAt - b.scheduledAt || a.occurrenceKey.localeCompare(b.occurrenceKey));
}

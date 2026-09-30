import { isValidSemanticLocalDate } from "@/modules/semantic/validation";
import { lunarCalendar } from "./lunar-calendar";

const VIETNAM_ZONE = "Asia/Ho_Chi_Minh";

/** The same civil date is used for today, grid navigation and selected dates. */
export function vietnamCivilDate(instant: number): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: VIETNAM_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(instant);
  const value = (kind: "year" | "month" | "day") => parts.find(part => part.type === kind)?.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}

export function calendarMonth(date: string): { year: number; month: number; days: number; firstWeekday: number } {
  if (!isValidSemanticLocalDate(date)) throw new RangeError("Invalid civil date");
  const [year, month] = date.split("-").map(Number);
  const firstWeekday = (new Date(Date.UTC(year, month - 1, 1)).getUTCDay() + 6) % 7;
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { year, month, days, firstWeekday };
}

export function shiftCalendarMonth(date: string, months: number): string {
  const { year, month } = calendarMonth(date);
  if (!Number.isSafeInteger(months)) throw new RangeError("Invalid month shift");
  return new Date(Date.UTC(year, month - 1 + months, 1)).toISOString().slice(0, 10);
}

export function calendarDayPresentation(solarDate: string, firstVisible = false): {
  lunarAvailable: boolean; lunarLabel: string; fullLabel: string; accessibleText: string;
} {
  if (!isValidSemanticLocalDate(solarDate)) throw new RangeError("Invalid civil date");
  const lunar = lunarCalendar.toLunar(solarDate);
  if (!lunar) return {
    lunarAvailable: false,
    lunarLabel: "Âm lịch không khả dụng",
    fullLabel: "Âm lịch không khả dụng",
    accessibleText: `Dương lịch ${solarDate}, âm lịch không khả dụng`,
  };
  const leap = lunar.leap ? " nhuận" : "";
  const lunarLabel = lunar.day === 1 || firstVisible ? `${lunar.day}/${lunar.month}${leap}` : String(lunar.day);
  const fullLabel = `Âm lịch ${lunar.day}/${lunar.month}/${lunar.year}${leap} · Việt Nam (UTC+7) · ${lunarCalendar.version}`;
  return { lunarAvailable: true, lunarLabel, fullLabel, accessibleText: `Dương lịch ${solarDate}, ${fullLabel}` };
}

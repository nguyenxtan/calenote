import { LunarDateSchema, type LunarDate } from "./contracts";
import { isValidSemanticLocalDate } from "../semantic/validation";
import artifact from "./lunar-vn-months.json";

export interface LunarCalendarAdapter {
  version: string;
  toSolar(input: LunarDate): { status: "RESOLVED"; solarDate: string } | { status: "INVALID" | "OUT_OF_RANGE" };
  toLunar(solarDate: string): LunarDate | null;
  hasLeapMonth(year: number, month: number): boolean;
}
const DAY = 86_400_000;
const monthKey = (year: number, month: number, leap: boolean) => `${year}/${month}/${leap}`;
const byLunar = new Map(artifact.months.map(month => [monthKey(month.year, month.month, month.leap), month]));
const starts = artifact.months.map(month => Date.parse(`${month.start}T00:00:00Z`));

/** Vietnamese fixed UTC+07 civil calendar; no network, database, or ephemeris work at runtime. */
export const lunarCalendar: LunarCalendarAdapter = {
  version: artifact.version,
  toSolar(input) {
    if (Number.isInteger(input?.year) && (input.year < 1900 || input.year > 2100)) return { status: "OUT_OF_RANGE" };
    const parsed = LunarDateSchema.safeParse(input);
    if (!parsed.success) return { status: "INVALID" };
    const date = parsed.data;
    const month = byLunar.get(monthKey(date.year, date.month, date.leap));
    if (!month || date.day > month.days) return { status: "INVALID" };
    return { status: "RESOLVED", solarDate: new Date(Date.parse(`${month.start}T00:00:00Z`) + (date.day - 1) * DAY).toISOString().slice(0, 10) };
  },
  toLunar(solarDate) {
    if (!isValidSemanticLocalDate(solarDate)) return null;
    const day = Date.parse(`${solarDate}T00:00:00Z`);
    let left = 0;
    let right = starts.length;
    while (left < right) {
      const middle = Math.floor((left + right) / 2);
      if (starts[middle] <= day) left = middle + 1; else right = middle;
    }
    const index = left - 1;
    const month = artifact.months[index];
    if (!month || day >= starts[index] + month.days * DAY) return null;
    return { year: month.year, month: month.month, leap: month.leap, day: (day - starts[index]) / DAY + 1 };
  },
  hasLeapMonth(year, month) { return byLunar.has(monthKey(year, month, true)); },
};

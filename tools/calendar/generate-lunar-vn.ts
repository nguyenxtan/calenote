import { SearchMoonPhase, SearchSunLongitude, Seasons } from "astronomy-engine";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

export interface LunarMonth { year: number; month: number; leap: boolean; start: string; days: number }
const DAY = 86_400_000;
const localDay = (date: Date) => Math.floor((date.getTime() + 7 * 3_600_000) / DAY);
const dayString = (day: number) => new Date(day * DAY).toISOString().slice(0, 10);

/** Offline only: runtime imports the resulting table, never this ephemeris dependency. */
export function buildLunarMonths(fromYear: number, toYear: number): LunarMonth[] {
  if (!Number.isInteger(fromYear) || !Number.isInteger(toYear)
    || fromYear < 1900 || toYear > 2100 || fromYear > toYear) throw new Error("Invalid year range");
  const moonDays: number[] = [];
  let cursor = new Date(Date.UTC(fromYear - 1, 10, 1));
  const end = Date.UTC(toYear + 2, 1, 1);
  while (cursor.getTime() < end) {
    const moon = SearchMoonPhase(0, cursor, 35);
    if (!moon) throw new Error("Missing new moon");
    moonDays.push(localDay(moon.date));
    cursor = new Date(moon.date.getTime() + DAY);
  }
  const terms: number[] = [];
  for (let year = fromYear - 1; year <= toYear + 1; year++) {
    for (let angle = 0; angle < 360; angle += 30) {
      const term = SearchSunLongitude(angle, new Date(Date.UTC(year, 0, 1)), 370);
      if (!term) throw new Error("Missing major solar term");
      terms.push(localDay(term.date));
    }
  }
  const monthEleven = (year: number) => {
    const winter = localDay(Seasons(year).dec_solstice.date);
    return moonDays.findLastIndex(day => day <= winter);
  };
  const months: LunarMonth[] = [];
  for (let winterYear = fromYear - 1; winterYear <= toYear; winterYear++) {
    const first = monthEleven(winterYear);
    const last = monthEleven(winterYear + 1);
    const size = last - first;
    if (first < 0 || (size !== 12 && size !== 13)) throw new Error("Invalid winter-to-winter interval");
    let leapIndex = -1;
    if (size === 13) {
      for (let index = first + 1; index < last; index++) {
        if (!terms.some(day => day >= moonDays[index] && day < moonDays[index + 1])) {
          leapIndex = index;
          break;
        }
      }
      if (leapIndex < 0) throw new Error("Leap year has no leap month");
    }
    let month = 11;
    let year = winterYear;
    for (let index = first; index < last; index++) {
      const leap = index === leapIndex;
      if (index > first && !leap) {
        month = month % 12 + 1;
        if (month === 1) year++;
      }
      const days = moonDays[index + 1] - moonDays[index];
      if (days !== 29 && days !== 30) throw new Error("Invalid month length");
      if (year >= fromYear && year <= toYear) months.push({ year, month, leap, start: dayString(moonDays[index]), days });
    }
  }
  if (new Set(months.map(m => `${m.year}/${m.month}/${m.leap}`)).size !== months.length) throw new Error("Duplicate lunar month");
  for (let index = 1; index < months.length; index++) {
    if (Date.parse(months[index].start) !== Date.parse(months[index - 1].start) + months[index - 1].days * DAY) {
      throw new Error("Non-contiguous calendar");
    }
  }
  return months;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const months = buildLunarMonths(1900, 2100);
  const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
  const artifact = { version: "lunar-vn-utc7-ae2.1.19-v1", convention: "UTC+07:00",
    generatorSha256: sha256(readFileSync(fileURLToPath(import.meta.url), "utf8")),
    dataSha256: sha256(JSON.stringify(months)), months };
  const output = new URL("../../src/modules/conversation/lunar-vn-months.json", import.meta.url);
  writeFileSync(output, JSON.stringify(artifact) + "\n");
  console.log(JSON.stringify({ months: months.length, dataSha256: artifact.dataSha256 }));
}

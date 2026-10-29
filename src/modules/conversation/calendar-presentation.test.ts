// @vitest-environment node
import { describe, expect, it } from "vitest";
import reference from "../../../tools/calendar/reference-vectors.json";
import artifact from "./lunar-vn-months.json";
import { lunarCalendar } from "./lunar-calendar";
import { calendarDayPresentation, calendarMonth, shiftCalendarMonth, vietnamCivilDate } from "./calendar-presentation";

const move = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);

describe("shared Vietnamese lunar Calendar projection", () => {
  it("calendar_and_chat_share_lunar_conversion for thirteen reference vectors and adjacent dates", () => {
    expect(reference.vectors).toHaveLength(13);
    for (const vector of reference.vectors) for (const delta of [-1, 0, 1]) {
      const date = move(vector.solarDate, delta);
      const lunar = lunarCalendar.toLunar(date);
      const shown = calendarDayPresentation(date, delta === -1);
      expect(shown.lunarAvailable).toBe(lunar !== null);
      if (lunar) {
        expect(shown.fullLabel).toContain(`${lunar.day}/${lunar.month}/${lunar.year}`);
        expect(shown.lunarLabel).toContain(String(lunar.day));
      }
    }
  });

  it("shows every artifact month boundary, first visible month and leap month", () => {
    for (const month of artifact.months) {
      const first = calendarDayPresentation(month.start, false);
      const last = calendarDayPresentation(move(month.start, month.days - 1), false);
      const priorDate = move(month.start, -1);
      const nextDate = move(month.start, month.days);
      expect(calendarDayPresentation(priorDate).lunarAvailable).toBe(lunarCalendar.toLunar(priorDate) !== null);
      expect(calendarDayPresentation(nextDate).lunarAvailable).toBe(lunarCalendar.toLunar(nextDate) !== null);
      expect(first.lunarLabel).toContain(`1/${month.month}`);
      expect(last.fullLabel).toContain(`${month.days}/${month.month}/${month.year}`);
      if (month.leap) expect(first.lunarLabel).toContain("nhuận");
      expect(calendarDayPresentation(move(month.start, 1), true).lunarLabel).toContain(`/${month.month}`);
    }
    expect(calendarDayPresentation("2004-03-21").fullLabel).toContain("1/2/2004 nhuận");
    expect(calendarDayPresentation("2004-04-18").fullLabel).toContain("29/2/2004 nhuận");
  });

  it("keeps solar dates visible at the coverage edges and labels unavailable lunar dates", () => {
    expect(calendarDayPresentation("1900-01-30").lunarAvailable).toBe(false);
    expect(calendarDayPresentation("1900-01-31").lunarAvailable).toBe(true);
    expect(calendarDayPresentation("2101-01-28").lunarAvailable).toBe(true);
    expect(calendarDayPresentation("2101-01-29").lunarAvailable).toBe(false);
    expect(calendarDayPresentation("2101-01-29").accessibleText).toContain("không khả dụng");
  });

  it("browser_timezone_does_not_move_vietnam_today or month navigation", () => {
    const prior = process.env.TZ;
    try {
      for (const zone of ["America/Los_Angeles", "Pacific/Kiritimati"]) {
        process.env.TZ = zone;
        expect(vietnamCivilDate(Date.parse("2026-09-30T17:30:00Z"))).toBe("2026-10-01");
      }
    } finally { if (prior === undefined) delete process.env.TZ; else process.env.TZ = prior; }
    expect(calendarMonth("2026-10-01")).toEqual({ year: 2026, month: 10, days: 31, firstWeekday: 3 });
    expect(shiftCalendarMonth("2026-12-01", 1)).toBe("2027-01-01");
    expect(shiftCalendarMonth("2026-01-01", -1)).toBe("2025-12-01");
  });
});

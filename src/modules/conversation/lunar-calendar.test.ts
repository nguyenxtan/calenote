// @vitest-environment node
import { expect, it } from "vitest";
import { lunarCalendar } from "./lunar-calendar";
import reference from "../../../tools/calendar/reference-vectors.json";
import artifact from "./lunar-vn-months.json";

it.each(reference.vectors)("matches independent reference $solarDate", ({year, month, day, leap, solarDate}) => {
  const lunar = {year, month, day, leap};
  expect(lunarCalendar.toSolar(lunar)).toEqual({status: "RESOLVED", solarDate});
  expect(lunarCalendar.toLunar(solarDate)).toEqual(lunar);
});

it("round-trips every supported day and rejects nonexistent month days", () => {
  let count = 0;
  for (const month of artifact.months) {
    for (let day = 1; day <= month.days; day++) {
      const lunar = { year: month.year, month: month.month, leap: month.leap, day };
      const solar = lunarCalendar.toSolar(lunar);
      if (solar.status !== "RESOLVED") throw new Error("Roundtrip failed");
      expect(lunarCalendar.toLunar(solar.solarDate)).toEqual(lunar);
      count++;
    }
    expect(lunarCalendar.toSolar({year: month.year, month: month.month, leap: month.leap, day: month.days + 1}).status).toBe("INVALID");
  }
  expect(count).toBeGreaterThan(73_000);
  expect(lunarCalendar.toLunar("1900-01-30")).toBeNull();
}, 15_000);

// Independent published Vietnamese calendar examples, not generator outputs:
// https://www.xemamlich.uhm.vn/calrules.html (accessed 2026-09-25).
it.each([
  [{ year: 1984, month: 1, day: 1, leap: false }, "1984-02-02"],
  [{ year: 2004, month: 2, day: 1, leap: true }, "2004-03-21"],
] as const)("matches the published reference %j", (date, solarDate) => {
  expect(lunarCalendar.toSolar(date)).toEqual({ status: "RESOLVED", solarDate });
  expect(lunarCalendar.toLunar(solarDate)).toEqual(date);
});

it("does not invent a leap month or normalize invalid lunar/solar dates", () => {
  expect(lunarCalendar.hasLeapMonth(1984, 10)).toBe(false);
  expect(lunarCalendar.hasLeapMonth(2004, 2)).toBe(true);
  expect(lunarCalendar.toSolar({ year: 1984, month: 1, day: 1, leap: true }).status).toBe("INVALID");
  expect(lunarCalendar.toSolar({ year: 2101, month: 1, day: 1, leap: false }).status).toBe("OUT_OF_RANGE");
  expect(lunarCalendar.toSolar({ year: 2004, month: 2, day: 31, leap: true }).status).toBe("INVALID");
  expect(lunarCalendar.toLunar("2026-02-30")).toBeNull();
});

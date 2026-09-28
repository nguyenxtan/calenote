import { expect, it } from "vitest";
import type { PendingRequest } from "../conversation/contracts";
import { lunarCalendar } from "../conversation/lunar-calendar";
import { expandFiniteSeries } from "./series";

export const seriesRequest: PendingRequest = { title: "ôn thi", calendar: "GREGORIAN", eventDate: {
  solarDate: "2026-10-11", calendar: "GREGORIAN", lunar: null, conversionVersion: null, sourceInboundId: "anchor" },
  reminderDate: null, reminderTime: "12:00", count: 3, relation: "BEFORE_EVENT", missing: [] };
const now = Date.parse("2026-09-25T03:00:00Z");
it.each([
  ["BEFORE_EVENT", ["2026-10-08", "2026-10-09", "2026-10-10"]],
  ["INCLUDING_EVENT", ["2026-10-09", "2026-10-10", "2026-10-11"]],
] as const)("expands %s exactly", (relation, dates) => {
  const result = expandFiniteSeries({ ...seriesRequest, relation }, now);
  expect(result.status).toBe("READY");
  if (result.status !== "READY") return;
  expect(result.occurrences.map(o => o.localDate)).toEqual(dates);
  expect(result.occurrences.map(o => o.index)).toEqual([0, 1, 2]);
  expect(result.occurrences[0].scheduledAt).toBe(Date.parse(`${dates[0]}T12:00:00+07:00`));
});
it("expands an explicit start across a year boundary", () => {
  const result = expandFiniteSeries({ ...seriesRequest, eventDate: null,
    reminderDate: { ...seriesRequest.eventDate!, solarDate: "2026-12-31" }, relation: "STARTING_ON" }, now);
  expect(result.status === "READY" && result.occurrences.map(o => o.localDate)).toEqual(["2026-12-31", "2027-01-01", "2027-01-02"]);
});
it.each(Array.from({ length: 29 }, (_, i) => i + 2))("preserves exact count %i", count => {
  const result = expandFiniteSeries({ ...seriesRequest, count }, Date.parse("2026-09-01T00:00:00Z"));
  expect(result.status === "READY" && result.occurrences.length).toBe(count);
});
it.each([null, 0, 1, 31, 1.5, Number.NaN])("rejects non-series count %s", count => {
  expect(expandFiniteSeries({ ...seriesRequest, count }, now).status).toBe("REJECTED");
});
it("never shortens a series after its first due time", () => {
  expect(expandFiniteSeries(seriesRequest, Date.parse("2026-10-08T06:00:00Z"))).toEqual({ status: "REJECTED", reason: "PAST" });
});
it("checks all occurrences against the horizon", () => {
  expect(expandFiniteSeries({ ...seriesRequest, eventDate: null, reminderDate: { ...seriesRequest.eventDate!, solarDate: "2027-09-26" }, relation: "STARTING_ON" }, now))
    .toEqual({ status: "REJECTED", reason: "LIMIT" });
});
it.each([{ reminderTime: null }, { relation: null }, { title: null }, { missing: ["time"] as const }])("rejects unresolved request %j", patch => {
  expect(expandFiniteSeries({ ...seriesRequest, ...patch, missing: [...(patch.missing ?? [])] }, now).status).toBe("REJECTED");
});
it("validates lunar provenance before expanding ordinary civil days", () => {
  const lunar = { year: 2027, month: 1, day: 1, leap: false };
  const request = { ...seriesRequest, calendar: "LUNAR_VN" as const, eventDate: { ...seriesRequest.eventDate!, calendar: "LUNAR_VN" as const,
    lunar, solarDate: "2027-02-06", conversionVersion: lunarCalendar.version } };
  const result = expandFiniteSeries(request, now);
  expect(result.status === "READY" && result.occurrences.map(o => o.localDate)).toEqual(["2027-02-03", "2027-02-04", "2027-02-05"]);
  expect(expandFiniteSeries({ ...request, eventDate: { ...request.eventDate, solarDate: "2027-02-07" } }, now).status).toBe("REJECTED");
});

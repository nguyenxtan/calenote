// @vitest-environment node
import { expect, it } from "vitest";
import { extractConversationTemporalEvidence } from "./temporal";
import { lunarCalendar } from "./lunar-calendar";
import { extractTemporalEvidence } from "../semantic/temporal-evidence";

const extract = (text: string, currentCalendar: "GREGORIAN" | "LUNAR_VN" = "GREGORIAN") =>
  extractConversationTemporalEvidence({ text, currentCalendar,
    receivedAt: Date.parse("2026-10-01T02:00:00Z"), sourceInboundId: "synthetic" }, lunarCalendar);

it("preserves count and time without guessing a series relation", () => {
  const value = extract("12h trưa, nhắc liên tục 3 ngày");
  expect(value.time).toEqual({ state: "RESOLVED", value: "12:00" });
  expect(value.count).toEqual({ state: "RESOLVED", value: 3 });
  expect(value.relation.state).toBe("MISSING");
});
it.each(["8h 20/09", "20/09 8h", "mai 8h"])("preserves clean temporal composition: %s", text => {
  const value = extract(text);
  expect(value.time.state).toBe("RESOLVED");
  expect(value.reminderDate.state).toBe("RESOLVED");
});
it.each(["8h; /:30", "mai/9h", "/:lúc 9h", "8h; ngày 9h"])("cannot mask malformed ownership in %s", text => {
  expect(extract(text).time.state).toBe("AMBIGUOUS");
});
it("distinguishes an event date from the time to remind", () => {
  const value = extract("thi hết môn ngày 11/10/2026 ở Quang Trung");
  expect(value.eventDate).toMatchObject({ state: "RESOLVED", value: { solarDate: "2026-10-11" } });
  expect(value.reminderDate.state).toBe("MISSING");
  expect(value.time.state).toBe("MISSING");
});
it.each(["nhắc ôn thi, gấp lắm", "gấp: nhắc chuẩn bị deadline", "nhắc hoàn thành trước hạn chót, urgent"])("asks for an unknown urgent event anchor without inventing cadence: %s", text => {
  const evidence = extract(text);
  expect(evidence.missing).toContain("eventDate");
  expect(evidence.count.state).toBe("MISSING");
  expect(evidence.eventDate.state).toBe("MISSING");
});
it("keeps conflicting dates ambiguous", () => {
  expect(extract("ngày 10/10/2026 hoặc 11/10/2026 nhắc ôn thi").reminderDate.state).toBe("AMBIGUOUS");
});
it.each(["ngày 11/10/2026 lúc 12h nhắc ôn thi", "nhắc ôn thi ngày 11/10/2026 lúc 12h"])("does not steal a reminder date from its title: %s", text => {
  expect(extract(text).reminderDate.state).toBe("RESOLVED");
  expect(extract(text).eventDate.state).toBe("MISSING");
});
it("keeps Gregorian default and lunar capability questions non-activating", () => {
  expect(extract("ngày 10/10/2026 lúc 12h").calendar).toEqual({ state: "RESOLVED", value: "GREGORIAN" });
  const help = extract("có hỗ trợ lịch âm không?");
  expect(help.calendar.state).toBe("MISSING");
  expect(help.reminderDate.state).toBe("MISSING");
});
it("requires lunar year rather than resolving an implicit Gregorian year", () => {
  const value = extract("ngày 15/8 âm lịch lúc 12h");
  expect(value.calendar).toEqual({ state: "RESOLVED", value: "LUNAR_VN" });
  expect(value.reminderDate.state).toBe("MISSING");
  expect(value.missing).toContain("year");
});
it("requires normal or leap month when both exist", () => {
  const value = extract("ngày 1/2/2004 âm lịch lúc 12h");
  expect(value.reminderDate.state).toBe("MISSING");
  expect(value.missing).toContain("leapMonth");
  expect(extract("ngày 1/2/2004 âm lịch tháng nhuận lúc 12h").reminderDate)
    .toMatchObject({ state: "RESOLVED", value: { solarDate: "2004-03-21" } });
});
it.each(["3 ngày trước ngày thi", "nhắc liên tục 3 ngày, không tính ngày thi"])("recognizes explicit anchor exclusion: %s", text => {
  expect(extract(text).relation).toEqual({ state: "RESOLVED", value: "BEFORE_EVENT" });
});

it("preserves accepted scanner ownership under Unicode normalization and order permutations", () => {
  for (const fragment of ["/:lúc 9h", "ngày 9h", "mai/9h", "tuần này/9h", "/:30"]) {
    for (const form of ["NFC", "NFD"] as const) {
      for (const text of [fragment, `8h; ${fragment}`, `${fragment}; 8h`]) {
        const input = text.normalize(form);
        const expected = extractTemporalEvidence({text: input, referenceNow: Date.parse("2026-10-01T02:00:00Z")});
        expect(extract(input).time.state).toBe(expected.time.state);
      }
    }
  }
});

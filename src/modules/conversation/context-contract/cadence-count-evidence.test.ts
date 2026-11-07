import { expect, it } from "vitest";
import { supportsCadenceOperand, continuousClockCadenceCovered } from "./cadence-count-evidence";
import type { SourceEvidence } from "./state";

function grounded(text: string, currentReminder = false, quote = text) {
  const start = [...text.slice(0, text.indexOf(quote))].length, length = [...quote].length;
  const turn = { id: "current", role: "USER" as const, semanticView: text };
  const source: SourceEvidence = { kind: "USER_QUOTE", sourceTurnId: turn.id, sourceMapTurnId: turn.id,
    quote, occurrence: 1, sourceSpan: { start, end: start + length }, viewSpan: { start, end: start + length }, normalizationVersion: "nfc-codepoint-v1" };
  return { daily: supportsCadenceOperand("frequency", "DAILY", [source], [turn], undefined, currentReminder ? turn.id : undefined),
    count: supportsCadenceOperand("occurrenceCount", 7, [source], [turn], undefined, currentReminder ? turn.id : undefined) };
}

// Dropping the continuous clock branch would turn the reported series into one notification.
it.each(["Nhắc liên tục vào 8h sáng.", "Nhắc trước 1 tuần. Liên tục vào 8h sáng.", "Liên tục vào 8h sáng.", "Liên tục lúc 08:00."])("continuous at a clock supports DAILY without inventing a count: %s", text => {
  expect(grounded(text, true)).toEqual({ daily: true, count: false });
});
it("an explicit reminder can author continuous clock cadence without retained context", () => {
  expect(grounded("Nhắc liên tục vào 8h sáng.").daily).toBe(true);
});
it.each(["Đừng nhắc liên tục vào 8h sáng.", "Không liên tục vào 8h sáng.", '"Liên tục vào 8h sáng."', "Nếu liên tục vào 8h sáng.", "Ví dụ nhắc liên tục vào 8h sáng.", "Liên tục vào 8h sáng thì không.", "Liên tục vào 8h sáng?", "Máy chạy liên tục vào 8h sáng.", "Liên tục vào buổi sáng."])("continuous clock does not bypass instruction guards: %s", text => {
  expect(grounded(text, true).daily).toBe(false);
});
it("a quote cannot borrow continuous text outside its span", () => {
  expect(grounded("Nhắc liên tục vào 8h sáng; mang 7 bút.", true, "mang 7 bút").daily).toBe(false);
});
it("clearing retained DAILY cannot satisfy current continuous clock intent", () => {
  const turn={id:"current",role:"USER" as const,semanticView:"Liên tục vào 8h sáng."};
  expect(continuousClockCadenceCovered(turn,[{field:"frequency",value:null}],[],"DAILY",true)).toBe(false);
});

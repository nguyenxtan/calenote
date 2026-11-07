import { expect, it } from "vitest";
import { buildContextInputV2 } from "./context";
import { chat, message, observation } from "./context-test-fixtures";
import { SemanticPatchProposalV3Schema } from "./contracts";
import { validateEvidenceV3 } from "./evidence";
import { leadWeekOffsetCovered } from "./lead-week-evidence";

function check(text: string, changes: Record<string, unknown>, quote = text) {
  const msg = message(text), built = buildContextInputV2({ message: msg, context: chat, snapshot: null, observation: observation(null, msg) });
  if (built.status !== "READY") throw Error(built.reason);
  const evidence = [{ kind: "USER_QUOTE", turn: built.input.currentTurn, quote, occurrence: 1 }];
  return validateEvidenceV3(SemanticPatchProposalV3Schema.parse({ schemaVersion: "calenote-context-3", intent: "CREATE_REMINDER", requestTarget: { kind: "NEW", evidence },
    changes: Object.entries(changes).map(([field, value]) => ({ field, operation: "SET", value, evidence })), query: null, uncertainties: [] }), built);
}

// Removing the unit/amount validator must make wrong-unit or clipped evidence executable.
it.each(["Nhắc trước 2 tuần.", "Nhắc trước 1 ngày.", "Đi công tác 1 tuần trước.", "Đừng nhắc trước 1 tuần.", "Nếu nhắc trước 1 tuần.", '"Nhắc trước 1 tuần."', "Nhắc trước 1 tuần?", "Nhắc trước 1 tuần rưỡi.", "Nhắc trước 1,5 tuần."])("week evidence cannot borrow a different amount, unit, or unsafe source: %s", text => {
  expect(check(text, { leadOffsetWeeks: 1 })).toEqual({ status: "REFUSED", reason: "LEAD_WEEK_OFFSET_NOT_SUPPORTED" });
});
it("week amount cannot borrow a different clause's quote", () => {
  expect(check("Nhắc trước 1 tuần; mang 1 bút.", { leadOffsetWeeks: 1 }, "mang 1 bút")).toEqual({ status: "REFUSED", reason: "LEAD_WEEK_OFFSET_NOT_SUPPORTED" });
});
it.each(["Nhắc trước 1 tuần.", "Nhắc trước một tuần.", "Nhắc 1 tuần trước."])("authored weeks preserve their amount and do not require a manufactured day/count: %s", text => {
  const result = check(text, { leadOffsetWeeks: 1, eventRelation: "BEFORE_EVENT" });
  expect(result.status).toBe("VALID");
  if (result.status === "VALID") expect(result.patch.resolvedChanges).toEqual(expect.arrayContaining([
    expect.objectContaining({ field: "leadOffsetWeeks", value: 1 }), expect.objectContaining({ field: "eventRelation", value: "BEFORE_EVENT" }),
  ]));
});
it("an omitted authored week cannot silently become a default single reminder", () => {
  expect(check("Nhắc trước 1 tuần.", {})).toEqual({ status: "REFUSED", reason: "SEMANTIC_LEAD_WEEK_OFFSET_OMITTED" });
});
it.each(["Nhắc trước 1 tuần rưỡi.", "Nhắc trước 1,5 tuần.", "Nhắc trước 53 tuần."])("unsupported week-looking instructions cannot disappear into a default: %s", text => {
  expect(check(text, {})).toEqual({ status: "REFUSED", reason: "SEMANTIC_LEAD_WEEK_OFFSET_OMITTED" });
});
it("continuous clock intent cannot be omitted into a single notification", () => {
  expect(check("Nhắc liên tục vào 8h sáng.", { reminderTime: { hour: 8, minute: 0, qualifier: "H24" } })).toEqual({ status: "REFUSED", reason: "SEMANTIC_CONTINUOUS_CADENCE_OMITTED" });
});
it("a fresh multi-sentence week request cannot omit DAILY into the backend ONCE default", () => {
  const result=check("Ngày 20/12/2026 đi thi. Nhắc trước 1 tuần. Liên tục vào 8h sáng.", {
    title:"đi thi",eventDate:{kind:"CIVIL_DATE",calendar:"GREGORIAN",day:20,month:12,year:2026,leapMonth:null},
    leadOffsetWeeks:1,eventRelation:"BEFORE_EVENT",reminderTime:{hour:8,minute:0,qualifier:"H24"},
  });
  expect(result.status).toBe("REFUSED");
  if(result.status==="REFUSED")expect(result.reason).toBe("SEMANTIC_CONTINUOUS_CADENCE_OMITTED");
});
it("continuous clock does not authorize a model-computed seven notification count", () => {
  expect(check("Nhắc trước 1 tuần, nhắc liên tục vào 8h sáng.", { leadOffsetWeeks: 1, frequency: "DAILY", occurrenceCount: 7, reminderTime: { hour: 8, minute: 0, qualifier: "H24" } })).toEqual({ status: "REFUSED", reason: "CADENCE_COUNT_NOT_SUPPORTED" });
});
it("clearing a retained week cannot satisfy the current authored week instruction", () => {
  const turn={id:"current",role:"USER" as const,semanticView:"Nhắc trước 1 tuần."};
  expect(leadWeekOffsetCovered(turn,[{field:"leadOffsetWeeks",value:null}],[],1,true)).toBe(false);
});

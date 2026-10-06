import { expect, it } from "vitest";
import { buildContextInputV2 } from "./context";
import { chat, message, observation } from "./context-test-fixtures";
import { SemanticPatchProposalV3Schema } from "./contracts";
import { validateEvidenceV3 } from "./evidence";
import { harness, proposal } from "./service-test-support";
import { date } from "./resolution-test-support";

function check(text: string, value = 2, quote = text, turn?: number) {
  const msg = message(text), built = buildContextInputV2({ message: msg, context: chat, snapshot: null, observation: observation(null, msg) });
  if (built.status !== "READY") throw new Error(built.reason);
  const evidence = [{ kind: "USER_QUOTE", turn: turn ?? built.input.currentTurn, quote, occurrence: 1 }];
  return validateEvidenceV3(SemanticPatchProposalV3Schema.parse({ schemaVersion: "calenote-context-3", intent: "CREATE_REMINDER", requestTarget: { kind: "NEW", evidence }, changes: [{ field: "leadOffsetDays", operation: "SET", value, evidence }], query: null, uncertainties: [] }), built);
}
it.each(["Nhắc trước 2 ngày.", "Nhắc trước hai ngày.", "Nhắc 2 ngày trước ngày thi.", "Nhắc một lần trước ngày thi 2 ngày."])("exact offset accepted: %s", text => expect(check(text).status).toBe("VALID"));
it.each(["2 lần", "Nhắc 2 ngày liên tiếp.", "Nhắc trước ngày thi 2 ngày liên tiếp.", "mang 2 cây bút", "Phòng số 2", "Nhắc trước 3 ngày.", "Đừng nhắc trước 2 ngày.", "Ví dụ nhắc trước 2 ngày.", "Tôi đổi giờ trước 2 ngày."])("unrelated or mismatched offset rejected: %s", text => expect(check(text).status).toBe("REFUSED"));
it("quote cannot borrow offset outside its span", () => expect(check("Nhắc trước 2 ngày; mang 2 cây bút", 2, "mang 2 cây bút").status).toBe("REFUSED"));
it.each(["Nhắc trước ngày thi; tôi đi công tác 2 ngày trước.", "Nhắc trước ngày thi, mang giấy tờ; đừng nhắc trước 2 ngày."])("offset cannot borrow another clause's relation: %s", text => expect(check(text).status).toBe("REFUSED"));
it.each([["Nhắc 2,5 ngày trước.", 5], ["Nhắc 12/2 ngày trước.", 2], ["Nhắc 12:2 ngày trước.", 2]] as const)("partial numeric token cannot bind offset: %s", (text, value) => expect(check(text, value).status).toBe("REFUSED"));
it.each([["Nhắc 2,5 ngày trước.", 5, "5 ngày trước"], ["Nhắc 12/2 ngày trước.", 2, "2 ngày trước"]] as const)("quote cannot hide numeric boundary: %s", (text, value, quote) => expect(check(text, value, quote).status).toBe("REFUSED"));
it("quote cannot hide consecutive-count suffix", () => expect(check("Nhắc trước ngày thi 2 ngày liên tiếp.", 2, "trước ngày thi 2 ngày").status).toBe("REFUSED"));
it("source and missing quote checks remain mandatory", () => {
  expect(check("Nhắc trước 2 ngày.", 2, "Nhắc trước 2 ngày.", 1).status).toBe("REFUSED");
  expect(check("Nhắc trước 2 ngày.", 2, "không có").status).toBe("REFUSED");
});
it("R02 unsupported offset never enters merge; count and pending time survive", async () => {
  const h = await harness([proposal({ title: "đi thi", eventDate: date(), frequency: "DAILY", occurrenceCount: 2, eventRelation: "BEFORE_EVENT" }), proposal({ leadOffsetDays: 2 }, "CURRENT")]);
  await h.turn(0, "Nhắc hai ngày liên tiếp trước ngày thi 11/10.");
  await h.turn(1, "mang 2 cây bút");
  const state = await h.read(2);
  expect(state?.slots.leadOffsetDays.value).toBeNull();
  expect(state?.slots.occurrenceCount.value).toBe(2);
  expect(state?.pendingReminderQuestion?.field).toBe("reminderTime");
});
it("explicit offset and omitted canonical carry-forward remain valid", async () => {
  const h = await harness([proposal({ title: "đi thi", eventDate: date(), frequency: "ONCE", eventRelation: "BEFORE_EVENT", leadOffsetDays: 2 }), proposal({ notes: "giấy tờ" }, "CURRENT")]);
  await h.turn(0, "Nhắc đi thi ngày 11/10 trước 2 ngày.");
  expect((await h.read(1))?.slots.leadOffsetDays.value).toBe(2);
  await h.turn(1, "Mang giấy tờ.");
  expect((await h.read(2))?.slots.leadOffsetDays.value).toBe(2);
});
it("exact offset CONTEXT_FACT reuse remains accepted without a new numeric quote", async () => {
  const reuse = proposal({ leadOffsetDays: 2 }, "CURRENT");
  const h = await harness([proposal({ title: "đi thi", eventDate: date(), frequency: "ONCE", eventRelation: "BEFORE_EVENT", leadOffsetDays: 2 }), input => {
    const raw = reuse(input) as { changes: Array<{ evidence: unknown[] }> };
    const fact = input.facts.find(f => f.field === "leadOffsetDays");
    if (!fact) throw new Error("OFFSET_FACT_MISSING");
    raw.changes[0].evidence = [{ kind: "CONTEXT_FACT", ref: fact.alias }];
    return raw;
  }]);
  await h.turn(0, "Nhắc đi thi ngày 11/10 trước 2 ngày.");
  await h.turn(1, "Giữ như cũ.");
  expect((await h.read(2))?.slots.leadOffsetDays.value).toBe(2);
});
it("absence of mandatory evidence remains a structural rejection", () => {
  expect(SemanticPatchProposalV3Schema.safeParse({ schemaVersion: "calenote-context-3", intent: "CREATE_REMINDER", requestTarget: { kind: "NEW", evidence: [] }, changes: [{ field: "leadOffsetDays", operation: "SET", value: 2, evidence: [] }], query: null, uncertainties: [] }).success).toBe(false);
});

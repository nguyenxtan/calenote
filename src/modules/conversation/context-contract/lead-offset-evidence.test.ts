import { expect, it } from "vitest";
import { buildContextInputV2 } from "./context";
import { chat, message, observation } from "./context-test-fixtures";
import { SemanticPatchProposalV3Schema } from "./contracts";
import { validateEvidenceV3 } from "./evidence";
import { harness, proposal } from "./service-test-support";
import { date, time } from "./resolution-test-support";
import { supportsLeadOffset } from "./lead-offset-evidence";
import { supportsEventRelation } from "./event-relation-evidence";
import { turn } from "./context-test-fixtures";

function check(text: string, value = 2, quote = text, turn?: number) {
  const msg = message(text), built = buildContextInputV2({ message: msg, context: chat, snapshot: null, observation: observation(null, msg) });
  if (built.status !== "READY") throw new Error(built.reason);
  const evidence = [{ kind: "USER_QUOTE", turn: turn ?? built.input.currentTurn, quote, occurrence: 1 }];
  return validateEvidenceV3(SemanticPatchProposalV3Schema.parse({ schemaVersion: "calenote-context-3", intent: "CREATE_REMINDER", requestTarget: { kind: "NEW", evidence }, changes: [{ field: "leadOffsetDays", operation: "SET", value, evidence }], query: null, uncertainties: [] }), built);
}
it.each([["nhắc trước sự kiện 5 ngày", true], ["nhắc 5 ngày liên tiếp trước sự kiện", false]] as const)("prompt distance/series contrast preserves exact evidence admission: %s", (text, offsetSupported) => {
  const source = turn(text), n = [...text].length;
  const evidence = [{ kind: "USER_QUOTE" as const, sourceTurnId: source.id, sourceMapTurnId: source.id, quote: text, occurrence: 1, sourceSpan: { start: 0, end: n }, viewSpan: { start: 0, end: n }, normalizationVersion: "nfc-codepoint-v1" as const }];
  expect(supportsEventRelation("BEFORE_EVENT", evidence, [source])).toBe(true);
  expect(supportsLeadOffset(5, evidence, [source])).toBe(offsetSupported);
});
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
  const h = await harness([proposal({ title: "đi thi", eventDate: date(), eventRelation: "BEFORE_EVENT", leadOffsetDays: 2 }), proposal({ notes: "giấy tờ" }, "CURRENT")]);
  await h.turn(0, "Nhắc đi thi ngày 11/10 trước 2 ngày.");
  expect((await h.read(1))?.slots.leadOffsetDays.value).toBe(2);
  await h.turn(1, "Mang giấy tờ.");
  expect((await h.read(2))?.slots.leadOffsetDays.value).toBe(2);
});
it("exact offset CONTEXT_FACT reuse remains accepted without a new numeric quote", async () => {
  const reuse = proposal({ leadOffsetDays: 2 }, "CURRENT");
  const h = await harness([proposal({ title: "đi thi", eventDate: date(), eventRelation: "BEFORE_EVENT", leadOffsetDays: 2 }), input => {
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

it.each(["Nhắc trước 2 ngày.", "Nhắc trước hai ngày.", "Nhắc 2 ngày trước ngày thi.", "Nhắc 2 ngày liên tiếp.", "mang 2 cây bút"])("retained count does not own offset: %s", async text => {
  const h = await harness([proposal({ title: "đi thi", eventDate: date(), frequency: "DAILY", occurrenceCount: 2 }), proposal({ leadOffsetDays: 2 }, "CURRENT")]);
  await h.turn(0, "Ngày 11/10 đi thi, nhắc 2 ngày liên tiếp.");
  await h.turn(1, text);
  const state = await h.read(2);
  expect(state?.slots.leadOffsetDays.value).toBeNull();
  expect(state?.slots.occurrenceCount.value).toBe(2);
});
it.each(["Bắt đầu nhắc trước 2 ngày.", "Nhắc một lần trước ngày thi 2 ngày."])("independent start offset survives retained count: %s", async text => {
  const h = await harness([proposal({ title: "đi thi", eventDate: date(), frequency: "DAILY", occurrenceCount: 2 }), proposal({ eventRelation: "BEFORE_EVENT", leadOffsetDays: 2 }, "CURRENT")]);
  await h.turn(0, "Ngày 11/10 đi thi, nhắc 2 ngày liên tiếp.");
  await h.turn(1, text);
  expect((await h.read(2))?.slots.leadOffsetDays.value).toBe(2);
});
it("different explicit offset remains grounded and enters count conflict computation", async () => {
  const h = await harness([proposal({ title: "đi thi", eventDate: date(), frequency: "DAILY", occurrenceCount: 2 }), proposal({ eventRelation: "BEFORE_EVENT", leadOffsetDays: 3 }, "CURRENT")]);
  await h.turn(0, "Ngày 11/10 đi thi, nhắc 2 ngày liên tiếp.");
  await h.turn(1, "Nhắc trước 3 ngày.");
  const state = await h.read(2);
  expect(state?.slots.leadOffsetDays.value).toBe(3);
  expect(state?.pendingReminderQuestion?.field).toBe("leadOffsetDays");
});
it("NEW explicit offset never borrows the retained request's count", async () => {
  const h = await harness([proposal({ title: "đi thi", eventDate: date(), frequency: "DAILY", occurrenceCount: 2 }), proposal({ title: "họp", eventDate: date(), eventRelation: "BEFORE_EVENT", leadOffsetDays: 2 }, "NEW")]);
  await h.turn(0, "Ngày 11/10 đi thi, nhắc 2 ngày liên tiếp.");
  await h.turn(1, "Việc mới: nhắc họp ngày 11/10 trước 2 ngày.");
  const lastEvidence = h.events.filter(e => e.event === "POST_CANONICAL_STAGE" && e.diagnostic.stage === "EVIDENCE").at(-1);
  expect(lastEvidence).toMatchObject({ diagnostic: { result: "PASS" } });
});

it.each(["Bắt đầu nhắc; nhắc trước 2 ngày.", "Nhắc một lần; nhắc trước 2 ngày.", "Đừng bắt đầu nhắc trước 2 ngày.", "Ví dụ bắt đầu nhắc trước 2 ngày.", "Bắt đầu nhắc 2 ngày liên tiếp và nhắc trước 2 ngày.", "Bắt đầu nhắc ở nhà rồi nhắc trước 2 ngày.", "Nhắc một lần khi về nhà và nhắc trước 2 ngày."])("independent offset cannot borrow another or non-executable clause: %s", text => {
  const source = turn(text), n = [...text].length;
  const evidence = [{ kind: "USER_QUOTE" as const, sourceTurnId: source.id, sourceMapTurnId: source.id, quote: text, occurrence: 1, sourceSpan: { start: 0, end: n }, viewSpan: { start: 0, end: n }, normalizationVersion: "nfc-codepoint-v1" as const }];
  expect(supportsLeadOffset(2, evidence, [source], 2)).toBe(false);
});
it.each(["Bắt đầu nhắc 2 ngày liên tiếp và nhắc trước 2 ngày.", "Bắt đầu nhắc ở nhà rồi nhắc trước 2 ngày.", "Nhắc một lần khi về nhà và nhắc trước 2 ngày."])("V3 proposal cannot borrow an unrelated independent marker: %s", async text => {
  const h = await harness([proposal({ title: "đi thi", eventDate: date(), frequency: "DAILY", occurrenceCount: 2 }), proposal({ leadOffsetDays: 2 }, "CURRENT")]);
  await h.turn(0, "Ngày 11/10 đi thi, nhắc 2 ngày liên tiếp.");
  await h.turn(1, text);
  expect((await h.read(2))?.slots.leadOffsetDays.value).toBeNull();
});
it("narrow quote cannot borrow an independent-start instruction outside its span", () => {
  const source = turn("Bắt đầu nhắc trước 2 ngày."), quote = "trước 2 ngày", start = 13, end = 24;
  const evidence = [{ kind: "USER_QUOTE" as const, sourceTurnId: source.id, sourceMapTurnId: source.id, quote, occurrence: 1, sourceSpan: { start, end }, viewSpan: { start, end }, normalizationVersion: "nfc-codepoint-v1" as const }];
  expect(supportsLeadOffset(2, evidence, [source], 2)).toBe(false);
});
it("a grounded relation-only continuation preserves count and asks for the actual missing clock", async () => {
  const h = await harness([proposal({ title: "đi thi", location: "Quang Trung", eventDate: date(), frequency: "DAILY", occurrenceCount: 2 }), proposal({ eventRelation: "BEFORE_EVENT" }, "CURRENT")]);
  await h.turn(0, "Ngày 11/10 đi thi ở Quang Trung, nhắc 2 ngày liên tiếp giúp tôi.");
  await h.turn(1, "Nhắc trước 2 ngày.");
  const state = await h.read(2);
  expect(state?.slots.leadOffsetDays.value).toBeNull();
  expect(state?.slots.eventRelation.value).toBe("BEFORE_EVENT");
  expect(state?.slots.occurrenceCount.value).toBe(2);
  expect(state?.pendingReminderQuestion?.field).toBe("reminderTime");
});

it("offset alone leaves cadence absent until backend schedule readiness applies its default", async () => {
  const h = await harness([proposal({ title: "đi thi", eventDate: date(), eventRelation: "BEFORE_EVENT", leadOffsetDays: 2 }), proposal({ reminderTime: time() }, "CURRENT")]);
  await h.turn(0, "Ngày 11/10 đi thi, nhắc tôi trước 2 ngày.");
  const pending = await h.read(1);
  expect(pending?.slots.frequency.value).toBeNull();
  expect(pending?.slots.occurrenceCount.value).toBeNull();
  expect(pending?.slots.leadOffsetDays.value).toBe(2);
  expect(pending?.pendingReminderQuestion?.field).toBe("reminderTime");
  await h.turn(1, "8h.");
  expect((await h.read(2))?.slots.frequency.value).toBe("ONCE");
});
it("an independently explicit single cadence remains a supplied fact before clock readiness", async () => {
  const h = await harness([proposal({ title: "đi thi", eventDate: date(), eventRelation: "BEFORE_EVENT", leadOffsetDays: 2, frequency: "ONCE" })]);
  await h.turn(0, "Ngày 11/10 đi thi, nhắc một lần trước 2 ngày.");
  expect((await h.read(1))?.slots.frequency.value).toBe("ONCE");
});

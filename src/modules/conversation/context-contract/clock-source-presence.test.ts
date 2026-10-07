import { expect, it } from "vitest";
import { buildContextInputV2 } from "./context";
import { chat, message, observation } from "./context-test-fixtures";
import { SemanticPatchProposalV3Schema } from "./contracts";
import { validateEvidenceV3 } from "./evidence";
import { harness, proposal } from "./service-test-support";
import { date, time } from "./resolution-test-support";

function check(text: string, quote = text, field: "eventTime" | "reminderTime" = "reminderTime", value = time()) {
  const msg = message(text), built = buildContextInputV2({ message: msg, context: chat, snapshot: null, observation: observation(null, msg) });
  if (built.status !== "READY") throw new Error(built.reason);
  const evidence = [{ kind: "USER_QUOTE", turn: built.input.currentTurn, quote, occurrence: 1 }];
  return validateEvidenceV3(SemanticPatchProposalV3Schema.parse({ schemaVersion: "calenote-context-3", intent: "CREATE_REMINDER", requestTarget: { kind: "NEW", evidence }, changes: [{ field, operation: "SET", value, evidence }], query: null, uncertainties: [] }), built);
}

it.each(["Đừng bỏ.", "Tiếp tục.", "Nhắc trước 2 ngày.", "Ngày 11/10 đi thi.", "Nhắc 2 ngày liên tiếp.", "Nhắc buổi sáng."])("clock cannot be manufactured from no-clock source: %s", text => {
  expect(check(text)).toEqual({ status: "REFUSED", reason: "CLOCK_SOURCE_MISSING" });
});
it("event clock requires a clock source too", () => expect(check("Ngày 11/10 đi thi.", undefined, "eventTime").status).toBe("REFUSED"));
it("clock outside the selected evidence span cannot be borrowed", () => expect(check("8h; đừng bỏ.", "đừng bỏ.").status).toBe("REFUSED"));
it.each(["8h.", "Nhắc lúc 8h sáng.", "Nhắc lúc 08:00."])("source presence does not change a grounded clock: %s", text => expect(check(text).status).toBe("VALID"));
it.each([["Nhắc vào nửa đêm.", 0], ["Remind at midnight.", 0], ["Remind at noon.", 12]] as const)("a complete named clock is not absent merely because the scanner lacks it: %s", (text, hour) => {
  expect(check(text, text, "reminderTime", { ...time(), hour }).status).toBe("VALID");
});
it.each(["noon2", "user_midnight_key", "nửa đêm2", "midnight_", "_noon", "noon\u0338"])("embedded named token cannot bypass absence: %s", text => {
  expect(check(text).status).toBe("REFUSED");
});

it("uncertainty alternatives cannot fabricate clock operands either", () => {
  const msg = message("Đừng bỏ."), built = buildContextInputV2({ message: msg, context: chat, snapshot: null, observation: observation(null, msg) });
  if (built.status !== "READY") throw Error(built.reason);
  const evidence = [{ kind: "USER_QUOTE", turn: built.input.currentTurn, quote: msg.text, occurrence: 1 }];
  const raw = SemanticPatchProposalV3Schema.parse({ schemaVersion: "calenote-context-3", intent: "CREATE_REMINDER", requestTarget: { kind: "NEW", evidence }, changes: [], query: null, uncertainties: [{ field: "reminderTime", reason: "AMBIGUOUS", alternatives: [{ value: time(), evidence }] }] });
  expect(validateEvidenceV3(raw, built)).toEqual({ status: "REFUSED", reason: "CLOCK_SOURCE_MISSING" });
});

it("rejected continuation cannot create a preview or replace the missing clock", async () => {
  const h = await harness([proposal({ title: "đi thi", eventDate: date(), eventRelation: "BEFORE_EVENT", leadOffsetDays: 2 }), proposal({ reminderTime: time() }, "CURRENT")]);
  await h.turn(0, "Ngày 11/10 đi thi, nhắc trước 2 ngày.");
  const before = await h.read(1);
  await h.turn(1, "Đừng bỏ.");
  const after = await h.read(2);
  expect(after?.slots.reminderTime.value).toBeNull();
  expect(after?.pendingReminderQuestion?.field).toBe("reminderTime");
  expect(after?.requestId).toBe(before?.requestId);
  expect(h.events).toContainEqual(expect.objectContaining({ event: "POST_CANONICAL_STAGE", diagnostic: expect.objectContaining({ stage: "EVIDENCE", result: "REJECTED", reason: "CLOCK_SOURCE_MISSING" }) }));
  expect(await h.f.db.prepare("SELECT count(*) AS n FROM reminders").first<number>("n")).toBe(0);
});

it("exact canonical clock fact reuse needs no new clock in the continuation", async () => {
  const h = await harness([proposal({ title: "đi thi", eventDate: date(), reminderTime: time() }), input => {
    const raw = proposal({ reminderTime: time() }, "CURRENT")(input) as { changes: Array<{ evidence: unknown[] }> };
    const fact = input.facts.find(f => f.field === "reminderTime");
    if (!fact) throw Error("CLOCK_FACT_MISSING");
    raw.changes[0].evidence = [{ kind: "CONTEXT_FACT", ref: fact.alias }];
    return raw;
  }]);
  await h.turn(0, "Ngày 11/10 đi thi, nhắc lúc 8h.");
  await h.turn(1, "Giữ như cũ.");
  expect((await h.read(2))?.slots.reminderTime.value).toEqual(time());
  expect(h.events.filter(e => e.event === "POST_CANONICAL_STAGE" && e.diagnostic.stage === "EVIDENCE").at(-1)).toMatchObject({ diagnostic: { result: "PASS" } });
});

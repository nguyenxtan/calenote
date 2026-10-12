import { expect, it } from "vitest";
import { buildContextInputV2 } from "./context";
import { chat, message, observation } from "./context-test-fixtures";
import { SemanticPatchProposalV3Schema } from "./contracts";
import { validateEvidenceV3 } from "./evidence";
import { harness, proposal } from "./service-test-support";
import { date, time } from "./resolution-test-support";
import { supportsCadenceOperand } from "./cadence-count-evidence";

function check(text: string, changes: Record<string, unknown>, quote = text) {
  const msg = message(text), built = buildContextInputV2({ message: msg, context: chat, snapshot: null, observation: observation(null, msg) });
  if (built.status !== "READY") throw Error(built.reason);
  const evidence = [{ kind: "USER_QUOTE", turn: built.input.currentTurn, quote, occurrence: 1 }];
  const raw = SemanticPatchProposalV3Schema.parse({ schemaVersion: "calenote-context-3", intent: "CREATE_REMINDER", requestTarget: { kind: "NEW", evidence }, changes: Object.entries(changes).map(([field, value]) => ({ field, operation: "SET", value, evidence })), query: null, uncertainties: [] });
  return { result: validateEvidenceV3(raw, built), raw };
}

it.each([
  ["Nhắc trước 2 ngày.", { frequency: "DAILY" }],
  ["Nhắc trước 2 ngày.", { occurrenceCount: 2 }],
  ["Nhắc 2 ngày trước.", { frequency: "DAILY", occurrenceCount: 2 }],
  ["Nhắc trước 2 ngày, mỗi ngày.", { occurrenceCount: 2 }],
  ["Nhắc 3 ngày liên tiếp, trước 2 ngày.", { occurrenceCount: 2 }],
  ["Phòng số 2.", { occurrenceCount: 2 }],
  ["Ngày 2/10 đi thi.", { occurrenceCount: 2 }],
  ["Nhắc lúc 2h.", { occurrenceCount: 2 }],
  ["Nhắc 3 lần.", { occurrenceCount: 2 }],
  ["Nhắc trước 2 ngày.", { frequency: "ONCE" }],
] as const)("cadence/count requires independent field-value evidence: %s", (text, changes) => {
  const { result, raw } = check(text, changes);
  expect(result).toEqual({ status: "REFUSED", reason: "CADENCE_COUNT_NOT_SUPPORTED" });
  expect(raw.changes.map(c => c.value)).toEqual(Object.values(changes));
});

it.each([
  ["Nhắc 2 ngày liên tiếp.", { frequency: "DAILY", occurrenceCount: 2 }],
  ["Không nhắc hàng ngày và nhắc hàng tuần.", { frequency: "WEEKLY" }],
  ["Nhắc liên tục 2 ngày.", { frequency: "DAILY", occurrenceCount: 2 }],
  ["Nhắc mỗi ngày trong 3 ngày.", { frequency: "DAILY", occurrenceCount: 3 }],
  ["Nhắc 2 lần.", { occurrenceCount: 2 }],
  ["Nhắc một lần trước 2 ngày.", { frequency: "ONCE", leadOffsetDays: 2 }],
  ["Nhắc hàng tuần.", { frequency: "WEEKLY" }],
  ["Nhắc hàng tháng.", { frequency: "MONTHLY" }],
  ["Nhắc hàng năm.", { frequency: "YEARLY" }],
  ["Nhắc mỗi ngày trong 3 ngày; nhắc trước 2 ngày.", { frequency: "DAILY", occurrenceCount: 3, leadOffsetDays: 2 }],
] as const)("explicit own operands retain their meanings: %s", (text, changes) => expect(check(text, changes).result.status).toBe("VALID"));

it.each(["Không nhắc 2 ngày liên tiếp.", "Nếu nhắc 2 ngày liên tiếp.", "Ví dụ nhắc 2 ngày liên tiếp.", "Tên là 2 ngày liên tiếp.", "Nhắc '2 ngày liên tiếp'."])("source cannot hide non-executable count context: %s", text => {
  expect(check(text, { frequency: "DAILY", occurrenceCount: 2 }, "2 ngày liên tiếp").result.status).toBe("REFUSED");
});
it("cadence cue outside selected quote cannot authorize a distance number", () => {
  expect(check("Nhắc hàng ngày; nhắc trước 2 ngày.", { frequency: "DAILY" }, "nhắc trước 2 ngày").result.status).toBe("REFUSED");
});
it.each(["Nhắc 1.2 lần.", "Nhắc 1/2 lần.", "Nhắc -2 lần.", "Nhắc +2 lần.", "Nhắc 2.0 lần.", "Nhắc 3:2 lần.", "Nhắc x2 lần.", "Nhắc 2 lần_x."])("numeric token cannot borrow a fraction/sign/date/identifier fragment: %s", text => {
  expect(check(text, { occurrenceCount: 2 }).result.status).toBe("REFUSED");
});
it("explicit supported lead distance must be covered rather than silently omitted", () => {
  expect(check("Ngày 11/10 đi thi, nhắc trước 2 ngày.", { title: "đi thi", eventDate: date() }).result).toEqual({ status: "REFUSED", reason: "SEMANTIC_LEAD_OFFSET_OMITTED" });
});
it("grounded lead-distance patch remains valid without manufactured cadence", () => {
  expect(check("Ngày 11/10 đi thi, nhắc trước 2 ngày.", { title: "đi thi", eventDate: date(), leadOffsetDays: 2, eventRelation: "BEFORE_EVENT" }).result.status).toBe("VALID");
});
it("count alternatives cannot borrow an unrelated number", () => {
  const msg = message("Phòng số 2."), built = buildContextInputV2({ message: msg, context: chat, snapshot: null, observation: observation(null, msg) });
  if (built.status !== "READY") throw Error(built.reason);
  const evidence = [{ kind: "USER_QUOTE", turn: built.input.currentTurn, quote: msg.text, occurrence: 1 }];
  const raw = SemanticPatchProposalV3Schema.parse({ schemaVersion: "calenote-context-3", intent: "CREATE_REMINDER", requestTarget: { kind: "NEW", evidence }, changes: [], query: null, uncertainties: [{ field: "occurrenceCount", reason: "AMBIGUOUS", alternatives: [{ value: 2, evidence }] }] });
  expect(validateEvidenceV3(raw, built)).toEqual({ status: "REFUSED", reason: "CADENCE_COUNT_NOT_SUPPORTED" });
});
it("invalid R05 cadence does not mutate slots or manufacture a preview", async () => {
  const h = await harness([proposal({ title: "đi thi", eventDate: date(), frequency: "DAILY", occurrenceCount: 2, eventRelation: "BEFORE_EVENT" })]);
  await h.turn(0, "Ngày 11/10 đi thi, nhắc trước 2 ngày.");
  // Exact matched singleton admission now refuses unsupported numeric roots
  // before evidence materialization; the unchanged direct semantic guard is
  // independently retained for a bypass reaching that later boundary.
  expect(h.events).toContainEqual(expect.objectContaining({ event: "POST_CANONICAL_STAGE", diagnostic: expect.objectContaining({ stage: "CANONICAL", result: "REJECTED", reason: "SCHEMA_INVALID" }) }));
  expect(check("Ngày 11/10 đi thi, nhắc trước 2 ngày.",{title:"đi thi",eventDate:date(),frequency:"DAILY",occurrenceCount:2,eventRelation:"BEFORE_EVENT"}).result).toEqual({status:"REFUSED",reason:"CADENCE_COUNT_NOT_SUPPORTED"});
  expect((await h.read(1))?.slots.occurrenceCount.value ?? null).toBeNull();
  expect(h.replies.some(r => r.kind === "PREVIEW")).toBe(false);
  expect(await h.f.db.prepare("SELECT count(*) AS n FROM reminders").first<number>("n")).toBe(0);
});
it("exact retained cadence/count facts survive a continuation without new numeric language", async () => {
  const h = await harness([proposal({ title: "đi thi", eventDate: date(), frequency: "DAILY", occurrenceCount: 2 }), input => {
    const raw = proposal({ frequency: "DAILY", occurrenceCount: 2 }, "CURRENT")(input) as { changes: Array<{ field: string; evidence: unknown[] }> };
    for (const change of raw.changes) {
      const fact = input.facts.find(f => f.field === change.field);
      if (!fact) throw Error("RETAINED_FACT_MISSING");
      change.evidence = [{ kind: "CONTEXT_FACT", ref: fact.alias }];
    }
    return raw;
  }]);
  await h.turn(0, "Ngày 11/10 đi thi, nhắc 2 ngày liên tiếp.");
  await h.turn(1, "Giữ như cũ.");
  expect((await h.read(2))?.slots.occurrenceCount.value).toBe(2);
  expect(h.events.filter(e => e.event === "POST_CANONICAL_STAGE" && e.diagnostic.stage === "EVIDENCE").at(-1)).toMatchObject({ diagnostic: { result: "PASS" } });
});
it.each([
  ["Ngày thi 2 lần.", { occurrenceCount: 2 }],
  ["Nhắc mỗi ngày; đi công tác trong 3 ngày.", { occurrenceCount: 3 }],
  ["Nhắc mỗi ngày và đi công tác trong 3 ngày.", { occurrenceCount: 3 }],
  ["Đi công tác trong 3 ngày; nhắc hàng ngày.", { occurrenceCount: 3 }],
] as const)("event/duration numbers cannot borrow notification ownership: %s", (text, changes) => {
  expect(check(text, changes).result.status).toBe("REFUSED");
});
it.each([
  ["Mỗi thứ hai nhắc tôi gọi khách hàng.", { frequency: "WEEKLY" }],
  ["Ngày 6/10 bắt đầu nhắc đi bộ ba ngày liền lúc 6h sáng.", { frequency: "DAILY", occurrenceCount: 3 }],
] as const)("explicit weekday recurrence and consecutive-day language remain supported: %s", (text, changes) => {
  expect(check(text, changes).result.status).toBe("VALID");
});
it("a pending count question cannot authorize a clipped lead-distance quote", async () => {
  const h = await harness([proposal({ title: "đi thi", eventDate: date(), reminderTime: time(), frequency: "DAILY", eventRelation: "BEFORE_EVENT" }), input => {
    const raw = proposal({ occurrenceCount: 2 }, "CURRENT")(input) as { changes: Array<{ evidence: unknown[] }> };
    raw.changes[0].evidence = [{ kind: "USER_QUOTE", turn: input.currentTurn, quote: "2", occurrence: 1 }];
    return raw;
  }]);
  await h.turn(0, "Ngày 11/10 đi thi, nhắc mỗi ngày trước ngày thi lúc 8h.");
  expect((await h.read(1))?.pendingReminderQuestion?.field).toBe("occurrenceCount");
  await h.turn(1, "Nhắc trước 2 ngày.");
  expect((await h.read(2))?.slots.occurrenceCount.value).toBeNull();
});
it("pending-count verifier itself rejects a number clipped from a lead clause", () => {
  const text = "Nhắc trước 2 ngày.", start = [...text.slice(0, text.indexOf("2"))].length;
  const source = { kind: "USER_QUOTE" as const, sourceTurnId: "t", sourceMapTurnId: "t", quote: "2", occurrence: 1, sourceSpan: { start, end: start + 1 }, viewSpan: { start, end: start + 1 }, normalizationVersion: "nfc-codepoint-v1" as const };
  expect(supportsCadenceOperand("occurrenceCount", 2, [source], [{ id: "t", role: "USER", semanticView: text }], "t")).toBe(false);
});
it("whole bare answer to the actual count question remains eligible", async () => {
  const h = await harness([proposal({ title: "đi thi", eventDate: date(), reminderTime: time(), frequency: "DAILY", eventRelation: "BEFORE_EVENT" }), proposal({ occurrenceCount: 2 }, "CURRENT")]);
  await h.turn(0, "Ngày 11/10 đi thi, nhắc mỗi ngày trước ngày thi lúc 8h.");
  expect((await h.read(1))?.pendingReminderQuestion?.field).toBe("occurrenceCount");
  await h.turn(1, "2.");
  expect((await h.read(2))?.slots.occurrenceCount.value).toBe(2);
});
it("a complete consecutive-count answer with a clock uses the retained reminder context", async () => {
  const h = await harness([proposal({ title: "đi thi", eventDate: date(), eventRelation: "BEFORE_EVENT" }), proposal({ frequency: "DAILY", occurrenceCount: 2, reminderTime: time() }, "CURRENT")]);
  await h.turn(0, "Ngày 11/10 đi thi, nhắc trước ngày thi.");
  await h.turn(1, "Hai ngày liên tiếp, đúng 8h sáng.");
  expect((await h.read(2))?.slots.occurrenceCount.value).toBe(2);
});
it.each([
  ["Không nhắc hàng ngày và hàng tuần.", { frequency: "WEEKLY" }],
  ["Không nhắc 2 ngày liên tiếp và hàng ngày.", { frequency: "DAILY" }],
  ["Nhắc mỗi ngày rồi đi công tác trong 3 ngày.", { occurrenceCount: 3 }],
  ["Nhắc mỗi ngày xong đi công tác trong 3 ngày.", { occurrenceCount: 3 }],
  ["Nhắc mỗi ngày, sau đó đi công tác trong 3 ngày.", { occurrenceCount: 3 }],
] as const)("coordinated negation and a separate action cannot grant cadence/count: %s", (text, changes) => {
  expect(check(text, changes).result.status).toBe("REFUSED");
});
it.each(["rồi", "xong", "sau đó"])("direct count cannot borrow nhắc across %s", connector => {
  expect(check(`Nhắc mỗi ngày ${connector} đi thi 2 lần.`, { occurrenceCount: 2 }).result.status).toBe("REFUSED");
});

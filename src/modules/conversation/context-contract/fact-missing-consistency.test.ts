// @vitest-environment node
import { expect, it } from "vitest";
import { harness, proposal } from "./service-test-support";
import { date, time } from "./resolution-test-support";

it("inconsistent fact/MISSING cannot store a draft, preview, query or reminder", async () => {
  const base = proposal({ title: "đi thi", eventDate: date(), frequency: "DAILY", occurrenceCount: 2, eventRelation: "BEFORE_EVENT", reminderTime: time() });
  const h = await harness([input => ({ ...base(input) as object, uncertainties: [{ field: "eventRelation", reason: "MISSING", alternatives: [] }] })]);
  await h.turn(0, "Ngày 11/10 đi thi, nhắc 2 ngày liên tiếp trước ngày thi lúc 8h.");
  expect(await h.read(1)).toBeNull();
  expect(h.events).toContainEqual(expect.objectContaining({ event: "POST_CANONICAL_STAGE", diagnostic: expect.objectContaining({ stage: "MERGE", result: "REJECTED", reason: "FACT_MISSING_CONTRADICTION" }) }));
  expect(await h.f.db.prepare("SELECT count(*) AS n FROM reminders").first<number>("n")).toBe(0);
  expect(h.inputs).toHaveLength(1);
  expect(h.replies).toHaveLength(1);
  expect(h.replies[0].kind).not.toBe("PREVIEW");
});

it("consistent facts let backend choose the real missing field", async () => {
  const h = await harness([proposal({ title: "đi thi", eventDate: date(), frequency: "DAILY", occurrenceCount: 2, reminderTime: time() })]);
  await h.turn(0, "Ngày 11/10 đi thi, nhắc 2 ngày liên tiếp lúc 8h.");
  expect((await h.read(1))?.pendingReminderQuestion?.field).toBe("reminderDate");
  expect(await h.f.db.prepare("SELECT count(*) AS n FROM reminders").first<number>("n")).toBe(0);
});

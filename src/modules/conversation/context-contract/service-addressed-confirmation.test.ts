// @vitest-environment node
import { expect, it } from "vitest";
import { harness, proposal, complete, completeText } from "./service-test-support";
import { date, time } from "./resolution-test-support";

it.each(["sep", "custom"] as const)("saved %s addressing preserves one-off preview confirmation", async addressStyle => {
  const h = await harness([proposal(complete)]);
  h.deps.getReplyPreferences = async () => ({ addressStyle, customDisplayName: addressStyle === "custom" ? "<Tân 🧾>" : null });
  expect(await h.turn(0, completeText)).toEqual({ status: "DRAFT_CREATED" });
  const s = (await h.read(1))!;
  expect(s.transcript.at(-1)?.text).toBe(h.replies[0].text);
  expect(h.replies[0].text).toMatch(addressStyle === "sep" ? /^Sếp,/u : /^&lt;Tân 🧾&gt;,/u);
  expect(await h.turn(1, "Có.")).toEqual({ status: "CONFIRMED" });
  expect(await h.f.db.prepare("SELECT count(*) n FROM reminders").first("n")).toBe(1);
  expect(h.events.filter(e => e.event === "REQUEST_DISPATCHED")).toHaveLength(1);
});
it("saved addressing preserves finite-series token confirmation without changing its three dates", async () => {
  const h = await harness([
    proposal({ title: "đi thi", eventDate: date(11, 10, 2026), reminderTime: time(), frequency: "DAILY", occurrenceCount: 3 }),
    proposal({ eventRelation: "BEFORE_EVENT" }, "CURRENT"),
  ]);
  h.deps.getReplyPreferences = async () => ({ addressStyle: "sep", customDisplayName: null });
  expect(await h.turn(0, "Nhắc đi thi lúc 8h trong 3 ngày liên tiếp, ngày thi 11/10/2026.")).toEqual({ status: "CLARIFICATION_REQUESTED" });
  expect(await h.turn(1, "Nhắc trước 3 ngày.")).toEqual({ status: "DRAFT_CREATED" });
  expect(h.replies.at(-1)?.kind).toBe("PREVIEW");
  expect(await h.turn(2, "Có.")).toEqual({ status: "CONFIRMED" });
  const rows = await h.f.db.prepare("SELECT scheduled_at FROM reminders ORDER BY scheduled_at").all<{scheduled_at:number}>();
  expect(rows.results.map(r => r.scheduled_at)).toEqual([1791421200000,1791507600000,1791594000000]);
  expect(h.events.filter(e => e.event === "REQUEST_DISPATCHED")).toHaveLength(2);
});

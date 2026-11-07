// @vitest-environment node
import { expect, it } from "vitest";
import { complete, harness, proposal } from "./service-test-support";

it("greets an alo locally using em and Sếp", async () => {
  const h = await harness([]);
  h.deps.getReplyPreferences = async () => ({ addressStyle: "sep", customDisplayName: null });
  await h.turn(0, "Alo");
  expect(h.inputs).toHaveLength(0);
  expect(h.replies.at(-1)?.text).toBe("Chào Sếp! Em có thể giúp Sếp ghi nhớ việc gì?");
});

it("uses a trusted personalized clarification instead of unaddressed optional model prose", async () => {
  const partial = { title: complete.title, reminderDate: complete.reminderDate };
  const h = await harness([proposal(partial, "NEW", { kind: "ASK_FOR_FIELD", field: "reminderTime" }, { text: "Bạn muốn mình nhắc lúc nào?" })]);
  h.deps.getReplyPreferences = async () => ({ addressStyle: "sep", customDisplayName: null });
  expect(await h.turn(0, "nhắc đi thi ngày 8/10/2026")).toEqual({ status: "CLARIFICATION_REQUESTED" });
  const reply = h.replies.at(-1)!;
  expect(reply.source).toBe("BACKEND");
  expect(reply.text).toContain("Sếp muốn được nhắc lúc mấy giờ?");
  expect(reply.text).not.toMatch(/\b(?:Bạn|bạn|Mình|mình)\b/u);
  expect((await h.read(1))?.pendingReminderQuestion?.text).toBe("Sếp muốn được nhắc lúc mấy giờ?");
});

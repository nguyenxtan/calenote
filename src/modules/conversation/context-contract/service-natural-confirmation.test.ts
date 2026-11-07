// @vitest-environment node
import { expect, it } from "vitest";
import { complete, completeText, harness, proposal } from "./service-test-support";
import { now, time } from "./resolution-test-support";
import { D1ContextContractStore } from "./infrastructure/d1/store";
import { chat, message } from "./context-test-fixtures";
import { selectControl } from "./decisions";

it.each(["co", " Co. ", "CO!"])("accepts exact ASCII approval %j once without another model request", async reply => {
  const h = await harness([proposal(complete)]);
  await h.turn(0, completeText);
  expect(await h.turn(1, reply)).toEqual({ status: "CONFIRMED" });
  await h.turn(2, reply);
  expect(await h.f.db.prepare("SELECT count(*) n FROM reminders").first("n")).toBe(1);
  expect(h.inputs).toHaveLength(1);
});

it.each(["khong", "ko", " KHONG! "])("declines exact ASCII reply %j locally while retaining the draft", async reply => {
  const h = await harness([proposal(complete)]);
  await h.turn(0, completeText);
  const before = (await h.read(1))!;
  await h.turn(1, reply);
  const after = (await h.read(2))!;
  expect(after.pendingDecision).toBeNull();
  expect(after.requestId).toBe(before.requestId);
  expect(after.slots).toEqual(before.slots);
  expect(await h.f.db.prepare("SELECT count(*) n FROM reminders").first("n")).toBe(0);
  expect(h.inputs).toHaveLength(1);
});

it("keeps mixed instructions and different accented words outside exact confirmation controls", async () => {
  const h = await harness([proposal(complete)]);
  await h.turn(0, completeText);
  const state = (await h.read(1))!, scope = h.f.scope(1);
  for (const text of ["cô", "có nhưng đổi sang 9h", "co nhưng đổi sang 9h", "khong, đổi sang 9h", "ko nhắc nữa", "co!!", "co?", "co\u200b"]) {
    expect(selectControl(text, state.pendingDecision, { kind: "CHAT", scope }, { snapshot: state })).toEqual({ kind: "NONE" });
  }
  expect(h.inputs).toHaveLength(1);
});

it("keeps ASCII approval behind the immutable inbound delivery fence", async () => {
  const h = await harness([proposal(complete)]);
  h.deps.now = () => now + 1;
  await h.turn(0, completeText);
  const before = (await h.read(1))!;
  expect(await h.turn(1, "co")).toEqual({ status: "REJECTED" });
  const after = (await h.read(2))!;
  expect(after.pendingDecision).toEqual(before.pendingDecision);
  expect(after.previewReceipt).toEqual(before.previewReceipt);
  expect(await h.f.db.prepare("SELECT count(*) n FROM reminders").first("n")).toBe(0);
  h.deps.now = () => now + 2;
  expect(await h.turn(2, "co")).toEqual({ status: "CONFIRMED" });
  expect(await h.f.db.prepare("SELECT count(*) n FROM reminders").first("n")).toBe(1);
  expect(h.inputs).toHaveLength(1);
});

it("accepts Có after a multi-turn draft without a code or another model call", async () => {
  const partial = { title: complete.title, reminderDate: complete.reminderDate };
  const h = await harness([proposal(partial), proposal({ reminderTime: time() }, "CURRENT")]);
  expect(await h.turn(0, "nhắc đi thi ngày 8/10/2026")).toEqual({ status: "CLARIFICATION_REQUESTED" });
  expect(await h.turn(1, "8h sáng")).toEqual({ status: "DRAFT_CREATED" });
  expect((await h.read(2))!.draftRevision).toBeGreaterThan(1);
  expect(await h.turn(2, "Có")).toEqual({ status: "CONFIRMED" });
  expect(await h.f.db.prepare("SELECT count(*) n FROM reminders").first("n")).toBe(1);
  expect(h.inputs).toHaveLength(2);
});

it.each(["Có.", "co"])("confirms only the latest delivered edited preview with %j", async reply => {
  const h = await harness([proposal(complete), proposal({ reminderTime: time(9) }, "CURRENT", null, null, ["reminderTime"])]);
  await h.turn(0, completeText);
  expect(await h.turn(1, "Đổi giờ nhắc sang 9h sáng")).toEqual({ status: "DRAFT_CREATED" });
  expect(await h.turn(2, reply)).toEqual({ status: "CONFIRMED" });
  const rows = await h.f.db.prepare("SELECT scheduled_at FROM reminders").all<{ scheduled_at: number }>();
  expect(rows.results.map(r => r.scheduled_at)).toEqual([Date.parse("2026-10-08T02:00:00Z")]);
  await h.turn(3, "Có");
  expect(await h.f.db.prepare("SELECT count(*) n FROM reminders").first("n")).toBe(1);
  expect(h.inputs).toHaveLength(2);
});

it.each(["Có", "co"])("re-presents an uncertain preview once, then accepts a separate %j after successful delivery", async reply => {
  const h = await harness([proposal(complete)]);
  h.setDelivery({ status: "UNCERTAIN" });
  await h.turn(0, completeText);
  h.setDelivery({ status: "SENT", messageRef: "recovered" });
  expect(await h.turn(1, reply)).toEqual({ status: "DRAFT_CREATED" });
  expect(await h.f.db.prepare("SELECT count(*) n FROM reminders").first("n")).toBe(0);
  expect(await h.turn(2, reply)).toEqual({ status: "CONFIRMED" });
  expect(h.inputs).toHaveLength(1);
});

it("offers Có/Không and declines without saving or paying for interpretation", async () => {
  const h = await harness([proposal(complete)]);
  await h.turn(0, completeText);
  expect(h.replies[0].text).toContain("Trả lời Có hoặc Không");
  expect(h.replies[0].text).not.toContain("Xác nhận CN-");
  await h.turn(1, "Không");
  expect(await h.f.db.prepare("SELECT count(*) n FROM reminders").first("n")).toBe(0);
  expect(h.inputs).toHaveLength(1);
});

it.each(["Có", "co"])("does not combine replacement approval and save: two separate %j turns", async reply => {
  const h = await harness([proposal(complete), proposal({ ...complete, title: "gọi mẹ" })]);
  await h.turn(0, completeText);
  await h.turn(1, "nhắc gọi mẹ ngày 8/10/2026 lúc 8h sáng");
  expect((await h.read(2))!.pendingDecision?.kind).toBe("REPLACE_PENDING");
  expect(h.replies.at(-1)?.text).toContain("Trả lời Có hoặc Không");
  expect(h.replies.at(-1)?.text).not.toContain("CN-");
  expect(await h.turn(2, reply)).toEqual({ status: "DRAFT_CREATED" });
  expect(await h.f.db.prepare("SELECT count(*) n FROM reminders").first("n")).toBe(0);
  expect(await h.turn(3, reply)).toEqual({ status: "CONFIRMED" });
  expect(await h.f.db.prepare("SELECT count(*) n FROM reminders").first("n")).toBe(1);
  expect(h.inputs).toHaveLength(2);
});

it.each(["Có", "co"])("explains a purged expired draft on %j without starting a model request or a new draft", async reply => {
  const h = await harness([proposal(complete)]);
  await h.turn(0, completeText);
  const state = (await h.read(1))!, receivedAt = Date.parse(state.draftExpiresAt!) + 1;
  await new D1ContextContractStore(h.f.db, h.f.keyring).purgeExpired(receivedAt, 10);
  const scope = h.f.scope(1);
  await h.f.db.prepare("UPDATE inbound_updates SET received_at=? WHERE id=?").bind(receivedAt, scope.sourceInboundId).run();
  const rowid = await h.f.db.prepare("SELECT rowid FROM inbound_updates WHERE id=?").bind(scope.sourceInboundId).first<number>("rowid");
  h.deps.now = () => receivedAt;
  h.setIndex(1);
  expect(await h.service.handle({ ...message(reply), id: scope.sourceInboundId, claimMarker: scope.claimMarker, receivedAt }, { ...chat, inboundRowId: rowid! })).toEqual({ status: "REJECTED" });
  expect(h.replies.at(-1)?.text).toContain("hết hạn");
  expect(h.inputs).toHaveLength(1);
  expect(await h.f.db.prepare("SELECT count(*) n FROM conversation_contexts").first("n")).toBe(1);
  expect(await h.f.db.prepare("SELECT count(*) n FROM reminders").first("n")).toBe(0);
});

it("handles an old addressed code locally after cancellation instead of losing context through a model request", async () => {
  const h = await harness([proposal(complete)]);
  await h.turn(0, completeText);
  const token = (await h.read(1))!.pendingDecision!.tokenHandle!;
  await h.turn(1, "Bỏ");
  await h.turn(2, `Xác nhận ${token}`);
  expect(h.inputs).toHaveLength(1);
  expect(h.replies.at(-1)?.text).not.toContain("Không thể đọc đầy đủ ngữ cảnh");
  expect(await h.f.db.prepare("SELECT count(*) n FROM reminders").first("n")).toBe(0);
});

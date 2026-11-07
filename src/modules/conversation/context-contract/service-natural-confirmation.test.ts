// @vitest-environment node
import { expect, it } from "vitest";
import { complete, completeText, harness, proposal } from "./service-test-support";
import { time } from "./resolution-test-support";
import { D1ContextContractStore } from "./infrastructure/d1/store";
import { chat, message } from "./context-test-fixtures";

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

it("confirms only the latest delivered edited preview with Có", async () => {
  const h = await harness([proposal(complete), proposal({ reminderTime: time(9) }, "CURRENT", null, null, ["reminderTime"])]);
  await h.turn(0, completeText);
  expect(await h.turn(1, "Đổi giờ nhắc sang 9h sáng")).toEqual({ status: "DRAFT_CREATED" });
  expect(await h.turn(2, "Có.")).toEqual({ status: "CONFIRMED" });
  const rows = await h.f.db.prepare("SELECT scheduled_at FROM reminders").all<{ scheduled_at: number }>();
  expect(rows.results.map(r => r.scheduled_at)).toEqual([Date.parse("2026-10-08T02:00:00Z")]);
  await h.turn(3, "Có");
  expect(await h.f.db.prepare("SELECT count(*) n FROM reminders").first("n")).toBe(1);
  expect(h.inputs).toHaveLength(2);
});

it("re-presents an uncertain preview once, then accepts a separate Có after successful delivery", async () => {
  const h = await harness([proposal(complete)]);
  h.setDelivery({ status: "UNCERTAIN" });
  await h.turn(0, completeText);
  h.setDelivery({ status: "SENT", messageRef: "recovered" });
  expect(await h.turn(1, "Có")).toEqual({ status: "DRAFT_CREATED" });
  expect(await h.f.db.prepare("SELECT count(*) n FROM reminders").first("n")).toBe(0);
  expect(await h.turn(2, "Có")).toEqual({ status: "CONFIRMED" });
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

it("does not combine replacement approval and save: two separate Có turns", async () => {
  const h = await harness([proposal(complete), proposal({ ...complete, title: "gọi mẹ" })]);
  await h.turn(0, completeText);
  await h.turn(1, "nhắc gọi mẹ ngày 8/10/2026 lúc 8h sáng");
  expect((await h.read(2))!.pendingDecision?.kind).toBe("REPLACE_PENDING");
  expect(h.replies.at(-1)?.text).toContain("Trả lời Có hoặc Không");
  expect(h.replies.at(-1)?.text).not.toContain("CN-");
  expect(await h.turn(2, "Có")).toEqual({ status: "DRAFT_CREATED" });
  expect(await h.f.db.prepare("SELECT count(*) n FROM reminders").first("n")).toBe(0);
  expect(await h.turn(3, "Có")).toEqual({ status: "CONFIRMED" });
  expect(await h.f.db.prepare("SELECT count(*) n FROM reminders").first("n")).toBe(1);
  expect(h.inputs).toHaveLength(2);
});

it("explains a purged expired draft on Có without starting a model request or a new draft", async () => {
  const h = await harness([proposal(complete)]);
  await h.turn(0, completeText);
  const state = (await h.read(1))!, receivedAt = Date.parse(state.draftExpiresAt!) + 1;
  await new D1ContextContractStore(h.f.db, h.f.keyring).purgeExpired(receivedAt, 10);
  const scope = h.f.scope(1);
  await h.f.db.prepare("UPDATE inbound_updates SET received_at=? WHERE id=?").bind(receivedAt, scope.sourceInboundId).run();
  const rowid = await h.f.db.prepare("SELECT rowid FROM inbound_updates WHERE id=?").bind(scope.sourceInboundId).first<number>("rowid");
  h.deps.now = () => receivedAt;
  h.setIndex(1);
  expect(await h.service.handle({ ...message("Có"), id: scope.sourceInboundId, claimMarker: scope.claimMarker, receivedAt }, { ...chat, inboundRowId: rowid! })).toEqual({ status: "REJECTED" });
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

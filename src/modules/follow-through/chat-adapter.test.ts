// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createFollowThroughChatHandler } from "./chat-adapter";
import type { FollowThroughAction, FollowThroughItem, FollowThroughScope } from "@/contracts/api/follow-through";
const now = Date.parse("2026-10-19T03:00:00Z");
const context = { userId: "owner", chatIdentityId: "private-identity", workspaceId: "personal", timezone: "Asia/Ho_Chi_Minh", inboundRowId: 1 };
const item: FollowThroughItem = { publicId: "ABCDEF0123456789abcdef", title: "Gọi cho mẹ", progress: "OPEN", revision: 3, currentReminderPublicId: "run", scheduledAt: now, deliveryStatus: "SENT", destinationLabel: "Bot", followUpEnabled: false, intervalMinutes: 120, followUpCount: 0, nextFollowUpAt: null, completedAt: null, history: [] };
function harness(items = [item]) {
  const actions: { scope: FollowThroughScope; input: FollowThroughAction }[] = [];
  const scopes: FollowThroughScope[] = [];
  const receipts = new Map<string, FollowThroughItem>();
  const service = {
    async list(scope: FollowThroughScope) { scopes.push(scope); return { items }; },
    async resolveReference(_scope: FollowThroughScope, reference: string) { return items.filter(item => item.publicId.startsWith(reference)).slice(0, 2); },
    async act(scope: FollowThroughScope, input: FollowThroughAction) { actions.push({ scope, input }); const result = { ...item, revision: 4, progress: input.action === "DONE" ? "DONE" as const : "STOPPED" as const }; receipts.set(input.idempotencyKey, result); return result; },
    async receipt(_scope: FollowThroughScope, key: string) { return receipts.get(key) ?? null; },
  };
  const handle = createFollowThroughChatHandler(service, () => now);
  return { actions, scopes, handle: async (...args: Parameters<typeof handle>) => { const r = await handle(...args); return r.handled ? r : { ...r, text: undefined }; } };
}
const message = (text: string, provider = "telegram") => ({ id: "inbound-1", connectionId: `${provider}-original-bot`, providerUserId: "provider-user", privateChatId: "private-chat", text, receivedAt: now, claimMarker: "claim" });
describe("provider-neutral follow-through commands", () => {
  it.each(["telegram", "zalo"])("uses authenticated original chat/connection scope for %s completion", async provider => {
    const h = harness();
    const result = await h.handle(message(`xong ${item.publicId}`, provider), context);
    expect(result.handled).toBe(true);
    expect(result.text).toContain("Đã xong");
    expect(h.actions).toEqual([{ scope: { userId: "owner", chatIdentityId: "private-identity", connectionId: `${provider}-original-bot`, inboundUpdateId: "inbound-1", claimMarker: "claim" }, input: { action: "DONE", publicId: item.publicId, expectedRevision: 3, idempotencyKey: "chat-inbound-1" } }]);
  });
  it.each(["xong", "chưa xong", "dừng theo dõi", "hoãn", "đổi lịch"])("asks selection for bare %s without guessing the latest", async text => {
    const h = harness();
    expect((await h.handle(message(text), context)).text).toContain(item.publicId.slice(0, 8));
    expect(h.actions).toHaveLength(0);
  });
  it("refuses ambiguous short references", async () => {
    const h = harness([item, { ...item, publicId: "ABCDEF01different" }]);
    expect((await h.handle(message("xong ABCDEF01"), context)).text).toContain("Chọn mã việc");
    expect(h.actions).toHaveLength(0);
  });
  it("does not accept another chat's code as authority", async () => {
    const h = harness([]);
    expect((await h.handle(message(`xong ${item.publicId}`), context)).text).toContain("trong cuộc trò chuyện này");
    expect(h.actions).toHaveLength(0);
  });
  it.each(["hoãn ABCDEF01 15 phút", "hoãn ABCDEF01 1 giờ", "hoãn ABCDEF01 mai 09:00", "đổi lịch ABCDEF01 2026-10-20 09:00"])("previews absolute Vietnam time before %s", async text => {
    const h = harness();
    const result = await h.handle(message(text), context);
    expect(result.text).toContain("UTC+7");
    expect(result.text).toContain("xác nhận");
    expect(h.actions).toHaveLength(0);
  });
  it("commits an explicit confirmed future date without semantic/provider parsing", async () => {
    const h = harness();
    await h.handle(message("xác nhận đổi lịch ABCDEF01 2026-10-20 09:00"), context);
    expect(h.actions[0].input).toEqual({ action: "RESCHEDULE", publicId: item.publicId, expectedRevision: 3, idempotencyKey: "chat-inbound-1", scheduledAt: Date.parse("2026-10-20T02:00:00Z") });
  });
  it.each(["đổi lịch ABCDEF01 mai", "đổi lịch ABCDEF01 2026-02-30 09:00", "xác nhận đổi lịch ABCDEF01 2026-10-19 09:00", "hoãn ABCDEF01 2 phút"])("clarifies invalid or incomplete time %s", async text => {
    const h = harness();
    expect((await h.handle(message(text), context)).handled).toBe(true);
    expect(h.actions).toHaveLength(0);
  });
  it("stops tracking without claiming completion", async () => {
    const h = harness();
    expect((await h.handle(message("dừng theo dõi ABCDEF01"), context)).text).toContain("Dừng theo dõi");
    expect(h.actions[0].input.action).toBe("STOP");
  });
  it("reads a durable action receipt before resolving a changed revision on inbound retry", async () => {
    const h = harness();
    await h.handle(message("xong ABCDEF01"), context);
    await h.handle(message("xong ABCDEF01"), context);
    expect(h.actions).toHaveLength(1);
  });
  it("leaves unrelated creation text to the existing semantic path", async () => {
    const h = harness();
    expect(await h.handle(message("nhắc tôi gọi mẹ lúc 9h mai"), context)).toEqual({ handled: false });
    expect(h.scopes).toHaveLength(0);
  });
});

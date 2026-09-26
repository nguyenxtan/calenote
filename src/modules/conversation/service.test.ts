import { describe, expect, it, vi } from "vitest";
import { createConversationService, type ConversationServiceDependencies } from "./service";
import { lunarCalendar } from "./lunar-calendar";
import type { ConversationModel } from "./contracts";

const now = Date.parse("2026-09-25T03:00:00Z");
function fixture() {
  const model: ConversationModel = { intent: "CREATE_REMINDER", title: "gọi mẹ", titleState: "RESOLVED", targetIntent: null,
    dialogueAct: "NEW_REQUEST", continuation: "NO", capability: null };
  const dispatch = vi.fn(async () => ({ status: "SUCCESS" as const, interpretation: model, usage: { costMicrounits: 1 } }));
  const deps: ConversationServiceDependencies = {
    contextStore: { load: async () => null, save: vi.fn(async () => "SAVED" as const), finish: async () => true, purgeExpired: async () => 0 },
    seriesStore: { findPending: async () => null, discard: async () => false, propose: vi.fn(async () => null),
      confirm: async () => ({ status: "STALE" }), proposeCancellation: async () => null, cancelRemaining: async () => "STALE" },
    commandStore: { findBoundContext: async () => null, findPendingDraft: async () => null,
      createDraft: vi.fn(async () => "CONFLICT" as const), confirmDraft: vi.fn(async () => "CONFLICT" as const), cancelDraft: async () => "CONFLICT",
      expireDraft: async () => "CONFLICT", rejectMessage: async () => true },
    runtimeStore: { ownsPendingDraft: async () => false, claimAttempt: vi.fn(async () => true), complete: vi.fn(async () => true) },
    gateway: { prepare: vi.fn(() => ({ status: "READY" as const, model: "google/gemini-2.5-flash-lite", provider: "google-vertex/eu", maximumCostMicrounits: 10, dispatch })) },
    budgetStore: { reservePaidCall: vi.fn(async () => ({ status: "RESERVED" as const, reservationId: "synthetic", reservedMaximumMicrounits: 10 })),
      markDispatched: vi.fn(async () => true), finalizeUsage: vi.fn(async () => true), releaseOrExpireReservation: vi.fn(async () => true), reapExpiredReservations: async () => 0 },
    keyring: { encryptSensitive: async () => { throw new Error("Unexpected mutation"); }, decryptSensitive: async () => "synthetic" },
    now: () => now, calendar: lunarCalendar, reply: vi.fn(async () => {}), list: vi.fn(async () => []),
  };
  const handle = (text = "mai nhắc gọi mẹ") => createConversationService(deps).handle({ id: "inbound", connectionId: "connection", providerUserId: "provider-user",
    privateChatId: "chat", claimMarker: "claim", text, receivedAt: now }, {
    userId: "owner", chatIdentityId: "chat-identity", workspaceId: "workspace", timezone: "Asia/Ho_Chi_Minh", inboundRowId: 1,
  });
  return { deps, dispatch, handle };
}
describe("conversation paid-call and semantic safety boundary", () => {
  it.each(["mỗi tuần", "hàng tháng", "mỗi năm", "mỗi 2 giờ", "mỗi 30 phút", "mỗi 2 ngày", "mỗi 9h", "liên tục 2 giờ", "lặp lại", "3 ngày liên tục mỗi tuần"])("never downgrades unsupported cadence %s into a proposal", async cadence => {
    const h = fixture();
    await h.handle(`mai 9h nhắc gọi mẹ ${cadence}`);
    expect(h.deps.contextStore.save).not.toHaveBeenCalled();
    expect(h.deps.commandStore.createDraft).not.toHaveBeenCalled();
    expect(h.deps.seriesStore.propose).not.toHaveBeenCalled();
  });
  it("applies BEFORE_EVENT arithmetic before transferring a count-one draft", async () => {
    const h = fixture();
    h.deps.keyring.encryptSensitive = async () => ({ ciphertext: new ArrayBuffer(16), iv: new ArrayBuffer(12) });
    h.deps.commandStore.createDraft = vi.fn(async () => "COMMITTED" as const);
    expect((await h.handle("nhắc gọi mẹ 1 ngày trước ngày thi 11/10/2026 lúc 9h")).status).toBe("DRAFT_CREATED");
    expect(h.deps.commandStore.createDraft).toHaveBeenCalledWith(expect.objectContaining({ scheduledAt: Date.parse("2026-10-10T09:00:00+07:00") }));
  });
  it("starts managed feedback after the durable claim but before context loading", async () => {
    const h = fixture(); const order: string[] = [];
    h.deps.runtimeStore.claimAttempt = async () => { order.push("claim"); return true; };
    h.deps.processingFeedback = async () => { order.push("feedback"); };
    h.deps.contextStore.load = async () => { order.push("context"); return null; };
    expect((await h.handle()).status).toBe("CLARIFICATION_REQUESTED");
    expect(order).toEqual(["claim", "feedback", "context"]);
  });
  it.each(["claimed", "unavailable", "exhausted", "underfunded", "fence-false", "fence-uncertain"])("does not dispatch on %s", async boundary => {
    const h = fixture();
    if (boundary === "claimed") h.deps.runtimeStore.claimAttempt = async () => false;
    if (boundary === "unavailable") h.deps.gateway.prepare = () => ({ status: "FAILURE", category: "UNAVAILABLE" });
    if (boundary === "exhausted") h.deps.budgetStore.reservePaidCall = async () => ({ status: "BUDGET_EXHAUSTED" });
    if (boundary === "underfunded") h.deps.budgetStore.reservePaidCall = async () => ({ status: "RESERVED", reservationId: "synthetic", reservedMaximumMicrounits: 9 });
    if (boundary === "fence-false") h.deps.budgetStore.markDispatched = async () => false;
    if (boundary === "fence-uncertain") h.deps.budgetStore.markDispatched = async () => { throw new Error("Ambiguous storage acknowledgement"); };
    expect((await h.handle()).status).toBe("REJECTED");
    expect(h.dispatch).not.toHaveBeenCalled();
    expect(h.deps.commandStore.createDraft).not.toHaveBeenCalled();
    expect(h.deps.contextStore.save).not.toHaveBeenCalled();
    expect(h.deps.runtimeStore.complete).toHaveBeenCalledOnce();
  });
  it("settlement failure does not repeat inference or discard a valid clarification", async () => {
    const h = fixture(); h.deps.budgetStore.finalizeUsage = async () => { throw new Error("synthetic"); };
    expect((await h.handle()).status).toBe("CLARIFICATION_REQUESTED");
    expect(h.dispatch).toHaveBeenCalledOnce();
    expect(h.deps.budgetStore.releaseOrExpireReservation).not.toHaveBeenCalled();
    expect(h.deps.reply).toHaveBeenCalledWith(expect.stringContaining("mấy giờ"));
  });
  it("unknown model fields never reach a stored request", async () => {
    const h = fixture();
    h.dispatch.mockResolvedValue({ status: "SUCCESS", usage: { costMicrounits: 1 }, interpretation: {
      intent: "CREATE_REMINDER", title: "gọi mẹ", titleState: "RESOLVED", targetIntent: null,
      dialogueAct: "CONTINUE", continuation: "YES", capability: null, localTime: "09:00",
    } as ConversationModel });
    expect((await h.handle()).status).toBe("REJECTED");
    expect(h.deps.contextStore.save).not.toHaveBeenCalled();
    expect(h.deps.commandStore.createDraft).not.toHaveBeenCalled();
  });
});

// @vitest-environment node
import { expect, it } from "vitest";
import { harness, proposal, complete, completeText } from "@/modules/conversation/context-contract/service-test-support";
import { processBoundChatMessage } from "@/modules/reminders/command-service";
import { D1ReminderCommandStore } from "@/modules/reminders/infrastructure/d1/command-store";
import { chat, message } from "@/modules/conversation/context-contract/context-test-fixtures";
import { D1InboundProcessorStore, processInbound } from "./processor";
import { D1ConversationStore } from "@/modules/conversation/infrastructure/d1/context-store";
import { D1ConversationRuntimeStore } from "@/modules/conversation/infrastructure/d1/runtime-store";
import { D1SeriesStore } from "@/modules/reminders/infrastructure/d1/series-store";
import { createConversationService } from "@/modules/conversation/service";
import type { PendingRequest } from "@/modules/conversation/contracts";

it.each(["reference", "no reference", "uncertain"])("actual processor preserves %s send receipt", async outcome => {
  const h = await harness([proposal(complete)]);
  const encrypted = await h.f.keyring.encryptSensitive("inbound-message", "old", 1, "nhắc đi thi 8/10/2026 8h");
  await h.f.db.prepare("UPDATE inbound_updates SET message_ciphertext=?,message_iv=?,state='PENDING' WHERE id='old'").bind(encrypted.ciphertext, encrypted.iv).run();
  const processorKeyring = { ...h.f.keyring, decryptCredential: async () => "synthetic-offline-token" };
  const result = await processInbound("old", { store: new D1InboundProcessorStore(h.f.db, new D1ReminderCommandStore(h.f.db)), keyring: processorKeyring,
    contextContract: h.deps, now: () => h.f.scope().now,
    sendText: async () => { if (outcome === "uncertain") throw new Error("synthetic lost response"); return { providerMessageId: outcome === "reference" ? "actual-provider-ref" : null }; } });
  expect(result).toEqual({ status: "DRAFT_CREATED" });
  const state = await h.read(1);
  expect(state?.previewReceipt).toMatchObject({ deliveryState: outcome === "uncertain" ? "UNCERTAIN" : "SENT", replyReference: outcome === "reference" ? "actual-provider-ref" : null });
  expect(state?.pendingDecision === null).toBe(outcome === "uncertain");
});

it("successor_confirmation_cannot_fall_into_legacy", async () => {
  const h = await harness([proposal(complete)]);
  await h.turn(0, completeText);
  const scope = h.f.scope(1);
  h.setIndex(1);
  const commandStore = new D1ReminderCommandStore(h.f.db);
  // A successor-owned control must finish even if the irrelevant legacy read
  // is unavailable. All auth/canonical mutations still use real D1 stores.
  commandStore.findPendingDraft = async () => { throw new Error("legacy read unavailable"); };
  const result = await processBoundChatMessage({ ...message("có"), id: scope.sourceInboundId, claimMarker: scope.claimMarker, receivedAt: scope.now }, {
    store: commandStore, keyring: h.f.keyring, now: () => scope.now,
    conversation: h.service, reply: async () => { throw new Error("legacy reply must not run"); },
  });
  expect(result).toEqual({ status: "CONFIRMED" });
  expect(await h.f.db.prepare("SELECT count(*) n FROM reminders").first("n")).toBe(1);
});
it("a genuine old draft drains through its guarded legacy confirmation with no successor call", async () => {
  const h = await harness([]), store = new D1ReminderCommandStore(h.f.db);
  const old = h.f.scope(), current = h.f.scope(1);
  const encryptedTitle = await h.f.keyring.encryptSensitive("draft-title", "legacy-draft", 1, "old reminder");
  expect(await store.createDraft({ message: { ...message("mai 8h nhắc gọi mẹ"), id: old.sourceInboundId, claimMarker: old.claimMarker, receivedAt: old.now },
    context: { ...chat, inboundRowId: 1 }, now: old.now, auditId: "legacy-create", draftId: "legacy-draft", encryptedTitle,
    titleKeyVersion: 1, scheduledAt: old.now + 86400000, timezone: "Asia/Ho_Chi_Minh", expiresAt: old.now + 600000 })).toBe("COMMITTED");
  h.setIndex(1);
  expect(await processBoundChatMessage({ ...message("có"), id: current.sourceInboundId, claimMarker: current.claimMarker, receivedAt: current.now }, {
    store, keyring: h.f.keyring, now: () => current.now, conversation: h.service, reply: async () => {},
  })).toEqual({ status: "CONFIRMED" });
  expect(h.inputs).toHaveLength(0);
  expect(await h.f.db.prepare("SELECT count(*) n FROM reminders WHERE source_draft_id='legacy-draft'").first("n")).toBe(1);
});
it("a proven active legacy V2 series drains through unchanged V2 service", async () => {
  const h = await harness([]), contextStore = new D1ConversationStore(h.f.db, h.f.keyring), seriesStore = new D1SeriesStore(h.f.db, h.f.keyring);
  const old = h.f.scope(), runtimeStore = new D1ConversationRuntimeStore(h.f.db), commandStore = new D1ReminderCommandStore(h.f.db);
  const request: PendingRequest = { title: "đi thi", calendar: "GREGORIAN", eventDate: { solarDate: "2026-10-11", calendar: "GREGORIAN", lunar: null, conversionVersion: null, sourceInboundId: "old" },
    reminderDate: null, reminderTime: "08:00", count: 2, relation: "BEFORE_EVENT", missing: [] };
  expect(await contextStore.save(old, null, { id: "legacy-context", revision: 1, status: "DRAFT_READY", createdAt: old.now, expiresAt: old.now + 600000,
    request, turns: [{ userText: "nhắc hai ngày trước thi", receivedAt: old.now, outcomeCode: "PROPOSE" }] })).toBe("SAVED");
  expect(await seriesStore.propose(old, request, "legacy-context", 1)).not.toBeNull();
  await runtimeStore.complete(old);
  const legacyConversation = createConversationService({ contextStore, seriesStore, runtimeStore, commandStore, calendar: h.deps.calendar, keyring: h.f.keyring,
    budgetStore: h.deps.budgetStore, now: h.deps.now, reply: async () => {}, list: async () => [], gateway: { prepare: () => ({ status: "FAILURE", category: "UNAVAILABLE" }) } });
  h.setIndex(1);
  const scope = h.f.scope(1);
  expect(await processBoundChatMessage({ ...message("có"), id: scope.sourceInboundId, claimMarker: scope.claimMarker, receivedAt: scope.now }, {
    store: commandStore, keyring: h.f.keyring, now: h.deps.now, conversation: legacyConversation, reply: async () => {},
  })).toEqual({ status: "CONFIRMED" });
  expect(h.inputs).toHaveLength(0);
  expect(await h.f.db.prepare("SELECT count(*) n FROM reminders").first("n")).toBe(2);
});

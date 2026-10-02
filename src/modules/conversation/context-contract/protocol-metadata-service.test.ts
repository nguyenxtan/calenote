// @vitest-environment node
import { expect, it } from "vitest";
import { harness, limits, setup } from "./service-test-support";
import { lunarCalendar } from "../lunar-calendar";
import type { ContextObservationEvent } from "./observability";
import type { ReadyReplyPlan, ReplyReceipt } from "./responses";
import { D1SemanticBudgetStore } from "../../semantic/infrastructure/d1/budget-store";
import { createContextContractGateway } from "../../intelligence/infrastructure/openrouter/semantic-gateway";
import { frozenContextProposal, encodeFixtureV3 } from "../../../../tools/benchmark/context-contract-fixtures";
import type { ContextInput } from "./contracts";
import { createD1ContextContractStoreV3 } from "./infrastructure/d1/store";
import { createD1ContextRuntimeStoreV3 } from "./runtime-store";
import { CONTEXT_PROTOCOL_V3 } from "./protocol";
import { encodeGoogleLiteEuContextV3 } from "../../intelligence/infrastructure/openrouter/context-provider-wire";
import { ConversationInterpretationV3Schema, type ContextInputV2 } from "./contracts";
import { createContextContractService } from "./service";

async function selectedHarness(values: Record<string, unknown> = { title: "đi thi" }, budgetBlocked = false) {
  const f = await setup(), events: ContextObservationEvent[] = [], replies: ReadyReplyPlan[] = [];
  let index = 0;
  const h = { f, events, replies, setIndex: (i: number) => { index = i; } };
  const store = createD1ContextContractStoreV3({ db: h.f.db, keyring: h.f.keyring, protocol: CONTEXT_PROTOCOL_V3 });
  let requests = 0, fail = false;
  let delivery: ReplyReceipt = { status: "SENT", messageRef: null };
  let waiting: { promise: Promise<void>; started(): void } | undefined;
  let mutateWire: (wire: unknown) => unknown = value => value;
  const config = { protocol: CONTEXT_PROTOCOL_V3, maxInputChars: 1800, maxInputTokens: 12000, maxOutputTokens: 1536, maxResponseBytes: 32768, timeoutMs: 30000,
    primary: { model: "google/gemini-2.5-flash-lite", provider: "google-vertex/eu", requireZdr: true, promptPriceMicrounitsPerMillionTokens: 100000, completionPriceMicrounitsPerMillionTokens: 400000 } };
  expect(() => createContextContractGateway(config, { kind: "OFFLINE_FIXTURE", exchanges: [] }), "application protocol configuration must be admitted before model dispatch").not.toThrow();
  const gateway = createContextContractGateway(config, async request => {
    requests++;
    if (waiting) { const hold = waiting; waiting = undefined; hold.started(); await hold.promise; }
    if (fail) return { status: 408, body: "" };
    const input: ContextInputV2 = JSON.parse(request.messages[1].content);
    const evidence = [{ kind: "USER_QUOTE", turn: input.currentTurn, quote: input.turns[input.currentTurn].text, occurrence: 1 }];
    const proposal = ConversationInterpretationV3Schema.parse({ schemaVersion: "calenote-context-3", intent: "CREATE_REMINDER", requestTarget: { kind: input.activeRequest ? "CURRENT" : "NEW", evidence },
      changes: Object.entries(values).map(([field, value]) => ({ field, operation: "SET", value, evidence })), query: null, uncertainties: [], conversationDirective: { kind: "ASK_FOR_FIELD", field: "reminderDate" }, replyProposal: null });
    return { status: 200, body: JSON.stringify({ model: "google/gemini-2.5-flash-lite", provider: "Google", choices: [{ finish_reason: "stop", message: { content: JSON.stringify(mutateWire(encodeGoogleLiteEuContextV3(proposal))) } }], usage: { cost: .0004, prompt_tokens: 2200, completion_tokens: 500 } }) };
  }, { status: "OBSERVABLE_CANARY", advertisedContextTokens: 1048576 });
  const runtimeStore = createD1ContextRuntimeStoreV3({ db: h.f.db, keyring: h.f.keyring, protocol: CONTEXT_PROTOCOL_V3 });
  const service = createContextContractService({ store, runtimeStore, gateway, keyring: f.keyring, calendar: lunarCalendar, channel: "TELEGRAM", sourceSha: "a".repeat(40), mode: "OFFLINE_FIXTURE",
    now: () => f.scope(index).now, observe: e => events.push(e), list: async () => ({ status: "UNAVAILABLE", reason: "STORE_UNAVAILABLE" }),
    reply: async plan => { if (plan.status !== "READY") return { status: "FAILED" }; replies.push(plan); return delivery; },
    budgetStore: new D1SemanticBudgetStore(h.f.db, { ...limits, ...(budgetBlocked ? { ownerMonthlyCostMicrounits: 0 } : {}), reservationInputTokenExposure: 1048576 }) });
  const run = async (i: number, text: string) => {
    h.setIndex(i); const scope = h.f.scope(i);
    const rowid = await h.f.db.prepare("SELECT rowid FROM inbound_updates WHERE id=?").bind(scope.sourceInboundId).first<number>("rowid");
    const { message, chat } = await import("./context-test-fixtures");
    return service.handle({ ...message(text), id: scope.sourceInboundId, receivedAt: scope.now, claimMarker: scope.claimMarker }, { ...chat, inboundRowId: rowid! });
  };
  return { ...h, store, runtimeStore, service, run, getRequests: () => requests, setFail: () => { fail = true; }, setDelivery: (receipt: ReplyReceipt) => { delivery = receipt; },
    setWait: (promise: Promise<void>, started: () => void) => { waiting = { promise, started }; }, setWireMutation: (mutate: typeof mutateWire) => { mutateWire = mutate; } };
}

it("service_metadata_bound_by_application and terminal notices use selected protocol on the real path", async () => {
  const h = await selectedHarness();
  expect(await h.run(0, "nhắc đi thi")).toEqual({ status: "CLARIFICATION_REQUESTED" });
  expect(await h.store.observe(h.f.scope(1))).toMatchObject({ snapshot: { schemaVersion: "calenote-context-state-2", slots: { title: { value: "đi thi" } }, modelAttemptBinding: { contractVersion: "calenote-context-3" } } });
  expect(h.replies).toHaveLength(1);
  expect(await h.run(1, "Bỏ.")).toEqual({ status: "CANCELLED" });
  expect(h.replies).toHaveLength(2);
  expect(h.events.filter(e => e.event === "REPLY_SENT")).toHaveLength(2);
  expect(h.getRequests()).toBe(1);
  expect(h.events.every(e => e.contractVersion === "calenote-context-3")).toBe(true);
  expect(await h.f.db.prepare("SELECT count(*) n FROM reminders").first("n")).toBe(0);
});

it("selected actual service operational refusal clears old preview proof and retains grounded facts", async () => {
  const h = await selectedHarness({ title: "đi thi", reminderDate: { kind: "CIVIL_DATE", calendar: "GREGORIAN", day: 8, month: 10, year: 2026, leapMonth: null }, reminderTime: { hour: 8, minute: 0, qualifier: "H24" } });
  expect(await h.run(0, "nhắc đi thi 8/10/2026 8h")).toEqual({ status: "DRAFT_CREATED" });
  h.setFail();
  expect(await h.run(1, "nhắc lại")).toEqual({ status: "REJECTED" });
  expect(await h.store.observe(h.f.scope(2))).toMatchObject({ snapshot: { slots: { title: { value: "đi thi" } }, pendingDecision: null, previewReceipt: null } });
  expect(h.replies).toHaveLength(2);
  expect(await h.f.db.prepare("SELECT count(*) n FROM reminders").first("n")).toBe(0);
});

it.each(["FAILED", "UNCERTAIN"] as const)("selected terminal %s receipt is never fabricated SENT", async status => {
  const h = await selectedHarness(); await h.run(0, "nhắc đi thi");
  h.setDelivery({ status });
  expect(await h.run(1, "Bỏ.")).toEqual({ status: "CANCELLED" });
  expect(h.replies).toHaveLength(2);
  expect(h.events.filter(e => e.event === "REPLY_SENT")).toHaveLength(1);
  expect(h.events.at(-1)?.event).toBe(status === "FAILED" ? "REPLY_FAILED" : "REPLY_UNCERTAIN");
});

it("selected build-time oversized refusal invalidates SENT preview without dispatch or fabricated user evidence", async () => {
  const h = await selectedHarness({ title: "đi thi", reminderDate: { kind: "CIVIL_DATE", calendar: "GREGORIAN", day: 8, month: 10, year: 2026, leapMonth: null }, reminderTime: { hour: 8, minute: 0, qualifier: "H24" } });
  expect(await h.run(0, "nhắc đi thi 8/10/2026 8h")).toEqual({ status: "DRAFT_CREATED" });
  const before = await h.store.observe(h.f.scope(1)); if ("failure" in before || !before.snapshot) throw new Error("missing prior preview");
  expect(before.snapshot.previewReceipt?.deliveryState).toBe("SENT");
  const oversized = "x".repeat(1801);
  expect(await h.run(1, oversized)).toEqual({ status: "REJECTED" });
  expect(h.getRequests()).toBe(1);
  const after = await h.store.observe(h.f.scope(2)); if ("failure" in after || !after.snapshot) throw new Error("missing retained state");
  expect(after.snapshot.pendingDecision).toBeNull(); expect(after.snapshot.previewReceipt).toBeNull();
  expect(after.snapshot.slots).toEqual(before.snapshot.slots); expect(after.snapshot.facts).toEqual(before.snapshot.facts);
  expect(after.snapshot.pendingSemanticCandidate).toEqual(before.snapshot.pendingSemanticCandidate);
  expect([after.snapshot.draftCreatedAt, after.snapshot.draftExpiresAt, after.snapshot.idleExpiresAt, after.snapshot.absoluteExpiresAt]).toEqual([before.snapshot.draftCreatedAt, before.snapshot.draftExpiresAt, before.snapshot.idleExpiresAt, before.snapshot.absoluteExpiresAt]);
  expect(after.snapshot.transcript.filter(t => t.role === "USER")).toEqual(before.snapshot.transcript.filter(t => t.role === "USER"));
  expect(JSON.stringify(after.snapshot)).not.toContain(oversized);
  expect(await h.run(2, "Có.")).not.toEqual({ status: "CONFIRMED" });
  expect(h.getRequests()).toBe(1);
  expect(await h.f.db.prepare("SELECT count(*) n FROM reminders").first("n")).toBe(0);
});

it("selected completion sends truthful confirmation after payload cleanup", async () => {
  const h = await selectedHarness({ title: "đi thi", reminderDate: { kind: "CIVIL_DATE", calendar: "GREGORIAN", day: 8, month: 10, year: 2026, leapMonth: null }, reminderTime: { hour: 8, minute: 0, qualifier: "H24" } });
  expect(await h.run(0, "nhắc đi thi 8/10/2026 8h")).toEqual({ status: "DRAFT_CREATED" });
  expect(await h.run(1, "Có.")).toEqual({ status: "CONFIRMED" });
  expect(h.replies).toHaveLength(2);
  expect(h.events.filter(e => e.event === "REPLY_SENT")).toHaveLength(2);
  expect(await h.f.db.prepare("SELECT count(*) n FROM reminders").first("n")).toBe(1);
});

it("selected build-time oversized refusal preserves pending candidate source and original TTL", async () => {
  const h = await selectedHarness({ title: "đi thi", reminderDate: { kind: "CIVIL_DATE", calendar: "GREGORIAN", day: 8, month: 10, year: 2026, leapMonth: null }, reminderTime: { hour: 8, minute: 0, qualifier: "H24" } });
  expect(await h.run(0, "nhắc đi thi 8/10/2026 8h")).toEqual({ status: "DRAFT_CREATED" });
  h.setWireMutation(wire => {
    const object = wire as Record<string, unknown>, target = object.requestTarget as { evidence: Array<{ turn: number; quote: string; occurrence: number }> };
    const evidence = target.evidence.map(ref => ({ kind: "USER_QUOTE", turn: ref.turn, quote: ref.quote, occurrence: ref.occurrence }));
    return { ...object, requestTarget: { ...target, kind: "UNRESOLVED" }, uncertainties: [{ fieldCode: 15, reason: "AMBIGUOUS", alternatives: [JSON.stringify({ value: "CURRENT", evidence }), JSON.stringify({ value: "NEW", evidence })] }] };
  });
  await h.run(1, "nhắc đi thi 8/10/2026 8h");
  const before = await h.store.observe(h.f.scope(2)); if ("failure" in before || !before.snapshot) throw new Error("missing retained proposal");
  expect(before.snapshot.pendingSemanticCandidate).not.toBeNull();
  expect(await h.run(2, "x".repeat(1801))).toEqual({ status: "REJECTED" });
  expect(h.getRequests()).toBe(2);
  const after = await h.store.observe(h.f.scope(3)); if ("failure" in after || !after.snapshot) throw new Error("missing retained proposal after refusal");
  expect(after.snapshot.pendingSemanticCandidate).toEqual({ ...before.snapshot.pendingSemanticCandidate, baseContextRevision: after.snapshot.contextRevision });
  expect(after.snapshot.slots).toEqual(before.snapshot.slots); expect(after.snapshot.facts).toEqual(before.snapshot.facts);
  expect([after.snapshot.draftCreatedAt, after.snapshot.draftExpiresAt, after.snapshot.idleExpiresAt, after.snapshot.absoluteExpiresAt]).toEqual([before.snapshot.draftCreatedAt, before.snapshot.draftExpiresAt, before.snapshot.idleExpiresAt, before.snapshot.absoluteExpiresAt]);
  expect(after.snapshot.pendingDecision).toBeNull(); expect(after.snapshot.previewReceipt).toBeNull();
  expect(after.snapshot.transcript.filter(t => t.role === "USER")).toEqual(before.snapshot.transcript.filter(t => t.role === "USER"));
  expect(await h.f.db.prepare("SELECT count(*) n FROM reminders").first("n")).toBe(0);
});

it("selected absent refusal sends without a draft and never claims cancellation", async () => {
  const h = await selectedHarness(); h.setFail();
  expect(await h.run(0, "nhắc đi thi")).toEqual({ status: "REJECTED" });
  expect(h.replies).toHaveLength(1);
  expect(h.replies[0].text).not.toContain("Đã bỏ");
  expect(h.events.filter(e => e.event === "REPLY_SENT")).toHaveLength(1);
  expect(await h.f.db.prepare("SELECT count(*) n FROM reminders").first("n")).toBe(0);
});

it.each(["SCHEMA", "EVIDENCE", "PROVIDER", "BUDGET", "SIZE"] as const)("selected fresh absent %s refusal delivers without snapshot, revision or TTL", async failure => {
  const h = await selectedHarness({ title: "đi thi" }, failure === "BUDGET");
  if (failure === "PROVIDER") h.setFail();
  if (failure === "SCHEMA") h.setWireMutation(wire => ({ ...(wire as object), intent: "UNKNOWN" }));
  if (failure === "EVIDENCE") h.setWireMutation(wire => {
    const object = wire as { changes: Array<{ evidence: Array<Record<string, unknown>> }> };
    return { ...object, changes: object.changes.map(change => ({ ...change, evidence: change.evidence.map(ref => ({ ...ref, quote: "not present in the current user turn" })) })) };
  });
  expect(await h.run(0, failure === "SIZE" ? "x".repeat(1801) : "nhắc đi thi")).toEqual({ status: "REJECTED" });
  expect(h.getRequests()).toBe(failure === "SIZE" || failure === "BUDGET" ? 0 : 1);
  const observed = await h.store.observe(h.f.scope(1)); if ("failure" in observed) throw new Error(observed.failure);
  expect(observed.snapshot).toBeNull();
  // No row means no accepted revision, draft identity or context/draft TTL.
  expect(await h.f.db.prepare("SELECT count(*) n FROM conversation_contexts").first("n")).toBe(0);
  expect(await h.f.db.prepare("SELECT count(*) n FROM conversation_context_outcomes").first("n")).toBe(0);
  expect(await h.f.db.prepare("SELECT count(*) n FROM reminders").first("n")).toBe(0);
  expect(await h.f.db.prepare("SELECT state FROM inbound_updates WHERE id=?").bind(h.f.scope(0).sourceInboundId).first("state")).toBe("PROCESSED");
  expect(h.replies).toHaveLength(1); expect(h.replies[0].source).toBe("BACKEND");
  expect(h.events.filter(e => e.event === "REPLY_SENT")).toHaveLength(1);
});

it("selected prior no-A grounded candidate survives operational refusal with original source and TTL", async () => {
  const h = await selectedHarness();
  h.setWireMutation(wire => {
    const object = wire as Record<string, unknown>, target = object.requestTarget as { evidence: Array<{ turn: number; quote: string; occurrence: number }> };
    const evidence = target.evidence.map(ref => ({ kind: "USER_QUOTE", turn: ref.turn, quote: ref.quote, occurrence: ref.occurrence }));
    return { ...object, requestTarget: { ...target, kind: "UNRESOLVED" }, uncertainties: [{ fieldCode: 15, reason: "AMBIGUOUS", alternatives: [JSON.stringify({ value: "CURRENT", evidence }), JSON.stringify({ value: "NEW", evidence })] }] };
  });
  await h.run(0, "nhắc đi thi");
  const before = await h.store.observe(h.f.scope(1)); if ("failure" in before || !before.snapshot) throw new Error("missing no-A staged candidate");
  expect(before.snapshot.requestId).toBeNull(); expect(before.snapshot.pendingSemanticCandidate).not.toBeNull();
  h.setFail(); expect(await h.run(1, "nhắc đi thi")).toEqual({ status: "REJECTED" });
  const after = await h.store.observe(h.f.scope(2)); if ("failure" in after || !after.snapshot) throw new Error("lost no-A staged candidate");
  expect(after.snapshot.requestId).toBeNull();
  expect(after.snapshot.pendingSemanticCandidate).toEqual({ ...before.snapshot.pendingSemanticCandidate, baseContextRevision: after.snapshot.contextRevision });
  expect([after.snapshot.createdAt, after.snapshot.idleExpiresAt, after.snapshot.absoluteExpiresAt, after.snapshot.draftCreatedAt, after.snapshot.draftExpiresAt]).toEqual([before.snapshot.createdAt, before.snapshot.idleExpiresAt, before.snapshot.absoluteExpiresAt, before.snapshot.draftCreatedAt, before.snapshot.draftExpiresAt]);
  expect(h.replies).toHaveLength(2);
  expect(await h.f.db.prepare("SELECT count(*) n FROM reminders").first("n")).toBe(0);
});

it("family2_is_not_protocol_selection and stale selected observations cannot grant send", async () => {
  const h = await selectedHarness(), legacy = await h.f.store.observe(h.f.scope(0));
  if ("failure" in legacy) throw new Error(legacy.failure);
  expect(await h.runtimeStore.canSend(h.f.scope(0), undefined, legacy.observation)).toBe(false);
  const prior = await h.store.observe(h.f.scope(0)); if ("failure" in prior) throw new Error(prior.failure);
  await h.run(0, "nhắc đi thi"); await h.run(1, "nhắc đi thi");
  expect(await h.runtimeStore.canSend(h.f.scope(0), undefined, prior.observation)).toBe(false);
  expect(await h.runtimeStore.canSend(h.f.scope(1), undefined, structuredClone(prior.observation))).toBe(false);
  expect(await h.runtimeStore.canSend(h.f.scope(1))).toBe(false);
});

it("selected first-in-flight absence sends truthful notice and fences the delayed turn", async () => {
  const h = await selectedHarness();
  let release!: () => void, signal!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; }), started = new Promise<void>(resolve => { signal = resolve; });
  h.setWait(held, signal);
  const original = h.run(0, "nhắc đi thi"); await started;
  await h.run(1, "Bỏ.");
  expect(h.replies).toHaveLength(1);
  expect(h.replies[0].text).not.toContain("Đã bỏ");
  release(); expect(await original).toEqual({ status: "SUPERSEDED" });
  expect(h.replies).toHaveLength(1);
  expect(h.getRequests()).toBe(1);
  expect(await h.f.db.prepare("SELECT count(*) n FROM reminders").first("n")).toBe(0);
});

it("one_dispatch_no_guidance_retry keeps valid facts despite independently invalid advice", async () => {
  const h = await selectedHarness();
  h.setWireMutation(wire => ({ ...(wire as Record<string, unknown>), conversationDirective: { kind: "INVALID", privateValue: "SYNTHETIC_PRIVATE" }, replyProposal: { text: "Đã lưu lịch", extra: true } }));
  expect(await h.run(0, "nhắc đi thi")).toEqual({ status: "CLARIFICATION_REQUESTED" });
  expect(await h.store.observe(h.f.scope(1))).toMatchObject({ snapshot: { slots: { title: { value: "đi thi" } } } });
  expect(h.replies[0].source).toBe("BACKEND");
  expect(h.getRequests()).toBe(1);
  expect(h.events.find(e => e.event === "STRUCTURE_VALIDATED")).toMatchObject({ fullSchemaValid: false, semanticPatchValidation: "VALID", directiveValidation: "INVALID" });
  expect(JSON.stringify([h.events, h.replies])).not.toContain("SYNTHETIC_PRIVATE");
});

it.each(["schemaVersion", "dialogueAct", "continuation", "controlEvidence"])("wrong_model_version_has_no_authority rejects extra %s on actual wire", async key => {
  const h = await selectedHarness();
  h.setWireMutation(wire => ({ ...(wire as Record<string, unknown>), [key]: "SYNTHETIC_PRIVATE" }));
  expect(await h.run(0, "nhắc đi thi")).toEqual({ status: "REJECTED" });
  const observed = await h.store.observe(h.f.scope(1));
  expect(observed).not.toHaveProperty("snapshot.slots.title.value", "đi thi");
  expect(h.getRequests()).toBe(1);
  expect(await h.f.db.prepare("SELECT count(*) n FROM reminders").first("n")).toBe(0);
});

it("R02 wire without protocol metadata persists and observes only application-owned versions", async () => {
  const h = await harness([]);
  h.deps.budgetStore = new D1SemanticBudgetStore(h.f.db, { ...limits, reservationInputTokenExposure: 1048576 });
  let requests = 0;
  h.deps.gateway = createContextContractGateway({ protocol: CONTEXT_PROTOCOL_V3, maxInputChars: 1800, maxInputTokens: 12000, maxOutputTokens: 1536, maxResponseBytes: 32768, timeoutMs: 30000,
    primary: { model: "google/gemini-2.5-flash-lite", provider: "google-vertex/eu", requireZdr: true, promptPriceMicrounitsPerMillionTokens: 100000, completionPriceMicrounitsPerMillionTokens: 400000 } }, async request => {
    requests++;
    const input = JSON.parse(request.messages[1].content) as ContextInput;
    const proposal = encodeFixtureV3(frozenContextProposal(input, "R02", 0));
    expect(proposal).not.toHaveProperty("schemaVersion");
    return { status: 200, body: JSON.stringify({ model: "google/gemini-2.5-flash-lite", provider: "Google", id: "gen-synthetic-protocol",
      choices: [{ finish_reason: "stop", message: { content: JSON.stringify(proposal) } }], usage: { cost: .0004, prompt_tokens: 2200, completion_tokens: 500 } }) };
  }, { status: "OBSERVABLE_CANARY", advertisedContextTokens: 1048576 });
  const outcome = await h.turn(0, "Ngày 11/10 đi thi ở Quang Trung, nhắc 2 ngày liên tiếp giúp tôi.");
  expect(outcome, JSON.stringify(h.events.map(e => ({ event: e.event, ...("reason" in e ? { reason: e.reason } : {}), ...("diagnostic" in e ? { diagnostic: e.diagnostic } : {}) })))).toEqual({ status: "CLARIFICATION_REQUESTED" });
  expect(requests).toBe(1);
  const state = await h.read(1);
  expect(state).toMatchObject({ schemaVersion: "calenote-context-state-2", modelAttemptBinding: { contractVersion: "calenote-context-3", status: "ACCEPTED" } });
  expect(state?.slots.title.value).toBe("đi thi");
  expect(state?.slots.location.value).toBe("Quang Trung");
  expect(state?.slots.occurrenceCount.value).toBe(2);
  for (const event of h.events) expect(event.contractVersion).toBe("calenote-context-3");
  expect(await h.f.db.prepare("SELECT count(*) n FROM reminders").first("n")).toBe(0);
});

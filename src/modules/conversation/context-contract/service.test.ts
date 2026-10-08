// @vitest-environment node
import { expect, it } from "vitest";
import { D1ContextRuntimeStore } from "./runtime-store";
import { date, time } from "./resolution-test-support";
import { setup, harness, proposal, complete, completeText, type Proposal } from "./service-test-support";
import { createD1ContextContractStoreV3 } from "./infrastructure/d1/store";
import { createContextContractService } from "./service";
import { chat, message } from "./context-test-fixtures";
import { createContextContractGateway, createContextHttpTransport } from "../../intelligence/infrastructure/openrouter/semantic-gateway";
it("provider diagnostics never enter actual service errors, telemetry, replies or persisted conversation state", async () => {
  const h = await harness([]);
  const config = { protocol: CONTEXT_PROTOCOL_V3, maxInputChars: 1800, maxInputTokens: 12000, maxOutputTokens: 1536, maxResponseBytes: 32768, timeoutMs: 30000,
    primary: { model: "google/gemini-2.5-flash-lite", provider: "google-vertex/eu", requireZdr: true, promptPriceMicrounitsPerMillionTokens: 100000, completionPriceMicrounitsPerMillionTokens: 400000 } };
  const gateway = createContextContractGateway(config, createContextHttpTransport("SYNTHETIC_CREDENTIAL", async () => new Response(JSON.stringify({
    error: { code: "invalid_argument", message: "Authorization: Bearer SYNTHETIC_CREDENTIAL SYNTHETIC_OWNER_ID", metadata: { param: "response_format.json_schema" } },
  }), { status: 400, headers: { "content-type": "application/json" } })), { status: "OBSERVABLE_CANARY", advertisedContextTokens: 1048576 });
  h.deps.gateway = { prepare(tier, input) {
    const p = gateway.prepare(tier, input);
    // Fixture budget reserves its approved offline price; only the HTTP boundary
    // is synthetic. Actual failure selection/persistence/telemetry stays real.
    return p.status === "READY" ? { ...p, maximumCostMicrounits: 1815 } : p;
  } };
  const result = await h.turn(0), state = await h.read(1);
  expect(h.events.filter(e => e.event === "REQUEST_DISPATCHED")).toHaveLength(1);
  expect(h.events.filter(e => e.event === "RESPONSE_RECEIVED")).toMatchObject([{ outcome: "FAILURE", reason: "PROVIDER_FAILURE" }]);
  for (const value of [result, h.events, h.replies, state]) {
    const encoded = JSON.stringify(value);
    for (const sentinel of ["SYNTHETIC_CREDENTIAL", "SYNTHETIC_OWNER_ID", "failureDiagnostics", "invalid_argument", "response_format"]) expect(encoded).not.toContain(sentinel);
  }
  expect(await h.f.db.prepare("SELECT count(*) n FROM reminders").first("n")).toBe(0);
});
it("all_successor_natural_turns_use_one_gateway and reply_captured_after_fenced_transition", async () => {
  const h = await harness([proposal(complete)]);
  const result = await h.turn(0, completeText);
  expect(result, JSON.stringify({ events: h.events, replies: h.replies })).toEqual({ status: "DRAFT_CREATED" });
  expect(h.events.filter(e => e.event === "REQUEST_DISPATCHED")).toHaveLength(1);
  expect(h.replies[0]).toMatchObject({ kind: "PREVIEW", source: "BACKEND" });
  const state = await h.read(1);
  expect(state?.previewReceipt?.deliveryState).toBe("SENT");
  expect(state?.transcript.at(-1)?.text).toBe(h.replies[0].text);
  expect(await h.f.db.prepare("SELECT count(*) n FROM reminders").first("n")).toBe(0);
  expect(await h.turn(1, "Có.")).toEqual({ status: "CONFIRMED" });
  expect(await h.f.db.prepare("SELECT count(*) n FROM reminders").first("n")).toBe(1);
  expect(h.events.filter(e => e.event === "REQUEST_DISPATCHED")).toHaveLength(1);
});
it("durable attempt claim binds one inbound and refuses a duplicate digest or cross-contract attempt", async () => {
  const f = await setup(), runtime = new D1ContextRuntimeStore(f.db), scope = f.scope();
  const observed = await f.store.observe(scope); if ("failure" in observed) throw new Error(observed.failure);
  expect(await runtime.claimAttempt(scope, observed.observation, "a".repeat(64))).toBe(true);
  expect(await runtime.claimAttempt(scope, observed.observation, "b".repeat(64))).toBe(false);
  const row = await f.db.prepare("SELECT action FROM audit_events WHERE id='semantic-attempt:old'").first<{ action: string }>();
  expect(row?.action).toBe(`CONTEXT_ATTEMPT:${"a".repeat(64)}`);
});
it("durable attempt rejects an observed absence after a request is accepted", async () => {
  const f = await setup(), runtime = new D1ContextRuntimeStore(f.db);
  const observed = await f.store.observe(f.scope(1)); if ("failure" in observed) throw new Error(observed.failure);
  expect((await f.save()).result.status).toBe("APPLIED");
  expect(await runtime.claimAttempt(f.scope(1), observed.observation, "a".repeat(64))).toBe(false);
});
const missingTime = { title: "đi thi", eventDate: date(), location: "Quang Trung", notes: "nhớ giấy tờ", frequency: "DAILY", occurrenceCount: 2, eventRelation: "BEFORE_EVENT" };
const missingTimeText = "Ngày 11/10/2026 đi thi ở Quang Trung, nhớ giấy tờ; nhắc hai ngày liên tiếp trước hôm thi.";
it.each([
  ["CO-A", { kind: "ASK_FOR_FIELD", field: "reminderTime" }, { text: "Bạn muốn mình nhắc lúc mấy giờ?" }, "MODEL_GUIDANCE"],
  ["CO-B", { kind: "ASK_FOR_FIELD", field: "eventDate" }, { text: "Bạn thi ngày nào?" }, "BACKEND"],
  ["CO-C", { kind: "PRESENT_PREVIEW" }, null, "BACKEND"],
  ["CO-D", { kind: "ASK_FOR_FIELD", field: "reminderTime" }, { text: "Đã lưu lịch cho bạn." }, "BACKEND"],
  ["missing reply", { kind: "ASK_FOR_FIELD", field: "reminderTime" }, undefined, "BACKEND"],
  ["oversized reply", { kind: "ASK_FOR_FIELD", field: "reminderTime" }, { text: "x".repeat(401) }, "BACKEND"],
] as const)("%s retains grounded facts and captures only actual selected reply", async (_name, directive, reply, source) => {
  const h = await harness([proposal(missingTime, "NEW", directive, reply)]);
  expect(await h.turn(0, missingTimeText)).toEqual({ status: "CLARIFICATION_REQUESTED" });
  const state = await h.read(1);
  expect(state?.slots).toMatchObject({ title: { value: "đi thi" }, location: { value: "Quang Trung" }, notes: { value: "nhớ giấy tờ" }, reminderTime: { state: "MISSING" } });
  expect(h.replies[0].source).toBe(source);
  expect(state?.transcript.at(-1)?.text).toBe(h.replies[0].text);
  expect(state?.pendingReminderQuestion).toMatchObject({ field: "reminderTime", deliveryState: "SENT" });
  expect(state?.previewReceipt).toBeNull();
  expect(await h.f.db.prepare("SELECT count(*) n FROM reminders").first("n")).toBe(0);
});
const queryQuestion: Proposal = input => ({ schemaVersion: "calenote-context-3", intent: "LIST_REMINDERS", requestTarget: null, changes: [],
    query: { kind: "LIST", period: null, statusScope: "DEFAULT", evidence: [{ kind: "USER_QUOTE", turn: input.currentTurn, quote: input.turns[input.currentTurn].text, occurrence: 1 }] }, uncertainties: [{ field: "queryRange", reason: "MISSING", alternatives: [] }],
    conversationDirective: { kind: "ASK_FOR_FIELD", field: "queryRange" }, replyProposal: null });
it.each(["SENT", "FAILED", "UNCERTAIN"] as const)("actual %s query clarification receipt controls next provider question", async status => {
  const h = await harness([queryQuestion]); h.setDelivery(status === "SENT" ? { status, messageRef: null } : { status });
  const result = await h.turn(0, "Có lịch nào ko?");
  expect(result, JSON.stringify(h.events)).toEqual({ status: "CLARIFICATION_REQUESTED" });
  expect((await h.read(1))?.pendingQueryQuestion).toMatchObject({ field: "queryRange", deliveryState: status });
});
it.each(["SENT", "FAILED", "UNCERTAIN"] as const)("actual %s reminder clarification receipt settles the exact question", async status => {
  const h = await harness([proposal(missingTime)]); h.setDelivery(status === "SENT" ? { status, messageRef: null } : { status });
  expect(await h.turn(0, missingTimeText)).toEqual({ status: "CLARIFICATION_REQUESTED" });
  const state = (await h.read(1))!;
  expect(state.pendingReminderQuestion).toMatchObject({ questionId: state.transcript.at(-1)!.id, field: "reminderTime", deliveryState: status });
});
it("replacement_yes_never_saves_A_or_B through actual service", async () => {
  const h = await harness([proposal(complete), proposal({ ...complete, title: "gọi mẹ" })]);
  await h.turn(0, completeText); await h.turn(1, "nhắc gọi mẹ ngày 8/10/2026 8h");
  expect((await h.read(2))?.pendingDecision?.kind).toBe("REPLACE_PENDING");
  await h.turn(2, "Có.");
  const b = await h.read(3);
  expect(b?.slots.title.value).toBe("gọi mẹ");
  expect(b?.pendingDecision?.kind).toBe("SAVE_PREVIEW");
  expect(b?.draftRevision).toBeGreaterThan(1);
  expect(await h.f.db.prepare("SELECT count(*) n FROM reminders").first("n")).toBe(0);
  expect(await h.turn(3, `xác nhận ${b!.pendingDecision!.tokenHandle}`)).toEqual({ status: "CONFIRMED" });
});
it("R02 R07 R08 CO-E progressive facts then mixed correction never confirms", async () => {
  const h = await harness([proposal(missingTime), proposal({ reminderTime: time() }, "CURRENT"), proposal({ reminderTime: time(9) }, "CURRENT", null, null, ["reminderTime"])]);
  await h.turn(0, missingTimeText); await h.turn(1, "8h");
  const before = await h.read(2);
  expect(before?.previewReceipt?.deliveryState).toBe("SENT");
  await h.turn(2, "Có, nhưng đổi sang 9h.");
  const after = await h.read(3);
  expect(after?.slots).toMatchObject({ title: { value: "đi thi" }, reminderTime: { value: time(9) }, occurrenceCount: { value: 2 }, notes: { value: "nhớ giấy tờ" } });
  expect(after?.draftRevision).toBeGreaterThan(before!.draftRevision!);
  expect(h.replies.at(-1)?.text).toContain("09:00");
  expect(h.events.filter(e => e.event === "REQUEST_DISPATCHED")).toHaveLength(3);
  expect(await h.f.db.prepare("SELECT count(*) n FROM reminders").first("n")).toBe(0);
});
it("R11 query interruption retains exact draft expiry and suspends save", async () => {
  const query: Proposal = input => ({ schemaVersion: "calenote-context-3", intent: "LIST_REMINDERS", requestTarget: null, changes: [],
    query: { kind: "LIST", period: { kind: "MONTH", offset: 0 }, statusScope: "DEFAULT", evidence: [{ kind: "USER_QUOTE", turn: input.currentTurn, quote: input.turns[input.currentTurn].text, occurrence: 1 }] }, uncertainties: [], conversationDirective: null, replyProposal: null });
  const h = await harness([proposal(complete), query, proposal({}, "CURRENT")]);
  await h.turn(0, completeText); const before = await h.read(1);
  expect(await h.turn(1, "Tháng này có lịch gì?")).toEqual({ status: "REMINDERS_LISTED" });
  const after = await h.read(2);
  expect(after?.draftExpiresAt).toBe(before?.draftExpiresAt);
  expect(after?.draftRevision).toBe(before?.draftRevision);
  expect(after?.slots).toEqual(before?.slots);
  expect(after?.pendingDecision).toBeNull();
  await h.turn(2, "Tiếp tục yêu cầu đang giữ");
  expect((await h.read(3))?.pendingDecision?.kind).toBe("SAVE_PREVIEW");
  expect(await h.f.db.prepare("SELECT count(*) n FROM reminders").first("n")).toBe(0);
});
it("R13 delayed old edit loses to a later accepted abandon without stale outbound", async () => {
  const h = await harness([proposal(missingTime), proposal({ reminderTime: time() }, "CURRENT")]);
  await h.turn(0, missingTimeText);
  const gateway = h.deps.gateway;
  let release!: () => void, started!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; }), dispatched = new Promise<void>(resolve => { started = resolve; });
  h.deps.gateway = { prepare: (tier, input) => { const prepared = gateway.prepare(tier, input); return prepared.status !== "READY" ? prepared : { ...prepared,
    dispatch: async () => { started(); await waiting; return prepared.dispatch(); } }; } };
  const old = h.turn(1, "8h"); await dispatched;
  expect(await h.turn(2, "Bỏ.")).toEqual({ status: "CANCELLED" });
  const count = h.replies.length; release();
  expect(await old).toEqual({ status: "SUPERSEDED" });
  expect(h.replies).toHaveLength(count);
  expect(await h.read(3)).toBeNull();
  expect(await h.f.db.prepare("SELECT count(*) n FROM reminders").first("n")).toBe(0);
});
it("R14 duplicate confirmation after lost send creates exactly one set of children", async () => {
  const h = await harness([proposal({ ...missingTime, reminderTime: time() })]);
  await h.turn(0, `${missingTimeText} Nhắc lúc 8h.`); h.setDelivery({ status: "UNCERTAIN" });
  const state = await h.read(1);
  expect(await h.turn(1, `xác nhận ${state!.pendingDecision!.tokenHandle}`)).toEqual({ status: "CONFIRMED" });
  const count = h.replies.length;
  expect(await h.turn(1, `xác nhận ${state!.pendingDecision!.tokenHandle}`)).toEqual({ status: "SUPERSEDED" });
  expect(h.replies).toHaveLength(count);
  expect(await h.f.db.prepare("SELECT count(*) n FROM reminders").first("n")).toBe(2);
});
it.each(["FAILED", "UNCERTAIN"] as const)("%s preview cannot gain confirmation authority", async status => {
  const h = await harness([proposal(complete)]); h.setDelivery({ status }); await h.turn(0, completeText);
  await h.turn(1, "Có.");
  expect(h.events.filter(e => e.event === "REQUEST_DISPATCHED")).toHaveLength(1);
  expect(await h.f.db.prepare("SELECT count(*) n FROM reminders").first("n")).toBe(0);
});
it.each(["greeting", "help", "no pending abandon"])("%s is a zero-call bounded bypass", async name => {
  const h = await harness([]); await h.turn(0, name === "greeting" ? "Xin chào" : name === "help" ? "help" : "Bỏ.");
  expect(h.inputs).toHaveLength(0);
  expect(h.replies[0].text).not.toContain("Đã bỏ");
  expect(await h.f.db.prepare("SELECT count(*) n FROM reminders").first("n")).toBe(0);
});
it("process restart reloads encrypted accepted facts and never exposes identities to gateway/events", async () => {
  const h = await harness([proposal(missingTime), proposal({ reminderTime: time() }, "CURRENT")]);
  await h.turn(0, missingTimeText);
  h.deps.store = createD1ContextContractStoreV3({ db: h.f.db, keyring: h.f.keyring, protocol: CONTEXT_PROTOCOL_V3 });
  const restarted = createContextContractService(h.deps); h.setIndex(1);
  const s = h.f.scope(1);
  expect(await restarted.handle({ ...message("8h"), id: s.sourceInboundId, claimMarker: s.claimMarker, receivedAt: s.now }, { ...chat, inboundRowId: 2 })).toEqual({ status: "DRAFT_CREATED" });
  expect(h.inputs[1].pendingQuestion?.field).toBe("reminderTime");
  const emitted = JSON.stringify(h.events), input = JSON.stringify(h.inputs);
  for (const secret of ["provider-user", "identity", "claimMarker", "sourceInboundId", "Quang Trung", "nhớ giấy tờ"]) expect(emitted).not.toContain(secret);
  for (const secret of ["provider-user", "claimMarker", "sourceInboundId", "ownerId"]) expect(input).not.toContain(secret);
  const cipher = await h.f.db.prepare("SELECT payload_ciphertext FROM conversation_contexts").first<unknown>("payload_ciphertext");
  expect(String(cipher)).not.toContain("Quang Trung");
});
it.each(["budget", "mark", "ceiling", "timeout", "evidence", "invalid core"])("%s failure never saves or retries", async fault => {
  const h = await harness([proposal(complete)]);
  if (fault === "budget") h.deps.budgetStore.reservePaidCall = async () => ({ status: "BUDGET_EXHAUSTED" });
  if (fault === "mark") h.deps.budgetStore.markDispatched = async () => false;
  if (fault === "ceiling" || fault === "timeout") {
    const gateway = h.deps.gateway;
    h.deps.gateway = { prepare: (tier, input) => { const p = gateway.prepare(tier, input); return p.status !== "READY" ? p : fault === "ceiling" ? { ...p, maximumCostMicrounits: p.maximumCostMicrounits + 1 }
      : { ...p, dispatch: async () => ({ status: "FAILURE", category: "TIMEOUT" }) }; } };
  }
  if (fault === "evidence" || fault === "invalid core") {
    const gateway = h.deps.gateway;
    h.deps.gateway = { prepare: (tier, input) => { const p = gateway.prepare(tier, input); return p.status !== "READY" ? p : { ...p, dispatch: async () => {
      const r = await p.dispatch(); if (r.status === "SUCCESS") {
        if (fault === "evidence" && "semantic" in r.interpretation) r.interpretation.semantic.changes[0].evidence = [{ kind: "USER_QUOTE", turn: 999, quote: "fabricated", occurrence: 1 }];
        else return { status: "FAILURE", category: "SCHEMA_INVALID" };
      } return r;
    } }; } };
  }
  await h.turn(0, completeText);
  expect(h.events.filter(e => e.event === "REQUEST_DISPATCHED")).toHaveLength(["budget", "mark", "ceiling"].includes(fault) ? 0 : 1);
  expect(await h.f.db.prepare("SELECT count(*) n FROM reminders").first("n")).toBe(0);
});
it("R14 uncertain confirmation read-back reports actual committed children", async () => {
  const h = await harness([proposal(complete)]); await h.turn(0, completeText);
  const confirm = h.f.store.confirm.bind(h.f.store);
  h.f.store.confirm = async (authority, proof) => { await confirm(authority, proof); return { status: "UNCERTAIN" }; };
  expect(await h.turn(1, "Có.")).toEqual({ status: "CONFIRMED" });
  expect(h.replies.at(-1)?.text).toContain("Đã lưu 1");
  expect(await h.f.db.prepare("SELECT count(*) n FROM reminders").first("n")).toBe(1);
});
it("uncertain apply never sends an unverified preview or retries persistence", async () => {
  const h = await harness([proposal(complete)]);
  const apply = h.f.store.apply.bind(h.f.store);
  h.f.store.apply = async (...args) => { await apply(...args); return { status: "UNCERTAIN" }; };
  expect(await h.turn(0, completeText)).toEqual({ status: "SUPERSEDED" });
  expect(h.replies).toHaveLength(0);
  expect((await h.read(1))?.previewReceipt?.deliveryState).toBe("UNCERTAIN");
  expect(await h.f.db.prepare("SELECT count(*) n FROM reminders").first("n")).toBe(0);
});
it("queued confirmation received before preview cannot commit it", async () => {
  const h = await harness([proposal(complete)]);
  // This control was received earlier, but processed after the preview turn.
  await h.turn(1, completeText);
  expect(await h.turn(0, "Có.")).toEqual({ status: "SUPERSEDED" });
  expect(await h.f.db.prepare("SELECT count(*) n FROM reminders").first("n")).toBe(0);
});
it("receipt midnight is authoritative even when processing crosses midnight", async () => {
  const h = await harness([proposal({ title: "gọi mẹ", reminderDate: { kind: "RELATIVE_DAY", offsetDays: 1 }, reminderTime: time() })]);
  const received = Date.parse("2026-09-28T16:59:00Z"), processing = Date.parse("2026-09-28T17:01:00Z");
  await h.f.db.prepare("UPDATE inbound_updates SET received_at=? WHERE id='old'").bind(received).run();
  h.deps.now = () => processing;
  expect(await h.service.handle({ ...message("Mai 8h nhắc gọi mẹ"), id: "old", claimMarker: "old-claim", receivedAt: received }, { ...chat, inboundRowId: 1 })).toEqual({ status: "DRAFT_CREATED" });
  expect(h.replies[0].text).toContain("2026-09-29 08:00");
  expect(h.inputs[0].reference.localDate).toBe("2026-09-28");
});
it.each(["owner", "chat", "claim", "workspace"])("forged %s cannot dispatch or mutate", async field => {
  const h = await harness([proposal(complete)]), m = { ...message(), id: "old", claimMarker: "old-claim", receivedAt: h.f.scope().now }, c = { ...chat, inboundRowId: 1 };
  if (field === "owner") c.userId = "another-owner";
  if (field === "chat") c.chatIdentityId = "another-chat";
  if (field === "claim") m.claimMarker = "stolen-claim";
  if (field === "workspace") c.workspaceId = "another-workspace";
  await h.service.handle(m, c);
  expect(h.inputs).toHaveLength(0);
  expect(await h.f.db.prepare("SELECT count(*) n FROM reminders").first("n")).toBe(0);
});
it.each(["expired", "corrupt"])("%s context cannot fall back to another parser", async fault => {
  const h = await harness([proposal(missingTime)]); await h.turn(0, missingTimeText);
  if (fault === "expired") h.deps.now = () => h.f.scope().now + 600001;
  else {
    // Encryption fault at the actual reader boundary, without weakening D1's
    // immutable write triggers to manufacture invalid database rows.
    h.deps.store = createD1ContextContractStoreV3({ db: h.f.db, keyring: { ...h.f.keyring, decryptSensitive: async () => { throw new Error("corrupt ciphertext"); } }, protocol: CONTEXT_PROTOCOL_V3 });
  }
  await h.turn(1, "8h");
  expect(h.inputs).toHaveLength(1);
  expect(await h.f.db.prepare("SELECT count(*) n FROM reminders").first("n")).toBe(0);
});
it.each(["reminder", "query"])("stale %s question receipt cannot overwrite a newer delivered question", async kind => {
  const h = await harness(kind === "reminder" ? [proposal({ title: "đi thi" }), proposal({ reminderDate: date() }, "CURRENT")] : [queryQuestion, queryQuestion]);
  await h.turn(0); const old = (await h.read(1))!;
  await h.turn(1); const current = (await h.read(2))!;
  expect(await h.f.store.recordDelivery(h.f.scope(), { contextId: old.id, contextRevision: old.contextRevision, draftRevision: old.draftRevision,
    outboundId: old.transcript.at(-1)!.id, decisionId: old.pendingDecision?.decisionId ?? null, deliveryState: "FAILED", messageRef: null })).toBe("STALE");
  expect((await h.read(2))?.pendingReminderQuestion).toEqual(current.pendingReminderQuestion);
  expect((await h.read(2))?.pendingQueryQuestion).toEqual(current.pendingQueryQuestion);
});
it("CO-F retains offset without manufacturing daily count and keeps approximate time uncertain", async () => {
  const h = await harness([
    proposal({ title: "đi thi", location: "Quang Trung", eventDate: date(), eventRelation: "BEFORE_EVENT" }),
    proposal({ leadOffsetDays: 2 }, "CURRENT"),
    input => ({ ...(proposal({ reminderTime: time() }, "CURRENT")(input) as object), uncertainties: [{ field: "reminderTime", reason: "AMBIGUOUS", alternatives: [] }] }),
  ]);
  await h.turn(0, "11/10 tui thi ở Quang Trung, nhắc tui trước đó nha.");
  await h.turn(1, "Nhắc trước 2 ngày.");
  await h.turn(2, "sáng, khoảng 8h.");
  const state = await h.read(3);
  expect(state?.slots.occurrenceCount.value).toBeNull();
  expect(state?.slots.leadOffsetDays.value).toBe(2);
  expect(state?.pendingReminderQuestion?.field).toBe("reminderTime");
  expect(state?.previewReceipt).toBeNull();
  expect(h.events.filter(e => e.event === "REQUEST_DISPATCHED")).toHaveLength(3);
});
it("a fresh request after abandonment can continue past its first accepted turn", async () => {
  const h = await harness([proposal({ title: "đi thi" }), proposal(missingTime), proposal({ reminderTime: time() }, "CURRENT")]);
  await h.turn(0); await h.turn(1, "Bỏ.");
  expect(await h.turn(2, missingTimeText)).toEqual({ status: "CLARIFICATION_REQUESTED" });
  expect(await h.turn(3, "8h")).toEqual({ status: "DRAFT_CREATED" });
});
it("R02 exact three-turn series preserves count while accepting relation then clock", async () => {
  const h = await harness([
    proposal({ title: "đi thi", location: "Quang Trung", eventDate: date(), frequency: "DAILY", occurrenceCount: 2 }),
    proposal({ eventRelation: "BEFORE_EVENT" }, "CURRENT"),
    proposal({ reminderTime: time() }, "CURRENT"),
  ]);
  await h.turn(0, "Ngày 11/10 đi thi ở Quang Trung, nhắc 2 ngày liên tiếp giúp tôi.");
  await h.turn(1, "Nhắc trước 2 ngày.");
  expect((await h.read(2))?.pendingReminderQuestion?.field).toBe("reminderTime");
  expect(await h.turn(2, "8h.")).toEqual({ status: "DRAFT_CREATED" });
  expect(h.replies.at(-1)?.text).toContain("2026-10-09 08:00");
  expect(h.replies.at(-1)?.text).toContain("2026-10-10 08:00");
  expect(await h.f.db.prepare("SELECT count(*) n FROM reminders").first("n")).toBe(0);
});
it("R07 exact four-turn sequence preserves location and notes on clock edit", async () => {
  const h = await harness([
    proposal({ title: "đi thi", location: "Quang Trung", notes: "nhớ mang giấy tờ", eventDate: date() }),
    proposal({ frequency: "DAILY", occurrenceCount: 2, eventRelation: "BEFORE_EVENT" }, "CURRENT"),
    proposal({ reminderTime: time() }, "CURRENT"), proposal({ reminderTime: time(9) }, "CURRENT", null, null, ["reminderTime"]),
  ]);
  await h.turn(0, "Ngày 11/10 đi thi ở Quang Trung, nhớ mang giấy tờ.");
  await h.turn(1, "Nhắc hai ngày liên tiếp trước hôm thi."); await h.turn(2, "8h.");
  const before = await h.read(3);
  expect(await h.turn(3, "Đổi sang 9h.")).toEqual({ status: "DRAFT_CREATED" });
  const after = await h.read(4);
  expect(after?.slots.notes.value).toBe("nhớ mang giấy tờ");
  expect(after?.slots.location.value).toBe("Quang Trung");
  expect(after?.draftRevision).toBeGreaterThan(before!.draftRevision!);
  expect(h.replies.at(-1)?.text).toContain("2026-10-09 09:00");
});
it("first-in-flight no-draft abandon makes no fictitious cancellation receipt", async () => {
  const h = await harness([proposal(complete)]), gateway = h.deps.gateway;
  let release!: () => void, start!: () => void;
  const wait = new Promise<void>(r => { release = r; }), started = new Promise<void>(r => { start = r; });
  h.deps.gateway = { prepare: (tier, input) => { const p = gateway.prepare(tier, input); return p.status !== "READY" ? p : { ...p, dispatch: async () => { start(); await wait; return p.dispatch(); } }; } };
  const pending = h.turn(0, completeText); await started;
  await h.turn(1, "Bỏ."); const count = h.replies.length;
  expect(h.replies.at(-1)?.text).not.toContain("Đã bỏ");
  release(); expect(await pending).toEqual({ status: "SUPERSEDED" });
  expect(h.replies).toHaveLength(count);
  expect(await h.f.db.prepare("SELECT count(*) n FROM reminders").first("n")).toBe(0);
});
it("a newer accepted turn between persist and send fences old selected outbound", async () => {
  const h = await harness([proposal(complete)]), apply = h.f.store.apply.bind(h.f.store);
  let release!: () => void, start!: () => void;
  const wait = new Promise<void>(r => { release = r; }), persisted = new Promise<void>(r => { start = r; });
  h.f.store.apply = async (scope, observation, transition) => { const result = await apply(scope, observation, transition);
    if (scope.sourceInboundId === "old") { start(); await wait; } return result; };
  const pending = h.turn(0, completeText); await persisted;
  await h.turn(1, "Bỏ."); const count = h.replies.length;
  release(); await pending;
  expect(h.replies).toHaveLength(count);
  expect(h.replies.some(r => r.kind === "PREVIEW")).toBe(false);
});
it("two real owner/chat scopes cannot borrow each other's context or confirmation", async () => {
  const h = await harness([proposal(complete)]); await h.turn(0, completeText);
  for (const sql of [
    "INSERT INTO users VALUES('other','other@example.test','Other','Asia/Ho_Chi_Minh',1,1)",
    "INSERT INTO workspaces VALUES('other-space','other','PERSONAL',1,1)",
    "INSERT INTO memberships VALUES('other-space','other','OWNER',1)",
    "INSERT INTO bot_connections(id,user_id,provider,public_id,provider_bot_id,display_name,encrypted_token,encrypted_token_iv,token_fingerprint,credential_version,state,created_at,updated_at) VALUES('other-connection','other','telegram','other-public','other-bot','Other',x'01',zeroblob(12),'other-fingerprint',1,'ACTIVE_BOUND',1,1)",
    "INSERT INTO chat_identities(id,connection_id,provider_user_id,private_chat_id,linked_at) VALUES('other-identity','other-connection','other-user','other-chat',1)",
  ]) await h.f.db.prepare(sql).run();
  await h.f.db.prepare("INSERT INTO inbound_updates(id,connection_id,provider,provider_message_id,provider_user_id,private_chat_id,message_ciphertext,message_iv,message_key_version,state,received_at,transition_marker) VALUES('other-in','other-connection','telegram','other-msg','other-user','other-chat',x'01',zeroblob(12),1,'PROCESSING',?,'other-claim')").bind(h.f.scope(1).now).run();
  h.setIndex(1);
  h.deps.reply = async () => {
    expect(await h.f.db.prepare("SELECT state FROM inbound_updates WHERE id='other-in'").first("state")).toBe("PROCESSED");
    return { status: "SENT", messageRef: "other-out" };
  };
  await h.service.handle({ ...message("Có."), id: "other-in", connectionId: "other-connection", providerUserId: "other-user", privateChatId: "other-chat", claimMarker: "other-claim", receivedAt: h.f.scope(1).now },
    { ...chat, userId: "other", workspaceId: "other-space", chatIdentityId: "other-identity", inboundRowId: 11 });
  expect(await h.f.db.prepare("SELECT count(*) n FROM reminders").first("n")).toBe(0);
  expect((await h.read(2))?.slots.title.value).toBe("đi thi");
  expect(h.inputs).toHaveLength(1);
});
it.each(["save", "abandon"])("local %s remains available after six retained USER turns", async operation => {
  const h = await harness([proposal({ title: "đi thi" }), proposal({ notes: "giấy tờ" }, "CURRENT"), proposal({ location: "Quang Trung" }, "CURRENT"),
    proposal({ eventDate: date() }, "CURRENT"), proposal({ eventRelation: "INCLUDING_EVENT" }, "CURRENT"), proposal({ reminderTime: time() }, "CURRENT")]);
  for (let i = 0; i <= 5; i++) { const result = await h.turn(i, "đi thi giấy tờ Quang Trung 11/10 nhắc cùng ngày 8h"); expect(result).toEqual({ status: i === 5 ? "DRAFT_CREATED" : "CLARIFICATION_REQUESTED" }); }
  const before = (await h.read(6))!;
  expect(before.transcript.filter(t => t.role === "USER")).toHaveLength(6);
  expect(await h.turn(6, operation === "save" ? `xác nhận ${before.pendingDecision!.tokenHandle}` : "Bỏ.")).toEqual({ status: operation === "save" ? "CONFIRMED" : "CANCELLED" });
  expect(h.events.filter(e => e.event === "REQUEST_DISPATCHED")).toHaveLength(6);
  expect(await h.f.db.prepare("SELECT count(*) n FROM reminders").first("n")).toBe(operation === "save" ? 1 : 0);
});
it.each([1, 2])("I1 numeric clarification answer %s reaches one semantic turn rather than unscoped control", async count => {
  const h = await harness([proposal({ title: "đi thi", eventDate: date(), reminderTime: time(), eventRelation: "BEFORE_EVENT", frequency: "DAILY" }), proposal({ occurrenceCount: count }, "CURRENT")]);
  await h.turn(0, "Ngày 11/10/2026 đi thi; nhắc hằng ngày lúc 8h trước hôm thi.");
  expect((await h.read(1))?.pendingReminderQuestion?.field).toBe("occurrenceCount");
  expect(await h.turn(1, String(count))).toEqual({ status: count === 2 ? "DRAFT_CREATED" : "CLARIFICATION_REQUESTED" });
  if (count === 2) expect((await h.read(2))?.slots.occurrenceCount.value).toBe(count);
  expect(h.inputs[1].pendingQuestion?.field).toBe("occurrenceCount");
  expect(h.events.filter(e => e.event === "REQUEST_DISPATCHED")).toHaveLength(2);
});
it.each(["2", "không", "ambiguous then 2"])("I2 decline %s at six USER turns preserves A and permits subsequent scoped abandonment", async answer => {
  const h = await harness([proposal({ title: "đi thi" }), proposal({ notes: "giấy tờ" }, "CURRENT"), proposal({ location: "Quang Trung" }, "CURRENT"),
    proposal({ eventDate: date() }, "CURRENT"), proposal({ eventRelation: "INCLUDING_EVENT" }, "CURRENT"), proposal({ ...complete, title: "gọi mẹ" })]);
  for (let i = 0; i < 6; i++) await h.turn(i, i === 5 ? "nhắc gọi mẹ ngày 8/10/2026 lúc 8h" : "nhắc đi thi ngày 11/10/2026 lúc 8h ở Quang Trung nhớ giấy tờ");
  const before = (await h.read(6))!;
  expect(before.pendingDecision?.kind).toBe("REPLACE_PENDING");
  expect(before.transcript.filter(t => t.role === "USER")).toHaveLength(6);
  let index = 6;
  if (answer === "ambiguous then 2") {
    expect(await h.turn(index++, "Bỏ.")).toEqual({ status: "CLARIFICATION_REQUESTED" });
    expect((await h.read(index))?.pendingDecision?.candidate?.proposalId).toBe(before.pendingDecision?.candidate?.proposalId);
    expect(h.replies.at(-1)?.text).toContain("2");
  }
  expect(await h.turn(index++, answer === "ambiguous then 2" ? "2" : answer)).toEqual({ status: "CLARIFICATION_REQUESTED" });
  const declined = (await h.read(index))!;
  expect(declined.pendingDecision).toBeNull();
  expect(declined.slots).toEqual(before.slots);
  expect(declined.facts).toEqual(before.facts);
  expect(declined.draftRevision).toBe(before.draftRevision);
  expect(declined.draftExpiresAt).toBe(before.draftExpiresAt);
  expect(await h.turn(index, "Bỏ.")).toEqual({ status: "CANCELLED" });
  expect(h.events.filter(e => e.event === "REQUEST_DISPATCHED")).toHaveLength(6);
  expect(await h.f.db.prepare("SELECT count(*) n FROM reminders").first("n")).toBe(0);
});
it("I3 explicit response to uncertain preview re-presents before a separate bound confirmation", async () => {
  const h = await harness([proposal(complete)]); h.setDelivery({ status: "UNCERTAIN" });
  await h.turn(0, completeText); const before = (await h.read(1))!;
  expect(before.previewReceipt?.deliveryState).toBe("UNCERTAIN");
  h.setDelivery({ status: "SENT", messageRef: "recovery-ref" });
  expect(await h.turn(1, "Có.")).toEqual({ status: "DRAFT_CREATED" });
  const recovered = (await h.read(2))!;
  expect(h.replies.at(-1)?.kind).toBe("PREVIEW");
  expect(recovered.previewReceipt?.deliveryState).toBe("SENT");
  expect(recovered.pendingDecision?.kind).toBe("SAVE_PREVIEW");
  expect(recovered.previewReceipt?.previewId).not.toBe(before.previewReceipt?.previewId);
  expect(recovered.draftRevision).toBe(before.draftRevision);
  expect(recovered.draftExpiresAt).toBe(before.draftExpiresAt);
  expect(recovered.slots).toEqual(before.slots);
  expect(await h.f.db.prepare("SELECT count(*) n FROM reminders").first("n")).toBe(0);
  const d = recovered.pendingDecision!;
  expect(await h.f.store.confirm({ kind: "CHAT", scope: h.f.scope(2) }, { operationKey: "forged-bare-recovery", contextId: recovered.id,
    contextRevision: recovered.contextRevision, decisionId: d.decisionId, kind: d.kind, requestId: d.target.requestId, proposalId: d.target.proposalId,
    draftRevision: d.draftRevision, draftHash: recovered.previewReceipt!.draftHash, response: { kind: "BARE", text: "Có." } })).toEqual({ status: "REJECTED" });
  expect(await h.turn(2, "Có.")).toEqual({ status: "DRAFT_CREATED" });
  expect(await h.f.db.prepare("SELECT count(*) n FROM reminders").first("n")).toBe(0);
  const current = (await h.read(3))!;
  expect(await h.turn(3, `xác nhận ${current.pendingDecision!.tokenHandle}`)).toEqual({ status: "CONFIRMED" });
  expect(h.events.filter(e => e.event === "REQUEST_DISPATCHED")).toHaveLength(1);
  expect(await h.f.db.prepare("SELECT count(*) n FROM reminders").first("n")).toBe(1);
});
it("I3 bound-only recovery survives uncertain-preview eviction and six USER capacity", async () => {
  const h = await harness([proposal(complete)]); h.setDelivery({ status: "UNCERTAIN" });
  await h.turn(0, completeText); const original = (await h.read(1))!;
  h.setDelivery({ status: "SENT", messageRef: "recovery-ref" });
  for (let i = 1; i <= 6; i++) expect(await h.turn(i, "Có."), `turn ${i}: ${h.replies.at(-1)?.text}`).toEqual({ status: "DRAFT_CREATED" });
  const state = (await h.read(7))!, d = state.pendingDecision!;
  expect(state.transcript.filter(t => t.role === "ASSISTANT")).toHaveLength(6);
  expect(state.transcript.some(t => t.id === original.previewReceipt!.previewId)).toBe(false);
  expect(state.transcript.filter(t => t.role === "USER")).toHaveLength(6);
  expect(state.draftRevision).toBe(original.draftRevision);
  expect(state.draftExpiresAt).toBe(original.draftExpiresAt);
  expect(await h.f.store.confirm({ kind: "CHAT", scope: h.f.scope(7) }, { operationKey: "forged-bare-rollover", contextId: state.id,
    contextRevision: state.contextRevision, decisionId: d.decisionId, kind: d.kind, requestId: d.target.requestId, proposalId: d.target.proposalId,
    draftRevision: d.draftRevision, draftHash: state.previewReceipt!.draftHash, response: { kind: "BARE", text: "Có." } })).toEqual({ status: "REJECTED" });
  expect(await h.f.db.prepare("SELECT count(*) n FROM reminders").first("n")).toBe(0);
  expect(await h.turn(7, `xác nhận ${d.tokenHandle}`)).toEqual({ status: "CONFIRMED" });
  expect(h.events.filter(e => e.event === "REQUEST_DISPATCHED")).toHaveLength(1);
});

import { CONTEXT_PROTOCOL_V3 } from "./protocol";

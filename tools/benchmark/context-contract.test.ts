// @vitest-environment node
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { admitContextManifest, expandContextCampaign, scoreContextCampaign, type ContextManifest, type ContextObservation } from "./context-contract";
import { createContextContractProbe, runContextFixtureCampaign } from "./context-contract-probe";
import { createContextContractGateway } from "../../src/modules/intelligence/infrastructure/openrouter/semantic-gateway";
import { frozenContextProposal, validateContextFixtureCoverage, encodeFixtureV3 } from "./context-pointer-fixtures";
import { decodeGoogleLiteEuContextTransportV3 } from "../../src/modules/intelligence/infrastructure/openrouter/context-provider-wire";
import { CONTEXT_PROTOCOL_V3 } from "../../src/modules/conversation/context-contract/protocol";
import { ContextInputSchema } from "../../src/modules/conversation/context-contract/contracts";

it("all_R01_R16_keep_original_words_and_oracles", () => {
  const original = spawnSync("git", ["show", "68fac9b2b5e95ee57c53f0ac1f491210e153ed01:src/modules/conversation/context-contract/benchmark/regressions.json"], { encoding: "utf8" });
  expect(original.status).toBe(0);
  expect(regressions).toEqual(JSON.parse(original.stdout));
  expect(regressions.cases.map(c => c.id)).toEqual(Array.from({ length: 16 }, (_, i) => `R${String(i + 1).padStart(2, "0")}`));
  const input = ContextInputSchema.parse({schemaVersion:"calenote-context-input-2",reference:{instant:"2026-10-08T03:00:00Z",localDate:"2026-10-08",timezone:"Asia/Ho_Chi_Minh"},currentTurn:0,turns:[{role:"USER",text:"Đổi sang 9h."}],activeRequest:null,facts:[],pendingQuestion:null,ambiguities:[],capabilities:{version:"v1",supported:["ONCE"],unsupported:["WEEKLY","MONTHLY","YEARLY"],calendars:["GREGORIAN"],limits:{dailyCount:30,horizonDays:366}}});
  const correction = frozenContextProposal(input, "R07", 3);
  expect(correction).toMatchObject({ schemaVersion: "calenote-context-3", requestTarget: { kind: "CURRENT" },
    changes: [{ field: "reminderTime", operation: "REPLACE" }], conversationDirective: null });
  expect(correction).not.toHaveProperty("dialogueAct");
  const encoded = encodeFixtureV3(correction);
  // Production restores all indexed changes before materializing USER pointers.
  // Pre-materializing ordinary wire changes cannot reach a singleton carrier.
  expect(decodeGoogleLiteEuContextTransportV3(encoded, CONTEXT_PROTOCOL_V3, undefined, undefined, input), JSON.stringify(encoded)).toMatchObject({ status: "PARSED", value: { semantic: { changes: (correction as {changes:unknown[]}).changes } } });
});

it.each(["directive", "reply"])("production observable service retains valid core and backend fallback for bad %s", async section => {
  const cfg = { protocol: CONTEXT_PROTOCOL_V3, maxInputChars: 1800, maxInputTokens: 12000, maxOutputTokens: 1536, maxResponseBytes: 32768, timeoutMs: 30000,
    primary: { model: "google/gemini-2.5-flash-lite", provider: "google-vertex/eu", requireZdr: true, promptPriceMicrounitsPerMillionTokens: 100000, completionPriceMicrounitsPerMillionTokens: 400000 } };
  const gateway = createContextContractGateway(cfg, async request => {
    const input = JSON.parse(request.messages[1].content), proposal = encodeFixtureV3(frozenContextProposal(input, "R14", 0)) as object;
    return { status: 200, body: JSON.stringify({ model: request.model, provider: "Google", usage: { cost: .001, prompt_tokens: 100, completion_tokens: 100 },
      choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ ...proposal,
        ...(section === "directive" ? { conversationDirective: { kind: "SAVE" } } : { replyProposal: { text: "x".repeat(401) } }) }) } }] }) };
  }, { status: "OBSERVABLE_CANARY", advertisedContextTokens: 1048576 });
  const probe = await createContextContractProbe({ sourceSha: "a".repeat(40), referenceNow: Date.parse("2026-09-28T03:00:00Z"), liveGateway: gateway },
    () => { throw new Error("NO_OFFLINE_SUBSTITUTION"); });
  try {
    const result = await probe.turn("Mai 8h nhắc gọi mẹ ở nhà, ghi chú hỏi thăm sức khỏe.", "2026-09-28T03:00:00Z");
    expect(result).toMatchObject({ status: "DRAFT_CREATED", source: "BACKEND", actualDispatches: 1, mutations: 0, fullSchemaValid: false,
      fields: { title: "gọi mẹ" } });
  } finally { probe.dispose(); }
});

it("live probe uses the production callable gateway and financial reservation without fixture substitution", async () => {
  let calls = 0;
  const cfg = { protocol: CONTEXT_PROTOCOL_V3, maxInputChars: 1800, maxInputTokens: 12000, maxOutputTokens: 1536, maxResponseBytes: 32768, timeoutMs: 30000,
    primary: { model: "google/gemini-2.5-flash-lite", provider: "google-vertex/eu", requireZdr: true, promptPriceMicrounitsPerMillionTokens: 100000, completionPriceMicrounitsPerMillionTokens: 400000 } };
  const gateway = createContextContractGateway(cfg, async request => {
    calls++; const input = JSON.parse(request.messages[1].content);
    return { status: 200, body: JSON.stringify({ model: request.model, provider: "Google", id: "gen-offline-test",
      choices: [{ finish_reason: "stop", message: { content: JSON.stringify(encodeFixtureV3(frozenContextProposal(input, "R14", 0))) } }],
      usage: { cost: .001, prompt_tokens: 1000, completion_tokens: 300 } }) };
  }, { status: "OBSERVABLE_CANARY", advertisedContextTokens: 1048576 });
  const probe = await createContextContractProbe({ sourceSha: "a".repeat(40), referenceNow: Date.parse("2026-09-28T03:00:00Z"), liveGateway: gateway }, () => { throw new Error("LIVE_USED_OFFLINE_PROPOSAL"); });
  try {
    const draft = await probe.turn("Mai 8h nhắc gọi mẹ ở nhà, ghi chú hỏi thăm sức khỏe.", "2026-09-28T03:00:00Z");
    expect(draft).toMatchObject({ status: "DRAFT_CREATED", actualDispatches: 1, mutations: 0, fullSchemaValid: true });
    expect(probe.events.find(e => e.event === "BUDGET_RESERVED")).toMatchObject({ maximumCostMicrounits: 105472 });
    expect(probe.events.find(e => e.event === "REQUEST_DISPATCHED")).toMatchObject({ mode: "LIVE" });
    const confirmed = await probe.turn(`Xác nhận ${probe.issuedControlToken()}`, "2026-09-28T03:01:00Z");
    expect(confirmed).toMatchObject({ status: "CONFIRMED", dispatches: 0, mutations: 1, childCount: 1 });
    expect(confirmed.canonicalReminders?.[0]).toMatchObject({ location: "ở nhà", notes: "hỏi thăm sức khỏe" });
    expect(calls).toBe(1);
  } finally { probe.dispose(); }
});
import regressions from "../../src/modules/conversation/context-contract/benchmark/regressions.json";
import development from "../../src/modules/conversation/context-contract/benchmark/development.json";
import heldout from "../../src/modules/conversation/context-contract/benchmark/heldout.json";
import lunarReference from "../calendar/reference-vectors.json";
import { lunarCalendar } from "../../src/modules/conversation/lunar-calendar";
import { calendarDayPresentation } from "../../src/modules/conversation/calendar-presentation";

it.each(["R15", "D01", "D02", "D07"])("frozen %s authority oracle survives selected V3 service", async id => {
  const corpus = { version: "context-contract-corpus-1", cases: [...regressions.cases, ...development.cases].filter(c => c.id === id) } as ContextManifest;
  const planned = expandContextCampaign(corpus, "FULL", []);
  const observed = await runContextFixtureCampaign(planned, { sourceSha: "a".repeat(40), referenceNow: Date.parse("2026-09-28T03:00:00Z") }, frozenContextProposal);
  expect(scoreContextCampaign(planned, observed), JSON.stringify({ planned, observed })).toMatchObject({ passedScripts: 1, failedMandatory: [], passedTurns: planned[0].turns.length });
});

it("role-grounded R04 never copies the event clock before each explicit notification-clock turn", async () => {
  const script = regressions.cases.find(c => c.id === "R04")!;
  const observed = await runContextFixtureCampaign(expandContextCampaign({ version: "context-contract-corpus-1", cases: [script] } as ContextManifest, "FULL", []), { sourceSha: "a".repeat(40), referenceNow: Date.parse(script.turns[0].receipt) }, frozenContextProposal);
  for (const text of ["Nhắc một lần trước ngày thi 2 ngày.", "Nhắc 2 ngày liên tiếp trước ngày thi."]) {
    const index = script.turns.findIndex(t => t.text === text);
    expect(observed[0].turns[index]).toMatchObject({ status: "CLARIFICATION_REQUESTED", mutations: 0, apiPreviews: 0,
      fields: { eventTime: { hour: 8, minute: 0, qualifier: "H24" }, reminderTime: null }, occurrences: [], pendingField: "reminderTime" });
  }
  const clocks = script.turns.flatMap((t, i) => t.text === "Nhắc tôi lúc 8h sáng." ? [observed[0].turns[i]] : []);
  expect(clocks).toHaveLength(2);
  expect(clocks[0]).toMatchObject({ status: "DRAFT_CREATED", occurrences: ["2026-10-09 08:00"], contextRevision: 3, draftRevision: 3 });
  expect(clocks[1]).toMatchObject({ status: "DRAFT_CREATED", occurrences: ["2026-10-09 08:00", "2026-10-10 08:00"], contextRevision: 3, draftRevision: 3 });
});

it("role-grounded D06 collects notification clock before genuine issued-token edit and retains event clock", async () => {
  const script = development.cases.find(c => c.id === "D06")!;
  const observed = await runContextFixtureCampaign(expandContextCampaign({ version: "context-contract-corpus-1", cases: [script] } as ContextManifest, "FULL", []), { sourceSha: "a".repeat(40), referenceNow: Date.parse(script.turns[0].receipt) }, frozenContextProposal);
  expect(observed[0].turns[0]).toMatchObject({ status: "CLARIFICATION_REQUESTED", apiPreviews: 0, occurrences: [],
    fields: { eventTime: { hour: 8, minute: 0, qualifier: "H24" }, reminderTime: null } });
  expect(observed[0].turns[1]).toMatchObject({ status: "DRAFT_CREATED", contextRevision: 2, draftRevision: 2, occurrences: ["2026-10-09 08:00"] });
  expect(observed[0].turns[2]).toMatchObject({ status: "DRAFT_CREATED", mutations: 0, apiPreviews: 1, contextRevision: 3, draftRevision: 3,
    fields: { eventTime: { hour: 8, minute: 0, qualifier: "H24" }, reminderTime: { hour: 9, minute: 0, qualifier: "H24" } },
    occurrences: ["2026-10-09 09:00"], previewFields: { eventTime: "08:00" }, assertions: { issuedControlSubstituted: true, controlRedacted: true } });
});

it("role-grounded H29 retains event date without inventing notification date", async () => {
  const script = heldout.cases.find(c => c.id === "H29")!;
  const observed = await runContextFixtureCampaign(expandContextCampaign({ version: "context-contract-corpus-1", cases: [script] } as ContextManifest, "FULL", []), { sourceSha: "a".repeat(40), referenceNow: Date.parse(script.turns[0].receipt) }, frozenContextProposal);
  expect(observed[0].turns[0], JSON.stringify(observed[0].turns[0])).toMatchObject({ status: "CLARIFICATION_REQUESTED", mutations: 0, apiPreviews: 0, occurrences: [],
    fields: { eventDate: { kind: "CIVIL_DATE", calendar: "GREGORIAN", day: 21, month: 10, year: null, leapMonth: null }, reminderDate: null, reminderTime: null } });
});

it("ordinary five-turn D02 closure retains complete evidence with at least 1KiB fit headroom", async () => {
  let index = 0;
  const script = development.cases.find(c => c.id === "D02")!;
  const lunar = { kind: "CIVIL_DATE", calendar: "LUNAR_VN", day: 15, month: 6, year: 2027, leapMonth: false };
  const probe = await createContextContractProbe({ sourceSha: "a".repeat(40), referenceNow: Date.parse(script.turns[0].receipt) }, input => {
    const proposed = frozenContextProposal(input, "D02", index) as Record<string, unknown>;
    if (index === 4) {

      proposed.changes = (proposed.changes as Array<{ field: string }>).filter(c => c.field !== "reminderDate");
      (proposed.changes as unknown[]).push({ field: "reminderDate", operation: "SET", value: lunar,
        evidence: [{ kind: "USER_QUOTE", turn: input.currentTurn, quote: input.turns[input.currentTurn].text, occurrence: 1 }] });
      proposed.conversationDirective = null;
    }
    return proposed;
  });
  try {
    for (; index < 4; index++) await probe.turn(script.turns[index].text, script.turns[index].receipt);
    const actual = await probe.turn("Năm 2027 lúc 8h, nhắc đúng ngày 15/6 âm lịch.", script.turns[4].receipt);
    expect(actual.status).toBe("DRAFT_CREATED");
    expect(actual.snapshotEncodedBytes).toBeLessThanOrEqual(15360);
    expect(actual).toMatchObject({ mutations: 0, apiPreviews: 1, fields: { title: "ngày giỗ người thân", eventDate: lunar, reminderDate: lunar, reminderTime: { hour: 8, minute: 0, qualifier: "H24" } } });
  } finally { probe.dispose(); }
});

it("frozen D02 closes to preview and D06 substitutes a real issued control in the scored campaign", async () => {
  const cases = development.cases.filter(c => ["D02", "D06"].includes(c.id));
  const planned = expandContextCampaign({ version: "context-contract-corpus-1", cases } as ContextManifest, "FULL", []);
  const observed = await runContextFixtureCampaign(planned, { sourceSha: "a".repeat(40), referenceNow: Date.parse("2026-09-28T03:00:00Z") }, frozenContextProposal);
  expect(observed[0].turns.at(-1)).toMatchObject({ status: "DRAFT_CREATED", apiPreviews: 1 });
  expect(observed[1].turns.at(-1)?.assertions?.issuedControlSubstituted).toBe(true);
});

it("confirmed finite series commits exactly two complete children once and replay cannot write or send", async () => {
  let index = 0;
  const script = regressions.cases.find(c => c.id === "R07")!;
  const probe = await createContextContractProbe({ sourceSha: "a".repeat(40), referenceNow: Date.parse(script.turns[0].receipt) }, input => frozenContextProposal(input, "R07", index));
  try {
    for (; index < script.turns.length; index++) await probe.turn(script.turns[index].text, script.turns[index].receipt);
    const confirmed = await probe.turn(`Xác nhận ${probe.issuedControlToken()}`, "2026-09-28T03:04:00Z");
    expect(confirmed).toMatchObject({ status: "CONFIRMED", dispatches: 0, mutations: 2, transactionCommits: 1, childCount: 2, sendAttempts: 1 });
    expect(confirmed.canonicalReminders).toEqual(["2026-10-09 09:00", "2026-10-10 09:00"].map(scheduled => ({
      title: "đi thi", scheduled, location: "Quang Trung", notes: "nhớ mang giấy tờ", eventDate: "2026-10-11", eventTime: null, calendar: "GREGORIAN" })));
    expect(await probe.replayLastInbound("2026-09-28T03:05:00Z")).toEqual({ status: "SUPERSEDED", dispatches: 0, mutations: 0, sendAttempts: 0, childCount: 2 });
  } finally { probe.dispose(); }
});

it.each([
  ["HELP", "HELP", { kind: "HELP", topic: "GENERAL" }, "Bạn có thể kể việc cần nhắc theo cách tự nhiên.", "MODEL_GUIDANCE"],
  ["EXPLAIN_UNSUPPORTED", "UNSUPPORTED", { kind: "EXPLAIN_UNSUPPORTED", issue: "ASSISTANT_SCOPE" }, "Bạn có thể chọn một yêu cầu về lịch hoặc lời nhắc.", "MODEL_GUIDANCE"],
] as const)("actual %s route selects eligible natural guidance and persists the exact receipt", async (effective, intent, directive, text, source) => {
  const probe = await createContextContractProbe({ sourceSha: "a".repeat(40), referenceNow: Date.parse("2026-09-28T03:00:00Z") }, () => ({
    schemaVersion: "calenote-context-3", intent, requestTarget: null, changes: [], query: null,
    uncertainties: [], conversationDirective: directive, replyProposal: { text },
  }));
  try {
    const actual = await probe.turn("Tôi có thể nhờ bạn những việc gì nhỉ?", "2026-09-28T03:00:00Z");
    expect(actual).toMatchObject({ dispatches: 1, mutations: 0, effectiveDirective: effective, source,
      coreValidity: "VALID", directiveValidity: "VALID", replyValidity: "VALID", directiveMatch: "MATCH", replyEligibility: "ELIGIBLE",
      assertions: { persistedSelectedText: true, completeLogicalRoundTrip: true, persistedDeliveryReceipt: true } });
    expect(actual.selectedText).toContain(text);
    if (intent === "UNSUPPORTED") expect(actual.selectedText).toContain("Yêu cầu này nằm ngoài phạm vi hiện tại.");
    await probe.turn("Tôi muốn biết thêm nhé.", "2026-09-28T03:01:00Z");
    expect(probe.inputs.at(-1)?.turns).toContainEqual({ role: "ASSISTANT", text: actual.selectedText });
  } finally { probe.dispose(); }
});

it.each([
  ["HELP topic", "HELP", { kind: "HELP", topic: "LUNAR" }],
  ["unsupported issue", "UNSUPPORTED", { kind: "EXPLAIN_UNSUPPORTED", issue: "CAPABILITY" }],
] as const)("actual typed %s mismatch cannot select model wording", async (_name, intent, directive) => {
  const probe = await createContextContractProbe({ sourceSha: "a".repeat(40), referenceNow: Date.parse("2026-09-28T03:00:00Z") }, () => ({
    schemaVersion: "calenote-context-3", intent, requestTarget: null, changes: [], query: null,
    uncertainties: [], conversationDirective: directive, replyProposal: { text: "Bạn có thể diễn đạt tự nhiên nhé." },
  }));
  try {
    expect(await probe.turn("Tôi có thể nhờ bạn những việc gì nhỉ?", "2026-09-28T03:00:00Z")).toMatchObject({
      dispatches: 1, mutations: 0, source: "BACKEND", directiveMatch: "DIRECTIVE_MISMATCH" });
  } finally { probe.dispose(); }
});

it.each([
  ["invalid directive with valid core", { conversationDirective: { kind: "SAVE" } }, "VALID", "INVALID", "DIRECTIVE_INVALID"],
  ["known owner", { replyProposal: { text: "Xin hãy hỏi owner giúp mình nhé." } }, "VALID", "VALID", "REPLY_FORBIDDEN"],
  ["known inbound", { replyProposal: { text: "Bạn hãy xem probe-claim-1 nhé." } }, "VALID", "VALID", "REPLY_FORBIDDEN"],
  ["escaped token", { replyProposal: { text: "Bạn xem %43%4e%2dToken nhé." } }, "VALID", "VALID", "REPLY_FORBIDDEN"],
  ["escaped action URL", { replyProposal: { text: "Bạn xem https%3A%2F%2Fexample.test nhé." } }, "VALID", "VALID", "REPLY_FORBIDDEN"],
  ["Unicode completion", { replyProposal: { text: "Đa\u0303 lu\u031bu lịch thành công." } }, "VALID", "VALID", "REPLY_INVALID"],
  ["transaction paraphrase", { replyProposal: { text: "Lời nhắc của bạn được tạo thành công rồi." } }, "VALID", "VALID", "REPLY_FORBIDDEN"],
] as const)("actual %s refuses wording while retaining grounded facts", async (_name, override, core, directive, eligibility) => {
  const probe = await createContextContractProbe({ sourceSha: "a".repeat(40), referenceNow: Date.parse("2026-09-28T03:00:00Z") }, input =>
    ({ ...(frozenContextProposal(input, "D09", 0) as Record<string, unknown>), ...override }));
  try {
    const actual = await probe.turn("Ngày 11/10 đi thi ở Quang Trung, nhắc hai ngày trước hôm thi.", "2026-09-28T03:00:00Z");
    expect(actual).toMatchObject({ dispatches: 1, mutations: 0, source: "BACKEND", fields: { title: "đi thi", location: "Quang Trung" },
      coreValidity: core, directiveValidity: directive, replyEligibility: eligibility,
      assertions: { persistedSelectedText: true, persistedDeliveryReceipt: true, completeLogicalRoundTrip: true } });
    expect(actual.selectedText).toContain("Bạn muốn được nhắc lúc mấy giờ?");
    expect(actual.selectedText).toContain("Ngày sự kiện: 11/10 (chưa có năm), dương lịch");
    await probe.turn("Tôi sẽ nói sau nhé.", "2026-09-28T03:01:00Z");
    expect(probe.inputs.at(-1)?.turns).toContainEqual({ role: "ASSISTANT", text: actual.selectedText });
  } finally { probe.dispose(); }
});

it("invalid core cannot be rescued by persuasive eligible guidance", async () => {
  const probe = await createContextContractProbe({ sourceSha: "a".repeat(40), referenceNow: Date.parse("2026-09-28T03:00:00Z") }, input => ({
    ...(frozenContextProposal(input, "D09", 0) as Record<string, unknown>), intent: "SAVE_REMINDER", replyProposal: { text: "Bạn muốn mình nhắc lúc mấy giờ?" },
  }));
  try {
    const actual = await probe.turn("Ngày 11/10 đi thi ở Quang Trung.", "2026-09-28T03:00:00Z");
    expect(actual).toMatchObject({ status: "REJECTED", source: "BACKEND", dispatches: 1, mutations: 0, apiPreviews: 0 });
    expect(Object.values(actual.fields).every(value => value === null)).toBe(true);
    expect(actual.selectedText).not.toContain("Bạn muốn mình nhắc");
  } finally { probe.dispose(); }
});

it.each(["SENT", "FAILED", "UNCERTAIN"] as const)("actual %s model clarification preserves encrypted outbound receipt and source/view mapping", async delivery => {
  const probe = await createContextContractProbe({ sourceSha: "a".repeat(40), referenceNow: Date.parse("2026-09-28T03:00:00Z") }, input => frozenContextProposal(input, "D09", 0));
  try {
    const actual = await probe.turn("Ngày 11/10 đi thi ở Quang Trung, nhắc hai ngày trước hôm thi. e\u0301😀", "2026-09-28T03:00:00Z", delivery === "SENT" ? undefined : delivery);
    const snapshot = probe.snapshot()!;
    expect(snapshot.transcript[0].text).toContain("e\u0301😀");
    expect(snapshot.transcript[0].semanticView).toContain("é😀");
    expect(snapshot.pendingReminderQuestion?.deliveryState).toBe(delivery);
    expect(actual.assertions).toMatchObject({ persistedSelectedText: true, completeLogicalRoundTrip: true, persistedDeliveryReceipt: true });
    expect(snapshot.transcript.at(-1)?.messageRef).toBe(delivery === "SENT" ? "synthetic-receipt-1" : null);
  } finally { probe.dispose(); }
});

const manifest: ContextManifest = { version: "context-contract-corpus-1", cases: [
  { id: "R01", group: "ORIGINAL", mandatory: true, turns: [{ text: "Có lịch nào ko?", receipt: "2026-09-28T03:00:00.000Z", model: "HEALTHY", expect: { status: "CLARIFICATION_REQUESTED", dispatches: 1, mutations: 0, fields: {} } }] },
  { id: "R02", group: "ORIGINAL", mandatory: true, turns: [{ text: "Bỏ.", receipt: "2026-09-28T03:00:00.000Z", model: "BYPASS", expect: { status: "CANCELLED", dispatches: 0, mutations: 0, fields: {} } }] },
] };
const observation = (id: string, status: string): ContextObservation => ({ id, turns: [{ status, dispatches: 1, mutations: 0, fields: {}, fullSchemaValid: true, rawSchemaValid: true, actualDispatches: 1, assertions: {} }] });

it("standalone probe resolves with the documented conversation loader", () => {
  const result = spawnSync(process.execPath, ["--experimental-strip-types", "--import", "./tools/benchmark/register-conversation-loader.mjs",
    "--input-type=module", "-e", "import './tools/benchmark/context-contract-probe.ts'; console.log('PROBE_IMPORTED')"],
  { cwd: process.cwd(), encoding: "utf8", env: { PATH: process.env.PATH ?? "" } as unknown as NodeJS.ProcessEnv });
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toContain("PROBE_IMPORTED");
});

describe("context campaign scoring", () => {
  it("all planned assertions and healthy calls remain in denominator when observations are missing", () => {
    const planned = expandContextCampaign(manifest, "PILOT", ["R02"]);
    const scored = scoreContextCampaign(planned, [observation("R01", "CLARIFICATION_REQUESTED")]);
    expect(scored).toMatchObject({ plannedScripts: 4, passedScripts: 1, plannedTurns: 4, passedTurns: 1,
      healthyPlanned: 1, healthyFullSchemaValid: 1, actualDispatches: 1, rawValid: 1 });
    expect(scored.missingScripts).toEqual(["R02", "R02#2", "R02#3"]);
    expect(scored.gate).toBe("FAIL");
  });
  it("rejects setup exceeding six actual user turns and missing branch reset", () => {
    expect(() => admitContextManifest({ version: manifest.version, cases: [{ ...manifest.cases[0], turns: Array(7).fill(manifest.cases[0].turns[0]) }] })).toThrow(/USER_TURN_LIMIT/u);
    expect(() => admitContextManifest({ version: manifest.version, cases: [{ ...manifest.cases[0], id: "R04", turns: [{ ...manifest.cases[0].turns[0], branch: "A" }, { ...manifest.cases[0].turns[0], branch: "B" }] }] })).toThrow(/RESET_REQUIRED/u);
  });
  it("selected false save claim is a safety failure even when mutation count is zero", () => {
    const planned = expandContextCampaign({ ...manifest, cases: [manifest.cases[0]] }, "PILOT", []);
    const result = scoreContextCampaign(planned, [{ ...observation("R01", "CLARIFICATION_REQUESTED"), turns: [{ ...observation("R01", "CLARIFICATION_REQUESTED").turns[0], selectedText: "Đã lưu lịch cho bạn." }] }]);
    expect(result.safetyFailures).toBe(1);
    expect(result.gate).toBe("FAIL");
  });
  it("valid core with invalid full wire schema never passes a healthy script", () => {
    const planned = expandContextCampaign({ ...manifest, cases: [manifest.cases[0]] }, "PILOT", []);
    const actual = observation("R01", "CLARIFICATION_REQUESTED");
    actual.turns[0].fullSchemaValid = false;
    const result = scoreContextCampaign(planned, [actual]);
    expect(result.passedScripts).toBe(0);
    expect(result.healthyFullSchemaValid).toBe(0);
  });
});

it("unexpected pre-confirmation insert is categorical safety failure despite full aggregate tolerance", () => {
  const corpus = { version: "context-contract-corpus-1", cases: [...regressions.cases, ...development.cases, ...heldout.cases] } as ContextManifest;
  const planned = expandContextCampaign(corpus, "FULL");
  const observed: ContextObservation[] = planned.map(script => ({ id: script.executionId,
    actions: script.turns.flatMap(turn => (turn.actionsAfter ?? []).map(action => ({ ...action.expect }))),
    turns: script.turns.map(turn => ({
    ...turn.expect, fields: { ...turn.expect.fields }, detailFields: { ...turn.expect.detailFields },
    selectedText: (turn.expect.replyIncludes ?? []).join(" "), fullSchemaValid: turn.model === "HEALTHY",
    rawSchemaValid: turn.model === "HEALTHY", actualDispatches: turn.expect.dispatches, assertions: {}, safetyFailures: 0,
  })) }));
  expect(scoreContextCampaign(planned, observed).gate).toBe("PASS");
  observed.find(script => script.id === "H01")!.turns[0].mutations = 1;
  const scored = scoreContextCampaign(planned, observed);
  expect(scored.safetyFailures).toBe(1);
  expect(scored.gate).toBe("FAIL");
});

it("duplicate canonical child write is safety, independent of mandatory outcome failure", () => {
  const planned = expandContextCampaign({ version: manifest.version, cases: [{ ...manifest.cases[0], turns: [{ ...manifest.cases[0].turns[0], expect: { ...manifest.cases[0].turns[0].expect, mutations: 2 } }] }] }, "PILOT", []);
  const actual = observation("R01", "CLARIFICATION_REQUESTED");
  actual.turns[0].mutations = 3;
  expect(scoreContextCampaign(planned, [actual]).safetyFailures).toBe(1);
});

it.each(["childCount", "transactionCommits"] as const)("unexpected %s fails categorical safety independently of row delta", key => {
  const script = { ...manifest.cases[0], turns: [{ ...manifest.cases[0].turns[0], expect: { ...manifest.cases[0].turns[0].expect, [key]: 0 } }] };
  const planned = expandContextCampaign({ ...manifest, cases: [script] }, "PILOT", []);
  const actual = observation("R01", "CLARIFICATION_REQUESTED");
  actual.turns[0][key] = 1;
  expect(scoreContextCampaign(planned, [actual])).toMatchObject({ safetyFailures: 1, gate: "FAIL" });
});

it("canonical admission refuses sparse title-only factual oracles", async () => {
  const { admitCanonicalCampaign } = await import("./context-contract");
  const corpus = structuredClone({ version: "context-contract-corpus-1", cases: [...regressions.cases, ...development.cases, ...heldout.cases] }) as ContextManifest;
  corpus.cases.find(c => c.id === "D15")!.turns[0].expect.fields = { title: "đi họp" };
  expect(() => admitCanonicalCampaign(corpus, "FULL")).toThrow("INCOMPLETE_FACTUAL_ORACLE");
});

it("frozen occurrence and retained-state assertions cannot be masked by a correct title", () => {
  const turn = { ...manifest.cases[0].turns[0], expect: { ...manifest.cases[0].turns[0].expect,
    occurrences: ["2026-09-30 09:00"], pendingField: "reminderTime", contextRevision: 2 } };
  const planned = expandContextCampaign({ ...manifest, cases: [{ ...manifest.cases[0], turns: [turn] }] }, "PILOT", []);
  const actual = observation("R01", "CLARIFICATION_REQUESTED");
  actual.turns[0] = { ...actual.turns[0], occurrences: ["2026-10-30 09:00"], pendingField: "reminderTime", contextRevision: 2 };
  expect(scoreContextCampaign(planned, [actual])).toMatchObject({ passedScripts: 0, detailPassed: 2, detailPlanned: 3 });
});

it("declared non-USER replay is a planned scored denominator and missing evidence fails", () => {
  const planned = expandContextCampaign({ ...manifest, cases: [{ ...manifest.cases[0], turns: [{ ...manifest.cases[0].turns[0], actionsAfter: [
    { kind: "REPLAY_LAST", at: "2026-09-28T03:01:00Z", expect: { status: "SUPERSEDED", dispatches: 0, mutations: 0, sendAttempts: 0, childCount: 0 } },
  ] }] }] }, "PILOT", []);
  const absent = scoreContextCampaign(planned, [observation("R01", "CLARIFICATION_REQUESTED")]);
  expect(absent).toMatchObject({ plannedActions: 1, passedActions: 0, passedScripts: 0 });
  const present = scoreContextCampaign(planned, [{ ...observation("R01", "CLARIFICATION_REQUESTED"), actions: [
    { status: "SUPERSEDED", dispatches: 0, mutations: 0, sendAttempts: 0, childCount: 0 },
  ] }]);
  expect(present).toMatchObject({ plannedActions: 1, passedActions: 1, passedScripts: 1 });
});

it("a replay sending an extra transactional reply fails zero-safety even without a reminder write", () => {
  const planned = expandContextCampaign({ ...manifest, cases: [{ ...manifest.cases[0], turns: [{ ...manifest.cases[0].turns[0], actionsAfter: [
    { kind: "REPLAY_LAST", at: "2026-09-28T03:01:00Z", expect: { status: "SUPERSEDED", dispatches: 0, mutations: 0, sendAttempts: 0, childCount: 0 } },
  ] }] }] }, "PILOT", []);
  const observed = { ...observation("R01", "CLARIFICATION_REQUESTED"), actions: [
    { status: "SUPERSEDED", dispatches: 0, mutations: 0, sendAttempts: 1, childCount: 0 },
  ] };
  expect(scoreContextCampaign(planned, [observed])).toMatchObject({ safetyFailures: 1, gate: "FAIL" });
});

it.each(["reason", "field"] as const)("actual disambiguation %s mismatch preserves progressive facts and backend question", async dimension => {
  let index = 0;
  const script = development.cases.find(c => c.id === "D10")!;
  const probe = await createContextContractProbe({ sourceSha: "a".repeat(40), referenceNow: Date.parse(script.turns[0].receipt) }, input => {
    const proposed = frozenContextProposal(input, "D10", index) as Record<string, unknown>;
    if (index === 1) proposed.conversationDirective = { kind: "ASK_FOR_DISAMBIGUATION", field: dimension === "field" ? "frequency" : "occurrenceCount", reason: dimension === "reason" ? "CONFLICT" : "AMBIGUOUS" };
    return proposed;
  });
  try {
    await probe.turn(script.turns[0].text, script.turns[0].receipt); index = 1;
    expect(await probe.turn(script.turns[1].text, script.turns[1].receipt)).toMatchObject({ dispatches: 1, mutations: 0, source: "BACKEND",
      effectiveDirective: "ASK_FOR_DISAMBIGUATION", directiveMatch: "DIRECTIVE_MISMATCH", fields: { title: "đi thi", location: "Quang Trung", occurrenceCount: null } });
  } finally { probe.dispose(); }
});

it("actual query-kind mismatch never replaces the backend Calendar answer", async () => {
  const probe = await createContextContractProbe({ sourceSha: "a".repeat(40), referenceNow: Date.parse("2026-09-28T03:00:00Z") }, input => ({
    ...(frozenContextProposal(input, "R09", 0) as Record<string, unknown>), conversationDirective: { kind: "HELP", topic: "REMINDERS" }, replyProposal: { text: "Bạn xem lịch nhé." },
  }));
  try {
    const actual = await probe.turn("Hôm nay là ngày mấy âm lịch?", "2026-09-28T03:00:00Z");
    expect(actual).toMatchObject({ dispatches: 1, mutations: 0, source: "BACKEND", effectiveDirective: "ANSWER_QUERY", directiveMatch: "DIRECTIVE_MISMATCH" });
    expect(actual.selectedText).toContain("18/8/2026");
    expect(actual.selectedText).not.toContain("Bạn xem lịch nhé.");
  } finally { probe.dispose(); }
});

it("probe records the actual selected reply, encrypted state and dispatched count", async () => {
  const probe = await createContextContractProbe({ sourceSha: "a".repeat(40), referenceNow: Date.parse("2026-09-28T03:00:00Z") }, input => ({
    schemaVersion: "calenote-context-3", intent: "CREATE_REMINDER", requestTarget: { kind: "NEW", evidence: [{ kind: "USER_QUOTE", turn: input.currentTurn, quote: input.turns[input.currentTurn].text, occurrence: 1 }] },
    changes: [{ field: "title", operation: "SET", value: "đi thi", evidence: [{ kind: "USER_QUOTE", turn: input.currentTurn, quote: input.turns[input.currentTurn].text, occurrence: 1 }] }],
    query: null, uncertainties: [], conversationDirective: { kind: "ASK_FOR_FIELD", field: "reminderTime" },
    replyProposal: { text: "Bạn muốn mình nhắc lúc mấy giờ?" },
  }));
  try {
    const actual = await probe.turn("Nhắc tôi đi thi.", "2026-09-28T03:00:00Z");
    expect(actual.status).toBe("CLARIFICATION_REQUESTED");
    expect(actual.dispatches).toBe(1);
    expect(actual.mutations).toBe(0);
    expect(actual.fields.title, JSON.stringify(actual)).toBe("đi thi");
    expect(actual.selectedText).toContain("nhắc lúc mấy giờ");
    expect(actual.source).toBe("MODEL_GUIDANCE");
    expect(actual.delivery).toBe("SENT");
  } finally { probe.dispose(); }
});

it("probe reads scheduled occurrences, revisions, expiry, and child/transaction counts from the actual service", async () => {
  const probe = await createContextContractProbe({ sourceSha: "a".repeat(40), referenceNow: Date.parse("2026-09-28T03:00:00Z") },
    input => frozenContextProposal(input, "D15", 0));
  try {
    const actual = await probe.turn("Hẹn nhắc đi họp lúc 9 giờ sáng 30/9.", "2026-09-28T03:00:00Z");
    expect(actual.occurrences).toEqual(["2026-09-30 09:00"]);
    expect(actual.pendingField).toBeNull();
    expect(actual.contextRevision).toBe(1);
    expect(actual.draftRevision).toBe(1);
    expect(actual.absoluteExpiresAt).toBe("2026-09-28T05:00:00.000Z");
    expect(actual.childCount).toBe(0);
    expect(actual.transactionCommits).toBe(0);
    expect(actual.sendAttempts).toBe(1);
  } finally { probe.dispose(); }
});

it("receipt time stays authoritative across delayed processing and same-inbound replay", async () => {
  const probe = await createContextContractProbe({ sourceSha: "a".repeat(40), referenceNow: Date.parse("2026-09-28T16:59:00Z") },
    input => frozenContextProposal(input, "R12", 0));
  try {
    const actual = await probe.turn("Mai 8h nhắc gọi mẹ", "2026-09-28T16:59:00Z", undefined, "2026-09-28T17:01:00Z");
    expect(actual.occurrences).toEqual(["2026-09-29 08:00"]);
    expect(probe.inputs[0].reference.localDate).toBe("2026-09-28");
    const replay = await probe.replayLastInbound("2026-09-28T17:02:00Z");
    expect(replay).toMatchObject({ status: "SUPERSEDED", dispatches: 0, mutations: 0, sendAttempts: 0, childCount: 0 });
  } finally { probe.dispose(); }
});

it("R14 same-key confirmation replay does not dispatch or duplicate a committed child", async () => {
  let turn = 0;
  const probe = await createContextContractProbe({ sourceSha: "a".repeat(40), referenceNow: Date.parse("2026-09-28T03:00:00Z") },
    input => frozenContextProposal(input, "R14", turn));
  try {
    const original = regressions.cases.find(c => c.id === "R14")!;
    const preview = await probe.turn(original.turns[0].text, original.turns[0].receipt);
    expect(preview.status).toBe("DRAFT_CREATED");
    turn = 1;
    const confirmed = await probe.turn(original.turns[1].text, original.turns[1].receipt, "UNCERTAIN");
    expect(confirmed).toMatchObject({ status: "CONFIRMED", mutations: 1, childCount: 1, transactionCommits: 1, sendAttempts: 1, delivery: "UNCERTAIN" });
    const replay = await probe.replayLastInbound("2026-09-28T03:02:00Z");
    expect(replay).toMatchObject({ status: "SUPERSEDED", dispatches: 0, mutations: 0, childCount: 1, sendAttempts: 0 });
    const fresh = await probe.turn("Có.", "2026-09-28T03:03:00Z");
    expect(fresh).toMatchObject({ status: "CLARIFICATION_REQUESTED", dispatches: 0, mutations: 0, childCount: 1 });
    expect(fresh.selectedText).toContain("không còn khớp");
  } finally { probe.dispose(); }
});

it("R13 controlled older response loses after accepted abandon with no stale outbound", async () => {
  let turn = 0;
  const probe = await createContextContractProbe({ sourceSha: "a".repeat(40), referenceNow: Date.parse("2026-09-28T03:00:00Z") },
    input => frozenContextProposal(input, "R13", turn));
  try {
    expect((await probe.turn("Ngày 11/10 đi thi, nhắc tôi trước 2 ngày.", "2026-09-28T03:00:00Z")).status).toBe("CLARIFICATION_REQUESTED");
    turn = 1;
    const pending = await probe.beginDeferredTurn("8h.", "2026-09-28T03:01:00Z");
    turn = 2;
    const abandoned = await probe.turn("Bỏ.", "2026-09-28T03:02:00Z");
    expect(abandoned).toMatchObject({ status: "CANCELLED", dispatches: 0, mutations: 0 });
    const release = await probe.releaseDeferredTurn(pending);
    expect(release).toMatchObject({ status: "SUPERSEDED", dispatches: 0, mutations: 0, sendAttempts: 0, childCount: 0 });
  } finally { probe.dispose(); }
});

it("D06 issued token mixed with an edit remains an edit and is redacted in the next provider projection", async () => {
  let turn = 0;
  const probe = await createContextContractProbe({ sourceSha: "a".repeat(40), referenceNow: Date.parse("2026-09-28T03:00:00Z") },
    input => frozenContextProposal(input, "D06", turn));
  try {
    const script = development.cases.find(c => c.id === "D06")!;
    expect((await probe.turn(script.turns[0].text, script.turns[0].receipt)).status).toBe("CLARIFICATION_REQUESTED");
    turn = 1;
    expect((await probe.turn(script.turns[1].text, script.turns[1].receipt)).status).toBe("DRAFT_CREATED");
    const token = probe.issuedControlToken();
    expect(token).toMatch(/^CN-/u);
    turn = 2;
    const actual = await probe.turn(`Có ${token}, nhưng đổi sang 9h.`, script.turns[2].receipt);
    expect(actual).toMatchObject({ status: "DRAFT_CREATED", mutations: 0, dispatches: 1, occurrences: ["2026-10-09 09:00"], fields: { eventTime: { hour: 8, minute: 0, qualifier: "H24" } } });
    const projection = probe.inputs.at(-1)!.turns.at(-1)!.text;
    expect(projection).toContain("[CONTROL]");
    expect(projection).not.toContain(token);
    expect(actual.selectedText).not.toContain(token);
    expect(probe.snapshot()?.previewReceipt?.draftRevision).toBe(3);
    expect(probe.issuedControlToken()).not.toBe(token);
  } finally { probe.dispose(); }
});

it("runner resets R04 branches with a new actual service and keeps planned result IDs", async () => {
  const r04: ContextManifest = { version: "context-contract-corpus-1", cases: [{ id: "R04", group: "ORIGINAL", mandatory: true, turns: [
    { text: "Xin chào", receipt: "2026-09-28T03:00:00Z", model: "BYPASS", branch: "A", expect: { status: "CLARIFICATION_REQUESTED", dispatches: 0, mutations: 0, fields: {} } },
    { text: "Xin chào", receipt: "2026-09-28T03:01:00Z", model: "BYPASS", branch: "B", resetBefore: true, expect: { status: "CLARIFICATION_REQUESTED", dispatches: 0, mutations: 0, fields: {} } },
  ] }] };
  const observed = await runContextFixtureCampaign(expandContextCampaign(r04, "PILOT", []), { sourceSha: "a".repeat(40), referenceNow: Date.parse("2026-09-28T03:00:00Z") }, () => { throw new Error("BYPASS_DISPATCHED"); });
  expect(observed).toHaveLength(1);
  expect(observed[0].turns.map(t => t.dispatches)).toEqual([0, 0]);
  expect(observed[0].turns.map(t => t.mutations)).toEqual([0, 0]);
});

it.each([
  ["CO-B", { conversationDirective: { kind: "ASK_FOR_FIELD", field: "eventDate" }, replyProposal: { text: "Bạn thi ngày nào?" } }, "DIRECTIVE_MISMATCH"],
  ["CO-C", { conversationDirective: { kind: "HELP", topic: "REMINDERS" }, replyProposal: { text: "Mình đã lên lịch cho bạn." } }, "DIRECTIVE_MISMATCH"],
  ["CO-D", { conversationDirective: { kind: "ASK_FOR_FIELD", field: "reminderTime" }, replyProposal: { text: "Đã lưu lịch cho bạn." } }, "REPLY_FORBIDDEN"],
] as const)("%s selects backend guidance but preserves accepted facts", async (_id, override, reason) => {
  const probe = await createContextContractProbe({ sourceSha: "a".repeat(40), referenceNow: Date.parse("2026-09-28T03:00:00Z") }, input =>
    ({ ...(frozenContextProposal(input, "D09", 0) as Record<string, unknown>), ...override }));
  try {
    const actual = await probe.turn(development.cases.find(c => c.id === "D09")!.turns[0].text, "2026-09-28T03:00:00Z");
    expect(actual).toMatchObject({ status: "CLARIFICATION_REQUESTED", source: "BACKEND", mutations: 0, dispatches: 1,
      fields: { title: "đi thi", location: "Quang Trung" } });
    expect(actual.selectedText).not.toContain("Đã lưu");
    expect(probe.events).toContainEqual(expect.objectContaining({ event: "REPLY_ELIGIBILITY_EVALUATED", result: reason }));
  } finally { probe.dispose(); }
});

it.each(["null", "absent", "blank", "overlong", "unknown-key"] as const)("%s reply section cannot replace the actual backend question", async fault => {
  const probe = await createContextContractProbe({ sourceSha: "a".repeat(40), referenceNow: Date.parse("2026-09-28T03:00:00Z") }, input => {
    const proposed: Record<string, unknown> = {
    ...(frozenContextProposal(input, "D09", 0) as Record<string, unknown>),
    replyProposal: fault === "null" ? null : fault === "blank" ? { text: "" } : fault === "overlong" ? { text: "a".repeat(401) } : { text: "Bạn muốn nhắc lúc mấy giờ?", extra: true },
    }; if (fault === "absent") delete proposed.replyProposal; return proposed;
  });
  try {
    const actual = await probe.turn(development.cases.find(c => c.id === "D09")!.turns[0].text, "2026-09-28T03:00:00Z");
    expect(actual).toMatchObject({ status: "CLARIFICATION_REQUESTED", source: "BACKEND", mutations: 0, dispatches: 1, fullSchemaValid: fault === "null" });
    expect(actual.fields.title).toBe("đi thi");
  } finally { probe.dispose(); }
});

it.each(["malformed", "unsupported-field", "fabricated-evidence", "timeout", "budget"] as const)("R15 %s injection safely refuses without a fallback dispatch", async fault => {
  const probe = await createContextContractProbe({ sourceSha: "a".repeat(40), referenceNow: Date.parse("2026-09-28T03:00:00Z"), budgetRefusal: fault === "budget" }, input => {
    const base = frozenContextProposal(input, "D09", 0) as Record<string, unknown>;
    if (fault === "malformed") return {};
    if (fault === "timeout") return { fixtureFault: "TIMEOUT" };
    if (fault === "unsupported-field") return { ...base, changes: [{ field: "creditCard", operation: "SET", value: "x", evidence: [{ kind: "USER_QUOTE", turn: input.currentTurn, quote: input.turns[input.currentTurn].text, occurrence: 1 }] }] };
    if (fault === "fabricated-evidence") return { ...base, changes: [{ field: "title", operation: "SET", value: "đi thi", evidence: [{ kind: "USER_QUOTE", turn: input.currentTurn, quote: "không hề nói", occurrence: 1 }] }] };
    return base;
  });
  try {
    const actual = await probe.turn(development.cases.find(c => c.id === "D09")!.turns[0].text, "2026-09-28T03:00:00Z");
    expect(actual.status).toBe("REJECTED");
    expect(actual.mutations).toBe(0);
    expect(actual.dispatches).toBe(fault === "budget" ? 0 : 1);
    expect(actual.fields.title).not.toBe("đi thi");
    expect(actual.source).toBe("BACKEND");
  } finally { probe.dispose(); }
});

it("R16 checks 13 converter/Calendar vectors and their 12 nonnegative-time service cases", async () => {
  expect(lunarReference.vectors).toHaveLength(13);
  let serviceCases = 0;
  for (const vector of lunarReference.vectors) {
    const calendar = calendarDayPresentation(vector.solarDate);
    expect(calendar.fullLabel).toContain(`${vector.day}/${vector.month}/${vector.year}`);
    expect(lunarCalendar.toLunar(vector.solarDate)).toMatchObject({ day: vector.day, month: vector.month, year: vector.year, leap: vector.leap });
    if (vector.year < 1970) continue; // The production budget clock rejects negative Unix time.
    const receipt = `${vector.solarDate}T03:00:00Z`;
    const probe = await createContextContractProbe({ sourceSha: "a".repeat(40), referenceNow: Date.parse(receipt) }, input => frozenContextProposal(input, "R16", 0));
    try {
      const actual = await probe.turn("Hôm nay là ngày mấy âm lịch?", receipt);
      expect(actual.status).toBe("REMINDERS_LISTED");
      expect(actual.selectedText).toContain(`${vector.day}/${vector.month}/${vector.year}`);
      expect(actual.selectedText).toContain(vector.solarDate);
      expect(actual.dispatches).toBe(1);
      expect(actual.mutations).toBe(0);
      serviceCases++;
    } finally { probe.dispose(); }
  }
  expect(serviceCases).toBe(12);
  expect(calendarDayPresentation("1900-01-30").lunarAvailable).toBe(false);
  expect(calendarDayPresentation("2101-01-29").lunarAvailable).toBe(false);
});

it("whole_service_I1_I10_authority_controls: all frozen Layer1 scripts execute through actual service", async () => {
  const corpus = { version: "context-contract-corpus-1", cases: [...regressions.cases, ...development.cases, ...heldout.cases] } as ContextManifest;
  const planned = expandContextCampaign(corpus, "FULL");
  expect(planned).toHaveLength(80);
  expect(validateContextFixtureCoverage(planned)).toEqual({ scripts: 64, plannedExecutions: 80, plannedTurns: 158 });
  const observed = await runContextFixtureCampaign(planned, { sourceSha: "a".repeat(40), referenceNow: Date.parse("2026-09-28T03:00:00Z") }, frozenContextProposal);
  expect(observed).toHaveLength(80);
  const scored = scoreContextCampaign(planned, observed);
  expect(scored.plannedTurns).toBe(158);
  expect(scored.missingScripts).toEqual([]);
  expect(scored.failedMandatory, JSON.stringify(scored.failedMandatory.map(id => ({ id,
    expected: planned.find(p => p.executionId === id)?.turns.map(t => t.expect), actual: observed.find(o => o.id === id)?.turns.map(t => ({ status: t.status, dispatches: t.dispatches, fields: t.fields, source: t.source, kind: t.kind, decisionKind: t.decisionKind, text: t.selectedText, assertions: t.assertions })) })))).toEqual([]);
  expect(scored, JSON.stringify(scored.failedScripts.map(id => ({ id, expected: planned.find(p => p.executionId === id)?.turns.map(t => t.expect),
    actual: observed.find(o => o.id === id)?.turns.map(t => ({ status: t.status, fields: t.fields, kind: t.kind, text: t.selectedText })) })))).toMatchObject({ gate: "PASS", plannedScripts: 80, heldoutPassed: 32, safetyFailures: 0 });
  expect(scored.detailPlanned).toBeGreaterThan(100);
  expect(scored.detailPassed).toBe(scored.detailPlanned);
}, 120000);

it("canonical pilot repeats the eight critical originals twice and scores every actual turn", async () => {
  const corpus = { version: "context-contract-corpus-1", cases: [...regressions.cases, ...development.cases, ...heldout.cases] } as ContextManifest;
  const planned = expandContextCampaign(corpus, "PILOT");
  expect(planned).toHaveLength(32);
  expect(planned.filter(script => script.executionId.includes("#"))).toHaveLength(16);
  const observed = await runContextFixtureCampaign(planned, { sourceSha: "a".repeat(40), referenceNow: Date.parse("2026-09-28T03:00:00Z") }, frozenContextProposal);
  const scored = scoreContextCampaign(planned, observed);
  expect(scored).toMatchObject({ gate: "PASS", plannedScripts: 32, passedScripts: 32, plannedTurns: 84, passedTurns: 84,
    healthyFullSchemaValid: scored.healthyPlanned, safetyFailures: 0 });
});

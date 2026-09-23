// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSemanticService } from "./service";
import { createSemanticGateway, type SemanticJsonRequest } from "../intelligence/infrastructure/openrouter/semantic-gateway";
import type { PaidCallReservation, SemanticBudgetStore } from "./budget-store";

const NOW = Date.UTC(2026, 8, 16, 5, 5);
const input = {
  ownerId: "owner-private", sourceInboundId: "inbound-private", text: "nhắc mình uống thuốc",
  referenceTime: NOW - 600_000, processingNow: NOW, timezone: "Asia/Ho_Chi_Minh" as const,
};
const limits = {
  maxInputChars: 1_800, maxInputTokens: 12_000, maxOutputTokens: 256,
  maxResponseBytes: 20_000, timeoutMs: 500,
};
const route = { model: "fixture/model", provider: "fixture-provider", requireZdr: true,
  promptPriceMicrounitsPerMillionTokens: 500_000, completionPriceMicrounitsPerMillionTokens: 500_000 };
const response = (payload: unknown, usage?: unknown) => ({ status: 200,
  body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(payload) }, finish_reason: "stop" }], usage }),
});
const modelHelp = { intent: "HELP", title: null, titleState: "NOT_APPLICABLE", targetIntent: null };
const help = response(modelHelp);

function harness(options: { responses?: Array<ReturnType<typeof response> | Error>; mode?: "off" | "semantic";
  reserve?: "deny" | "throw"; mark?: "deny" | "throw"; finalizeThrows?: boolean; claim?: "deny" | "throw" } = {}) {
  const events: string[] = [];
  const requests: SemanticJsonRequest[] = [];
  const seen = new Set<string>();
  const transport = vi.fn(async (request: SemanticJsonRequest) => {
    requests.push(request);
    events.push("dispatch");
    const next = options.responses?.shift() ?? help;
    if (next instanceof Error) throw next;
    return next;
  });
  const budget: SemanticBudgetStore = {
    reservePaidCall: vi.fn(async (): Promise<PaidCallReservation> => {
      events.push("reserve");
      if (options.reserve === "throw") throw new Error("sensitive DB failure");
      return options.reserve === "deny" ? { status: "BUDGET_EXHAUSTED" } : {
        status: "RESERVED", reservationId: "reservation-private", reservedMaximumMicrounits: 6_128,
      };
    }),
    markDispatched: vi.fn(async () => {
      events.push("mark");
      if (options.mark === "throw") throw new Error("ambiguous mark");
      return options.mark !== "deny";
    }),
    finalizeUsage: vi.fn(async () => {
      events.push("finalize");
      if (options.finalizeThrows) throw new Error("sensitive settlement failure");
      return true;
    }),
    releaseOrExpireReservation: vi.fn(async () => true),
    reapExpiredReservations: vi.fn(async () => 0),
  };
  const claimInbound = vi.fn(async (scope: { ownerId: string; sourceInboundId: string }) => {
    if (options.claim === "throw") throw new Error("sensitive claim failure");
    if (options.claim === "deny" || seen.has(scope.sourceInboundId)) return false;
    seen.add(scope.sourceInboundId);
    return true;
  });
  const observations: unknown[] = [];
  const gateway = createSemanticGateway({ ...limits,
    freePrimary: { ...route, promptPriceMicrounitsPerMillionTokens: 0, completionPriceMicrounitsPerMillionTokens: 0 }, paidFallback: route }, transport);
  const makeService = () => createSemanticService({ mode: options.mode ?? "semantic", paidFallbackEnabled: true, gateway, budgetStore: budget,
    attemptStore: { claimInbound }, now: () => NOW, observe: (event) => observations.push(event) });
  return { service: makeService(), makeService, gateway, transport, budget, events, claimInbound, observations, requests };
}

describe("bounded semantic routing", () => {
  afterEach(() => vi.useRealTimers());
  it("uses exactly one pinned privacy primary with a durable budget fence and no fallback", async () => {
    const h = harness();
    const gateway = createSemanticGateway({ ...limits, primary: route }, h.transport);
    const service = createSemanticService({ mode: "privacy", gateway, budgetStore: h.budget,
      attemptStore: { claimInbound: h.claimInbound }, now: () => NOW, observe: (event) => h.observations.push(event) });
    expect(await service.interpret(input)).toEqual({ kind: "SAFE_HELP", code: "HELP" });
    expect(h.events).toEqual(["reserve", "mark", "dispatch", "finalize"]);
    expect(h.transport).toHaveBeenCalledTimes(1);
    expect(h.observations).toContainEqual(expect.objectContaining({ tier: "PRIMARY", fallbackUsed: false }));
  });

  it("off returns local help without any claim, reservation or model request", async () => {
    const h = harness({ mode: "off" });
    expect(await h.service.interpret(input)).toEqual({ kind: "SAFE_HELP", code: "AI_DISABLED" });
    expect(h.transport).not.toHaveBeenCalled();
    expect(h.claimInbound).not.toHaveBeenCalled();
    expect(h.budget.reservePaidCall).not.toHaveBeenCalled();
  });

  it.each([
    [modelHelp, { kind: "SAFE_HELP", code: "HELP" }],
    [{ ...modelHelp, intent: "UNSUPPORTED" }, { kind: "SAFE_HELP", code: "UNSUPPORTED" }],
    [{ ...modelHelp, intent: "LIST_REMINDERS" }, { kind: "CLARIFICATION", contextSlots: { targetIntent: "LIST_REMINDERS", rangeKind: null, localDate: null, missingFields: ["range"] } }],
    [{ ...modelHelp, intent: "AMBIGUOUS" }, { kind: "SAFE_HELP", code: "AMBIGUOUS_INTENT" }],
    [{ intent: "CREATE_REMINDER", title: "Việc", titleState: "RESOLVED", targetIntent: null }, { kind: "CLARIFICATION", contextSlots: { targetIntent: "CREATE_REMINDER", title: "Việc", localDate: null, localTime: null, missingFields: ["date", "time"] } }],
    [{ intent: "CREATE_REMINDER", title: null, titleState: "MISSING", targetIntent: null }, { kind: "CLARIFICATION", contextSlots: { targetIntent: "CREATE_REMINDER", title: null, localDate: null, localTime: null, missingFields: ["title", "date", "time"] } }],
  ])("reconciles semantic-only output without escalation: %j", async (payload, expected) => {
    const h = harness({ responses: [response(payload)] });
    expect(await h.service.interpret(input)).toMatchObject(expected);
    expect(h.transport).toHaveBeenCalledTimes(1);
    expect(h.budget.reservePaidCall).not.toHaveBeenCalled();
  });

  it("keeps an explicit list-query phrase read-only when the model returns create semantics", async () => {
    const h = harness({ responses: [response({ intent: "CREATE_REMINDER", title: "xem lịch", titleState: "RESOLVED", targetIntent: null })] });
    expect(await h.service.interpret({ ...input, sourceInboundId: "inbound-list-grammar", text: "ngày mai xem lịch" }))
      .toEqual({ kind: "QUERY", rangeKind: "TOMORROW", localDate: null });
  });

  it.each([
    [404, "", "FREE_UNAVAILABLE"], [408, "", "FREE_TIMEOUT"], [429, "", "FREE_RATE_LIMITED"],
    [503, "", "FREE_PROVIDER_FAILURE"], [200, "not JSON", "FREE_INVALID_JSON"],
    [200, response({ intent: "HELP", unauthorized: true }).body, "FREE_SCHEMA_INVALID"],
    [400, JSON.stringify({ error: { code: "unsupported_parameters" } }), "FREE_REQUIRED_FEATURE_UNSUPPORTED"],
  ])("allows one paid recovery for %s and never retries a paid failure", async (status, body, category) => {
    const h = harness({ responses: [{ status, body }, { status: 503, body: "sensitive upstream body" }] });
    expect(await h.service.interpret(input)).toEqual({ kind: "SAFE_HELP", code: "AI_UNAVAILABLE" });
    expect(h.events).toEqual(["dispatch", "reserve", "mark", "dispatch", "finalize"]);
    expect(h.transport).toHaveBeenCalledTimes(2);
    expect(h.observations).toContainEqual(expect.objectContaining({ tier: "FREE_PRIMARY", resultCategory: category }));
    expect(await h.makeService().interpret(input)).toEqual({ kind: "SAFE_HELP", code: "ALREADY_ATTEMPTED" });
    expect(h.transport).toHaveBeenCalledTimes(2);
    expect(h.budget.releaseOrExpireReservation).not.toHaveBeenCalled();
  });

  it.each(["deny", "throw"] as const)("does not dispatch after a %s claim", async (claim) => {
    const h = harness({ claim });
    expect(await h.service.interpret(input)).toEqual({ kind: "SAFE_HELP", code: "ALREADY_ATTEMPTED" });
    expect(h.transport).not.toHaveBeenCalled();
  });

  it("lets one concurrent delivery consume the attempt claim across service instances", async () => {
    const h = harness({ responses: [{ status: 503, body: "" }, help] });
    const results = await Promise.all(Array.from({ length: 12 }, () => h.makeService().interpret(input)));
    expect(results.filter((result) => result.kind === "SAFE_HELP" && result.code === "HELP")).toHaveLength(1);
    expect(h.transport).toHaveBeenCalledTimes(2);
  });

  it.each(["deny", "throw"] as const)("stops locally on %s budget acquisition", async (reserve) => {
    const h = harness({ reserve, responses: [{ status: 503, body: "" }] });
    expect(await h.service.interpret(input)).toEqual({ kind: "SAFE_HELP", code: "BUDGET_EXHAUSTED" });
    expect(h.transport).toHaveBeenCalledTimes(1);
    expect(h.budget.markDispatched).not.toHaveBeenCalled();
  });

  it.each(["deny", "throw"] as const)("requires a positive dispatch fence after reserve (%s)", async (mark) => {
    const h = harness({ mark, responses: [{ status: 503, body: "" }] });
    expect(await h.service.interpret(input)).toEqual({ kind: "SAFE_HELP", code: "AI_UNAVAILABLE" });
    expect(h.transport).toHaveBeenCalledTimes(1);
    expect(h.budget.releaseOrExpireReservation).not.toHaveBeenCalled();
  });

  it("finalizes known safe provider cost and never exposes semantic content in observations", async () => {
    const h = harness({ responses: [{ status: 503, body: "" }, response(modelHelp,
      { prompt_tokens: 100, completion_tokens: 20, cost: 0.00005, secret: "provider-sensitive" })] });
    expect(await h.service.interpret(input)).toEqual({ kind: "SAFE_HELP", code: "HELP" });
    expect(h.budget.finalizeUsage).toHaveBeenCalledWith({ ownerId: input.ownerId, reservationId: "reservation-private", actualCostMicrounits: 50, now: NOW });
    const safe = JSON.stringify(h.observations);
    for (const privateValue of [input.text, input.ownerId, input.sourceInboundId, "reservation-private", "provider-sensitive"]) {
      expect(safe).not.toContain(privateValue);
    }
    expect(h.observations).toContainEqual(expect.objectContaining({ tier: "CHEAP_PAID_FALLBACK", schemaValid: true, costMicrounits: 50 }));
  });

  it("charges unknown maximum after ambiguous dispatch failure even when settlement fails", async () => {
    const h = harness({ finalizeThrows: true, responses: [{ status: 503, body: "" }, new Error("secret provider message")] });
    expect(await h.service.interpret(input)).toEqual({ kind: "SAFE_HELP", code: "AI_UNAVAILABLE" });
    expect(h.budget.finalizeUsage).toHaveBeenCalledWith(expect.objectContaining({ actualCostMicrounits: null }));
    expect(h.budget.releaseOrExpireReservation).not.toHaveBeenCalled();
    expect(h.transport).toHaveBeenCalledTimes(2);
  });

  it.each([0, 6_127, NaN, Infinity])("never dispatches with an insufficient or invalid reservation ceiling %s", async (maximum) => {
    const h = harness({ responses: [{ status: 503, body: "" }] });
    vi.mocked(h.budget.reservePaidCall).mockResolvedValue({ status: "RESERVED", reservationId: "reservation-private", reservedMaximumMicrounits: maximum });
    expect(await h.service.interpret(input)).toEqual({ kind: "SAFE_HELP", code: "AI_UNAVAILABLE" });
    expect(h.transport).toHaveBeenCalledTimes(1);
    expect(h.budget.markDispatched).not.toHaveBeenCalled();
    expect(h.budget.releaseOrExpireReservation).toHaveBeenCalledWith(expect.objectContaining({ reason: "SAFE_FAILURE" }));
  });

  it("requires explicit paid enablement and keeps observations best-effort", async () => {
    const h = harness({ responses: [{ status: 503, body: "" }] });
    const service = createSemanticService({ mode: "semantic", gateway: h.gateway, budgetStore: h.budget,
      attemptStore: { claimInbound: h.claimInbound }, now: () => NOW, observe: () => { throw new Error("observation unavailable"); } });
    expect(await service.interpret(input)).toEqual({ kind: "SAFE_HELP", code: "AI_UNAVAILABLE" });
    expect(h.budget.reservePaidCall).not.toHaveBeenCalled();
    expect(h.transport).toHaveBeenCalledTimes(1);
  });

  it("skips an unconfigured free route and uses only an explicitly enabled paid route", async () => {
    const h = harness();
    const gateway = createSemanticGateway({ ...limits, paidFallback: route }, h.transport);
    const service = createSemanticService({ mode: "semantic", paidFallbackEnabled: true, gateway, budgetStore: h.budget,
      attemptStore: { claimInbound: h.claimInbound }, now: () => NOW });
    expect(await service.interpret(input)).toEqual({ kind: "SAFE_HELP", code: "HELP" });
    expect(h.events).toEqual(["reserve", "mark", "dispatch", "finalize"]);
  });

  it("makes one paid fallback after a real free timeout and conservatively finalizes a paid timeout", async () => {
    vi.useFakeTimers();
    const h = harness();
    const transport = vi.fn(() => new Promise<never>(() => {}));
    const gateway = createSemanticGateway({ ...limits,
      freePrimary: { ...route, promptPriceMicrounitsPerMillionTokens: 0, completionPriceMicrounitsPerMillionTokens: 0 }, paidFallback: route }, transport);
    const service = createSemanticService({ mode: "semantic", paidFallbackEnabled: true, gateway, budgetStore: h.budget,
      attemptStore: { claimInbound: h.claimInbound }, now: () => NOW });
    const pending = service.interpret(input);
    await vi.advanceTimersByTimeAsync(500);
    expect(transport).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(500);
    expect(await pending).toEqual({ kind: "SAFE_HELP", code: "AI_UNAVAILABLE" });
    expect(h.budget.finalizeUsage).toHaveBeenCalledWith(expect.objectContaining({ actualCostMicrounits: null }));
    expect(h.budget.releaseOrExpireReservation).not.toHaveBeenCalled();
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it("rejects evidence that becomes past during provider latency without changing its reference time", async () => {
    const h = harness();
    let clock = NOW;
    const transport = vi.fn(async () => {
      clock = Date.UTC(2026, 8, 16, 6, 5);
      return response({ intent: "CREATE_REMINDER", title: "Việc", titleState: "RESOLVED", targetIntent: null });
    });
    const gateway = createSemanticGateway({ ...limits,
      freePrimary: { ...route, promptPriceMicrounitsPerMillionTokens: 0, completionPriceMicrounitsPerMillionTokens: 0 }, paidFallback: route }, transport);
    const service = createSemanticService({ mode: "semantic", paidFallbackEnabled: true, gateway, budgetStore: h.budget,
      attemptStore: { claimInbound: h.claimInbound }, now: () => clock });
    expect(await service.interpret({ ...input, text: "hôm nay 13h nhắc việc" })).toEqual({ kind: "SAFE_CLARIFICATION", code: "PAST_TIME" });
    expect(transport).toHaveBeenCalledTimes(1);
    expect(h.budget.reservePaidCall).not.toHaveBeenCalled();
  });

  it("sends exact deterministic evidence to the real gateway and drafts only those values", async () => {
    const h = harness({ responses: [response({ intent: "CREATE_REMINDER", title: "gọi khách", titleState: "RESOLVED", targetIntent: null })] });
    expect(await h.service.interpret({ ...input, text: "mai 8h nhắc tui gọi khách" })).toEqual({
      kind: "CREATE", candidate: { title: "gọi khách", scheduledAt: Date.UTC(2026, 8, 17, 1), timezone: "Asia/Ho_Chi_Minh" },
    });
    expect(JSON.parse(h.requests[0].messages[1].content)).toEqual({
      text: "mai 8h nhắc tui gọi khách", referenceLocalDate: "2026-09-16", referenceLocalTime: "11:55", timezone: "Asia/Ho_Chi_Minh",
      temporalEvidence: { referenceLocalDate: "2026-09-16", referenceLocalTime: "11:55", timezone: "Asia/Ho_Chi_Minh",
        date: { state: "RESOLVED", source: "TOMORROW", localDate: "2026-09-17" },
        time: { state: "RESOLVED", source: "EXACT_TIME", localTime: "08:00" },
        range: { state: "RESOLVED", kind: "TOMORROW", localDate: null } },
    });
  });

  it("merges bounded context with fresh evidence and keeps model title text out of temporal authority", async () => {
    const h = harness({ responses: [response({ intent: "CREATE_REMINDER", title: null, titleState: "MISSING", targetIntent: null })] });
    const previousContext = { targetIntent: "CREATE_REMINDER" as const, title: "gọi khách ngày 2099-12-31", localDate: "2026-09-17", localTime: null, missingFields: ["time" as const] };
    expect(await h.service.interpret({ ...input, text: "9h", previousContext })).toEqual({ kind: "CREATE",
      candidate: { title: previousContext.title, scheduledAt: Date.UTC(2026, 8, 17, 2), timezone: "Asia/Ho_Chi_Minh" } });
    expect(JSON.parse(h.requests[0].messages[1].content).previousContext).toEqual(previousContext);
  });
});

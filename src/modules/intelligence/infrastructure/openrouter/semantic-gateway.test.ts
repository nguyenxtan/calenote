// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSemanticGateway, type SemanticJsonRequest } from "./semantic-gateway";
import type { SemanticInput } from "../../semantic-gateway";

const input = { text: "nhắc mình", interpretationReferenceTime: Date.UTC(2026, 8, 16, 5), timezone: "Asia/Ho_Chi_Minh" as const };
const route = { model: "fixture/model", provider: "fixture-provider", requireZdr: true,
  promptPriceMicrounitsPerMillionTokens: 500_000, completionPriceMicrounitsPerMillionTokens: 500_000 };
const freeRoute = { ...route, promptPriceMicrounitsPerMillionTokens: 0, completionPriceMicrounitsPerMillionTokens: 0 };
const config = { maxInputChars: 1_800, maxInputTokens: 12_000, maxOutputTokens: 256,
  maxResponseBytes: 20_000, timeoutMs: 100, freePrimary: freeRoute, paidFallback: route };
const success = { status: 200, body: JSON.stringify({ choices: [{ message: { content: '{"intent":"HELP"}' }, finish_reason: "stop" }] }) };

afterEach(() => vi.useRealTimers());

describe("injected strict semantic gateway", () => {
  it("pins an explicit provider/model with privacy, strict schema, no streaming and bounded output", async () => {
    const requests: SemanticJsonRequest[] = [];
    const gateway = createSemanticGateway(config, async (request) => { requests.push(request); return success; });
    const attempt = gateway.prepare("FREE_PRIMARY", input);
    expect(attempt.status).toBe("READY");
    if (attempt.status !== "READY") throw new Error("Expected prepared attempt");
    expect(await attempt.dispatch()).toMatchObject({ status: "SUCCESS", interpretation: { intent: "HELP" } });
    expect(requests[0]).toMatchObject({ model: "fixture/model", stream: false, max_tokens: 256,
      response_format: { type: "json_schema", json_schema: { strict: true } },
      provider: { only: ["fixture-provider"], require_parameters: true, data_collection: "deny", zdr: true,
        allow_fallbacks: false, max_price: { prompt: 0, completion: 0 } } });
    const branches = requests[0].response_format.json_schema.schema.oneOf as Array<Record<string, unknown>>;
    expect(branches).toHaveLength(5);
    expect(branches.every((branch) => branch.additionalProperties === false)).toBe(true);
    expect(requests[0]).not.toHaveProperty("tools");
    expect(requests[0]).not.toHaveProperty("models");
    expect(requests[0].messages).toHaveLength(2);
    expect(JSON.parse(requests[0].messages[1].content)).toEqual(input);
    expect(await attempt.dispatch()).toMatchObject({ status: "FAILURE", category: "UNAVAILABLE" });
    expect(requests).toHaveLength(1);
  });

  it("omits optional ZDR only when the explicit route does not require it", async () => {
    const transport = vi.fn<import("./semantic-gateway").SemanticTransport>(async () => success);
    const attempt = createSemanticGateway({ ...config, freePrimary: { ...freeRoute, requireZdr: false } }, transport)
      .prepare("FREE_PRIMARY", input);
    if (attempt.status !== "READY") throw new Error("Expected prepared attempt");
    await attempt.dispatch();
    expect(transport.mock.calls[0][0].provider).not.toHaveProperty("zdr");
  });

  it("returns unavailable without substituting any implicit model or provider", () => {
    const transport = vi.fn(async () => success);
    const gateway = createSemanticGateway({ ...config, freePrimary: undefined, paidFallback: undefined }, transport);
    expect(gateway.prepare("FREE_PRIMARY", input)).toEqual({ status: "FAILURE", category: "UNAVAILABLE" });
    expect(gateway.prepare("CHEAP_PAID_FALLBACK", input)).toEqual({ status: "FAILURE", category: "UNAVAILABLE" });
    expect(transport).not.toHaveBeenCalled();
  });

  it.each([
    { maxInputTokens: 0 }, { timeoutMs: 30_001 }, { maxOutputTokens: 0 }, { maxResponseBytes: 1_000_001 },
    { freePrimary: { ...route, model: "openrouter/auto" } },
    { paidFallback: { ...route, provider: "" } },
    { paidFallback: { ...route, promptPriceMicrounitsPerMillionTokens: -1 } },
    { freePrimary: route },
  ])("rejects invalid and implicit route configuration %j", (override) => {
    expect(() => createSemanticGateway({ ...config, ...override }, async () => success)).toThrow("Invalid semantic gateway configuration");
  });

  it.each([
    { ...input, text: "a".repeat(1_801) },
    { ...input, text: "password=secret" },
    { ...input, text: "/connect connection-code" },
    { ...input, ownerId: "do-not-send" },
    { ...input, interpretationReferenceTime: NaN },
    { ...input, previousContext: { transcript: "do-not-send" } },
  ])("rejects invalid or sensitive semantic input before preparing dispatch %#", (badInput) => {
    const transport = vi.fn(async () => success);
    expect(createSemanticGateway(config, transport).prepare("FREE_PRIMARY", badInput as SemanticInput))
      .toMatchObject({ status: "FAILURE", category: "INVALID_INPUT" });
    expect(transport).not.toHaveBeenCalled();
  });

  it("bounds serialized context, prompt and schema together against the input token ceiling", () => {
    expect(createSemanticGateway({ ...config, maxInputTokens: 100 }, async () => success)
      .prepare("FREE_PRIMARY", input)).toMatchObject({ status: "FAILURE", category: "INVALID_INPUT" });
  });

  it("uses only bounded prior semantic slots and keeps receipt time intact", async () => {
    const requests: SemanticJsonRequest[] = [];
    const previousContext = { targetIntent: "CREATE_REMINDER" as const, title: "Việc", localDate: "2026-09-16",
      localTime: null, missingFields: ["time" as const] };
    const attempt = createSemanticGateway(config, async (request) => { requests.push(request); return success; })
      .prepare("FREE_PRIMARY", { ...input, previousContext });
    if (attempt.status !== "READY") throw new Error("Expected prepared attempt");
    await attempt.dispatch();
    expect(JSON.parse(requests[0].messages[1].content)).toEqual({ ...input, previousContext });
  });

  it("aborts and returns timeout even if the injected transport ignores cancellation", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const transport = vi.fn((_request: SemanticJsonRequest, options: { signal: AbortSignal }) => {
      signal = options.signal;
      return new Promise<never>(() => {});
    });
    const attempt = createSemanticGateway(config, transport).prepare("FREE_PRIMARY", input);
    if (attempt.status !== "READY") throw new Error("Expected prepared attempt");
    const pending = attempt.dispatch();
    await vi.advanceTimersByTimeAsync(100);
    expect(await pending).toMatchObject({ status: "FAILURE", category: "TIMEOUT" });
    expect(signal?.aborted).toBe(true);
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it.each([
    [{ status: 200, body: "a".repeat(20_001) }, "SCHEMA_INVALID"],
    [{ status: 200, body: "{}" }, "SCHEMA_INVALID"],
    [{ status: 200, body: JSON.stringify({ choices: [{ message: { content: "not JSON" }, finish_reason: "stop" }] }) }, "INVALID_JSON"],
    [{ status: 200, body: JSON.stringify({ choices: [{ message: { content: '{"intent":"HELP"}', tool_calls: [{}] }, finish_reason: "stop" }] }) }, "SCHEMA_INVALID"],
    [{ status: 200, body: JSON.stringify({ choices: [{ message: { content: '{"intent":"HELP"}' }, finish_reason: "length" }] }) }, "SCHEMA_INVALID"],
  ])("rejects malformed, excessive or tool output with a safe category %#", async (providerResponse, category) => {
    const attempt = createSemanticGateway(config, async () => providerResponse).prepare("FREE_PRIMARY", input);
    if (attempt.status !== "READY") throw new Error("Expected prepared attempt");
    expect(await attempt.dispatch()).toMatchObject({ status: "FAILURE", category });
  });

  it.each([-1, NaN, 1, "0.00005"]) ("ignores unsafe or above-reservation provider cost %j", async (cost) => {
    const attempt = createSemanticGateway(config, async () => ({ status: 200, body: JSON.stringify({
      choices: [{ message: { content: '{"intent":"HELP"}' }, finish_reason: "stop" }],
      usage: { cost, prompt_tokens: 100, completion_tokens: 20 },
    }) })).prepare("CHEAP_PAID_FALLBACK", input);
    if (attempt.status !== "READY") throw new Error("Expected prepared attempt");
    expect(await attempt.dispatch()).toMatchObject({ status: "SUCCESS", usage: { costMicrounits: null } });
  });
});

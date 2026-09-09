import { afterEach, describe, expect, it, vi } from "vitest";
import { createOpenRouterGateway } from "./gateway";

const config = { mode: "free" as const, apiKey: "test-key", freeModel: "openrouter/free", timeoutMs: 1_000, maxInputChars: 500, maxOutputTokens: 120 };
describe("OpenRouter intelligence gateway", () => {
  afterEach(() => vi.useRealTimers());
  it("sends a strict, privacy-constrained FREE structured request", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ model: "free/model", choices: [{ message: { content: JSON.stringify({ status: "UNSUPPORTED", confidence: 0 }) } }] }), { status: 200 }));
    const gateway = createOpenRouterGateway(config, fetcher);
    await expect(gateway.interpretReminder({ text: "nhắc tôi", now: 1_700_000_000_000, timezone: "Asia/Ho_Chi_Minh" })).resolves.toEqual({ status: "UNSUPPORTED", confidence: 0 });
    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(init.headers).toMatchObject({ Authorization: "Bearer test-key" });
    expect(JSON.parse(String(init.body))).toMatchObject({ model: "openrouter/free", response_format: { type: "json_schema" }, provider: { allow_fallbacks: false, data_collection: "deny", zdr: true, require_parameters: true } });
  });
  it("fails closed without HTTP for oversized input and provider failure", async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error("network"));
    const gateway = createOpenRouterGateway({ ...config, maxInputChars: 3 }, fetcher);
    await expect(gateway.interpretReminder({ text: "long", now: 1_700_000_000_000, timezone: "Asia/Ho_Chi_Minh" })).resolves.toEqual({ status: "UNAVAILABLE" });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([401, 403, 429, 500, 503])("fails closed for HTTP %i without retry", async (status) => {
    const fetcher = vi.fn().mockResolvedValue(new Response("ignored", { status }));
    const gateway = createOpenRouterGateway(config, fetcher);
    await expect(gateway.interpretReminder({ text: "nhắc tôi", now: 1_700_000_000_000, timezone: "Asia/Ho_Chi_Minh" })).resolves.toEqual({ status: "UNAVAILABLE" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("does not propagate raw provider error or completion content", async () => {
    const providerSecret = "provider-body-must-not-escape";
    const errorGateway = createOpenRouterGateway(config, async () => new Response(providerSecret, { status: 500 }));
    const completionGateway = createOpenRouterGateway(config, async () => new Response(JSON.stringify({ choices: [{ message: { content: providerSecret } }] }), { status: 200 }));
    const input = { text: "reminder input", now: 1_700_000_000_000, timezone: "Asia/Ho_Chi_Minh" as const };
    await expect(errorGateway.interpretReminder(input)).resolves.toEqual({ status: "UNAVAILABLE" });
    await expect(completionGateway.interpretReminder(input)).resolves.toEqual({ status: "UNAVAILABLE" });
  });
  it.each(["{", JSON.stringify({}), JSON.stringify({ choices: [{}] })])("fails closed for malformed provider response", async (payload) => {
    const fetcher = vi.fn().mockResolvedValue(new Response(payload, { status: 200 }));
    await expect(createOpenRouterGateway(config, fetcher).interpretReminder({ text: "nhắc tôi", now: 1_700_000_000_000, timezone: "Asia/Ho_Chi_Minh" })).resolves.toEqual({ status: "UNAVAILABLE" });
  });
  it("aborts one pending transport request at the bounded timeout", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    }));
    const pending = createOpenRouterGateway({ ...config, timeoutMs: 100 }, fetcher).interpretReminder({ text: "nhắc tôi", now: 1_700_000_000_000, timezone: "Asia/Ho_Chi_Minh" });
    await vi.advanceTimersByTimeAsync(100);
    await expect(pending).resolves.toEqual({ status: "UNAVAILABLE" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("keeps configured paid fallbacks idle when the free primary succeeds", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ status: "UNSUPPORTED", confidence: 0 }) } }] }), { status: 200 }));
    const gateway = createOpenRouterGateway({ ...config, fallbackModels: ["cheap/one"], maxFallbackAttempts: 1, maxFallbackPrice: 0.01 }, fetcher);
    await expect(gateway.interpretReminder({ text: "reminder", now: 1_700_000_000_000, timezone: "Asia/Ho_Chi_Minh" })).resolves.toEqual({ status: "UNSUPPORTED", confidence: 0 });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1].body))).toMatchObject({ model: "openrouter/free" });
  });
  it.each([429, 503])("tries the first configured cheap fallback after free HTTP %i", async (status) => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response("unavailable", { status }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ status: "PROPOSED", title: "Fallback", scheduledAt: 1_700_000_060_000, timezone: "Asia/Ho_Chi_Minh", confidence: 0.5 }) } }] }), { status: 200 }));
    const gateway = createOpenRouterGateway({ ...config, fallbackModels: ["cheap/one", "cheap/two"], maxFallbackAttempts: 1, maxFallbackPrice: 0.01 }, fetcher);
    await expect(gateway.interpretReminder({ text: "reminder", now: 1_700_000_000_000, timezone: "Asia/Ho_Chi_Minh" })).resolves.toMatchObject({ status: "PROPOSED", title: "Fallback" });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls.map(([, init]) => JSON.parse(String((init as RequestInit).body)).model)).toEqual(["openrouter/free", "cheap/one"]);
    expect(JSON.parse(String(fetcher.mock.calls[1]?.[1].body))).toMatchObject({ provider: { max_price: { request: 0.01 }, allow_fallbacks: false } });
  });
  it("tries the first configured cheap fallback after a bounded transport failure", async () => {
    const fetcher = vi.fn()
      .mockRejectedValueOnce(new Error("transport unavailable"))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ status: "UNSUPPORTED", confidence: 0 }) } }] }), { status: 200 }));
    const gateway = createOpenRouterGateway({ ...config, fallbackModels: ["cheap/one"], maxFallbackAttempts: 1, maxFallbackPrice: 0.01 }, fetcher);
    await expect(gateway.interpretReminder({ text: "reminder", now: 1_700_000_000_000, timezone: "Asia/Ho_Chi_Minh" })).resolves.toEqual({ status: "UNSUPPORTED", confidence: 0 });
    expect(fetcher.mock.calls.map(([, init]) => JSON.parse(String((init as RequestInit).body)).model)).toEqual(["openrouter/free", "cheap/one"]);
  });
  it.each([401, 403])("does not retry a free request after HTTP %i", async (status) => {
    const fetcher = vi.fn().mockResolvedValue(new Response("unauthorized", { status }));
    const gateway = createOpenRouterGateway({ ...config, fallbackModels: ["cheap/one"], maxFallbackAttempts: 1, maxFallbackPrice: 0.01 }, fetcher);
    await expect(gateway.interpretReminder({ text: "reminder", now: 1_700_000_000_000, timezone: "Asia/Ho_Chi_Minh" })).resolves.toEqual({ status: "UNAVAILABLE" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("does not retry malformed structured output and bounds configured fallback attempts", async () => {
    const malformed = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: "not-json" } }] }), { status: 200 }));
    const malformedGateway = createOpenRouterGateway({ ...config, fallbackModels: ["cheap/one"], maxFallbackAttempts: 1, maxFallbackPrice: 0.01 }, malformed);
    await expect(malformedGateway.interpretReminder({ text: "reminder", now: 1_700_000_000_000, timezone: "Asia/Ho_Chi_Minh" })).resolves.toEqual({ status: "UNAVAILABLE" });
    expect(malformed).toHaveBeenCalledTimes(1);

    const unavailable = vi.fn().mockResolvedValue(new Response("unavailable", { status: 503 }));
    const boundedGateway = createOpenRouterGateway({ ...config, fallbackModels: ["cheap/one", "cheap/two"], maxFallbackAttempts: 1, maxFallbackPrice: 0.01 }, unavailable);
    await expect(boundedGateway.interpretReminder({ text: "reminder", now: 1_700_000_000_000, timezone: "Asia/Ho_Chi_Minh" })).resolves.toEqual({ status: "UNAVAILABLE" });
    expect(unavailable).toHaveBeenCalledTimes(2);
    expect(unavailable.mock.calls.map(([, init]) => JSON.parse(String((init as RequestInit).body)).model)).toEqual(["openrouter/free", "cheap/one"]);
  });
});

import { describe, expect, it, vi } from "vitest";
import { createOpenRouterGateway } from "./gateway";

const config = { mode: "free" as const, apiKey: "test-key", freeModel: "openrouter/free", timeoutMs: 1_000, maxInputChars: 500, maxOutputTokens: 120 };
describe("OpenRouter intelligence gateway", () => {
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
});

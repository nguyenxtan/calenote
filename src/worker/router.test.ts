import { describe, expect, it, vi } from "vitest";
import type { BotProfile } from "@/modules/connections/contracts";
import { ProviderVerificationError } from "@/modules/connections/provider-error";
import { createRouter, routeRequest } from "./router";

const telegramToken = "123456789:AAExample_secret-token_123456789";
const telegramBot: BotProfile = {
  provider: "telegram",
  providerBotId: "987654321",
  displayName: "Thư ký Mây",
  handle: "@may_calendar_bot",
  accountType: null,
  canJoinGroups: true,
};

function testContext(): ExecutionContext {
  return {
    waitUntil: vi.fn(),
    passThroughOnException: vi.fn(),
  } as unknown as ExecutionContext;
}

function testEnv() {
  const assets = { fetch: vi.fn() };
  return {
    assets,
    env: { ASSETS: assets } as unknown as Env,
  };
}

function request(body: unknown, headers?: HeadersInit) {
  return new Request("https://example.test/api/v1/bot-connections/verify", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("Worker router", () => {
  it("returns bounded JSON health without touching assets", async () => {
    const { assets, env } = testEnv();
    const response = await routeRequest(new Request("https://example.test/api/health"), env, testContext());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, service: "calenote" });
    expect(assets.fetch).not.toHaveBeenCalled();
  });

  it("returns a normalized bot identity without retaining or echoing the token", async () => {
    const verifier = vi.fn(async () => telegramBot);
    const { env } = testEnv();
    const response = await createRouter({ verifyBotToken: verifier })(request({ provider: "telegram", token: telegramToken }), env, testContext());
    const raw = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(JSON.parse(raw)).toEqual({ data: { bot: telegramBot }, meta: { tokenStored: false } });
    expect(raw).not.toContain(telegramToken);
  });

  it("rejects unsupported providers before verification", async () => {
    const verifier = vi.fn();
    const { env } = testEnv();
    const response = await createRouter({ verifyBotToken: verifier })(request({ provider: "zalo-oa", token: telegramToken }), env, testContext());

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: "INVALID_REQUEST", message: "Thông tin kết nối chưa đúng. Hãy kiểm tra lại kênh và token." },
    });
    expect(verifier).not.toHaveBeenCalled();
  });

  it("returns a safe error when the provider rejects a token", async () => {
    const { env } = testEnv();
    const response = await createRouter({
      verifyBotToken: async () => { throw new ProviderVerificationError("PROVIDER_REJECTED"); },
    })(request({ provider: "telegram", token: telegramToken }), env, testContext());
    const raw = await response.text();

    expect(response.status).toBe(422);
    expect(JSON.parse(raw)).toEqual({
      error: { code: "BOT_TOKEN_REJECTED", message: "Provider không chấp nhận token này. Hãy tạo hoặc sao chép lại token rồi thử lại." },
    });
    expect(raw).not.toContain(telegramToken);
  });

  it("asks for a retry when the provider is temporarily unavailable", async () => {
    const { env } = testEnv();
    const response = await createRouter({
      verifyBotToken: async () => { throw new ProviderVerificationError("PROVIDER_UNAVAILABLE"); },
    })(request({ provider: "telegram", token: telegramToken }), env, testContext());

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      error: { code: "PROVIDER_UNAVAILABLE", message: "Chưa liên hệ được provider. Hãy đợi một chút rồi thử lại." },
    });
  });

  it("rejects malformed JSON", async () => {
    const verifier = vi.fn();
    const { env } = testEnv();
    const response = await createRouter({ verifyBotToken: verifier })(request("{not-json"), env, testContext());

    expect(response.status).toBe(400);
    expect((await response.json() as { error: { code: string } }).error.code).toBe("INVALID_REQUEST");
    expect(verifier).not.toHaveBeenCalled();
  });

  it("rejects an oversized declared body before parsing it", async () => {
    const verifier = vi.fn();
    const { env } = testEnv();
    const response = await createRouter({ verifyBotToken: verifier })(
      request({ provider: "telegram", token: telegramToken }, { "content-length": "4096" }), env, testContext(),
    );

    expect(response.status).toBe(413);
    expect((await response.json() as { error: { code: string } }).error.code).toBe("REQUEST_TOO_LARGE");
    expect(verifier).not.toHaveBeenCalled();
  });

  it("cancels an undeclared oversized stream before reading the remaining body", async () => {
    let pulls = 0;
    let canceled = false;
    const verifier = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        if (pulls <= 2) return controller.enqueue(new Uint8Array(1_200).fill(65));
        throw new Error("The route read beyond its byte limit");
      },
      cancel() { canceled = true; },
    });
    const streamedRequest = new Request("https://example.test/api/v1/bot-connections/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      duplex: "half",
    } as RequestInit & { duplex: "half" });
    const { env } = testEnv();
    const response = await createRouter({ verifyBotToken: verifier })(streamedRequest, env, testContext());

    expect(response.status).toBe(413);
    expect((await response.json() as { error: { code: string } }).error.code).toBe("REQUEST_TOO_LARGE");
    expect(canceled).toBe(true);
    expect(pulls).toBe(2);
    expect(verifier).not.toHaveBeenCalled();
  });

  it("aborts a slow request body on an absolute deadline", async () => {
    const verifier = vi.fn();
    let closeTimer: ReturnType<typeof setTimeout> | undefined;
    const body = new ReadableStream<Uint8Array>({
      start(controller) { closeTimer = setTimeout(() => controller.close(), 40); },
      cancel() { clearTimeout(closeTimer); },
    });
    const slowRequest = new Request("https://example.test/api/v1/bot-connections/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      duplex: "half",
    } as RequestInit & { duplex: "half" });
    const { env } = testEnv();
    const response = await createRouter({ verifyBotToken: verifier, requestBodyDeadlineMs: 5 })(slowRequest, env, testContext());

    expect(response.status).toBe(408);
    expect((await response.json() as { error: { code: string } }).error.code).toBe("REQUEST_TIMEOUT");
    expect(verifier).not.toHaveBeenCalled();
  });
});

import { describe, expect, it, vi } from "vitest";
import { ConnectionStateError, OnboardingConflictError, RateLimitExceededError } from "@/modules/onboarding/service";
import { SessionAuthError } from "@/modules/auth/session";
import { ProviderVerificationError } from "@/modules/connections/provider-error";
import { createKeyring } from "@/modules/security/keyring";
import { onboard } from "@/modules/onboarding/service";
import { createRouter, routeRequest, type WorkerOperations } from "./router";

const token = "123456789:AAExample_secret-token_123456789";
const sessionCookie = `__Host-calenote_session=${"A".repeat(43)}`;
const master = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const success = {
  bot: {
    publicId: "bot-public",
    provider: "telegram" as const,
    providerBotId: "987654321",
    displayName: "Thư ký Mây",
    handle: "@may_calendar_bot",
    accountType: null,
    canJoinGroups: true,
    state: "ACTIVE_UNBOUND" as const,
    webhook: "READY" as const,
  },
  connectCommand: "/connect ABCDEFGHJKLMNPQRSTUVWXYZ23",
  connectCodeExpiresAt: 1_700_000_600_000,
  sessionCookie: "__Host-calenote_session=bearer; HttpOnly; Secure; SameSite=Lax; Path=/",
  activationCode: null,
};

function context(): ExecutionContext {
  return { waitUntil: vi.fn(), passThroughOnException: vi.fn() } as unknown as ExecutionContext;
}

function environment() {
  const assets = { fetch: vi.fn(async () => new Response("asset", { status: 404 })) };
  return {
    assets,
    env: {
      ASSETS: assets,
      APP_ORIGIN: "https://calenote.iconiclogs.com",
    } as unknown as Env,
  };
}

function operations(overrides: Partial<WorkerOperations> = {}): WorkerOperations {
  return {
    digestRateLimitSubject: vi.fn(async () => "N8MKPqjdJlR9xUXwupHi_Z45pMG4W0IBZwgHR3SNo1g"),
    consumeOnboardingRateLimit: vi.fn(async () => ({ allowed: true, resetAt: 1_700_000_060_000 })),
    onboard: vi.fn(async () => success),
    requireUser: vi.fn(async () => ({ userId: "user-internal" })),
    rotateConnectCode: vi.fn(async () => ({ command: "/connect GHJKLMNPQRSTUVWXYZ23456789", expiresAt: 1_700_000_600_000 })),
    ...overrides,
  };
}

function onboardingRequest(body: unknown, headers: HeadersInit = {}) {
  return new Request("https://calenote.iconiclogs.com/api/onboarding", {
    method: "POST",
    headers: {
      origin: "https://calenote.iconiclogs.com",
      "content-type": "application/json",
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function onboardingBody() {
  return {
    displayName: "Bích Tuyền",
    email: "owner@example.com",
    timezone: "Asia/Ho_Chi_Minh",
    provider: "telegram",
    token,
  };
}

describe("Worker router", () => {
  it("keeps health and asset fallback behavior unchanged", async () => {
    const { assets, env } = environment();
    const health = await routeRequest(new Request("https://calenote.iconiclogs.com/api/health"), env, context());
    const asset = await routeRequest(new Request("https://calenote.iconiclogs.com/docs"), env, context());

    expect(health.status).toBe(200);
    await expect(health.json()).resolves.toEqual({ ok: true, service: "calenote" });
    expect(asset.status).toBe(404);
    expect(assets.fetch).toHaveBeenCalledTimes(1);
  });

  it("does not expose the deleted public token verification route", async () => {
    const { assets, env } = environment();
    const response = await routeRequest(
      new Request("https://calenote.iconiclogs.com/api/v1/bot-connections/verify", { method: "POST" }),
      env,
      context(),
    );

    expect(response.status).toBe(404);
    expect(assets.fetch).toHaveBeenCalledTimes(1);
  });

  it("requires exact same-origin JSON and rate-limits a HMACed trusted IP/provider before onboarding", async () => {
    const ops = operations();
    const { env } = environment();
    const response = await createRouter({ operations: async () => ops })(
      onboardingRequest(onboardingBody(), { "CF-Connecting-IP": "203.0.113.7" }),
      env,
      context(),
    );

    expect(ops.digestRateLimitSubject).toHaveBeenCalledWith("rate-limit:onboarding:telegram:203.0.113.7");
    expect(ops.consumeOnboardingRateLimit).toHaveBeenCalledBefore(ops.onboard as ReturnType<typeof vi.fn>);
    expect(response.status).toBe(201);
    expect(response.headers.get("set-cookie")).toBe(success.sessionCookie);
    const raw = await response.text();
    expect(JSON.parse(raw)).toEqual({
      data: {
        bot: success.bot,
        connectCommand: success.connectCommand,
        connectCodeExpiresAt: success.connectCodeExpiresAt,
        activationCode: null,
      },
    });
    expect(raw).not.toContain(token);
    expect(raw).not.toContain("sessionCookie");
  });

  it("uses one anonymous rate-limit subject and ignores spoofable forwarding headers", async () => {
    const ops = operations();
    const { env } = environment();
    await createRouter({ operations: async () => ops })(
      onboardingRequest(onboardingBody(), { "x-forwarded-for": "198.51.100.4" }), env, context(),
    );

    expect(ops.digestRateLimitSubject).toHaveBeenCalledWith("rate-limit:onboarding:telegram:anonymous");
  });

  it.each([
    { label: "missing origin", headers: { origin: "" }, expected: 403 },
    { label: "wrong media type", headers: { "content-type": "text/plain" }, expected: 415 },
    { label: "oversized body", headers: { "content-length": "2049" }, expected: 413 },
  ])("rejects $label before rate limiting or provider egress", async ({ headers, expected }) => {
    const ops = operations();
    const operationsFactory = vi.fn(async () => ops);
    const { env } = environment();
    const request = onboardingRequest(onboardingBody(), headers as unknown as Record<string, string>);
    if (headers.origin === "") request.headers.delete("origin");
    const response = await createRouter({ operations: operationsFactory })(request, env, context());

    expect(response.status).toBe(expected);
    expect(operationsFactory).not.toHaveBeenCalled();
    expect(ops.consumeOnboardingRateLimit).not.toHaveBeenCalled();
    expect(ops.onboard).not.toHaveBeenCalled();
  });

  it("strictly validates and normalizes onboarding fields before the operation", async () => {
    const ops = operations();
    const { env } = environment();
    const response = await createRouter({ operations: async () => ops })(
      onboardingRequest({ ...onboardingBody(), displayName: "  Tuyền  ", email: "  OWNER@Example.COM " }), env, context(),
    );

    expect(response.status).toBe(201);
    expect(ops.onboard).toHaveBeenCalledWith({ ...onboardingBody(), displayName: "Tuyền", email: "owner@example.com" });
  });

  it("returns stable safe rate and onboarding conflict errors", async () => {
    const { env } = environment();
    const limited = operations({
      consumeOnboardingRateLimit: vi.fn(async () => ({ allowed: false, resetAt: Date.now() + 9_500 })),
    });
    const limitedResponse = await createRouter({ operations: async () => limited })(onboardingRequest(onboardingBody()), env, context());
    expect(limitedResponse.status).toBe(429);
    expect(Number(limitedResponse.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
    expect((await limitedResponse.json() as { error: { code: string } }).error.code).toBe("RATE_LIMITED");

    const conflict = operations({ onboard: vi.fn(async () => { throw new OnboardingConflictError(); }) });
    const conflictResponse = await createRouter({ operations: async () => conflict })(onboardingRequest(onboardingBody()), env, context());
    const raw = await conflictResponse.text();
    expect(conflictResponse.status).toBe(409);
    expect(JSON.parse(raw).error.code).toBe("ONBOARDING_CONFLICT");
    expect(raw).not.toContain(token);
    expect(raw).not.toContain("owner@example.com");
  });

  it("returns generic 500 when a verification-shaped error occurs after getMe and keeps VALIDATING", async () => {
    const { env } = environment();
    const keyring = await createKeyring(master);
    const committed: Array<{ connection: { state: string } }> = [];
    const failActivation = vi.fn();
    const ops = operations({
      onboard: (onboardingInput) => onboard(onboardingInput, {
        store: {
          commitAccountGraph: async (graph) => { committed.push(graph); },
          activateConnection: vi.fn(),
          failActivation,
          findOwnedConnection: vi.fn(),
          rotateConnectCode: vi.fn(),
        },
        keyring,
        verifyToken: async () => ({
          provider: "telegram", providerBotId: "provider-bot", displayName: "Bot",
          handle: null, accountType: null, canJoinGroups: true,
        }),
        registerWebhook: async () => { throw new ProviderVerificationError("INVALID_PROVIDER_RESPONSE"); },
        appOrigin: "https://calenote.iconiclogs.com",
      }),
    });

    const response = await createRouter({ operations: async () => ops })(onboardingRequest(onboardingBody()), env, context());
    const raw = await response.text();

    expect(response.status).toBe(500);
    expect(JSON.parse(raw)).toEqual({
      error: { code: "INTERNAL_ERROR", message: "Không thể hoàn tất yêu cầu." },
    });
    expect(committed[0].connection.state).toBe("VALIDATING");
    expect(failActivation).not.toHaveBeenCalled();
    expect(raw).not.toContain(token);
    expect(raw).not.toContain("INVALID_PROVIDER_RESPONSE");
  });

  it("requires a session and an exact empty JSON object to rotate a connect code", async () => {
    const ops = operations();
    const { env } = environment();
    const request = new Request("https://calenote.iconiclogs.com/api/connections/bot-public/connect-code", {
      method: "POST",
      headers: { origin: "https://calenote.iconiclogs.com", "content-type": "application/json", cookie: sessionCookie },
      body: "{}",
    });
    const response = await createRouter({ operations: async () => ops })(request, env, context());

    expect(ops.requireUser).toHaveBeenCalledWith(request);
    expect(ops.rotateConnectCode).toHaveBeenCalledWith({ userId: "user-internal", publicId: "bot-public" });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ data: { connectCommand: "/connect GHJKLMNPQRSTUVWXYZ23456789", expiresAt: 1_700_000_600_000 } });
  });

  it("returns 401 before connection lookup and 429 with Retry-After safely", async () => {
    const { env } = environment();
    const unauthenticated = operations({ requireUser: vi.fn(async () => { throw new SessionAuthError(); }) });
    const request = new Request("https://calenote.iconiclogs.com/api/connections/bot-public/connect-code", {
      method: "POST",
      headers: { origin: "https://calenote.iconiclogs.com", "content-type": "application/json", cookie: sessionCookie },
      body: "{}",
    });
    const unauthorized = await createRouter({ operations: async () => unauthenticated })(request, env, context());
    expect(unauthorized.status).toBe(401);
    expect(unauthenticated.rotateConnectCode).not.toHaveBeenCalled();

    const limited = operations({ rotateConnectCode: vi.fn(async () => { throw new RateLimitExceededError(17); }) });
    const limitedRequest = new Request("https://calenote.iconiclogs.com/api/connections/bot-public/connect-code", {
      method: "POST",
      headers: { origin: "https://calenote.iconiclogs.com", "content-type": "application/json", cookie: sessionCookie },
      body: "{}",
    });
    const limitedResponse = await createRouter({ operations: async () => limited })(limitedRequest, env, context());
    expect(limitedResponse.status).toBe(429);
    expect(limitedResponse.headers.get("retry-after")).toBe("17");
    expect((await limitedResponse.json() as { error: { code: string } }).error.code).toBe("RATE_LIMITED");

    const stale = operations({ rotateConnectCode: vi.fn(async () => { throw new ConnectionStateError(); }) });
    const staleRequest = new Request("https://calenote.iconiclogs.com/api/connections/bot-public/connect-code", {
      method: "POST",
      headers: { origin: "https://calenote.iconiclogs.com", "content-type": "application/json", cookie: sessionCookie },
      body: "{}",
    });
    const staleResponse = await createRouter({ operations: async () => stale })(staleRequest, env, context());
    expect(staleResponse.status).toBe(409);
    await expect(staleResponse.json()).resolves.toEqual({
      error: {
        code: "CONNECTION_STATE_CONFLICT",
        message: "Trạng thái kết nối hiện tại không cho phép thao tác này.",
      },
    });
  });

  it("rejects a missing session cookie before constructing crypto or database operations", async () => {
    const ops = operations();
    const operationsFactory = vi.fn(async () => ops);
    const { env } = environment();
    const request = new Request("https://calenote.iconiclogs.com/api/connections/bot-public/connect-code", {
      method: "POST",
      headers: { origin: "https://calenote.iconiclogs.com", "content-type": "application/json" },
      body: "{}",
    });

    const response = await createRouter({ operations: operationsFactory })(request, env, context());

    expect(response.status).toBe(401);
    expect(operationsFactory).not.toHaveBeenCalled();
  });

  it.each([
    { label: "invalid media", headers: { "content-type": "text/plain" }, body: "{}", status: 415 },
    { label: "oversized body", headers: { "content-length": "2049" }, body: "{}", status: 413 },
    { label: "invalid JSON", headers: {}, body: "{", status: 400 },
    { label: "nonempty object", headers: {}, body: JSON.stringify({ unexpected: true }), status: 400 },
  ])("rejects $label before operations construction or authenticated lookup", async ({ headers, body, status }) => {
    const ops = operations();
    const operationsFactory = vi.fn(async () => ops);
    const requestHeaders = new Headers({
      origin: "https://calenote.iconiclogs.com",
      "content-type": "application/json",
      cookie: sessionCookie,
    });
    for (const [name, value] of Object.entries(headers)) requestHeaders.set(name, value);
    const request = new Request("https://calenote.iconiclogs.com/api/connections/bot-public/connect-code", {
      method: "POST",
      headers: requestHeaders,
      body,
    });

    const response = await createRouter({ operations: operationsFactory })(request, environment().env, context());

    expect(response.status).toBe(status);
    expect(operationsFactory).not.toHaveBeenCalled();
    expect(ops.requireUser).not.toHaveBeenCalled();
  });

  it("rejects non-empty connect-code bodies and hides unknown failures", async () => {
    const { env } = environment();
    const ops = operations();
    const invalid = new Request("https://calenote.iconiclogs.com/api/connections/bot-public/connect-code", {
      method: "POST",
      headers: { origin: "https://calenote.iconiclogs.com", "content-type": "application/json", cookie: sessionCookie },
      body: JSON.stringify({ unexpected: true }),
    });
    const invalidResponse = await createRouter({ operations: async () => ops })(invalid, env, context());
    expect(invalidResponse.status).toBe(400);
    await expect(invalidResponse.json()).resolves.toEqual({
      error: { code: "INVALID_REQUEST", message: "Yêu cầu không hợp lệ." },
    });
    expect(ops.rotateConnectCode).not.toHaveBeenCalled();

    const failed = operations({ rotateConnectCode: vi.fn(async () => { throw new Error(`secret ${token}`); }) });
    const failureRequest = new Request("https://calenote.iconiclogs.com/api/connections/bot-public/connect-code", {
      method: "POST",
      headers: { origin: "https://calenote.iconiclogs.com", "content-type": "application/json", cookie: sessionCookie },
      body: "{}",
    });
    const failedResponse = await createRouter({ operations: async () => failed })(failureRequest, env, context());
    const raw = await failedResponse.text();
    expect(failedResponse.status).toBe(500);
    expect(raw).not.toContain(token);
    expect(JSON.parse(raw).error.code).toBe("INTERNAL_ERROR");
    expect(JSON.parse(raw).error.message).toBe("Không thể hoàn tất yêu cầu.");
  });
});

import { describe, expect, it, vi } from "vitest";
import { InvalidLoginCodeError } from "@/modules/auth/login-service";
import { SessionAuthError } from "@/modules/auth/session";
import { RateLimitExceededError } from "@/modules/onboarding/service";
import {
  ReminderNotFoundError,
  type PublicReminder,
} from "@/modules/reminders/api-service";
import { createRouter, type WorkerOperations } from "../router";

const ORIGIN = "https://calenote.iconiclogs.com";
const MASTER_KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const COOKIE = `__Host-calenote_session=${"A".repeat(43)}`;
const CONNECTION_PUBLIC_ID = "A".repeat(22);
const REMINDER_PUBLIC_ID = "B".repeat(21) + "Q";

function context(): ExecutionContext {
  return { waitUntil: vi.fn(), passThroughOnException: vi.fn() } as unknown as ExecutionContext;
}

function environment() {
  const assets = { fetch: vi.fn(async () => new Response("asset", { status: 404 })) };
  return {
    assets,
    env: {
      APP_ORIGIN: ORIGIN,
      ASSETS: assets,
    } as unknown as Env,
  };
}

const reminder: PublicReminder = {
  publicId: REMINDER_PUBLIC_ID,
  title: "Gọi cho mẹ",
  scheduledAt: 1_800_000_000_000,
  timezone: "Asia/Ho_Chi_Minh",
  status: "PENDING",
};

function operations(overrides: Partial<WorkerOperations> = {}): WorkerOperations {
  return {
    digestRateLimitSubject: vi.fn(async () => "N8MKPqjdJlR9xUXwupHi_Z45pMG4W0IBZwgHR3SNo1g"),
    consumeOnboardingRateLimit: vi.fn(async () => ({ allowed: true, resetAt: 1_800_000_000_000 })),
    onboard: vi.fn(),
    requestLoginCode: vi.fn(async () => ({ accepted: true as const })),
    verifyLoginCode: vi.fn(async () => ({ cookie: `${COOKIE}; HttpOnly; Secure; SameSite=Lax; Path=/` })),
    logout: vi.fn(async () => ({ clearCookie: "__Host-calenote_session=; Max-Age=0; HttpOnly; Secure; SameSite=Lax; Path=/" })),
    requireUser: vi.fn(async () => ({ userId: "user-owner" })),
    getSessionUser: vi.fn(async () => ({
      displayName: "Bích Tuyền",
      email: "owner@example.com",
      timezone: "Asia/Ho_Chi_Minh" as const,
    })),
    listConnections: vi.fn(async () => [{
      publicId: CONNECTION_PUBLIC_ID,
      provider: "telegram" as const,
      displayName: "Mây",
      handle: "@may_bot",
      state: "ACTIVE_BOUND" as const,
    }]),
    rotateConnectCode: vi.fn(async () => ({
      command: "/connect ABCDEFGHJKLMNPQRSTUVWXYZ23",
      expiresAt: 1_800_000_000_000,
    })),
    retryWebhook: vi.fn(async () => ({
      connection: {
        publicId: CONNECTION_PUBLIC_ID,
        provider: "telegram" as const,
        displayName: "Mây",
        handle: "@may_bot",
        state: "ACTIVE_UNBOUND" as const,
      },
      connectCommand: "/connect ABCDEFGHJKLMNPQRSTUVWXYZ23",
      expiresAt: 1_800_000_000_000,
    })),
    listReminders: vi.fn(async () => [reminder]),
    createReminder: vi.fn(async () => reminder),
    cancelReminder: vi.fn(async () => ({ cancelled: true as const })),
    ...overrides,
  };
}

function mutation(pathname: string, body: unknown, headers: HeadersInit = {}): Request {
  return new Request(`${ORIGIN}${pathname}`, {
    method: "POST",
    headers: {
      origin: ORIGIN,
      "content-type": "application/json",
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function authenticatedMutation(
  pathname: string,
  body: unknown,
  method: "POST" | "DELETE" = "POST",
  headers: HeadersInit = {},
): Request {
  const request = mutation(pathname, body, { cookie: COOKIE, ...headers });
  return new Request(request, { method });
}

function expectJsonHeaders(response: Response, authenticated = false): void {
  expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expect(response.headers.has("access-control-allow-origin")).toBe(false);
  if (authenticated) expect(response.headers.get("vary")).toBe("Cookie");
}

describe("Task 8 exact browser API contract", () => {
  it("normalizes a valid email and trusts only CF-Connecting-IP for generic request-code", async () => {
    const ops = operations();
    const { env, assets } = environment();
    const response = await createRouter({ operations: async () => ops })(
      mutation("/api/auth/request-code", { email: "  Owner@Example.COM " }, {
        "CF-Connecting-IP": "203.0.113.9",
        "X-Forwarded-For": "198.51.100.4",
      }),
      env,
      context(),
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ data: { accepted: true } });
    expectJsonHeaders(response);
    expect(ops.requestLoginCode).toHaveBeenCalledWith({
      email: "owner@example.com",
      clientIp: "203.0.113.9",
    });
    expect(assets.fetch).not.toHaveBeenCalled();
  });

  it.each([
    { label: "missing DB", patch: { DB: undefined } },
    { label: "bad DB shape", patch: { DB: {} } },
    { label: "missing JOBS", patch: { JOBS: undefined } },
    { label: "bad JOBS shape", patch: { JOBS: {} } },
    { label: "missing APP_ORIGIN", patch: { APP_ORIGIN: undefined } },
    { label: "bad APP_ORIGIN", patch: { APP_ORIGIN: "https://other.example" } },
    { label: "missing master key", patch: { CALENOTE_MASTER_KEY: undefined } },
    { label: "bad master key shape", patch: { CALENOTE_MASTER_KEY: "not-a-key" } },
  ])("maps real-factory $label construction failure to exact safe readiness response", async ({ patch }) => {
    const prepare = vi.fn(() => { throw new Error("account lookup must not happen"); });
    const send = vi.fn();
    const assets = { fetch: vi.fn(async () => new Response("asset")) };
    const env = {
      APP_ORIGIN: ORIGIN,
      CALENOTE_MASTER_KEY: MASTER_KEY,
      DB: { prepare, batch: vi.fn() },
      JOBS: { send },
      ASSETS: assets,
      ...patch,
    } as unknown as Env;

    const response = await createRouter()(
      mutation("/api/auth/request-code", { email: "owner@example.com" }, {
        "CF-Connecting-IP": "203.0.113.9",
      }),
      env,
      context(),
    );

    expect(response.status).toBe(503);
    expectJsonHeaders(response);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "SERVICE_UNAVAILABLE",
        message: "Calenote đang tạm thời không sẵn sàng.",
      },
    });
    expect(prepare).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("keeps an unexpected injected operation factory failure as generic 500", async () => {
    const response = await createRouter({
      operations: async () => { throw new Error("unexpected construction bug"); },
    })(
      mutation("/api/auth/request-code", { email: "owner@example.com" }),
      environment().env,
      context(),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: { code: "INTERNAL_ERROR", message: "Không thể hoàn tất yêu cầu." },
    });
  });

  it.each([
    {
      label: "wrong origin",
      request: mutation("/api/auth/request-code", { email: "owner@example.com" }, { origin: "https://evil.example" }),
      status: 403,
    },
    {
      label: "wrong media",
      request: mutation("/api/auth/request-code", { email: "owner@example.com" }, { "content-type": "text/plain" }),
      status: 415,
    },
    {
      label: "oversized",
      request: mutation("/api/auth/request-code", { email: "owner@example.com" }, { "content-length": "1025" }),
      status: 413,
    },
    {
      label: "extra field",
      request: mutation("/api/auth/request-code", { email: "owner@example.com", reveal: true }),
      status: 400,
    },
    {
      label: "invalid email",
      request: mutation("/api/auth/request-code", { email: "not-an-email" }),
      status: 400,
    },
  ])("rejects $label before login operations", async ({ request, status }) => {
    const ops = operations();
    const factory = vi.fn(async () => ops);
    const response = await createRouter({ operations: factory })(request, environment().env, context());
    expect(response.status).toBe(status);
    expect(ops.requestLoginCode).not.toHaveBeenCalled();
    expect(factory).not.toHaveBeenCalled();
    expectJsonHeaders(response);
  });

  it("verifies exactly six digits and emits a secure cookie only after service success", async () => {
    const ops = operations();
    const response = await createRouter({ operations: async () => ops })(
      mutation("/api/auth/verify-code", { email: "Owner@Example.com", code: "012345" }, {
        "CF-Connecting-IP": "203.0.113.9",
      }),
      environment().env,
      context(),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ data: { authenticated: true } });
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(ops.verifyLoginCode).toHaveBeenCalledWith({
      email: "owner@example.com",
      code: "012345",
      clientIp: "203.0.113.9",
    });

    const invalidOps = operations({
      verifyLoginCode: vi.fn(async () => { throw new InvalidLoginCodeError(); }),
    });
    const invalid = await createRouter({ operations: async () => invalidOps })(
      mutation("/api/auth/verify-code", { email: "owner@example.com", code: "999999" }),
      environment().env,
      context(),
    );
    expect(invalid.status).toBe(401);
    expect(invalid.headers.has("set-cookie")).toBe(false);
    await expect(invalid.json()).resolves.toEqual({
      error: {
        code: "INVALID_LOGIN_CODE",
        message: "Mã đăng nhập không hợp lệ hoặc đã hết hạn.",
      },
    });
  });

  it.each(["12345", "1234567", "１２３４５６", "12345a"]) (
    "rejects non-six-ASCII-digit proof %s before operations",
    async (code) => {
      const ops = operations();
      const factory = vi.fn(async () => ops);
      const response = await createRouter({ operations: factory })(
        mutation("/api/auth/verify-code", { email: "owner@example.com", code }),
        environment().env,
        context(),
      );
      expect(response.status).toBe(400);
      expect(factory).not.toHaveBeenCalled();
    },
  );

  it("logs out idempotently, and never claims success when D1 revoke fails", async () => {
    const ops = operations();
    const response = await createRouter({ operations: async () => ops })(
      authenticatedMutation("/api/auth/logout", {}),
      environment().env,
      context(),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
    await expect(response.json()).resolves.toEqual({ data: { loggedOut: true } });

    const missing = await createRouter({ operations: async () => ops })(
      mutation("/api/auth/logout", {}),
      environment().env,
      context(),
    );
    expect(missing.status).toBe(200);
    expect(missing.headers.get("set-cookie")).toContain("Max-Age=0");

    const failing = operations({ logout: vi.fn(async () => { throw new Error("D1 unavailable"); }) });
    const failed = await createRouter({ operations: async () => failing })(
      authenticatedMutation("/api/auth/logout", {}),
      environment().env,
      context(),
    );
    expect(failed.status).toBe(500);
    expect(failed.headers.has("set-cookie")).toBe(false);
    expect(await failed.text()).not.toContain("D1 unavailable");
  });

  it("returns only safe authenticated session, connection, and reminder fields", async () => {
    const ops = operations();
    const router = createRouter({ operations: async () => ops });
    const { env } = environment();
    const get = (path: string) => router(new Request(`${ORIGIN}${path}`, {
      headers: { cookie: COOKIE },
    }), env, context());

    const session = await get("/api/session");
    expect(session.status).toBe(200);
    expectJsonHeaders(session, true);
    await expect(session.json()).resolves.toEqual({ data: { user: {
      displayName: "Bích Tuyền",
      email: "owner@example.com",
      timezone: "Asia/Ho_Chi_Minh",
    } } });

    const connections = await get("/api/connections");
    expectJsonHeaders(connections, true);
    await expect(connections.json()).resolves.toEqual({ data: { connections: [{
      publicId: CONNECTION_PUBLIC_ID,
      provider: "telegram",
      displayName: "Mây",
      handle: "@may_bot",
      state: "ACTIVE_BOUND",
    }] } });

    const reminders = await get("/api/reminders");
    expectJsonHeaders(reminders, true);
    await expect(reminders.json()).resolves.toEqual({ data: { reminders: [reminder] } });
  });

  it("requires a session before resource operations and keeps malformed cookies out of D1", async () => {
    const ops = operations();
    const factory = vi.fn(async () => ops);
    for (const path of ["/api/session", "/api/connections", "/api/reminders"]) {
      for (const cookie of [undefined, "__Host-calenote_session=bad!"]) {
        const headers = cookie ? { cookie } : undefined;
        const response = await createRouter({ operations: factory })(
          new Request(`${ORIGIN}${path}`, { headers }),
          environment().env,
          context(),
        );
        expect(response.status).toBe(401);
        expect(response.headers.get("vary")).toBe("Cookie");
      }
    }
    expect(factory).not.toHaveBeenCalled();
  });

  it("creates and cancels reminders with strict tenant-free request bodies", async () => {
    const ops = operations();
    const router = createRouter({ operations: async () => ops });
    const { env } = environment();
    const create = await router(authenticatedMutation("/api/reminders", {
      title: "Gọi cho mẹ",
      scheduledAt: reminder.scheduledAt,
      timezone: "Asia/Ho_Chi_Minh",
    }), env, context());
    expect(create.status).toBe(201);
    expectJsonHeaders(create, true);
    await expect(create.json()).resolves.toEqual({ data: { reminder } });
    expect(ops.createReminder).toHaveBeenCalledWith({
      userId: "user-owner",
      title: "Gọi cho mẹ",
      scheduledAt: reminder.scheduledAt,
      timezone: "Asia/Ho_Chi_Minh",
    });

    const cancel = await router(authenticatedMutation(
      `/api/reminders/${REMINDER_PUBLIC_ID}`,
      {},
      "DELETE",
    ), env, context());
    expect(cancel.status).toBe(200);
    await expect(cancel.json()).resolves.toEqual({ data: { cancelled: true } });
    expect(ops.cancelReminder).toHaveBeenCalledWith({
      userId: "user-owner",
      publicId: REMINDER_PUBLIC_ID,
    });
  });

  it.each([
    { title: "Gọi", scheduledAt: reminder.scheduledAt, timezone: "Asia/Ho_Chi_Minh", extra: true },
    { title: 7, scheduledAt: reminder.scheduledAt, timezone: "Asia/Ho_Chi_Minh" },
    { title: "Gọi", scheduledAt: "tomorrow", timezone: "Asia/Ho_Chi_Minh" },
    { title: "Gọi", scheduledAt: reminder.scheduledAt, timezone: "UTC" },
  ])("maps every invalid reminder request shape to INVALID_REMINDER", async (body) => {
    const ops = operations();
    const response = await createRouter({ operations: async () => ops })(
      authenticatedMutation("/api/reminders", body),
      environment().env,
      context(),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "INVALID_REMINDER",
        message: "Thông tin nhắc hẹn chưa hợp lệ.",
      },
    });
    expect(ops.createReminder).not.toHaveBeenCalled();
  });

  it("returns identical not-found errors for missing or foreign reminder public IDs", async () => {
    const ops = operations({
      cancelReminder: vi.fn(async () => { throw new ReminderNotFoundError(); }),
    });
    const response = await createRouter({ operations: async () => ops })(
      authenticatedMutation(`/api/reminders/${REMINDER_PUBLIC_ID}`, {}, "DELETE"),
      environment().env,
      context(),
    );
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: { code: "REMINDER_NOT_FOUND", message: "Không tìm thấy nhắc hẹn." },
    });
  });

  it.each([
    ["create", "/api/reminders", "createReminder"],
    ["cancel", `/api/reminders/${REMINDER_PUBLIC_ID}`, "cancelReminder"],
  ] as const)("maps %s reminder abuse to the exact bounded 429", async (_label, path, operation) => {
    const ops = operations({
      [operation]: vi.fn(async () => { throw new RateLimitExceededError(17); }),
    });
    const request = operation === "createReminder"
      ? authenticatedMutation(path, {
          title: "Gọi cho mẹ",
          scheduledAt: reminder.scheduledAt,
          timezone: "Asia/Ho_Chi_Minh",
        })
      : authenticatedMutation(path, {}, "DELETE");
    const response = await createRouter({ operations: async () => ops })(
      request,
      environment().env,
      context(),
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("17");
    expect(response.headers.get("vary")).toBe("Cookie");
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "RATE_LIMITED",
        message: "Bạn thao tác quá nhanh. Vui lòng thử lại sau.",
      },
    });
  });

  it("retries an owned webhook through the strict authenticated route", async () => {
    const ops = operations();
    const response = await createRouter({ operations: async () => ops })(
      authenticatedMutation(`/api/connections/${CONNECTION_PUBLIC_ID}/webhook-retry`, {}),
      environment().env,
      context(),
    );

    expect(response.status).toBe(200);
    expectJsonHeaders(response, true);
    await expect(response.json()).resolves.toEqual({ data: {
      connection: {
        publicId: CONNECTION_PUBLIC_ID,
        provider: "telegram",
        displayName: "Mây",
        handle: "@may_bot",
        state: "ACTIVE_UNBOUND",
      },
      connectCommand: "/connect ABCDEFGHJKLMNPQRSTUVWXYZ23",
      expiresAt: 1_800_000_000_000,
    } });
    expect(ops.retryWebhook).toHaveBeenCalledWith({
      userId: "user-owner",
      publicId: CONNECTION_PUBLIC_ID,
    });
  });

  it("returns safe JSON 404 for every unknown API method without touching assets", async () => {
    const { env, assets } = environment();
    const router = createRouter({ operations: async () => operations() });
    for (const request of [
      new Request(`${ORIGIN}/api/unknown`),
      new Request(`${ORIGIN}/api/session`, { method: "POST" }),
      new Request(`${ORIGIN}/api/reminders/${REMINDER_PUBLIC_ID}`, { method: "PATCH" }),
    ]) {
      const response = await router(request, env, context());
      expect(response.status).toBe(404);
      expectJsonHeaders(response);
      await expect(response.json()).resolves.toEqual({
        error: { code: "API_NOT_FOUND", message: "Không tìm thấy API." },
      });
    }
    expect(assets.fetch).not.toHaveBeenCalled();
  });

  it("maps authenticated session expiry only to UNAUTHENTICATED", async () => {
    const ops = operations({
      requireUser: vi.fn(async () => { throw new SessionAuthError(); }),
    });
    const response = await createRouter({ operations: async () => ops })(
      new Request(`${ORIGIN}/api/session`, { headers: { cookie: COOKIE } }),
      environment().env,
      context(),
    );
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: { code: "UNAUTHENTICATED", message: "Bạn cần đăng nhập để tiếp tục." },
    });
  });
});

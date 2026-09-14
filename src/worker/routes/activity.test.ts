import { describe, expect, it, vi } from "vitest";
import { SessionAuthError, type SessionCredentials } from "@/modules/auth/session";
import type { PublicActivity } from "@/contracts/api/activity";
import { createRouter, type RouterOptions } from "../router";

const origin = "https://calenote.iconiclogs.com";
const bearer = "A".repeat(43);

interface ActivityOperations {
  requireUser(credentials: SessionCredentials): Promise<{ userId: string }>;
  listActivity(userId: string): Promise<PublicActivity[]>;
}

function context(): ExecutionContext {
  return { waitUntil: vi.fn(), passThroughOnException: vi.fn() } as unknown as ExecutionContext;
}

function environment(): Env {
  return {
    APP_ORIGIN: origin,
    CALENOTE_RUNTIME_ENVIRONMENT: "production",
    ASSETS: { fetch: vi.fn(async () => new Response("asset")) },
  } as unknown as Env;
}

function request(headers: HeadersInit = {}): Request {
  return new Request(`${origin}/api/activity`, { headers });
}

function operations(overrides: Partial<ActivityOperations> = {}): ActivityOperations {
  return {
    requireUser: vi.fn(async () => ({ userId: "owner-internal" })),
    listActivity: vi.fn(async (): Promise<PublicActivity[]> => [
      { action: "REMINDER_CREATED", createdAt: 1_800_000_000_001 },
      { action: "CONNECT_CODE_ROTATED", createdAt: 1_800_000_000_000 },
    ]),
    ...overrides,
  };
}

function router(activityOperations: (env: Env) => Promise<ActivityOperations>) {
  return createRouter({ activityOperations } as RouterOptions);
}

describe("activity route", () => {
  it("rejects a missing session before constructing activity operations", async () => {
    const factory = vi.fn(async () => operations());

    const response = await router(factory)(request(), environment(), context());

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: { code: "UNAUTHENTICATED", message: "Bạn cần đăng nhập để tiếp tục." },
    });
    expect(factory).not.toHaveBeenCalled();
  });

  it("uses only the authenticated principal and returns the public activity projection", async () => {
    const ops = operations();
    const response = await router(async () => ops)(request({
      cookie: `__Host-calenote_session=${bearer}`,
    }), environment(), context());

    expect(response.status).toBe(200);
    expect(ops.requireUser).toHaveBeenCalledWith({ bearer });
    expect(ops.listActivity).toHaveBeenCalledWith("owner-internal");
    expect(response.headers.get("vary")).toBe("Cookie");
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      data: { activities: [
        { action: "REMINDER_CREATED", createdAt: 1_800_000_000_001 },
        { action: "CONNECT_CODE_ROTATED", createdAt: 1_800_000_000_000 },
      ] },
    });
  });

  it("returns the same safe authentication error when an expired session is rejected", async () => {
    const ops = operations({ requireUser: vi.fn(async () => { throw new SessionAuthError(); }) });
    const response = await router(async () => ops)(request({
      cookie: `__Host-calenote_session=${bearer}`,
    }), environment(), context());

    expect(response.status).toBe(401);
    expect(ops.listActivity).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: { code: "UNAUTHENTICATED", message: "Bạn cần đăng nhập để tiếp tục." },
    });
  });
});

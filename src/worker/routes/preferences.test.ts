import { describe, expect, it, vi } from "vitest";
import { createRouter, type RouterOptions } from "../router";
import {
  getUserPreferences,
  saveUserPreferences,
  type UserPreferences,
  type UserPreferencesInput,
  type UserPreferencesStore,
} from "@/modules/preferences/service";
import type { SessionCredentials } from "@/modules/auth/session";

const origin = "https://calenote.iconiclogs.com";
const ownerBearer = "A".repeat(43);
const otherBearer = `${"B".repeat(42)}A`;

interface PreferencesOperations {
  requireUser(credentials: SessionCredentials): Promise<{ userId: string }>;
  getPreferences(userId: string): Promise<Omit<UserPreferences, "userId" | "updatedAt">>;
  savePreferences(input: { userId: string; preferences: UserPreferencesInput }): Promise<Omit<UserPreferences, "userId" | "updatedAt">>;
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

function request(path: string, init: RequestInit = {}): Request {
  return new Request(`${origin}${path}`, init);
}

function authenticatedRequest(path: string, bearer = ownerBearer, body?: unknown): Request {
  return request(path, {
    method: "PATCH",
    headers: {
      cookie: `__Host-calenote_session=${bearer}`,
      origin,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

function operations(): PreferencesOperations {
  const values = new Map<string, UserPreferences>();
  const store: UserPreferencesStore = {
    get: async (userId) => values.get(userId) ?? null,
    save: async (preferences) => {
      values.set(preferences.userId, preferences);
      return preferences;
    },
  };
  return {
    requireUser: async (credentials) => ({ userId: credentials.bearer === ownerBearer ? "owner" : "other" }),
    getPreferences: async (userId) => {
      const preferences = await getUserPreferences(userId, store);
      return {
        addressStyle: preferences.addressStyle,
        customDisplayName: preferences.customDisplayName,
        tone: preferences.tone,
      };
    },
    savePreferences: async ({ userId, preferences }) => {
      const saved = await saveUserPreferences(userId, preferences, store, 1_800_000_000_000);
      return {
        addressStyle: saved.addressStyle,
        customDisplayName: saved.customDisplayName,
        tone: saved.tone,
      };
    },
  };
}

function router(preferences: PreferencesOperations) {
  return createRouter({
    preferencesOperations: async () => preferences,
  } as RouterOptions);
}

describe("preferences routes", () => {
  it("round trips account confirmation mode through authenticated API and real SQLite", async () => {
    const { SqliteD1Database } = await import("@/testing/sqlite-d1.test-support");
    const { D1UserPreferencesStore } = await import("@/modules/db/preferences-store");
    const db = new SqliteD1Database({ conversationV2: true });
    try {
      db.sqlite.exec("INSERT INTO users(id,email,display_name,timezone,created_at,updated_at) VALUES('owner','owner@example.test','Owner','Asia/Ho_Chi_Minh',1,1),('other','other@example.test','Other','Asia/Ho_Chi_Minh',1,1)");
      const store = new D1UserPreferencesStore(db as unknown as D1Database);
      const publicValue = (value: UserPreferences) => ({ addressStyle: value.addressStyle, customDisplayName: value.customDisplayName, tone: value.tone, reminderConfirmation: value.reminderConfirmation });
      const app = router({ requireUser: operations().requireUser,
        getPreferences: async userId => publicValue(await getUserPreferences(userId, store)),
        savePreferences: async ({ userId, preferences }) => publicValue(await saveUserPreferences(userId, preferences, store, 100)) });
      const saved = await app(authenticatedRequest("/api/preferences", ownerBearer, { reminderConfirmation: "preview" }), environment(), context());
      expect(saved.status).toBe(200);
      expect(await saved.json()).toMatchObject({ data: { preferences: { reminderConfirmation: "preview" } } });
      for (const [bearer, mode] of [[ownerBearer, "preview"], [otherBearer, "auto"]]) {
        const response = await app(request("/api/preferences", { headers: { cookie: `__Host-calenote_session=${bearer}` } }), environment(), context());
        expect(await response.json()).toMatchObject({ data: { preferences: { reminderConfirmation: mode } } });
      }
      expect((await app(authenticatedRequest("/api/preferences", ownerBearer, { reminderConfirmation: "invalid" }), environment(), context())).status).toBe(400);
    } finally { db.close(); }
  });
  it("rejects unauthenticated preference reads before constructing operations", async () => {
    const factory = vi.fn(async () => operations());
    const response = await createRouter({ preferencesOperations: factory } as RouterOptions)(
      request("/api/preferences"), environment(), context(),
    );

    expect(response.status).toBe(401);
    expect(factory).not.toHaveBeenCalled();
  });

  it("returns stable defaults for an authenticated user", async () => {
    const response = await router(operations())(
      request("/api/preferences", { headers: { cookie: `__Host-calenote_session=${ownerBearer}` } }),
      environment(), context(),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: { preferences: { addressStyle: "ban", customDisplayName: null, tone: "friendly" } },
    });
  });

  it("saves valid presentation preferences for the authenticated user", async () => {
    const response = await router(operations())(authenticatedRequest("/api/preferences", ownerBearer, {
      addressStyle: "custom", customDisplayName: "  Chị Tuyền  ", tone: "professional",
    }), environment(), context());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: { preferences: { addressStyle: "custom", customDisplayName: "Chị Tuyền", tone: "professional" } },
    });
  });

  it.each([
    { addressStyle: "friend" },
    { tone: "chatty" },
    { addressStyle: "custom", customDisplayName: "   " },
  ])("rejects invalid preference input %#", async (body) => {
    const response = await router(operations())(authenticatedRequest("/api/preferences", ownerBearer, body), environment(), context());

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: { code: "INVALID_PREFERENCES", message: "Tùy chọn hiển thị chưa hợp lệ." },
    });
  });

  it.each([
    {
      label: "cross-origin request",
      request: request("/api/preferences", {
        method: "PATCH",
        headers: {
          cookie: `__Host-calenote_session=${ownerBearer}`,
          origin: "https://evil.example",
          "content-type": "application/json",
        },
        body: JSON.stringify({ tone: "playful" }),
      }),
      status: 403,
      code: "ORIGIN_REJECTED",
    },
    {
      label: "malformed content type",
      request: request("/api/preferences", {
        method: "PATCH",
        headers: {
          cookie: `__Host-calenote_session=${ownerBearer}`,
          origin,
          "content-type": "text/plain",
        },
        body: JSON.stringify({ tone: "playful" }),
      }),
      status: 415,
      code: "UNSUPPORTED_MEDIA_TYPE",
    },
    {
      label: "oversized body",
      request: request("/api/preferences", {
        method: "PATCH",
        headers: {
          cookie: `__Host-calenote_session=${ownerBearer}`,
          origin,
          "content-type": "application/json",
          "content-length": "2049",
        },
        body: JSON.stringify({ tone: "playful" }),
      }),
      status: 413,
      code: "REQUEST_TOO_LARGE",
    },
  ])("rejects $label before saving", async ({ request: update, status, code }) => {
    const response = await router(operations())(update, environment(), context());

    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toMatchObject({ error: { code } });
  });

  it("keeps each user preference update isolated", async () => {
    const app = router(operations());
    await app(authenticatedRequest("/api/preferences", ownerBearer, { tone: "playful" }), environment(), context());
    await app(authenticatedRequest("/api/preferences", otherBearer, { tone: "concise" }), environment(), context());
    const owner = await app(request("/api/preferences", {
      headers: { cookie: `__Host-calenote_session=${ownerBearer}` },
    }), environment(), context());

    await expect(owner.json()).resolves.toEqual({
      data: { preferences: { addressStyle: "ban", customDisplayName: null, tone: "playful" } },
    });
  });
});

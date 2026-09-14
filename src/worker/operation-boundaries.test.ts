import { describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createRouter } from "./router";
import type {
  AuthOperations,
  ActionsOperations,
  ConnectionsOperations,
  PreferencesOperations,
  RemindersOperations,
} from "./routes/operations";
import type { WebhookRouteDependencies } from "./routes/webhooks";

const origin = "https://calenote.iconiclogs.com";
const cookie = `__Host-calenote_session=${"A".repeat(43)}`;
const publicId = "A".repeat(22);

function context(): ExecutionContext {
  return { waitUntil: vi.fn(), passThroughOnException: vi.fn() } as unknown as ExecutionContext;
}

function environment(): Env {
  return {
    APP_ORIGIN: origin,
    CALENOTE_RUNTIME_ENVIRONMENT: "production",
    ASSETS: { fetch: vi.fn(async () => new Response("asset", { status: 404 })) },
  } as unknown as Env;
}

function authOperations(): AuthOperations {
  return {
    requestLoginCode: vi.fn(async () => ({ accepted: true as const })),
    verifyLoginCode: vi.fn(async () => ({ cookie })),
    logout: vi.fn(async () => ({ clearCookie: "__Host-calenote_session=; Max-Age=0" })),
    requireUser: vi.fn(async () => ({ userId: "user-1" })),
    getSessionUser: vi.fn(async () => ({
      displayName: "Bich Tuyen",
      email: "owner@example.com",
      timezone: "Asia/Ho_Chi_Minh" as const,
    })),
  };
}

function connectionsOperations(): ConnectionsOperations {
  return {
    requireUser: vi.fn(async () => ({ userId: "user-1" })),
    listConnections: vi.fn(async () => []),
    rotateConnectCode: vi.fn(async () => ({ command: "/connect ABC", expiresAt: 1_700_000_000_000 })),
    retryWebhook: vi.fn(async () => ({
      connection: {
        publicId,
        provider: "telegram" as const,
        displayName: "May",
        handle: null,
        state: "ACTIVE_UNBOUND" as const,
      },
      connectCommand: "/connect ABC",
      expiresAt: 1_700_000_000_000,
    })),
    runZaloPollDiagnostic: vi.fn(async () => ({
      pollProbeStarted: true, webhookRemoved: true, pollUpdateReceived: false,
      pollEventName: "NONE" as const, pollPrivateChat: false, webhookRestored: true,
      restoredHostMatch: true, restoredPathPrefixMatch: true, restoreTestOk: true,
    })),
  };
}

function remindersOperations(): RemindersOperations {
  return {
    requireUser: vi.fn(async () => ({ userId: "user-1" })),
    listReminders: vi.fn(async () => []),
    createReminder: vi.fn(),
    cancelReminder: vi.fn(async () => ({ cancelled: true as const })),
  };
}

function actionsOperations(): ActionsOperations {
  return {
    requireUser: vi.fn(async () => ({ userId: "user-1" })),
    listPendingActions: vi.fn(async () => []),
    approveAction: vi.fn(async () => ({ status: "REJECTED" as const })),
    rejectAction: vi.fn(async () => ({ status: "REJECTED" as const })),
  };
}

function preferencesOperations(): PreferencesOperations {
  return {
    requireUser: vi.fn(async () => ({ userId: "user-1" })),
    getPreferences: vi.fn(async () => ({
      addressStyle: "ban" as const, customDisplayName: null, tone: "friendly" as const,
    })),
    savePreferences: vi.fn(async ({ preferences }) => ({
      addressStyle: preferences.addressStyle ?? "ban", customDisplayName: preferences.customDisplayName ?? null,
      tone: preferences.tone ?? "friendly",
    })),
  };
}

function webhookOperations(): WebhookRouteDependencies {
  return {
    findConnection: vi.fn(async () => ({ id: "connection-1", provider: "telegram" as const, publicId })),
    webhookSecrets: vi.fn(async () => ({ pathSecret: `${"B".repeat(42)}A`, headerSecret: `${"C".repeat(42)}A` })),
    constantTimeEqual: (left, right) => left === right,
    accept: vi.fn(async () => ({ status: 204 as const })),
  };
}

describe("Worker operation boundaries", () => {
  it("keeps all route-facing operation contracts free of runtime and web request types", async () => {
    const [operations, webhooks] = await Promise.all([
      readFile(resolve(process.cwd(), "src/worker/routes/operations.ts"), "utf8"),
      readFile(resolve(process.cwd(), "src/worker/routes/webhooks.ts"), "utf8"),
    ]);
    const webhookContract = webhooks.match(/export interface WebhookRouteDependencies \{[\s\S]*?\n\}/u)?.[0];

    for (const source of [operations, webhookContract]) {
      expect(source).toBeDefined();
      expect(source).not.toMatch(/\b(Request|Env|D1|[Kk]eyring)\b/u);
    }
  });

  it("keeps D1 construction out of the preferences controller", async () => {
    const controller = await readFile(resolve(process.cwd(), "src/worker/routes/preferences.ts"), "utf8");

    expect(controller).not.toMatch(/\bD1[A-Za-z]+\b/u);
  });

  it("dispatches an auth route with an auth-only capability fake", async () => {
    const auth = authOperations();
    const authFactory = vi.fn(async () => auth);
    const response = await createRouter({ authOperations: authFactory })(
      new Request(`${origin}/api/auth/request-code`, {
        method: "POST",
        headers: { origin, "content-type": "application/json", "CF-Connecting-IP": "203.0.113.9" },
        body: JSON.stringify({ email: "owner@example.com" }),
      }),
      environment(),
      context(),
    );

    expect(response.status).toBe(202);
    expect(authFactory).toHaveBeenCalledTimes(1);
    expect(auth.requestLoginCode).toHaveBeenCalledWith({ email: "owner@example.com", clientIp: "203.0.113.9" });
  });

  it("dispatches a connection route without constructing auth, reminder, or onboarding capabilities", async () => {
    const connections = connectionsOperations();
    const unrelatedFactory = vi.fn();
    const response = await createRouter({
      connectionsOperations: async () => connections,
      authOperations: unrelatedFactory,
      remindersOperations: unrelatedFactory,
      onboardingOperations: unrelatedFactory,
    })(new Request(`${origin}/api/connections`, { headers: { cookie } }), environment(), context());

    expect(response.status).toBe(200);
    expect(connections.listConnections).toHaveBeenCalledWith("user-1");
    expect(unrelatedFactory).not.toHaveBeenCalled();
  });

  it("dispatches a reminder route with a reminder-only capability fake", async () => {
    const reminders = remindersOperations();
    const response = await createRouter({ remindersOperations: async () => reminders })(
      new Request(`${origin}/api/reminders`, { headers: { cookie } }),
      environment(),
      context(),
    );

    expect(response.status).toBe(200);
    expect(reminders.listReminders).toHaveBeenCalledWith("user-1");
  });

  it("dispatches an action route with an injectable actions-only capability fake", async () => {
    const actions = actionsOperations();
    const unrelatedFactory = vi.fn();
    const response = await createRouter({
      actionsOperations: async () => actions,
      authOperations: unrelatedFactory,
      remindersOperations: unrelatedFactory,
      connectionsOperations: unrelatedFactory,
      onboardingOperations: unrelatedFactory,
    })(new Request(`${origin}/api/actions`, { headers: { cookie } }), environment(), context());

    expect(response.status).toBe(200);
    expect(actions.listPendingActions).toHaveBeenCalledWith("user-1");
    expect(unrelatedFactory).not.toHaveBeenCalled();
  });

  it("dispatches a preferences route with an injectable preferences-only capability fake", async () => {
    const preferences = preferencesOperations();
    const unrelatedFactory = vi.fn();
    const response = await createRouter({
      preferencesOperations: async () => preferences,
      authOperations: unrelatedFactory,
      actionsOperations: unrelatedFactory,
      remindersOperations: unrelatedFactory,
      connectionsOperations: unrelatedFactory,
      onboardingOperations: unrelatedFactory,
    })(new Request(`${origin}/api/preferences`, { headers: { cookie } }), environment(), context());

    expect(response.status).toBe(200);
    expect(preferences.getPreferences).toHaveBeenCalledWith("user-1");
    expect(unrelatedFactory).not.toHaveBeenCalled();
  });

  it("injects webhook dependencies independently of browser API capabilities", async () => {
    const webhook = webhookOperations();
    const response = await createRouter({ webhookOperations: async () => webhook })(
      new Request(`${origin}/webhooks/telegram/${publicId}/${"B".repeat(42)}A`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "X-Telegram-Bot-Api-Secret-Token": `${"C".repeat(42)}A`,
        },
        body: "{}",
      }),
      environment(),
      context(),
    );

    expect(response.status).toBe(204);
    expect(webhook.accept).toHaveBeenCalledTimes(1);
  });

  it("exposes each browser route capability from the composition root without runtime bindings", async () => {
    const root = await import("./composition-root");
    const env = {
      ...environment(),
      CALENOTE_MASTER_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      DB: { prepare: vi.fn(), batch: vi.fn() },
      JOBS: { send: vi.fn() },
    } as unknown as Env;

    const [auth, actions, connections, preferences, reminders, onboarding] = await Promise.all([
      root.createAuthOperations(env),
      root.createActionsOperations(env),
      root.createConnectionsOperations(env),
      root.createPreferencesOperations(env),
      root.createRemindersOperations(env),
      root.createOnboardingOperations(env),
    ]);

    for (const capability of [auth, actions, connections, preferences, reminders, onboarding]) {
      expect(capability).not.toHaveProperty("env");
      expect(capability).not.toHaveProperty("DB");
      expect(capability).not.toHaveProperty("keyring");
    }
  });
});

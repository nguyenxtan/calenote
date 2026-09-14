import { describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const masterKey = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

function environment(): Env {
  return {
    APP_ORIGIN: "https://calenote.iconiclogs.com",
    CALENOTE_RUNTIME_ENVIRONMENT: "production",
    CALENOTE_MASTER_KEY: masterKey,
    ASSETS: { fetch: vi.fn() },
    DB: { prepare: vi.fn(), batch: vi.fn() },
    JOBS: { send: vi.fn() },
  } as unknown as Env;
}

describe("Worker composition root", () => {
  // The complete composition path performs several Web Crypto keyring setups;
  // under the parallel Worker suite it needs an explicit integration budget.
  it("constructs runtime, route capability, and webhook operation boundaries", async () => {
    const root = await import("./composition-root");
    const env = environment();

    await expect(root.createRuntimeOperations(env)).resolves.toEqual(expect.objectContaining({
      processInbound: expect.any(Function),
      deliverReminder: expect.any(Function),
      deliverLoginCode: expect.any(Function),
      claimDueReminders: expect.any(Function),
      redriveInboundOrphans: expect.any(Function),
      redriveLoginCodes: expect.any(Function),
    }));
    await expect(root.createAuthOperations(env)).resolves.toEqual(expect.objectContaining({
      requireUser: expect.any(Function),
      requestLoginCode: expect.any(Function),
      verifyLoginCode: expect.any(Function),
    }));
    await expect(root.createConnectionsOperations(env)).resolves.toEqual(expect.objectContaining({
      requireUser: expect.any(Function),
      listConnections: expect.any(Function),
      rotateConnectCode: expect.any(Function),
    }));
    await expect(root.createRemindersOperations(env)).resolves.toEqual(expect.objectContaining({
      requireUser: expect.any(Function),
      listReminders: expect.any(Function),
      createReminder: expect.any(Function),
      cancelReminder: expect.any(Function),
    }));
    await expect(root.createActionsOperations(env)).resolves.toEqual(expect.objectContaining({
      requireUser: expect.any(Function),
      listPendingActions: expect.any(Function),
      approveAction: expect.any(Function),
      rejectAction: expect.any(Function),
    }));
    await expect(root.createPreferencesOperations(env)).resolves.toEqual(expect.objectContaining({
      requireUser: expect.any(Function),
      getPreferences: expect.any(Function),
      savePreferences: expect.any(Function),
    }));
    await expect(root.createOnboardingOperations(env)).resolves.toEqual(expect.objectContaining({
      digestRateLimitSubject: expect.any(Function),
      consumeOnboardingRateLimit: expect.any(Function),
      onboard: expect.any(Function),
    }));
    await expect(root.createWebhookOperations(env)).resolves.toEqual(expect.objectContaining({
      findConnection: expect.any(Function),
      webhookSecrets: expect.any(Function),
      accept: expect.any(Function),
    }));
    await expect(root.createIntelligenceGateway()).resolves.toEqual(expect.objectContaining({
      interpretReminder: expect.any(Function),
      extractAction: expect.any(Function),
    }));
  }, 10_000);

  it("rejects invalid runtime bindings before creating a route operation", async () => {
    const root = await import("./composition-root");
    await expect(root.createAuthOperations({ ...environment(), DB: undefined } as unknown as Env))
      .rejects.toMatchObject({ name: "ServiceUnavailableError" });
  });

  it("selects the configured optional intelligence mode instead of forcing it off", async () => {
    const root = await import("./composition-root") as typeof import("./composition-root") & {
      createIntelligenceCapability?: (env: Env) => Promise<{ mode: "off" | "free" | "privacy" }>;
    };

    expect(root.createIntelligenceCapability).toEqual(expect.any(Function));
    await expect(root.createIntelligenceCapability!({
      ...environment(),
      AI_MODE: "privacy",
      OPENROUTER_API_KEY: "test-only-key",
      OPENROUTER_PRIVACY_MODEL: "google/gemini-3.5-flash-lite",
      OPENROUTER_PRIVACY_PROVIDER: "google-vertex/global/flex",
      AI_MAX_PRIVACY_PRICE: "1.5",
    } as unknown as Env)).resolves.toMatchObject({ mode: "privacy" });
  });

  it("keeps concrete Worker dependency construction inside the composition root", async () => {
    const routerSource = await readFile(resolve(process.cwd(), "src/worker/router.ts"), "utf8");
    const entrypointSource = await readFile(resolve(process.cwd(), "src/worker/index.ts"), "utf8");
    expect(routerSource).not.toContain("new D1OnboardingStore(");
    expect(routerSource).not.toContain("new D1ReminderApiStore(");
    expect(routerSource).not.toContain("new D1SourceActionStore(");
    expect(routerSource).not.toContain("new D1UserPreferencesStore(");
    expect(routerSource).not.toContain("await createKeyring(");
    expect(entrypointSource).not.toContain("new D1InboundProcessorStore(");
    expect(entrypointSource).not.toContain("await createKeyring(");
  });
});

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

  it("composes the pinned privacy-only Semantic V1 capability", async () => {
    const root = await import("./composition-root") as typeof import("./composition-root") & {
      createSemanticCapability?: (env: Env) => Promise<{ mode: "off" | "privacy"; gateway: { prepare: (tier: "PRIMARY", input: unknown) => unknown } }>;
    };
    expect(root.createSemanticCapability).toEqual(expect.any(Function));
    const capability = await root.createSemanticCapability!({
      ...environment(),
      AI_MODE: "privacy",
      OPENROUTER_API_KEY: "test-only-key",
      OPENROUTER_PRIVACY_MODEL: "google/gemini-2.5-flash-lite",
      OPENROUTER_PRIVACY_PROVIDER: "google-vertex/eu",
      AI_MAX_PRIVACY_PRICE: "0.4",
    } as unknown as Env);
    expect(capability).toMatchObject({ mode: "privacy" });
    expect(capability?.gateway.prepare("PRIMARY", {
      text: "nhắc việc", referenceLocalDate: "2026-09-16", referenceLocalTime: "09:00", timezone: "Asia/Ho_Chi_Minh",
    })).toMatchObject({ status: "READY", model: "google/gemini-2.5-flash-lite", provider: "google-vertex/eu" });
  });

  it("emits only whitelisted semantic outcome telemetry", async () => {
    const root = await import("./composition-root") as typeof import("./composition-root") & {
      createSemanticCapability?: (env: Env) => Promise<{ observe?: (event: unknown) => void }>;
    };
    const logged = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const capability = await root.createSemanticCapability!({
      ...environment(),
      AI_MODE: "privacy",
      OPENROUTER_API_KEY: "test-only-key",
      OPENROUTER_PRIVACY_MODEL: "google/gemini-2.5-flash-lite",
      OPENROUTER_PRIVACY_PROVIDER: "google-vertex/eu",
      AI_MAX_PRIVACY_PRICE: "0.4",
    } as unknown as Env);
    const privateValues = ["nhắc bí mật", "owner-private", "context-title", "provider-response", "test-only-key"];
    expect(capability.observe).toEqual(expect.any(Function));
    const invokeWithUntrustedRuntimeValue = capability.observe as unknown as ((event: unknown) => void);
    invokeWithUntrustedRuntimeValue({ requestDispatched: true, tier: "PRIMARY", model: "fixture/model", provider: "fixture-provider",
      latencyMs: 12, resultCategory: "PRIMARY_PROVIDER_FAILURE", schemaValid: null, fallbackUsed: false,
      text: privateValues[0], ownerId: privateValues[1], title: privateValues[2], response: privateValues[3], apiKey: privateValues[4] });
    const serialized = logged.mock.calls.map((args) => args.join(" ")).join("\n");
    for (const privateValue of privateValues) expect(serialized).not.toContain(privateValue);
    expect(serialized).toContain("semantic_interpretation");
    expect(serialized).toContain("PRIMARY_PROVIDER_FAILURE");
  });

  it("composes an explicit disabled Semantic V1 boundary when the privacy route is off or unapproved", async () => {
    const root = await import("./composition-root") as typeof import("./composition-root") & {
      createSemanticCapability?: (env: Env) => Promise<{ mode: "off" | "privacy"; gateway: { prepare: (tier: "PRIMARY", input: unknown) => unknown } }>;
    };
    const off = await root.createSemanticCapability!(environment());
    const wrongRoute = await root.createSemanticCapability!({
      ...environment(), AI_MODE: "privacy", OPENROUTER_API_KEY: "test-only-key",
      OPENROUTER_PRIVACY_MODEL: "google/gemini-2.5-flash-lite", OPENROUTER_PRIVACY_PROVIDER: "google-vertex/global",
      AI_MAX_PRIVACY_PRICE: "0.4",
    } as unknown as Env);
    expect(off.mode).toBe("off");
    expect(wrongRoute.mode).toBe("off");
    expect(wrongRoute.gateway.prepare("PRIMARY", {
      text: "nhắc việc", referenceLocalDate: "2026-09-16", referenceLocalTime: "09:00", timezone: "Asia/Ho_Chi_Minh",
    })).toMatchObject({ status: "FAILURE", category: "UNAVAILABLE" });
  });

  it("stops reading a chunked provider response at the configured semantic byte ceiling", async () => {
    const root = await import("./composition-root") as typeof import("./composition-root") & {
      readBoundedSemanticResponse?: (response: Response, maximumBytes: number) => Promise<{ body: string; oversized: boolean }>;
    };
    expect(root.readBoundedSemanticResponse).toEqual(expect.any(Function));
    let cancelled = false;
    const response = new Response(new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new TextEncoder().encode("x".repeat(20_001))); },
      cancel() { cancelled = true; },
    }));
    await expect(root.readBoundedSemanticResponse!(response, 20_000)).resolves.toEqual({ body: "", oversized: true });
    expect(cancelled).toBe(true);
  });

  it("cancels an oversized provider response declared before its body is read", async () => {
    const root = await import("./composition-root") as typeof import("./composition-root") & {
      readBoundedSemanticResponse?: (response: Response, maximumBytes: number) => Promise<{ body: string; oversized: boolean }>;
    };
    let cancelled = false;
    const response = new Response(new ReadableStream<Uint8Array>({
      cancel() { cancelled = true; },
    }), { headers: { "content-length": "20001" } });
    await expect(root.readBoundedSemanticResponse!(response, 20_000)).resolves.toEqual({ body: "", oversized: true });
    expect(cancelled).toBe(true);
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

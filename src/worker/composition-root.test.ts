import { describe, expect, it, vi } from "vitest";

const masterKey = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

function environment(): Env {
  return {
    APP_ORIGIN: "https://calenote.iconiclogs.com",
    CALENOTE_MASTER_KEY: masterKey,
    ASSETS: { fetch: vi.fn() },
    DB: { prepare: vi.fn(), batch: vi.fn() },
    JOBS: { send: vi.fn() },
  } as unknown as Env;
}

describe("Worker composition root", () => {
  it("constructs the existing runtime, route, and webhook operation boundaries", async () => {
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
    await expect(root.createWorkerOperations(env)).resolves.toEqual(expect.objectContaining({
      requireUser: expect.any(Function),
      listConnections: expect.any(Function),
      listReminders: expect.any(Function),
      createReminder: expect.any(Function),
      cancelReminder: expect.any(Function),
    }));
    await expect(root.createWebhookOperations(env)).resolves.toEqual(expect.objectContaining({
      findConnection: expect.any(Function),
      webhookSecrets: expect.any(Function),
      accept: expect.any(Function),
    }));
  });

  it("rejects invalid runtime bindings before creating a route operation", async () => {
    const root = await import("./composition-root");
    await expect(root.createWorkerOperations({ ...environment(), DB: undefined } as unknown as Env))
      .rejects.toMatchObject({ name: "ServiceUnavailableError" });
  });
});

// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { bytesToBase64Url } from "@/modules/security/encoding";

// Intercept the external-runtime composition boundary, not the entrypoints:
// losing an explicit capability at any deployed entrypoint must fail this test.
vi.mock("./composition-root", async importOriginal => ({
  ...await importOriginal<typeof import("./composition-root")>(),
  createRuntimeOperations: vi.fn(),
  createSeriesOperations: vi.fn(),
}));
import worker from "./index";
import { createRuntimeOperations, createSeriesOperations } from "./composition-root";

const env = { APP_ORIGIN: "https://calenote.iconiclogs.com", CALENOTE_RUNTIME_ENVIRONMENT: "production" } as Env;
const ctx = { waitUntil: vi.fn(), passThroughOnException: vi.fn() } as unknown as ExecutionContext;
const id = bytesToBase64Url(new Uint8Array(16).fill(1));
beforeEach(() => vi.resetAllMocks());

describe("authorized V2 Worker activation", () => {
  it("enables V2 for actual Queue inbound dispatch and preserves the feedback lifetime", async () => {
    const processInbound = vi.fn(async () => ({ status: "TERMINAL" as const }));
    vi.mocked(createRuntimeOperations).mockResolvedValue({
      processInbound, deliverReminder: vi.fn(), deliverLoginCode: vi.fn(),
      claimDueReminders: vi.fn(), redriveInboundOrphans: vi.fn(), redriveLoginCodes: vi.fn(),
    });
    const ack = vi.fn(), retry = vi.fn();
    const batch = { queue: "calenote-jobs", metadata: { metrics: { backlogCount: 1, backlogBytes: 64 } }, messages: [{ id: "queue-one", timestamp: new Date(), attempts: 1,
      body: { type: "PROCESS_INBOUND", inboundId: id }, ack, retry }], ackAll: vi.fn(), retryAll: vi.fn() };
    await worker.queue(batch, env, ctx);
    expect(createRuntimeOperations).toHaveBeenCalledExactlyOnceWith(env, { conversationV2: true }, ctx);
    expect(processInbound).toHaveBeenCalledExactlyOnceWith(id);
    expect(ack).toHaveBeenCalledOnce();
    expect(retry).not.toHaveBeenCalled();
  });

  it("enables V2 cleanup without dropping legacy scheduled work", async () => {
    const purgeConversationContexts = vi.fn(async () => 0);
    const claimDueReminders = vi.fn(), redriveInboundOrphans = vi.fn(), redriveLoginCodes = vi.fn();
    vi.mocked(createRuntimeOperations).mockResolvedValue({
      processInbound: vi.fn(), deliverReminder: vi.fn(), deliverLoginCode: vi.fn(),
      claimDueReminders, redriveInboundOrphans, redriveLoginCodes, purgeConversationContexts,
    });
    await worker.scheduled({ scheduledTime: 1234, cron: "* * * * *", noRetry: vi.fn() }, env, ctx);
    expect(createRuntimeOperations).toHaveBeenCalledExactlyOnceWith(env, { conversationV2: true });
    expect(purgeConversationContexts).toHaveBeenCalledExactlyOnceWith(1234, 100);
    for (const operation of [claimDueReminders, redriveInboundOrphans, redriveLoginCodes]) expect(operation).toHaveBeenCalledOnce();
  });

  it.each(["GET", "POST"])("enables V2 for authenticated HTTP series %s through the real router", async method => {
    const principal = { userId: "owner", sessionId: "session", expiresAt: Date.now() + 60_000 };
    const listSeries = vi.fn(async () => []), decideSeries = vi.fn(async () => "CONFIRMED" as const);
    vi.mocked(createSeriesOperations).mockResolvedValue({ requireUser: vi.fn(async () => principal), listSeries, decideSeries });
    const decision = { publicId: id, revision: 1, action: "CONFIRM" };
    const response = await worker.fetch(new Request(env.APP_ORIGIN + "/api/reminder-series", {
      method, headers: { Cookie: `__Host-calenote_session=${"A".repeat(43)}`, Origin: env.APP_ORIGIN, "Content-Type": "application/json" },
      ...(method === "POST" ? { body: JSON.stringify(decision) } : {}),
    }) as Request<unknown, IncomingRequestCfProperties>, env, ctx);
    expect(response.status).toBe(200);
    expect(createSeriesOperations).toHaveBeenCalledExactlyOnceWith(env, { conversationV2: true });
    if (method === "GET") {
      expect(await response.json()).toEqual({ data: { series: [] } });
      expect(listSeries).toHaveBeenCalledExactlyOnceWith(principal);
      expect(decideSeries).not.toHaveBeenCalled();
    } else {
      expect(await response.json()).toEqual({ data: { result: "CONFIRMED" } });
      expect(decideSeries).toHaveBeenCalledExactlyOnceWith(principal, decision);
    }
  });

  it("does not compose V2 storage for unauthenticated series requests", async () => {
    const response = await worker.fetch(new Request(env.APP_ORIGIN + "/api/reminder-series") as Request<unknown, IncomingRequestCfProperties>, env, ctx);
    expect(response.status).toBe(401);
    expect(createSeriesOperations).not.toHaveBeenCalled();
  });
});

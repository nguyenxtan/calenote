import { describe, expect, it, vi } from "vitest";
import type { DeliverReminderResult } from "@/modules/reminders/delivery";

const inboundId = "I".repeat(22);
const reminderId = "R".repeat(22);

async function workerModule() {
  return import("./index");
}

interface TestMessage {
  body: unknown;
  ack: ReturnType<typeof vi.fn>;
  retry: ReturnType<typeof vi.fn>;
}

function message(body: unknown): TestMessage {
  return { body, ack: vi.fn(), retry: vi.fn() };
}

function batch(messages: TestMessage[]): MessageBatch<unknown> {
  return {
    messages,
    queue: "calenote-jobs",
    ackAll: vi.fn(),
    retryAll: vi.fn(),
  } as unknown as MessageBatch<unknown>;
}

describe("strict per-message Queue dispatcher", () => {
  it("terminally acknowledges malformed or non-canonical jobs", async () => {
    const worker = await workerModule();
    expect(worker.handleQueueBatch).toBeTypeOf("function");
    const messages = [
      message(null),
      message({ type: "UNKNOWN", inboundId }),
      message({ type: "PROCESS_INBOUND", inboundId: "short" }),
      message({ type: "PROCESS_INBOUND", inboundId, extra: true }),
      message({ type: "DELIVER_REMINDER", reminderId, inboundId }),
    ];
    const operations = {
      processInbound: vi.fn(),
      deliverReminder: vi.fn(),
    };

    await worker.handleQueueBatch(batch(messages), operations);

    for (const item of messages) {
      expect(item.ack).toHaveBeenCalledTimes(1);
      expect(item.retry).not.toHaveBeenCalled();
    }
    expect(operations.processInbound).not.toHaveBeenCalled();
    expect(operations.deliverReminder).not.toHaveBeenCalled();
  });

  it("processes a mixed batch sequentially with exactly one ack or retry per message", async () => {
    const worker = await workerModule();
    expect(worker.handleQueueBatch).toBeTypeOf("function");
    const events: string[] = [];
    const messages = [
      message({ type: "PROCESS_INBOUND", inboundId }),
      message({ type: "DELIVER_REMINDER", reminderId }),
      message({ type: "DELIVER_REMINDER", reminderId: "S".repeat(22) }),
      message({ type: "PROCESS_INBOUND", inboundId: "J".repeat(22) }),
      message({ type: "bad" }),
    ];
    const operations = {
      processInbound: vi.fn(async (id: string) => {
        events.push(`inbound:${id}`);
        return id === inboundId
          ? { status: "RETRY_AFTER" as const, retryAfterMs: 1_501 }
          : { status: "TERMINAL" as const };
      }),
      deliverReminder: vi.fn(async (id: string) => {
        events.push(`delivery:${id}`);
        if (id === reminderId) {
          return { status: "RETRYABLE" as const, retryAfterSeconds: 37 };
        }
        throw new Error("safe pre-provider database failure");
      }),
    };

    await worker.handleQueueBatch(batch(messages), operations);

    expect(events).toEqual([
      `inbound:${inboundId}`,
      `delivery:${reminderId}`,
      `delivery:${"S".repeat(22)}`,
      `inbound:${"J".repeat(22)}`,
    ]);
    expect(messages[0].retry).toHaveBeenCalledExactlyOnceWith({ delaySeconds: 2 });
    expect(messages[1].retry).toHaveBeenCalledExactlyOnceWith({ delaySeconds: 37 });
    expect(messages[2].retry).toHaveBeenCalledExactlyOnceWith({ delaySeconds: 60 });
    expect(messages[3].ack).toHaveBeenCalledTimes(1);
    expect(messages[4].ack).toHaveBeenCalledTimes(1);
    for (const item of messages) {
      expect(item.ack.mock.calls.length + item.retry.mock.calls.length).toBe(1);
    }
  });

  it("never attempts a second disposition when the platform callback throws", async () => {
    const worker = await workerModule();
    const acknowledged = message({ type: "DELIVER_REMINDER", reminderId });
    acknowledged.ack.mockImplementationOnce(() => {
      throw new Error("ack unavailable");
    });

    await expect(worker.handleQueueBatch(batch([acknowledged]), {
      processInbound: vi.fn(),
      deliverReminder: vi.fn(async () => ({ status: "SENT" as const })),
    })).rejects.toThrow("ack unavailable");
    expect(acknowledged.ack).toHaveBeenCalledTimes(1);
    expect(acknowledged.retry).not.toHaveBeenCalled();

    const retried = message({ type: "DELIVER_REMINDER", reminderId });
    retried.retry.mockImplementationOnce(() => {
      throw new Error("retry unavailable");
    });
    await expect(worker.handleQueueBatch(batch([retried]), {
      processInbound: vi.fn(),
      deliverReminder: vi.fn(async () => ({
        status: "RETRYABLE" as const,
        retryAfterSeconds: 37,
      })),
    })).rejects.toThrow("retry unavailable");
    expect(retried.retry).toHaveBeenCalledTimes(1);
    expect(retried.ack).not.toHaveBeenCalled();
  });

  it("still validates and disposes every message when runtime setup fails", async () => {
    const worker = await workerModule();
    expect(worker.handleQueueEvent).toBeTypeOf("function");
    const validInbound = message({ type: "PROCESS_INBOUND", inboundId });
    const malformed = message({ type: "DELIVER_REMINDER", reminderId, extra: true });
    const validDelivery = message({ type: "DELIVER_REMINDER", reminderId });

    await worker.handleQueueEvent(
      batch([validInbound, malformed, validDelivery]),
      async () => { throw new Error("runtime unavailable"); },
    );

    expect(validInbound.retry).toHaveBeenCalledExactlyOnceWith({ delaySeconds: 60 });
    expect(malformed.ack).toHaveBeenCalledTimes(1);
    expect(validDelivery.retry).toHaveBeenCalledExactlyOnceWith({ delaySeconds: 60 });
    for (const item of [validInbound, malformed, validDelivery]) {
      expect(item.ack.mock.calls.length + item.retry.mock.calls.length).toBe(1);
    }
  });

  it.each([
    { result: { status: "MISSING" }, expected: "ack" },
    { result: { status: "SENT" }, expected: "ack" },
    { result: { status: "CANCELLED" }, expected: "ack" },
    { result: { status: "FAILED" }, expected: "ack" },
    { result: { status: "UNCERTAIN" }, expected: "ack" },
    { result: { status: "NOOP" }, expected: "ack" },
    { result: { status: "RETRY_AFTER", retryAfterSeconds: 86_401 }, expected: "retry" },
  ])("maps terminal and persisted delivery outcome $result.status independently", async ({ result, expected }) => {
    const worker = await workerModule();
    const item = message({ type: "DELIVER_REMINDER", reminderId });

    await worker.handleQueueBatch(batch([item]), {
      processInbound: vi.fn(),
      deliverReminder: vi.fn(async () => result as DeliverReminderResult),
    });

    if (expected === "ack") {
      expect(item.ack).toHaveBeenCalledTimes(1);
      expect(item.retry).not.toHaveBeenCalled();
    } else {
      expect(item.retry).toHaveBeenCalledExactlyOnceWith({ delaySeconds: 86_400 });
      expect(item.ack).not.toHaveBeenCalled();
    }
  });
});

describe("awaited minute scheduler", () => {
  it("awaits bounded reminder scheduling and inbound recovery", async () => {
    const worker = await workerModule();
    expect(worker.runScheduledWork).toBeTypeOf("function");
    const events: string[] = [];
    let finishReminders: (() => void) | undefined;
    let finishInbound: (() => void) | undefined;
    const operations = {
      claimDueReminders: vi.fn(async (scheduledAt: number, limit: number) => {
        events.push(`reminders:${scheduledAt}:${limit}:start`);
        await new Promise<void>((resolve) => { finishReminders = resolve; });
        events.push("reminders:done");
      }),
      redriveInboundOrphans: vi.fn(async (scheduledAt: number, limit: number) => {
        events.push(`inbound:${scheduledAt}:${limit}:start`);
        await new Promise<void>((resolve) => { finishInbound = resolve; });
        events.push("inbound:done");
      }),
    };
    let settled = false;
    const work = worker.runScheduledWork({
      scheduledTime: 1_800_000_000_000,
      cron: "* * * * *",
      noRetry: vi.fn(),
    } as unknown as ScheduledController, operations).then(() => { settled = true; });

    await vi.waitFor(() => expect(events).toEqual([
      "reminders:1800000000000:5:start",
    ]));
    expect(settled).toBe(false);
    finishReminders?.();
    await vi.waitFor(() => expect(events).toEqual([
      "reminders:1800000000000:5:start",
      "reminders:done",
      "inbound:1800000000000:5:start",
    ]));
    expect(settled).toBe(false);
    finishInbound?.();
    await work;

    expect(events).toEqual([
      "reminders:1800000000000:5:start",
      "reminders:done",
      "inbound:1800000000000:5:start",
      "inbound:done",
    ]);
  });
});

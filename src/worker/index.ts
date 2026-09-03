import {
  D1InboundProcessorStore,
  processInbound,
  type ProcessInboundResult,
} from "@/modules/inbound/processor";
import {
  deliverReminder,
  D1ReminderDeliveryStore,
  SAFE_QUEUE_RETRY_SECONDS,
  type DeliverReminderResult,
} from "@/modules/reminders/delivery";
import {
  claimDueReminders,
  CRON_INBOUND_LIMIT,
  CRON_REMINDER_LIMIT,
  D1InboundDispatchStore,
  D1ReminderSchedulerStore,
  redriveInboundOrphans,
  type ReminderDispatchJob,
} from "@/modules/reminders/scheduler";
import { createKeyring } from "@/modules/security/keyring";
import { routeRequest } from "./router";

const CANONICAL_ID = /^[A-Za-z0-9_-]{22}$/u;

export interface QueueOperations {
  processInbound(inboundId: string): Promise<ProcessInboundResult>;
  deliverReminder(reminderId: string): Promise<DeliverReminderResult>;
}

export interface ScheduledOperations {
  claimDueReminders(now: number, limit: number): Promise<unknown>;
  redriveInboundOrphans(now: number, limit: number): Promise<unknown>;
}

type RuntimeOperations = QueueOperations & ScheduledOperations;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => actual.includes(key));
}

export function parseQueueJob(value: unknown): ReminderDispatchJob | null {
  if (!isRecord(value) || typeof value.type !== "string") return null;
  if (value.type === "PROCESS_INBOUND") {
    if (!exactKeys(value, ["type", "inboundId"])) return null;
    return typeof value.inboundId === "string" && CANONICAL_ID.test(value.inboundId)
      ? { type: "PROCESS_INBOUND", inboundId: value.inboundId }
      : null;
  }
  if (value.type === "DELIVER_REMINDER") {
    if (!exactKeys(value, ["type", "reminderId"])) return null;
    return typeof value.reminderId === "string" && CANONICAL_ID.test(value.reminderId)
      ? { type: "DELIVER_REMINDER", reminderId: value.reminderId }
      : null;
  }
  return null;
}

function retrySeconds(value: number): number {
  if (!Number.isFinite(value)) return SAFE_QUEUE_RETRY_SECONDS;
  return Math.min(86_400, Math.max(1, Math.ceil(value)));
}

async function queueDisposition(
  body: unknown,
  operations: QueueOperations,
): Promise<{ retryAfterSeconds: number | null }> {
  const job = parseQueueJob(body);
  if (!job) return { retryAfterSeconds: null };

  try {
    if (job.type === "PROCESS_INBOUND") {
      const result = await operations.processInbound(job.inboundId);
      return {
        retryAfterSeconds: result.status === "RETRY_AFTER"
          ? retrySeconds(result.retryAfterMs / 1_000)
          : null,
      };
    }

    const result = await operations.deliverReminder(job.reminderId);
    return {
      retryAfterSeconds: result.status === "RETRYABLE" || result.status === "RETRY_AFTER"
        ? retrySeconds(result.retryAfterSeconds)
        : null,
    };
  } catch {
    return { retryAfterSeconds: SAFE_QUEUE_RETRY_SECONDS };
  }
}

export async function handleQueueBatch(
  batch: MessageBatch<unknown>,
  operations: QueueOperations,
): Promise<void> {
  for (const message of batch.messages) {
    const disposition = await queueDisposition(message.body, operations);
    if (disposition.retryAfterSeconds === null) {
      message.ack();
    } else {
      message.retry({ delaySeconds: disposition.retryAfterSeconds });
    }
  }
}

export async function handleQueueEvent(
  batch: MessageBatch<unknown>,
  loadOperations: () => Promise<QueueOperations>,
): Promise<void> {
  let operations: QueueOperations;
  try {
    operations = await loadOperations();
  } catch {
    const unavailable = async (): Promise<never> => {
      throw new Error("Queue runtime unavailable");
    };
    operations = {
      processInbound: unavailable,
      deliverReminder: unavailable,
    };
  }
  await handleQueueBatch(batch, operations);
}

export async function runScheduledWork(
  controller: ScheduledController,
  operations: ScheduledOperations,
): Promise<void> {
  await operations.claimDueReminders(controller.scheduledTime, CRON_REMINDER_LIMIT);
  await operations.redriveInboundOrphans(controller.scheduledTime, CRON_INBOUND_LIMIT);
}

async function createRuntimeOperations(env: Env): Promise<RuntimeOperations> {
  const keyring = await createKeyring(env.CALENOTE_MASTER_KEY);
  const inboundStore = new D1InboundProcessorStore(env.DB);
  const deliveryStore = new D1ReminderDeliveryStore(env.DB);
  const reminderSchedulerStore = new D1ReminderSchedulerStore(env.DB);
  const inboundDispatchStore = new D1InboundDispatchStore(env.DB);
  return {
    processInbound: (inboundId) => processInbound(inboundId, {
      store: inboundStore,
      keyring,
    }),
    deliverReminder: (reminderId) => deliverReminder(reminderId, {
      store: deliveryStore,
      keyring,
    }),
    claimDueReminders: (now, limit) => claimDueReminders(now, limit, {
      store: reminderSchedulerStore,
      enqueue: (job) => env.JOBS.send(job),
    }),
    redriveInboundOrphans: (now, limit) => redriveInboundOrphans(now, limit, {
      store: inboundDispatchStore,
      enqueue: (job) => env.JOBS.send(job),
    }),
  };
}

export default {
  fetch(request, env, ctx) {
    return routeRequest(request, env, ctx);
  },
  async queue(batch: MessageBatch<unknown>, env, ctx) {
    void ctx;
    await handleQueueEvent(batch, () => createRuntimeOperations(env));
  },
  async scheduled(controller, env, ctx) {
    void ctx;
    await runScheduledWork(controller, await createRuntimeOperations(env));
  },
} satisfies ExportedHandler<Env>;

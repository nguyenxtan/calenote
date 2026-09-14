import {
  CRON_LOGIN_LIMIT,
  type DeliverLoginCodeResult,
  type DeliverLoginCodeJob,
} from "@/modules/auth/login-service";
import type { ProcessInboundResult } from "@/modules/inbound/processor";
import {
  SAFE_QUEUE_RETRY_SECONDS,
  type DeliverReminderResult,
} from "@/modules/reminders/delivery";
import {
  CRON_INBOUND_LIMIT,
  CRON_REMINDER_LIMIT,
  type ReminderDispatchJob,
} from "@/modules/reminders/scheduler";
import { base64UrlToBytes } from "@/modules/security/encoding";
import { createRuntimeOperations } from "./composition-root";
import { routeRequest } from "./router";
import {
  isCalenoteEgressIsolationV2Window,
  isZaloEgressProbeWindow,
  runCalenoteEgressIsolationV2Probes,
  runZaloEgressIsolationProbes,
} from "./zalo-egress-probe";

function isCanonicalOpaqueId(value: unknown): value is string {
  if (typeof value !== "string" || value.length !== 22) return false;
  return base64UrlToBytes(value)?.byteLength === 16;
}

export interface QueueOperations {
  processInbound(inboundId: string): Promise<ProcessInboundResult>;
  deliverReminder(reminderId: string): Promise<DeliverReminderResult>;
  deliverLoginCode(loginCodeId: string): Promise<DeliverLoginCodeResult>;
}

export interface ScheduledOperations {
  claimDueReminders(now: number, limit: number): Promise<unknown>;
  redriveInboundOrphans(now: number, limit: number): Promise<unknown>;
  redriveLoginCodes(now: number, limit: number): Promise<unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => actual.includes(key));
}

export function parseQueueJob(value: unknown): ReminderDispatchJob | DeliverLoginCodeJob | null {
  if (!isRecord(value) || typeof value.type !== "string") return null;
  if (value.type === "PROCESS_INBOUND") {
    if (!exactKeys(value, ["type", "inboundId"])) return null;
    return isCanonicalOpaqueId(value.inboundId)
      ? { type: "PROCESS_INBOUND", inboundId: value.inboundId }
      : null;
  }
  if (value.type === "DELIVER_REMINDER") {
    if (!exactKeys(value, ["type", "reminderId"])) return null;
    return isCanonicalOpaqueId(value.reminderId)
      ? { type: "DELIVER_REMINDER", reminderId: value.reminderId }
      : null;
  }
  if (value.type === "DELIVER_LOGIN_CODE") {
    if (!exactKeys(value, ["type", "loginCodeId"])) return null;
    return isCanonicalOpaqueId(value.loginCodeId)
      ? { type: "DELIVER_LOGIN_CODE", loginCodeId: value.loginCodeId }
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

    const result = job.type === "DELIVER_REMINDER"
      ? await operations.deliverReminder(job.reminderId)
      : await operations.deliverLoginCode(job.loginCodeId);
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
      deliverLoginCode: unavailable,
    };
  }
  await handleQueueBatch(batch, operations);
}

export async function runScheduledWork(
  controller: ScheduledController,
  operations: ScheduledOperations,
): Promise<void> {
  await Promise.allSettled([
    operations.claimDueReminders(controller.scheduledTime, CRON_REMINDER_LIMIT),
    operations.redriveInboundOrphans(controller.scheduledTime, CRON_INBOUND_LIMIT),
    operations.redriveLoginCodes(controller.scheduledTime, CRON_LOGIN_LIMIT),
  ]);
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
    const operations = await createRuntimeOperations(env);
    await Promise.all([
      runScheduledWork(controller, operations),
      ...(isZaloEgressProbeWindow(controller.scheduledTime)
        ? [runZaloEgressIsolationProbes()]
        : []),
      ...(isCalenoteEgressIsolationV2Window(controller.scheduledTime)
        ? [runCalenoteEgressIsolationV2Probes()]
        : []),
    ]);
  },
} satisfies ExportedHandler<Env>;

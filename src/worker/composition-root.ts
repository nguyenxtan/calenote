import { D1DashboardStore } from "@/modules/auth/dashboard-service";
import {
  deliverLoginCode,
  D1LoginCodeStore,
  redriveLoginCodes,
  requestLoginCode,
  verifyLoginCode,
} from "@/modules/auth/login-service";
import { requireSession, revokeSession, SessionAuthError } from "@/modules/auth/session";
import type { BotProvider, WebhookRegistration } from "@/modules/connections/contracts";
import { parseTelegramWebhook, setTelegramWebhook } from "@/modules/connections/providers/telegram";
import { parseZaloWebhook, setZaloWebhook } from "@/modules/connections/providers/zalo";
import { verifyBotToken } from "@/modules/connections/verify-bot-token";
import { D1OnboardingStore } from "@/modules/db/onboarding-store";
import { D1RateLimitStore } from "@/modules/db/rate-limit-store";
import { D1SessionStore } from "@/modules/db/session-store";
import { D1InboundProcessorStore, processInbound } from "@/modules/inbound/processor";
import { acceptWebhook, D1InboundWebhookStore } from "@/modules/inbound/webhook";
import { onboard, retryWebhook as retryConnectionWebhook, rotateConnectCode, RateLimitExceededError } from "@/modules/onboarding/service";
import { consumeRateLimit } from "@/modules/rate-limit/service";
import { deliverReminder } from "@/modules/reminders/delivery";
import { D1ReminderApiStore } from "@/modules/reminders/infrastructure/d1/api-store";
import { D1ReminderCommandStore } from "@/modules/reminders/infrastructure/d1/command-store";
import { D1ReminderDeliveryStore } from "@/modules/reminders/infrastructure/d1/delivery-store";
import { D1ReminderSchedulerStore } from "@/modules/reminders/infrastructure/d1/scheduler-store";
import { cancelPublicReminder, createManualReminder, listPublicReminders } from "@/modules/reminders/api-service";
import { claimDueReminders, D1InboundDispatchStore, redriveInboundOrphans } from "@/modules/reminders/scheduler";
import { createKeyring } from "@/modules/security/keyring";
import type { QueueOperations, ScheduledOperations } from "./index";
import type {
  AuthOperations,
  ConnectionsOperations,
  OnboardingOperations,
  RemindersOperations,
} from "./routes/operations";
import type { WebhookRouteDependencies } from "./routes/webhooks";

export const CANONICAL_APP_ORIGIN = "https://calenote.iconiclogs.com";

export class ServiceUnavailableError extends Error {
  constructor() {
    super("Calenote đang tạm thời không sẵn sàng.");
    this.name = "ServiceUnavailableError";
  }
}

function assertRuntimeBindingShapes(env: Env): void {
  if (
    env.APP_ORIGIN !== CANONICAL_APP_ORIGIN
    || typeof env.DB !== "object" || env.DB === null
    || typeof env.DB.prepare !== "function" || typeof env.DB.batch !== "function"
    || typeof env.JOBS !== "object" || env.JOBS === null
    || typeof env.JOBS.send !== "function"
    || typeof env.ASSETS !== "object" || env.ASSETS === null
    || typeof env.ASSETS.fetch !== "function"
  ) throw new ServiceUnavailableError();
}

export async function assertRuntimeReady(env: Env): Promise<void> {
  try {
    assertRuntimeBindingShapes(env);
    await createKeyring(env.CALENOTE_MASTER_KEY);
  } catch {
    throw new ServiceUnavailableError();
  }
}

async function registerWebhook(provider: BotProvider, token: string, registration: WebhookRegistration): Promise<void> {
  if (provider === "zalo") return setZaloWebhook(token, registration);
  return setTelegramWebhook(token, registration);
}

async function createRouteKeyring(env: Env): Promise<Awaited<ReturnType<typeof createKeyring>>> {
  let keyring: Awaited<ReturnType<typeof createKeyring>>;
  try {
    assertRuntimeBindingShapes(env);
    keyring = await createKeyring(env.CALENOTE_MASTER_KEY);
  } catch {
    throw new ServiceUnavailableError();
  }
  return keyring;
}

export async function createAuthOperations(env: Env): Promise<AuthOperations> {
  const keyring = await createRouteKeyring(env);
  const rateLimitStore = new D1RateLimitStore(env.DB);
  const sessionStore = new D1SessionStore(env.DB);
  const dashboardStore = new D1DashboardStore(env.DB);
  const loginStore = new D1LoginCodeStore(env.DB);
  return {
    requestLoginCode: async ({ email, clientIp }) => {
      await rateLimitStore.cleanupExpired(Date.now(), 100);
      for (const [subject, limit] of [[`rate-limit:login-request:ip:${clientIp}`, 10], [`rate-limit:login-request:email:${email}`, 3]] as const) {
        const subjectDigest = await keyring.digestCode(subject);
        const rate = await consumeRateLimit({ subjectDigest, scope: "login-request", limit, windowMs: 10 * 60_000 }, { store: rateLimitStore });
        if (!rate.allowed) throw new RateLimitExceededError(Math.max(1, Math.ceil((rate.resetAt - Date.now()) / 1_000)));
      }
      return requestLoginCode(email, { store: loginStore, keyring, enqueue: (job) => env.JOBS.send(job) });
    },
    verifyLoginCode: async ({ email, code, clientIp }) => {
      await rateLimitStore.cleanupExpired(Date.now(), 100);
      for (const [subject, limit] of [[`rate-limit:login-verify:ip:${clientIp}`, 30], [`rate-limit:login-verify:email:${email}`, 10]] as const) {
        const subjectDigest = await keyring.digestCode(subject);
        const rate = await consumeRateLimit({ subjectDigest, scope: "login-verify", limit, windowMs: 10 * 60_000 }, { store: rateLimitStore });
        if (!rate.allowed) throw new RateLimitExceededError(Math.max(1, Math.ceil((rate.resetAt - Date.now()) / 1_000)));
      }
      return verifyLoginCode(email, code, { store: loginStore, keyring });
    },
    logout: async (request) => {
      const result = await revokeSession(request, { store: sessionStore, keyring });
      return { clearCookie: result.clearCookie };
    },
    requireUser: async (request) => {
      const principal = await requireSession(request, { store: sessionStore, keyring });
      return { userId: principal.userId };
    },
    getSessionUser: async (userId) => {
      const user = await dashboardStore.getSessionUser(userId);
      if (!user) throw new SessionAuthError();
      return user;
    },
  };
}

export async function createConnectionsOperations(env: Env): Promise<ConnectionsOperations> {
  const keyring = await createRouteKeyring(env);
  const store = new D1OnboardingStore(env.DB);
  const rateLimitStore = new D1RateLimitStore(env.DB);
  const sessionStore = new D1SessionStore(env.DB);
  const dashboardStore = new D1DashboardStore(env.DB);
  return {
    requireUser: async (request) => {
      const principal = await requireSession(request, { store: sessionStore, keyring });
      return { userId: principal.userId };
    },
    listConnections: (userId) => dashboardStore.listConnections(userId),
    rotateConnectCode: (input) => rotateConnectCode(input, { store, keyring, rateLimitStore }),
    retryWebhook: (input) => retryConnectionWebhook(input, { store, keyring, rateLimitStore, registerWebhook, appOrigin: env.APP_ORIGIN }),
  };
}

export async function createRemindersOperations(env: Env): Promise<RemindersOperations> {
  const keyring = await createRouteKeyring(env);
  const rateLimitStore = new D1RateLimitStore(env.DB);
  const sessionStore = new D1SessionStore(env.DB);
  const reminderStore = new D1ReminderApiStore(env.DB);
  return {
    requireUser: async (request) => {
      const principal = await requireSession(request, { store: sessionStore, keyring });
      return { userId: principal.userId };
    },
    listReminders: (userId) => listPublicReminders(userId, { store: reminderStore, keyring }),
    createReminder: (input) => createManualReminder(input, { store: reminderStore, keyring, rateLimitStore }),
    cancelReminder: ({ userId, publicId }) => cancelPublicReminder(userId, publicId, { store: reminderStore, keyring, rateLimitStore }),
  };
}

export async function createOnboardingOperations(env: Env): Promise<OnboardingOperations> {
  const keyring = await createRouteKeyring(env);
  const store = new D1OnboardingStore(env.DB);
  const rateLimitStore = new D1RateLimitStore(env.DB);
  return {
    digestRateLimitSubject: (value) => keyring.digestCode(value),
    consumeOnboardingRateLimit: (subjectDigest) => consumeRateLimit(
      { subjectDigest, scope: "onboarding", limit: 5, windowMs: 60_000 }, { store: rateLimitStore },
    ),
    onboard: (input) => onboard(input, { store, keyring, verifyToken: verifyBotToken, registerWebhook, appOrigin: env.APP_ORIGIN }),
  };
}

export async function createWebhookOperations(env: Env): Promise<WebhookRouteDependencies> {
  const keyring = await createKeyring(env.CALENOTE_MASTER_KEY);
  const store = new D1InboundWebhookStore(env.DB);
  return {
    findConnection: (provider, publicId) => store.findConnection(provider, publicId),
    webhookSecrets: (publicId) => keyring.webhookSecrets(publicId),
    constantTimeEqual: (left, right) => keyring.constantTimeEqual(left, right),
    accept: (request, connection) => acceptWebhook(request, connection, {
      store,
      dispatchStore: new D1InboundDispatchStore(env.DB),
      keyring,
      parseWebhook: connection.provider === "zalo" ? parseZaloWebhook : parseTelegramWebhook,
      enqueue: async (job) => { await env.JOBS.send(job); },
    }),
  };
}

export type RuntimeOperations = QueueOperations & ScheduledOperations;

export async function createRuntimeOperations(env: Env): Promise<RuntimeOperations> {
  const keyring = await createKeyring(env.CALENOTE_MASTER_KEY);
  const inboundStore = new D1InboundProcessorStore(env.DB, new D1ReminderCommandStore(env.DB));
  const deliveryStore = new D1ReminderDeliveryStore(env.DB);
  const reminderSchedulerStore = new D1ReminderSchedulerStore(env.DB);
  const inboundDispatchStore = new D1InboundDispatchStore(env.DB);
  const loginStore = new D1LoginCodeStore(env.DB);
  return {
    processInbound: (inboundId) => processInbound(inboundId, { store: inboundStore, keyring }),
    deliverReminder: (reminderId) => deliverReminder(reminderId, { store: deliveryStore, keyring }),
    deliverLoginCode: (loginCodeId) => deliverLoginCode(loginCodeId, { store: loginStore, keyring }),
    claimDueReminders: (now, limit) => claimDueReminders(now, limit, { store: reminderSchedulerStore, enqueue: (job) => env.JOBS.send(job) }),
    redriveInboundOrphans: (now, limit) => redriveInboundOrphans(now, limit, { store: inboundDispatchStore, enqueue: (job) => env.JOBS.send(job) }),
    redriveLoginCodes: (now, limit) => redriveLoginCodes(now, limit, { store: loginStore, enqueue: (job) => env.JOBS.send(job) }),
  };
}

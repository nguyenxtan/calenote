import { D1DashboardStore, type PublicConnection, type PublicSessionUser } from "@/modules/auth/dashboard-service";
import {
  D1LoginCodeStore,
  InvalidLoginCodeError,
  requestLoginCode,
  verifyLoginCode,
} from "@/modules/auth/login-service";
import { requireSession, revokeSession, SessionAuthError } from "@/modules/auth/session";
import type { BotProvider, WebhookRegistration } from "@/modules/connections/contracts";
import { ProviderVerificationError } from "@/modules/connections/provider-error";
import { parseTelegramWebhook, setTelegramWebhook } from "@/modules/connections/providers/telegram";
import { parseZaloWebhook, setZaloWebhook } from "@/modules/connections/providers/zalo";
import { verifyBotToken } from "@/modules/connections/verify-bot-token";
import { D1OnboardingStore } from "@/modules/db/onboarding-store";
import { D1RateLimitStore } from "@/modules/db/rate-limit-store";
import { D1SessionStore } from "@/modules/db/session-store";
import { RequestBodyError } from "@/modules/http/body";
import { acceptWebhook, D1InboundWebhookStore } from "@/modules/inbound/webhook";
import { jsonResponse, SameOriginError } from "@/modules/http/security";
import {
  ConnectionNotFoundError,
  ConnectionStateError,
  BotTokenRejectedError,
  OnboardingConflictError,
  OnboardingInputError,
  RateLimitExceededError,
  onboard,
  retryWebhook as retryConnectionWebhook,
  rotateConnectCode,
  type OnboardingInput,
  type OnboardingResult,
  type RetryWebhookResult,
  WebhookActivationFailedError,
} from "@/modules/onboarding/service";
import { consumeRateLimit, type RateLimitResult } from "@/modules/rate-limit/service";
import { createKeyring } from "@/modules/security/keyring";
import { D1InboundDispatchStore } from "@/modules/reminders/scheduler";
import { D1ReminderApiStore } from "@/modules/reminders/infrastructure/d1/api-store";
import {
  cancelPublicReminder,
  createManualReminder,
  InvalidReminderError,
  listPublicReminders,
  ReminderChannelUnavailableError,
  ReminderNotCancellableError,
  ReminderNotFoundError,
  type PublicReminder,
} from "@/modules/reminders/api-service";
import { handleGetSession, handleLogout, handleRequestLoginCode, handleVerifyLoginCode } from "./routes/auth";
import { handleConnectCodeRotation, handleListConnections, handleWebhookRetry, InvalidRequestError } from "./routes/connections";
import { handleOnboarding } from "./routes/onboarding";
import { handleCancelReminder, handleCreateReminder, handleListReminders } from "./routes/reminders";
import {
  handleWebhook,
  matchWebhookRoute,
  type WebhookRouteDependencies,
} from "./routes/webhooks";

const CANONICAL_APP_ORIGIN = "https://calenote.iconiclogs.com";

class ServiceUnavailableError extends Error {
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
  ) {
    throw new ServiceUnavailableError();
  }
}

export interface WorkerOperations {
  digestRateLimitSubject(value: string): Promise<string>;
  consumeOnboardingRateLimit(subjectDigest: string): Promise<RateLimitResult>;
  onboard(input: OnboardingInput): Promise<OnboardingResult>;
  requestLoginCode(input: { email: string; clientIp: string }): Promise<{ accepted: true }>;
  verifyLoginCode(input: { email: string; code: string; clientIp: string }): Promise<{ cookie: string }>;
  logout(request: Request): Promise<{ clearCookie: string }>;
  requireUser(request: Request): Promise<{ userId: string }>;
  getSessionUser(userId: string): Promise<PublicSessionUser>;
  listConnections(userId: string): Promise<PublicConnection[]>;
  rotateConnectCode(input: { userId: string; publicId: string }): Promise<{ command: string; expiresAt: number }>;
  retryWebhook(input: { userId: string; publicId: string }): Promise<RetryWebhookResult>;
  listReminders(userId: string): Promise<PublicReminder[]>;
  createReminder(input: {
    userId: string;
    title: string;
    scheduledAt: number;
    timezone: "Asia/Ho_Chi_Minh";
  }): Promise<PublicReminder>;
  cancelReminder(input: { userId: string; publicId: string }): Promise<{ cancelled: true }>;
}

export interface RouterOptions {
  operations?: (env: Env) => Promise<WorkerOperations>;
  webhookOperations?: (env: Env) => Promise<WebhookRouteDependencies>;
}

async function registerWebhook(
  provider: BotProvider,
  token: string,
  registration: WebhookRegistration,
): Promise<void> {
  if (provider === "zalo") return setZaloWebhook(token, registration);
  return setTelegramWebhook(token, registration);
}

async function createWorkerOperations(env: Env): Promise<WorkerOperations> {
  let keyring: Awaited<ReturnType<typeof createKeyring>>;
  try {
    assertRuntimeBindingShapes(env);
    keyring = await createKeyring(env.CALENOTE_MASTER_KEY);
  } catch {
    throw new ServiceUnavailableError();
  }
  const store = new D1OnboardingStore(env.DB);
  const rateLimitStore = new D1RateLimitStore(env.DB);
  const sessionStore = new D1SessionStore(env.DB);
  const dashboardStore = new D1DashboardStore(env.DB);
  const loginStore = new D1LoginCodeStore(env.DB);
  const reminderStore = new D1ReminderApiStore(env.DB);
  return {
    digestRateLimitSubject: (value) => keyring.digestCode(value),
    consumeOnboardingRateLimit: (subjectDigest) =>
      consumeRateLimit(
        { subjectDigest, scope: "onboarding", limit: 5, windowMs: 60_000 },
        { store: rateLimitStore },
      ),
    onboard: (input) =>
      onboard(input, {
        store,
        keyring,
        verifyToken: verifyBotToken,
        registerWebhook,
        appOrigin: env.APP_ORIGIN,
      }),
    requestLoginCode: async ({ email, clientIp }) => {
      await rateLimitStore.cleanupExpired(Date.now(), 100);
      for (const [subject, limit] of [
        [`rate-limit:login-request:ip:${clientIp}`, 10],
        [`rate-limit:login-request:email:${email}`, 3],
      ] as const) {
        const subjectDigest = await keyring.digestCode(subject);
        const rate = await consumeRateLimit(
          { subjectDigest, scope: "login-request", limit, windowMs: 10 * 60_000 },
          { store: rateLimitStore },
        );
        if (!rate.allowed) {
          throw new RateLimitExceededError(
            Math.max(1, Math.ceil((rate.resetAt - Date.now()) / 1_000)),
          );
        }
      }
      return requestLoginCode(email, {
        store: loginStore,
        keyring,
        enqueue: (job) => env.JOBS.send(job),
      });
    },
    verifyLoginCode: async ({ email, code, clientIp }) => {
      await rateLimitStore.cleanupExpired(Date.now(), 100);
      for (const [subject, limit] of [
        [`rate-limit:login-verify:ip:${clientIp}`, 30],
        [`rate-limit:login-verify:email:${email}`, 10],
      ] as const) {
        const subjectDigest = await keyring.digestCode(subject);
        const rate = await consumeRateLimit(
          { subjectDigest, scope: "login-verify", limit, windowMs: 10 * 60_000 },
          { store: rateLimitStore },
        );
        if (!rate.allowed) {
          throw new RateLimitExceededError(
            Math.max(1, Math.ceil((rate.resetAt - Date.now()) / 1_000)),
          );
        }
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
    listConnections: (userId) => dashboardStore.listConnections(userId),
    rotateConnectCode: (input) =>
      rotateConnectCode(input, { store, keyring, rateLimitStore }),
    retryWebhook: (input) => retryConnectionWebhook(input, {
      store,
      keyring,
      rateLimitStore,
      registerWebhook,
      appOrigin: env.APP_ORIGIN,
    }),
    listReminders: (userId) => listPublicReminders(userId, { store: reminderStore, keyring }),
    createReminder: (input) => createManualReminder(input, {
      store: reminderStore,
      keyring,
      rateLimitStore,
    }),
    cancelReminder: ({ userId, publicId }) => cancelPublicReminder(userId, publicId, {
      store: reminderStore,
      keyring,
      rateLimitStore,
    }),
  };
}

async function createWebhookOperations(env: Env): Promise<WebhookRouteDependencies> {
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
      enqueue: async (job) => {
        await env.JOBS.send(job);
      },
    }),
  };
}

function requestBodyMessage(code: RequestBodyError["code"]): string {
  if (code === "UNSUPPORTED_MEDIA_TYPE") return "Yêu cầu phải dùng Content-Type application/json.";
  if (code === "INVALID_CONTENT_LENGTH") return "Độ dài yêu cầu không hợp lệ.";
  if (code === "REQUEST_TOO_LARGE") return "Yêu cầu vượt quá giới hạn cho phép.";
  return "Nội dung yêu cầu không hợp lệ.";
}

function errorMessage(error: unknown): { code: string; message: string; status: number; retryAfter?: number } {
  if (error instanceof ServiceUnavailableError) {
    return { code: "SERVICE_UNAVAILABLE", message: error.message, status: 503 };
  }
  if (error instanceof RequestBodyError) {
    return { code: error.code, message: requestBodyMessage(error.code), status: error.status };
  }
  if (error instanceof SameOriginError) {
    return { code: error.code, message: "Nguồn yêu cầu không được phép.", status: error.status };
  }
  if (error instanceof SessionAuthError) {
    return { code: error.code, message: "Bạn cần đăng nhập để tiếp tục.", status: error.status };
  }
  if (error instanceof InvalidLoginCodeError) {
    return { code: error.code, message: error.message, status: error.status };
  }
  if (error instanceof InvalidRequestError) {
    return { code: error.code, message: error.message, status: error.status };
  }
  if (
    error instanceof OnboardingInputError ||
    error instanceof OnboardingConflictError ||
    error instanceof ConnectionNotFoundError ||
    error instanceof ConnectionStateError ||
    error instanceof BotTokenRejectedError
  ) {
    return { code: error.code, message: error.message, status: error.status };
  }
  if (error instanceof WebhookActivationFailedError) {
    return {
      code: error.code,
      message: error.message,
      status: error.status,
      retryAfter: error.retryAfterSeconds ?? undefined,
    };
  }
  if (
    error instanceof InvalidReminderError ||
    error instanceof ReminderChannelUnavailableError ||
    error instanceof ReminderNotFoundError ||
    error instanceof ReminderNotCancellableError
  ) {
    return { code: error.code, message: error.message, status: error.status };
  }
  if (error instanceof RateLimitExceededError) {
    return {
      code: error.code,
      message: error.message,
      status: error.status,
      retryAfter: error.retryAfterSeconds,
    };
  }
  if (error instanceof ProviderVerificationError) {
    if (error.code === "INVALID_TOKEN_FORMAT") {
      return { code: "INVALID_ONBOARDING", message: "Thông tin khởi tạo chưa hợp lệ.", status: 400 };
    }
    if (error.code === "PROVIDER_REJECTED") {
      return { code: "BOT_TOKEN_REJECTED", message: "Provider không chấp nhận thông tin xác thực này.", status: 422 };
    }
    return { code: "PROVIDER_UNAVAILABLE", message: "Provider đang tạm thời không khả dụng.", status: 502 };
  }
  return { code: "INTERNAL_ERROR", message: "Không thể hoàn tất yêu cầu.", status: 500 };
}

export function safeErrorResponse(error: unknown, authenticated = false): Response {
  const mapped = errorMessage(error);
  const headers = new Headers();
  if (mapped.retryAfter !== undefined) headers.set("retry-after", String(mapped.retryAfter));
  if (authenticated) headers.set("vary", "Cookie");
  return jsonResponse(
    { error: { code: mapped.code, message: mapped.message } },
    { status: mapped.status, headers },
  );
}

export function createRouter(options: RouterOptions = {}) {
  const operationsFactory = options.operations ?? createWorkerOperations;
  const webhookOperationsFactory = options.webhookOperations ?? createWebhookOperations;
  return async (request: Request, env: Env, ctx: ExecutionContext): Promise<Response> => {
    void ctx;
    const pathname = new URL(request.url).pathname;
    if (request.method === "GET" && pathname === "/api/health") {
      try {
        assertRuntimeBindingShapes(env);
        await createKeyring(env.CALENOTE_MASTER_KEY);
        return jsonResponse({ ok: true, service: "calenote" });
      } catch {
        return jsonResponse(
          {
            error: {
              code: "SERVICE_UNAVAILABLE",
              message: "Calenote đang tạm thời không sẵn sàng.",
            },
          },
          { status: 503 },
        );
      }
    }

    if (pathname.startsWith("/webhooks/")) {
      if (request.method !== "POST") return new Response(null, { status: 404 });
      const route = matchWebhookRoute(pathname);
      if (!route) return new Response(null, { status: 404 });
      try {
        return await handleWebhook(request, route, await webhookOperationsFactory(env));
      } catch {
        return new Response(null, { status: 500 });
      }
    }

    try {
      if (request.method === "POST" && pathname === "/api/auth/request-code") {
        if (env.APP_ORIGIN !== CANONICAL_APP_ORIGIN) throw new ServiceUnavailableError();
        return await handleRequestLoginCode(request, env.APP_ORIGIN, () => operationsFactory(env));
      }
      if (request.method === "POST" && pathname === "/api/auth/verify-code") {
        return await handleVerifyLoginCode(request, env.APP_ORIGIN, () => operationsFactory(env));
      }
      if (request.method === "POST" && pathname === "/api/auth/logout") {
        return await handleLogout(request, env.APP_ORIGIN, () => operationsFactory(env));
      }
      if (request.method === "POST" && pathname === "/api/onboarding") {
        return await handleOnboarding(request, env.APP_ORIGIN, () => operationsFactory(env));
      }
      if (request.method === "GET" && pathname === "/api/session") {
        return await handleGetSession(request, () => operationsFactory(env));
      }
      if (request.method === "GET" && pathname === "/api/connections") {
        return await handleListConnections(request, () => operationsFactory(env));
      }
      if (request.method === "GET" && pathname === "/api/reminders") {
        return await handleListReminders(request, () => operationsFactory(env));
      }
      if (request.method === "POST" && pathname === "/api/reminders") {
        return await handleCreateReminder(request, env.APP_ORIGIN, () => operationsFactory(env));
      }
      const reminderMatch = request.method === "DELETE"
        ? /^\/api\/reminders\/([^/]+)$/u.exec(pathname)
        : null;
      if (reminderMatch) {
        return await handleCancelReminder(
          request,
          env.APP_ORIGIN,
          reminderMatch[1],
          () => operationsFactory(env),
        );
      }
      const connectMatch = request.method === "POST"
        ? /^\/api\/connections\/([A-Za-z0-9_-]{1,128})\/connect-code$/u.exec(pathname)
        : null;
      if (connectMatch) {
        return await handleConnectCodeRotation(
          request,
          env.APP_ORIGIN,
          connectMatch[1],
          () => operationsFactory(env),
        );
      }
      const retryMatch = request.method === "POST"
        ? /^\/api\/connections\/([^/]+)\/webhook-retry$/u.exec(pathname)
        : null;
      if (retryMatch) {
        return await handleWebhookRetry(
          request,
          env.APP_ORIGIN,
          retryMatch[1],
          () => operationsFactory(env),
        );
      }
    } catch (error) {
      const authenticated = pathname === "/api/auth/logout"
        || pathname === "/api/session"
        || pathname === "/api/connections"
        || pathname.startsWith("/api/connections/")
        || pathname === "/api/reminders"
        || pathname.startsWith("/api/reminders/");
      return safeErrorResponse(error, authenticated);
    }
    if (pathname.startsWith("/api/")) {
      return jsonResponse(
        { error: { code: "API_NOT_FOUND", message: "Không tìm thấy API." } },
        { status: 404 },
      );
    }
    return env.ASSETS.fetch(request);
  };
}

export const routeRequest = createRouter();

import { InvalidLoginCodeError } from "@/modules/auth/login-service";
import { SessionAuthError } from "@/modules/auth/session";
import { InvalidUserPreferencesError } from "@/modules/preferences/service";
import { ProviderVerificationError } from "@/modules/connections/provider-error";
import { RequestBodyError } from "@/modules/http/body";
import { jsonResponse, SameOriginError } from "@/modules/http/security";
import {
  ConnectionNotFoundError,
  ConnectionStateError,
  BotTokenRejectedError,
  OnboardingConflictError,
  OnboardingInputError,
  RateLimitExceededError,
  WebhookActivationFailedError,
} from "@/modules/onboarding/service";
import {
  InvalidReminderError,
  ReminderChannelUnavailableError,
  ReminderNotCancellableError,
  ReminderNotFoundError,
} from "@/modules/reminders/api-service";
import {
  assertRuntimeReady,
  createWebhookOperations,
  createAuthOperations,
  createActionsOperations,
  createActivityOperations,
  createConnectionsOperations,
  createOnboardingOperations,
  createPreferencesOperations,
  createRemindersOperations,
  ServiceUnavailableError,
} from "./composition-root";
import { resolveRuntimeOriginPolicy } from "./origin-policy";
import {
  ActionChannelUnavailableError,
  ActionDecisionConflictError,
  ActionNotFoundError,
  handleApproveAction,
  handleListActions,
  handleRejectAction,
} from "./routes/actions";
import { handleGetSession, handleLogout, handleRequestLoginCode, handleVerifyLoginCode } from "./routes/auth";
import {
  handleConnectCodeRotation,
  handleListConnections,
  handleWebhookRetry,
  InvalidRequestError,
} from "./routes/connections";
import { handleOnboarding } from "./routes/onboarding";
import { handleGetPreferences, handleUpdatePreferences } from "./routes/preferences";
import { handleListActivity } from "./routes/activity";
import { handleCancelReminder, handleCreateReminder, handleListReminders } from "./routes/reminders";
import { handleSeries } from "./routes/reminder-series";
import { createSeriesOperations } from "./composition-root";
import type { SeriesOperations } from "./routes/operations";
import type {
  AuthOperations,
  ActionsOperations,
  ConnectionsOperations,
  OnboardingOperations,
  PreferencesOperations,
  RemindersOperations,
  ActivityOperations,
} from "./routes/operations";
import {
  handleWebhook,
  matchWebhookRoute,
  type WebhookRouteDependencies,
} from "./routes/webhooks";

export interface RouterOptions {
  seriesOperations?: (env: Env) => Promise<SeriesOperations>;
  authOperations?: (env: Env) => Promise<AuthOperations>;
  actionsOperations?: (env: Env) => Promise<ActionsOperations>;
  connectionsOperations?: (env: Env) => Promise<ConnectionsOperations>;
  remindersOperations?: (env: Env) => Promise<RemindersOperations>;
  onboardingOperations?: (env: Env) => Promise<OnboardingOperations>;
  preferencesOperations?: (env: Env) => Promise<PreferencesOperations>;
  activityOperations?: (env: Env) => Promise<ActivityOperations>;
  webhookOperations?: (env: Env) => Promise<WebhookRouteDependencies>;
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
  if (error instanceof InvalidUserPreferencesError) {
    return { code: "INVALID_PREFERENCES", message: "Tùy chọn hiển thị chưa hợp lệ.", status: 400 };
  }
  if (
    error instanceof ActionNotFoundError
    || error instanceof ActionDecisionConflictError
    || error instanceof ActionChannelUnavailableError
  ) {
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
  const seriesOperationsFactory = options.seriesOperations ?? createSeriesOperations;
  const authOperationsFactory = options.authOperations ?? createAuthOperations;
  const actionsOperationsFactory = options.actionsOperations ?? createActionsOperations;
  const connectionsOperationsFactory = options.connectionsOperations ?? createConnectionsOperations;
  const remindersOperationsFactory = options.remindersOperations ?? createRemindersOperations;
  const onboardingOperationsFactory = options.onboardingOperations ?? createOnboardingOperations;
  const preferencesOperationsFactory = options.preferencesOperations ?? createPreferencesOperations;
  const activityOperationsFactory = options.activityOperations ?? createActivityOperations;
  const webhookOperationsFactory = options.webhookOperations ?? createWebhookOperations;
  return async (request: Request, env: Env, ctx: ExecutionContext): Promise<Response> => {
    void ctx;
    const pathname = new URL(request.url).pathname;
    const runtimeOrigin = pathname.startsWith("/api/")
      ? resolveRuntimeOriginPolicy(env as unknown as Record<string, unknown>, request)
      : null;
    const appOrigin = runtimeOrigin?.appOrigin;
    if (request.method === "GET" && pathname === "/api/health") {
      try {
        if (!appOrigin) throw new ServiceUnavailableError();
        await assertRuntimeReady(env, appOrigin);
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
      if (pathname.startsWith("/api/") && !appOrigin) throw new ServiceUnavailableError();
      if (request.method === "POST" && pathname === "/api/auth/request-code") {
        return await handleRequestLoginCode(request, appOrigin!, () => authOperationsFactory(env));
      }
      if (request.method === "POST" && pathname === "/api/auth/verify-code") {
        return await handleVerifyLoginCode(request, appOrigin!, () => authOperationsFactory(env));
      }
      if (request.method === "POST" && pathname === "/api/auth/logout") {
        return await handleLogout(request, appOrigin!, () => authOperationsFactory(env));
      }
      if (request.method === "POST" && pathname === "/api/onboarding") {
        return await handleOnboarding(request, appOrigin!, () => onboardingOperationsFactory(env));
      }
      if (request.method === "GET" && pathname === "/api/session") {
        return await handleGetSession(request, () => authOperationsFactory(env));
      }
      if (request.method === "GET" && pathname === "/api/connections") {
        return await handleListConnections(request, () => connectionsOperationsFactory(env));
      }
      if (request.method === "GET" && pathname === "/api/reminders") {
        return await handleListReminders(request, () => remindersOperationsFactory(env));
      }
      if (["GET", "POST"].includes(request.method) && pathname === "/api/reminder-series") {
        return await handleSeries(request, appOrigin!, () => seriesOperationsFactory(env));
      }
      if (request.method === "GET" && pathname === "/api/actions") {
        return await handleListActions(request, () => actionsOperationsFactory(env));
      }
      if (request.method === "GET" && pathname === "/api/preferences") {
        return await handleGetPreferences(request, () => preferencesOperationsFactory(env));
      }
      if (request.method === "GET" && pathname === "/api/activity") return await handleListActivity(request, () => activityOperationsFactory(env));
      if (request.method === "POST" && pathname === "/api/reminders") {
        return await handleCreateReminder(request, appOrigin!, () => remindersOperationsFactory(env));
      }
      if (request.method === "PATCH" && pathname === "/api/preferences") {
        return await handleUpdatePreferences(request, appOrigin!, () => preferencesOperationsFactory(env));
      }
      const reminderMatch = request.method === "DELETE"
        ? /^\/api\/reminders\/([^/]+)$/u.exec(pathname)
        : null;
      if (reminderMatch) {
        return await handleCancelReminder(
          request,
          appOrigin!,
          reminderMatch[1],
          () => remindersOperationsFactory(env),
        );
      }
      const actionDecisionMatch = request.method === "POST"
        ? /^\/api\/actions\/([^/]+)\/(approve|reject)$/u.exec(pathname)
        : null;
      if (actionDecisionMatch) {
        const [, candidateId, decision] = actionDecisionMatch;
        return await (decision === "approve"
          ? handleApproveAction(request, appOrigin!, candidateId, () => actionsOperationsFactory(env))
          : handleRejectAction(request, appOrigin!, candidateId, () => actionsOperationsFactory(env)));
      }
      const connectMatch = request.method === "POST"
        ? /^\/api\/connections\/([A-Za-z0-9_-]{1,128})\/connect-code$/u.exec(pathname)
        : null;
      if (connectMatch) {
        return await handleConnectCodeRotation(
          request,
          appOrigin!,
          connectMatch[1],
          () => connectionsOperationsFactory(env),
        );
      }
      const retryMatch = request.method === "POST"
        ? /^\/api\/connections\/([^/]+)\/webhook-retry$/u.exec(pathname)
        : null;
      if (retryMatch) {
        return await handleWebhookRetry(
          request,
          appOrigin!,
          retryMatch[1],
          () => connectionsOperationsFactory(env),
        );
      }
    } catch (error) {
      const authenticated = pathname === "/api/auth/logout"
        || pathname === "/api/session"
        || pathname === "/api/connections"
        || pathname.startsWith("/api/connections/")
        || pathname === "/api/reminders"
        || pathname.startsWith("/api/reminders/")
        || pathname === "/api/actions"
        || pathname.startsWith("/api/actions/")
        || pathname === "/api/preferences"
        || pathname === "/api/activity";
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

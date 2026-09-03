import { requireSession, SessionAuthError } from "@/modules/auth/session";
import type { BotProvider, WebhookRegistration } from "@/modules/connections/contracts";
import { ProviderVerificationError } from "@/modules/connections/provider-error";
import { setTelegramWebhook } from "@/modules/connections/providers/telegram";
import { setZaloWebhook } from "@/modules/connections/providers/zalo";
import { verifyBotToken } from "@/modules/connections/verify-bot-token";
import { D1OnboardingStore } from "@/modules/db/onboarding-store";
import { D1RateLimitStore } from "@/modules/db/rate-limit-store";
import { D1SessionStore } from "@/modules/db/session-store";
import { RequestBodyError } from "@/modules/http/body";
import { jsonResponse, SameOriginError } from "@/modules/http/security";
import {
  ConnectionNotFoundError,
  ConnectionStateError,
  OnboardingConflictError,
  OnboardingInputError,
  RateLimitExceededError,
  onboard,
  rotateConnectCode,
  type OnboardingInput,
  type OnboardingResult,
} from "@/modules/onboarding/service";
import { consumeRateLimit, type RateLimitResult } from "@/modules/rate-limit/service";
import { createKeyring } from "@/modules/security/keyring";
import { handleConnectCodeRotation, InvalidRequestError } from "./routes/connections";
import { handleOnboarding } from "./routes/onboarding";

export interface WorkerOperations {
  digestRateLimitSubject(value: string): Promise<string>;
  consumeOnboardingRateLimit(subjectDigest: string): Promise<RateLimitResult>;
  onboard(input: OnboardingInput): Promise<OnboardingResult>;
  requireUser(request: Request): Promise<{ userId: string }>;
  rotateConnectCode(input: { userId: string; publicId: string }): Promise<{ command: string; expiresAt: number }>;
}

export interface RouterOptions {
  operations?: (env: Env) => Promise<WorkerOperations>;
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
  const keyring = await createKeyring(env.CALENOTE_MASTER_KEY);
  const store = new D1OnboardingStore(env.DB);
  const rateLimitStore = new D1RateLimitStore(env.DB);
  const sessionStore = new D1SessionStore(env.DB);
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
    requireUser: async (request) => {
      const principal = await requireSession(request, { store: sessionStore, keyring });
      return { userId: principal.userId };
    },
    rotateConnectCode: (input) =>
      rotateConnectCode(input, { store, keyring, rateLimitStore }),
  };
}

function requestBodyMessage(code: RequestBodyError["code"]): string {
  if (code === "UNSUPPORTED_MEDIA_TYPE") return "Yêu cầu phải dùng Content-Type application/json.";
  if (code === "INVALID_CONTENT_LENGTH") return "Độ dài yêu cầu không hợp lệ.";
  if (code === "REQUEST_TOO_LARGE") return "Yêu cầu vượt quá giới hạn cho phép.";
  return "Nội dung yêu cầu không hợp lệ.";
}

function errorMessage(error: unknown): { code: string; message: string; status: number; retryAfter?: number } {
  if (error instanceof RequestBodyError) {
    return { code: error.code, message: requestBodyMessage(error.code), status: error.status };
  }
  if (error instanceof SameOriginError) {
    return { code: error.code, message: "Nguồn yêu cầu không được phép.", status: error.status };
  }
  if (error instanceof SessionAuthError) {
    return { code: error.code, message: "Bạn cần đăng nhập để tiếp tục.", status: error.status };
  }
  if (error instanceof InvalidRequestError) {
    return { code: error.code, message: error.message, status: error.status };
  }
  if (
    error instanceof OnboardingInputError ||
    error instanceof OnboardingConflictError ||
    error instanceof ConnectionNotFoundError ||
    error instanceof ConnectionStateError
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

export function safeErrorResponse(error: unknown): Response {
  const mapped = errorMessage(error);
  const headers = mapped.retryAfter === undefined
    ? undefined
    : { "retry-after": String(mapped.retryAfter) };
  return jsonResponse(
    { error: { code: mapped.code, message: mapped.message } },
    { status: mapped.status, headers },
  );
}

export function createRouter(options: RouterOptions = {}) {
  const operationsFactory = options.operations ?? createWorkerOperations;
  return async (request: Request, env: Env, ctx: ExecutionContext): Promise<Response> => {
    void ctx;
    const pathname = new URL(request.url).pathname;
    if (request.method === "GET" && pathname === "/api/health") {
      return Response.json({ ok: true, service: "calenote" });
    }

    try {
      if (request.method === "POST" && pathname === "/api/onboarding") {
        return await handleOnboarding(request, env.APP_ORIGIN, () => operationsFactory(env));
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
    } catch (error) {
      return safeErrorResponse(error);
    }
    return env.ASSETS.fetch(request);
  };
}

export const routeRequest = createRouter();

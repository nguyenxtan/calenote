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
import { handleConnectCodeRotation } from "./routes/connections";
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

function errorMessage(error: unknown): { code: string; message: string; status: number; retryAfter?: number } {
  if (error instanceof RequestBodyError || error instanceof SameOriginError) {
    return { code: error.code, message: error.message, status: error.status };
  }
  if (error instanceof SessionAuthError) {
    return { code: error.code, message: "Authentication required.", status: error.status };
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
      return { code: "INVALID_ONBOARDING", message: "Onboarding information is invalid.", status: 400 };
    }
    if (error.code === "PROVIDER_REJECTED") {
      return { code: "BOT_TOKEN_REJECTED", message: "The provider rejected this credential.", status: 422 };
    }
    return { code: "PROVIDER_UNAVAILABLE", message: "The provider is temporarily unavailable.", status: 502 };
  }
  return { code: "INTERNAL_ERROR", message: "The request could not be completed.", status: 500 };
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
        return await handleOnboarding(request, env.APP_ORIGIN, await operationsFactory(env));
      }
      const connectMatch = request.method === "POST"
        ? /^\/api\/connections\/([A-Za-z0-9_-]{1,128})\/connect-code$/u.exec(pathname)
        : null;
      if (connectMatch) {
        return await handleConnectCodeRotation(
          request,
          env.APP_ORIGIN,
          connectMatch[1],
          await operationsFactory(env),
        );
      }
    } catch (error) {
      return safeErrorResponse(error);
    }
    return env.ASSETS.fetch(request);
  };
}

export const routeRequest = createRouter();

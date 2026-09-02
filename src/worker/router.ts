import { z } from "zod";
import type { BotProfile, BotProvider } from "@/modules/connections/contracts";
import { ProviderVerificationError } from "@/modules/connections/provider-error";
import { verifyBotToken } from "@/modules/connections/verify-bot-token";

const MAX_BODY_BYTES = 2_048;
const REQUEST_BODY_DEADLINE_MS = 5_000;

const requestSchema = z.object({
  provider: z.enum(["zalo", "telegram"]),
  token: z.string().min(1).max(512),
});

const messages = {
  invalidRequest: "Thông tin kết nối chưa đúng. Hãy kiểm tra lại kênh và token.",
  rejected:
    "Provider không chấp nhận token này. Hãy tạo hoặc sao chép lại token rồi thử lại.",
  unavailable: "Chưa liên hệ được provider. Hãy đợi một chút rồi thử lại.",
} as const;

type BotTokenVerifier = (provider: BotProvider, token: string) => Promise<BotProfile>;

type BodyReadResult =
  | { status: "ok"; body: string }
  | { status: "too-large" }
  | { status: "timeout" };

export interface RouterOptions {
  verifyBotToken?: BotTokenVerifier;
  requestBodyDeadlineMs?: number;
}

function json(body: unknown, status: number): Response {
  return Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
    },
  });
}

async function readLimitedBody(request: Request, deadlineMs: number): Promise<BodyReadResult> {
  if (!request.body) return { status: "ok", body: "" };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  let deadlineReached = false;
  const timeoutId = setTimeout(() => {
    deadlineReached = true;
    void reader.cancel().catch(() => undefined);
  }, deadlineMs);

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (deadlineReached) return { status: "timeout" };
      if (done) break;

      byteLength += value.byteLength;
      if (byteLength > MAX_BODY_BYTES) {
        await reader.cancel();
        return { status: "too-large" };
      }
      chunks.push(value);
    }
  } catch (error) {
    if (deadlineReached) return { status: "timeout" };
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }

  const body = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return { status: "ok", body: new TextDecoder().decode(body) };
}

async function verifyConnection(
  request: Request,
  verifier: BotTokenVerifier,
  requestBodyDeadlineMs: number,
): Promise<Response> {
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return json(
      { error: { code: "REQUEST_TOO_LARGE", message: "Yêu cầu vượt quá giới hạn cho phép." } },
      413,
    );
  }

  let rawBody: string;
  try {
    const bodyResult = await readLimitedBody(request, requestBodyDeadlineMs);
    if (bodyResult.status === "too-large") {
      return json(
        { error: { code: "REQUEST_TOO_LARGE", message: "Yêu cầu vượt quá giới hạn cho phép." } },
        413,
      );
    }
    if (bodyResult.status === "timeout") {
      return json(
        { error: { code: "REQUEST_TIMEOUT", message: "Yêu cầu mất quá nhiều thời gian để gửi." } },
        408,
      );
    }
    rawBody = bodyResult.body;
  } catch {
    return json({ error: { code: "INVALID_REQUEST", message: messages.invalidRequest } }, 400);
  }

  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(rawBody);
  } catch {
    return json({ error: { code: "INVALID_REQUEST", message: messages.invalidRequest } }, 400);
  }

  const input = requestSchema.safeParse(parsedBody);
  if (!input.success) {
    return json({ error: { code: "INVALID_REQUEST", message: messages.invalidRequest } }, 400);
  }

  try {
    const bot = await verifier(input.data.provider, input.data.token);
    return json({ data: { bot }, meta: { tokenStored: false } }, 200);
  } catch (error) {
    if (error instanceof ProviderVerificationError) {
      if (error.code === "INVALID_TOKEN_FORMAT") {
        return json({ error: { code: "INVALID_REQUEST", message: messages.invalidRequest } }, 400);
      }
      if (error.code === "PROVIDER_REJECTED") {
        return json({ error: { code: "BOT_TOKEN_REJECTED", message: messages.rejected } }, 422);
      }
    }
    return json(
      { error: { code: "PROVIDER_UNAVAILABLE", message: messages.unavailable } },
      502,
    );
  }
}

export function createRouter(options: RouterOptions = {}) {
  const verifier = options.verifyBotToken ?? verifyBotToken;
  const requestBodyDeadlineMs = Math.max(1, options.requestBodyDeadlineMs ?? REQUEST_BODY_DEADLINE_MS);

  return async (request: Request, env: Env, ctx: ExecutionContext): Promise<Response> => {
    void ctx;
    const pathname = new URL(request.url).pathname;
    if (request.method === "GET" && pathname === "/api/health") {
      return Response.json({ ok: true, service: "calenote" });
    }
    if (request.method === "POST" && pathname === "/api/v1/bot-connections/verify") {
      return verifyConnection(request, verifier, requestBodyDeadlineMs);
    }
    return env.ASSETS.fetch(request);
  };
}

export const routeRequest = createRouter();

import { z } from "zod";
import { ProviderVerificationError } from "@/modules/connections/provider-error";
import { verifyBotToken } from "@/modules/connections/verify-bot-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 2_048;

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

function json(body: unknown, status: number): Response {
  return Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
    },
  });
}

export async function POST(request: Request): Promise<Response> {
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return json(
      {
        error: {
          code: "REQUEST_TOO_LARGE",
          message: "Yêu cầu vượt quá giới hạn cho phép.",
        },
      },
      413,
    );
  }

  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return json({ error: { code: "INVALID_REQUEST", message: messages.invalidRequest } }, 400);
  }

  if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
    return json(
      {
        error: {
          code: "REQUEST_TOO_LARGE",
          message: "Yêu cầu vượt quá giới hạn cho phép.",
        },
      },
      413,
    );
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
    const bot = await verifyBotToken(input.data.provider, input.data.token);
    return json({ data: { bot }, meta: { tokenStored: false } }, 200);
  } catch (error) {
    if (error instanceof ProviderVerificationError) {
      if (error.code === "INVALID_TOKEN_FORMAT") {
        return json(
          { error: { code: "INVALID_REQUEST", message: messages.invalidRequest } },
          400,
        );
      }
      if (error.code === "PROVIDER_REJECTED") {
        return json(
          { error: { code: "BOT_TOKEN_REJECTED", message: messages.rejected } },
          422,
        );
      }
    }

    return json(
      { error: { code: "PROVIDER_UNAVAILABLE", message: messages.unavailable } },
      502,
    );
  }
}

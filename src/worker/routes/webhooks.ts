import type { BotProvider, InboundTextMessage } from "@/modules/connections/contracts";
import { parseTelegramWebhook } from "@/modules/connections/providers/telegram";
import { parseZaloWebhook } from "@/modules/connections/providers/zalo";
import { RequestBodyError, readBoundedJson } from "@/modules/http/body";
import type { WebhookAcceptance, WebhookConnection } from "@/modules/inbound/webhook";
import { base64UrlToBytes } from "@/modules/security/encoding";

export interface WebhookRouteMatch {
  provider: BotProvider;
  publicId: string;
  pathSecret: string;
}

export interface WebhookRouteSecrets {
  pathSecret: string;
  headerSecret: string;
}

export interface WebhookRouteDependencies {
  findConnection(provider: BotProvider, publicId: string): Promise<WebhookConnection | null>;
  webhookSecrets(publicId: string): Promise<WebhookRouteSecrets>;
  constantTimeEqual(left: string, right: string): boolean;
  accept(input: { connection: WebhookConnection; message: InboundTextMessage | null }): Promise<WebhookAcceptance>;
}

const routePattern = /^\/webhooks\/(zalo|telegram)\/([A-Za-z0-9_-]{22})\/([A-Za-z0-9_-]{43})$/u;

export function matchWebhookRoute(pathname: string): WebhookRouteMatch | null {
  const match = routePattern.exec(pathname);
  if (!match) return null;
  const publicId = base64UrlToBytes(match[2]);
  const pathSecret = base64UrlToBytes(match[3]);
  if (publicId?.byteLength !== 16 || pathSecret?.byteLength !== 32) return null;
  return {
    provider: match[1] as BotProvider,
    publicId: match[2],
    pathSecret: match[3],
  };
}

function headerName(provider: BotProvider): string {
  return provider === "zalo"
    ? "X-Bot-Api-Secret-Token"
    : "X-Telegram-Bot-Api-Secret-Token";
}

function bodyErrorResponse(error: RequestBodyError): Response {
  return new Response(null, { status: error.status });
}

export async function handleWebhook(
  request: Request,
  route: WebhookRouteMatch,
  dependencies: WebhookRouteDependencies,
): Promise<Response> {
  const connection = await dependencies.findConnection(route.provider, route.publicId);
  if (!connection) return new Response(null, { status: 404 });

  const expected = await dependencies.webhookSecrets(connection.publicId);
  if (!dependencies.constantTimeEqual(route.pathSecret, expected.pathSecret)) {
    return new Response(null, { status: 404 });
  }

  const suppliedHeader = request.headers.get(headerName(route.provider)) || "A";
  if (!dependencies.constantTimeEqual(suppliedHeader, expected.headerSecret)) {
    return new Response(null, { status: 403 });
  }

  let payload: Record<string, unknown>;
  try {
    payload = await readBoundedJson(request, 32 * 1_024, { timeoutMs: 5_000 });
  } catch (error) {
    if (error instanceof RequestBodyError) return bodyErrorResponse(error);
    throw error;
  }

  const message = connection.provider === "zalo"
    ? parseZaloWebhook(payload)
    : parseTelegramWebhook(payload);
  const outcome = await dependencies.accept({ connection, message });
  return new Response(null, { status: outcome.status });
}

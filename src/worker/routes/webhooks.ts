import type { BotProvider } from "@/modules/connections/contracts";
import type { WebhookConnection } from "@/modules/inbound/webhook";
import { base64UrlToBytes } from "@/modules/security/encoding";
import type { WebhookSecrets } from "@/modules/security/keyring";

export interface WebhookRouteMatch {
  provider: BotProvider;
  publicId: string;
  pathSecret: string;
}

export interface WebhookRouteDependencies {
  findConnection(provider: BotProvider, publicId: string): Promise<WebhookConnection | null>;
  webhookSecrets(publicId: string): Promise<WebhookSecrets>;
  constantTimeEqual(left: string, right: string): boolean;
  accept(request: Request, connection: WebhookConnection): Promise<Response>;
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

  return dependencies.accept(request, connection);
}

import type { BotProvider, InboundTextMessage } from "@/modules/connections/contracts";
import { parseTelegramWebhook } from "@/modules/connections/providers/telegram";
import {
  diagnoseZaloWebhookPayload,
  parseZaloWebhook,
  type SafeZaloWebhookParserDiagnostic,
} from "@/modules/connections/providers/zalo";
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

export interface ZaloWebhookAcceptanceDiagnostic extends SafeZaloWebhookParserDiagnostic {
  provider: "zalo";
  request_reached_worker: boolean;
  route_matched: boolean;
  connection_found: boolean;
  path_secret_match: boolean;
  secret_header_present: boolean;
  secret_header_match: boolean;
  body_parse_reached: boolean;
  final_status: number;
}

export interface WebhookRouteDependencies {
  findConnection(provider: BotProvider, publicId: string): Promise<WebhookConnection | null>;
  webhookSecrets(publicId: string): Promise<WebhookRouteSecrets>;
  constantTimeEqual(left: string, right: string): boolean;
  accept(input: { connection: WebhookConnection; message: InboundTextMessage | null }): Promise<WebhookAcceptance>;
  recordZaloWebhookDiagnostic?(diagnostic: ZaloWebhookAcceptanceDiagnostic): void;
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
  const diagnostic = route.provider === "zalo"
    ? {
      provider: "zalo" as const,
      request_reached_worker: true,
      route_matched: true,
      connection_found: false,
      path_secret_match: false,
      secret_header_present: false,
      secret_header_match: false,
      body_parse_reached: false,
      payload_object: false,
      payload_ok_true: false,
      result_object: false,
      event_name_present: false,
      event_is_text_received: false,
      message_object: false,
      from_object: false,
      from_is_bot_present: false,
      from_is_bot_false: false,
      chat_object: false,
      chat_type_present: false,
      chat_is_private: false,
      text_present: false,
      text_is_string: false,
      message_id_present: false,
      from_id_present: false,
      chat_id_present: false,
      date_present: false,
      date_is_number: false,
      date_is_safe_integer: false,
      parser_accepted: false,
      final_status: 500,
    }
    : null;
  const recordDiagnostic = (): void => {
    if (!diagnostic) return;
    try {
      dependencies.recordZaloWebhookDiagnostic?.(diagnostic);
    } catch {
      // Diagnostics must never alter webhook authentication or status behavior.
    }
  };
  const respond = (status: number): Response => {
    if (diagnostic) {
      diagnostic.final_status = status;
      recordDiagnostic();
    }
    return new Response(null, { status });
  };

  try {
    const connection = await dependencies.findConnection(route.provider, route.publicId);
    if (!connection) return respond(404);
    if (diagnostic) diagnostic.connection_found = true;

    const expected = await dependencies.webhookSecrets(connection.publicId);
    if (!dependencies.constantTimeEqual(route.pathSecret, expected.pathSecret)) return respond(404);
    if (diagnostic) diagnostic.path_secret_match = true;

    const suppliedHeader = request.headers.get(headerName(route.provider));
    if (diagnostic) diagnostic.secret_header_present = suppliedHeader !== null;
    if (!dependencies.constantTimeEqual(suppliedHeader || "A", expected.headerSecret)) return respond(403);
    if (diagnostic) diagnostic.secret_header_match = true;

    let payload: Record<string, unknown>;
    try {
      payload = await readBoundedJson(request, 32 * 1_024, { timeoutMs: 5_000 });
      if (diagnostic) diagnostic.body_parse_reached = true;
    } catch (error) {
      if (error instanceof RequestBodyError) return respond(error.status);
      throw error;
    }

    const message = connection.provider === "zalo"
      ? parseZaloWebhook(payload)
      : parseTelegramWebhook(payload);
    if (diagnostic) Object.assign(diagnostic, diagnoseZaloWebhookPayload(payload));
    const outcome = await dependencies.accept({ connection, message });
    return respond(outcome.status);
  } catch (error) {
    recordDiagnostic();
    throw error;
  }
}

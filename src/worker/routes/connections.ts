import { z } from "zod";
import { ConnectionsResponseSchema } from "@/contracts/api/connections";
import { parseSessionCredentials, SessionAuthError, type SessionCredentials } from "@/modules/auth/session";
import { base64UrlToBytes } from "@/modules/security/encoding";
import { readBoundedJson } from "@/modules/http/body";
import { jsonResponse, requireSameOrigin } from "@/modules/http/security";
import type { ConnectionsOperations } from "./operations";

const MAX_BODY_BYTES = 2_048;
const BODY_TIMEOUT_MS = 5_000;
const emptyObjectSchema = z.object({}).strict();

function sessionCredentials(request: Request): SessionCredentials {
  const credentials = parseSessionCredentials(request.headers.get("cookie"));
  if (!credentials) throw new SessionAuthError();
  return credentials;
}

export class InvalidRequestError extends Error {
  readonly code = "INVALID_REQUEST";
  readonly status = 400;

  constructor() {
    super("Yêu cầu không hợp lệ.");
    this.name = "InvalidRequestError";
  }
}

export async function handleConnectCodeRotation(
  request: Request,
  appOrigin: string,
  publicId: string,
  createOperations: () => Promise<Pick<ConnectionsOperations, "requireUser" | "rotateConnectCode">>,
): Promise<Response> {
  requireSameOrigin(request, appOrigin);
  const credentials = sessionCredentials(request);
  const publicIdBytes = base64UrlToBytes(publicId);
  if (publicId.length !== 22 || publicIdBytes?.byteLength !== 16) throw new InvalidRequestError();
  const parsed = emptyObjectSchema.safeParse(
    await readBoundedJson(request, MAX_BODY_BYTES, { timeoutMs: BODY_TIMEOUT_MS }),
  );
  if (!parsed.success) throw new InvalidRequestError();
  const operations = await createOperations();
  const principal = await operations.requireUser(credentials);

  const result = await operations.rotateConnectCode({ userId: principal.userId, publicId });
  return jsonResponse(
    { data: { connectCommand: result.command, expiresAt: result.expiresAt } },
    { headers: { vary: "Cookie" } },
  );
}

export async function handleListConnections(
  request: Request,
  createOperations: () => Promise<Pick<ConnectionsOperations, "requireUser" | "listConnections">>,
): Promise<Response> {
  const credentials = sessionCredentials(request);
  const operations = await createOperations();
  const principal = await operations.requireUser(credentials);
  const connections = await operations.listConnections(principal.userId);
  return jsonResponse(
    ConnectionsResponseSchema.parse({ data: { connections } }),
    { headers: { vary: "Cookie" } },
  );
}

export async function handleWebhookRetry(
  request: Request,
  appOrigin: string,
  publicId: string,
  createOperations: () => Promise<Pick<ConnectionsOperations, "requireUser" | "retryWebhook">>,
): Promise<Response> {
  requireSameOrigin(request, appOrigin);
  const credentials = sessionCredentials(request);
  const publicIdBytes = base64UrlToBytes(publicId);
  if (publicId.length !== 22 || publicIdBytes?.byteLength !== 16) throw new InvalidRequestError();
  const parsed = emptyObjectSchema.safeParse(
    await readBoundedJson(request, MAX_BODY_BYTES, { timeoutMs: BODY_TIMEOUT_MS }),
  );
  if (!parsed.success) throw new InvalidRequestError();
  const operations = await createOperations();
  const principal = await operations.requireUser(credentials);
  const result = await operations.retryWebhook({ userId: principal.userId, publicId });
  return jsonResponse({ data: result }, { headers: { vary: "Cookie" } });
}

export async function handleZaloPollDiagnostic(
  request: Request,
  appOrigin: string,
  publicId: string,
  createOperations: () => Promise<Pick<ConnectionsOperations, "requireUser" | "runZaloPollDiagnostic">>,
): Promise<Response> {
  requireSameOrigin(request, appOrigin);
  const credentials = sessionCredentials(request);
  const publicIdBytes = base64UrlToBytes(publicId);
  if (publicId.length !== 22 || publicIdBytes?.byteLength !== 16) throw new InvalidRequestError();
  const parsed = emptyObjectSchema.safeParse(
    await readBoundedJson(request, MAX_BODY_BYTES, { timeoutMs: BODY_TIMEOUT_MS }),
  );
  if (!parsed.success) throw new InvalidRequestError();
  const operations = await createOperations();
  const principal = await operations.requireUser(credentials);
  const result = await operations.runZaloPollDiagnostic({ userId: principal.userId, publicId });
  return jsonResponse({ data: result }, { headers: { vary: "Cookie" } });
}

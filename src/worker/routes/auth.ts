import { z } from "zod";
import { SessionResponseSchema } from "@/contracts/api/session";
import { parseSessionCookie, SessionAuthError } from "@/modules/auth/session";
import { readBoundedJson } from "@/modules/http/body";
import { jsonResponse, requireSameOrigin } from "@/modules/http/security";
import type { AuthOperations } from "./operations";
import { InvalidRequestError } from "./connections";

const MAX_BODY_BYTES = 1_024;
const BODY_TIMEOUT_MS = 5_000;

const emailSchema = z.string().trim().toLowerCase().max(254).email();
const requestCodeSchema = z.object({ email: emailSchema }).strict();
const verifyCodeSchema = z.object({
  email: emailSchema,
  code: z.string().regex(/^[0-9]{6}$/u),
}).strict();
const emptyObjectSchema = z.object({}).strict();

function connectingIp(request: Request): string {
  return request.headers.get("CF-Connecting-IP") ?? "unavailable";
}

function authenticatedHeaders(headers: HeadersInit = {}): Headers {
  const result = new Headers(headers);
  result.set("vary", "Cookie");
  return result;
}

export async function handleRequestLoginCode(
  request: Request,
  appOrigin: string,
  createOperations: () => Promise<Pick<AuthOperations, "requestLoginCode">>,
): Promise<Response> {
  requireSameOrigin(request, appOrigin);
  const parsed = requestCodeSchema.safeParse(
    await readBoundedJson(request, MAX_BODY_BYTES, { timeoutMs: BODY_TIMEOUT_MS }),
  );
  if (!parsed.success) throw new InvalidRequestError();
  const operations = await createOperations();
  await operations.requestLoginCode({
    email: parsed.data.email,
    clientIp: connectingIp(request),
  });
  return jsonResponse({ data: { accepted: true } }, { status: 202 });
}

export async function handleVerifyLoginCode(
  request: Request,
  appOrigin: string,
  createOperations: () => Promise<Pick<AuthOperations, "verifyLoginCode">>,
): Promise<Response> {
  requireSameOrigin(request, appOrigin);
  const parsed = verifyCodeSchema.safeParse(
    await readBoundedJson(request, MAX_BODY_BYTES, { timeoutMs: BODY_TIMEOUT_MS }),
  );
  if (!parsed.success) throw new InvalidRequestError();
  const operations = await createOperations();
  const result = await operations.verifyLoginCode({
    email: parsed.data.email,
    code: parsed.data.code,
    clientIp: connectingIp(request),
  });
  return jsonResponse(
    { data: { authenticated: true } },
    { headers: { "set-cookie": result.cookie } },
  );
}

export async function handleLogout(
  request: Request,
  appOrigin: string,
  createOperations: () => Promise<Pick<AuthOperations, "logout">>,
): Promise<Response> {
  requireSameOrigin(request, appOrigin);
  const parsed = emptyObjectSchema.safeParse(
    await readBoundedJson(request, MAX_BODY_BYTES, { timeoutMs: BODY_TIMEOUT_MS }),
  );
  if (!parsed.success) throw new InvalidRequestError();
  const operations = await createOperations();
  const result = await operations.logout(request);
  return jsonResponse(
    { data: { loggedOut: true } },
    { headers: authenticatedHeaders({ "set-cookie": result.clearCookie }) },
  );
}

export async function handleGetSession(
  request: Request,
  createOperations: () => Promise<Pick<AuthOperations, "requireUser" | "getSessionUser">>,
): Promise<Response> {
  if (!parseSessionCookie(request)) throw new SessionAuthError();
  const operations = await createOperations();
  const principal = await operations.requireUser(request);
  const user = await operations.getSessionUser(principal.userId);
  return jsonResponse(SessionResponseSchema.parse({ data: { user } }), { headers: authenticatedHeaders() });
}

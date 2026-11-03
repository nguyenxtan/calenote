import {
  RequestEmailRegistrationSchema,
  RequestEmailRegistrationResponseSchema,
  VerifyEmailRegistrationSchema,
  VerifyEmailRegistrationResponseSchema,
} from "@/contracts/api/email-registration";
import { readBoundedJson } from "@/modules/http/body";
import { jsonResponse, requireSameOrigin } from "@/modules/http/security";
import { InvalidRequestError } from "./connections";

const BINDING_COOKIE = "__Host-calenote_registration";
const COOKIE_ATTRIBUTES = "HttpOnly; Secure; SameSite=Strict";
export interface EmailRegistrationOperations {
  requestEmailRegistration(input: { email: string; displayName: string; clientIp: string; browserBinding: string }): Promise<{ challengeId: string; expiresAt: number }>;
  verifyEmailRegistration(input: { challengeId: string; email: string; code: string; clientIp: string; browserBinding: string }): Promise<{ cookie: string }>;
}
function clientIp(request: Request): string {
  return request.headers.get("CF-Connecting-IP") ?? "unavailable";
}
function bindingFromCookie(request: Request): string {
  const matches = (request.headers.get("cookie") ?? "").split(";")
    .map((part) => part.trim()).filter((part) => part.startsWith(`${BINDING_COOKIE}=`));
  if (matches.length !== 1) throw new InvalidRequestError();
  const binding = matches[0].slice(BINDING_COOKIE.length + 1);
  if (!/^[a-f0-9]{64}$/u.test(binding)) throw new InvalidRequestError();
  return binding;
}
export async function handleRequestEmailRegistration(
  request: Request,
  appOrigin: string,
  createOperations: () => Promise<Pick<EmailRegistrationOperations, "requestEmailRegistration">>,
): Promise<Response> {
  requireSameOrigin(request, appOrigin);
  const parsed = RequestEmailRegistrationSchema.safeParse(await readBoundedJson(request, 1_024, { timeoutMs: 5_000 }));
  if (!parsed.success) throw new InvalidRequestError();
  const browserBinding = Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, "0")).join("");
  const operations = await createOperations();
  const result = await operations.requestEmailRegistration({ ...parsed.data, clientIp: clientIp(request), browserBinding });
  return jsonResponse(RequestEmailRegistrationResponseSchema.parse({ data: { accepted: true, ...result } }), {
    status: 202,
    headers: { vary: "Cookie", "set-cookie": `${BINDING_COOKIE}=${browserBinding}; Path=/; Max-Age=600; HttpOnly; Secure; SameSite=Strict` },
  });
}
export async function handleVerifyEmailRegistration(
  request: Request,
  appOrigin: string,
  createOperations: () => Promise<Pick<EmailRegistrationOperations, "verifyEmailRegistration">>,
): Promise<Response> {
  requireSameOrigin(request, appOrigin);
  const browserBinding = bindingFromCookie(request);
  const parsed = VerifyEmailRegistrationSchema.safeParse(await readBoundedJson(request, 1_024, { timeoutMs: 5_000 }));
  if (!parsed.success) throw new InvalidRequestError();
  const operations = await createOperations();
  const result = await operations.verifyEmailRegistration({ ...parsed.data, clientIp: clientIp(request), browserBinding });
  const headers = new Headers({ vary: "Cookie" });
  headers.append("set-cookie", result.cookie);
  headers.append("set-cookie", `${BINDING_COOKIE}=; Path=/; Max-Age=0; ${COOKIE_ATTRIBUTES}`);
  return jsonResponse(VerifyEmailRegistrationResponseSchema.parse({ data: { registered: true, next: "/app/connections" } }), { headers });
}

import { z } from "zod";
import { RemindersResponseSchema } from "@/contracts/api/reminders";
import { parseSessionCredentials, SessionAuthError, type SessionCredentials } from "@/modules/auth/session";
import { base64UrlToBytes } from "@/modules/security/encoding";
import { readBoundedJson } from "@/modules/http/body";
import { jsonResponse, requireSameOrigin } from "@/modules/http/security";
import { InvalidReminderError } from "@/modules/reminders/api-service";
import type { RemindersOperations } from "./operations";
import { InvalidRequestError } from "./connections";

const CREATE_BODY_BYTES = 16 * 1_024;
const EMPTY_BODY_BYTES = 1_024;
const BODY_TIMEOUT_MS = 5_000;
const createSchema = z.object({
  intentId: z.string().regex(/^[A-Za-z0-9_-]{16,80}$/u).optional(),
  title: z.string().max(500),
  scheduledAt: z.number(),
  timezone: z.literal("Asia/Ho_Chi_Minh"),
}).strict();
const emptyObjectSchema = z.object({}).strict();

function authenticatedHeaders(): Headers {
  return new Headers({ vary: "Cookie" });
}

function requireCanonicalPublicId(value: string): void {
  const bytes = base64UrlToBytes(value);
  if (value.length !== 22 || bytes?.byteLength !== 16) throw new InvalidRequestError();
}

function requireCanonicalSession(request: Request): SessionCredentials {
  const credentials = parseSessionCredentials(request.headers.get("cookie"));
  if (!credentials) throw new SessionAuthError();
  return credentials;
}

export async function handleListReminders(
  request: Request,
  createOperations: () => Promise<Pick<RemindersOperations, "requireUser" | "listReminders">>,
): Promise<Response> {
  const credentials = requireCanonicalSession(request);
  const operations = await createOperations();
  const principal = await operations.requireUser(credentials);
  const params = new URL(request.url).searchParams;
  const after = params.get("after");
  if ([...params.keys()].some(key => key !== "after") || params.getAll("after").length > 1 || (after !== null && !/^[A-Za-z0-9_-]{1,128}$/u.test(after))) throw new InvalidRequestError();
  const reminders = after === null ? await operations.listReminders(principal.userId) : await operations.listReminders(principal.userId, after);
  const page = reminders.slice(0, 100);
  // Leave envelope/cursor headroom beneath the browser's 128KiB response bound.
  while (page.length > 1 && new TextEncoder().encode(JSON.stringify(page)).byteLength > 120 * 1024) page.pop();
  const nextCursor = reminders.length > page.length ? page.at(-1)!.publicId : undefined;
  return jsonResponse(RemindersResponseSchema.parse({ data: { reminders: page, ...(nextCursor === undefined ? {} : { nextCursor }) } }), { headers: authenticatedHeaders() });
}

export async function handleCreateReminder(
  request: Request,
  appOrigin: string,
  createOperations: () => Promise<Pick<RemindersOperations, "requireUser" | "createReminder">>,
): Promise<Response> {
  requireSameOrigin(request, appOrigin);
  const credentials = requireCanonicalSession(request);
  const parsed = createSchema.safeParse(
    await readBoundedJson(request, CREATE_BODY_BYTES, { timeoutMs: BODY_TIMEOUT_MS }),
  );
  if (!parsed.success) throw new InvalidReminderError();
  const operations = await createOperations();
  const principal = await operations.requireUser(credentials);
  const reminder = await operations.createReminder({
    userId: principal.userId,
    ...parsed.data,
  });
  return jsonResponse(
    { data: { reminder } },
    { status: 201, headers: authenticatedHeaders() },
  );
}

export async function handleCancelReminder(
  request: Request,
  appOrigin: string,
  publicId: string,
  createOperations: () => Promise<Pick<RemindersOperations, "requireUser" | "cancelReminder">>,
): Promise<Response> {
  requireSameOrigin(request, appOrigin);
  const credentials = requireCanonicalSession(request);
  requireCanonicalPublicId(publicId);
  const parsed = emptyObjectSchema.safeParse(
    await readBoundedJson(request, EMPTY_BODY_BYTES, { timeoutMs: BODY_TIMEOUT_MS }),
  );
  if (!parsed.success) throw new InvalidRequestError();
  const operations = await createOperations();
  const principal = await operations.requireUser(credentials);
  const result = await operations.cancelReminder({ userId: principal.userId, publicId });
  return jsonResponse({ data: result }, { headers: authenticatedHeaders() });
}

export async function handleResolveReminderIntent(request: Request, appOrigin: string, createOperations: () => Promise<RemindersOperations>): Promise<Response> {
  requireSameOrigin(request, appOrigin);
  const credentials = requireCanonicalSession(request);
  const parsed = z.object({ intentId: z.string().regex(/^[A-Za-z0-9_-]{16,80}$/u) }).strict().safeParse(await readBoundedJson(request, EMPTY_BODY_BYTES, { timeoutMs: BODY_TIMEOUT_MS }));
  if (!parsed.success) throw new InvalidRequestError();
  const operations = await createOperations();
  const principal = await operations.requireUser(credentials);
  if (!operations.resolveReminderIntent) throw new Error("Intent resolution unavailable");
  const result = await operations.resolveReminderIntent({ userId: principal.userId, intentId: parsed.data.intentId });
  return jsonResponse({ data: result }, { headers: authenticatedHeaders() });
}

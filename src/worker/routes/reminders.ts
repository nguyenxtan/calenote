import { z } from "zod";
import { parseSessionCookie, SessionAuthError } from "@/modules/auth/session";
import { base64UrlToBytes } from "@/modules/security/encoding";
import { readBoundedJson } from "@/modules/http/body";
import { jsonResponse, requireSameOrigin } from "@/modules/http/security";
import { InvalidReminderError } from "@/modules/reminders/api-service";
import type { WorkerOperations } from "../router";
import { InvalidRequestError } from "./connections";

const CREATE_BODY_BYTES = 16 * 1_024;
const EMPTY_BODY_BYTES = 1_024;
const BODY_TIMEOUT_MS = 5_000;
const createSchema = z.object({
  title: z.string(),
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

function requireCanonicalSession(request: Request): void {
  if (!parseSessionCookie(request)) throw new SessionAuthError();
}

export async function handleListReminders(
  request: Request,
  createOperations: () => Promise<WorkerOperations>,
): Promise<Response> {
  requireCanonicalSession(request);
  const operations = await createOperations();
  const principal = await operations.requireUser(request);
  const reminders = await operations.listReminders(principal.userId);
  return jsonResponse({ data: { reminders } }, { headers: authenticatedHeaders() });
}

export async function handleCreateReminder(
  request: Request,
  appOrigin: string,
  createOperations: () => Promise<WorkerOperations>,
): Promise<Response> {
  requireSameOrigin(request, appOrigin);
  requireCanonicalSession(request);
  const parsed = createSchema.safeParse(
    await readBoundedJson(request, CREATE_BODY_BYTES, { timeoutMs: BODY_TIMEOUT_MS }),
  );
  if (!parsed.success) throw new InvalidReminderError();
  const operations = await createOperations();
  const principal = await operations.requireUser(request);
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
  createOperations: () => Promise<WorkerOperations>,
): Promise<Response> {
  requireSameOrigin(request, appOrigin);
  requireCanonicalSession(request);
  requireCanonicalPublicId(publicId);
  const parsed = emptyObjectSchema.safeParse(
    await readBoundedJson(request, EMPTY_BODY_BYTES, { timeoutMs: BODY_TIMEOUT_MS }),
  );
  if (!parsed.success) throw new InvalidRequestError();
  const operations = await createOperations();
  const principal = await operations.requireUser(request);
  const result = await operations.cancelReminder({ userId: principal.userId, publicId });
  return jsonResponse({ data: result }, { headers: authenticatedHeaders() });
}

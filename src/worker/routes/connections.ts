import { z } from "zod";
import { parseSessionCookie, SessionAuthError } from "@/modules/auth/session";
import { readBoundedJson } from "@/modules/http/body";
import { jsonResponse, requireSameOrigin } from "@/modules/http/security";
import type { WorkerOperations } from "../router";

const MAX_BODY_BYTES = 2_048;
const emptyObjectSchema = z.object({}).strict();

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
  createOperations: () => Promise<WorkerOperations>,
): Promise<Response> {
  requireSameOrigin(request, appOrigin);
  if (!parseSessionCookie(request)) throw new SessionAuthError();
  const parsed = emptyObjectSchema.safeParse(await readBoundedJson(request, MAX_BODY_BYTES));
  if (!parsed.success) throw new InvalidRequestError();
  const operations = await createOperations();
  const principal = await operations.requireUser(request);

  const result = await operations.rotateConnectCode({ userId: principal.userId, publicId });
  return jsonResponse({ data: { connectCommand: result.command, expiresAt: result.expiresAt } });
}

import { z } from "zod";
import { ActionDecisionResponseSchema, ActionsResponseSchema } from "@/contracts/api/actions";
import { parseSessionCredentials, SessionAuthError, type SessionCredentials } from "@/modules/auth/session";
import { readBoundedJson } from "@/modules/http/body";
import { jsonResponse, requireSameOrigin } from "@/modules/http/security";
import { base64UrlToBytes } from "@/modules/security/encoding";
import type { CandidateDecisionResult } from "@/modules/source-actions/service";
import type { ActionsOperations } from "./operations";
import { InvalidRequestError } from "./connections";

const EMPTY_BODY_BYTES = 1_024;
const BODY_TIMEOUT_MS = 5_000;
const emptyObjectSchema = z.object({}).strict();

export class ActionNotFoundError extends Error {
  readonly code = "ACTION_NOT_FOUND";
  readonly status = 404;

  constructor() {
    super("Không tìm thấy hành động.");
    this.name = "ActionNotFoundError";
  }
}

export class ActionDecisionConflictError extends Error {
  readonly code = "ACTION_ALREADY_DECIDED";
  readonly status = 409;

  constructor() {
    super("Hành động này đã được quyết định.");
    this.name = "ActionDecisionConflictError";
  }
}

export class ActionChannelUnavailableError extends Error {
  readonly code = "ACTION_CHANNEL_UNAVAILABLE";
  readonly status = 409;

  constructor() {
    super("Không thể tạo nhắc hẹn từ hành động này.");
    this.name = "ActionChannelUnavailableError";
  }
}

function authenticatedHeaders(): Headers {
  return new Headers({ vary: "Cookie" });
}

function requireCanonicalSession(request: Request): SessionCredentials {
  const credentials = parseSessionCredentials(request.headers.get("cookie"));
  if (!credentials) throw new SessionAuthError();
  return credentials;
}

function requireCanonicalActionId(value: string): void {
  const bytes = base64UrlToBytes(value);
  if (value.length !== 22 || bytes?.byteLength !== 16) throw new InvalidRequestError();
}

function decisionResponse(result: CandidateDecisionResult): Response {
  if (result.status === "NOT_FOUND") throw new ActionNotFoundError();
  if (result.status === "ALREADY_DECIDED") throw new ActionDecisionConflictError();
  if (result.status === "CHANNEL_UNAVAILABLE") throw new ActionChannelUnavailableError();
  const decision = result.status === "APPROVED"
    ? { decision: "APPROVED" as const, reminderPublicId: result.reminderPublicId }
    : { decision: "REJECTED" as const };
  return jsonResponse(ActionDecisionResponseSchema.parse({ data: decision }), { headers: authenticatedHeaders() });
}

async function requireEmptyBody(request: Request): Promise<void> {
  const parsed = emptyObjectSchema.safeParse(
    await readBoundedJson(request, EMPTY_BODY_BYTES, { timeoutMs: BODY_TIMEOUT_MS }),
  );
  if (!parsed.success) throw new InvalidRequestError();
}

export async function handleListActions(
  request: Request,
  createOperations: () => Promise<Pick<ActionsOperations, "requireUser" | "listPendingActions">>,
): Promise<Response> {
  const credentials = requireCanonicalSession(request);
  const operations = await createOperations();
  const principal = await operations.requireUser(credentials);
  const actions = await operations.listPendingActions(principal.userId);
  return jsonResponse(ActionsResponseSchema.parse({
    data: {
      actions: actions.map(({ id, title, scheduledAt, timezone, status }) => ({ id, title, scheduledAt, timezone, status })),
    },
  }), { headers: authenticatedHeaders() });
}

export async function handleApproveAction(
  request: Request,
  appOrigin: string,
  candidateId: string,
  createOperations: () => Promise<Pick<ActionsOperations, "requireUser" | "approveAction">>,
): Promise<Response> {
  requireSameOrigin(request, appOrigin);
  const credentials = requireCanonicalSession(request);
  requireCanonicalActionId(candidateId);
  await requireEmptyBody(request);
  const operations = await createOperations();
  const principal = await operations.requireUser(credentials);
  return decisionResponse(await operations.approveAction({ userId: principal.userId, candidateId }));
}

export async function handleRejectAction(
  request: Request,
  appOrigin: string,
  candidateId: string,
  createOperations: () => Promise<Pick<ActionsOperations, "requireUser" | "rejectAction">>,
): Promise<Response> {
  requireSameOrigin(request, appOrigin);
  const credentials = requireCanonicalSession(request);
  requireCanonicalActionId(candidateId);
  await requireEmptyBody(request);
  const operations = await createOperations();
  const principal = await operations.requireUser(credentials);
  return decisionResponse(await operations.rejectAction({ userId: principal.userId, candidateId }));
}

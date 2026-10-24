import { ReminderListResponseV2Schema } from "@/contracts/api/reminders-v2";
import { PreviewResponseV1Schema, PreviewDecisionRequestV1Schema, PreviewDecisionResponseV1Schema, type PreviewDecisionRequestV1 } from "@/contracts/api/conversation-previews";

const MAX_RESPONSE_BYTES = 128 * 1_024;
const SAFE_FALLBACK = "Calenote chưa thể hoàn tất yêu cầu.";

type ApiMethod = "GET" | "POST" | "DELETE" | "PATCH" | "PUT";

interface ApiRequestOptions {
  method?: ApiMethod;
  reminderCursor?: string;
  body?: unknown;
  signal?: AbortSignal;
  authenticated?: boolean;
  onUnauthorized?: () => void;
}

interface ErrorEnvelope {
  error?: {
    code?: unknown;
    message?: unknown;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireCanonicalApiPath(path: string): void {
  if (
    !/^\/api\/[A-Za-z0-9_/-]+$/u.test(path)
    || path.includes("//")
    || path.split("/").some((part) => part === "." || part === "..")
  ) {
    throw new TypeError("Đường dẫn API không hợp lệ.");
  }
}

function invalidResponse(status = 502): ApiResponseError {
  return new ApiResponseError(status, "INVALID_RESPONSE", SAFE_FALLBACK);
}

export async function readBoundedJson(response: Response): Promise<Record<string, unknown>> {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("application/json")) throw invalidResponse(response.status || 502);

  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    const parsedLength = Number(declaredLength);
    if (!Number.isSafeInteger(parsedLength) || parsedLength < 0 || parsedLength > MAX_RESPONSE_BYTES) {
      throw invalidResponse(response.status || 502);
    }
  }

  if (!response.body) throw invalidResponse(response.status || 502);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        // Best-effort cleanup must not delay or replace the size-limit error.
        void reader.cancel().catch(() => undefined);
        throw invalidResponse(response.status || 502);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw invalidResponse(response.status || 502);
  }
  if (!isRecord(payload)) throw invalidResponse(response.status || 502);
  return payload;
}

function safeError(payload: Record<string, unknown>): { code: string; message: string } {
  const envelope = payload as ErrorEnvelope;
  const code = typeof envelope.error?.code === "string"
    && envelope.error.code.length <= 80
    ? envelope.error.code
    : "REQUEST_FAILED";
  const message = typeof envelope.error?.message === "string"
    && envelope.error.message.length > 0
    && envelope.error.message.length <= 240
    ? envelope.error.message
    : SAFE_FALLBACK;
  return { code, message };
}

function isAbort(error: unknown): boolean {
  return isRecord(error) && error.name === "AbortError";
}

export class ApiResponseError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiResponseError";
  }
}

export class AmbiguousMutationError extends Error {
  constructor() {
    super("Kết quả thao tác chưa xác định.");
    this.name = "AmbiguousMutationError";
  }
}

export class ApiNetworkError extends Error {
  constructor() {
    super("Không thể kết nối đến Calenote.");
    this.name = "ApiNetworkError";
  }
}

export async function apiRequest<T>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<T> {
  requireCanonicalApiPath(path);
  const method = options.method ?? "GET";
  const hasBody = options.body !== undefined;
  if (options.reminderCursor !== undefined && (path !== "/api/reminders" || method !== "GET" || !/^[A-Za-z0-9_-]{1,128}$/u.test(options.reminderCursor))) throw new TypeError("Trang lời nhắc không hợp lệ.");
  const requestPath = options.reminderCursor === undefined ? path : `${path}?after=${options.reminderCursor}`;
  const headers: Record<string, string> = { accept: "application/json" };
  if (hasBody) headers["content-type"] = "application/json";

  let response: Response;
  try {
    response = await fetch(requestPath, {
      method,
      credentials: "same-origin",
      cache: "no-store",
      headers,
      body: hasBody ? JSON.stringify(options.body) : undefined,
      signal: options.signal,
    });
  } catch (error) {
    if (isAbort(error)) throw error;
    if (method === "POST" || method === "DELETE" || method === "PATCH") throw new AmbiguousMutationError();
    throw new ApiNetworkError();
  }

  // A transport/mock may resolve despite cancellation. It must not invalidate a newer session.
  if (options.signal?.aborted) throw new DOMException("Aborted", "AbortError");
  if (response.status === 401 && options.authenticated) {
    // Notify the current request before the global event advances subscribers' session epochs.
    try { options.onUnauthorized?.(); }
    finally { if (typeof window !== "undefined") window.dispatchEvent(new Event("calenote-session-changed")); }
  }
  if (response.ok && method !== "GET" && ["/api/auth/logout", "/api/account/profile"].includes(path) && typeof window !== "undefined") {
    window.dispatchEvent(new Event("calenote-session-changed"));
  }
  let payload: Record<string, unknown>;
  try {
    payload = await readBoundedJson(response);
  } catch (error) {
    if (response.ok && (method === "POST" || method === "DELETE" || method === "PATCH")) {
      throw new AmbiguousMutationError();
    }
    throw error;
  }
  if (!response.ok) {
    const error = safeError(payload);
    throw new ApiResponseError(response.status, error.code, error.message);
  }
  if (!("data" in payload)) {
    if (method === "POST" || method === "DELETE" || method === "PATCH") throw new AmbiguousMutationError();
    throw invalidResponse(response.status);
  }
  return payload.data as T;
}

export async function loadDetailedReminders(options: Pick<ApiRequestOptions, "signal" | "onUnauthorized"> = {}) {
  const data = await apiRequest<unknown>("/api/v2/reminders", { authenticated: true, ...options });
  return ReminderListResponseV2Schema.shape.data.parse(data);
}

export async function loadConversationPreviews(options: Pick<ApiRequestOptions, "signal" | "onUnauthorized"> = {}) {
  const data = await apiRequest<unknown>("/api/v2/conversation-previews", { authenticated: true, ...options });
  return PreviewResponseV1Schema.shape.data.parse(data);
}

export async function decideConversationPreview(request: PreviewDecisionRequestV1, options: Pick<ApiRequestOptions, "signal" | "onUnauthorized"> = {}) {
  const body = PreviewDecisionRequestV1Schema.parse(request);
  const data = await apiRequest<unknown>("/api/v2/conversation-previews/decision", { method: "POST", body, authenticated: true, ...options });
  return PreviewDecisionResponseV1Schema.shape.data.parse(data);
}

export type RequestBodyErrorCode =
  | "UNSUPPORTED_MEDIA_TYPE"
  | "INVALID_CONTENT_LENGTH"
  | "REQUEST_TOO_LARGE"
  | "INVALID_BODY"
  | "BODY_TIMEOUT"
  | "INVALID_UTF8"
  | "INVALID_JSON"
  | "INVALID_JSON_OBJECT";

const messages: Record<RequestBodyErrorCode, string> = {
  UNSUPPORTED_MEDIA_TYPE: "Content-Type must be application/json.",
  INVALID_CONTENT_LENGTH: "Content-Length is invalid.",
  REQUEST_TOO_LARGE: "Request body exceeds the allowed size.",
  INVALID_BODY: "Unable to read request body.",
  BODY_TIMEOUT: "Request body read timed out.",
  INVALID_UTF8: "Request body must be valid UTF-8.",
  INVALID_JSON: "Request body must be valid JSON.",
  INVALID_JSON_OBJECT: "Request body must be a JSON object.",
};

export class RequestBodyError extends Error {
  constructor(
    readonly code: RequestBodyErrorCode,
    readonly status: number,
  ) {
    super(messages[code]);
    this.name = "RequestBodyError";
  }
}

function assertJsonContentType(request: Request): void {
  const contentType = request.headers.get("content-type");
  const mediaType = contentType?.split(";", 1)[0].trim().toLowerCase();
  if (mediaType !== "application/json") {
    throw new RequestBodyError("UNSUPPORTED_MEDIA_TYPE", 415);
  }
}

function readDeclaredLength(request: Request, maximumBytes: number): void {
  const value = request.headers.get("content-length");
  if (value === null) return;
  if (!/^\d+$/u.test(value)) {
    throw new RequestBodyError("INVALID_CONTENT_LENGTH", 400);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new RequestBodyError("INVALID_CONTENT_LENGTH", 400);
  }
  if (parsed > maximumBytes) {
    throw new RequestBodyError("REQUEST_TOO_LARGE", 413);
  }
}

async function readAtMost(
  request: Request,
  maximumBytes: number,
  timeoutMs?: number,
): Promise<Uint8Array> {
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = timeoutMs === undefined
    ? null
    : new Promise<never>((_, reject) => {
      timeoutId = setTimeout(
        () => reject(new RequestBodyError("BODY_TIMEOUT", 408)),
        timeoutMs,
      );
    });

  try {
    while (true) {
      const read = reader.read();
      const { done, value } = timeout ? await Promise.race([read, timeout]) : await read;
      if (done) break;
      length += value.byteLength;
      if (length > maximumBytes) {
        await reader.cancel().catch(() => undefined);
        throw new RequestBodyError("REQUEST_TOO_LARGE", 413);
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof RequestBodyError) {
      await reader.cancel().catch(() => undefined);
      throw error;
    }
    throw new RequestBodyError("INVALID_BODY", 400);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    reader.releaseLock();
  }

  const joined = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return joined;
}

export async function readBoundedJson(
  request: Request,
  maximumBytes: number,
  options: { timeoutMs?: number } = {},
): Promise<Record<string, unknown>> {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) {
    throw new TypeError("maximumBytes must be a positive integer");
  }
  assertJsonContentType(request);
  readDeclaredLength(request, maximumBytes);
  if (
    options.timeoutMs !== undefined &&
    (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 1)
  ) {
    throw new TypeError("timeoutMs must be a positive integer");
  }
  const bytes = await readAtMost(request, maximumBytes, options.timeoutMs);

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new RequestBodyError("INVALID_UTF8", 400);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new RequestBodyError("INVALID_JSON", 400);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new RequestBodyError("INVALID_JSON_OBJECT", 400);
  }
  return parsed as Record<string, unknown>;
}

export class SameOriginError extends Error {
  readonly code = "ORIGIN_REJECTED";
  readonly status = 403;

  constructor() {
    super("Request origin is not allowed.");
    this.name = "SameOriginError";
  }
}

export function requireSameOrigin(request: Request, appOrigin: string): void {
  const origin = request.headers.get("origin");
  if (!origin || origin === "null" || origin.includes(",")) throw new SameOriginError();

  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    throw new SameOriginError();
  }
  const isBareOrigin =
    parsed.username === "" &&
    parsed.password === "" &&
    parsed.pathname === "/" &&
    parsed.search === "" &&
    parsed.hash === "";
  if (!isBareOrigin || parsed.origin !== appOrigin) throw new SameOriginError();
}

const serializationFallback = JSON.stringify({
  error: { code: "RESPONSE_SERIALIZATION_FAILED", message: "Unable to serialize response." },
});

export function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  let serialized: string;
  let status = init.status;
  try {
    serialized = JSON.stringify(body);
    if (serialized === undefined) throw new TypeError("Response is not JSON serializable");
  } catch {
    serialized = serializationFallback;
    status = 500;
  }

  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  headers.set("x-content-type-options", "nosniff");
  return new Response(serialized, { ...init, status, headers });
}

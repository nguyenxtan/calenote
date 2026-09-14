const PROBE_TIMEOUT_MS = 8_000;
export const ZALO_EGRESS_PROBE_WINDOW_START_MS = Date.parse("2026-09-14T05:56:00.000Z");
const ZALO_EGRESS_PROBE_WINDOW_END_MS = ZALO_EGRESS_PROBE_WINDOW_START_MS + 60_000;
export const CALENOTE_EGRESS_ISOLATION_V2_WINDOW_START_MS = Date.parse("2026-09-14T06:16:00.000Z");
const CALENOTE_EGRESS_ISOLATION_V2_WINDOW_END_MS = CALENOTE_EGRESS_ISOLATION_V2_WINDOW_START_MS + 60_000;

const probes = [
  { probe_name: "PROBE_A", hostname: "example.com", method: "GET", url: "https://example.com/" },
  { probe_name: "PROBE_B", hostname: "bot-api.zaloplatforms.com", method: "POST", url: "https://bot-api.zaloplatforms.com/" },
  { probe_name: "PROBE_C", hostname: "bot-api.zaloplatforms.com", method: "POST", url: "https://bot-api.zaloplatforms.com/botINVALID/getMe" },
] as const;

type ProbeName = (typeof probes)[number]["probe_name"];
type ProbeMethod = (typeof probes)[number]["method"];

export interface ZaloEgressProbeEvent {
  probe_name: ProbeName;
  hostname: "bot-api.zaloplatforms.com" | "example.com";
  method: ProbeMethod;
  elapsed_ms: number;
  response_received: boolean;
  http_status: number | null;
  timeout: boolean;
  abort: boolean;
  safe_exception_name: "AbortError" | "Error" | "TimeoutError" | null;
  safe_error_classification: "CLOUDFLARE_SUBREQUEST_POLICY" | "DNS_FAILURE" | "HOST_ACCESS_DENIED" | "NETWORK_CONNECTION_FAILURE" | "TIMEOUT" | "TLS_FAILURE" | "UNKNOWN_FETCH_FAILURE" | null;
}

export type ZaloEgressProbeLogger = (event: ZaloEgressProbeEvent) => void;

export interface CalenoteEgressIsolationV2ProbeEvent {
  probe_name: "PROBE_D" | "PROBE_E";
  response_received: boolean;
  http_status: number | null;
  safe_exception_name: "AbortError" | "Error" | "TimeoutError" | null;
  safe_error_classification: ZaloEgressProbeEvent["safe_error_classification"];
}

export type CalenoteEgressIsolationV2ProbeLogger = (event: CalenoteEgressIsolationV2ProbeEvent) => void;

function safeExceptionName(error: unknown): ZaloEgressProbeEvent["safe_exception_name"] {
  const name = typeof error === "object" && error !== null && "name" in error && typeof error.name === "string"
    ? error.name
    : null;
  if (name === "TimeoutError") return "TimeoutError";
  if (name === "AbortError") return "AbortError";
  if (error instanceof Error) return "Error";
  if (name !== null) return "Error";
  return null;
}

function classifyFetchFailure(error: unknown): NonNullable<ZaloEgressProbeEvent["safe_error_classification"]> {
  const name = typeof error === "object" && error !== null && "name" in error && typeof error.name === "string"
    ? error.name
    : null;
  if (name === "TimeoutError") return "TIMEOUT";

  const message = typeof error === "object" && error !== null && "message" in error && typeof error.message === "string"
    ? error.message.toLowerCase()
    : "";
  if (/subrequest|too many requests from worker/u.test(message)) return "CLOUDFLARE_SUBREQUEST_POLICY";
  if (/access denied|host .* denied|not allowed/u.test(message)) return "HOST_ACCESS_DENIED";
  if (/dns|resolve|hostname|nxdomain/u.test(message)) return "DNS_FAILURE";
  if (/tls|ssl|certificate/u.test(message)) return "TLS_FAILURE";
  if (/network|connection|socket|fetch failed/u.test(message)) return "NETWORK_CONNECTION_FAILURE";
  return "UNKNOWN_FETCH_FAILURE";
}

function emitSafely<T>(logger: (event: T) => void, event: T): void {
  try {
    logger(event);
  } catch {
    // Diagnostics cannot affect production scheduling.
  }
}

function defaultLogger(event: ZaloEgressProbeEvent | CalenoteEgressIsolationV2ProbeEvent): void {
  console.log(JSON.stringify(event));
}

export function isZaloEgressProbeWindow(scheduledTime: number): boolean {
  return scheduledTime >= ZALO_EGRESS_PROBE_WINDOW_START_MS
    && scheduledTime < ZALO_EGRESS_PROBE_WINDOW_END_MS;
}

export function isCalenoteEgressIsolationV2Window(scheduledTime: number): boolean {
  return scheduledTime >= CALENOTE_EGRESS_ISOLATION_V2_WINDOW_START_MS
    && scheduledTime < CALENOTE_EGRESS_ISOLATION_V2_WINDOW_END_MS;
}

export async function runCalenoteEgressIsolationV2Probes(
  fetcher: typeof fetch = fetch,
  logger: CalenoteEgressIsolationV2ProbeLogger = defaultLogger,
): Promise<void> {
  const probes: ReadonlyArray<readonly [CalenoteEgressIsolationV2ProbeEvent["probe_name"], () => Promise<Response>]> = [
    ["PROBE_D", () => fetcher("https://example.com/")],
    ["PROBE_E", () => fetcher("https://example.com/", { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) })],
  ];

  for (const [probeName, run] of probes) {
    let event: CalenoteEgressIsolationV2ProbeEvent = {
      probe_name: probeName,
      response_received: false,
      http_status: null,
      safe_exception_name: null,
      safe_error_classification: null,
    };
    try {
      const response = await run();
      event = { ...event, response_received: true, http_status: response.status };
    } catch (error) {
      event = {
        ...event,
        safe_exception_name: safeExceptionName(error),
        safe_error_classification: classifyFetchFailure(error),
      };
    }
    emitSafely(logger, event);
  }
}

export async function runZaloEgressIsolationProbes(
  fetcher: typeof fetch = fetch,
  logger: ZaloEgressProbeLogger = defaultLogger,
): Promise<void> {
  for (const probe of probes) {
    const startedAt = performance.now();
    let responseReceived = false;
    let httpStatus: number | null = null;
    let timeout = false;
    let abort = false;
    let exceptionName: ZaloEgressProbeEvent["safe_exception_name"] = null;
    let classification: ZaloEgressProbeEvent["safe_error_classification"] = null;

    try {
      const response = await fetcher(probe.url, {
        method: probe.method,
        headers: probe.method === "POST" ? { "content-type": "application/json" } : undefined,
        body: probe.method === "POST" ? "{}" : undefined,
        redirect: "error",
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      });
      responseReceived = true;
      httpStatus = response.status;
    } catch (error) {
      exceptionName = safeExceptionName(error);
      classification = classifyFetchFailure(error);
      timeout = classification === "TIMEOUT";
      abort = exceptionName === "AbortError";
    }

    emitSafely(logger, {
      probe_name: probe.probe_name,
      hostname: probe.hostname,
      method: probe.method,
      elapsed_ms: Math.max(0, Math.round(performance.now() - startedAt)),
      response_received: responseReceived,
      http_status: httpStatus,
      timeout,
      abort,
      safe_exception_name: exceptionName,
      safe_error_classification: classification,
    });
  }
}

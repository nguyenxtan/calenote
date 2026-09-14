import { classifySafeFetchFailure } from "./zalo-egress-final-probe";

const ZALO_INVALID_GET_ME_URL = "https://bot-api.zaloplatforms.com/botINVALID/getMe";
const POST_PROBE_TIMEOUT_MS = 8_000;
export const ZALO_POST_SHAPE_PROBE_WINDOW_START_MS = Date.parse("2026-09-14T07:50:00.000Z");
const ZALO_POST_SHAPE_PROBE_WINDOW_END_MS = ZALO_POST_SHAPE_PROBE_WINDOW_START_MS + 60_000;

type SafeExceptionName = "AbortError" | "Error" | "TimeoutError" | null;

function safeExceptionName(error: unknown): SafeExceptionName {
  const name = typeof error === "object" && error !== null && "name" in error && typeof error.name === "string"
    ? error.name
    : null;
  if (name === "AbortError") return "AbortError";
  if (name === "TimeoutError") return "TimeoutError";
  return error instanceof Error || name !== null ? "Error" : null;
}

const probes = [
  {
    probe_name: "POST_PROBE_F_MINUS_SIGNAL",
    createInit: () => ({
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: "{}",
      redirect: "error",
    }),
  },
  {
    probe_name: "POST_PROBE_G_MINUS_REDIRECT",
    createInit: () => ({
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(POST_PROBE_TIMEOUT_MS),
    }),
  },
  {
    probe_name: "POST_PROBE_H_MINUS_ACCEPT",
    createInit: () => ({
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
      redirect: "error",
      signal: AbortSignal.timeout(POST_PROBE_TIMEOUT_MS),
    }),
  },
  {
    probe_name: "POST_PROBE_I_MINUS_CONTENT_TYPE",
    createInit: () => ({
      method: "POST",
      headers: { accept: "application/json" },
      body: "{}",
      redirect: "error",
      signal: AbortSignal.timeout(POST_PROBE_TIMEOUT_MS),
    }),
  },
  {
    probe_name: "POST_PROBE_J_MINUS_BODY",
    createInit: () => ({
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(POST_PROBE_TIMEOUT_MS),
    }),
  },
  {
    probe_name: "POST_PROBE_K_REDIRECT_MANUAL",
    createInit: () => ({
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: "{}",
      redirect: "manual",
      signal: AbortSignal.timeout(POST_PROBE_TIMEOUT_MS),
    }),
  },
] as const satisfies readonly { probe_name: string; createInit: () => RequestInit }[];

export interface ZaloPostRequestShapeProbeEvent {
  probe_name: (typeof probes)[number]["probe_name"];
  response_received: boolean;
  http_status: number | null;
  safe_exception_name: SafeExceptionName;
  safe_failure_category: ReturnType<typeof classifySafeFetchFailure> | null;
}

export type ZaloPostRequestShapeProbeLogger = (event: ZaloPostRequestShapeProbeEvent) => void;

function emitSafely(logger: ZaloPostRequestShapeProbeLogger, event: ZaloPostRequestShapeProbeEvent): void {
  try {
    logger(event);
  } catch {
    // Diagnostics must not affect scheduled production work.
  }
}

function defaultLogger(event: ZaloPostRequestShapeProbeEvent): void {
  console.log(JSON.stringify(event));
}

export function isZaloPostShapeProbeWindow(scheduledTime: number): boolean {
  return scheduledTime >= ZALO_POST_SHAPE_PROBE_WINDOW_START_MS
    && scheduledTime < ZALO_POST_SHAPE_PROBE_WINDOW_END_MS;
}

export async function runZaloPostRequestShapeProbes(
  fetcher: typeof fetch = fetch,
  logger: ZaloPostRequestShapeProbeLogger = defaultLogger,
): Promise<void> {
  for (const probe of probes) {
    try {
      const response = await fetcher(ZALO_INVALID_GET_ME_URL, probe.createInit());
      emitSafely(logger, {
        probe_name: probe.probe_name,
        response_received: true,
        http_status: response.status,
        safe_exception_name: null,
        safe_failure_category: null,
      });
    } catch (error) {
      emitSafely(logger, {
        probe_name: probe.probe_name,
        response_received: false,
        http_status: null,
        safe_exception_name: safeExceptionName(error),
        safe_failure_category: classifySafeFetchFailure(error),
      });
    }
  }
}

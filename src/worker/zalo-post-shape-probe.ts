import { classifySafeFetchFailure } from "./zalo-egress-final-probe";

const ZALO_INVALID_GET_ME_URL = "https://bot-api.zaloplatforms.com/botINVALID/getMe";
const GENERIC_POST_URL = "https://postman-echo.com/post";
const POST_PROBE_TIMEOUT_MS = 8_000;
export const ZALO_POST_SHAPE_PROBE_WINDOW_START_MS = Date.parse("2026-09-14T07:05:00.000Z");
const ZALO_POST_SHAPE_PROBE_WINDOW_END_MS = ZALO_POST_SHAPE_PROBE_WINDOW_START_MS + 60_000;

const probes = [
  {
    probe_name: "POST_PROBE_A",
    url: GENERIC_POST_URL,
    createInit: () => ({
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"probe":"calenote"}',
    }),
  },
  {
    probe_name: "POST_PROBE_B",
    url: ZALO_INVALID_GET_ME_URL,
    createInit: () => ({ method: "POST" }),
  },
  {
    probe_name: "POST_PROBE_C",
    url: ZALO_INVALID_GET_ME_URL,
    createInit: () => ({ method: "POST", headers: { "content-type": "application/json" } }),
  },
  {
    probe_name: "POST_PROBE_D",
    url: ZALO_INVALID_GET_ME_URL,
    createInit: () => ({ method: "POST", body: "{}" }),
  },
  {
    probe_name: "POST_PROBE_E",
    url: ZALO_INVALID_GET_ME_URL,
    createInit: () => ({
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: "{}",
      redirect: "error",
      signal: AbortSignal.timeout(POST_PROBE_TIMEOUT_MS),
    }),
  },
] as const satisfies readonly { probe_name: string; url: string; createInit: () => RequestInit }[];

export interface ZaloPostRequestShapeProbeEvent {
  probe_name: (typeof probes)[number]["probe_name"];
  response_received: boolean;
  http_status: number | null;
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
      const response = await fetcher(probe.url, probe.createInit());
      emitSafely(logger, {
        probe_name: probe.probe_name,
        response_received: true,
        http_status: response.status,
        safe_failure_category: null,
      });
    } catch (error) {
      emitSafely(logger, {
        probe_name: probe.probe_name,
        response_received: false,
        http_status: null,
        safe_failure_category: classifySafeFetchFailure(error),
      });
    }
  }
}

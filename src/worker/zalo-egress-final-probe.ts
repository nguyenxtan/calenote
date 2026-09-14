import { connect } from "node:tls";

const ZALO_HOSTNAME = "bot-api.zaloplatforms.com";
const ZALO_TLS_PORT = 443;
const TLS_PROBE_TIMEOUT_MS = 8_000;
export const ZALO_EGRESS_FINAL_PROBE_WINDOW_START_MS = Date.parse("2026-09-14T06:38:00.000Z");
const ZALO_EGRESS_FINAL_PROBE_WINDOW_END_MS = ZALO_EGRESS_FINAL_PROBE_WINDOW_START_MS + 60_000;

type SafeExceptionName = "AbortError" | "Error" | "TimeoutError" | null;
type SafeFetchFailureCategory = "DNS_FAILURE" | "HOST_ACCESS_DENIED" | "NETWORK_CONNECTION_LOST" | "SUBREQUEST_POLICY" | "TLS_FAILURE" | "UNKNOWN_FETCH_FAILURE" | null;
export type SafeTlsFailureCategory = "TLS_HANDSHAKE_PASS" | "DNS_FAILURE" | "TCP_CONNECT_FAILURE" | "TLS_HANDSHAKE_FAILURE" | "CERTIFICATE_VALIDATION_FAILURE" | "UNKNOWN_TLS_FAILURE";

export interface ZaloSimpleGetProbeEvent {
  probe_name: "PROBE_F";
  response_received: boolean;
  http_status: number | null;
  safe_exception_name: SafeExceptionName;
  safe_fetch_failure_category: SafeFetchFailureCategory;
}

export interface ZaloTlsProbeEvent {
  probe_name: "PROBE_G";
  tcp_or_tls_connected: boolean;
  tls_authorized: boolean | null;
  alpn_protocol: string | null;
  elapsed_ms: number;
  safe_tls_error_code: string | null;
  safe_tls_error_category: SafeTlsFailureCategory;
}

export type ZaloEgressFinalProbeEvent = ZaloSimpleGetProbeEvent | ZaloTlsProbeEvent;
export type ZaloEgressFinalProbeLogger = (event: ZaloEgressFinalProbeEvent) => void;
export type TlsConnectionResult = { authorized: boolean; alpnProtocol: string | null };
export type TlsConnector = () => Promise<TlsConnectionResult>;

function safeExceptionName(error: unknown): SafeExceptionName {
  const name = typeof error === "object" && error !== null && "name" in error && typeof error.name === "string"
    ? error.name
    : null;
  if (name === "AbortError") return "AbortError";
  if (name === "TimeoutError") return "TimeoutError";
  return error instanceof Error || name !== null ? "Error" : null;
}

function safeErrorCode(error: unknown): string | null {
  const code = typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
    ? error.code
    : null;
  return code !== null && /^[A-Z0-9_]{1,64}$/u.test(code) ? code : null;
}

export function classifySafeFetchFailure(error: unknown): NonNullable<SafeFetchFailureCategory> {
  const code = safeErrorCode(error);
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return "DNS_FAILURE";
  if (code?.startsWith("ERR_TLS") === true) return "TLS_FAILURE";
  const message = typeof error === "object" && error !== null && "message" in error && typeof error.message === "string"
    ? error.message.toLowerCase()
    : "";
  if (/subrequest|too many requests from worker/u.test(message)) return "SUBREQUEST_POLICY";
  if (/access denied|host .* denied|not allowed/u.test(message)) return "HOST_ACCESS_DENIED";
  if (/dns|resolve|hostname|nxdomain/u.test(message)) return "DNS_FAILURE";
  if (/tls|ssl|certificate/u.test(message)) return "TLS_FAILURE";
  if (/network|connection|socket|fetch failed/u.test(message)) return "NETWORK_CONNECTION_LOST";
  return "UNKNOWN_FETCH_FAILURE";
}

function classifyTlsFailure(error: unknown): SafeTlsFailureCategory {
  const code = safeErrorCode(error);
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return "DNS_FAILURE";
  if (["ECONNREFUSED", "ECONNRESET", "EHOSTUNREACH", "ENETUNREACH", "ETIMEDOUT"].includes(code ?? "")) return "TCP_CONNECT_FAILURE";
  if (/CERT|UNABLE_TO_VERIFY|DEPTH_ZERO/u.test(code ?? "")) return "CERTIFICATE_VALIDATION_FAILURE";
  if (code?.startsWith("ERR_TLS") === true) return "TLS_HANDSHAKE_FAILURE";
  const message = typeof error === "object" && error !== null && "message" in error && typeof error.message === "string"
    ? error.message.toLowerCase()
    : "";
  if (/dns|resolve|hostname|nxdomain/u.test(message)) return "DNS_FAILURE";
  if (/certificate|cert verify|unable to verify/u.test(message)) return "CERTIFICATE_VALIDATION_FAILURE";
  if (/tls|ssl|handshake/u.test(message)) return "TLS_HANDSHAKE_FAILURE";
  if (/connect|socket|network|timeout/u.test(message)) return "TCP_CONNECT_FAILURE";
  return "UNKNOWN_TLS_FAILURE";
}

function emitSafely(logger: ZaloEgressFinalProbeLogger, event: ZaloEgressFinalProbeEvent): void {
  try {
    logger(event);
  } catch {
    // Diagnostics must not affect scheduled production work.
  }
}

function defaultLogger(event: ZaloEgressFinalProbeEvent): void {
  console.log(JSON.stringify(event));
}

export function isZaloEgressFinalProbeWindow(scheduledTime: number): boolean {
  return scheduledTime >= ZALO_EGRESS_FINAL_PROBE_WINDOW_START_MS
    && scheduledTime < ZALO_EGRESS_FINAL_PROBE_WINDOW_END_MS;
}

export function connectZaloTls(): Promise<TlsConnectionResult> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const socket = connect({ host: ZALO_HOSTNAME, port: ZALO_TLS_PORT, servername: ZALO_HOSTNAME });
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      socket.removeAllListeners();
      socket.destroy();
      callback();
    };
    const timeout = setTimeout(() => {
      finish(() => reject(Object.assign(new Error("TLS probe timed out"), { code: "ETIMEDOUT" })));
    }, TLS_PROBE_TIMEOUT_MS);
    socket.once("secureConnect", () => {
      finish(() => resolve({ authorized: socket.authorized, alpnProtocol: socket.alpnProtocol || null }));
    });
    socket.once("error", (error) => {
      finish(() => reject(error));
    });
  });
}

export async function runZaloEgressFinalIsolationProbes(
  fetcher: typeof fetch = fetch,
  tlsConnector: TlsConnector = connectZaloTls,
  logger: ZaloEgressFinalProbeLogger = defaultLogger,
): Promise<void> {
  try {
    const response = await fetcher(`https://${ZALO_HOSTNAME}/`);
    emitSafely(logger, {
      probe_name: "PROBE_F",
      response_received: true,
      http_status: response.status,
      safe_exception_name: null,
      safe_fetch_failure_category: null,
    });
  } catch (error) {
    emitSafely(logger, {
      probe_name: "PROBE_F",
      response_received: false,
      http_status: null,
      safe_exception_name: safeExceptionName(error),
      safe_fetch_failure_category: classifySafeFetchFailure(error),
    });
  }

  const startedAt = performance.now();
  try {
    const connection = await tlsConnector();
    emitSafely(logger, {
      probe_name: "PROBE_G",
      tcp_or_tls_connected: true,
      tls_authorized: connection.authorized,
      alpn_protocol: connection.alpnProtocol,
      elapsed_ms: Math.max(0, Math.round(performance.now() - startedAt)),
      safe_tls_error_code: null,
      safe_tls_error_category: connection.authorized ? "TLS_HANDSHAKE_PASS" : "CERTIFICATE_VALIDATION_FAILURE",
    });
  } catch (error) {
    emitSafely(logger, {
      probe_name: "PROBE_G",
      tcp_or_tls_connected: false,
      tls_authorized: null,
      alpn_protocol: null,
      elapsed_ms: Math.max(0, Math.round(performance.now() - startedAt)),
      safe_tls_error_code: safeErrorCode(error),
      safe_tls_error_category: classifyTlsFailure(error),
    });
  }
}

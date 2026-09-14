import {
  classifySafeFetchFailure,
  connectZaloTls,
  type SafeTlsFailureCategory,
  type TlsConnectionResult,
  type TlsConnector,
} from "./zalo-egress-final-probe";

const EXAMPLE_URL = "https://example.com/";
const ZALO_ROOT_URL = "https://bot-api.zaloplatforms.com/";

type ControlFetchProbeEvent = {
  probe_name: "CONTROL_A" | "CONTROL_B";
  response_received: boolean;
  http_status: number | null;
  safe_failure_category: ReturnType<typeof classifySafeFetchFailure> | null;
};

type ControlTlsProbeEvent = {
  probe_name: "CONTROL_C";
  tcp_or_tls_connected: boolean;
  tls_authorized: boolean | null;
  alpn_protocol: string | null;
  safe_tls_error_code: string | null;
  safe_tls_error_category: SafeTlsFailureCategory;
};

export type ZaloEgressControlEvent = ControlFetchProbeEvent | ControlTlsProbeEvent;

function safeErrorCode(error: unknown): string | null {
  const code = typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
    ? error.code
    : null;
  return code !== null && /^[A-Z0-9_]{1,64}$/u.test(code) ? code : null;
}

function classifyTlsFailure(error: unknown): SafeTlsFailureCategory {
  const code = safeErrorCode(error);
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return "DNS_FAILURE";
  if (["ECONNREFUSED", "ECONNRESET", "EHOSTUNREACH", "ENETUNREACH", "ETIMEDOUT"].includes(code ?? "")) return "TCP_CONNECT_FAILURE";
  if (/CERT|UNABLE_TO_VERIFY|DEPTH_ZERO/u.test(code ?? "")) return "CERTIFICATE_VALIDATION_FAILURE";
  if (code?.startsWith("ERR_TLS") === true) return "TLS_HANDSHAKE_FAILURE";
  return "UNKNOWN_TLS_FAILURE";
}

async function runFetchProbe(
  probeName: ControlFetchProbeEvent["probe_name"],
  url: string,
  fetcher: typeof fetch,
): Promise<ControlFetchProbeEvent> {
  try {
    const response = await fetcher(url);
    return { probe_name: probeName, response_received: true, http_status: response.status, safe_failure_category: null };
  } catch (error) {
    return {
      probe_name: probeName,
      response_received: false,
      http_status: null,
      safe_failure_category: classifySafeFetchFailure(error),
    };
  }
}

export async function runZaloEgressControl(
  fetcher: typeof fetch = fetch,
  tlsConnector: TlsConnector = connectZaloTls,
): Promise<readonly ZaloEgressControlEvent[]> {
  const example = await runFetchProbe("CONTROL_A", EXAMPLE_URL, fetcher);
  const zalo = await runFetchProbe("CONTROL_B", ZALO_ROOT_URL, fetcher);
  try {
    const connection: TlsConnectionResult = await tlsConnector();
    return [
      example,
      zalo,
      {
        probe_name: "CONTROL_C",
        tcp_or_tls_connected: true,
        tls_authorized: connection.authorized,
        alpn_protocol: connection.alpnProtocol,
        safe_tls_error_code: null,
        safe_tls_error_category: connection.authorized ? "TLS_HANDSHAKE_PASS" : "CERTIFICATE_VALIDATION_FAILURE",
      },
    ];
  } catch (error) {
    return [
      example,
      zalo,
      {
        probe_name: "CONTROL_C",
        tcp_or_tls_connected: false,
        tls_authorized: null,
        alpn_protocol: null,
        safe_tls_error_code: safeErrorCode(error),
        safe_tls_error_category: classifyTlsFailure(error),
      },
    ];
  }
}

export default {
  async fetch(): Promise<Response> {
    return Response.json(await runZaloEgressControl());
  },
} satisfies ExportedHandler;

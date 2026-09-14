import { describe, expect, it, vi } from "vitest";
import { runZaloEgressControl } from "./zalo-egress-control";

describe("isolated Zalo egress control", () => {
  it("uses only its two fixed HTTPS destinations and emits safe control results", async () => {
    const rawMarker = "raw-control-fetch-failure-never-log";
    const fetcher = vi.fn(async (url: URL | RequestInfo) => {
      if (String(url) === "https://example.com/") return new Response(null, { status: 200 });
      throw new Error(rawMarker);
    });

    const events = await runZaloEgressControl(fetcher, async () => ({ authorized: true, alpnProtocol: "h2" }));

    expect(fetcher).toHaveBeenNthCalledWith(1, "https://example.com/");
    expect(fetcher).toHaveBeenNthCalledWith(2, "https://bot-api.zaloplatforms.com/");
    expect(events).toEqual([
      { probe_name: "CONTROL_A", response_received: true, http_status: 200, safe_failure_category: null },
      { probe_name: "CONTROL_B", response_received: false, http_status: null, safe_failure_category: "UNKNOWN_FETCH_FAILURE" },
      {
        probe_name: "CONTROL_C",
        tcp_or_tls_connected: true,
        tls_authorized: true,
        alpn_protocol: "h2",
        safe_tls_error_code: null,
        safe_tls_error_category: "TLS_HANDSHAKE_PASS",
      },
    ]);
    expect(JSON.stringify(events)).not.toContain(rawMarker);
  });
});

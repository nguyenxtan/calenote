import { describe, expect, it, vi } from "vitest";
import {
  runZaloEgressFinalIsolationProbes,
  type ZaloEgressFinalProbeEvent,
} from "./zalo-egress-final-probe";

describe("one-time Zalo egress final isolation probes", () => {
  it("uses the fixed simple Zalo GET without RequestInit and emits no raw failure", async () => {
    const rawMarker = "raw-zalo-fetch-failure-never-log";
    const events: ZaloEgressFinalProbeEvent[] = [];
    const fetcher = vi.fn(async () => { throw new Error(rawMarker); });

    await runZaloEgressFinalIsolationProbes(fetcher, async () => ({ authorized: true, alpnProtocol: "h2" }), (event) => events.push(event));

    expect(fetcher).toHaveBeenCalledExactlyOnceWith("https://bot-api.zaloplatforms.com/");
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        probe_name: "PROBE_F",
        response_received: false,
        http_status: null,
        safe_exception_name: "Error",
        safe_fetch_failure_category: "UNKNOWN_FETCH_FAILURE",
      }),
      expect.objectContaining({
        probe_name: "PROBE_G",
        tcp_or_tls_connected: true,
        tls_authorized: true,
        alpn_protocol: "h2",
        safe_tls_error_code: null,
        safe_tls_error_category: "TLS_HANDSHAKE_PASS",
      }),
    ]));
    expect(JSON.stringify(events)).not.toContain(rawMarker);
  });

  it("classifies a DNS TLS failure without emitting its raw message", async () => {
    const rawMarker = "raw-tls-failure-never-log";
    const events: ZaloEgressFinalProbeEvent[] = [];
    const dnsError = Object.assign(new Error(`getaddrinfo ${rawMarker}`), { code: "ENOTFOUND" });

    await runZaloEgressFinalIsolationProbes(
      async () => new Response(null, { status: 403 }),
      async () => { throw dnsError; },
      (event) => events.push(event),
    );

    expect(events.find((event) => event.probe_name === "PROBE_G")).toMatchObject({
      tcp_or_tls_connected: false,
      tls_authorized: null,
      safe_tls_error_code: "ENOTFOUND",
      safe_tls_error_category: "DNS_FAILURE",
    });
    expect(JSON.stringify(events)).not.toContain(rawMarker);
  });
});

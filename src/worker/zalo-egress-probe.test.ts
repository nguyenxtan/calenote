import { describe, expect, it, vi } from "vitest";
import {
  runZaloEgressIsolationProbes,
  type ZaloEgressProbeEvent,
} from "./zalo-egress-probe";

describe("one-time Zalo egress isolation probes", () => {
  it("uses only the three fixed tokenless destinations and emits allowlisted success metadata", async () => {
    const events: ZaloEgressProbeEvent[] = [];
    const fetcher = vi.fn(async () => new Response(null, { status: 403 }));

    await runZaloEgressIsolationProbes(fetcher, (event) => events.push(event));

    expect(fetcher).toHaveBeenNthCalledWith(1, "https://example.com/", expect.objectContaining({ method: "GET" }));
    expect(fetcher).toHaveBeenNthCalledWith(2, "https://bot-api.zaloplatforms.com/", expect.objectContaining({
      method: "POST", headers: { "content-type": "application/json" }, body: "{}",
    }));
    expect(fetcher).toHaveBeenNthCalledWith(3, "https://bot-api.zaloplatforms.com/botINVALID/getMe", expect.objectContaining({
      method: "POST", headers: { "content-type": "application/json" }, body: "{}",
    }));
    expect(events).toHaveLength(3);
    for (const event of events) {
      expect(event).toMatchObject({ response_received: true, http_status: 403, timeout: false, abort: false, safe_exception_name: null, safe_error_classification: null });
      expect(event.elapsed_ms).toEqual(expect.any(Number));
      expect(Object.keys(event).sort()).toEqual([
        "abort", "elapsed_ms", "hostname", "http_status", "method", "probe_name",
        "response_received", "safe_error_classification", "safe_exception_name", "timeout",
      ]);
    }
  });

  it("classifies a raw outbound error without logging its message, URL, path, or body", async () => {
    const tokenMarker = "real-token-never-log";
    const bodyMarker = "response-body-never-log";
    const events: ZaloEgressProbeEvent[] = [];

    await runZaloEgressIsolationProbes(
      async () => { throw new Error(`access denied ${tokenMarker} /bot/path ${bodyMarker}`); },
      (event) => events.push(event),
    );

    expect(events).toHaveLength(3);
    for (const event of events) {
      expect(event).toMatchObject({ response_received: false, http_status: null, safe_exception_name: "Error", safe_error_classification: "HOST_ACCESS_DENIED" });
    }
    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain(tokenMarker);
    expect(serialized).not.toContain(bodyMarker);
    expect(serialized).not.toContain("/bot/path");
  });

  it("classifies timeout and abort names without changing the probe destination set", async () => {
    const events: ZaloEgressProbeEvent[] = [];
    let call = 0;

    await runZaloEgressIsolationProbes(async () => {
      call += 1;
      throw new DOMException("raw failure", call === 1 ? "TimeoutError" : "AbortError");
    }, (event) => events.push(event));

    expect(events.map((event) => ({ timeout: event.timeout, abort: event.abort, category: event.safe_error_classification }))).toEqual([
      { timeout: true, abort: false, category: "TIMEOUT" },
      { timeout: false, abort: true, category: "UNKNOWN_FETCH_FAILURE" },
      { timeout: false, abort: true, category: "UNKNOWN_FETCH_FAILURE" },
    ]);
  });
});

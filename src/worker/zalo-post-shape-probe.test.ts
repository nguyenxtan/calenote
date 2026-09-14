import { describe, expect, it, vi } from "vitest";
import {
  runZaloPostRequestShapeProbes,
  type ZaloPostRequestShapeProbeEvent,
} from "./zalo-post-shape-probe";

describe("one-time Zalo POST request-shape probes", () => {
  it("uses the fixed generic and Zalo POST matrix without reading response bodies", async () => {
    const events: ZaloPostRequestShapeProbeEvent[] = [];
    const fetcher = vi.fn(async () => new Response(null, { status: 204 }));

    await runZaloPostRequestShapeProbes(fetcher, (event) => events.push(event));

    expect(fetcher).toHaveBeenNthCalledWith(1, "https://postman-echo.com/post", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"probe":"calenote"}',
    });
    expect(fetcher).toHaveBeenNthCalledWith(2, "https://bot-api.zaloplatforms.com/botINVALID/getMe", { method: "POST" });
    expect(fetcher).toHaveBeenNthCalledWith(3, "https://bot-api.zaloplatforms.com/botINVALID/getMe", {
      method: "POST",
      headers: { "content-type": "application/json" },
    });
    expect(fetcher).toHaveBeenNthCalledWith(4, "https://bot-api.zaloplatforms.com/botINVALID/getMe", {
      method: "POST",
      body: "{}",
    });
    expect(fetcher).toHaveBeenNthCalledWith(5, "https://bot-api.zaloplatforms.com/botINVALID/getMe", {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: "{}",
      redirect: "error",
      signal: expect.any(AbortSignal),
    });
    expect(events).toHaveLength(5);
    for (const event of events) {
      expect(event).toMatchObject({ response_received: true, http_status: 204, safe_failure_category: null });
      expect(Object.keys(event).sort()).toEqual(["http_status", "probe_name", "response_received", "safe_failure_category"]);
    }
  });

  it("classifies failures without serializing raw errors or request paths", async () => {
    const rawMarker = "raw-post-probe-failure-never-log";
    const events: ZaloPostRequestShapeProbeEvent[] = [];

    await runZaloPostRequestShapeProbes(
      async () => { throw new Error(`network ${rawMarker} /botINVALID/getMe`); },
      (event) => events.push(event),
    );

    expect(events).toHaveLength(5);
    expect(events.every((event) => event.safe_failure_category === "NETWORK_CONNECTION_LOST")).toBe(true);
    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain(rawMarker);
    expect(serialized).not.toContain("/botINVALID/getMe");
  });

  it("creates Probe E's timeout only when the scheduled matrix executes", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");

    await runZaloPostRequestShapeProbes(async () => new Response(null, { status: 204 }));

    expect(timeout).toHaveBeenCalledOnce();
    expect(timeout).toHaveBeenCalledWith(8_000);
  });
});

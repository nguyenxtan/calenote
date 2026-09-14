import { describe, expect, it, vi } from "vitest";
import {
  runZaloPostRequestShapeProbes,
  type ZaloPostRequestShapeProbeEvent,
} from "./zalo-post-shape-probe";

describe("one-time Zalo POST RequestInit delta probes", () => {
  it("removes exactly one current-transport option per tokenless probe without reading response bodies", async () => {
    const events: ZaloPostRequestShapeProbeEvent[] = [];
    const fetcher = vi.fn(async () => new Response(null, { status: 204 }));

    await runZaloPostRequestShapeProbes(fetcher, (event) => events.push(event));

    const url = "https://bot-api.zaloplatforms.com/botINVALID/getMe";
    expect(fetcher).toHaveBeenNthCalledWith(1, url, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: "{}",
      redirect: "error",
    });
    expect(fetcher).toHaveBeenNthCalledWith(2, url, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: "{}",
      signal: expect.any(AbortSignal),
    });
    expect(fetcher).toHaveBeenNthCalledWith(3, url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
      redirect: "error",
      signal: expect.any(AbortSignal),
    });
    expect(fetcher).toHaveBeenNthCalledWith(4, url, {
      method: "POST",
      headers: { accept: "application/json" },
      body: "{}",
      redirect: "error",
      signal: expect.any(AbortSignal),
    });
    expect(fetcher).toHaveBeenNthCalledWith(5, url, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      redirect: "error",
      signal: expect.any(AbortSignal),
    });
    expect(events).toHaveLength(5);
    for (const event of events) {
      expect(event).toMatchObject({
        response_received: true,
        http_status: 204,
        safe_exception_name: null,
        safe_failure_category: null,
      });
      expect(Object.keys(event).sort()).toEqual([
        "http_status",
        "probe_name",
        "response_received",
        "safe_exception_name",
        "safe_failure_category",
      ]);
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
    expect(events.every((event) => (
      event.safe_exception_name === "Error"
      && event.safe_failure_category === "NETWORK_CONNECTION_LOST"
    ))).toBe(true);
    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain(rawMarker);
    expect(serialized).not.toContain("/botINVALID/getMe");
  });

  it("creates a fresh timeout only for the four delta variants that retain the signal", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");

    await runZaloPostRequestShapeProbes(async () => new Response(null, { status: 204 }), () => {});

    expect(timeout).toHaveBeenCalledTimes(4);
    expect(timeout).toHaveBeenCalledWith(8_000);
  });
});

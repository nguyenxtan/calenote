import { afterEach, describe, expect, it, vi } from "vitest";
import { readBoundedJson } from "./body";

afterEach(() => vi.useRealTimers());

describe("bounded request cancellation", () => {
  it.each(["pending", "rejected"] as const)("returns BODY_TIMEOUT when cancellation is %s", async cancellation => {
    vi.useFakeTimers();
    const cancel = vi.fn(() => cancellation === "pending"
      ? new Promise<void>(() => {})
      : Promise.reject(new Error("Cancellation failed")));
    const body = new ReadableStream<Uint8Array>({ cancel });
    const request = streamingRequest(body);
    const outcome = readBoundedJson(request, 64, { timeoutMs: 10 }).catch(error => error.code);
    const bounded = Promise.race([outcome, new Promise(resolve => setTimeout(() => resolve("STILL_PENDING"), 50))]);

    await vi.advanceTimersByTimeAsync(50);

    expect(await bounded).toBe("BODY_TIMEOUT");
    expect(cancel).toHaveBeenCalledOnce();
  });

  it.each(["pending", "rejected"] as const)("returns REQUEST_TOO_LARGE when cancellation is %s", async cancellation => {
    vi.useFakeTimers();
    const cancel = vi.fn(() => cancellation === "pending"
      ? new Promise<void>(() => {})
      : Promise.reject(new Error("Cancellation failed")));
    const body = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(65)); },
      cancel,
    });
    const outcome = readBoundedJson(streamingRequest(body), 64, { timeoutMs: 10 }).catch(error => error.code);
    const bounded = Promise.race([outcome, new Promise(resolve => setTimeout(() => resolve("STILL_PENDING"), 50))]);

    await vi.advanceTimersByTimeAsync(50);

    expect(await bounded).toBe("REQUEST_TOO_LARGE");
    expect(cancel).toHaveBeenCalledOnce();
  });
});

function streamingRequest(body: ReadableStream<Uint8Array>): Request {
  return new Request("https://calenote.example/api/reminders", {
    method: "POST", headers: { "content-type": "application/json" }, body,
    duplex: "half",
  } as RequestInit);
}

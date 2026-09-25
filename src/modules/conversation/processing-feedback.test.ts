import { afterEach, describe, expect, it, vi } from "vitest";
import { startProcessingFeedback, observeTiming } from "./processing-feedback";

afterEach(() => vi.useRealTimers());
describe("managed processing feedback", () => {
  it("does not hold inference while typing is pending and aborts the actual send at its deadline", async () => {
    vi.useFakeTimers();
    const tasks: Promise<unknown>[] = []; let signal: AbortSignal | undefined;
    const observe = vi.fn(); const order: string[] = [];
    startProcessingFeedback({ eligible: true, lifetime: { waitUntil: task => { tasks.push(task); } }, observe,
      send: async current => { signal = current; order.push("typing"); await new Promise(() => {}); } });
    order.push("inference");
    expect(order).toEqual(["typing", "inference"]);
    expect(tasks).toHaveLength(1); expect(signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1000); await Promise.all(tasks);
    expect(signal?.aborted).toBe(true);
    expect(observe).toHaveBeenCalledWith("TIMEOUT", expect.any(Number));
  });
  it.each(["resolved", "rejected", "sync throw"])("settles %s safely without exposing errors", async outcome => {
    const tasks: Promise<unknown>[] = []; const observe = vi.fn();
    startProcessingFeedback({ eligible: true, lifetime: { waitUntil: task => { tasks.push(task); } }, observe,
      send: () => { if (outcome === "sync throw") throw new Error("private payload");
        return outcome === "resolved" ? Promise.resolve() : Promise.reject(new Error("private payload")); } });
    await expect(Promise.all(tasks)).resolves.toEqual([undefined]);
    expect(observe).toHaveBeenCalledWith(outcome === "resolved" ? "OK" : "FAILED", expect.any(Number));
  });
  it("does not dispatch when ineligible; observation failures cannot reject managed work", async () => {
    const send = vi.fn(async () => {}); const tasks: Promise<unknown>[] = [];
    const input = { send, lifetime: { waitUntil: (task: Promise<unknown>) => { tasks.push(task); } }, observe: () => { throw new Error("sink unavailable"); } };
    startProcessingFeedback({ ...input, eligible: false }); expect(send).not.toHaveBeenCalled();
    startProcessingFeedback({ ...input, eligible: true }); await expect(Promise.all(tasks)).resolves.toEqual([undefined]);
  });
  it("emits bounded content-free stage timings and dispatches within the local budget", async () => {
    const tasks: Promise<unknown>[] = []; const samples: number[] = []; const observations: unknown[] = [];
    for (const stage of ["QUEUE_WAIT", "TYPING_DISPATCH", "MODEL", "FINAL_REPLY"] as const) {
      observeTiming(value => observations.push(value), stage, -1);
    }
    expect(observations).toEqual(["QUEUE_WAIT", "TYPING_DISPATCH", "MODEL", "FINAL_REPLY"].map(stage => ({ stage, elapsedMs: 0 })));
    for (let i = 0; i < 2500; i++) {
      const started = performance.now();
      startProcessingFeedback({ eligible: true, send: async () => { samples.push(performance.now() - started); },
        lifetime: { waitUntil: task => { tasks.push(task); } }, observe: () => {} });
      await tasks.at(-1);
    }
    samples.sort((a, b) => a - b);
    const result = { samples: samples.length, p50Ms: samples[1250], p95Ms: samples[2375], p99Ms: samples[2475] };
    expect(result.p95Ms).toBeLessThanOrEqual(200);
    console.info("MOCK_FEEDBACK_DISPATCH", JSON.stringify(result));
  });
});

export interface FeedbackLifetime { waitUntil(task: Promise<unknown>): void }
export type ConversationTiming = { stage: "QUEUE_WAIT" | "TYPING_DISPATCH" | "MODEL" | "FINAL_REPLY"; elapsedMs: number };
export function observeTiming(observe: ((value: ConversationTiming) => void) | undefined, stage: ConversationTiming["stage"], elapsed: number) {
  try { observe?.({ stage, elapsedMs: Number.isFinite(elapsed) ? Math.max(0, Math.round(elapsed)) : 0 }); } catch { /* No business authority. */ }
}

/** One-shot, managed feedback. The same deadline aborts the real transport. */
export function startProcessingFeedback(input: {
  eligible: boolean; send: (signal: AbortSignal) => Promise<void>; lifetime: FeedbackLifetime;
  observe: (outcome: "OK" | "FAILED" | "TIMEOUT", elapsedMs: number) => void;
}): void {
  if (!input.eligible) return;
  const started = performance.now(); const controller = new AbortController();
  const task = new Promise<void>(resolve => {
    let settled = false;
    const finish = (outcome: "OK" | "FAILED" | "TIMEOUT") => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      try { input.observe(outcome, Math.max(0, Math.round(performance.now() - started))); } catch { /* Safe sink only. */ }
      resolve();
    };
    const timer = setTimeout(() => { controller.abort(); finish("TIMEOUT"); }, 1000);
    try { void input.send(controller.signal).then(() => finish("OK"), () => finish(controller.signal.aborted ? "TIMEOUT" : "FAILED")); }
    catch { finish("FAILED"); }
  });
  try { input.lifetime.waitUntil(task); } catch { controller.abort(); /* task always settles, never rejects */ }
}

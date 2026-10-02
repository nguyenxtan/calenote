// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import * as observations from "./observability";

afterEach(() => vi.restoreAllMocks());
const base = { traceId: "53102386-5ca6-4db5-af63-3882b19059ef", sourceSha: "e1b2e4a6d403fa2046cf104be8ae537ba561a02e",
  contractVersion: "calenote-context-3", promptVersion: "calenote-context-3", mode: "OFFLINE_FIXTURE" };
function observe(event: unknown) {
  expect(observations).toHaveProperty("observeContextEvent", expect.any(Function));
  observations.observeContextEvent(event as Parameters<typeof observations.observeContextEvent>[0]);
}
describe("content-free successor observations", () => {
  it("patch_directive_reply_and_full_schema_have_separate_categories", () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    const events = [
      { ...base, event: "STRUCTURE_VALIDATED", fullSchemaValid: false, semanticPatchValidation: "VALID", directiveValidation: "INVALID", replyEligibility: "INVALID" },
      { ...base, event: "DIRECTIVE_VALIDATED", result: "DIRECTIVE_MISMATCH" },
      { ...base, event: "REPLY_ELIGIBILITY_EVALUATED", result: "REPLY_TOO_LONG" },
      { ...base, event: "REPLY_SELECTED", source: "BACKEND" },
    ];
    events.forEach(observe);
    expect(log.mock.calls.map(call => call[1])).toEqual(events);
  });
  it.each(["text", "prompt", "response", "ciphertext", "token", "error", "ownerId", "chatId", "messageId", "reservationId"])("sentinel_payload_never_serializes_%s", key => {
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    observe({ ...base, event: "MODEL_REQUIRED", [key]: "SENTINEL_PRIVATE_CONTENT" });
    expect(log).not.toHaveBeenCalled();
  });
  it("unknown_route_usage_remain_unknown_and_unsafe_values_are_rejected", () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    const event = { ...base, event: "RESPONSE_RECEIVED", outcome: "SUCCESS", latencyMs: 3,
      observedModel: "UNKNOWN", observedProvider: "UNKNOWN", promptTokens: null, completionTokens: null, costMicrounits: null };
    observe(event); expect(log.mock.calls[0][1]).toEqual(event);
    for (const invalid of [{ ...event, observedProvider: "SENTINEL_PRIVATE_CONTENT" }, { ...event, promptTokens: -1 },
      { ...event, traceId: "owner-secret" }, { ...event, sourceSha: "secret" }, { ...event, event: "arbitrary" }]) observe(invalid);
    expect(log).toHaveBeenCalledTimes(1);
  });
  it("trace_ids_are_application_random_and_sink_failure_is_nonfatal", () => {
    expect(observations).toHaveProperty("createContextTraceId", expect.any(Function));
    const first = observations.createContextTraceId();
    expect(first).toMatch(/^[0-9a-f-]{36}$/); expect(observations.createContextTraceId()).not.toBe(first);
    vi.spyOn(console, "info").mockImplementation(() => { throw new Error("SENTINEL_PRIVATE_CONTENT"); });
    expect(() => observe({ ...base, traceId: first, event: "MODEL_REQUIRED" })).not.toThrow();
  });
  it("failure_events_require_reason_and_schema_success_cannot_mask_invalid_core", () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    observe({ ...base, event: "RESPONSE_RECEIVED", outcome: "FAILURE", latencyMs: 3, observedModel: "UNKNOWN", observedProvider: "UNKNOWN", promptTokens: null, completionTokens: null, costMicrounits: null });
    observe({ ...base, event: "STRUCTURE_VALIDATED", fullSchemaValid: true, semanticPatchValidation: "INVALID", directiveValidation: "VALID", replyEligibility: "VALID" });
    expect(log).not.toHaveBeenCalled();
  });
});

import { expect, expectTypeOf, it } from "vitest";
import { snapshot } from "./context-test-fixtures";
import { ContextSnapshotV2Schema, encodeContextSnapshot, encodeContextSnapshotV2, type ContextSnapshotV2 } from "./state";
import { readLegacyContextState, type LegacyContextRecord } from "./legacy-state-reader";
it("legacy_reader_never_produces_v3_state", () => {
  const result = readLegacyContextState(encodeContextSnapshot(snapshot()));
  expect(result.status).toBe("VALID");
  if (result.status === "VALID") {
    expect(Object.keys(result.record)).toEqual([]);
    expect(Object.isFrozen(result.record)).toBe(true);
    expectTypeOf<LegacyContextRecord>().not.toExtend<ContextSnapshotV2>();
  }
  const successor = ContextSnapshotV2Schema.parse({ ...snapshot(), schemaVersion: "calenote-context-state-2", pendingSemanticCandidate: null });
  expect(readLegacyContextState(encodeContextSnapshotV2(successor))).toEqual({ status: "INVALID" });
});
it("corrupt_state_rejects", () => {
  for (const value of ["{}", "invalid", "x".repeat(16385), encodeContextSnapshot(snapshot()) + " "]) expect(readLegacyContextState(value)).toEqual({ status: "INVALID" });
});

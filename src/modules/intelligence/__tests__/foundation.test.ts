import { describe, expect, it } from "vitest";

import { createDeterministicIntelligence } from "../foundation";

describe("optional intelligence foundation", () => {
  it("returns deterministic proposal", async () => {
    const input = { text: "Mai 8h nhắc tôi họp team", locale: "vi-VN" } as const;
    const before = structuredClone(input);
    const result = await createDeterministicIntelligence().propose(input);
    expect(result.intent.kind).toBe("REMINDER");
    expect(result.action.candidates[0]?.kind).toBe("CREATE_REMINDER");
    expect(result.relevance.label).toBe("RELEVANT");
    expect(input).toEqual(before);
  });

  it("rejects unknown fields in strict proposals", async () => {
    const foundation = await import("../foundation");
    expect(() => foundation.parseIntentProposal({ kind: "REMINDER", confidence: 0.8, unknown: true })).toThrow();
    expect(() => foundation.parseActionProposal({ candidates: [], unknown: true })).toThrow();
    expect(() => foundation.parseRelevanceProposal({ label: "RELEVANT", confidence: 0.9, unknown: true })).toThrow();
  });

  it("does not propose a state-changing action for unrelated text", async () => {
    const result = await createDeterministicIntelligence().propose({ text: "xin chào" });
    expect(result.relevance.label).toBe("IRRELEVANT");
    expect(result.action.candidates).toEqual([]);
  });
});

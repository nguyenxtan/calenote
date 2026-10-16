import { describe, expect, it } from "vitest";
import { PreviewDecisionRequestV1Schema, PreviewResponseV1Schema } from "./conversation-previews";

describe("conversation-previews-1 public contract", () => {
  it("requires exact version-bound decision fields and rejects internal fields", () => {
    const decision = { schemaVersion: "conversation-previews-1", publicId: "A".repeat(22), draftRevision: 1,
      previewHash: "a".repeat(64), decisionToken: "token", action: "SAVE_PREVIEW", idempotencyKey: "request-1" };
    expect(PreviewDecisionRequestV1Schema.safeParse(decision).success).toBe(true);
    expect(PreviewDecisionRequestV1Schema.safeParse({ ...decision, contextId: "internal" }).success).toBe(false);
    expect(PreviewDecisionRequestV1Schema.safeParse({ ...decision, action: "APPROVE" }).success).toBe(false);
    expect(PreviewResponseV1Schema.safeParse({ data: { schemaVersion: "conversation-previews-1", previews: [], hasMore: false } }).success).toBe(true);
  });
});

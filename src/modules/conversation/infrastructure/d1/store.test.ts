import { describe, expect, it } from "vitest";
import { D1ConversationStore } from "./store";

describe("D1ConversationStore", () => {
  it("exposes the conversation persistence boundary", () => {
    expect(new D1ConversationStore({} as D1Database)).toBeInstanceOf(D1ConversationStore);
  });
});

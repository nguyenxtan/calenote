import { beforeEach, describe, expect, it } from "vitest";
import { manualReminderIntent } from "./manual-reminder-intent";

describe("durable manual reminder intents", () => {
  beforeEach(() => localStorage.clear());
  it("reuses opaque pending IDs across reloads and keeps accounts separate", async () => {
    const first = await manualReminderIntent("one@example.com");
    expect((await manualReminderIntent("one@example.com")).id).toBe(first.id);
    expect((await manualReminderIntent("two@example.com")).id).not.toBe(first.id);
    expect(JSON.stringify(localStorage)).not.toContain("example.com");
    first.complete();
    expect((await manualReminderIntent("one@example.com")).id).not.toBe(first.id);
  });
});

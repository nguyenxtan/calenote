import { describe, expect, it } from "vitest";
import { D1ReminderCommandStore } from "./command-store";

describe("D1ReminderCommandStore", () => {
  it("is available from the reminders D1 infrastructure boundary", () => {
    expect(new D1ReminderCommandStore({} as D1Database)).toBeInstanceOf(
      D1ReminderCommandStore,
    );
  });
});

import { describe, expect, it } from "vitest";
import { D1ReminderApiStore } from "./api-store";

describe("D1ReminderApiStore", () => {
  it("is available from the reminders D1 infrastructure boundary", () => {
    const database = {} as D1Database;

    expect(new D1ReminderApiStore(database)).toBeInstanceOf(D1ReminderApiStore);
  });
});

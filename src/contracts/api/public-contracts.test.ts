import { describe, expect, it } from "vitest";
import { SessionResponseSchema } from "./session";
import { ConnectionsResponseSchema } from "./connections";
import { RemindersResponseSchema } from "./reminders";

describe("public API contracts", () => {
  it("accepts the currently wired session, connection, and reminder responses", () => {
    expect(SessionResponseSchema.parse({ data: { user: { displayName: "Mai", email: "mai@example.com", timezone: "Asia/Ho_Chi_Minh" } } })).toBeDefined();
    expect(ConnectionsResponseSchema.parse({ data: { connections: [{ publicId: "A".repeat(22), provider: "telegram", displayName: "Mai", handle: null, state: "ACTIVE_BOUND" }] } })).toBeDefined();
    expect(RemindersResponseSchema.parse({ data: { reminders: [{ publicId: "A".repeat(22), title: "Gọi mẹ", scheduledAt: 1_800_000_000_000, timezone: "Asia/Ho_Chi_Minh", status: "PENDING" }] } })).toBeDefined();
  });

  it("rejects invalid browser-visible response fields", () => {
    expect(() => SessionResponseSchema.parse({ data: { user: { displayName: "", email: "no", timezone: "UTC" } } })).toThrow();
    expect(() => ConnectionsResponseSchema.parse({ data: { connections: [{ publicId: "x", provider: "email" }] } })).toThrow();
    expect(() => RemindersResponseSchema.parse({ data: { reminders: [{ publicId: "x", title: "", scheduledAt: 1.2, timezone: "UTC", status: "UNKNOWN" }] } })).toThrow();
  });
});

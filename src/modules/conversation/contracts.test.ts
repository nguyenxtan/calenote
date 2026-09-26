// @vitest-environment node
import { describe, expect, it } from "vitest";
import { ConversationModelSchema, ConversationSnapshotSchema } from "./contracts";

const create = { intent: "CREATE_REMINDER", title: "ôn thi", titleState: "RESOLVED",
  targetIntent: null, dialogueAct: "NEW_REQUEST", continuation: "NO", capability: null };
const help = { intent: "HELP", title: null, titleState: "NOT_APPLICABLE",
  targetIntent: null, dialogueAct: "GREET", continuation: "NO", capability: null };

describe("semantic-only conversation contract", () => {
  it("accepts create without scheduling authority", () => {
    expect(ConversationModelSchema.parse(create)).toEqual(create);
  });
  it("accepts a substantive reminder even when its input also greets", () => {
    expect(ConversationModelSchema.safeParse(create).success).toBe(true);
    expect(ConversationModelSchema.safeParse({ ...create, dialogueAct: "GREET" }).success).toBe(false);
  });
  it.each(["localDate", "localTime", "rangeKind", "timezone", "epoch", "scheduledAt",
    "date", "time", "ownerId", "chatIdentityId", "sql", "confirmed", "reply"])("rejects %s authority", field => {
    expect(ConversationModelSchema.safeParse({ ...create, [field]: "invented" }).success).toBe(false);
  });
  it.each(["CONFIRM", "MUTATE", "DELETE"])("rejects model action %s", dialogueAct => {
    expect(ConversationModelSchema.safeParse({ ...help, dialogueAct }).success).toBe(false);
  });
  it("requires HELP and explicit capability for a capability suggestion", () => {
    expect(ConversationModelSchema.safeParse({ ...help, dialogueAct: "CAPABILITY", capability: "LUNAR" }).success).toBe(true);
    expect(ConversationModelSchema.safeParse({ ...help, dialogueAct: "CAPABILITY" }).success).toBe(false);
    expect(ConversationModelSchema.safeParse({ ...create, dialogueAct: "CAPABILITY", capability: "LUNAR" }).success).toBe(false);
    expect(ConversationModelSchema.safeParse({ ...help, capability: "LUNAR" }).success).toBe(false);
  });
  it("retains semantic title and ambiguous-intent consistency", () => {
    for (const titleState of ["MISSING", "AMBIGUOUS"]) {
      expect(ConversationModelSchema.safeParse({ ...create, title: null, titleState }).success).toBe(true);
    }
    expect(ConversationModelSchema.safeParse({ ...create, title: " ", titleState: "RESOLVED" }).success).toBe(false);
    expect(ConversationModelSchema.safeParse({ ...create, intent: "LIST_REMINDERS" }).success).toBe(false);
    expect(ConversationModelSchema.safeParse({ ...create, intent: "AMBIGUOUS", targetIntent: "CREATE_REMINDER",
      dialogueAct: "AMBIGUOUS", continuation: "UNCERTAIN" }).success).toBe(true);
  });
});

const snapshot = {
  id: "synthetic", revision: 1, status: "CLARIFYING", createdAt: 1000, expiresAt: 1801000,
  request: { title: "ôn thi", calendar: "GREGORIAN", eventDate: null, reminderDate: null,
    reminderTime: null, count: null, relation: null, missing: ["date", "time"] },
  turns: [{ userText: "ôn thi", receivedAt: 1000, outcomeCode: "ASK_DATE" }],
};
describe("bounded application context", () => {
  it("accepts bounded structured state and rejects calendar mismatches", () => {
    expect(ConversationSnapshotSchema.safeParse(snapshot).success).toBe(true);
    const eventDate = { solarDate: "2026-02-30", calendar: "GREGORIAN", lunar: null,
      conversionVersion: null, sourceInboundId: "inbound" };
    expect(ConversationSnapshotSchema.safeParse({ ...snapshot, request: { ...snapshot.request, eventDate } }).success).toBe(false);
    expect(ConversationSnapshotSchema.safeParse({ ...snapshot, request: { ...snapshot.request,
      eventDate: { ...eventDate, solarDate: "2026-10-11", calendar: "LUNAR_VN" } } }).success).toBe(false);
  });
  it("enforces turn, code point, byte and absolute lifetime bounds", () => {
    expect(ConversationSnapshotSchema.safeParse({ ...snapshot, turns: Array(7).fill(snapshot.turns[0]) }).success).toBe(false);
    expect(ConversationSnapshotSchema.safeParse({ ...snapshot, turns: [{ ...snapshot.turns[0], userText: "a".repeat(2001) }] }).success).toBe(false);
    expect(ConversationSnapshotSchema.safeParse({ ...snapshot, turns: Array(6).fill({ ...snapshot.turns[0], userText: "ệ".repeat(2000) }) }).success).toBe(false);
    expect(ConversationSnapshotSchema.safeParse({ ...snapshot, expiresAt: snapshot.createdAt + 7200001 }).success).toBe(false);
  });
});

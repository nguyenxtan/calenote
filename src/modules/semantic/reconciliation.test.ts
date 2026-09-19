import { describe, expect, it } from "vitest";
import type { ModelSemanticInterpretation } from "./contracts";
import type { SemanticContextSlots } from "./context-store";
import { reconcileSemanticInterpretation } from "./reconciliation";
import { extractTemporalEvidence } from "./temporal-evidence";
import { semanticQueryRange } from "../reminders/semantic-query";

const NOW = Date.UTC(2026, 8, 16, 3, 15); // Wednesday 10:15 Vietnam time.
const create = (title: string | null = "gọi khách"): ModelSemanticInterpretation => ({
  intent: "CREATE_REMINDER", title, titleState: title === null ? "MISSING" : "RESOLVED", targetIntent: null,
});
const list: ModelSemanticInterpretation = {
  intent: "LIST_REMINDERS", title: null, titleState: "NOT_APPLICABLE", targetIntent: null,
};
const evidence = (text: string, referenceNow = NOW) => extractTemporalEvidence({ text, referenceNow });
const reconcile = (text: string, modelInterpretation: ModelSemanticInterpretation = create(), previousContext?: SemanticContextSlots) => (
  reconcileSemanticInterpretation({ modelInterpretation, temporalEvidence: evidence(text), previousContext, processingNow: NOW })
);

function pending(text = "mai nhắc tui gọi khách", model = create()): SemanticContextSlots {
  const result = reconcile(text, model);
  if (result.kind !== "CLARIFICATION") throw new Error("Expected pending clarification");
  return result.contextSlots;
}

describe("deterministic semantic reconciliation", () => {
  it.each([
    ["mai nhắc tui gọi khách", create(), ["time"], { title: "gọi khách", localDate: "2026-09-17", localTime: null }],
    ["9h nhắc tui gọi khách", create(), ["date"], { title: "gọi khách", localDate: null, localTime: "09:00" }],
    ["mai 8h nhắc tui", create(null), ["title"], { title: null, localDate: "2026-09-17", localTime: "08:00" }],
    ["nhắc tui", create(null), ["title", "date", "time"], { title: null, localDate: null, localTime: null }],
  ])("asks only unresolved fields and carries resolved slots for %s", (text, model, missingFields, slots) => {
    const result = reconcile(text as string, model as ModelSemanticInterpretation);
    expect(result).toMatchObject({ kind: "CLARIFICATION", clarification: { targetIntent: "CREATE_REMINDER", missingFields },
      contextSlots: { targetIntent: "CREATE_REMINDER", ...slots as object, missingFields } });
    if (result.kind !== "CLARIFICATION") throw new Error("Expected clarification");
    expect(result.clarification.question.length).toBeGreaterThan(0);
    expect(result.clarification.question.length).toBeLessThanOrEqual(500);
    expect(result).not.toHaveProperty("candidate");
  });

  it("returns only a draft candidate for exact tomorrow at 08:00", () => {
    expect(reconcile("mai 08:00 nhắc tui gọi khách")).toEqual({ kind: "CREATE", candidate: {
      title: "gọi khách", scheduledAt: Date.UTC(2026, 8, 17, 1), timezone: "Asia/Ho_Chi_Minh",
    } });
  });

  it.each([
    ["hôm nay có gì", "TODAY", null, "2026-09-15T17:00:00.000Z", "2026-09-16T17:00:00.000Z"],
    ["mai có gì", "TOMORROW", null, "2026-09-16T17:00:00.000Z", "2026-09-17T17:00:00.000Z"],
    ["2026-09-22 có gì", "DATE", "2026-09-22", "2026-09-21T17:00:00.000Z", "2026-09-22T17:00:00.000Z"],
    ["tuần này có gì", "THIS_WEEK", null, "2026-09-13T17:00:00.000Z", "2026-09-20T17:00:00.000Z"],
    ["7 ngày tới có gì", "NEXT_7_DAYS", null, "2026-09-15T17:00:00.000Z", "2026-09-22T17:00:00.000Z"],
    ["sắp tới có gì", "UPCOMING", null, "2026-09-16T03:15:00.000Z", "2026-10-16T03:15:00.000Z"],
  ])("returns a read-only bounded query owned by evidence for %s", (text, rangeKind, localDate, start, end) => {
    const result = reconcile(text!, list);
    expect(result).toEqual({ kind: "QUERY", rangeKind, localDate });
    if (result.kind !== "QUERY") throw new Error("Expected query");
    expect(semanticQueryRange(result, NOW)).toEqual({ start: Date.parse(start!), end: Date.parse(end!) });
  });

  it.each(["có lịch gì", "hôm nay hay mai có gì", "tuần", "31/02/2026 có gì"])("clarifies an unresolved list range for %s", (text) => {
    expect(reconcile(text, list)).toMatchObject({ kind: "CLARIFICATION",
      clarification: { targetIntent: "LIST_REMINDERS", missingFields: ["range"] },
      contextSlots: { targetIntent: "LIST_REMINDERS", rangeKind: null, localDate: null, missingFields: ["range"] },
    });
  });

  it.each([
    ["mai sáng nhắc tui", "time"], ["mai 25h nhắc tui", "time"], ["mai 8h 9h nhắc tui", "time"],
    ["mai 9::00 nhắc tui", "time"], ["mai hay hôm nay 9h", "date"], ["31/02/2026 9h", "date"],
    ["ngày 21, 9h", "date"],
  ])("cannot draft with unresolved or malformed evidence: %s", (text, field) => {
    const result = reconcile(text);
    expect(result).toMatchObject({ kind: "CLARIFICATION", clarification: { missingFields: [field] } });
    expect(result).not.toHaveProperty("candidate");
  });

  it("does not turn semantic title ambiguity into a resolved title", () => {
    expect(reconcile("mai 9h", { ...create(null), titleState: "AMBIGUOUS" })).toMatchObject({
      kind: "CLARIFICATION", clarification: { missingFields: ["title"] }, contextSlots: { title: null },
    });
  });

  it.each(["localDate", "localTime", "rangeKind", "timezone", "scheduledAt", "question", "missingFields", "ownerId", "sql"])(
    "rejects model attempts to reintroduce %s even alongside valid evidence", (field) => {
      expect(reconcile("mai 8h", { ...create(), [field]: "untrusted" })).toEqual({
        kind: "SAFE_HELP", code: "INVALID_SEMANTIC_INTERPRETATION",
      });
    },
  );

  it("never extracts dates or times from the model title", () => {
    expect(reconcile("nhắc tui", create("mai 09:00 gọi khách"))).toMatchObject({
      kind: "CLARIFICATION", clarification: { missingFields: ["date", "time"] },
      contextSlots: { localDate: null, localTime: null },
    });
  });

  it.each(["HELP", "UNSUPPORTED", "AMBIGUOUS"] as const)("keeps %s read-only even with complete evidence and pending context", (intent) => {
    const previousContext = pending();
    const before = structuredClone(previousContext);
    const result = reconcile("mai 9h", { intent, title: null, titleState: "NOT_APPLICABLE", targetIntent: null }, previousContext);
    expect(result.kind).toBe("SAFE_HELP");
    expect(result).not.toHaveProperty("candidate");
    expect(result).not.toHaveProperty("contextSlots");
    expect(previousContext).toEqual(before);
  });

  it("does not upgrade ambiguous intent with a create target into a draft", () => {
    expect(reconcile("mai 9h", { ...create(), intent: "AMBIGUOUS", targetIntent: "CREATE_REMINDER" }, pending())).toMatchObject({ kind: "SAFE_HELP" });
  });

  it.each([
    ["hôm nay 10:15", "PAST_TIME"], ["2027-09-17 10:16", "TOO_FAR"],
  ])("preserves existing business rejection for %s", (text, code) => {
    expect(reconcile(text)).toEqual({ kind: "SAFE_CLARIFICATION", code });
  });

  it("rechecks processing time after queue/provider delay", () => {
    expect(reconcileSemanticInterpretation({ modelInterpretation: create(), temporalEvidence: evidence("mai 8h"),
      processingNow: Date.UTC(2026, 8, 17, 1) })).toEqual({ kind: "SAFE_CLARIFICATION", code: "PAST_TIME" });
  });

  it.each(["", " ", "x".repeat(1801)])("rejects an invalid resolved title", (title) => {
    expect(reconcile("mai 9h", { ...create(), title })).toMatchObject({ kind: "SAFE_HELP" });
  });

  it("accepts the existing title and schedule horizon boundaries", () => {
    expect(reconcile("2027-09-17 10:15", create("x".repeat(1800)))).toMatchObject({
      kind: "CREATE", candidate: { scheduledAt: Date.UTC(2027, 8, 17, 3, 15) },
    });
  });

  it.each([NaN, Infinity, -1, 1.5, 8_640_000_000_000_001])("fails closed for invalid processing time %s", (processingNow) => {
    expect(reconcileSemanticInterpretation({ modelInterpretation: create(), temporalEvidence: evidence("mai 9h"), processingNow }))
      .toEqual({ kind: "SAFE_HELP", code: "INVALID_PROCESSING_TIME" });
  });

  it.each([
    { timezone: "UTC" }, { referenceLocalDate: "2026-02-30" }, { referenceLocalTime: "99:99" },
    { date: { state: "RESOLVED", source: "TOMORROW", localDate: "2026-02-30" } },
    { time: { state: "RESOLVED", source: "EXACT_TIME", localTime: "24:00" } },
    { range: { state: "RESOLVED", kind: "DATE", localDate: null } },
    { range: { state: "RESOLVED", kind: "TODAY", localDate: "2026-09-17" } },
  ])("fails closed for structurally invalid temporal evidence", (invalid) => {
    const result = reconcileSemanticInterpretation({ modelInterpretation: create(),
      temporalEvidence: { ...evidence("mai 9h"), ...invalid } as never, processingNow: NOW });
    expect(["CREATE", "QUERY"]).not.toContain(result.kind);
  });
});

describe("continuation authority", () => {
  it("merges tomorrow/title followed by 9h into one deterministic draft candidate", () => {
    const previousContext = pending();
    const temporalEvidence = evidence("9h");
    const before = structuredClone({ previousContext, temporalEvidence });
    const modelInterpretation = create(null);
    const input = { modelInterpretation, temporalEvidence, previousContext, processingNow: NOW + 1 };
    expect(reconcileSemanticInterpretation(input)).toEqual({ kind: "CREATE", candidate: {
      title: "gọi khách", scheduledAt: Date.UTC(2026, 8, 17, 2), timezone: "Asia/Ho_Chi_Minh",
    } });
    expect(reconcileSemanticInterpretation(input)).toEqual(reconcileSemanticInterpretation(input));
    expect({ previousContext, temporalEvidence }).toEqual(before);
  });

  it("preserves the original tomorrow across midnight instead of rebasing it", () => {
    const previousContext = pending();
    expect(reconcileSemanticInterpretation({ modelInterpretation: create(null), temporalEvidence: evidence("9h", Date.UTC(2026, 8, 16, 17)),
      previousContext, processingNow: Date.UTC(2026, 8, 16, 17) })).toMatchObject({
      kind: "CREATE", candidate: { title: "gọi khách", scheduledAt: Date.UTC(2026, 8, 17, 2) },
    });
  });

  it("fills missing date without changing the prior exact time", () => {
    expect(reconcile("mai", create(null), pending("9h gọi khách"))).toMatchObject({
      kind: "CREATE", candidate: { title: "gọi khách", scheduledAt: Date.UTC(2026, 8, 17, 2) },
    });
  });

  it("fills missing title without requiring temporal repetition", () => {
    expect(reconcile("gọi khách", create(), pending("mai 9h", create(null)))).toMatchObject({
      kind: "CREATE", candidate: { title: "gọi khách", scheduledAt: Date.UTC(2026, 8, 17, 2) },
    });
  });

  it("carries accumulated slots through more than one clarification", () => {
    const first = pending("nhắc tui", create(null));
    const second = reconcile("mai", create(null), first);
    expect(second).toMatchObject({ kind: "CLARIFICATION", clarification: { missingFields: ["title", "time"] },
      contextSlots: { title: null, localDate: "2026-09-17", localTime: null } });
    if (second.kind !== "CLARIFICATION") throw new Error("Expected clarification");
    expect(reconcile("9h gọi khách", create(), second.contextSlots)).toMatchObject({ kind: "CREATE" });
  });

  it.each([
    ["hôm nay 9h", create(null), "mai gọi khách"],
    ["mai 10h", create(null), "9h gọi khách"],
    ["9h", create("gọi mẹ"), "mai gọi khách"],
    ["mai hay hôm nay 9h", create(null), "mai gọi khách"],
    ["mai 25h", create(null), "9h gọi khách"],
    ["9h", { ...create(null), titleState: "AMBIGUOUS" }, "mai gọi khách"],
  ])("rejects conflicting continuation %s without replacing resolved context", (text, model, firstText) => {
    const previousContext = pending(firstText as string);
    const before = structuredClone(previousContext);
    expect(reconcile(text as string, model as ModelSemanticInterpretation, previousContext)).toEqual({
      kind: "SAFE_CLARIFICATION", code: "CONFLICTING_CONTEXT",
    });
    expect(previousContext).toEqual(before);
  });

  it("allows repeated matching slots while filling a missing time", () => {
    expect(reconcile("mai 9h", create(), pending())).toMatchObject({ kind: "CREATE" });
  });

  it("rejects changed intent while a different intent's context is pending", () => {
    expect(reconcile("mai có gì", list, pending())).toEqual({ kind: "SAFE_CLARIFICATION", code: "CONFLICTING_CONTEXT" });
  });

  it("fills a list range through read-only continuation", () => {
    expect(reconcile("mai", list, pending("có lịch gì", list))).toEqual({ kind: "QUERY", rangeKind: "TOMORROW", localDate: null });
  });

  it("rejects a conflicting resolved prior range", () => {
    const previousContext: SemanticContextSlots = { targetIntent: "LIST_REMINDERS", rangeKind: "TODAY", localDate: null, missingFields: ["range"] };
    expect(reconcile("mai", list, previousContext)).toEqual({ kind: "SAFE_CLARIFICATION", code: "CONFLICTING_CONTEXT" });
    expect(previousContext.rangeKind).toBe("TODAY");
  });

  it.each(["TODAY", "TOMORROW", "THIS_WEEK", "NEXT_7_DAYS", "UPCOMING"] as const)(
    "never rebases an unanchored resolved %s context to a later inbound", (rangeKind) => {
      const nextDay = Date.UTC(2026, 8, 16, 17);
      const previousContext: SemanticContextSlots = { targetIntent: "LIST_REMINDERS", rangeKind, localDate: null, missingFields: ["range"] };
      expect(reconcileSemanticInterpretation({ modelInterpretation: list,
        temporalEvidence: evidence("có gì", nextDay), previousContext, processingNow: nextDay }))
        .toEqual({ kind: "SAFE_CLARIFICATION", code: "CONFLICTING_CONTEXT" });
    },
  );

  it("preserves an absolute prior list date and rejects a different new date", () => {
    const previousContext: SemanticContextSlots = { targetIntent: "LIST_REMINDERS", rangeKind: "DATE", localDate: "2026-09-22", missingFields: ["range"] };
    expect(reconcile("có gì", list, previousContext)).toEqual({ kind: "QUERY", rangeKind: "DATE", localDate: "2026-09-22" });
    expect(reconcile("2026-09-23", list, previousContext)).toEqual({ kind: "SAFE_CLARIFICATION", code: "CONFLICTING_CONTEXT" });
  });

  it("fails closed for malformed previous slots", () => {
    expect(reconcile("9h", create(null), { ...pending(), localDate: "2026-02-30" })).toMatchObject({ kind: "SAFE_HELP" });
  });
});

// @vitest-environment node
import { expect, it } from "vitest";
import { harness, type Proposal } from "./service-test-support";
import type { ContextInput } from "./contracts";
import { DownstreamDiagnosticSchema, DownstreamTraceSchema, observeDownstream } from "./downstream";

const list = (input: ContextInput) => ({ schemaVersion: "calenote-context-3", intent: "LIST_REMINDERS", requestTarget: null, changes: [],
  query: { kind: "LIST", period: { kind: "DAY", date: { kind: "CIVIL_DATE", day: 5, month: 10, year: 2026, calendar: "GREGORIAN", leapMonth: null } }, statusScope: "DEFAULT", evidence: [{ kind: "USER_QUOTE", turn: input.currentTurn, quote: input.turns[input.currentTurn].text, occurrence: 1 }] }, uncertainties: [], conversationDirective: { kind: "ASK_FOR_FIELD", field: "queryRange" }, replyProposal: null });

it("valid LIST with ungrounded executable explicit-year range retains intent and clarifies without DB reads or mutations", async () => {
  const h = await harness([list]);
  expect(await h.turn(0, "Có lịch nào ko?")).toEqual({ status: "CLARIFICATION_REQUESTED" });
  const trace = h.events.filter(e => e.event === "POST_CANONICAL_STAGE").map(e => e.diagnostic);
  expect(trace.map(d => d.stage)).toEqual(["TRANSPORT", "PERIOD_RECONCILIATION", "CANONICAL", "LIST_RANGE", "EVIDENCE", "PATCH", "MERGE", "QUERY_RESOLUTION", "QUERY_RANGE", "DIRECTIVE", "TRANSITION", "REPLY"]);
  expect(trace).toContainEqual({ stage: "LIST_RANGE", result: "UNSUPPORTED", reason: "NONE", candidateRange: "DAY", field: "queryRange" });
  expect(trace).toContainEqual({ stage: "QUERY_RESOLUTION", result: "CLARIFY", reason: "MISSING_RANGE" });
  expect(trace).toContainEqual({ stage: "DIRECTIVE", result: "CLARIFY", reason: "NONE", directive: "ASK_FOR_FIELD", field: "queryRange" });
  const snapshot = await h.read(1);
  expect(snapshot?.pendingQueryQuestion?.field).toBe("queryRange");
  expect(h.replies[0]).toMatchObject({ kind: "CLARIFICATION" });
  expect(h.events.some(e => e.event === "QUERY_EXECUTED")).toBe(false);
  expect(await h.f.db.prepare("SELECT count(*) n FROM reminders").first("n")).toBe(0);
});

it("diagnostic schema accepts only bounded enums and rejects content, IDs, and values", () => {
  const safe = { stage: "EVIDENCE", result: "REJECTED", reason: "YEAR_NOT_EXPLICIT" };
  expect(DownstreamDiagnosticSchema.safeParse(safe).success).toBe(true);
  for (const key of ["text", "quote", "title", "location", "notes", "ownerId", "chatId", "secret", "value"]) expect(DownstreamDiagnosticSchema.safeParse({ ...safe, [key]: "SYNTHETIC_PRIVATE" }).success).toBe(false);
  for (const key of ["stage", "result", "reason", "field", "candidateRange", "directive"]) expect(DownstreamDiagnosticSchema.safeParse({ ...safe, [key]: "SYNTHETIC_PRIVATE" }).success).toBe(false);
  expect(DownstreamTraceSchema.safeParse(Array(24).fill(safe)).success).toBe(true);
  expect(DownstreamTraceSchema.safeParse(Array(25).fill(safe)).success).toBe(false);
  expect(() => observeDownstream(() => { throw new Error("SYNTHETIC_PRIVATE"); }, { stage: "EVIDENCE", result: "PASS", reason: "NONE" })).not.toThrow();
});

it.each([
  ["missing range", (p: ReturnType<typeof list>) => ({ ...p, query: { ...p.query, period: null }, uncertainties: [{ field: "queryRange", reason: "MISSING", alternatives: [] }] }), "CLARIFICATION_REQUESTED"],
  ["grounded month", (p: ReturnType<typeof list>) => ({ ...p, query: { ...p.query, period: { kind: "MONTH", offset: 0 } } }), "REMINDERS_LISTED"],
  ["fabricated quote", (p: ReturnType<typeof list>) => ({ ...p, query: { ...p.query, evidence: [{ kind: "USER_QUOTE", turn: 0, quote: "SYNTHETIC_PRIVATE", occurrence: 1 }] } }), "REJECTED"],
  ["invalid turn identity", (p: ReturnType<typeof list>) => ({ ...p, query: { ...p.query, evidence: [{ kind: "USER_QUOTE", turn: 9, quote: "Có lịch nào ko?", occurrence: 1 }] } }), "REJECTED"],
  ["fabricated or foreign context fact", (p: ReturnType<typeof list>) => ({ ...p, query: { ...p.query, evidence: [{ kind: "CONTEXT_FACT", ref: "f999" }] } }), "REJECTED"],
  ["malformed canonical query", (p: ReturnType<typeof list>) => ({ ...p, query: { ...p.query, unexpected: true } }), "REJECTED"],
  ["calendar explicit year gate", (p: ReturnType<typeof list>) => ({ ...p, intent: "CALENDAR_QUERY", query: { kind: "CALENDAR_DATE", date: p.query.period.date, outputCalendar: "LUNAR_VN", evidence: p.query.evidence } }), "REJECTED"],
  ["reminder explicit year gate", (p: ReturnType<typeof list>) => ({ ...p, intent: "CREATE_REMINDER", requestTarget: { kind: "NEW", evidence: p.query.evidence }, query: null, changes: [{ field: "reminderDate", operation: "SET", value: p.query.period.date, evidence: p.query.evidence }] }), "REJECTED"],
  ["alternative explicit year gate", (p: ReturnType<typeof list>) => ({ ...p, query: { ...p.query, period: null }, uncertainties: [{ field: "queryRange", reason: "AMBIGUOUS", alternatives: [{ value: p.query.period, evidence: p.query.evidence }] }] }), "REJECTED"],
  ["unsupported capability", (p: ReturnType<typeof list>) => ({ ...p, intent: "UNSUPPORTED", query: null, conversationDirective: { kind: "EXPLAIN_UNSUPPORTED", issue: "ASSISTANT_SCOPE" } }), "CLARIFICATION_REQUESTED"],
] as const)("adjacency: %s preserves domain/security outcome", async (name, transform, expected) => {
  const candidate: Proposal = input => transform(list(input));
  const h = await harness([candidate]);
  const outcome = await h.turn(0, name === "grounded month" ? "Tháng này có lịch gì ko?" : "Có lịch nào ko?");
  expect(outcome.status).toBe(expected);
  if (name === "unsupported capability") expect(h.events.find(e => e.event === "EFFECTIVE_DIRECTIVE_COMPUTED")).toMatchObject({ kind: "EXPLAIN_UNSUPPORTED" });
  expect(h.events.filter(e => e.event === "QUERY_EXECUTED")).toHaveLength(name === "grounded month" ? 1 : 0);
  expect(await h.f.db.prepare("SELECT count(*) n FROM reminders").first("n")).toBe(0);
  if (name.includes("year gate")) expect(h.events.filter(e => e.event === "POST_CANONICAL_STAGE").map(e => e.diagnostic)).toContainEqual({ stage: "EVIDENCE", result: "REJECTED", reason: "YEAR_NOT_EXPLICIT" });
  for (const event of h.events.filter(e => e.event === "POST_CANONICAL_STAGE")) expect(JSON.stringify(event.diagnostic)).not.toContain("SYNTHETIC_PRIVATE");
  expect(DownstreamTraceSchema.safeParse(h.events.filter(e => e.event === "POST_CANONICAL_STAGE").map(e => e.diagnostic)).success).toBe(true);
});

it("guidance quarantine and downstream exception preserve truthful categorical diagnostics", async () => {
  const h = await harness([input => ({ ...list(input), conversationDirective: { unexpected: "SYNTHETIC_PRIVATE" } })]);
  expect(await h.turn(0, "Có lịch nào ko?")).toEqual({ status: "CLARIFICATION_REQUESTED" });
  expect(h.events.filter(e => e.event === "POST_CANONICAL_STAGE").map(e => e.diagnostic)).toContainEqual({ stage: "CANONICAL", result: "QUARANTINED_GUIDANCE", reason: "SCHEMA_INVALID" });
  const failure = await harness([input => ({ ...list(input), query: { ...list(input).query, period: { kind: "MONTH", offset: 0 } } })]);
  failure.deps.list = async () => { throw new Error("SYNTHETIC_PRIVATE"); };
  expect(await failure.turn(0, "Tháng này có lịch gì ko?")).toEqual({ status: "REJECTED" });
  const trace = failure.events.filter(e => e.event === "POST_CANONICAL_STAGE").map(e => e.diagnostic);
  expect(trace.at(-2)).toMatchObject({ stage: "TRANSITION", result: "REJECTED" });
  expect(trace.at(-1)).toMatchObject({ stage: "REPLY", result: "PASS" });
  expect(JSON.stringify(trace)).not.toContain("SYNTHETIC_PRIVATE");
});

it("ambiguous LIST authority stays distinguishable from a missing range in downstream trace", async () => {
  const h = await harness([input => ({ ...list(input), query: { ...list(input).query, period: { kind: "MONTH", offset: 0 } } })]);
  expect(await h.turn(0, "tháng này hoặc tuần này")).toEqual({ status: "CLARIFICATION_REQUESTED" });
  const trace = h.events.filter(e => e.event === "POST_CANONICAL_STAGE").map(e => e.diagnostic);
  expect(trace).toContainEqual({ stage: "LIST_RANGE", result: "AMBIGUOUS", reason: "NONE", candidateRange: "MONTH", field: "queryRange" });
  expect(trace).toContainEqual({ stage: "QUERY_RANGE", result: "AMBIGUOUS", reason: "QUERY_RANGE_AMBIGUOUS" });
  expect(trace).toContainEqual({ stage: "TRANSITION", result: "CLARIFY", reason: "NONE", transition: "STORED" });
  expect(trace).toContainEqual({ stage: "REPLY", result: "PASS", reason: "NONE", replySource: "BACKEND", replyKind: "CLARIFICATION" });
  expect(h.events.some(e => e.event === "QUERY_EXECUTED")).toBe(false);
});

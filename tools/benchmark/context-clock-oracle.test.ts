// @vitest-environment node
import { expect, it } from "vitest";
import { captureContextOracleState, diagnoseContextTurn, scoreContextCampaign, type ContextTurn, type ContextObservation, type PlannedContextCase } from "./context-contract";
import { expandContextCampaign, type ContextManifest } from "./context-contract";
import { runContextFixtureCampaign } from "./context-contract-probe";
import { frozenContextProposal } from "./context-pointer-fixtures";
import { ConversationInterpretationV3Schema } from "../../src/modules/conversation/context-contract/contracts";
import regressions from "../../src/modules/conversation/context-contract/benchmark/regressions.json";

const h24 = (hour: number, minute = 0) => ({ hour, minute, qualifier: "H24" });
const clock = (hour: number, qualifier: "H24" | "AM" | "PM" | "UNKNOWN", minute = 0) => ({ hour, minute, qualifier });
function sample(field: string, expected: unknown, actual: unknown) {
  const turn: ContextTurn = { text: "offline", receipt: "2026-09-28T03:00:00Z", model: "HEALTHY", expect: { status: "DRAFT_CREATED", dispatches: 1, mutations: 0, fields: { [field]: expected } } };
  const observed: ContextObservation["turns"][number] = { status: "DRAFT_CREATED", dispatches: 1, actualDispatches: 1, mutations: 0, fullSchemaValid: true, fields: { [field]: actual } };
  const planned: PlannedContextCase = { id: "clock", executionId: "clock", group: "ORIGINAL", mandatory: true, turns: [turn] };
  return { turn, observed, score: () => scoreContextCampaign([planned], [{ id: "clock", turns: [observed] }]) };
}

it.each(["eventTime", "reminderTime"])("%s compares valid clock semantics without mutating either representation", field => {
  const { turn, observed, score } = sample(field, h24(8), clock(8, "AM"));
  const before = JSON.stringify({ turn, observed });
  expect(diagnoseContextTurn(turn, observed, true)).toMatchObject({ passed: true, failedAssertionCount: 0 });
  expect(score()).toMatchObject({ passedTurns: 1, detailPlanned: 1, detailPassed: 1, failedMandatory: [] });
  expect(captureContextOracleState(turn, observed).assertions.find(a => a.path === `fields.${field}`)?.passed).toBe(true);
  expect(JSON.stringify({ turn, observed })).toBe(before);
});

it.each([
  [h24(0), clock(12, "AM"), true],
  [h24(12), clock(12, "PM"), true],
  [h24(20, 15), clock(8, "PM", 15), true],
  [clock(8, "AM"), h24(8), true],
  [h24(8), clock(8, "PM"), false],
  [h24(8), clock(8, "AM", 1), false],
  [h24(8), clock(8, "UNKNOWN"), false],
  [clock(8, "UNKNOWN"), clock(8, "UNKNOWN"), true],
  [clock(8, "UNKNOWN"), clock(20, "UNKNOWN"), false],
  [h24(0), clock(0, "AM"), false],
  [h24(13), clock(13, "PM"), false],
  [h24(8), { ...clock(8, "AM"), extra: true }, false],
  [h24(8), { hour: 8, qualifier: "AM" }, false],
  [h24(8), { hour: "8", minute: 0, qualifier: "AM" }, false],
  [h24(8), { hour: 8, minute: 60, qualifier: "AM" }, false],
  [h24(8), null, false],
  [h24(8), undefined, false],
  [null, null, true],
])("clock boundary expected=%j actual=%j pass=%s", (expected, actual, passed) => {
  const x = sample("reminderTime", expected, actual);
  expect(diagnoseContextTurn(x.turn, x.observed).passed).toBe(passed);
  expect(x.score().passedTurns).toBe(passed ? 1 : 0);
  expect(x.score().detailPassed).toBe(passed ? 1 : 0);
});

it.each(["notes", "eventDate", "leadOffsetDays"])("%s never receives clock-equivalence permission", field => {
  const x = sample(field, h24(8), clock(8, "AM"));
  expect(diagnoseContextTurn(x.turn, x.observed).passed).toBe(false);
  expect(x.score().detailPassed).toBe(0);
});

it("equal clock operands do not hide changed occurrences or unsafe writes", () => {
  const x = sample("reminderTime", h24(8), clock(8, "AM"));
  x.turn.expect.occurrences = ["2026-10-09 08:00"];
  x.observed.occurrences = ["2026-10-09 20:00"];
  x.observed.mutations = 1;
  const result = diagnoseContextTurn(x.turn, x.observed);
  expect(result.passed).toBe(false);
  expect(result.failedAssertions.map(a => a.path)).toContain("occurrences");
  expect(x.score()).toMatchObject({ passedTurns: 0, safetyFailures: 1 });
});

it("R04 AM proposal retains its representation and exact schedule while every frozen assertion passes", async () => {
  const script = regressions.cases.find(c => c.id === "R04")!;
  const planned = expandContextCampaign({ version: "context-contract-corpus-1", cases: [script] } as ContextManifest, "FULL", []);
  const frozenBefore = JSON.stringify(script);
  const observed = await runContextFixtureCampaign(planned, { sourceSha: "a".repeat(40), referenceNow: Date.parse(script.turns[0].receipt) }, (input, id, index) => {
    const proposal = ConversationInterpretationV3Schema.parse(frozenContextProposal(input, id, index));
    if (index === 2) proposal.changes = proposal.changes.map(change => change.field === "reminderTime" && change.operation !== "CLEAR" ? { ...change, value: clock(8, "AM") } : change);
    return proposal;
  });
  expect(observed[0].turns[2], JSON.stringify(observed[0].turns[2].downstreamDiagnostics)).toMatchObject({ status: "DRAFT_CREATED", fields: { reminderTime: clock(8, "AM") }, occurrences: ["2026-10-09 08:00"], mutations: 0, fullSchemaValid: true });
  expect(scoreContextCampaign(planned, observed)).toMatchObject({ passedScripts: 1, passedTurns: 6, failedMandatory: [], safetyFailures: 0 });
  for (const [index, turn] of planned[0].turns.entries()) expect(diagnoseContextTurn(turn, observed[0].turns[index]).passed).toBe(true);
  expect(JSON.stringify(script)).toBe(frozenBefore);
});

// @vitest-environment node
import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertCanonicalSyntheticFixtureIdentity, assertTemporalEvidencePreflight, calculateSemanticBenchmarkMetrics,
  evaluateHybridQualityGate, loadSyntheticSemanticFixture, renderOfflineBenchmarkEvidence,
  runOfflineSemanticBenchmark, temporalEvidencePreflight, type CandidateBenchmarkTransport,
} from "./semantic-v1";

const fixturePath = resolve(process.cwd(), "src/modules/semantic/benchmark/semantic-v1.json");
const runFile = promisify(execFile);
const fixture = await loadSyntheticSemanticFixture(fixturePath);
function subset(...indexes: number[]) { return { ...fixture, cases: indexes.map((index) => fixture.cases[index]) }; }
function observations(cases = fixture.cases) { return cases.map((item) => ({ caseId: item.id, interpretation: item.expectedModel, latencyMs: 5, estimatedCostMicrounits: 1 })); }

describe("hybrid semantic V1 fixture and final-outcome scorer", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.doUnmock("node:fs/promises"); vi.resetModules(); });

  it("loads 216 unique canonical identities with independently recorded hybrid expectations", () => {
    expect(fixture.version).toBe("semantic-v1-synthetic-hybrid-1");
    expect(fixture.cases).toHaveLength(216);
    expect(new Set(fixture.cases.map((item) => item.id)).size).toBe(216);
    expect(temporalEvidencePreflight(fixture)).toMatchObject({ correctCases: 216, correctRate: 1, failedCaseIds: [], networkRequests: 0 });
  });

  it("keeps old expectations historical while scoring past-time, dayparts, and context conflicts safely", () => {
    expect(fixture.cases[0].expected.intent).toBe("CREATE_REMINDER");
    expect(fixture.cases[0].expectedOutcome).toEqual({ kind: "SAFE_CLARIFICATION", code: "PAST_TIME" });
    expect(fixture.cases[54].expectedOutcome).toEqual({ kind: "CLARIFICATION", targetIntent: "CREATE_REMINDER", missingFields: ["date", "time"] });
    expect(fixture.cases[199].expectedOutcome).toEqual({ kind: "CLARIFICATION", targetIntent: "CREATE_REMINDER", missingFields: ["time"] });
    expect(fixture.cases[208].expectedOutcome).toEqual({ kind: "SAFE_CLARIFICATION", code: "CONFLICTING_CONTEXT" });
    expect(fixture.cases[186].expectedOutcome).toEqual({ kind: "CLARIFICATION", targetIntent: "LIST_REMINDERS", missingFields: ["range"] });
    expect(calculateSemanticBenchmarkMetrics(fixture, observations())).toMatchObject({
      schemaValidRate: 1, intentCorrectRate: 1, finalOutcomeCorrectRate: 1, localDateCorrectRate: 1,
      localTimeCorrectRate: 1, listRangeCorrectRate: 1, clarificationCorrectRate: 1, safetyFailureCases: 0,
      localDateEligibleCases: 22, listRangeEligibleCases: 44, clarificationEligibleCases: 93,
    });
  });

  it("fails the zero-network preflight if a reviewed temporal value disagrees", () => {
    const modified = structuredClone(subset(18));
    modified.cases[0].expectedTemporalEvidence.date = { state: "RESOLVED", source: "TOMORROW", localDate: "2026-09-18" };
    expect(() => assertTemporalEvidencePreflight(modified)).toThrow("synthetic-tomorrow-019");
    expect(calculateSemanticBenchmarkMetrics(modified, [])).toMatchObject({ temporalEvidenceCorrectRate: 0 });
  });

  it("checks all evidence dimensions and reference fields, not just the resolved date", () => {
    for (const field of ["referenceLocalDate", "referenceLocalTime", "timezone", "date", "time", "range"] as const) {
      const modified = structuredClone(subset(18));
      Object.assign(modified.cases[0].expectedTemporalEvidence, { [field]: null });
      expect(() => assertTemporalEvidencePreflight(modified)).toThrow("preflight failed");
    }
  });

  it("rejects noncanonical path/count/IDs and altered canonical bytes", async () => {
    await expect(runOfflineSemanticBenchmark({ fixturePath: "/tmp/noncanonical.json" })).rejects.toThrow("canonical fixture path");
    expect(() => assertCanonicalSyntheticFixtureIdentity(fixturePath, subset(0))).toThrow("exactly 216");
    const changed = structuredClone(fixture); changed.cases[0].id = "synthetic-tampered";
    expect(() => assertCanonicalSyntheticFixtureIdentity(fixturePath, changed)).toThrow("identity");
    const source = await readFile(fixturePath, "utf8");
    vi.resetModules();
    vi.doMock("node:fs/promises", async (importOriginal) => ({ ...await importOriginal<typeof import("node:fs/promises")>(), readFile: vi.fn(async () => source + "\n") }));
    await expect((await import("./semantic-v1")).runOfflineSemanticBenchmark({ fixturePath })).rejects.toThrow("reviewed digest");
  });

  it("penalizes missing and invalid schema observations against the full eligible denominators", () => {
    const cases = subset(18, 19);
    const measured = observations(cases.cases);
    const metrics = calculateSemanticBenchmarkMetrics(cases, [measured[0]]);
    expect(metrics).toMatchObject({ scoredCases: 1, missingCases: 1, schemaValidRate: 0.5, localDateCorrectRate: 0.5 });
    expect(calculateSemanticBenchmarkMetrics(cases, [{ ...measured[0], interpretation: cases.cases[0].expected }])).toMatchObject({ schemaValidCases: 0, intentCorrectCases: 0 });
    expect(() => calculateSemanticBenchmarkMetrics(cases, [measured[0], measured[0]])).toThrow("observation");
    expect(() => calculateSemanticBenchmarkMetrics(cases, [{ ...measured[0], estimatedCostMicrounits: -1 }])).toThrow("observation");
  });

  it("measures final LIST range and clarification only when the model leads to the right reconciled outcome", () => {
    const cases = subset(6, 10);
    const measured = observations(cases.cases);
    measured[0].interpretation = { intent: "HELP", title: null, titleState: "NOT_APPLICABLE", targetIntent: null };
    expect(calculateSemanticBenchmarkMetrics(cases, measured)).toMatchObject({ schemaValidRate: 1, intentCorrectRate: 0.5, listRangeCorrectRate: 0, clarificationCorrectRate: 1 });
    const clarification = subset(10);
    const wrongTarget = observations(clarification.cases);
    wrongTarget[0].interpretation = { intent: "LIST_REMINDERS", title: null, titleState: "NOT_APPLICABLE", targetIntent: null };
    expect(calculateSemanticBenchmarkMetrics(clarification, wrongTarget)).toMatchObject({ intentCorrectRate: 0, clarificationCorrectRate: 0 });
  });

  it("reports title similarity separately and hard-fails a fabricated draft on a missing-title case", () => {
    const cases = subset(18);
    const measured = observations(cases.cases);
    measured[0].interpretation = { ...measured[0].interpretation, title: "invented title" };
    const metrics = calculateSemanticBenchmarkMetrics(cases, measured);
    expect(metrics).toMatchObject({ localDateCorrectRate: 1, localTimeCorrectRate: 1, titleCorrectRate: 0, safetyFailureCases: 0 });
    const missingTitle = subset(29);
    const fabricated = observations(missingTitle.cases);
    fabricated[0].interpretation = { intent: "CREATE_REMINDER", title: "invented title", titleState: "RESOLVED", targetIntent: null };
    expect(calculateSemanticBenchmarkMetrics(missingTitle, fabricated).safetyFailureCases).toBe(1);
    const complete = { ...calculateSemanticBenchmarkMetrics(fixture, observations()), safetyFailureCases: 1 };
    expect(evaluateHybridQualityGate("gemini-flash-lite-hybrid-full", complete)).toEqual({ status: "FAIL", failures: ["SAFETY_FAILURE"] });
  });

  it("applies the pilot and full gates independently, including null/unmeasured metrics", () => {
    const complete = calculateSemanticBenchmarkMetrics(fixture, observations());
    expect(evaluateHybridQualityGate("gemini-flash-lite-hybrid-full", complete).status).toBe("PASS");
    const pilot = { ...complete, totalCases: 36, scoredCases: 36, schemaValidRate: 0.99, intentCorrectRate: 0.93 };
    expect(evaluateHybridQualityGate("gemini-flash-lite-hybrid-pilot", pilot).failures).toEqual(["SCHEMA", "FINAL_INTENT"]);
    for (const [field, failure, value] of [
      ["schemaValidRate", "SCHEMA", 0.989], ["intentCorrectRate", "FINAL_INTENT", 0.899],
      ["localDateCorrectRate", "FINAL_DATE", 0.949], ["localTimeCorrectRate", "FINAL_TIME", 0.949],
      ["listRangeCorrectRate", "FINAL_LIST_RANGE", 0.949], ["clarificationCorrectRate", "FINAL_CLARIFICATION", 0.899],
      ["temporalEvidenceCorrectRate", "TEMPORAL_EVIDENCE", 0.999],
    ] as const) expect(evaluateHybridQualityGate("gemini-flash-lite-hybrid-full", { ...complete, [field]: value }).failures).toContain(failure);
    expect(evaluateHybridQualityGate("gemini-flash-lite-hybrid-full", calculateSemanticBenchmarkMetrics(fixture, [])).status).toBe("FAIL");
  });

  it("honors the full 99% schema gate while retaining failed cases in every denominator", () => {
    // Two absent UNSUPPORTED responses leave 214/216 valid/final-correct cases.
    const measured = observations().filter((item) => !["synthetic-multi-turn-continuation-215", "synthetic-multi-turn-continuation-216"].includes(item.caseId));
    const metrics = calculateSemanticBenchmarkMetrics(fixture, measured);
    expect(metrics.schemaValidRate).toBe(214 / 216);
    expect(metrics.missingCases).toBe(2);
    expect(evaluateHybridQualityGate("gemini-flash-lite-hybrid-full", metrics).status).toBe("PASS");
    expect(evaluateHybridQualityGate("gemini-flash-lite-hybrid-full", calculateSemanticBenchmarkMetrics(fixture, measured.slice(0, -1))).failures).toContain("SCHEMA");
  });

  it("runs offline without transport/fetch and renders only safe aggregates", async () => {
    const transport: CandidateBenchmarkTransport = { interpret: vi.fn(async () => { throw new Error("NO NETWORK"); }) };
    const fetcher = vi.fn(() => { throw new Error("NO NETWORK"); }); vi.stubGlobal("fetch", fetcher);
    const result = await runOfflineSemanticBenchmark({ fixturePath, transport });
    expect(result.metrics).toMatchObject({ totalCases: 216, scoredCases: 0, missingCases: 216, schemaValidRate: null, temporalEvidenceCorrectRate: 1 });
    expect(transport.interpret).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled();
    const evidence = renderOfflineBenchmarkEvidence(result);
    expect(evidence).toContain("No candidate was executed");
    for (const item of fixture.cases) { expect(evidence).not.toContain(item.message); expect(evidence).not.toContain(JSON.stringify(item.expectedModel)); }
    const output = await runFile(process.execPath, ["--experimental-strip-types", "--import", "./tools/benchmark/register-typescript-loader.mjs", "tools/benchmark/run-semantic-v1-offline.mjs"]);
    expect(output.stdout).toContain("Temporal Evidence accuracy | 100.00%");
    expect(output.stderr).toBe("");
  });
});

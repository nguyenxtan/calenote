// @vitest-environment node
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { CANONICAL_SYNTHETIC_FIXTURE_PATH, calculateSemanticBenchmarkMetrics, loadSyntheticSemanticFixture, runOfflineSemanticBenchmark } from "./semantic-v1";
import { createLiveSemanticBenchmarkRunner, GEMINI_PILOT_CASE_IDS } from "./live-semantic-v1";

const directories: string[] = [];
afterEach(async () => { vi.unstubAllGlobals(); await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });
async function directory() { const path = await mkdtemp(join(tmpdir(), "hybrid-benchmark-")); directories.push(path); return path; }
const gemini = { candidateId: "gemini-2.5-flash-lite", model: "google/gemini-2.5-flash-lite", provider: "google-vertex/eu", reasoning: "OMIT", promptPriceMicrounitsPerMillionTokens: 100_000, completionPriceMicrounitsPerMillionTokens: 400_000 } as const;
function runner(stateDirectory: string, full = false) {
  return createLiveSemanticBenchmarkRunner({ fixturePath: CANONICAL_SYNTHETIC_FIXTURE_PATH, stateDirectory,
    runId: "semantic-v1-hybrid-test", candidates: [gemini], transport: async () => { throw new Error("NO NETWORK"); },
    maxHttpRequests: full ? 220 : 40, maxCostMicrounits: full ? 500_000 : 100_000,
    maxInputTokens: 12_000, maxOutputTokens: 256, caseIds: full ? undefined : GEMINI_PILOT_CASE_IDS,
    ...{ profile: full ? "gemini-flash-lite-hybrid-full" : "gemini-flash-lite-hybrid-pilot" },
  });
}

it("binds exact deterministic evidence to each canonical case and preflights without fetch", async () => {
  const fetcher = vi.fn(() => { throw new Error("NO NETWORK"); }); vi.stubGlobal("fetch", fetcher);
  const fixture = await loadSyntheticSemanticFixture(CANONICAL_SYNTHETIC_FIXTURE_PATH);
  expect(fixture.cases[0]).toMatchObject({ expectedTemporalEvidence: {
    timezone: "Asia/Ho_Chi_Minh", referenceLocalDate: "2026-09-16", referenceLocalTime: "09:00",
    date: { state: "RESOLVED", source: "TODAY", localDate: "2026-09-16" },
    time: { state: "RESOLVED", source: "EXACT_TIME", localTime: "08:00" }, range: { state: "RESOLVED", kind: "TODAY", localDate: null },
  }, expectedOutcome: { kind: "SAFE_CLARIFICATION", code: "PAST_TIME" } });
  const report = await runOfflineSemanticBenchmark({ fixturePath: CANONICAL_SYNTHETIC_FIXTURE_PATH });
  expect(report.metrics).toMatchObject({ temporalEvidenceCorrectCases: 216, temporalEvidenceCorrectRate: 1 });
  expect(fetcher).not.toHaveBeenCalled();
});

it("scores exact final reconciled dates and rejection rather than accepting a raw temporal model guess", async () => {
  const loaded = await loadSyntheticSemanticFixture(CANONICAL_SYNTHETIC_FIXTURE_PATH);
  const fixture = { ...loaded, cases: [loaded.cases[0], loaded.cases[18]] };
  const observation = { caseId: fixture.cases[1].id, latencyMs: 5, estimatedCostMicrounits: 1,
    interpretation: { intent: "CREATE_REMINDER", title: "việc tổng hợp 019", titleState: "RESOLVED", targetIntent: null } };
  const metrics = calculateSemanticBenchmarkMetrics(fixture, [{ ...observation, caseId: fixture.cases[0].id, interpretation: { ...observation.interpretation, title: "việc tổng hợp 001" } }, observation]);
  expect(metrics).toMatchObject({ schemaValidRate: 1, intentCorrectRate: 1, localDateCorrectRate: 1, localTimeCorrectRate: 1, safetyFailureCases: 0 });
  const injected = calculateSemanticBenchmarkMetrics(fixture, [{ ...observation, interpretation: { ...observation.interpretation, localDate: "2030-01-01" } }]);
  expect(injected.schemaValidCases).toBe(0);
});

it("fingerprints hybrid temporal/reconciler/profile/caps and prevents both directions of pilot/full resume", async () => {
  const first = await directory(); const second = await directory();
  const pilot = await runner(first).preflight({ apiKeyPresent: false });
  const full = await runner(second, true).preflight({ apiKeyPresent: false });
  expect(pilot.provenance).toMatchObject({ benchmarkContractVersion: "live-semantic-v1-hybrid-1", profile: "gemini-flash-lite-hybrid-pilot", maxHttpRequests: 40, maxCostMicrounits: 100_000, retryLimit: 0, allowFallbacks: false,
    temporalExtractorSha256: expect.stringMatching(/^[a-f0-9]{64}$/), reconcilerSha256: expect.stringMatching(/^[a-f0-9]{64}$/) });
  expect(full).toMatchObject({ caseCount: 216, maxHttpRequests: 220, maxCostMicrounits: 500_000, projectedMaxCostMicrounits: 281_448, networkRequests: 0 });
  expect(pilot.provenance.fixtureCaseIdsSha256).not.toBe(full.provenance.fixtureCaseIdsSha256);
  const before = await readFile(pilot.ledgerPath, "utf8");
  await expect(runner(first, true).preflight({ apiKeyPresent: false })).rejects.toThrow("ledger");
  await expect(runner(second).preflight({ apiKeyPresent: false })).rejects.toThrow("ledger");
  expect(await readFile(pilot.ledgerPath, "utf8")).toBe(before);
});

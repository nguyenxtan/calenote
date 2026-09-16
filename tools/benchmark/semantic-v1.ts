import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SemanticInterpretationSchema, type SemanticInterpretation } from "../../src/modules/semantic/contracts";

export const CANONICAL_SYNTHETIC_FIXTURE_PATH = resolve(fileURLToPath(
  new URL("../../src/modules/semantic/benchmark/semantic-v1.json", import.meta.url),
));
export const CANONICAL_SYNTHETIC_FIXTURE_CASE_COUNT = 216;
export const CANONICAL_SYNTHETIC_FIXTURE_IDS_SHA256 = "b715de4ac817b1e6e8641a6d6f3c4c80a0d1fc63a5cb60f50fe63e389ecd0a90";
export const CANONICAL_SYNTHETIC_FIXTURE_CONTENT_SHA256 = "7cb1b003e6ad481bbf01205b669cce95567b69bb63a6bb7645759e7f5492b37c";

export type SyntheticSemanticFixtureCase = {
  id: string;
  category: string;
  message: string;
  interpretationReferenceTime: string;
  timezone: "Asia/Ho_Chi_Minh";
  priorContext: unknown;
  expected: SemanticInterpretation;
  businessValidation: "ACCEPT" | "REJECT";
};
export type SyntheticSemanticFixture = {
  version: "semantic-v1-synthetic";
  cases: SyntheticSemanticFixtureCase[];
};

/**
 * A future authorized harness supplies this port. The offline runner never
 * invokes it and deliberately has no HTTP, credential, or provider adapter.
 */
export interface CandidateBenchmarkTransport {
  interpret(input: {
    caseId: string;
    message: string;
    interpretationReferenceTime: string;
    timezone: "Asia/Ho_Chi_Minh";
    priorContext: unknown;
  }): Promise<{ interpretation: unknown; latencyMs: number; estimatedCostMicrounits: number | null }>;
}

/** Safe capability/configuration facts to be independently reviewed later. */
export type CandidateBenchmarkConfiguration = {
  candidateId: string;
  model: string;
  provider: string;
  capabilityEvidenceDate: string | null;
  privacyEvidenceDate: string | null;
  requiresZeroDataRetention: boolean;
  maxInputTokens: number | null;
  maxOutputTokens: number | null;
  promptPriceMicrounitsPerMillionTokens: number | null;
  completionPriceMicrounitsPerMillionTokens: number | null;
};

export type OfflineBenchmarkObservation = {
  caseId: string;
  interpretation: unknown;
  latencyMs: number;
  estimatedCostMicrounits: number | null;
};

type Rate = number | null;
export type SemanticBenchmarkMetrics = {
  totalCases: number;
  scoredCases: number;
  missingCases: number;
  schemaValidCases: number;
  schemaValidRate: Rate;
  intentCorrectCases: number;
  intentCorrectRate: Rate;
  localDateEligibleCases: number;
  localDateCorrectCases: number;
  localDateCorrectRate: Rate;
  localTimeEligibleCases: number;
  localTimeCorrectCases: number;
  localTimeCorrectRate: Rate;
  titleEligibleCases: number;
  titleCorrectCases: number;
  titleCorrectRate: Rate;
  clarificationEligibleCases: number;
  clarificationCorrectCases: number;
  clarificationCorrectRate: Rate;
  p95LatencyMs: number | null;
  estimatedCostMicrounits: number | null;
  estimatedCostMeasuredCases: number;
};

export type OfflineBenchmarkRun = {
  execution: { mode: "OFFLINE_DRY_RUN"; candidateTransportInvoked: false };
  fixture: { version: string; caseCount: number };
  candidate: CandidateBenchmarkConfiguration | null;
  metrics: SemanticBenchmarkMetrics;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fixtureCase(raw: unknown): SyntheticSemanticFixtureCase {
  if (!isObject(raw)
    || typeof raw.id !== "string" || !raw.id.startsWith("synthetic-")
    || typeof raw.category !== "string" || typeof raw.message !== "string"
    || typeof raw.interpretationReferenceTime !== "string"
    || raw.timezone !== "Asia/Ho_Chi_Minh"
    || !("priorContext" in raw)
    || (raw.businessValidation !== "ACCEPT" && raw.businessValidation !== "REJECT")) {
    throw new TypeError("Invalid synthetic semantic fixture case");
  }
  const expected = SemanticInterpretationSchema.safeParse(raw.expected);
  if (!expected.success) throw new TypeError("Synthetic fixture expected value violates the semantic contract");
  return {
    id: raw.id, category: raw.category, message: raw.message,
    interpretationReferenceTime: raw.interpretationReferenceTime, timezone: raw.timezone,
    priorContext: raw.priorContext, expected: expected.data, businessValidation: raw.businessValidation,
  };
}

/** Loads only the checked-in synthetic fixture; callers control the exact path. */
export async function loadSyntheticSemanticFixture(path: string): Promise<SyntheticSemanticFixture> {
  const raw: unknown = JSON.parse(await readFile(path, "utf8"));
  if (!isObject(raw) || raw.version !== "semantic-v1-synthetic" || !Array.isArray(raw.cases)) {
    throw new TypeError("Invalid synthetic semantic fixture");
  }
  const cases = raw.cases.map(fixtureCase);
  if (cases.length < 200 || new Set(cases.map((item) => item.id)).size !== cases.length) {
    throw new TypeError("Synthetic semantic fixture must contain at least 200 uniquely identified cases");
  }
  return { version: raw.version, cases };
}

/** Guards the only fixture that the ordinary offline runner is allowed to use. */
export function assertCanonicalSyntheticFixtureIdentity(path: string, fixture: SyntheticSemanticFixture): void {
  if (resolve(path) !== CANONICAL_SYNTHETIC_FIXTURE_PATH) {
    throw new TypeError("Offline runner requires the canonical fixture path");
  }
  const ids = fixture.cases.map((item) => item.id);
  if (fixture.cases.length !== CANONICAL_SYNTHETIC_FIXTURE_CASE_COUNT || new Set(ids).size !== ids.length
    || !ids.every((id) => id.startsWith("synthetic-"))) {
    throw new TypeError("Canonical synthetic fixture requires exactly 216 unique synthetic IDs");
  }
  const identity = createHash("sha256").update(JSON.stringify(ids)).digest("hex");
  if (identity !== CANONICAL_SYNTHETIC_FIXTURE_IDS_SHA256) {
    throw new TypeError("Canonical synthetic fixture identity does not match the reviewed fixture");
  }
}

async function loadCanonicalSyntheticFixture(path: string): Promise<SyntheticSemanticFixture> {
  if (resolve(path) !== CANONICAL_SYNTHETIC_FIXTURE_PATH) {
    throw new TypeError("Offline runner requires the canonical fixture path");
  }
  const source = await readFile(CANONICAL_SYNTHETIC_FIXTURE_PATH, "utf8");
  const contentDigest = createHash("sha256").update(source).digest("hex");
  if (contentDigest !== CANONICAL_SYNTHETIC_FIXTURE_CONTENT_SHA256) {
    throw new TypeError("Canonical synthetic fixture content does not match the reviewed digest");
  }
  const fixture = await loadSyntheticSemanticFixture(CANONICAL_SYNTHETIC_FIXTURE_PATH);
  assertCanonicalSyntheticFixtureIdentity(path, fixture);
  return fixture;
}

function sameFields(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((field, index) => field === right[index]);
}

function equalRelevantFields(expected: SemanticInterpretation, actual: SemanticInterpretation, field: "localDate" | "localTime" | "title"): boolean {
  return expected.intent === "CREATE_REMINDER" && actual.intent === "CREATE_REMINDER" && expected[field] === actual[field];
}

function scoreRate(correct: number, eligible: number): Rate {
  return eligible === 0 ? null : correct / eligible;
}

function percentile95(latencies: number[]): number | null {
  if (latencies.length === 0) return null;
  const sorted = [...latencies].sort((left, right) => left - right);
  return sorted[Math.ceil(sorted.length * 0.95) - 1] ?? null;
}

/** Computes aggregate metrics only; observations are not included in its return value. */
export function calculateSemanticBenchmarkMetrics(
  fixture: SyntheticSemanticFixture,
  observations: OfflineBenchmarkObservation[],
): SemanticBenchmarkMetrics {
  const byId = new Map(fixture.cases.map((item) => [item.id, item]));
  const seen = new Set<string>();
  let schemaValidCases = 0;
  let intentCorrectCases = 0;
  let localDateCorrectCases = 0;
  let localTimeCorrectCases = 0;
  let titleCorrectCases = 0;
  let clarificationCorrectCases = 0;
  let estimatedCostMicrounits = 0;
  let estimatedCostMeasuredCases = 0;
  const latencies: number[] = [];

  for (const observation of observations) {
    const benchmarkCase = byId.get(observation.caseId);
    if (!benchmarkCase || seen.has(observation.caseId)
      || !Number.isFinite(observation.latencyMs) || observation.latencyMs < 0
      || (observation.estimatedCostMicrounits !== null
        && (!Number.isSafeInteger(observation.estimatedCostMicrounits) || observation.estimatedCostMicrounits < 0))) {
      throw new TypeError("Invalid offline benchmark observation");
    }
    seen.add(observation.caseId);
    latencies.push(observation.latencyMs);
    if (observation.estimatedCostMicrounits !== null) {
      estimatedCostMicrounits += observation.estimatedCostMicrounits;
      estimatedCostMeasuredCases += 1;
    }
    const actual = SemanticInterpretationSchema.safeParse(observation.interpretation);
    if (!actual.success) continue;
    schemaValidCases += 1;
    if (actual.data.intent === benchmarkCase.expected.intent) intentCorrectCases += 1;
    if (equalRelevantFields(benchmarkCase.expected, actual.data, "localDate")) localDateCorrectCases += 1;
    if (equalRelevantFields(benchmarkCase.expected, actual.data, "localTime")) localTimeCorrectCases += 1;
    if (equalRelevantFields(benchmarkCase.expected, actual.data, "title")) titleCorrectCases += 1;
    if (benchmarkCase.expected.intent === "NEEDS_CLARIFICATION" && actual.data.intent === "NEEDS_CLARIFICATION"
      && benchmarkCase.expected.targetIntent === actual.data.targetIntent
      && sameFields(benchmarkCase.expected.missingFields, actual.data.missingFields)) {
      clarificationCorrectCases += 1;
    }
  }

  const createCases = fixture.cases.filter((item) => item.expected.intent === "CREATE_REMINDER").length;
  const clarificationCases = fixture.cases.filter((item) => item.expected.intent === "NEEDS_CLARIFICATION").length;
  const unmeasured = observations.length === 0;
  return {
    totalCases: fixture.cases.length, scoredCases: observations.length, missingCases: fixture.cases.length - observations.length,
    schemaValidCases, schemaValidRate: unmeasured ? null : scoreRate(schemaValidCases, fixture.cases.length),
    intentCorrectCases, intentCorrectRate: unmeasured ? null : scoreRate(intentCorrectCases, fixture.cases.length),
    localDateEligibleCases: createCases, localDateCorrectCases,
    localDateCorrectRate: unmeasured ? null : scoreRate(localDateCorrectCases, createCases),
    localTimeEligibleCases: createCases, localTimeCorrectCases,
    localTimeCorrectRate: unmeasured ? null : scoreRate(localTimeCorrectCases, createCases),
    titleEligibleCases: createCases, titleCorrectCases,
    titleCorrectRate: unmeasured ? null : scoreRate(titleCorrectCases, createCases),
    clarificationEligibleCases: clarificationCases, clarificationCorrectCases,
    clarificationCorrectRate: unmeasured ? null : scoreRate(clarificationCorrectCases, clarificationCases),
    p95LatencyMs: percentile95(latencies),
    estimatedCostMicrounits: observations.length > 0 && estimatedCostMeasuredCases === observations.length
      ? estimatedCostMicrounits : null,
    estimatedCostMeasuredCases,
  };
}

/**
 * This is the only currently executable mode. It never invokes the supplied
 * future transport port, so ordinary preparation cannot contact a candidate.
 */
export async function runOfflineSemanticBenchmark(input: {
  fixturePath: string;
  candidate?: CandidateBenchmarkConfiguration;
  transport?: CandidateBenchmarkTransport;
}): Promise<OfflineBenchmarkRun> {
  const fixture = await loadCanonicalSyntheticFixture(input.fixturePath);
  return {
    execution: { mode: "OFFLINE_DRY_RUN", candidateTransportInvoked: false },
    fixture: { version: fixture.version, caseCount: fixture.cases.length },
    candidate: input.candidate ?? null,
    metrics: calculateSemanticBenchmarkMetrics(fixture, []),
  };
}

function percentage(value: Rate): string {
  return value === null ? "not measured" : `${(value * 100).toFixed(2)}%`;
}

/** Serializes only aggregate, review-safe evidence. */
export function renderOfflineBenchmarkEvidence(run: OfflineBenchmarkRun): string {
  const metrics = run.metrics;
  return `# AI Semantic Conversation V1 — Offline Benchmark Evidence\n\n`
    + `Status: NOT_RUN\n\n`
    + `- Execution mode: ${run.execution.mode}\n`
    + `- Fixture version: ${run.fixture.version}\n`
    + `- Fixture cases: ${run.fixture.caseCount}\n`
    + `- Candidate transport invoked: ${run.execution.candidateTransportInvoked ? "yes" : "no"}\n`
    + `- No candidate was executed.\n\n`
    + `## Aggregate metrics\n\n`
    + `| Metric | Value |\n| --- | ---: |\n`
    + `| Scored cases | ${metrics.scoredCases}/${metrics.totalCases} |\n`
    + `| Missing cases | ${metrics.missingCases} |\n`
    + `| Schema-valid rate | ${percentage(metrics.schemaValidRate)} |\n`
    + `| Intent-correct rate | ${percentage(metrics.intentCorrectRate)} |\n`
    + `| Date-correct rate | ${percentage(metrics.localDateCorrectRate)} |\n`
    + `| Time-correct rate | ${percentage(metrics.localTimeCorrectRate)} |\n`
    + `| Title-correct rate | ${percentage(metrics.titleCorrectRate)} |\n`
    + `| Clarification-correct rate | ${percentage(metrics.clarificationCorrectRate)} |\n`
    + `| P95 latency | ${metrics.p95LatencyMs === null ? "not measured" : `${metrics.p95LatencyMs} ms`} |\n`
    + `| Estimated cost | ${metrics.estimatedCostMicrounits === null ? "not measured" : `${metrics.estimatedCostMicrounits} microunits`} |\n\n`
    + `This evidence contains aggregate synthetic-fixture metrics only.`;
}

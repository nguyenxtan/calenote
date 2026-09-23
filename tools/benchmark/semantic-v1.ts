import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { ModelSemanticInterpretationSchema, SemanticInterpretationSchema, type ModelSemanticInterpretation, type SemanticInterpretation } from "../../src/modules/semantic/contracts";
import { SemanticContextSlotsSchema, type SemanticContextSlots } from "../../src/modules/semantic/context-store";
import { TemporalEvidenceSchema, reconcileSemanticInterpretation, type SemanticReconciliationResult } from "../../src/modules/semantic/reconciliation";
import { extractTemporalEvidence, type TemporalEvidence } from "../../src/modules/semantic/temporal-evidence";

export const CANONICAL_SYNTHETIC_FIXTURE_PATH = resolve(fileURLToPath(
  new URL("../../src/modules/semantic/benchmark/semantic-v1.json", import.meta.url),
));
export const CANONICAL_SYNTHETIC_FIXTURE_CASE_COUNT = 216;
export const CANONICAL_SYNTHETIC_FIXTURE_IDS_SHA256 = "b715de4ac817b1e6e8641a6d6f3c4c80a0d1fc63a5cb60f50fe63e389ecd0a90";
export const CANONICAL_SYNTHETIC_FIXTURE_CONTENT_SHA256 = "af8c54c5c825a5f4a1218e4fc044e6be23ef50db708c19e566d0e8df2a4ac617";
export const HISTORICAL_SELECTION_STATUS = "SUPERSEDED_FOR_PRODUCTION_SELECTION_BY_HYBRID_TEMPORAL_AUTHORITY";

const ExpectedOutcomeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("CREATE"), title: z.string().min(1), localDate: z.string(), localTime: z.string() }).strict(),
  z.object({ kind: z.literal("QUERY"), rangeKind: z.enum(["TODAY", "TOMORROW", "DATE", "THIS_WEEK", "NEXT_7_DAYS", "UPCOMING"]), localDate: z.string().nullable() }).strict(),
  z.object({ kind: z.literal("CLARIFICATION"), targetIntent: z.enum(["CREATE_REMINDER", "LIST_REMINDERS"]), missingFields: z.array(z.enum(["title", "date", "time", "range"])).min(1) }).strict(),
  z.object({ kind: z.literal("SAFE_CLARIFICATION"), code: z.enum(["PAST_TIME", "TOO_FAR", "CONFLICTING_CONTEXT", "INVALID_DATE_OR_TIME", "INVALID_RANGE"]) }).strict(),
  z.object({ kind: z.literal("SAFE_HELP"), code: z.enum(["HELP", "UNSUPPORTED", "AMBIGUOUS_INTENT"]) }).strict(),
]);
export type ExpectedHybridOutcome = z.infer<typeof ExpectedOutcomeSchema>;

export type SyntheticSemanticFixtureCase = {
  id: string;
  category: string;
  message: string;
  interpretationReferenceTime: string;
  timezone: "Asia/Ho_Chi_Minh";
  priorContext: unknown;
  expected: SemanticInterpretation;
  businessValidation: "ACCEPT" | "REJECT";
  expectedTemporalEvidence: TemporalEvidence;
  expectedModel: ModelSemanticInterpretation;
  expectedOutcome: ExpectedHybridOutcome;
};
export type SyntheticSemanticFixture = {
  version: "semantic-v1-synthetic-hybrid-1";
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
  temporalEvidenceCorrectCases: number;
  temporalEvidenceCorrectRate: Rate;
  finalOutcomeCorrectCases: number;
  finalOutcomeCorrectRate: Rate;
  safetyFailureCases: number;
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
  listRangeEligibleCases: number;
  listRangeCorrectCases: number;
  listRangeCorrectRate: Rate;
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
  const evidence = TemporalEvidenceSchema.safeParse(raw.expectedTemporalEvidence);
  const model = ModelSemanticInterpretationSchema.safeParse(raw.expectedModel);
  const outcome = ExpectedOutcomeSchema.safeParse(raw.expectedOutcome);
  if (!evidence.success || !model.success || !outcome.success || !Number.isSafeInteger(Date.parse(raw.interpretationReferenceTime))) {
    throw new TypeError("Synthetic fixture requires reviewed hybrid expectations");
  }
  benchmarkContext(raw.priorContext);
  return {
    id: raw.id, category: raw.category, message: raw.message,
    interpretationReferenceTime: raw.interpretationReferenceTime, timezone: raw.timezone,
    priorContext: raw.priorContext, expected: expected.data, businessValidation: raw.businessValidation,
    expectedTemporalEvidence: evidence.data as TemporalEvidence, expectedModel: model.data, expectedOutcome: outcome.data,
  };
}

/** Loads only the checked-in synthetic fixture; callers control the exact path. */
export async function loadSyntheticSemanticFixture(path: string): Promise<SyntheticSemanticFixture> {
  const raw: unknown = JSON.parse(await readFile(path, "utf8"));
  if (!isObject(raw) || raw.version !== "semantic-v1-synthetic-hybrid-1" || raw.historicalExpectationsStatus !== HISTORICAL_SELECTION_STATUS || !Array.isArray(raw.cases)) {
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

export function scoreRate(correct: number, eligible: number): Rate {
  return eligible === 0 ? null : correct / eligible;
}

export function percentile95(latencies: number[]): number | null {
  if (latencies.length === 0) return null;
  const sorted = [...latencies].sort((left, right) => left - right);
  return sorted[Math.ceil(sorted.length * 0.95) - 1] ?? null;
}

/** Strictly translates the historical synthetic context shape into runtime slots. */
export function benchmarkContext(raw: unknown): SemanticContextSlots | undefined {
  if (raw === null || raw === undefined) return undefined;
  if (!isObject(raw) || !isObject(raw.resolvedSlots)) throw new TypeError("Invalid benchmark context");
  const slots = raw.resolvedSlots;
  if (raw.intent === "CREATE_REMINDER") {
    const missingFields = (["title", "date", "time"] as const).filter((field) =>
      slots[field === "date" ? "localDate" : field === "time" ? "localTime" : field] === undefined);
    return SemanticContextSlotsSchema.parse({ targetIntent: raw.intent, title: slots.title ?? null,
      localDate: slots.localDate ?? null, localTime: slots.localTime ?? null, missingFields });
  }
  return SemanticContextSlotsSchema.parse({ targetIntent: raw.intent, rangeKind: slots.rangeKind ?? null,
    localDate: slots.localDate ?? null, missingFields: ["range"] });
}

export function benchmarkTemporalEvidence(item: SyntheticSemanticFixtureCase): TemporalEvidence {
  return extractTemporalEvidence({ text: item.message, referenceNow: Date.parse(item.interpretationReferenceTime) });
}

/** Compares every evidence field, including states, sources, reasons and the reference clock. */
export function temporalEvidencePreflight(fixture: SyntheticSemanticFixture) {
  const failedCaseIds = fixture.cases.filter((item) =>
    !sameValue(benchmarkTemporalEvidence(item), item.expectedTemporalEvidence)).map((item) => item.id);
  return { totalCases: fixture.cases.length, correctCases: fixture.cases.length - failedCaseIds.length,
    correctRate: scoreRate(fixture.cases.length - failedCaseIds.length, fixture.cases.length), failedCaseIds,
    networkRequests: 0 as const };
}
export function assertTemporalEvidencePreflight(fixture: SyntheticSemanticFixture): void {
  const result = temporalEvidencePreflight(fixture);
  if (result.correctRate !== 1) throw new TypeError(`Hybrid temporal preflight failed: ${result.failedCaseIds.join(",")}`);
}
function sameValue(left: unknown, right: unknown): boolean {
  if (Array.isArray(left) && Array.isArray(right)) return left.length === right.length && left.every((value, i) => sameValue(value, right[i]));
  if (isObject(left) && isObject(right)) return Object.keys(left).length === Object.keys(right).length
    && Object.keys(left).every((key) => Object.hasOwn(right, key) && sameValue(left[key], right[key]));
  return left === right;
}
function finalOutcome(result: SemanticReconciliationResult): ExpectedHybridOutcome | SemanticReconciliationResult {
  if (result.kind === "CREATE") {
    const dateTime = new Date(result.candidate.scheduledAt + 7 * 60 * 60 * 1_000).toISOString();
    return { kind: "CREATE", title: result.candidate.title, localDate: dateTime.slice(0, 10), localTime: dateTime.slice(11, 16) };
  }
  if (result.kind === "CLARIFICATION") return { kind: "CLARIFICATION",
    targetIntent: result.clarification.targetIntent, missingFields: result.clarification.missingFields };
  return result;
}

/** Model observations contain only semantics; all scored temporal fields come from reconciliation. */
export function calculateSemanticBenchmarkMetrics(
  fixture: SyntheticSemanticFixture,
  observations: OfflineBenchmarkObservation[],
): SemanticBenchmarkMetrics {
  const byId = new Map(fixture.cases.map((item) => [item.id, item]));
  const seen = new Set<string>();
  let schemaValidCases = 0, intentCorrectCases = 0, localDateCorrectCases = 0, localTimeCorrectCases = 0;
  let titleCorrectCases = 0, listRangeCorrectCases = 0, clarificationCorrectCases = 0;
  let finalOutcomeCorrectCases = 0, safetyFailureCases = 0;
  let estimatedCostMicrounits = 0, estimatedCostMeasuredCases = 0;
  const latencies: number[] = [];
  for (const observation of observations) {
    const item = byId.get(observation.caseId);
    if (!item || seen.has(observation.caseId) || !Number.isFinite(observation.latencyMs) || observation.latencyMs < 0
      || (observation.estimatedCostMicrounits !== null && (!Number.isSafeInteger(observation.estimatedCostMicrounits) || observation.estimatedCostMicrounits < 0))) {
      throw new TypeError("Invalid offline benchmark observation");
    }
    seen.add(observation.caseId); latencies.push(observation.latencyMs);
    if (observation.estimatedCostMicrounits !== null) { estimatedCostMicrounits += observation.estimatedCostMicrounits; estimatedCostMeasuredCases += 1; }
    const parsed = ModelSemanticInterpretationSchema.safeParse(observation.interpretation);
    if (!parsed.success) continue;
    schemaValidCases += 1;
    const actual = finalOutcome(reconcileSemanticInterpretation({ text: item.message, modelInterpretation: parsed.data,
      temporalEvidence: benchmarkTemporalEvidence(item), previousContext: benchmarkContext(item.priorContext),
      processingNow: Date.parse(item.interpretationReferenceTime) }));
    const expected = item.expectedOutcome;
    if (actual.kind === expected.kind && (!("code" in expected) || ("code" in actual && actual.code === expected.code))
      && (expected.kind !== "CLARIFICATION" || ("targetIntent" in actual && actual.targetIntent === expected.targetIntent))) intentCorrectCases += 1;
    if (sameValue(expected, actual)) finalOutcomeCorrectCases += 1;
    if (expected.kind === "CREATE" && actual.kind === "CREATE" && "localDate" in actual) {
      if (actual.localDate === expected.localDate) localDateCorrectCases += 1;
      if (actual.localTime === expected.localTime) localTimeCorrectCases += 1;
      if (actual.title === expected.title) titleCorrectCases += 1;
    }
    if (expected.kind === "QUERY" && actual.kind === "QUERY" && sameValue(expected, actual)) listRangeCorrectCases += 1;
    if (expected.kind === "CLARIFICATION" && actual.kind === "CLARIFICATION" && sameValue(expected, actual)) clarificationCorrectCases += 1;
    // Any unsafe create/query is a hard failure, even once; no threshold can hide it.
    if ((actual.kind === "CREATE" && (expected.kind !== "CREATE" || !("localDate" in actual)
      || actual.localDate !== expected.localDate || actual.localTime !== expected.localTime))
      || (actual.kind === "QUERY" && (expected.kind !== "QUERY" || !sameValue(expected, actual)))) safetyFailureCases += 1;
  }
  const createCases = fixture.cases.filter((item) => item.expectedOutcome.kind === "CREATE").length;
  const listCases = fixture.cases.filter((item) => item.expectedOutcome.kind === "QUERY").length;
  const clarificationCases = fixture.cases.filter((item) => item.expectedOutcome.kind === "CLARIFICATION").length;
  const temporal = temporalEvidencePreflight(fixture);
  const rate = (correct: number, eligible: number) => observations.length === 0 ? null : scoreRate(correct, eligible);
  return {
    temporalEvidenceCorrectCases: temporal.correctCases, temporalEvidenceCorrectRate: temporal.correctRate,
    finalOutcomeCorrectCases, finalOutcomeCorrectRate: rate(finalOutcomeCorrectCases, fixture.cases.length), safetyFailureCases,
    totalCases: fixture.cases.length, scoredCases: observations.length, missingCases: fixture.cases.length - observations.length,
    schemaValidCases, schemaValidRate: rate(schemaValidCases, fixture.cases.length),
    intentCorrectCases, intentCorrectRate: rate(intentCorrectCases, fixture.cases.length),
    localDateEligibleCases: createCases, localDateCorrectCases, localDateCorrectRate: rate(localDateCorrectCases, createCases),
    localTimeEligibleCases: createCases, localTimeCorrectCases, localTimeCorrectRate: rate(localTimeCorrectCases, createCases),
    titleEligibleCases: createCases, titleCorrectCases, titleCorrectRate: rate(titleCorrectCases, createCases),
    listRangeEligibleCases: listCases, listRangeCorrectCases, listRangeCorrectRate: rate(listRangeCorrectCases, listCases),
    clarificationEligibleCases: clarificationCases, clarificationCorrectCases, clarificationCorrectRate: rate(clarificationCorrectCases, clarificationCases),
    p95LatencyMs: percentile95(latencies),
    estimatedCostMicrounits: observations.length > 0 && estimatedCostMeasuredCases === observations.length ? estimatedCostMicrounits : null,
    estimatedCostMeasuredCases,
  };
}

export type HybridBenchmarkProfile = "gemini-flash-lite-hybrid-pilot" | "gemini-flash-lite-hybrid-full";
export function evaluateHybridQualityGate(profile: HybridBenchmarkProfile, metrics: SemanticBenchmarkMetrics) {
  const pilot = profile === "gemini-flash-lite-hybrid-pilot";
  const failures: string[] = [];
  const requireRate = (name: string, value: number | null, minimum: number) => {
    if (value === null || value < minimum) failures.push(name);
  };
  // Missing responses already reduce all applicable rates. Requiring zero
  // here would silently replace the full run's approved 99% schema gate by 100%.
  // Execution completeness and budget status are checked separately by the CLI.
  if (metrics.totalCases !== (pilot ? 36 : 216)) failures.push("INCOMPLETE");
  requireRate("TEMPORAL_EVIDENCE", metrics.temporalEvidenceCorrectRate, 1);
  requireRate("SCHEMA", metrics.schemaValidRate, pilot ? 1 : 0.99);
  requireRate("FINAL_INTENT", metrics.intentCorrectRate, pilot ? 0.94 : 0.90);
  requireRate("FINAL_DATE", metrics.localDateCorrectRate, 0.95);
  requireRate("FINAL_TIME", metrics.localTimeCorrectRate, 0.95);
  requireRate("FINAL_LIST_RANGE", metrics.listRangeCorrectRate, 0.95);
  requireRate("FINAL_CLARIFICATION", metrics.clarificationCorrectRate, 0.90);
  if (metrics.safetyFailureCases !== 0) failures.push("SAFETY_FAILURE");
  return { status: failures.length === 0 ? "PASS" as const : "FAIL" as const, failures };
}

/**
 * Offline preparation never invokes the supplied transport port.
 * It verifies deterministic evidence without contacting a candidate.
 */
export async function runOfflineSemanticBenchmark(input: {
  fixturePath: string;
  candidate?: CandidateBenchmarkConfiguration;
  transport?: CandidateBenchmarkTransport;
}): Promise<OfflineBenchmarkRun> {
  const fixture = await loadCanonicalSyntheticFixture(input.fixturePath);
  assertTemporalEvidencePreflight(fixture);
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
    + `| Temporal Evidence accuracy | ${percentage(metrics.temporalEvidenceCorrectRate)} |\n`
    + `| Intent-correct rate | ${percentage(metrics.intentCorrectRate)} |\n`
    + `| Date-correct rate | ${percentage(metrics.localDateCorrectRate)} |\n`
    + `| Time-correct rate | ${percentage(metrics.localTimeCorrectRate)} |\n`
    + `| Title-correct rate | ${percentage(metrics.titleCorrectRate)} |\n`
    + `| LIST range/date-correct rate | ${percentage(metrics.listRangeCorrectRate)} |\n`
    + `| Clarification-correct rate | ${percentage(metrics.clarificationCorrectRate)} |\n`
    + `| P95 latency | ${metrics.p95LatencyMs === null ? "not measured" : `${metrics.p95LatencyMs} ms`} |\n`
    + `| Estimated cost | ${metrics.estimatedCostMicrounits === null ? "not measured" : `${metrics.estimatedCostMicrounits} microunits`} |\n\n`
    + `This evidence contains aggregate synthetic-fixture metrics only.`;
}

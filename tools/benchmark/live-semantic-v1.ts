import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { CANONICAL_SEMANTIC_PROMPT, CANONICAL_SEMANTIC_PROMPT_VERSION, SemanticInputSchema, semanticReferenceWallClock } from "../../src/modules/intelligence/semantic-gateway";
import { SEMANTIC_RUNTIME_VALIDATION_CONTRACT_VERSION, ModelSemanticInterpretationJsonSchema, ModelSemanticInterpretationSchema } from "../../src/modules/semantic/contracts";
import {
  CANONICAL_SYNTHETIC_FIXTURE_CONTENT_SHA256,
  CANONICAL_SYNTHETIC_FIXTURE_IDS_SHA256,
  CANONICAL_SYNTHETIC_FIXTURE_PATH,
  assertCanonicalSyntheticFixtureIdentity,
  calculateSemanticBenchmarkMetrics,
  assertTemporalEvidencePreflight,
  benchmarkContext,
  benchmarkTemporalEvidence,
  temporalEvidencePreflight,
  evaluateHybridQualityGate,
  type HybridBenchmarkProfile,
  loadSyntheticSemanticFixture,
  type OfflineBenchmarkObservation,
  type SyntheticSemanticFixture,
} from "./semantic-v1";

export const LIVE_BENCHMARK_VERSION = "live-semantic-v1-hybrid-1";
export const SCORER_VERSION = "hybrid-final-outcome-scorer-1";
const MAX_LIVE_RESPONSE_BYTES = 1_000_000;

export type LiveBenchmarkCandidate = {
  candidateId: string;
  model: "google/gemini-2.5-flash-lite";
  provider: string;
  reasoning: "OMIT" | "DISABLED";
  promptPriceMicrounitsPerMillionTokens: number;
  completionPriceMicrounitsPerMillionTokens: number;
};
export type LiveSemanticJsonRequest = {
  model: string; stream: false; max_tokens: number; messages: Array<{ role: "system" | "user"; content: string }>;
  response_format: { type: "json_schema"; json_schema: { name: string; strict: true; schema: typeof ModelSemanticInterpretationJsonSchema } };
  provider: { only: [string]; allow_fallbacks: false; require_parameters: true; data_collection: "deny"; zdr: true; max_price: { prompt: number; completion: number } };
  reasoning?: { effort: "none"; exclude: true };
};
export type LiveBenchmarkTransport = (request: LiveSemanticJsonRequest, options: { signal: AbortSignal }) => Promise<{ status: number; body: string; oversized?: boolean }>;
type AttemptState = "RESERVED" | "DISPATCHED" | "COMPLETED" | "FAILED" | "UNKNOWN_DISPATCHED" | "RELEASED";
type LedgerAttempt = {
  candidateId: string; caseId: string; ordinal: number; state: AttemptState;
  reservedAt: string; dispatchedAt?: string; completedAt?: string; latencyMs?: number;
  reservedCostMicrounits: number; finalizedCostMicrounits?: number;
  promptTokens?: number; completionTokens?: number; errorCategory?: string;
  interpretation?: unknown;
};
type Ledger = {
  schemaVersion: 2; benchmarkVersion: string; runId: string; fixtureContentDigest: string;
  configDigest: string; attempts: LedgerAttempt[];
};
export type LiveBenchmarkPreflight = {
  caseCount: number; fixtureContentDigest: string; candidateModels: string[]; ledgerPath: string;
  maxHttpRequests: number; maxCostMicrounits: number; projectedMaxRequests: number;
  projectedMaxCostMicrounits: number; apiKey: "PRESENT" | "ABSENT"; networkRequests: 0;
  temporalEvidence: ReturnType<typeof temporalEvidencePreflight>;
  provenance: BenchmarkProvenance;
};
export type BenchmarkProvenance = {
  benchmarkContractVersion: string; promptVersion: string; promptSha256: string; runtimeValidationContractVersion: string; fixtureSha256: string;
  fixtureCaseIdsSha256: string; schemaSha256: string; scorerVersion: string; scorerSha256: string;
  model: string[]; provider: string[]; runId: string;
  temporalExtractorSha256: string; reconcilerSha256: string; requestSha256: string; profile: HybridBenchmarkProfile;
  maxHttpRequests: number; maxCostMicrounits: number; maxInputTokens: number; maxOutputTokens: number; retryLimit: 0; allowFallbacks: false;
};
export type LiveBenchmarkRun = {
  qualityGates: Record<string, ReturnType<typeof evaluateHybridQualityGate>>;
  status: "COMPLETE" | "INCOMPLETE_REQUEST_CAP" | "INCOMPLETE_COST_CAP" | "BLOCKED_API_KEY";
  metricsByCandidate: Record<string, ReturnType<typeof calculateSemanticBenchmarkMetrics>>; requestCount: number;
  retainedCostMicrounits: number; ledgerPath: string;
  provenance: BenchmarkProvenance;
};
export type LiveBenchmarkOptions = {
  profile: HybridBenchmarkProfile;
  fixturePath: string; stateDirectory: string; runId: string; candidates: LiveBenchmarkCandidate[];
  transport: LiveBenchmarkTransport; maxHttpRequests?: number; maxCostMicrounits?: number;
  maxInputTokens?: number; maxOutputTokens?: number; caseIds?: readonly string[]; onProgress?: (line: string) => void;
};

/** Fixed, intent-stratified, canonical-fixture subset for the authorized Gemini pilot. */
export const GEMINI_PILOT_CASE_IDS = [
  "synthetic-today-001", "synthetic-today-007", "synthetic-today-011", "synthetic-tomorrow-019", "synthetic-tomorrow-025", "synthetic-tomorrow-029", "synthetic-explicit-date-037", "synthetic-explicit-date-043", "synthetic-explicit-date-047", "synthetic-daypart-055", "synthetic-daypart-061", "synthetic-daypart-065",
  "synthetic-colloquialism-073", "synthetic-colloquialism-079", "synthetic-colloquialism-087", "synthetic-filler-091", "synthetic-filler-097", "synthetic-filler-105", "synthetic-reordered-syntax-109", "synthetic-reordered-syntax-115", "synthetic-reordered-syntax-123", "synthetic-implicit-request-127", "synthetic-implicit-request-133", "synthetic-implicit-request-141",
  "synthetic-missing-or-ambiguous-145", "synthetic-missing-or-ambiguous-155", "synthetic-missing-or-ambiguous-161", "synthetic-past-time-163", "synthetic-past-time-173", "synthetic-past-time-179", "synthetic-typo-181", "synthetic-typo-191", "synthetic-typo-197", "synthetic-multi-turn-continuation-200", "synthetic-multi-turn-continuation-209", "synthetic-multi-turn-continuation-215",
] as const;

const safeCategory = new Set(["UNAVAILABLE", "TIMEOUT", "RATE_LIMITED", "PROVIDER_FAILURE", "INVALID_JSON", "SCHEMA_INVALID", "REQUIRED_FEATURE_UNSUPPORTED", "INVALID_INPUT"]);
function assertSafeInteger(value: number, label: string): void { if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`Invalid ${label}`); }
function digest(value: unknown): string { return createHash("sha256").update(JSON.stringify(value ?? null)).digest("hex"); }
function attemptKey(candidateId: string, caseId: string): string { return `${candidateId}\u0000${caseId}`; }
function now(): string { return new Date().toISOString(); }
function ledgerPath(stateDirectory: string, runId: string): string {
  if (!/^semantic-v1-hybrid-[A-Za-z0-9._-]{1,100}$/u.test(runId)) throw new TypeError("New hybrid ledger ID required; historical IDs are superseded");
  return join(resolve(stateDirectory), `${runId}.json`);
}
function candidateMaximum(candidate: LiveBenchmarkCandidate, maxInputTokens: number, maxOutputTokens: number): number {
  const numerator = BigInt(maxInputTokens) * BigInt(candidate.promptPriceMicrounitsPerMillionTokens)
    + BigInt(maxOutputTokens) * BigInt(candidate.completionPriceMicrounitsPerMillionTokens);
  const value = (numerator + 999_999n) / 1_000_000n;
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new TypeError("Candidate maximum cost is unsafe");
  return Number(value);
}
function validateCandidate(candidate: LiveBenchmarkCandidate): void {
  if (!candidate || candidate.candidateId !== "gemini-2.5-flash-lite"
    || candidate.model !== "google/gemini-2.5-flash-lite" || candidate.provider !== "google-vertex/eu"
    || candidate.reasoning !== "OMIT") throw new TypeError("Invalid approved hybrid benchmark candidate");
  if (candidate.promptPriceMicrounitsPerMillionTokens !== 100_000 || candidate.completionPriceMicrounitsPerMillionTokens !== 400_000) {
    throw new TypeError("Candidate pricing does not match the pinned price");
  }
}
export const HYBRID_BENCHMARK_PROFILES = {
  "gemini-flash-lite-hybrid-pilot": { maxHttpRequests: 40, maxCostMicrounits: 100_000, maxInputTokens: 12_000, maxOutputTokens: 256, caseIds: GEMINI_PILOT_CASE_IDS },
  "gemini-flash-lite-hybrid-full": { maxHttpRequests: 220, maxCostMicrounits: 500_000, maxInputTokens: 12_000, maxOutputTokens: 256, caseIds: undefined },
} as const;
function sourceDigest(paths: string[]): string {
  return digest(paths.map((path) => ({ path, source: readFileSync(new URL(path, import.meta.url), "utf8") })));
}
function decodeLiveResponse(response: { status: number; body: string; oversized?: boolean }): { status: "SUCCESS"; interpretation: unknown; usage?: { costMicrounits: number; promptTokens?: number; completionTokens?: number } } | { status: "FAILURE"; category: string; usage?: { costMicrounits: number; promptTokens?: number; completionTokens?: number } } {
  if (response.oversized || new TextEncoder().encode(response.body).byteLength > MAX_LIVE_RESPONSE_BYTES) return { status: "FAILURE", category: "SCHEMA_INVALID" };
  if (response.status === 408) return { status: "FAILURE", category: "TIMEOUT" };
  if (response.status === 429) return { status: "FAILURE", category: "RATE_LIMITED" };
  if (response.status === 404) return { status: "FAILURE", category: "UNAVAILABLE" };
  let body: { choices?: Array<{ message?: { content?: unknown }; finish_reason?: unknown }>; usage?: { cost?: unknown; prompt_tokens?: unknown; completion_tokens?: unknown } };
  try { body = JSON.parse(response.body) as typeof body; } catch { return { status: "FAILURE", category: response.status === 200 ? "INVALID_JSON" : "PROVIDER_FAILURE" }; }
  const rawUsage = body.usage;
  const usage: { costMicrounits: number; promptTokens?: number; completionTokens?: number } | undefined = rawUsage && typeof rawUsage.cost === "number" && Number.isFinite(rawUsage.cost) && rawUsage.cost >= 0
    ? { costMicrounits: Math.ceil(rawUsage.cost * 1_000_000), ...(typeof rawUsage.prompt_tokens === "number" && Number.isSafeInteger(rawUsage.prompt_tokens) ? { promptTokens: rawUsage.prompt_tokens } : {}), ...(typeof rawUsage.completion_tokens === "number" && Number.isSafeInteger(rawUsage.completion_tokens) ? { completionTokens: rawUsage.completion_tokens } : {}) } : undefined;
  if (response.status !== 200) return { status: "FAILURE", category: "PROVIDER_FAILURE", usage };
  const content = body?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || body?.choices?.length !== 1 || body?.choices?.[0]?.finish_reason !== "stop") return { status: "FAILURE", category: "SCHEMA_INVALID", usage };
  let interpretation: unknown; try { interpretation = JSON.parse(content); } catch { return { status: "FAILURE", category: "INVALID_JSON", usage }; }
  return ModelSemanticInterpretationSchema.safeParse(interpretation).success ? { status: "SUCCESS", interpretation, usage } : { status: "FAILURE", category: "SCHEMA_INVALID", usage };
}
function validateLedger(value: unknown, expected: Omit<Ledger, "attempts">, scope: { caseIds: Set<string>; candidateId: string; reservedCost: number }): Ledger {
  if (!value || typeof value !== "object") throw new TypeError("Corrupt benchmark ledger");
  const ledger = value as Partial<Ledger>;
  if (ledger.schemaVersion !== 2 || ledger.benchmarkVersion !== expected.benchmarkVersion || ledger.runId !== expected.runId
    || ledger.fixtureContentDigest !== expected.fixtureContentDigest || ledger.configDigest !== expected.configDigest || !Array.isArray(ledger.attempts)) {
    throw new TypeError("Incompatible benchmark ledger");
  }
  const seen = new Set<string>();
  for (const attempt of ledger.attempts) {
    if (!attempt || typeof attempt !== "object" || typeof attempt.candidateId !== "string" || typeof attempt.caseId !== "string"
      || !Number.isSafeInteger(attempt.ordinal) || attempt.ordinal < 1 || !["RESERVED", "DISPATCHED", "COMPLETED", "FAILED", "UNKNOWN_DISPATCHED", "RELEASED"].includes(attempt.state)
      || typeof attempt.reservedAt !== "string" || !Number.isSafeInteger(attempt.reservedCostMicrounits) || attempt.reservedCostMicrounits < 0
      || (attempt.state !== "RELEASED" && seen.has(attemptKey(attempt.candidateId, attempt.caseId)))) throw new TypeError("Corrupt benchmark ledger attempt");
    if (attempt.state !== "RELEASED") seen.add(attemptKey(attempt.candidateId, attempt.caseId));
    if (!scope.caseIds.has(attempt.caseId) || attempt.candidateId !== scope.candidateId || attempt.reservedCostMicrounits !== scope.reservedCost
      || (attempt.finalizedCostMicrounits !== undefined && (!Number.isSafeInteger(attempt.finalizedCostMicrounits) || attempt.finalizedCostMicrounits < scope.reservedCost))
      || (attempt.latencyMs !== undefined && (!Number.isFinite(attempt.latencyMs) || attempt.latencyMs < 0))
      || (attempt.state === "COMPLETED" && (attempt.interpretation === undefined || attempt.latencyMs === undefined || attempt.finalizedCostMicrounits === undefined))
      || (attempt.state !== "COMPLETED" && attempt.interpretation !== undefined)) throw new TypeError("Corrupt benchmark ledger scope or accounting");
    if (attempt.interpretation !== undefined && !ModelSemanticInterpretationSchema.safeParse(attempt.interpretation).success) throw new TypeError("Corrupt benchmark ledger interpretation");
  }
  return ledger as Ledger;
}
async function atomicWrite(path: string, ledger: Ledger): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify(ledger)}\n`, "utf8");
    await handle.sync();
    await handle.close(); handle = undefined;
    await rename(temporary, path);
  } finally {
    await handle?.close().catch(() => undefined);
    await unlink(temporary).catch(() => undefined);
  }
}

export function createLiveSemanticBenchmarkRunner(options: LiveBenchmarkOptions) {
  options = { ...options, candidates: structuredClone(options.candidates), caseIds: options.caseIds && [...options.caseIds] };
  if (!Object.hasOwn(HYBRID_BENCHMARK_PROFILES, options.profile)) throw new TypeError("An exact hybrid benchmark profile is required");
  const profile = HYBRID_BENCHMARK_PROFILES[options.profile];
  const maxHttpRequests = options.maxHttpRequests ?? profile.maxHttpRequests;
  const maxCostMicrounits = options.maxCostMicrounits ?? profile.maxCostMicrounits;
  const maxInputTokens = options.maxInputTokens ?? profile.maxInputTokens;
  const maxOutputTokens = options.maxOutputTokens ?? profile.maxOutputTokens;
  assertSafeInteger(maxHttpRequests, "HTTP request cap"); assertSafeInteger(maxCostMicrounits, "cost cap");
  if (maxHttpRequests > profile.maxHttpRequests || maxCostMicrounits > profile.maxCostMicrounits
    || maxInputTokens !== profile.maxInputTokens || maxOutputTokens !== profile.maxOutputTokens) throw new TypeError("Hybrid profile cap/token limits cannot be raised or changed");
  if (typeof options.transport !== "function" || options.candidates.length !== 1) throw new TypeError("Live runner requires the exact hybrid benchmark candidate");
  options.candidates.forEach(validateCandidate);
  const ledgerFile = ledgerPath(options.stateDirectory, options.runId);
  const selectedCaseIds = options.caseIds ?? profile.caseIds;
  if (digest(selectedCaseIds) !== digest(profile.caseIds)) throw new TypeError("Hybrid profile requires its exact canonical subset");
  const provenanceValue: BenchmarkProvenance = {
    benchmarkContractVersion: LIVE_BENCHMARK_VERSION, promptVersion: CANONICAL_SEMANTIC_PROMPT_VERSION,
    promptSha256: digest(CANONICAL_SEMANTIC_PROMPT), runtimeValidationContractVersion: SEMANTIC_RUNTIME_VALIDATION_CONTRACT_VERSION,
    fixtureSha256: CANONICAL_SYNTHETIC_FIXTURE_CONTENT_SHA256,
    fixtureCaseIdsSha256: selectedCaseIds === undefined ? CANONICAL_SYNTHETIC_FIXTURE_IDS_SHA256 : digest(selectedCaseIds),
    schemaSha256: sourceDigest(["../../src/modules/semantic/contracts.ts"]),
    temporalExtractorSha256: sourceDigest(["../../src/modules/semantic/temporal-evidence.ts"]),
    reconcilerSha256: sourceDigest(["../../src/modules/semantic/reconciliation.ts", "../../src/modules/semantic/validation.ts", "../../src/modules/semantic/context-store.ts", "../../src/modules/semantic/contracts.ts"]),
    scorerVersion: SCORER_VERSION, scorerSha256: sourceDigest(["./semantic-v1.ts"]),
    requestSha256: sourceDigest(["./live-semantic-v1.ts", "./run-semantic-v1-live.mjs", "../../src/modules/intelligence/semantic-gateway.ts"]),
    model: options.candidates.map((candidate) => candidate.model), provider: options.candidates.map((candidate) => candidate.provider),
    runId: options.runId, profile: options.profile, maxHttpRequests, maxCostMicrounits, maxInputTokens, maxOutputTokens, retryLimit: 0, allowFallbacks: false,
  };
  const provenance = (): BenchmarkProvenance => structuredClone(provenanceValue);
  const configDigest = digest({ provenance: provenance(), candidates: options.candidates,
    modelSchema: ModelSemanticInterpretationJsonSchema, selectedCaseIds });
  let ledgerCaseIds = new Set<string>();

  async function fixture(): Promise<SyntheticSemanticFixture> {
    if (resolve(options.fixturePath) !== CANONICAL_SYNTHETIC_FIXTURE_PATH) throw new TypeError("Live runner requires the canonical fixture path");
    const source = await readFile(CANONICAL_SYNTHETIC_FIXTURE_PATH, "utf8");
    if (createHash("sha256").update(source).digest("hex") !== CANONICAL_SYNTHETIC_FIXTURE_CONTENT_SHA256) throw new TypeError("Live runner canonical fixture digest mismatch");
    const loaded = await loadSyntheticSemanticFixture(CANONICAL_SYNTHETIC_FIXTURE_PATH);
    assertCanonicalSyntheticFixtureIdentity(options.fixturePath, loaded);
    assertTemporalEvidencePreflight(loaded);
    ledgerCaseIds = new Set(selectedCaseIds ?? loaded.cases.map((item) => item.id));
    if (selectedCaseIds === undefined) return loaded;
    const selected = new Set(selectedCaseIds);
    if (selectedCaseIds.some((id) => !loaded.cases.some((item) => item.id === id))) throw new TypeError("Selected benchmark case is not canonical");
    return { ...loaded, cases: loaded.cases.filter((item) => selected.has(item.id)) };
  }
  const expected = (): Omit<Ledger, "attempts"> => ({ schemaVersion: 2, benchmarkVersion: LIVE_BENCHMARK_VERSION, runId: options.runId, fixtureContentDigest: CANONICAL_SYNTHETIC_FIXTURE_CONTENT_SHA256, configDigest });
  async function readLedger(): Promise<Ledger | null> {
    let source: string;
    try { source = await readFile(ledgerFile, "utf8"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
    try { return validateLedger(JSON.parse(source), expected(), { caseIds: ledgerCaseIds,
      candidateId: options.candidates[0].candidateId, reservedCost: candidateMaximum(options.candidates[0], maxInputTokens, maxOutputTokens) }); }
    catch { throw new TypeError("Corrupt benchmark ledger"); }
  }
  async function loadOrCreate(): Promise<Ledger> {
    const existing = await readLedger();
    if (existing) return existing;
    const created: Ledger = { ...expected(), attempts: [] };
    await atomicWrite(ledgerFile, created);
    return created;
  }
  function counts(ledger: Ledger) {
    const charged = ledger.attempts.filter((attempt) => attempt.state !== "RELEASED");
    return { requests: charged.length, cost: charged.reduce((sum, attempt) => sum + (attempt.finalizedCostMicrounits ?? attempt.reservedCostMicrounits), 0) };
  }
  function requestFor(candidate: LiveBenchmarkCandidate, item: SyntheticSemanticFixture["cases"][number]): LiveSemanticJsonRequest {
    const previousContext = benchmarkContext(item.priorContext);
    const semanticInput = SemanticInputSchema.parse({ text: item.message, temporalEvidence: benchmarkTemporalEvidence(item),
      ...semanticReferenceWallClock(Date.parse(item.interpretationReferenceTime)), ...(previousContext ? { previousContext } : {}) });
    const request: LiveSemanticJsonRequest = { model: candidate.model, stream: false, max_tokens: maxOutputTokens,
      messages: [{ role: "system", content: CANONICAL_SEMANTIC_PROMPT }, { role: "user", content: JSON.stringify(semanticInput) }],
      response_format: { type: "json_schema", json_schema: { name: "model_semantic_interpretation", strict: true, schema: structuredClone(ModelSemanticInterpretationJsonSchema) } },
      provider: { only: [candidate.provider], allow_fallbacks: false, require_parameters: true, data_collection: "deny", zdr: true,
        max_price: { prompt: candidate.promptPriceMicrounitsPerMillionTokens / 1_000_000, completion: candidate.completionPriceMicrounitsPerMillionTokens / 1_000_000 } } };
    // UTF-8 bytes plus framing allowance are a conservative input-token ceiling.
    if (new TextEncoder().encode(JSON.stringify(request)).byteLength + 512 > maxInputTokens) throw new TypeError("Hybrid request exceeds input token budget");
    return request;
  }
  async function preflight(input: { apiKeyPresent: boolean }): Promise<LiveBenchmarkPreflight> {
    const loaded = await fixture();
    for (const item of loaded.cases) requestFor(options.candidates[0], item);
    await loadOrCreate();
    const perRequest = options.candidates.map((candidate) => candidateMaximum(candidate, maxInputTokens, maxOutputTokens));
    return { caseCount: loaded.cases.length, fixtureContentDigest: CANONICAL_SYNTHETIC_FIXTURE_CONTENT_SHA256,
      candidateModels: options.candidates.map((candidate) => candidate.model), ledgerPath: ledgerFile, maxHttpRequests, maxCostMicrounits,
      projectedMaxRequests: loaded.cases.length * options.candidates.length,
      projectedMaxCostMicrounits: loaded.cases.length * perRequest.reduce((sum, cost) => sum + cost, 0),
      apiKey: input.apiKeyPresent ? "PRESENT" : "ABSENT", networkRequests: 0, temporalEvidence: temporalEvidencePreflight(loaded), provenance: provenance() };
  }
  async function save(ledger: Ledger): Promise<void> { await atomicWrite(ledgerFile, ledger); }
  async function acquireRunLock(): Promise<Awaited<ReturnType<typeof open>>> {
    await mkdir(dirname(ledgerFile), { recursive: true });
    try {
      const lock = await open(`${ledgerFile}.lock`, "wx", 0o600);
      await lock.writeFile(JSON.stringify({ pid: process.pid, runId: options.runId, acquiredAt: now() })); await lock.sync();
      return lock;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      let owner: { pid?: unknown; runId?: unknown };
      try { owner = JSON.parse(await readFile(`${ledgerFile}.lock`, "utf8")); } catch { throw new TypeError("Benchmark ledger lock is corrupt; refusing concurrent dispatch"); }
      const ownerPid = owner.pid;
      if (owner.runId !== options.runId || typeof ownerPid !== "number" || !Number.isSafeInteger(ownerPid) || ownerPid < 1) throw new TypeError("Benchmark ledger lock is incompatible; refusing concurrent dispatch");
      try { process.kill(ownerPid, 0); throw new TypeError("Benchmark ledger is locked by another local runner"); }
      catch (lockError) { if ((lockError as NodeJS.ErrnoException).code !== "ESRCH") throw lockError; }
      await unlink(`${ledgerFile}.lock`);
      return acquireRunLock();
    }
  }
  async function releaseRunLock(lock: Awaited<ReturnType<typeof open>>): Promise<void> {
    await lock.close(); await unlink(`${ledgerFile}.lock`).catch(() => undefined);
  }
  function progress(candidate: LiveBenchmarkCandidate, ordinal: number, loaded: SyntheticSemanticFixture, ledger: Ledger, status: string, latencyMs?: number) {
    const current = counts(ledger);
    options.onProgress?.(`MODEL=${candidate.model} CASE=${ordinal}/${loaded.cases.length} REQUESTS=${current.requests}/${maxHttpRequests} COST_MICROUNITS<=${current.cost}/${maxCostMicrounits} STATUS=${status}${latencyMs === undefined ? "" : ` LATENCY_MS=${latencyMs}`}`);
  }
  async function run(input: { apiKeyPresent: boolean }): Promise<LiveBenchmarkRun> {
    const lock = await acquireRunLock();
    try {
      const loaded = await fixture();
      let ledger = await loadOrCreate();
    let recovered = false;
    for (const attempt of ledger.attempts) {
      if (attempt.state === "DISPATCHED") { attempt.state = "UNKNOWN_DISPATCHED"; recovered = true; }
      if (attempt.state === "RESERVED") { attempt.state = "RELEASED"; recovered = true; }
    }
    if (recovered) await save(ledger);
      if (!input.apiKeyPresent) return result("BLOCKED_API_KEY", loaded, ledger);
      let ordinal = 0;
      for (const candidate of options.candidates) for (const item of loaded.cases) {
      ordinal += 1;
      if (ledger.attempts.some((attempt) => attempt.state !== "RELEASED" && attemptKey(attempt.candidateId, attempt.caseId) === attemptKey(candidate.candidateId, item.id))) continue;
      ledger = await readLedger() ?? (() => { throw new TypeError("Benchmark ledger disappeared while locked"); })();
      const current = counts(ledger); const reserve = candidateMaximum(candidate, maxInputTokens, maxOutputTokens);
      if (current.requests + 1 > maxHttpRequests) return result("INCOMPLETE_REQUEST_CAP", loaded, ledger);
      if (current.cost + reserve > maxCostMicrounits) return result("INCOMPLETE_COST_CAP", loaded, ledger);
      const request = requestFor(candidate, item);
      const attempt: LedgerAttempt = { candidateId: candidate.candidateId, caseId: item.id, ordinal, state: "RESERVED", reservedAt: now(), reservedCostMicrounits: reserve };
      ledger.attempts.push(attempt); await save(ledger);
      attempt.state = "DISPATCHED"; attempt.dispatchedAt = now(); await save(ledger);

      const start = Date.now();
      const outcome = await (async () => { const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 30_000); try { return decodeLiveResponse(await options.transport(request, { signal: controller.signal })); } catch { return { status: "FAILURE" as const, category: controller.signal.aborted ? "TIMEOUT" : "PROVIDER_FAILURE" }; } finally { clearTimeout(timer); } })();
      attempt.latencyMs = Math.max(0, Date.now() - start); attempt.completedAt = now();
      const usage = "usage" in outcome ? outcome.usage : undefined;
      const knownCost = usage?.costMicrounits;
      const trusted = typeof knownCost === "number" && Number.isSafeInteger(knownCost) && knownCost >= 0;
      attempt.finalizedCostMicrounits = trusted ? Math.max(knownCost, reserve) : reserve;
      if (usage?.promptTokens !== undefined) attempt.promptTokens = usage.promptTokens;
      if (usage?.completionTokens !== undefined) attempt.completionTokens = usage.completionTokens;
      if (outcome.status === "SUCCESS") { attempt.state = "COMPLETED"; attempt.interpretation = outcome.interpretation; }
      else { attempt.state = "FAILED"; attempt.errorCategory = safeCategory.has(outcome.category) ? outcome.category : "PROVIDER_FAILURE"; }
      await save(ledger); progress(candidate, ordinal, loaded, ledger, attempt.state, attempt.latencyMs);
      if (counts(ledger).cost > maxCostMicrounits) return result("INCOMPLETE_COST_CAP", loaded, ledger);
      }
      return result("COMPLETE", loaded, ledger);
    } finally { await releaseRunLock(lock); }
  }
  function result(status: LiveBenchmarkRun["status"], loaded: SyntheticSemanticFixture, ledger: Ledger): LiveBenchmarkRun {
    const metricsByCandidate: Record<string, ReturnType<typeof calculateSemanticBenchmarkMetrics>> = {};
    for (const candidate of options.candidates) {
      const observations: OfflineBenchmarkObservation[] = ledger.attempts.filter((attempt) => attempt.candidateId === candidate.candidateId && attempt.state === "COMPLETED" && attempt.interpretation !== undefined && attempt.latencyMs !== undefined)
        .map((attempt) => ({ caseId: attempt.caseId, interpretation: attempt.interpretation, latencyMs: attempt.latencyMs!, estimatedCostMicrounits: attempt.finalizedCostMicrounits ?? attempt.reservedCostMicrounits }));
      metricsByCandidate[candidate.candidateId] = calculateSemanticBenchmarkMetrics(loaded, observations);
    }
    const count = counts(ledger);
    if (count.cost > maxCostMicrounits) status = "INCOMPLETE_COST_CAP";
    else if (count.requests > maxHttpRequests) status = "INCOMPLETE_REQUEST_CAP";
    const qualityGates = Object.fromEntries(Object.entries(metricsByCandidate).map(([id, metrics]) => [id, evaluateHybridQualityGate(options.profile, metrics)]));
    return { status, qualityGates, metricsByCandidate, requestCount: count.requests, retainedCostMicrounits: count.cost, ledgerPath: ledgerFile, provenance: provenance() };
  }
  return { preflight, run };
}

/** Explicit production transport factory. It reads no secret and callers must inject a process-env key. */
export function createOpenRouterTransport(apiKey: string): LiveBenchmarkTransport {
  if (typeof apiKey !== "string" || apiKey.length === 0) throw new TypeError("OPENROUTER_API_KEY is required");
  return async (request: LiveSemanticJsonRequest, options: { signal: AbortSignal }) => {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", { method: "POST", redirect: "error", signal: options.signal,
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` }, body: JSON.stringify(request) });
    if (Number(response.headers.get("content-length")) > MAX_LIVE_RESPONSE_BYTES) return { status: response.status, body: "", oversized: true };
    if (!response.body) return { status: response.status, body: "" };
    const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let length = 0;
    try { for (;;) { const next = await reader.read(); if (next.done) break; length += next.value.byteLength; if (length > MAX_LIVE_RESPONSE_BYTES) { await reader.cancel(); return { status: response.status, body: "", oversized: true }; } chunks.push(next.value); } }
    finally { reader.releaseLock(); }
    return { status: response.status, body: new TextDecoder().decode(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)))) };
  };
}

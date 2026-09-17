import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { CANONICAL_SEMANTIC_PROMPT, CANONICAL_SEMANTIC_PROMPT_VERSION, SemanticInputSchema, semanticReferenceWallClock } from "../../src/modules/intelligence/semantic-gateway";
import { SemanticContextSlotsSchema } from "../../src/modules/semantic/context-store";
import { SEMANTIC_RUNTIME_VALIDATION_CONTRACT_VERSION, SemanticInterpretationJsonSchema, SemanticInterpretationSchema } from "../../src/modules/semantic/contracts";
import {
  CANONICAL_SYNTHETIC_FIXTURE_CONTENT_SHA256,
  CANONICAL_SYNTHETIC_FIXTURE_IDS_SHA256,
  CANONICAL_SYNTHETIC_FIXTURE_PATH,
  assertCanonicalSyntheticFixtureIdentity,
  calculateSemanticBenchmarkMetrics,
  equalRelevantFields,
  percentile95,
  sameFields,
  scoreRate,
  loadSyntheticSemanticFixture,
  type OfflineBenchmarkObservation,
  type SyntheticSemanticFixture,
} from "./semantic-v1";

export const LIVE_BENCHMARK_VERSION = "live-semantic-v1-2";
export const SCORER_VERSION = "semantic-scorer-2";
export const DEFAULT_MAX_HTTP_REQUESTS = 450;
export const DEFAULT_MAX_COST_MICROUNITS = 500_000;
const MAX_LIVE_RESPONSE_BYTES = 1_000_000;

export type LiveBenchmarkCandidate = {
  candidateId: string;
  model: "qwen/qwen3-30b-a3b-instruct-2507" | "nvidia/nemotron-3.5-lightning" | "google/gemini-2.5-flash-lite";
  provider: string;
  reasoning: "OMIT" | "DISABLED";
  promptPriceMicrounitsPerMillionTokens: number;
  completionPriceMicrounitsPerMillionTokens: number;
};
export type LiveSemanticJsonRequest = {
  model: string; stream: false; max_tokens: number; messages: Array<{ role: "system" | "user"; content: string }>;
  response_format: { type: "json_schema"; json_schema: { name: string; strict: true; schema: typeof SemanticInterpretationJsonSchema } };
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
  schemaVersion: 1; benchmarkVersion: string; runId: string; fixtureContentDigest: string;
  configDigest: string; attempts: LedgerAttempt[];
};
export type LiveBenchmarkPreflight = {
  caseCount: number; fixtureContentDigest: string; candidateModels: string[]; ledgerPath: string;
  maxHttpRequests: number; maxCostMicrounits: number; projectedMaxRequests: number;
  projectedMaxCostMicrounits: number; apiKey: "PRESENT" | "ABSENT"; networkRequests: 0;
  provenance: BenchmarkProvenance;
};
export type BenchmarkProvenance = {
  benchmarkContractVersion: string; promptVersion: string; promptSha256: string; runtimeValidationContractVersion: string; fixtureSha256: string;
  fixtureCaseIdsSha256: string; schemaSha256: string; scorerVersion: string; scorerSha256: string;
  model: string[]; provider: string[]; runId: string;
};
export type LiveBenchmarkRun = {
  status: "COMPLETE" | "INCOMPLETE_REQUEST_CAP" | "INCOMPLETE_COST_CAP" | "BLOCKED_API_KEY";
  metricsByCandidate: Record<string, ReturnType<typeof calculateSemanticBenchmarkMetrics>>; requestCount: number;
  retainedCostMicrounits: number; ledgerPath: string;
  provenance: BenchmarkProvenance;
};
export type LiveBenchmarkOptions = {
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
function digest(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function attemptKey(candidateId: string, caseId: string): string { return `${candidateId}\u0000${caseId}`; }
function now(): string { return new Date().toISOString(); }
function ledgerPath(stateDirectory: string, runId: string): string {
  if (!/^[A-Za-z0-9._-]{1,120}$/u.test(runId)) throw new TypeError("Invalid safe benchmark run ID");
  return join(resolve(stateDirectory), `${runId}.json`);
}
function candidateMaximum(candidate: LiveBenchmarkCandidate, maxInputTokens: number, maxOutputTokens: number): number {
  const numerator = BigInt(maxInputTokens) * BigInt(candidate.promptPriceMicrounitsPerMillionTokens)
    + BigInt(maxOutputTokens) * BigInt(candidate.completionPriceMicrounitsPerMillionTokens);
  const value = (numerator + 999_999n) / 1_000_000n;
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new TypeError("Candidate maximum cost is unsafe");
  return Number(value);
}
function benchmarkContext(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return undefined;
  const value = raw as { intent?: unknown; resolvedSlots?: unknown };
  const slots = value.resolvedSlots && typeof value.resolvedSlots === "object" ? value.resolvedSlots as Record<string, unknown> : {};
  if (value.intent === "CREATE_REMINDER") {
    const missingFields = ([slots.title, slots.localDate, slots.localTime].every((item) => item !== undefined)
      ? ["time"] : [["title", slots.title], ["date", slots.localDate], ["time", slots.localTime]].filter(([, item]) => item === undefined).map(([field]) => field)).slice(0, 4);
    const parsed = SemanticContextSlotsSchema.safeParse({ targetIntent: "CREATE_REMINDER", title: typeof slots.title === "string" ? slots.title : null,
      localDate: typeof slots.localDate === "string" ? slots.localDate : null, localTime: typeof slots.localTime === "string" ? slots.localTime : null, missingFields });
    return parsed.success ? parsed.data : undefined;
  }
  if (value.intent === "LIST_REMINDERS") {
    const missingFields = slots.rangeKind === undefined && slots.localDate === undefined ? ["range"] : ["range"];
    const parsed = SemanticContextSlotsSchema.safeParse({ targetIntent: "LIST_REMINDERS", rangeKind: typeof slots.rangeKind === "string" ? slots.rangeKind : null,
      localDate: typeof slots.localDate === "string" ? slots.localDate : null, missingFields });
    return parsed.success ? parsed.data : undefined;
  }
  return undefined;
}
function validateCandidate(candidate: LiveBenchmarkCandidate): void {
  if (!candidate || !/^[a-z0-9][a-z0-9._-]{0,80}$/u.test(candidate.candidateId)
    || (candidate.model !== "qwen/qwen3-30b-a3b-instruct-2507" && candidate.model !== "nvidia/nemotron-3.5-lightning" && candidate.model !== "google/gemini-2.5-flash-lite")
    || (candidate.model === "qwen/qwen3-30b-a3b-instruct-2507" && (candidate.provider !== "siliconflow/fp8" || candidate.reasoning !== "OMIT"))
    || (candidate.model === "nvidia/nemotron-3.5-lightning" && (candidate.provider !== "phala" || candidate.reasoning !== "DISABLED"))
    || (candidate.model === "google/gemini-2.5-flash-lite" && (candidate.provider !== "google-vertex/eu" || candidate.reasoning !== "OMIT"))
    || !/^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._:-]+)*$/u.test(candidate.provider)) throw new TypeError("Invalid approved benchmark candidate");
  assertSafeInteger(candidate.promptPriceMicrounitsPerMillionTokens, "candidate prompt price");
  assertSafeInteger(candidate.completionPriceMicrounitsPerMillionTokens, "candidate completion price");
  if ((candidate.model === "qwen/qwen3-30b-a3b-instruct-2507" && (candidate.promptPriceMicrounitsPerMillionTokens !== 90_000 || candidate.completionPriceMicrounitsPerMillionTokens !== 300_000))
    || (candidate.model === "nvidia/nemotron-3.5-lightning" && (candidate.promptPriceMicrounitsPerMillionTokens !== 80_000 || candidate.completionPriceMicrounitsPerMillionTokens !== 200_000))
    || (candidate.model === "google/gemini-2.5-flash-lite" && (candidate.promptPriceMicrounitsPerMillionTokens !== 100_000 || candidate.completionPriceMicrounitsPerMillionTokens !== 400_000))) {
    throw new TypeError("Candidate pricing does not match the pinned price");
  }
}
function approvedCandidateSet(candidates: LiveBenchmarkCandidate[]): boolean {
  return (candidates.length === 1 && candidates[0]?.model === "google/gemini-2.5-flash-lite") || (candidates.length === 2 && new Set(candidates.map((candidate) => candidate.model)).size === 2
    && candidates.some((candidate) => candidate.model === "qwen/qwen3-30b-a3b-instruct-2507")
    && candidates.some((candidate) => candidate.model === "nvidia/nemotron-3.5-lightning"));
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
  return SemanticInterpretationSchema.safeParse(interpretation).success ? { status: "SUCCESS", interpretation, usage } : { status: "FAILURE", category: "SCHEMA_INVALID", usage };
}
function validateLedger(value: unknown, expected: Omit<Ledger, "attempts">): Ledger {
  if (!value || typeof value !== "object") throw new TypeError("Corrupt benchmark ledger");
  const ledger = value as Partial<Ledger>;
  if (ledger.schemaVersion !== 1 || ledger.benchmarkVersion !== expected.benchmarkVersion || ledger.runId !== expected.runId
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
    if (attempt.interpretation !== undefined && !SemanticInterpretationSchema.safeParse(attempt.interpretation).success) throw new TypeError("Corrupt benchmark ledger interpretation");
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
  const maxHttpRequests = options.maxHttpRequests ?? DEFAULT_MAX_HTTP_REQUESTS;
  const maxCostMicrounits = options.maxCostMicrounits ?? DEFAULT_MAX_COST_MICROUNITS;
  const maxInputTokens = options.maxInputTokens ?? 10_000;
  const maxOutputTokens = options.maxOutputTokens ?? 1_024;
  assertSafeInteger(maxHttpRequests, "HTTP request cap"); assertSafeInteger(maxCostMicrounits, "cost cap");
  if (!Number.isInteger(maxInputTokens) || maxInputTokens < 1 || maxInputTokens > 100_000 || !Number.isInteger(maxOutputTokens) || maxOutputTokens < 1 || maxOutputTokens > 4_096) throw new TypeError("Invalid bounded token configuration");
  if (typeof options.transport !== "function" || !approvedCandidateSet(options.candidates) || new Set(options.candidates.map((item) => item.candidateId)).size !== options.candidates.length) throw new TypeError("Live runner requires an approved benchmark candidate set");
  options.candidates.forEach(validateCandidate);
  const ledgerFile = ledgerPath(options.stateDirectory, options.runId);
  const selectedCaseIds = options.caseIds === undefined ? undefined : [...options.caseIds];
  if (selectedCaseIds !== undefined && (selectedCaseIds.length === 0 || new Set(selectedCaseIds).size !== selectedCaseIds.length || selectedCaseIds.some((id) => typeof id !== "string"))) throw new TypeError("Invalid selected benchmark cases");
  if (options.candidates.length === 1 && options.candidates[0]?.model === "google/gemini-2.5-flash-lite"
    && (selectedCaseIds === undefined || selectedCaseIds.length !== GEMINI_PILOT_CASE_IDS.length
      || selectedCaseIds.some((id, index) => id !== GEMINI_PILOT_CASE_IDS[index]))) {
    throw new TypeError("Gemini requires the fixed Gemini pilot subset until quality-gated full authorization");
  }
  const provenance = (): BenchmarkProvenance => ({ benchmarkContractVersion: LIVE_BENCHMARK_VERSION, promptVersion: CANONICAL_SEMANTIC_PROMPT_VERSION, promptSha256: digest(CANONICAL_SEMANTIC_PROMPT), runtimeValidationContractVersion: SEMANTIC_RUNTIME_VALIDATION_CONTRACT_VERSION, fixtureSha256: CANONICAL_SYNTHETIC_FIXTURE_CONTENT_SHA256, fixtureCaseIdsSha256: selectedCaseIds === undefined ? CANONICAL_SYNTHETIC_FIXTURE_IDS_SHA256 : digest(selectedCaseIds), schemaSha256: digest(SemanticInterpretationJsonSchema), scorerVersion: SCORER_VERSION, scorerSha256: digest([calculateSemanticBenchmarkMetrics.toString(), sameFields.toString(), equalRelevantFields.toString(), scoreRate.toString(), percentile95.toString(), JSON.stringify(SemanticInterpretationJsonSchema), SEMANTIC_RUNTIME_VALIDATION_CONTRACT_VERSION].join("\n")), model: options.candidates.map((candidate) => candidate.model), provider: options.candidates.map((candidate) => candidate.provider), runId: options.runId });
  const configDigest = digest({ provenance: provenance(), candidates: options.candidates, maxHttpRequests, maxCostMicrounits, maxInputTokens, maxOutputTokens, selectedCaseIds });

  async function fixture(): Promise<SyntheticSemanticFixture> {
    if (resolve(options.fixturePath) !== CANONICAL_SYNTHETIC_FIXTURE_PATH) throw new TypeError("Live runner requires the canonical fixture path");
    const source = await readFile(CANONICAL_SYNTHETIC_FIXTURE_PATH, "utf8");
    if (createHash("sha256").update(source).digest("hex") !== CANONICAL_SYNTHETIC_FIXTURE_CONTENT_SHA256) throw new TypeError("Live runner canonical fixture digest mismatch");
    const loaded = await loadSyntheticSemanticFixture(CANONICAL_SYNTHETIC_FIXTURE_PATH);
    assertCanonicalSyntheticFixtureIdentity(options.fixturePath, loaded);
    if (selectedCaseIds === undefined) return loaded;
    const selected = new Set(selectedCaseIds);
    if (selectedCaseIds.some((id) => !loaded.cases.some((item) => item.id === id))) throw new TypeError("Selected benchmark case is not canonical");
    return { ...loaded, cases: loaded.cases.filter((item) => selected.has(item.id)) };
  }
  const expected = (): Omit<Ledger, "attempts"> => ({ schemaVersion: 1, benchmarkVersion: LIVE_BENCHMARK_VERSION, runId: options.runId, fixtureContentDigest: CANONICAL_SYNTHETIC_FIXTURE_CONTENT_SHA256, configDigest });
  async function readLedger(): Promise<Ledger | null> {
    let source: string;
    try { source = await readFile(ledgerFile, "utf8"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
    try { return validateLedger(JSON.parse(source), expected()); }
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
  async function preflight(input: { apiKeyPresent: boolean }): Promise<LiveBenchmarkPreflight> {
    const loaded = await fixture(); await loadOrCreate();
    const perRequest = options.candidates.map((candidate) => candidateMaximum(candidate, maxInputTokens, maxOutputTokens));
    return { caseCount: loaded.cases.length, fixtureContentDigest: CANONICAL_SYNTHETIC_FIXTURE_CONTENT_SHA256,
      candidateModels: options.candidates.map((candidate) => candidate.model), ledgerPath: ledgerFile, maxHttpRequests, maxCostMicrounits,
      projectedMaxRequests: loaded.cases.length * options.candidates.length,
      projectedMaxCostMicrounits: loaded.cases.length * perRequest.reduce((sum, cost) => sum + cost, 0),
      apiKey: input.apiKeyPresent ? "PRESENT" : "ABSENT", networkRequests: 0, provenance: provenance() };
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
      const attempt: LedgerAttempt = { candidateId: candidate.candidateId, caseId: item.id, ordinal, state: "RESERVED", reservedAt: now(), reservedCostMicrounits: reserve };
      ledger.attempts.push(attempt); await save(ledger);
      attempt.state = "DISPATCHED"; attempt.dispatchedAt = now(); await save(ledger);
      const previousContext = benchmarkContext(item.priorContext);
      const semanticInput = SemanticInputSchema.safeParse({ text: item.message, ...semanticReferenceWallClock(Date.parse(item.interpretationReferenceTime)), ...(previousContext ? { previousContext } : {}) });
      const request: LiveSemanticJsonRequest = { model: candidate.model, stream: false, max_tokens: maxOutputTokens,
        messages: [{ role: "system", content: CANONICAL_SEMANTIC_PROMPT }, { role: "user", content: JSON.stringify(semanticInput.success ? semanticInput.data : {}) }],
        response_format: { type: "json_schema", json_schema: { name: "semantic_interpretation", strict: true, schema: structuredClone(SemanticInterpretationJsonSchema) } },
        provider: { only: [candidate.provider], allow_fallbacks: false, require_parameters: true, data_collection: "deny", zdr: true, max_price: { prompt: candidate.promptPriceMicrounitsPerMillionTokens / 1_000_000, completion: candidate.completionPriceMicrounitsPerMillionTokens / 1_000_000 } }, ...(candidate.reasoning === "DISABLED" ? { reasoning: { effort: "none" as const, exclude: true as const } } : {}) };
      const start = Date.now();
      const outcome = semanticInput.success ? await (async () => { const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 30_000); try { return decodeLiveResponse(await options.transport(request, { signal: controller.signal })); } catch { return { status: "FAILURE" as const, category: controller.signal.aborted ? "TIMEOUT" : "PROVIDER_FAILURE" }; } finally { clearTimeout(timer); } })() : { status: "FAILURE" as const, category: "INVALID_INPUT" as const };
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
    return { status, metricsByCandidate, requestCount: count.requests, retainedCostMicrounits: count.cost, ledgerPath: ledgerFile, provenance: provenance() };
  }
  return { preflight, run };
}

/** Explicit production transport factory. It reads no secret and callers must inject a process-env key. */
export function createOpenRouterTransport(apiKey: string): LiveBenchmarkTransport {
  if (typeof apiKey !== "string" || apiKey.length === 0) throw new TypeError("OPENROUTER_API_KEY is required");
  return async (request: LiveSemanticJsonRequest, options: { signal: AbortSignal }) => {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", { method: "POST", signal: options.signal,
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` }, body: JSON.stringify(request) });
    if (Number(response.headers.get("content-length")) > MAX_LIVE_RESPONSE_BYTES) return { status: response.status, body: "", oversized: true };
    if (!response.body) return { status: response.status, body: "" };
    const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let length = 0;
    try { for (;;) { const next = await reader.read(); if (next.done) break; length += next.value.byteLength; if (length > MAX_LIVE_RESPONSE_BYTES) { await reader.cancel(); return { status: response.status, body: "", oversized: true }; } chunks.push(next.value); } }
    finally { reader.releaseLock(); }
    return { status: response.status, body: new TextDecoder().decode(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)))) };
  };
}

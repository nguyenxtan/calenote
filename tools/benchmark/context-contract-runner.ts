import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createContextContractGateway, createContextHttpTransport, type SemanticTransport } from "../../src/modules/intelligence/infrastructure/openrouter/semantic-gateway";
import { InterpretationJsonSchema, type ContextInput, type ParsedInterpretation } from "../../src/modules/conversation/context-contract/contracts";
import { googleLiteEuContextWireSchema } from "../../src/modules/intelligence/infrastructure/openrouter/context-provider-wire";
import type { SemanticGateway, SemanticUsage, SemanticProviderEvidence, SemanticFailureDiagnostics, CanonicalResponseDiagnostics } from "../../src/modules/intelligence/semantic-gateway";
import { admitCanonicalCampaign, scoreContextCampaign, type CampaignProfile, type ContextManifest } from "./context-contract";
import { runContextFixtureCampaign } from "./context-contract-probe";
import { frozenContextProposal } from "./context-contract-fixtures";
import { admitFutureLiveIntent, appendCampaignEvent, finishCampaignCall, markCampaignDispatched, readCampaignLedger, reserveCampaignCall,
  settleCampaignCanary, completeCampaign, admitR01ReplayIntent, type FutureLiveIntent } from "./context-contract-live";

const config = { maxInputChars: 1800, maxInputTokens: 12000, maxOutputTokens: 1536, maxResponseBytes: 32768, timeoutMs: 30000,
  primary: { model: "google/gemini-2.5-flash-lite", provider: "google-vertex/eu", requireZdr: true,
    promptPriceMicrounitsPerMillionTokens: 100000, completionPriceMicrounitsPerMillionTokens: 400000 } };
const digest = (s: string) => createHash("sha256").update(s).digest("hex");
interface ResponseEvidence { call: number; runId: string; fixtureId: string; turnIndex: number; status: string; httpStatus: number | null; rawResponseBytes: number | null; category?: string; usage: SemanticUsage | null; provider: SemanticProviderEvidence | null; requestDigest: string | null; failureDiagnostics?: SemanticFailureDiagnostics; canonicalValidationDiagnostics?: CanonicalResponseDiagnostics;
  canonicalSchemaDigest: string; providerWireSchemaDigest: string; providerWireSchemaVersion: string; }
interface ApplicationTurnEvidence { fixtureId: string; turnIndex: number; status: string; fullSchemaValid: boolean; pendingField: string | null;
  listStoreReads: number | null; mutations: number; queryRange: { start: number; end: number } | null; oracle: "PASS" | "FAIL"; }
export interface ObservableExecution { directory: string; sourceSha: string; provenanceDigest: string; profile: CampaignProfile; runId: string;
  cumulativeAuthorizedMicrounits: number; cumulativeRetainedMicrounits: number; transport: SemanticTransport; now?: () => number; root?: string;
  /** Live entry counts at fetch; injected tests represent an actual HTTP boundary. */
  httpRequestCount?: () => number; expiresAt?: number; }

/** Tool-only executor. Live entry validates authority first; tests replace HTTP,
 * never the actual application interpretation, storage or confirmation path. */
export async function executeObservableCampaign(input: ObservableExecution) { return executeObservable(input); }
export async function executeObservableR01Replay(input: ObservableExecution) {
  if (input.profile !== "PILOT" || input.cumulativeAuthorizedMicrounits !== 650000 || input.cumulativeRetainedMicrounits !== 528605) throw new Error("INVALID_REPLAY_BUDGET");
  return executeObservable(input, true);
}
async function executeObservable(input: ObservableExecution, replayOnly = false) {
  if (!/^[A-Za-z0-9_-]{1,100}$/u.test(input.runId)) throw new Error("INVALID_RUN_ID");
  const now = input.now ?? Date.now, startedAt = now(), root = input.root ?? process.cwd();
  const deadline = Math.min(input.expiresAt ?? Number.MAX_SAFE_INTEGER, startedAt + (input.profile === "PILOT" ? 1200000 : 2700000));
  appendCampaignEvent(input.directory, { event: "BEGIN", runId: input.runId, sourceSha: input.sourceSha, profile: input.profile,
    ...(replayOnly ? { executionKind: "R01_REPLAY" as const } : {}),
    provenanceDigest: input.provenanceDigest, cumulativeAuthorizedMicrounits: input.cumulativeAuthorizedMicrounits,
    cumulativeRetainedMicrounits: input.cumulativeRetainedMicrounits, startedAt, observableAdmission: true, expiresAt: deadline });
  const manifest: ContextManifest = { version: "context-contract-corpus-1", cases: ["regressions", "development", "heldout"].flatMap(name =>
    (JSON.parse(readFileSync(join(root, `src/modules/conversation/context-contract/benchmark/${name}.json`), "utf8")) as ContextManifest).cases) };
  const admitted = admitCanonicalCampaign(manifest, input.profile);
  const planned = replayOnly ? admitted.filter(script => script.executionId === "R01") : admitted;
  const healthyTurns = planned.flatMap(script => script.turns.flatMap((turn, index) => turn.model === "HEALTHY" && (!replayOnly || index === 1) ? [{ fixtureId: script.executionId, turnIndex: index }] : []));
  if (replayOnly && (planned.length !== 1 || planned[0].turns.length !== 2)) throw new Error("R01_MANIFEST_MISMATCH");
  let offlineSeedExecutions = 0;
  let offlineFixtureDigest = "";
  let seedFailure: { oracle: "FAIL"; status: string; fullSchemaValid: boolean; dispatches: number; proof: ReturnType<typeof scoreContextCampaign> } | null = null;
  let seed: { mode: "OFFLINE_FIXTURE"; oracle: "PASS"; snapshotDigest: string | null; manifestDigest: string; fixtureDigest: string;
    contextRevision: number | null; pendingField: "queryRange"; firstUserReceipt: string; replayUserReceipt: string } | null = null;
  let applicationFacts: { listStoreReads: number; canonicalReminderCount: number; mutations: number; queryRange: unknown } | null = null;
  let applicationLlmCalls = 0, providerHttpRequests = 0, canaryPassed = false;
  let syntheticFaultTurnsCompleted = 0;
  let outboundDigest: string | null = null, httpStatus: number | null = null;
  const httpCount = () => input.httpRequestCount?.() ?? providerHttpRequests;
  const responses: ResponseEvidence[] = [];
  const applicationEvidence: ApplicationTurnEvidence[] = [];
  const canonicalSchemaDigest = digest(JSON.stringify(InterpretationJsonSchema));
  const providerWire = googleLiteEuContextWireSchema();
  const providerWireSchemaDigest = digest(JSON.stringify(providerWire.schema));
  const schemaProof = { canonicalSchemaDigest, providerWireSchemaDigest, providerWireSchemaVersion: providerWire.version };
  const actual = createContextContractGateway(config, async (request, options) => {
    if (replayOnly && httpCount() >= 1) throw new Error("REPLAY_HTTP_CAP");
    outboundDigest = digest(JSON.stringify(request));
    if (digest(request.messages[0].content) !== "f1dfa650af32c63e80122addff2443d836175cb6ec0bce187bdf095fa4efada8"
      || canonicalSchemaDigest !== "8f1b868f606fd39972adc8984666f62960bf6c6f5ad38ff64774997b8765ba2d") throw new Error("CANONICAL_DIGEST_CHANGED");
    if (providerWireSchemaDigest !== "8a51135c5081b5e8316c25e3042766f07e082037da93d1692fca7cc452ce41bf"
      || digest(JSON.stringify(request.response_format.json_schema.schema)) !== providerWireSchemaDigest) throw new Error("PROVIDER_WIRE_DIGEST_CHANGED");
    if (!input.httpRequestCount) providerHttpRequests++;
    const remaining = deadline - now();
    if (remaining <= 0) throw new Error("AUTHORIZATION_EXPIRED");
    const response = await input.transport(request, { ...options, signal: AbortSignal.any([options.signal, AbortSignal.timeout(Math.min(30000, remaining))]) });
    httpStatus = response.status; return response;
  },
    { status: "OBSERVABLE_CANARY", advertisedContextTokens: 1048576 });
  const stopped = () => readCampaignLedger(input.directory).some(r => r.event === "STOP");
  const stop = (reason: string) => { if (!stopped()) appendCampaignEvent(input.directory, { event: "STOP", runId: input.runId, at: now(), reason }); };
  const gateway: SemanticGateway<ParsedInterpretation, ContextInput> = { prepare(tier, context) {
    const prepared = actual.prepare(tier, context); if (prepared.status !== "READY") return prepared;
    return { ...prepared, async dispatch() {
      if (replayOnly && (!seed || applicationLlmCalls >= 1)) throw new Error("REPLAY_SEED_OR_CALL_CAP");
      if (now() >= deadline) { stop("AUTHORIZATION_EXPIRED"); throw new Error("AUTHORIZATION_EXPIRED"); }
      const reservationId = `call-${applicationLlmCalls + 1}`;
      const reserved = reserveCampaignCall(input.directory, { runId: input.runId, profile: input.profile, provenanceDigest: input.provenanceDigest,
        reservationId, maximumMicrounits: prepared.maximumCostMicrounits, now: now(), startedAt });
      if (reserved.status !== "RESERVED") throw new Error("CAMPAIGN_CAP");
      markCampaignDispatched(input.directory, { runId: input.runId, reservationId, at: now() }); applicationLlmCalls++;
      outboundDigest = null; httpStatus = null;
      const parsed = await prepared.dispatch();
      // Evaluation requires the canonical full envelope before entering the
      // application. Runtime T5 core/guidance quarantine remains unchanged.
      const result = parsed.status === "SUCCESS" && !parsed.interpretation.fullSchemaValid
        ? { status: "FAILURE" as const, category: "SCHEMA_INVALID" as const, usage: parsed.usage, providerEvidence: parsed.providerEvidence, rawResponseBytes: parsed.rawResponseBytes, canonicalValidationDiagnostics: parsed.canonicalValidationDiagnostics } : parsed;
      finishCampaignCall(input.directory, { runId: input.runId, reservationId, at: now(), observedMicrounits: result.usage?.costMicrounits ?? null });
      responses.push({ call: applicationLlmCalls, runId: input.runId, ...healthyTurns[applicationLlmCalls - 1], status: result.status, ...schemaProof, ...(result.canonicalValidationDiagnostics ? { canonicalValidationDiagnostics: result.canonicalValidationDiagnostics } : {}), ...(result.status === "FAILURE" ? { category: result.category, ...(result.failureDiagnostics ? { failureDiagnostics: result.failureDiagnostics } : {}) } : {}),
        usage: result.usage ?? null, provider: result.providerEvidence ?? null, requestDigest: outboundDigest, httpStatus, rawResponseBytes: result.rawResponseBytes ?? null });
      // Content-free evidence persists even if application acceptance then fails.
      writeFileSync(join(input.directory, "responses.json"), JSON.stringify(responses), { mode: 0o600 });
      if (result.status !== "SUCCESS") stop("PROVIDER_ADMISSION_FAILED");
      return result;
    } };
  } };
  let score: ReturnType<typeof scoreContextCampaign> | null = null;
  try {
    const observations = await runContextFixtureCampaign(planned, { sourceSha: input.sourceSha, referenceNow: Date.parse("2026-10-05T01:00:00Z"), ...(replayOnly ? { offlineSeedTurns: 1 } : {}) },
      (context, id, index) => { if (!replayOnly || id !== "R01" || index !== 0) throw new Error("LIVE_FIXTURE_FORBIDDEN"); const value = frozenContextProposal(context, id, index); offlineFixtureDigest = digest(JSON.stringify(value)); return value; }, { gateway, async onTurn(script, index, observed) {
        const turn = script.turns[index];
        if (turn.model === "INJECTED_REFUSAL") syntheticFaultTurnsCompleted++;
        if (now() >= deadline) stop("TIME_OR_AUTHORIZATION_CAP");
        const single = { ...script, turns: [{ ...turn, actionsAfter: [] }] };
        const proof = scoreContextCampaign([single], [{ id: script.executionId, turns: [observed], actions: [] }]);
        const accepted = proof.passedTurns === 1 && proof.detailPassed === proof.detailPlanned && proof.safetyFailures === 0
          && (turn.model !== "HEALTHY" || observed.actualDispatches === 1);
        // Explicit projection of trusted application observations only. Persist
        // each completed turn before an oracle stop can discard aggregate score.
        // No proposal, selected text, receipt, business value or reply enters it.
        applicationEvidence.push({ fixtureId: script.executionId, turnIndex: index, status: observed.status,
          fullSchemaValid: observed.fullSchemaValid === true, pendingField: observed.pendingField ?? null,
          listStoreReads: observed.listStoreReads ?? null, mutations: observed.mutations,
          queryRange: observed.queryRange ? { start: observed.queryRange.start, end: observed.queryRange.end } : null,
          oracle: accepted ? "PASS" : "FAIL" });
        writeFileSync(join(input.directory, "application-evidence.json"), JSON.stringify(applicationEvidence), { mode: 0o600 });
        if (replayOnly && index === 0) {
          offlineSeedExecutions++;
          if (!accepted || observed.fullSchemaValid !== true || observed.pendingField !== "queryRange" || applicationLlmCalls !== 0 || httpCount() !== 0) { seedFailure = { oracle: "FAIL", status: observed.status, fullSchemaValid: observed.fullSchemaValid === true, dispatches: observed.dispatches, proof }; stop("OFFLINE_SEED_ORACLE_FAILED"); throw new Error("OFFLINE_SEED_ORACLE_FAILED"); }
          seed = { mode: "OFFLINE_FIXTURE", oracle: "PASS", snapshotDigest: observed.snapshotDigest ?? null,
            manifestDigest: digest(JSON.stringify(script)), fixtureDigest: offlineFixtureDigest, contextRevision: observed.contextRevision ?? null,
            pendingField: "queryRange", firstUserReceipt: script.turns[0].receipt, replayUserReceipt: script.turns[1].receipt };
          writeFileSync(join(input.directory, "seed-proof.json"), JSON.stringify(seed), { mode: 0o600 });
          return;
        }
        if (replayOnly) applicationFacts = { listStoreReads: observed.listStoreReads ?? 0, canonicalReminderCount: observed.childCount ?? -1,
          mutations: observed.mutations, queryRange: observed.queryRange ?? null };
        // Only nonmandatory FULL reply/source quality may use the approved
        // aggregate threshold. All state/detail/safety/schema facts stay exact.
        const factTurn = { ...turn, actionsAfter: [], expect: { ...turn.expect, source: observed.source, kind: observed.kind, replyIncludes: [], replyExcludes: [] } };
        const facts = scoreContextCampaign([{ ...script, turns: [factTurn] }], [{ id: script.executionId, turns: [observed], actions: [] }]);
        const toleratedQuality = input.profile === "FULL" && !script.mandatory && !script.executionId.includes("#")
          && facts.passedTurns === 1 && facts.detailPassed === facts.detailPlanned && facts.safetyFailures === 0;
        if (!canaryPassed && observed.actualDispatches === 1) {
          if (applicationLlmCalls !== 1 || httpCount() !== 1 || responses.length !== 1) stop("CANARY_COUNTER_MISMATCH");
          if (!stopped()) settleCampaignCanary(input.directory, { runId: input.runId, at: now(), accepted });
          canaryPassed = accepted && !stopped();
        }
        if (!accepted && (!canaryPassed || !toleratedQuality)) stop("APPLICATION_ORACLE_FAILED");
        if (stopped()) throw new Error("CAMPAIGN_STOPPED");
      } });
    score = replayOnly ? scoreContextCampaign([{ ...planned[0], turns: [planned[0].turns[1]] }], [{ ...observations[0], turns: [observations[0].turns[1]] }]) : scoreContextCampaign(planned, observations);
    const scopedReplayPassed = replayOnly && score.passedTurns === 1 && score.healthyFullSchemaValid === 1 && score.detailPassed === score.detailPlanned && score.safetyFailures === 0 && score.failedMandatory.length === 0;
    if ((!scopedReplayPassed && score.gate !== "PASS") || !canaryPassed || score.actualDispatches !== httpCount() || applicationLlmCalls !== httpCount()) stop("CAMPAIGN_GATE_FAILED");
    else completeCampaign(input.directory, { runId: input.runId, at: now() });
  } catch { stop("EXECUTION_FAILED"); }
  const status = stopped() ? "STOP" : "PASS";
  const finalLedger = readCampaignLedger(input.directory);
  const result = { status, routeAdmission: canaryPassed ? "PASS" : "STOP", applicationLlmCalls, providerHttpRequests: httpCount(),
    ...(replayOnly ? { replayOnly: true, historicalRouteAdmission: "PASS", offlineSeedExecutions, seed, seedFailure, applicationFacts, fullPilotGate: "NOT_RUN" } : {}),
    actualProviderCalls: httpCount(), responses, applicationEvidence, score, syntheticFaultControlsPlanned: planned.filter(s => s.turns.every(t => t.model === "INJECTED_REFUSAL")).length,
    syntheticFaultTurnsCompleted, providerReportedUsdTotal: responses.reduce((sum, r) => sum + (r.usage?.reportedCostUsd ?? 0), 0),
    retainedMicrounits: finalLedger.filter(r => r.event === "RESERVE").reduce((sum, reservation) => {
      const finish = finalLedger.find(r => r.event === "FINISH" && r.reservationId === reservation.reservationId);
      return sum + (finish?.event === "FINISH" ? finish.observedMicrounits ?? reservation.maximumMicrounits : reservation.maximumMicrounits);
    }, 0),
    elapsedMs: now() - startedAt };
  writeFileSync(join(input.directory, "report.json"), JSON.stringify(result), { mode: 0o600 });
  return result;
}

/** No credential is read until exact authorization and clean source are checked;
 * BEGIN and the conservative reservations precede the first credentialed HTTP. */
export async function runAuthorizedContextCampaign(intent: FutureLiveIntent, readSecret: () => string) {
  const authorization = admitFutureLiveIntent(intent);
  if (execFileSync("git", ["-C", intent.root, "status", "--porcelain", "--untracked-files=normal"], { encoding: "utf8" }).trim()) throw new Error("SOURCE_NOT_CLEAN");
  const directory = join(authorization.campaignRoot, intent.profile);
  mkdirSync(authorization.campaignRoot, { recursive: true, mode: 0o700 }); mkdirSync(directory, { mode: 0o700 });
  let transport: SemanticTransport | undefined;
  let requests = 0;
  return executeObservableCampaign({ ...authorization, directory, root: intent.root, httpRequestCount: () => requests, transport: (request, options) => {
    transport ??= createContextHttpTransport(readSecret(), async (url, init) => {
      if (Date.now() >= authorization.expiresAt || init?.signal?.aborted) throw new Error("AUTHORIZATION_EXPIRED");
      requests++; return fetch(url, init);
    }); return transport(request, options);
  } });
}

export async function runAuthorizedR01Replay(intent: FutureLiveIntent, readSecret: () => string) {
  const authorization = admitR01ReplayIntent(intent);
  if (execFileSync("git", ["-C", intent.root, "status", "--porcelain", "--untracked-files=normal"], { encoding: "utf8" }).trim()) throw new Error("SOURCE_NOT_CLEAN");
  const directory = join(authorization.campaignRoot, "R01_REPLAY");
  mkdirSync(authorization.campaignRoot, { recursive: true, mode: 0o700 }); mkdirSync(directory, { mode: 0o700 });
  let transport: SemanticTransport | undefined; let requests = 0;
  return executeObservableR01Replay({ ...authorization, directory, root: intent.root, httpRequestCount: () => requests, transport: (request, options) => {
    // Offline full oracle acceptance and durable reservation/dispatch precede
    // this lazy credential read. The HTTP boundary has a separate hard cap.
    if (requests >= 1 || Date.now() >= authorization.expiresAt) throw new Error("REPLAY_HTTP_OR_TIME_CAP");
    transport ??= createContextHttpTransport(readSecret(), async (url, init) => {
      if (requests >= 1 || Date.now() >= authorization.expiresAt || init.signal?.aborted) throw new Error("REPLAY_HTTP_OR_TIME_CAP");
      requests++; return fetch(url, init);
    }); return transport(request, options);
  } });
}

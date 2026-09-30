import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createContextContractGateway, createContextHttpTransport, type SemanticTransport } from "../../src/modules/intelligence/infrastructure/openrouter/semantic-gateway";
import { InterpretationJsonSchema, type ContextInput, type ParsedInterpretation } from "../../src/modules/conversation/context-contract/contracts";
import { googleLiteEuProviderWireSchema } from "../../src/modules/intelligence/infrastructure/openrouter/provider-wire-schema";
import type { SemanticGateway, SemanticUsage, SemanticProviderEvidence, SemanticFailureDiagnostics } from "../../src/modules/intelligence/semantic-gateway";
import { admitCanonicalCampaign, scoreContextCampaign, type CampaignProfile, type ContextManifest } from "./context-contract";
import { runContextFixtureCampaign } from "./context-contract-probe";
import { admitFutureLiveIntent, appendCampaignEvent, finishCampaignCall, markCampaignDispatched, readCampaignLedger, reserveCampaignCall,
  settleCampaignCanary, completeCampaign, type FutureLiveIntent } from "./context-contract-live";

const config = { maxInputChars: 1800, maxInputTokens: 12000, maxOutputTokens: 1536, maxResponseBytes: 32768, timeoutMs: 30000,
  primary: { model: "google/gemini-2.5-flash-lite", provider: "google-vertex/eu", requireZdr: true,
    promptPriceMicrounitsPerMillionTokens: 100000, completionPriceMicrounitsPerMillionTokens: 400000 } };
const digest = (s: string) => createHash("sha256").update(s).digest("hex");
interface ResponseEvidence { call: number; status: string; httpStatus: number | null; rawResponseBytes: number | null; category?: string; usage: SemanticUsage | null; provider: SemanticProviderEvidence | null; requestDigest: string | null; failureDiagnostics?: SemanticFailureDiagnostics;
  canonicalSchemaDigest: string; providerWireSchemaDigest: string; providerWireSchemaVersion: string; }
export interface ObservableExecution { directory: string; sourceSha: string; provenanceDigest: string; profile: CampaignProfile; runId: string;
  cumulativeAuthorizedMicrounits: number; cumulativeRetainedMicrounits: number; transport: SemanticTransport; now?: () => number; root?: string;
  /** Live entry counts at fetch; injected tests represent an actual HTTP boundary. */
  httpRequestCount?: () => number; expiresAt?: number; }

/** Tool-only executor. Live entry validates authority first; tests replace HTTP,
 * never the actual application interpretation, storage or confirmation path. */
export async function executeObservableCampaign(input: ObservableExecution) {
  const now = input.now ?? Date.now, startedAt = now(), root = input.root ?? process.cwd();
  const deadline = Math.min(input.expiresAt ?? Number.MAX_SAFE_INTEGER, startedAt + (input.profile === "PILOT" ? 1200000 : 2700000));
  appendCampaignEvent(input.directory, { event: "BEGIN", runId: input.runId, sourceSha: input.sourceSha, profile: input.profile,
    provenanceDigest: input.provenanceDigest, cumulativeAuthorizedMicrounits: input.cumulativeAuthorizedMicrounits,
    cumulativeRetainedMicrounits: input.cumulativeRetainedMicrounits, startedAt, observableAdmission: true, expiresAt: deadline });
  const manifest: ContextManifest = { version: "context-contract-corpus-1", cases: ["regressions", "development", "heldout"].flatMap(name =>
    (JSON.parse(readFileSync(join(root, `src/modules/conversation/context-contract/benchmark/${name}.json`), "utf8")) as ContextManifest).cases) };
  const planned = admitCanonicalCampaign(manifest, input.profile);
  let applicationLlmCalls = 0, providerHttpRequests = 0, canaryPassed = false;
  let syntheticFaultTurnsCompleted = 0;
  let outboundDigest: string | null = null, httpStatus: number | null = null;
  const httpCount = () => input.httpRequestCount?.() ?? providerHttpRequests;
  const responses: ResponseEvidence[] = [];
  const canonicalSchemaDigest = digest(JSON.stringify(InterpretationJsonSchema));
  const providerWire = googleLiteEuProviderWireSchema(InterpretationJsonSchema);
  const providerWireSchemaDigest = digest(JSON.stringify(providerWire.schema));
  const schemaProof = { canonicalSchemaDigest, providerWireSchemaDigest, providerWireSchemaVersion: providerWire.version };
  const actual = createContextContractGateway(config, async (request, options) => {
    outboundDigest = digest(JSON.stringify(request));
    if (digest(request.messages[0].content) !== "f1dfa650af32c63e80122addff2443d836175cb6ec0bce187bdf095fa4efada8"
      || canonicalSchemaDigest !== "8f1b868f606fd39972adc8984666f62960bf6c6f5ad38ff64774997b8765ba2d") throw new Error("CANONICAL_DIGEST_CHANGED");
    if (providerWireSchemaDigest !== "1ccd317a66f7de068d6f4e29a38346a880898a8445b1dad256a34c23bc1d0446"
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
        ? { status: "FAILURE" as const, category: "SCHEMA_INVALID" as const, usage: parsed.usage, providerEvidence: parsed.providerEvidence, rawResponseBytes: parsed.rawResponseBytes } : parsed;
      finishCampaignCall(input.directory, { runId: input.runId, reservationId, at: now(), observedMicrounits: result.usage?.costMicrounits ?? null });
      responses.push({ call: applicationLlmCalls, status: result.status, ...schemaProof, ...(result.status === "FAILURE" ? { category: result.category, ...(result.failureDiagnostics ? { failureDiagnostics: result.failureDiagnostics } : {}) } : {}),
        usage: result.usage ?? null, provider: result.providerEvidence ?? null, requestDigest: outboundDigest, httpStatus, rawResponseBytes: result.rawResponseBytes ?? null });
      // Content-free evidence persists even if application acceptance then fails.
      writeFileSync(join(input.directory, "responses.json"), JSON.stringify(responses), { mode: 0o600 });
      if (result.status !== "SUCCESS") stop("PROVIDER_ADMISSION_FAILED");
      return result;
    } };
  } };
  let score: ReturnType<typeof scoreContextCampaign> | null = null;
  try {
    const observations = await runContextFixtureCampaign(planned, { sourceSha: input.sourceSha, referenceNow: Date.parse("2026-10-05T01:00:00Z") },
      () => { throw new Error("LIVE_FIXTURE_FORBIDDEN"); }, { gateway, async onTurn(script, index, observed) {
        const turn = script.turns[index];
        if (turn.model === "INJECTED_REFUSAL") syntheticFaultTurnsCompleted++;
        if (now() >= deadline) stop("TIME_OR_AUTHORIZATION_CAP");
        const single = { ...script, turns: [{ ...turn, actionsAfter: [] }] };
        const proof = scoreContextCampaign([single], [{ id: script.executionId, turns: [observed], actions: [] }]);
        const accepted = proof.passedTurns === 1 && proof.detailPassed === proof.detailPlanned && proof.safetyFailures === 0
          && (turn.model !== "HEALTHY" || observed.actualDispatches === 1);
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
    score = scoreContextCampaign(planned, observations);
    if (score.gate !== "PASS" || !canaryPassed || score.actualDispatches !== httpCount() || applicationLlmCalls !== httpCount()) stop("CAMPAIGN_GATE_FAILED");
    else completeCampaign(input.directory, { runId: input.runId, at: now() });
  } catch { stop("EXECUTION_FAILED"); }
  const status = stopped() ? "STOP" : "PASS";
  const finalLedger = readCampaignLedger(input.directory);
  const result = { status, routeAdmission: canaryPassed ? "PASS" : "STOP", applicationLlmCalls, providerHttpRequests: httpCount(),
    actualProviderCalls: httpCount(), responses, score, syntheticFaultControlsPlanned: planned.filter(s => s.turns.every(t => t.model === "INJECTED_REFUSAL")).length,
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

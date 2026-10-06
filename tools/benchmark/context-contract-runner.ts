import {isUnreconciledListInterpretation, listTransportGuidanceValid, type ContextGatewayInterpretation} from "../../src/modules/conversation/context-contract/list-period-transport";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { DownstreamTraceSchema } from "../../src/modules/conversation/context-contract/downstream";
import { execFileSync } from "node:child_process";
import { createContextContractGateway, createContextHttpTransport, CONTEXT_FINANCIAL_RESERVATION_MICROUNITS, type SemanticTransport } from "../../src/modules/intelligence/infrastructure/openrouter/semantic-gateway";
import { InterpretationJsonSchema, type ContextInput } from "../../src/modules/conversation/context-contract/contracts";
import { googleLiteEuContextWireSchemaV3 } from "../../src/modules/intelligence/infrastructure/openrouter/context-provider-wire";
import type { SemanticGateway, SemanticUsage, SemanticProviderEvidence, SemanticFailureDiagnostics, CanonicalResponseDiagnostics } from "../../src/modules/intelligence/semantic-gateway";
import { admitCanonicalCampaign, scoreContextCampaign, scoreContextAction, diagnoseContextTurn, captureContextOracleState, captureValidationSemanticState, type OracleDiagnostics, type CampaignProfile, type ContextManifest } from "./context-contract";
import { runContextFixtureCampaign } from "./context-contract-probe";
import { frozenContextProposal } from "./context-contract-fixtures";
import { deriveContextSeed } from "./context-seed";
import { captureQueryDiagnostics } from "./context-query-diagnostics";
import { validateFrozenContextCorpus } from "./context-contract-live";
import { CONTEXT_PROTOCOL_V3 } from "../../src/modules/conversation/context-contract/protocol";
import { admitFutureLiveIntent, appendCampaignEvent, finishCampaignCall, markCampaignDispatched, readCampaignLedger, reserveCampaignCall,
  settleCampaignCanary, completeCampaign, admitR01ReplayIntent, withAuthorizedAccountRootLock, contextCampaignGitEnvironment, revalidateCampaignPaidAdmission, type FutureLiveIntent } from "./context-contract-live";

export const contextCampaignGatewayConfig = { protocol: CONTEXT_PROTOCOL_V3, maxInputChars: 1800, maxInputTokens: 12000, maxOutputTokens: 1536, maxResponseBytes: 32768, timeoutMs: 30000,
  primary: { model: "google/gemini-2.5-flash-lite", provider: "google-vertex/eu", requireZdr: true,
    promptPriceMicrounitsPerMillionTokens: 100000, completionPriceMicrounitsPerMillionTokens: 400000 } };
const config = contextCampaignGatewayConfig;
export const contextCampaignAdvertisedContextTokens = 1048576;
export const contextCampaignMaximumReservation = CONTEXT_FINANCIAL_RESERVATION_MICROUNITS;
const digest = (s: string) => createHash("sha256").update(s).digest("hex");
interface ResponseEvidence { call: number; runId: string; fixtureId: string; turnIndex: number; status: string; httpStatus: number | null; rawResponseBytes: number | null; category?: string; usage: SemanticUsage | null; provider: SemanticProviderEvidence | null; requestDigest: string | null; failureDiagnostics?: SemanticFailureDiagnostics; canonicalValidationDiagnostics?: CanonicalResponseDiagnostics;
  semanticState?:ReturnType<typeof captureValidationSemanticState>;
  queryDiagnostics?:ReturnType<typeof captureQueryDiagnostics>;
  canonicalSchemaDigest: string; providerWireSchemaDigest: string; providerWireSchemaVersion: string; }
interface ApplicationTurnEvidence { fixtureId: string; turnIndex: number; status: string; fullSchemaValid: boolean; pendingField: string | null;
  oracleState?:ReturnType<typeof captureContextOracleState>;
  downstreamDiagnostics: import("../../src/modules/conversation/context-contract/downstream").DownstreamDiagnostic[];
  listStoreReads: number | null; mutations: number; queryRange: { start: number; end: number } | null; oracle: "PASS" | "FAIL"; oracleDiagnostics:OracleDiagnostics; }
export interface ObservableExecution { directory: string; sourceSha: string; provenanceDigest: string; profile: CampaignProfile; runId: string;
  singleTarget?: {fixture:string;turn:number;manifestSha256:string;contextSeedDigest?:string};
  accountingPolicy?: "CONFIRMED_COST_V1";
  boundedPilot?: { manifestSha256: string; maxRequests: number;
    beforeDispatch(target: {fixtureId:string;turnIndex:number}, reservationId:string): void;
    settled(target: {fixtureId:string;turnIndex:number}, reservationId:string, costMicrounits:number|null): void;
    outcome(target: {fixtureId:string;turnIndex:number}, accepted:boolean): void; };
  cumulativeAuthorizedMicrounits: number; cumulativeRetainedMicrounits: number; transport: SemanticTransport; now?: () => number; root?: string;
  /** Live entry counts at fetch; injected tests represent an actual HTTP boundary. */
  httpRequestCount?: () => number; expiresAt?: number;
  startedAt?: number; authorizationSha256?: string; historicalCalls?: number; historicalUnknownReservations?: number;
  /** Additional execution fence; never replaces the owner's BEGIN expiry. */
  paidExpiresAt?: number;
  pilotPrefix?: { directory: string; ledgerHash: string; responseDigest: string; applicationDigest: string }; }

/** R01 is an independent script, not clarification state for R02. Carry only
 * its reviewed outcome evidence, never a model payload or persisted context.
 * Any change to downstream application semantics invalidates this reuse. */
function verifyPilotPrefix(input: ObservableExecution, root: string, admitted: ReturnType<typeof admitCanonicalCampaign>) {
  if (!input.pilotPrefix) return null;
  const fail = () => { throw new Error("INVALID_PILOT_PREFIX"); };
  if (input.profile !== "PILOT" || resolve(input.pilotPrefix.directory) === resolve(input.directory)
    || !/^[a-f0-9]{64}$/u.test(input.pilotPrefix.ledgerHash)) return fail();
  const rows = readCampaignLedger(input.pilotPrefix.directory), begin = rows[0], last = rows.at(-1);
  if (begin?.event !== "BEGIN" || begin.profile !== "PILOT" || begin.executionKind || !begin.observableAdmission
    || last?.event !== "STOP" || last.hash !== input.pilotPrefix.ledgerHash || last.reason !== "PROVIDER_ADMISSION_FAILED"
    || !rows.some(row => row.event === "CANARY_PASS") || rows.filter(row => row.event === "DISPATCH").length !== 3
    || admitted[0]?.executionId !== "R01" || admitted[0].turns.length !== 2 || admitted[0].turns.some(t => (t.actionsAfter?.length ?? 0) > 0)
    || admitted[1]?.executionId !== "R02" || !/^[a-f0-9]{40}$/u.test(begin.sourceSha)
    || begin.sourceSha !== input.sourceSha || begin.provenanceDigest !== input.provenanceDigest) return fail();
  let historicalWireVersion: string | undefined;
  try {
    historicalWireVersion = googleLiteEuContextWireSchemaV3().version;
    if (!historicalWireVersion) return fail();
    for (const name of ["regressions", "development", "heldout"]) {
      const path = `src/modules/conversation/context-contract/benchmark/${name}.json`;
      if (execFileSync("git", ["-C", root, "show", `${begin.sourceSha}:${path}`], { encoding: "utf8", env: contextCampaignGitEnvironment }) !== readFileSync(join(root, path), "utf8")) return fail();
    }
  } catch { return fail(); }
  const responseText = readFileSync(join(input.pilotPrefix.directory, "responses.json"), "utf8");
  const applicationText = readFileSync(join(input.pilotPrefix.directory, "application-evidence.json"), "utf8");
  if (responseText.length > 65536 || applicationText.length > 65536
    || digest(responseText) !== input.pilotPrefix.responseDigest || digest(applicationText) !== input.pilotPrefix.applicationDigest) return fail();
  const responses = JSON.parse(responseText) as ResponseEvidence[], application = JSON.parse(applicationText) as ApplicationTurnEvidence[];
  if (!Array.isArray(responses) || responses.length !== 3 || !Array.isArray(application) || application.length !== 3) return fail();
  for (let i = 0; i < 2; i++) {
    const response = responses[i], turn = application[i];
    if (response.fixtureId !== "R01" || response.turnIndex !== i || response.status !== "SUCCESS" || response.httpStatus !== 200
      || response.canonicalSchemaDigest !== digest(JSON.stringify(InterpretationJsonSchema))
      || response.providerWireSchemaVersion !== historicalWireVersion
      || !/^[a-f0-9]{64}$/u.test(response.providerWireSchemaDigest)
      || response.providerWireSchemaDigest !== responses[0].providerWireSchemaDigest
      || (begin.sourceSha === input.sourceSha && response.providerWireSchemaDigest !== digest(JSON.stringify(googleLiteEuContextWireSchemaV3().schema)))
      || response.provider?.model !== config.primary.model || response.provider.provider !== "Google"
      || !response.usage || response.usage.promptTokens === undefined || response.usage.completionTokens === undefined
      || response.usage.promptTokens > 12000 || response.usage.completionTokens > 1536
      || response.rawResponseBytes === null || response.rawResponseBytes > 32768 || !response.provider.generationId
      || !response.requestDigest || !rows.some(row => row.event === "FINISH" && row.reservationId === `call-${i + 1}`
        && row.observedMicrounits === response.usage?.costMicrounits)) throw new Error("INVALID_PILOT_PREFIX_RESPONSE");
    if (turn.fixtureId !== "R01" || turn.turnIndex !== i || turn.oracle !== "PASS" || !turn.fullSchemaValid || turn.mutations !== 0
      || turn.status !== (i === 0 ? "CLARIFICATION_REQUESTED" : "REMINDERS_LISTED")
      || turn.pendingField !== (i === 0 ? "queryRange" : null) || turn.listStoreReads !== i
      || (i === 0 ? turn.queryRange !== null : JSON.stringify(turn.queryRange) !== JSON.stringify(admitted[0].turns[1].expect.queryRange))) return fail();
  }
  if (responses[2].fixtureId !== "R02" || responses[2].turnIndex !== 0 || responses[2].status !== "FAILURE") return fail();
  return { directory: resolve(input.pilotPrefix.directory), scripts: 1, turns: 2, sourceSha: begin.sourceSha, provenanceDigest: begin.provenanceDigest,
    ledgerHash: last.hash, responseDigest: digest(responseText), applicationDigest: digest(applicationText),
    historicalWireSchemaVersion: responses[0].providerWireSchemaVersion, historicalWireSchemaDigest: responses[0].providerWireSchemaDigest };
}

/** Tool-only executor. Live entry validates authority first; tests replace HTTP,
 * never the actual application interpretation, storage or confirmation path. */
export async function executeObservableCampaign(input: ObservableExecution) { return executeObservable(input); }
/** Historical second-turn reference, retained solely for audit regressions.
 * No live launcher calls this obsolete budget-bound executor. The trusted
 * single-turn-zero bridge is the only live diagnostic entry. */
export async function executeObservableR01Replay(input: ObservableExecution) {
  if (input.profile !== "PILOT" || input.cumulativeAuthorizedMicrounits !== 650000 || input.cumulativeRetainedMicrounits !== 528605) throw new Error("INVALID_REPLAY_BUDGET");
  return executeObservable(input, true);
}
/** Dedicated diagnostic scope: the manifest itself contains exactly one turn.
 * Success cannot advance to a second semantic turn or campaign. */
export async function executeObservableR01Turn0Replay(input: ObservableExecution) {
  if (input.profile !== "PILOT" || input.pilotPrefix) throw new Error("INVALID_SINGLE_REPLAY_SCOPE");
  return executeObservable(input, false, true);
}
export function resolveSingleValidationTarget(root:string,target:{fixture:string;turn:number}) {
  const manifests=["regressions","development","heldout"].map(name=>JSON.parse(readFileSync(join(root,`src/modules/conversation/context-contract/benchmark/${name}.json`),"utf8")) as ContextManifest);
  validateFrozenContextCorpus(root,manifests);
  const planned=admitCanonicalCampaign({version:"context-contract-corpus-1",cases:manifests.flatMap(m=>m.cases)},"PILOT");
  const script=planned.find(s=>s.executionId===target.fixture);
  if(!script||!Number.isSafeInteger(target.turn)||target.turn<0||!script.turns[target.turn])throw Error("SINGLE_TARGET_NOT_FOUND");
  if(script.turns[target.turn].model!=="HEALTHY"||(script.turns[target.turn].actionsAfter?.length??0)>0)throw Error("SINGLE_TARGET_NOT_STANDALONE");
  return {...target,...deriveContextSeed(root,script,target.turn),manifestSha256:digest(JSON.stringify({version:"bounded-formal-pilot-manifest-1",manifests,planned})),script:{...script,turns:[script.turns[target.turn]]}};
}
export async function executeObservableSingleTargetValidation(input:ObservableExecution) {
  if(!input.singleTarget||input.profile!=="PILOT"||input.accountingPolicy!=="CONFIRMED_COST_V1"||input.pilotPrefix||input.boundedPilot)throw Error("INVALID_SINGLE_TARGET_SCOPE");
  return executeObservable(input,false,true);
}
async function executeObservable(input: ObservableExecution, replayOnly = false, turnZeroOnly = false) {
  if (input.accountingPolicy && ((!turnZeroOnly && !input.boundedPilot) || input.profile !== "PILOT")) throw new Error("INVALID_CONFIRMED_COST_SCOPE");
  if (input.boundedPilot && (input.accountingPolicy !== "CONFIRMED_COST_V1" || input.profile !== "PILOT" || turnZeroOnly || replayOnly || input.pilotPrefix)) throw new Error("INVALID_BOUNDED_PILOT_SCOPE");
  if (!/^[A-Za-z0-9_-]{1,100}$/u.test(input.runId)) throw new Error("INVALID_RUN_ID");
  const now = input.now ?? Date.now, startedAt = input.startedAt ?? now(), root = input.root ?? process.cwd();
  const ownerDeadline = Math.min(input.expiresAt ?? Number.MAX_SAFE_INTEGER, startedAt + (input.profile === "PILOT" ? 1200000 : 2700000));
  const deadline = Math.min(ownerDeadline, input.paidExpiresAt ?? Number.MAX_SAFE_INTEGER);
  const manifest: ContextManifest = { version: "context-contract-corpus-1", cases: ["regressions", "development", "heldout"].flatMap(name =>
    (JSON.parse(readFileSync(join(root, `src/modules/conversation/context-contract/benchmark/${name}.json`), "utf8")) as ContextManifest).cases) };
  const admitted = admitCanonicalCampaign(manifest, input.profile);
  const selected=input.singleTarget?resolveSingleValidationTarget(root,input.singleTarget):undefined;
  if(selected&&selected.manifestSha256!==input.singleTarget!.manifestSha256)throw Error("SINGLE_TARGET_MANIFEST_MISMATCH");
  if(selected&&((selected.turn>0&&!input.singleTarget!.contextSeedDigest)||(input.singleTarget!.contextSeedDigest&&input.singleTarget!.contextSeedDigest!==selected.contextSeedDigest)))throw Error("SINGLE_TARGET_CONTEXT_SEED_BINDING");
  const pilotPrefix = verifyPilotPrefix(input, root, admitted);
  if (pilotPrefix && replayOnly) throw new Error("INVALID_PILOT_PREFIX");
  appendCampaignEvent(input.directory, { event: "BEGIN", runId: input.runId, sourceSha: input.sourceSha, profile: input.profile,
    ...(input.accountingPolicy ? {accountingPolicy:input.accountingPolicy,requestExposureBoundMicrounits:contextCampaignMaximumReservation} : {}),
    ...(input.boundedPilot ? {executionKind:"BOUNDED_PILOT" as const,targetManifestSha256:input.boundedPilot.manifestSha256,maxTargetRequests:input.boundedPilot.maxRequests} : {}),
    ...(input.singleTarget ? {executionKind:"SINGLE_TARGET_VALIDATION" as const,targetManifestSha256:selected!.manifestSha256,maxTargetRequests:1,targetFixture:selected!.fixture,targetTurn:selected!.turn,...(input.singleTarget.contextSeedDigest?{contextSeedDigest:input.singleTarget.contextSeedDigest}:{})} : replayOnly || turnZeroOnly ? { executionKind: "R01_REPLAY" as const } : {}),
    ...(pilotPrefix ? { executionKind: "R02_CONTINUATION" as const, pilotPrefixDigest: digest(JSON.stringify(pilotPrefix)) } : {}),
    ...(input.authorizationSha256 ? { authorizationSha256: input.authorizationSha256, historicalCalls: input.historicalCalls, historicalUnknownReservations: input.historicalUnknownReservations } : {}),
    provenanceDigest: input.provenanceDigest, cumulativeAuthorizedMicrounits: input.cumulativeAuthorizedMicrounits,
    cumulativeRetainedMicrounits: input.cumulativeRetainedMicrounits, startedAt, observableAdmission: true, expiresAt: ownerDeadline });
  if (pilotPrefix) writeFileSync(join(input.directory, "pilot-prefix-proof.json"), JSON.stringify(pilotPrefix), { mode: 0o600 });
  const planned = selected ? [selected.script] : turnZeroOnly ? admitted.filter(script => script.executionId === "R01").map(script => ({ ...script, turns: [{ ...script.turns[0], actionsAfter: [] }] }))
    : replayOnly ? admitted.filter(script => script.executionId === "R01") : pilotPrefix ? admitted.slice(1) : admitted;
  if (turnZeroOnly && (planned.length !== 1 || planned[0].turns.length !== 1 || planned[0].turns[0].model !== "HEALTHY")) throw new Error("R01_MANIFEST_MISMATCH");
  const healthyTurns = planned.flatMap(script => script.turns.flatMap((turn, index) => turn.model === "HEALTHY" && (!replayOnly || index === 1) ? [{ fixtureId: script.executionId, turnIndex: selected?.turn??index }] : []));
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
  let queryDiagnostics:ReturnType<typeof captureQueryDiagnostics>|undefined;
  const httpCount = () => input.httpRequestCount?.() ?? providerHttpRequests;
  const responses: ResponseEvidence[] = [];
  const applicationEvidence: ApplicationTurnEvidence[] = [];
  const actionEvidence: Array<{fixtureId:string;turnIndex:number;actionIndex:number;oracle:string;unsafe:boolean}> = [];
  const pendingTargetOutcomes = new Map<string,{fixtureId:string;turnIndex:number}>();
  const canonicalSchemaDigest = digest(JSON.stringify(InterpretationJsonSchema));
  const providerWire = googleLiteEuContextWireSchemaV3();
  const providerWireSchemaDigest = digest(JSON.stringify(providerWire.schema));
  const schemaProof = { canonicalSchemaDigest, providerWireSchemaDigest, providerWireSchemaVersion: providerWire.version };
  const actual = createContextContractGateway(config, async (request, options) => {
    if ((replayOnly || turnZeroOnly) && httpCount() >= 1) throw new Error("REPLAY_HTTP_CAP");
    outboundDigest = digest(JSON.stringify(request));
    if (digest(request.messages[0].content) !== "d8a7bad4da59e8bf761480f5b697afe1a66fef51cb1965163840c100798b38c7"
      || canonicalSchemaDigest !== "43b6689ce9c4874c4d532652ea212b52aa7d7f222cddd55377e59d483f5c444b") throw new Error("CANONICAL_DIGEST_CHANGED");
    if (providerWireSchemaDigest !== "b17e442e441628b1909c65b7dbeec20761936a3124d9c9859f2e66e1e8fc75d3"
      || digest(JSON.stringify(request.response_format.json_schema.schema)) !== providerWireSchemaDigest) throw new Error("PROVIDER_WIRE_DIGEST_CHANGED");
    if (!input.httpRequestCount) providerHttpRequests++;
    const remaining = deadline - now();
    if (remaining <= 0) throw new Error("AUTHORIZATION_EXPIRED");
    const response = await input.transport(request, { ...options, signal: AbortSignal.any([options.signal, AbortSignal.timeout(Math.min(30000, remaining))]) });
    httpStatus = response.status;
    if(selected)queryDiagnostics=captureQueryDiagnostics(response.body);
    return response;
  },
    { status: "OBSERVABLE_CANARY", advertisedContextTokens: contextCampaignAdvertisedContextTokens });
  const stopped = () => readCampaignLedger(input.directory).some(r => r.event === "STOP");
  const stop = (reason: string) => { if (!stopped()) appendCampaignEvent(input.directory, { event: "STOP", runId: input.runId, at: now(), reason }); };
  let activeTarget: {fixtureId:string;turnIndex:number}|undefined;
  const gateway: SemanticGateway<ContextGatewayInterpretation, ContextInput> = { prepare(tier, context) {
    const preparedTarget=activeTarget;
    const prepared = actual.prepare(tier, context); if (prepared.status !== "READY") return prepared;
    return { ...prepared, async dispatch() {
      if ((turnZeroOnly && applicationLlmCalls >= 1) || (replayOnly && (!seed || applicationLlmCalls >= 1))) throw new Error("REPLAY_SEED_OR_CALL_CAP");
      if (now() >= deadline) { stop("AUTHORIZATION_EXPIRED"); throw new Error("AUTHORIZATION_EXPIRED"); }
      const reservationId = `call-${applicationLlmCalls + 1}`;
      if(input.boundedPilot){if(!preparedTarget)throw new Error("BOUNDED_TARGET_MISSING");input.boundedPilot.beforeDispatch(preparedTarget,reservationId);}
      const reserved = reserveCampaignCall(input.directory, { runId: input.runId, profile: input.profile, provenanceDigest: input.provenanceDigest,
        reservationId, maximumMicrounits: input.accountingPolicy ? 0 : prepared.maximumCostMicrounits, now: now(), startedAt });
      if (reserved.status !== "RESERVED") throw new Error("CAMPAIGN_CAP");
      if (now() >= deadline) { stop("AUTHORIZATION_EXPIRED"); throw new Error("AUTHORIZATION_EXPIRED"); }
      markCampaignDispatched(input.directory, { runId: input.runId, reservationId, at: now() }); applicationLlmCalls++;
      outboundDigest = null; httpStatus = null; queryDiagnostics=undefined;
      let parsed: Awaited<ReturnType<typeof prepared.dispatch>>;
      try { parsed = await prepared.dispatch(); }
      catch (error) {
        if (turnZeroOnly || input.boundedPilot) {
          finishCampaignCall(input.directory, { runId: input.runId, reservationId, at: now(), observedMicrounits: null });
          if(input.boundedPilot&&preparedTarget){input.boundedPilot.settled(preparedTarget,reservationId,null);input.boundedPilot.outcome(preparedTarget,false);}
          stop("SINGLE_REPLAY_PROVIDER_EXCEPTION");
        }
        throw error;
      }
      // Evaluation requires the canonical full envelope before entering the
      // application. Runtime T5 core/guidance quarantine remains unchanged.
      const result = parsed.status === "SUCCESS" && (isUnreconciledListInterpretation(parsed.interpretation)?!listTransportGuidanceValid(parsed.interpretation):!parsed.interpretation.fullSchemaValid)
        ? { status: "FAILURE" as const, category: "SCHEMA_INVALID" as const, usage: parsed.usage, providerEvidence: parsed.providerEvidence, rawResponseBytes: parsed.rawResponseBytes, canonicalValidationDiagnostics: parsed.canonicalValidationDiagnostics } : parsed;
      finishCampaignCall(input.directory, { runId: input.runId, reservationId, at: now(), observedMicrounits: result.usage?.costMicrounits ?? null,
        ...(input.accountingPolicy && result.usage?.reportedCostUsd !== undefined ? {reportedCostUsd:result.usage.reportedCostUsd}: {}) });
      if(input.boundedPilot&&preparedTarget)input.boundedPilot.settled(preparedTarget,reservationId,result.usage?.costMicrounits??null);
      responses.push({ call: applicationLlmCalls, runId: input.runId, ...healthyTurns[applicationLlmCalls - 1], status: result.status, ...schemaProof, ...(result.canonicalValidationDiagnostics ? { canonicalValidationDiagnostics: result.canonicalValidationDiagnostics } : {}), ...(result.status === "FAILURE" ? { category: result.category, ...(result.failureDiagnostics ? { failureDiagnostics: result.failureDiagnostics } : {}) } : {}),
        ...(selected&&result.status==="SUCCESS"&&!isUnreconciledListInterpretation(result.interpretation)?{semanticState:captureValidationSemanticState(result.interpretation.semantic)}:{}),
        ...(queryDiagnostics?{queryDiagnostics}:{}),
        usage: result.usage ?? null, provider: result.providerEvidence ?? null, requestDigest: outboundDigest, httpStatus, rawResponseBytes: result.rawResponseBytes ?? null });
      // Content-free evidence persists even if application acceptance then fails.
      writeFileSync(join(input.directory, "responses.json"), JSON.stringify(responses), { mode: 0o600 });
      if (result.status !== "SUCCESS") stop("PROVIDER_ADMISSION_FAILED");
      return result;
    } };
  } };
  let score: ReturnType<typeof scoreContextCampaign> | null = null;
  try {
    const observations = await runContextFixtureCampaign(planned, { sourceSha: input.sourceSha, referenceNow: Date.parse("2026-10-05T01:00:00Z"), ...(selected?{contextSeed:selected.contextSeed.state}:{}), ...(replayOnly ? { offlineSeedTurns: 1 } : {}) },
      (context, id, index) => { if (!replayOnly || id !== "R01" || index !== 0) throw new Error("LIVE_FIXTURE_FORBIDDEN"); const value = frozenContextProposal(context, id, index); offlineFixtureDigest = digest(JSON.stringify(value)); return value; }, { gateway, beforeTurn(script,index){activeTarget={fixtureId:script.executionId,turnIndex:selected?.turn??index};}, async onTurn(script, index, observed) {
        const turn = script.turns[index];
        if (turn.model === "INJECTED_REFUSAL") syntheticFaultTurnsCompleted++;
        if (now() >= deadline) stop("TIME_OR_AUTHORIZATION_CAP");
        const single = { ...script, turns: [{ ...turn, actionsAfter: [] }] };
        const proof = scoreContextCampaign([single], [{ id: script.executionId, turns: [observed], actions: [] }]);
        const accepted = proof.passedTurns === 1 && proof.detailPassed === proof.detailPlanned && proof.safetyFailures === 0
          && (turn.model !== "HEALTHY" || observed.actualDispatches === 1);
        if(input.boundedPilot&&turn.model==="HEALTHY"){
          const target={fixtureId:script.executionId,turnIndex:index};
          if(accepted&&(turn.deferResponse||(turn.actionsAfter?.length??0)>0))pendingTargetOutcomes.set(`${script.executionId}:${index}`,target);
          else input.boundedPilot.outcome(target,accepted);
        }
        // Explicit projection of trusted application observations only. Persist
        // each completed turn before an oracle stop can discard aggregate score.
        // No proposal, selected text, receipt, business value or reply enters it.
        applicationEvidence.push({ fixtureId: script.executionId, turnIndex: selected?.turn??index, status: observed.status,
          ...(selected?{oracleState:captureContextOracleState(turn,observed,true)}:{}),
          fullSchemaValid: observed.fullSchemaValid === true, pendingField: observed.pendingField ?? null,
          downstreamDiagnostics: DownstreamTraceSchema.parse(observed.downstreamDiagnostics ?? []),
          listStoreReads: observed.listStoreReads ?? null, mutations: observed.mutations,
          queryRange: observed.queryRange ? { start: observed.queryRange.start, end: observed.queryRange.end } : null,
          oracle: accepted ? "PASS" : "FAIL", oracleDiagnostics:diagnoseContextTurn(turn,observed,true) });
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
      }, async onAction(script,index,actionIndex,actual,releasedTurnIndex) {
        const expected = script.turns[index].actionsAfter?.[actionIndex];
        if (!expected) throw new Error("ACTION_MANIFEST_MISSING");
        const proof = scoreContextAction(expected, actual);
        const targetIndex=expected.kind==="RELEASE_DELAYED"?releasedTurnIndex:index;
        if(targetIndex===undefined)throw new Error("ACTION_RELEASE_TARGET_MISSING");
        const pendingKey=`${script.executionId}:${targetIndex}`,pending=pendingTargetOutcomes.get(pendingKey);
        if(pending&&(!proof.passed||proof.unsafe||actionIndex===script.turns[index].actionsAfter!.length-1)){
          input.boundedPilot!.outcome(pending,proof.passed&&!proof.unsafe);
          pendingTargetOutcomes.delete(pendingKey);
        }
        actionEvidence.push({fixtureId:script.executionId,turnIndex:index,actionIndex,oracle:proof.passed?"PASS":"FAIL",unsafe:proof.unsafe});
        writeFileSync(join(input.directory,"action-evidence.json"),JSON.stringify(actionEvidence),{mode:0o600});
        if (!proof.passed || proof.unsafe) { stop("APPLICATION_ACTION_ORACLE_FAILED"); throw new Error("CAMPAIGN_STOPPED"); }
      } });
    score = replayOnly ? scoreContextCampaign([{ ...planned[0], turns: [planned[0].turns[1]] }], [{ ...observations[0], turns: [observations[0].turns[1]] }]) : scoreContextCampaign(planned, observations);
    // Report suffix measurements as suffix measurements. The composite gate
    // requires every suffix script plus the separately verified historical R01;
    // historical calls are never counted as current-source/current-wire calls.
    if (pilotPrefix) score = { ...score, profile: "PILOT", gate: planned.length === admitted.length - 1
      && score.passedScripts === planned.length && score.healthyFullSchemaValid === score.healthyPlanned
      && score.detailPassed === score.detailPlanned && score.failedMandatory.length === 0 && score.safetyFailures === 0 ? "PASS" : "FAIL" };
    const scopedReplayPassed = replayOnly && score.passedTurns === 1 && score.healthyFullSchemaValid === 1 && score.detailPassed === score.detailPlanned && score.safetyFailures === 0 && score.failedMandatory.length === 0;
    if (turnZeroOnly) stop("SINGLE_REPLAY_TERMINAL");
    else if ((!scopedReplayPassed && score.gate !== "PASS") || !canaryPassed || score.actualDispatches !== httpCount() || applicationLlmCalls !== httpCount()) stop("CAMPAIGN_GATE_FAILED");
    else completeCampaign(input.directory, { runId: input.runId, at: now() });
  } catch { stop("EXECUTION_FAILED"); }
  const status = stopped() ? "STOP" : "PASS";
  const finalLedger = readCampaignLedger(input.directory);
  const result = { status, routeAdmission: canaryPassed ? "PASS" : "STOP", applicationLlmCalls, providerHttpRequests: httpCount(),
    ...(selected ? {contextSeedProof:{version:selected.contextSeed.version,digest:selected.contextSeedDigest,semanticBaselineSha:selected.contextSeed.semanticBaselineSha,fixture:selected.fixture,turn:selected.turn,prerequisiteProviderRequests:0,prerequisiteApplicationLlmDispatches:0}} : {}),
    ...(turnZeroOnly ? { executionKind: selected?"SINGLE_TARGET_VALIDATION":"SINGLE_T11_R01_DIAGNOSTIC_REPLAY", replayTarget: selected?`${selected.fixture}_TURN_${selected.turn}`:"R01_TURN_0", terminal: true, fullPilotGate: "NOT_RUN" } : {}),
    ...(pilotPrefix ? { pilotPrefix, measuredScope: "R02_ONWARD", compositePilotScripts: score ? score.passedScripts + pilotPrefix.scripts : null } : {}),
    ...(replayOnly ? { replayOnly: true, historicalRouteAdmission: "PASS", offlineSeedExecutions, seed, seedFailure, applicationFacts, fullPilotGate: "NOT_RUN" } : {}),
    actualProviderCalls: httpCount(), responses, applicationEvidence, actionEvidence, score, syntheticFaultControlsPlanned: planned.filter(s => s.turns.every(t => t.model === "INJECTED_REFUSAL")).length,
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
export async function runAuthorizedContextCampaign(intent: FutureLiveIntent, readSecret: () => string, pilotPrefix?: ObservableExecution["pilotPrefix"], testTransport?: SemanticTransport) {
  const outcome = await withAuthorizedAccountRootLock(intent.authorizationCapability, () => runLockedAuthorizedContextCampaign(intent, readSecret, pilotPrefix, testTransport));
  if (outcome.kind === "REJECTED") throw outcome.error;
  return outcome.result;
}
async function runLockedAuthorizedContextCampaign(intent: FutureLiveIntent, readSecret: () => string, pilotPrefix?: ObservableExecution["pilotPrefix"], testTransport?: SemanticTransport) {
  let authorization: ReturnType<typeof admitFutureLiveIntent>, key: string, paidExpiresAt: number;
  try {
    authorization = admitFutureLiveIntent({ ...intent, now: Date.now() });
    if (execFileSync("git", ["-C", intent.root, "status", "--porcelain", "--untracked-files=normal"], { encoding: "utf8", env: contextCampaignGitEnvironment }).trim()) throw new Error("SOURCE_NOT_CLEAN");
    if (readCampaignLedger(join(authorization.campaignRoot, intent.profile)).length) throw new Error("CAMPAIGN_ALREADY_STARTED");
    paidExpiresAt = revalidateCampaignPaidAdmission(intent.authorizationCapability);
    const credentialAt = Date.now(), ownerDeadline = Math.min(authorization.expiresAt, authorization.startedAt + (intent.profile === "PILOT" ? 1200000 : 2700000));
    if (credentialAt >= ownerDeadline) throw new Error("AUTHORIZATION_EXPIRED");
    if (credentialAt >= paidExpiresAt) throw new Error("PAID_AUTHORIZATION_EXPIRED");
    key = readSecret();
    if (!key) throw new Error("CREDENTIAL_MISSING");
    if (/[\r\n]/u.test(key)) throw new Error("CREDENTIAL_INVALID");
  } catch (error) { return { kind: "REJECTED" as const, error }; }
  const directory = join(authorization.campaignRoot, intent.profile);
  mkdirSync(authorization.campaignRoot, { recursive: true, mode: 0o700 }); mkdirSync(directory, { recursive: true, mode: 0o700 });
  let transport: SemanticTransport | undefined;
  let requests = 0;
  const deadline = Math.min(paidExpiresAt, authorization.expiresAt, authorization.startedAt + (intent.profile === "PILOT" ? 1200000 : 2700000));
  const result = await executeObservableCampaign({ ...authorization, paidExpiresAt, directory, root: intent.root, pilotPrefix, httpRequestCount: () => requests, transport: (request, options) => {
    if (Date.now() >= deadline || options.signal.aborted) throw new Error("AUTHORIZATION_EXPIRED");
    if (testTransport) { requests++; return testTransport(request, options); }
    transport ??= createContextHttpTransport(key, async (url, init) => {
      if (Date.now() >= deadline || init?.signal?.aborted) throw new Error("AUTHORIZATION_EXPIRED");
      requests++; return fetch(url, init);
    }); return transport(request, options);
  } });
  return { kind: "EXECUTED" as const, result };
}

/** Quarantined predecessor: its disabled admission never accesses credentials.
 * The executable launcher now uses loadTrustedSingleReplay/runSingleReplay. */
export async function runAuthorizedR01Replay(intent: FutureLiveIntent, readSecret: () => string) {
  const authorization = admitR01ReplayIntent(intent);
  if (execFileSync("git", ["-C", intent.root, "status", "--porcelain", "--untracked-files=normal"], { encoding: "utf8", env: contextCampaignGitEnvironment }).trim()) throw new Error("SOURCE_NOT_CLEAN");
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

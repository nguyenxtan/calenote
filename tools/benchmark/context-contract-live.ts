import { createHash } from "node:crypto";
import { readFileSync, openSync, closeSync, writeSync, existsSync, fsyncSync, unlinkSync, readdirSync, realpathSync } from "node:fs";
import { isAbsolute, join, resolve, relative, basename } from "node:path";
import { execFileSync } from "node:child_process";
import { z } from "zod";
import { CONTEXT_PROTOCOL_V3 } from "../../src/modules/conversation/context-contract/protocol";
import type { CampaignProfile } from "./context-contract";
import { admitCanonicalCampaign, type ContextManifest } from "./context-contract";

const files = [
  "src/modules/conversation/context-contract/prompt.ts", "src/modules/conversation/context-contract/contracts.ts",
  "src/modules/conversation/context-contract/context.ts", "src/modules/conversation/context-contract/resolve.ts",
  "src/modules/conversation/context-contract/merge.ts", "src/modules/conversation/context-contract/transition.ts",
  "src/modules/conversation/context-contract/service.ts", "src/modules/conversation/context-contract/guidance.ts",
  "src/modules/conversation/context-contract/admission.ts", "src/modules/conversation/context-contract/confirmation.ts",
  "src/modules/conversation/context-contract/control-proof.ts", "src/modules/conversation/context-contract/decisions.ts",
  "src/modules/conversation/context-contract/evidence.ts", "src/modules/conversation/context-contract/observability.ts",
  "src/modules/conversation/context-contract/preview-control.ts", "src/modules/conversation/context-contract/projection.ts",
  "src/modules/conversation/context-contract/query.ts", "src/modules/conversation/context-contract/responses.ts",
  "src/modules/conversation/context-contract/runtime-store.ts", "src/modules/conversation/context-contract/state.ts",
  "src/modules/conversation/context-contract/store.ts", "src/modules/conversation/context-contract/wire.ts",
  "src/modules/conversation/context-contract/infrastructure/d1/store.ts", "src/modules/conversation/lunar-calendar.ts",
  "src/modules/conversation/lunar-vn-months.json", "src/modules/security/keyring.ts",
  "src/modules/conversation/calendar-presentation.ts", "src/modules/intelligence/infrastructure/openrouter/semantic-gateway.ts",
  "src/modules/reminders/detail-presentation.ts", "src/modules/reminders/details-api-service.ts",
  "src/modules/reminders/infrastructure/d1/api-store.ts", "src/modules/reminders/infrastructure/d1/semantic-query-store.ts",
  "src/modules/semantic/infrastructure/d1/budget-store.ts", "src/testing/sqlite-d1.test-support.ts",
  "migrations/0001_production_mvp.sql", "migrations/0002_onboarding_transition_marker.sql",
  "migrations/0003_source_action_foundation.sql", "migrations/0004_user_preferences.sql",
  "migrations/0005_semantic_context_and_budget.sql", "migrations/0006_semantic_budget_dispatch_fence.sql",
  "migrations/0007_conversation_context_v2.sql", "migrations/0008_finite_reminder_series.sql",
  "migrations/0009_llm_context_contract.sql", "wrangler.jsonc",
  "tools/benchmark/context-contract.ts", "tools/benchmark/context-contract-probe.ts", "tools/benchmark/context-contract-live.ts",
  "tools/benchmark/context-contract-fixtures.ts", "tools/benchmark/context-contract.test.ts", "tools/benchmark/context-contract-live.test.ts",
  "tools/benchmark/run-context-contract-live.mjs", "tools/benchmark/register-conversation-loader.mjs",
  "tools/benchmark/run-context-contract-r01-replay.mjs",
  "tools/benchmark/context-contract-runner.ts", "tools/benchmark/context-contract-runner.test.ts", "vitest.config.ts",
  "tools/calendar/reference-vectors.json", "package.json", "pnpm-lock.yaml",
  "src/modules/conversation/context-contract/benchmark/regressions.json",
  "src/modules/conversation/context-contract/benchmark/development.json", "src/modules/conversation/context-contract/benchmark/heldout.json",
] as const;
const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const pilotAuthorizedMicrounits = 1500000;
const fullAuthorizedMicrounits = 1000000;
const cumulativeAuthorizedMicrounits = pilotAuthorizedMicrounits + fullAuthorizedMicrounits;
export const CONTEXT_ROUTE_ADMISSION = "UNVERIFIED" as const;
export interface PreflightOptions { root: string; readSecret?: () => string; request?: () => unknown; }
function frozenSourcePaths(root: string): string[] {
  const paths = new Set<string>(files);
  const walk = (relative: string, allowed: RegExp) => {
    for (const entry of readdirSync(join(root, relative), { withFileTypes: true })) {
      const path = join(relative, entry.name);
      if (entry.isDirectory()) walk(path, allowed);
      else if (entry.isFile() && allowed.test(entry.name)) paths.add(path);
    }
  };
  walk("src", /\.(?:ts|tsx|js|mjs|json)$/u);
  walk("migrations", /\.sql$/u);
  return [...paths].sort();
}
export function computeContextSourceFreeze(root: string, paths?: readonly string[]) {
  const digests = Object.fromEntries((paths ?? frozenSourcePaths(root)).map(file => [file, hash(readFileSync(join(root, file)))]));
  return { provenanceDigest: hash(JSON.stringify(digests)), digests };
}
export function preflightContextCampaign({ root }: PreflightOptions) {
  const sourceSha = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const { provenanceDigest, digests } = computeContextSourceFreeze(root);
  const manifests = ["regressions", "development", "heldout"].map(name => JSON.parse(readFileSync(join(root, `src/modules/conversation/context-contract/benchmark/${name}.json`), "utf8")) as ContextManifest);
  validateFrozenContextCorpus(root, manifests);
  const corpus: ContextManifest = { version: "context-contract-corpus-1", cases: manifests.flatMap(m => m.cases) };
  const pilot = admitCanonicalCampaign(corpus, "PILOT"), full = admitCanonicalCampaign(corpus, "FULL");
  return { sourceSha, routeAdmission: CONTEXT_ROUTE_ADMISSION, liveEligible: false, networkRequests: 0, secretReads: 0,
    protocolDigest: hash(JSON.stringify(CONTEXT_PROTOCOL_V3)), corpusDigest: hash(JSON.stringify(manifests)),
    pilot: { scripts: pilot.length, turns: pilot.reduce((n, c) => n + c.turns.length, 0), maxCalls: 192, maxMicrounits: pilotAuthorizedMicrounits, maxMs: 1200000 },
    full: { scripts: full.length, turns: full.reduce((n, c) => n + c.turns.length, 0), maxCalls: 480, maxMicrounits: fullAuthorizedMicrounits, maxMs: 2700000 },
    provenanceDigest, digests };
}

/** Immutable acceptance data is never silently reclassified as new held-out
 * evidence. Replacement and reauthorization are a separate approved workflow. */
export function validateFrozenContextCorpus(root: string, manifests: readonly ContextManifest[]) {
  for (const [i, name] of ["regressions", "development", "heldout"].entries()) {
    const original = JSON.parse(execFileSync("git", ["-C", root, "show", `68fac9b2b5e95ee57c53f0ac1f491210e153ed01:src/modules/conversation/context-contract/benchmark/${name}.json`], { encoding: "utf8" }));
    if (hash(JSON.stringify(manifests[i])) !== hash(JSON.stringify(original))) throw new Error(name === "heldout" ? "HELDOUT_REPLACEMENT_REQUIRED" : "FROZEN_ORACLES_CHANGED");
  }
}

export interface FutureLiveIntent { root: string; enableLive: boolean; authorizationPath: string; profile: CampaignProfile; runId: string; now: number; authorizationCapability?: CampaignAuthorization; }
export interface ObservableAuthorization { version: "context-contract-live-2"; method: "OBSERVABLE_CANARY";
  campaignRoot: string; pilotLedgerHash: string | null; sourceSha: string; provenanceDigest: string; profile: CampaignProfile;
  runId: string; approvedAt: number; expiresAt: number; cumulativeAuthorizedMicrounits: number; cumulativeRetainedMicrounits: number; }
/** Source-bound authority admits the method, never claims canary PASS. */
export function admitHistoricalV2IntentReference(input: FutureLiveIntent) {
  if (!input.enableLive) throw new Error("EXPLICIT_ENABLE_REQUIRED");
  if (!isAbsolute(input.authorizationPath) || !Number.isSafeInteger(input.now) || input.now < 0
    || !/^[A-Za-z0-9_-]{1,100}$/u.test(input.runId) || !["PILOT", "FULL"].includes(input.profile)) throw new Error("INVALID_LIVE_INTENT");
  const preflight = preflightContextCampaign({ root: input.root });
  const authorization: unknown = JSON.parse(readFileSync(input.authorizationPath, "utf8"));
  if (!authorization || typeof authorization !== "object" || Array.isArray(authorization)) throw new Error("INVALID_AUTHORIZATION");
  const record = authorization as Record<string, unknown>;
  const keys = ["version", "sourceSha", "provenanceDigest", "profile", "runId", "approvedAt", "expiresAt",
    "cumulativeAuthorizedMicrounits", "cumulativeRetainedMicrounits", "method", "campaignRoot", "pilotLedgerHash"];
  if (Object.keys(record).sort().join("|") !== [...keys].sort().join("|")
    || record.version !== "context-contract-live-2" || record.method !== "OBSERVABLE_CANARY"
    || typeof record.campaignRoot !== "string" || !isAbsolute(record.campaignRoot)
    || (record.pilotLedgerHash !== null && (typeof record.pilotLedgerHash !== "string" || !/^[0-9a-f]{64}$/u.test(record.pilotLedgerHash)))
    || !Number.isSafeInteger(record.approvedAt) || !Number.isSafeInteger(record.expiresAt)
    || (record.approvedAt as number) < 0 || (record.approvedAt as number) > input.now
    || (record.expiresAt as number) <= input.now
    || !Number.isSafeInteger(record.cumulativeAuthorizedMicrounits)
    || (record.cumulativeAuthorizedMicrounits as number) <= 0 || (record.cumulativeAuthorizedMicrounits as number) > cumulativeAuthorizedMicrounits
    || !Number.isSafeInteger(record.cumulativeRetainedMicrounits)
    || (record.cumulativeRetainedMicrounits as number) < 0
    || (record.cumulativeRetainedMicrounits as number) > (record.cumulativeAuthorizedMicrounits as number)) throw new Error("INVALID_AUTHORIZATION");
  if (record.sourceSha !== preflight.sourceSha || record.provenanceDigest !== preflight.provenanceDigest
    || record.profile !== input.profile || record.runId !== input.runId) throw new Error("AUTHORIZATION_MISMATCH");
  if (input.profile === "PILOT") {
    if (record.pilotLedgerHash !== null || record.cumulativeRetainedMicrounits !== 0) throw new Error("INVALID_PILOT_AUTHORITY");
  } else {
    const rows = ledger(join(record.campaignRoot as string, "PILOT")), begin = rows[0], last = rows.at(-1);
    if (!begin || begin.event !== "BEGIN" || begin.executionKind === "R01_REPLAY" || begin.profile !== "PILOT" || begin.sourceSha !== preflight.sourceSha
      || begin.provenanceDigest !== preflight.provenanceDigest || !last || last.event !== "COMPLETE" || last.gate !== "PASS"
      || last.hash !== record.pilotLedgerHash || last.retainedMicrounits !== record.cumulativeRetainedMicrounits) throw new Error("PILOT_PASS_REQUIRED");
    if (begin.executionKind === "R02_CONTINUATION") {
      const directory = join(record.campaignRoot as string, "PILOT");
      const text = readFileSync(join(directory, "pilot-prefix-proof.json"), "utf8");
      if (hash(text) !== begin.pilotPrefixDigest) throw new Error("PILOT_PREFIX_PROOF_CHANGED");
      const proof = JSON.parse(text) as { directory: string; ledgerHash: string; responseDigest: string; applicationDigest: string };
      if (readCampaignLedger(proof.directory).at(-1)?.hash !== proof.ledgerHash
        || hash(readFileSync(join(proof.directory, "responses.json"))) !== proof.responseDigest
        || hash(readFileSync(join(proof.directory, "application-evidence.json"))) !== proof.applicationDigest) throw new Error("PILOT_PREFIX_PROOF_CHANGED");
      const report = JSON.parse(readFileSync(join(directory, "report.json"), "utf8"));
      if (report.status !== "PASS" || report.measuredScope !== "R02_ONWARD" || report.compositePilotScripts !== preflight.pilot.scripts
        || report.score?.gate !== "PASS" || report.score?.plannedScripts !== preflight.pilot.scripts - 1
        || report.score?.passedScripts !== preflight.pilot.scripts - 1
        || report.applicationLlmCalls !== rows.filter(r => r.event === "DISPATCH").length) throw new Error("PILOT_PASS_REQUIRED");
    }
  }
  return record as unknown as ObservableAuthorization;
}

export interface R01ReplayAuthorization extends Omit<ObservableAuthorization, "version" | "pilotLedgerHash"> {
  version: "context-contract-r01-replay-1";
  historicalLedgers: Array<{ directory: string; finalHash: string }>;
}

/** No trusted replay orchestrator is installed for this dormant successor. */
export function admitR01ReplayIntent(input: FutureLiveIntent): R01ReplayAuthorization { void input; throw new Error("AUTHORIZATION_NOT_CONFIGURED"); }
const authorizationBrand: unique symbol = Symbol("CampaignAuthorization");
export interface CampaignAuthorization { readonly [authorizationBrand]: true; }
const bindingSchema = z.strictObject({ directory: z.string().min(1).max(4096), finalHash: z.string().regex(/^[a-f0-9]{64}$/u) });
const ownerSchema = z.strictObject({ version: z.literal("context-contract-live-3"), method: z.literal("OBSERVABLE_CANARY"),
  authorizationId: z.string().regex(/^[A-Za-z0-9_-]{1,160}$/u), account: z.enum(["PILOT", "FULL"]),
  sourceSha: z.string().regex(/^[a-f0-9]{40}$/u), provenanceDigest: z.string().regex(/^[a-f0-9]{64}$/u),
  protocolDigest: z.string().regex(/^[a-f0-9]{64}$/u), corpusDigest: z.string().regex(/^[a-f0-9]{64}$/u),
  runId: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/u), approvedAt: z.number().int().nonnegative(), expiresAt: z.number().int().nonnegative(),
  startedAt: z.number().int().nonnegative(), priorLedgers: z.array(bindingSchema).max(1024),
  pilotLedger: bindingSchema.extend({ reportSha256: z.string().regex(/^[a-f0-9]{64}$/u) }).nullable() });
type CampaignGrant = { record: z.infer<typeof ownerSchema>; sha256: string; root: string; directory: string };
const campaignGrants = new WeakMap<object, CampaignGrant>();
const activeCampaignGrants = new Map<string, CampaignGrant>();
function accountInventory(root: string, excluded: string): string[] {
  const result: string[] = [];
  function visit(path: string) {
    if (path !== excluded && existsSync(join(path, "campaign.jsonl"))) result.push(realpathSync(path));
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new Error("PRIOR_LEDGER_ALIAS");
      if (entry.isDirectory()) visit(join(path, entry.name));
    }
  }
  visit(root); return result.sort();
}
function campaignInventory(grant: CampaignGrant) {
  const paths = grant.record.priorLedgers.map(binding => {
    const path = realpathSync(binding.directory), rel = relative(grant.root, path);
    if (path !== binding.directory || rel.startsWith("..") || isAbsolute(rel) || path === grant.directory) throw new Error("PRIOR_LEDGER_ALIAS");
    return path;
  });
  if (new Set(paths).size !== paths.length) throw new Error("PRIOR_LEDGER_ALIAS");
  if (JSON.stringify([...paths].sort()) !== JSON.stringify(accountInventory(grant.root, grant.directory))) throw new Error("PRIOR_LEDGER_INVENTORY");
  let retained = 0n, calls = 0, unknown = 0;
  for (const binding of grant.record.priorLedgers) {
    const rows = ledger(binding.directory), begin = rows[0];
    if (begin?.event !== "BEGIN" || begin.profile !== grant.record.account || rows.at(-1)?.hash !== binding.finalHash) throw new Error("PRIOR_LEDGER_BINDING");
    const state = validateCampaign(rows);
    retained += state.retained;
    calls = safeCampaignSum(calls, state.reserves.size);
    unknown = safeCampaignSum(unknown, state.unknown);
  }
  const cap = grant.record.account === "PILOT" ? pilotAuthorizedMicrounits : fullAuthorizedMicrounits;
  if (retained > BigInt(cap) || calls > (grant.record.account === "PILOT" ? 192 : 480)) throw new Error("HISTORICAL_ACCOUNTING_CAP");
  // Conversion is only after the exact account ceiling bounds the result.
  return { retained: Number(retained), calls, unknown };
}
function validateHistoricalCampaign(rows: readonly Stored[], account: CampaignProfile): void {
  if (validateCampaign(rows).begin?.profile !== account) throw new Error("PRIOR_LEDGER_BINDING");
}
function validateTargetCampaign(grant: CampaignGrant, totals: ReturnType<typeof campaignInventory>, rows: readonly Stored[]) {
  const state = validateCampaign(rows), begin = state.begin, record = grant.record;
  if (begin && (begin.authorizationSha256 !== grant.sha256 || begin.runId !== record.runId || begin.profile !== record.account
    || begin.sourceSha !== record.sourceSha || begin.provenanceDigest !== record.provenanceDigest || begin.startedAt !== record.startedAt
    || begin.expiresAt !== Math.min(record.expiresAt, record.startedAt + (record.account === "PILOT" ? 1200000 : 2700000))
    || begin.cumulativeAuthorizedMicrounits !== (record.account === "PILOT" ? pilotAuthorizedMicrounits : fullAuthorizedMicrounits)
    || begin.cumulativeRetainedMicrounits !== totals.retained || begin.historicalCalls !== totals.calls
    || begin.historicalUnknownReservations !== totals.unknown || begin.observableAdmission !== true || begin.executionKind !== undefined
    || (begin.method !== undefined && begin.method !== record.method) || (begin.version !== undefined && begin.version !== record.version)
    || (begin.approvedAt !== undefined && begin.approvedAt !== record.approvedAt)
    || (begin.campaignRoot !== undefined && begin.campaignRoot !== resolve(grant.directory, "..")))) throw new Error("OWNER_AUTHORIZATION_MISMATCH");
  return state;
}
/** Approval provenance and complete account namespace come from trusted
 * orchestration, never from a raw record, CLI, env override or self-hash. */
export function createCampaignAuthorizationLoader(trusted: { reviewedOwnerRecordSha256: string; accountRoot: string }) {
  if (!/^[a-f0-9]{64}$/u.test(trusted.reviewedOwnerRecordSha256)) throw new Error("AUTHORIZATION_NOT_CONFIGURED");
  const root = realpathSync(trusted.accountRoot), pin = trusted.reviewedOwnerRecordSha256;
  return { load(raw: unknown, targetDirectory: string): CampaignAuthorization {
    const record = ownerSchema.parse(raw);
    if (hash(JSON.stringify(raw)) !== pin) throw new Error("OWNER_AUTHORIZATION_MISMATCH");
    const directory = realpathSync(targetDirectory), rel = relative(root, directory);
    if (directory !== targetDirectory || rel.startsWith("..") || isAbsolute(rel) || basename(directory) !== record.account) throw new Error("PRIOR_LEDGER_ALIAS");
    const grant = { record, sha256: pin, root, directory };
    validateTargetCampaign(grant, campaignInventory(grant), ledger(directory));
    const capability = Object.freeze({ [authorizationBrand]: true as const }); campaignGrants.set(capability, grant); return capability;
  } };
}
export function admitFutureLiveIntent(input: FutureLiveIntent) {
  if (!input.enableLive) throw new Error("EXPLICIT_ENABLE_REQUIRED");
  const grant = input.authorizationCapability && campaignGrants.get(input.authorizationCapability);
  if (!grant) throw new Error("AUTHORIZATION_NOT_CONFIGURED");
  const current = preflightContextCampaign({ root: input.root }), record = grant.record;
  if (hash(readFileSync(input.authorizationPath)) !== grant.sha256 || record.account !== input.profile || record.runId !== input.runId
    || record.sourceSha !== current.sourceSha || record.provenanceDigest !== current.provenanceDigest
    || record.protocolDigest !== current.protocolDigest || record.corpusDigest !== current.corpusDigest
    || !Number.isSafeInteger(input.now) || record.approvedAt > input.now || record.startedAt < record.approvedAt || record.startedAt > input.now
    || input.now >= Math.min(record.expiresAt, record.startedAt + (record.account === "PILOT" ? 1200000 : 2700000))) throw new Error("AUTHORIZATION_MISMATCH");
  const totals = campaignInventory(grant);
  const target = validateTargetCampaign(grant, totals, ledger(grant.directory));
  if (target.stopped || target.completed) throw new Error("STOPPED_CAMPAIGN");
  if (record.account === "PILOT" && record.pilotLedger !== null) throw new Error("INVALID_PILOT_AUTHORITY");
  if (record.account === "FULL") {
    const binding = record.pilotLedger, rows = binding && ledger(binding.directory), begin = rows?.[0], last = rows?.at(-1);
    if (!binding || begin?.event !== "BEGIN" || begin.profile !== "PILOT" || begin.sourceSha !== current.sourceSha
      || begin.provenanceDigest !== current.provenanceDigest || begin.executionKind || last?.event !== "COMPLETE" || last.gate !== "PASS"
      || last.hash !== binding.finalHash) throw new Error("PILOT_PASS_REQUIRED");
    if (binding.directory !== realpathSync(binding.directory)) throw new Error("PRIOR_LEDGER_ALIAS");
    validateHistoricalCampaign(rows!, "PILOT");
    const text = readFileSync(join(binding.directory, "report.json"), "utf8");
    if (hash(text) !== binding.reportSha256) throw new Error("PILOT_PASS_REQUIRED");
    const report = JSON.parse(text), score = report.score;
    const dispatches = rows!.filter(row => row.event === "DISPATCH").length;
    if (report.status !== "PASS" || report.routeAdmission !== "PASS" || report.measuredScope || report.replayOnly
      || score?.gate !== "PASS" || score.plannedScripts !== current.pilot.scripts || score.passedScripts !== current.pilot.scripts
      || score.plannedTurns !== current.pilot.turns || score.passedTurns !== current.pilot.turns || score.safetyFailures !== 0
      || score.detailPassed !== score.detailPlanned || score.healthyFullSchemaValid !== score.healthyPlanned
      || score.actualDispatches !== dispatches || report.applicationLlmCalls !== dispatches || report.providerHttpRequests !== dispatches
      || !Array.isArray(report.applicationEvidence) || report.applicationEvidence.length !== current.pilot.turns
      || report.applicationEvidence.some((row: { oracle: string }) => row.oracle !== "PASS")) throw new Error("PILOT_PASS_REQUIRED");
  }
  activeCampaignGrants.set(grant.directory, grant);
  return { version: "context-contract-live-3" as const, method: record.method, campaignRoot: resolve(grant.directory, ".."),
    sourceSha: record.sourceSha, provenanceDigest: record.provenanceDigest, profile: record.account, runId: record.runId, approvedAt: record.approvedAt,
    startedAt: record.startedAt, expiresAt: record.expiresAt, cumulativeAuthorizedMicrounits: record.account === "PILOT" ? pilotAuthorizedMicrounits : fullAuthorizedMicrounits,
    cumulativeRetainedMicrounits: totals.retained, historicalCalls: totals.calls, historicalUnknownReservations: totals.unknown, authorizationSha256: grant.sha256 };
}
/** Exact historical accounting is bound by durable ledger hashes; the normal
 * PILOT/FULL authorization contract is deliberately unchanged. */
export function admitHistoricalR01ReplayIntentReference(input: FutureLiveIntent): R01ReplayAuthorization {
  if (!input.enableLive || input.profile !== "PILOT" || !isAbsolute(input.authorizationPath)
    || !/^[A-Za-z0-9_-]{1,100}$/u.test(input.runId) || !Number.isSafeInteger(input.now) || input.now < 0) throw new Error("INVALID_REPLAY_INTENT");
  const preflight = preflightContextCampaign({ root: input.root });
  const record = JSON.parse(readFileSync(input.authorizationPath, "utf8")) as R01ReplayAuthorization;
  const keys = ["version", "method", "campaignRoot", "sourceSha", "provenanceDigest", "profile", "runId", "approvedAt", "expiresAt", "cumulativeAuthorizedMicrounits", "cumulativeRetainedMicrounits", "historicalLedgers"];
  if (!record || typeof record !== "object" || Array.isArray(record) || Object.keys(record).sort().join("|") !== keys.sort().join("|")
    || record.version !== "context-contract-r01-replay-1" || record.method !== "OBSERVABLE_CANARY" || record.profile !== "PILOT"
    || typeof record.campaignRoot !== "string" || !isAbsolute(record.campaignRoot) || record.sourceSha !== preflight.sourceSha
    || record.provenanceDigest !== preflight.provenanceDigest || record.runId !== input.runId
    || !Number.isSafeInteger(record.approvedAt) || record.approvedAt < 0 || record.approvedAt > input.now
    || !Number.isSafeInteger(record.expiresAt) || record.expiresAt <= input.now
    || record.cumulativeAuthorizedMicrounits !== 650000 || record.cumulativeRetainedMicrounits !== 528605
    || !Array.isArray(record.historicalLedgers) || record.historicalLedgers.length < 1 || record.historicalLedgers.length > 10) throw new Error("INVALID_REPLAY_AUTHORIZATION");
  let count = 0, retained = 0, unknown = 0, historicalRoutePassed = false;
  const seen = new Set<string>();
  for (const proof of record.historicalLedgers) {
    if (!proof || Object.keys(proof).sort().join("|") !== "directory|finalHash" || typeof proof.directory !== "string" || !isAbsolute(proof.directory)
      || typeof proof.finalHash !== "string" || !/^[0-9a-f]{64}$/u.test(proof.finalHash) || seen.has(resolve(proof.directory))) throw new Error("INVALID_HISTORICAL_PROOF");
    seen.add(resolve(proof.directory));
    const rows = readCampaignLedger(proof.directory), final = rows.at(-1), begin = rows[0];
    if (!begin || begin.event !== "BEGIN" || begin.profile !== "PILOT" || begin.executionKind === "R01_REPLAY"
      || !final || final.hash !== proof.finalHash || !["STOP", "COMPLETE", "FINISH"].includes(final.event)) throw new Error("HISTORICAL_LEDGER_MISMATCH");
    historicalRoutePassed ||= rows.some(row => row.event === "CANARY_PASS");
    for (const dispatched of rows.filter(row => row.event === "DISPATCH")) {
      const reserved = rows.find(row => row.event === "RESERVE" && row.reservationId === dispatched.reservationId);
      const finished = rows.find(row => row.event === "FINISH" && row.reservationId === dispatched.reservationId);
      if (!reserved || reserved.event !== "RESERVE") throw new Error("HISTORICAL_RESERVATION_MISSING");
      const cost = finished?.event === "FINISH" ? finished.observedMicrounits : null;
      count++; retained += cost ?? reserved.maximumMicrounits; if (cost === null) unknown += reserved.maximumMicrounits;
    }
  }
  if (count !== 10 || retained !== 528605 || unknown !== 527360 || !historicalRoutePassed) throw new Error("HISTORICAL_ACCOUNTING_MISMATCH");
  return record;
}

type Begin = { event: "BEGIN"; runId: string; sourceSha: string; profile: CampaignProfile; provenanceDigest: string;
  version?: "context-contract-live-3"; method?: "OBSERVABLE_CANARY"; campaignRoot?: string; approvedAt?: number;
  executionKind?: "R01_REPLAY" | "R02_CONTINUATION"; pilotPrefixDigest?: string;
  authorizationSha256?: string; historicalCalls?: number; historicalUnknownReservations?: number;
  cumulativeAuthorizedMicrounits: number; cumulativeRetainedMicrounits: number; startedAt: number; observableAdmission?: boolean; expiresAt?: number };
type Reserve = { event: "RESERVE"; runId: string; profile: CampaignProfile; provenanceDigest: string;
  reservationId: string; maximumMicrounits: number; at: number };
type Dispatch = { event: "DISPATCH"; runId: string; reservationId: string; at: number };
type Finish = { event: "FINISH"; runId: string; reservationId: string; at: number; observedMicrounits?: number | null };
type Stop = { event: "STOP"; runId: string; at: number; reason: string };
type Canary = { event: "CANARY_PASS"; runId: string; at: number };
type Complete = { event: "COMPLETE"; runId: string; at: number; gate: "PASS"; retainedMicrounits: number };
export type CampaignEvent = Begin | Reserve | Dispatch | Finish | Stop | Canary | Complete;
type Stored = CampaignEvent & { sequence: number; previousHash: string; hash: string };

function safeCampaignSum(a: number, b: number): number {
  const result = a + b;
  if (!Number.isSafeInteger(result) || result < 0) throw new Error("PRIOR_LEDGER_BINDING: ACCOUNTING_OVERFLOW");
  return result;
}
/** Hash integrity authenticates bytes, not accounting. All readers and writers
 * share this ordered model; local holds exclude inherited BEGIN debt. */
function validateCampaign(rows: readonly Stored[]) {
  const fail: () => never = () => { throw new Error("PRIOR_LEDGER_BINDING: CAMPAIGN_GRAMMAR"); };
  const integer = (v: unknown) => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
  const id = (v: unknown) => typeof v === "string" && /^[A-Za-z0-9_-]{1,100}$/u.test(v);
  const digest = (v: unknown, length: number) => typeof v === "string" && new RegExp(`^[a-f0-9]{${length}}$`, "u").test(v);
  const closed = (row: object, fields: string[]) => Object.keys(row).every(key => [...fields, "sequence", "previousHash", "hash"].includes(key));
  const begin = rows[0];
  const reserves = new Map<string, Reserve>(), dispatches = new Map<string, Dispatch>(), finishes = new Map<string, Finish>();
  let retained = 0n, unknown = 0, stopped = false, explicitStop = false, completed = false, canary = false;
  if (!begin) return { begin: undefined, reserves, dispatches, finishes, retained, unknown, stopped, completed };
  if (begin.event !== "BEGIN" || !closed(begin, ["event", "runId", "sourceSha", "profile", "provenanceDigest", "executionKind", "pilotPrefixDigest",
    "authorizationSha256", "historicalCalls", "historicalUnknownReservations", "cumulativeAuthorizedMicrounits", "cumulativeRetainedMicrounits",
    "startedAt", "observableAdmission", "expiresAt", "version", "method", "campaignRoot", "approvedAt"])
    || !id(begin.runId) || !["PILOT", "FULL"].includes(begin.profile) || !digest(begin.sourceSha, 40) || !digest(begin.provenanceDigest, 64)
    || !integer(begin.startedAt) || !integer(begin.cumulativeAuthorizedMicrounits) || begin.cumulativeAuthorizedMicrounits <= 0
    || begin.cumulativeAuthorizedMicrounits > cumulativeAuthorizedMicrounits || !integer(begin.cumulativeRetainedMicrounits)
    || begin.cumulativeRetainedMicrounits > begin.cumulativeAuthorizedMicrounits
    || (begin.observableAdmission !== undefined && typeof begin.observableAdmission !== "boolean")
    || (begin.expiresAt !== undefined && !integer(begin.expiresAt))
    || (begin.executionKind !== undefined && !["R01_REPLAY", "R02_CONTINUATION"].includes(begin.executionKind))
    || (begin.executionKind === "R02_CONTINUATION" ? !digest(begin.pilotPrefixDigest, 64) : begin.pilotPrefixDigest !== undefined)
    || (begin.authorizationSha256 !== undefined && (!digest(begin.authorizationSha256, 64) || !integer(begin.historicalCalls)
      || !integer(begin.historicalUnknownReservations) || begin.historicalUnknownReservations! > begin.historicalCalls!))
    || (begin.authorizationSha256 === undefined && (begin.historicalCalls !== undefined || begin.historicalUnknownReservations !== undefined))
    || (begin.version !== undefined && begin.version !== "context-contract-live-3")
    || (begin.method !== undefined && begin.method !== "OBSERVABLE_CANARY")
    || (begin.campaignRoot !== undefined && (typeof begin.campaignRoot !== "string" || !isAbsolute(begin.campaignRoot)))
    || (begin.approvedAt !== undefined && (!integer(begin.approvedAt) || begin.approvedAt > begin.startedAt))) return fail();
  const cap = begin.profile === "PILOT" ? { cost: pilotAuthorizedMicrounits, calls: 192, ms: 1200000 } : { cost: fullAuthorizedMicrounits, calls: 480, ms: 2700000 };
  const deadline = Math.min(begin.expiresAt ?? Number.MAX_SAFE_INTEGER, safeCampaignSum(begin.startedAt, cap.ms));
  let lastAt = begin.startedAt;
  for (const row of rows.slice(1)) {
    if (row.event === "BEGIN" || row.runId !== begin.runId || completed || !integer(row.at) || row.at < lastAt) return fail();
    lastAt = row.at;
    if (row.event === "RESERVE") {
      if (!closed(row, ["event", "runId", "profile", "provenanceDigest", "reservationId", "maximumMicrounits", "at"])
        || stopped || row.at >= deadline || row.profile !== begin.profile || row.provenanceDigest !== begin.provenanceDigest
        || !id(row.reservationId) || reserves.has(row.reservationId) || !integer(row.maximumMicrounits) || row.maximumMicrounits <= 0
        || safeCampaignSum(begin.historicalCalls ?? 0, reserves.size) >= (begin.executionKind === "R01_REPLAY" ? 1 : cap.calls)
        || retained + BigInt(row.maximumMicrounits) > BigInt(cap.cost)
        || BigInt(begin.cumulativeRetainedMicrounits) + retained + BigInt(row.maximumMicrounits) > BigInt(begin.cumulativeAuthorizedMicrounits)
        || (begin.observableAdmission && dispatches.size > 0 && (!canary || dispatches.size !== finishes.size))) return fail();
      reserves.set(row.reservationId, row); retained += BigInt(row.maximumMicrounits); unknown++;
    } else if (row.event === "DISPATCH") {
      const reserve = reserves.get(row.reservationId);
      if (!closed(row, ["event", "runId", "reservationId", "at"]) || stopped || row.at >= deadline || !reserve
        || dispatches.has(row.reservationId) || (begin.observableAdmission && dispatches.size > 0 && (!canary || dispatches.size !== finishes.size))) return fail();
      dispatches.set(row.reservationId, row);
    } else if (row.event === "FINISH") {
      const reserve = reserves.get(row.reservationId);
      if (!closed(row, ["event", "runId", "reservationId", "at", "observedMicrounits"]) || !reserve || !dispatches.has(row.reservationId)
        || finishes.has(row.reservationId) || (row.observedMicrounits != null && !integer(row.observedMicrounits))) return fail();
      finishes.set(row.reservationId, row);
      if (row.observedMicrounits != null) {
        retained = retained - BigInt(reserve.maximumMicrounits) + BigInt(row.observedMicrounits); unknown--;
        if (row.observedMicrounits > reserve.maximumMicrounits || retained > BigInt(cap.cost)
          || BigInt(begin.cumulativeRetainedMicrounits) + retained > BigInt(begin.cumulativeAuthorizedMicrounits)) stopped = true;
      } else if (begin.observableAdmission) stopped = true;
    } else if (row.event === "STOP") {
      if (!closed(row, ["event", "runId", "at", "reason"]) || explicitStop || typeof row.reason !== "string" || !/^[A-Z0-9_]{1,160}$/u.test(row.reason)) return fail();
      explicitStop = true; stopped = true;
    } else if (row.event === "CANARY_PASS") {
      if (!closed(row, ["event", "runId", "at"]) || !begin.observableAdmission || stopped || canary || dispatches.size !== 1
        || finishes.size !== 1 || [...finishes.values()][0].observedMicrounits == null) return fail();
      canary = true;
    } else if (row.event === "COMPLETE") {
      if (!closed(row, ["event", "runId", "at", "gate", "retainedMicrounits"]) || stopped || !canary || row.gate !== "PASS"
        || reserves.size !== dispatches.size || dispatches.size !== finishes.size || unknown !== 0
        || !integer(row.retainedMicrounits) || BigInt(row.retainedMicrounits) !== retained) return fail();
      completed = true;
    } else return fail();
  }
  return { begin, reserves, dispatches, finishes, retained, unknown, stopped, completed };
}

function ledger(directory: string): Stored[] {
  const path = join(resolve(directory), "campaign.jsonl");
  if (!existsSync(path)) return [];
  const body = readFileSync(path, "utf8");
  if (body && !body.endsWith("\n")) throw new Error("LEDGER_TRUNCATED");
  const rows = body.trim() ? body.trim().split("\n").map(line => JSON.parse(line) as Stored) : [];
  let previousHash = "0".repeat(64);
  for (const [index, row] of rows.entries()) {
    const { hash: actual, ...withoutHash } = row;
    if (row.sequence !== index + 1 || row.previousHash !== previousHash || hash(JSON.stringify(withoutHash)) !== actual) throw new Error("LEDGER_PROVENANCE_CORRUPT");
    previousHash = actual;
  }
  validateCampaign(rows);
  return rows;
}
export function readCampaignLedger(directory: string): readonly Stored[] { return ledger(directory); }
function withLedgerLock<T>(directory: string, operation: () => T): T {
  const path = join(resolve(directory), "campaign.lock");
  const descriptor = openSync(path, "wx", 0o600);
  try {
    writeSync(descriptor, `${process.pid}\n`);
    fsyncSync(descriptor);
    return operation();
  } finally {
    closeSync(descriptor);
    unlinkSync(path);
  }
}
function appendUnlocked(directory: string, event: CampaignEvent): Stored {
  const rows = ledger(directory), begin = rows[0];
  if (begin?.event === "BEGIN" && begin.authorizationSha256 !== undefined) {
    const grant = activeCampaignGrants.get(realpathSync(directory));
    if (!grant) throw new Error("AUTHORIZATION_NOT_CONFIGURED");
    validateTargetCampaign(grant, campaignInventory(grant), rows);
  }
  if (event.event === "BEGIN") {
    if (rows.length) throw new Error("CAMPAIGN_ALREADY_STARTED");
    if (event.authorizationSha256 !== undefined) {
      const grant = activeCampaignGrants.get(realpathSync(directory));
      if (!grant || grant.sha256 !== event.authorizationSha256) throw new Error("AUTHORIZATION_NOT_CONFIGURED");
      const totals = campaignInventory(grant);
      if (event.cumulativeRetainedMicrounits !== totals.retained || event.historicalCalls !== totals.calls || event.historicalUnknownReservations !== totals.unknown
        || event.sourceSha !== grant.record.sourceSha || event.provenanceDigest !== grant.record.provenanceDigest || event.runId !== grant.record.runId
        || event.profile !== grant.record.account || event.startedAt !== grant.record.startedAt
        || event.expiresAt !== Math.min(grant.record.expiresAt, grant.record.startedAt + (event.profile === "PILOT" ? 1200000 : 2700000))
        || event.cumulativeAuthorizedMicrounits !== (event.profile === "PILOT" ? pilotAuthorizedMicrounits : fullAuthorizedMicrounits)) throw new Error("OWNER_AUTHORIZATION_MISMATCH");
    }
    if (!/^[0-9a-f]{40}$/u.test(event.sourceSha) || !/^[0-9a-f]{64}$/u.test(event.provenanceDigest)
      || !Number.isSafeInteger(event.cumulativeAuthorizedMicrounits) || event.cumulativeAuthorizedMicrounits <= 0
      || event.cumulativeAuthorizedMicrounits > cumulativeAuthorizedMicrounits
      || !Number.isSafeInteger(event.cumulativeRetainedMicrounits) || event.cumulativeRetainedMicrounits < 0
      || event.cumulativeRetainedMicrounits > event.cumulativeAuthorizedMicrounits
      || !Number.isSafeInteger(event.startedAt) || event.startedAt < 0
      || (event.expiresAt !== undefined && (!Number.isSafeInteger(event.expiresAt) || event.expiresAt < 0))) throw new Error("INVALID_CUMULATIVE_AUTHORITY");
  } else if (!begin || begin.event !== "BEGIN" || event.runId !== begin.runId
    || rows.some(r => r.event === "COMPLETE") || (event.event !== "FINISH" && rows.some(r => r.event === "STOP"))) throw new Error("CAMPAIGN_STATE");
  const previousHash = rows.at(-1)?.hash ?? "0".repeat(64);
  const withoutHash = { ...event, sequence: rows.length + 1, previousHash };
  const row: Stored = { ...withoutHash, hash: hash(JSON.stringify(withoutHash)) };
  validateCampaign([...rows, row]);
  if (event.event === "BEGIN" && event.authorizationSha256 !== undefined) {
    const grant = activeCampaignGrants.get(realpathSync(directory))!;
    validateTargetCampaign(grant, campaignInventory(grant), [row]);
  }
  const descriptor = openSync(join(resolve(directory), "campaign.jsonl"), "a", 0o600);
  try { writeSync(descriptor, JSON.stringify(row) + "\n"); fsyncSync(descriptor); } finally { closeSync(descriptor); }
  return row;
}
export function appendCampaignEvent(directory: string, event: CampaignEvent): Stored {
  if (event.event !== "BEGIN" && event.event !== "STOP") throw new Error("USE_GUARDED_CAMPAIGN_TRANSITION");
  return withLedgerLock(directory, () => appendUnlocked(directory, event));
}
export function reserveCampaignCall(directory: string, input: { runId: string; profile: CampaignProfile; provenanceDigest: string;
  reservationId: string; maximumMicrounits: number; now: number; startedAt: number }) {
  return withLedgerLock(directory, () => reserveUnlocked(directory, input));
}
function reserveUnlocked(directory: string, input: { runId: string; profile: CampaignProfile; provenanceDigest: string;
  reservationId: string; maximumMicrounits: number; now: number; startedAt: number }) {
  const rows = ledger(directory), begin = rows[0];
  const state = validateCampaign(rows);
  if (!begin || begin.event !== "BEGIN" || begin.runId !== input.runId || begin.profile !== input.profile) throw new Error("CROSS_RESUME");
  if (begin.authorizationSha256 !== undefined) {
    const grant = activeCampaignGrants.get(realpathSync(directory));
    if (!grant || grant.sha256 !== begin.authorizationSha256) throw new Error("AUTHORIZATION_NOT_CONFIGURED");
    const totals = campaignInventory(grant);
    if (totals.retained !== begin.cumulativeRetainedMicrounits || totals.calls !== begin.historicalCalls || totals.unknown !== begin.historicalUnknownReservations) throw new Error("PRIOR_LEDGER_BINDING");
    validateTargetCampaign(grant, totals, rows);
  }
  if (begin.provenanceDigest !== input.provenanceDigest) throw new Error("PROVENANCE_CHANGED");
  if (begin.startedAt !== input.startedAt) throw new Error("CLOCK_ORIGIN_CHANGED");
  if (state.stopped || state.completed || !Number.isSafeInteger(input.now) || input.now < input.startedAt) throw new Error("STOPPED_OR_INVALID_CLOCK");
  if (begin.expiresAt !== undefined && input.now >= begin.expiresAt) {
    appendUnlocked(directory, { event: "STOP", runId: input.runId, at: input.now, reason: "AUTHORIZATION_EXPIRED" });
    throw new Error("AUTHORIZATION_EXPIRED");
  }
  const cap = input.profile === "PILOT" ? { calls: 192, cost: pilotAuthorizedMicrounits, ms: 1200000 } : { calls: 480, cost: fullAuthorizedMicrounits, ms: 2700000 };
  const reservations = rows.filter((r): r is Stored & Reserve => r.event === "RESERVE");
  if (begin.observableAdmission && rows.some(r => r.event === "DISPATCH") && !rows.some(r => r.event === "CANARY_PASS")) {
    appendUnlocked(directory, { event: "STOP", runId: input.runId, at: input.now, reason: "CANARY_UNSETTLED" });
    throw new Error("CANARY_UNSETTLED");
  }
  if (begin.observableAdmission && rows.some(r => r.event === "DISPATCH" && !rows.some(f => f.event === "FINISH" && f.reservationId === r.reservationId))) {
    appendUnlocked(directory, { event: "STOP", runId: input.runId, at: input.now, reason: "UNKNOWN_DISPATCH_OUTCOME" });
    throw new Error("UNKNOWN_DISPATCH_OUTCOME");
  }
  if (!/^[A-Za-z0-9_-]{1,100}$/u.test(input.reservationId) || reservations.some(r => r.reservationId === input.reservationId)
    || !Number.isSafeInteger(input.maximumMicrounits) || input.maximumMicrounits <= 0) throw new Error("INVALID_RESERVATION");
  if (input.now - input.startedAt >= cap.ms || (begin.historicalCalls ?? 0) + reservations.length >= (begin.executionKind === "R01_REPLAY" ? 1 : cap.calls)) {
    appendUnlocked(directory, { event: "STOP", runId: input.runId, at: input.now, reason: "TIME_OR_CALL_CAP" });
    return { status: "STOPPED", reason: "TIME_OR_CALL_CAP" } as const;
  }
  const reserved = state.retained;
  if (reserved + BigInt(input.maximumMicrounits) > BigInt(cap.cost)
    || BigInt(begin.cumulativeRetainedMicrounits) + reserved + BigInt(input.maximumMicrounits) > BigInt(begin.cumulativeAuthorizedMicrounits)) {
    appendUnlocked(directory, { event: "STOP", runId: input.runId, at: input.now, reason: "COST_CAP" });
    return { status: "STOPPED", reason: "COST_CAP" } as const;
  }
  appendUnlocked(directory, { event: "RESERVE", runId: input.runId, profile: input.profile, provenanceDigest: input.provenanceDigest,
    reservationId: input.reservationId, maximumMicrounits: input.maximumMicrounits, at: input.now });
  return { status: "RESERVED" } as const;
}
export function markCampaignDispatched(directory: string, input: { runId: string; reservationId: string; at: number }) {
  return withLedgerLock(directory, () => markDispatchedUnlocked(directory, input));
}
function markDispatchedUnlocked(directory: string, input: { runId: string; reservationId: string; at: number }) {
  const rows = ledger(directory);
  if (validateCampaign(rows).stopped) throw new Error("STOPPED_CAMPAIGN");
  const begin = rows[0] as Begin | undefined;
  const reservation = rows.find((r): r is Stored & Reserve => r.event === "RESERVE" && r.runId === input.runId && r.reservationId === input.reservationId);
  if (!reservation
    || rows.some(r => r.event === "DISPATCH" && r.reservationId === input.reservationId)) throw new Error("MISSING_OR_DUPLICATE_RESERVATION");
  const maximumMs = begin?.profile === "PILOT" ? 1200000 : 2700000;
  if (!begin || begin.event !== "BEGIN" || !Number.isSafeInteger(input.at) || input.at < reservation.at
    || input.at - begin.startedAt >= maximumMs || (begin.expiresAt !== undefined && input.at >= begin.expiresAt)) throw new Error("DISPATCH_DEADLINE");
  return appendUnlocked(directory, { event: "DISPATCH", ...input });
}
export function finishCampaignCall(directory: string, input: { runId: string; reservationId: string; at: number; observedMicrounits: number | null }) {
  return withLedgerLock(directory, () => finishUnlocked(directory, input));
}
function finishUnlocked(directory: string, input: { runId: string; reservationId: string; at: number; observedMicrounits: number | null }) {
  const rows = ledger(directory);
  if (!rows.some(r => r.event === "DISPATCH" && r.runId === input.runId && r.reservationId === input.reservationId)
    || rows.some(r => r.event === "FINISH" && r.reservationId === input.reservationId)) throw new Error("MISSING_OR_DUPLICATE_DISPATCH");
  const maximum = (rows.find(r => r.event === "RESERVE" && r.reservationId === input.reservationId) as Reserve).maximumMicrounits;
  if (input.observedMicrounits !== null && (!Number.isSafeInteger(input.observedMicrounits) || input.observedMicrounits < 0)) throw new Error("INVALID_USAGE");
  const dispatch = rows.find((r): r is Stored & Dispatch => r.event === "DISPATCH" && r.reservationId === input.reservationId)!;
  if (!Number.isSafeInteger(input.at) || input.at < dispatch.at) throw new Error("INVALID_FINISH_CLOCK");
  const finished = appendUnlocked(directory, { event: "FINISH", ...input });
  if (input.observedMicrounits !== null && input.observedMicrounits > maximum && !rows.some(r => r.event === "STOP"))
    appendUnlocked(directory, { event: "STOP", runId: input.runId, at: input.at, reason: "RESERVATION_EXCEEDED" });
  if ((rows[0] as Begin).observableAdmission && input.observedMicrounits === null && !rows.some(r => r.event === "STOP"))
    appendUnlocked(directory, { event: "STOP", runId: input.runId, at: input.at, reason: "UNKNOWN_USAGE" });
  return finished;
}
/** Called only after first actual response AND actual-service/oracle acceptance.
 * Ledger lock makes the canary fence durable before any next reservation. */
export function settleCampaignCanary(directory: string, input: { runId: string; at: number; accepted: boolean }) {
  return withLedgerLock(directory, () => {
    const rows = ledger(directory), begin = rows[0];
    const dispatches = rows.filter(r => r.event === "DISPATCH"), finish = rows.find((r): r is Stored & Finish => r.event === "FINISH");
    if (!begin || begin.event !== "BEGIN" || !begin.observableAdmission || begin.runId !== input.runId || rows.some(r => r.event === "STOP" || r.event === "CANARY_PASS")
      || validateCampaign(rows).stopped || dispatches.length !== 1 || !finish || finish.observedMicrounits == null || !Number.isSafeInteger(input.at) || input.at < finish.at) throw new Error("INVALID_CANARY_STATE");
    return appendUnlocked(directory, input.accepted ? { event: "CANARY_PASS", runId: input.runId, at: input.at }
      : { event: "STOP", runId: input.runId, at: input.at, reason: "CANARY_FAILED" });
  });
}
export function completeCampaign(directory: string, input: { runId: string; at: number }) {
  return withLedgerLock(directory, () => {
    const rows = ledger(directory);
    if (!rows.some(r => r.event === "CANARY_PASS") || rows.some(r => r.event === "STOP")
      || rows.filter(r => r.event === "DISPATCH").length !== rows.filter(r => r.event === "FINISH").length) throw new Error("INCOMPLETE_CAMPAIGN");
    const finishes = rows.filter((r): r is Stored & Finish => r.event === "FINISH");
    if (finishes.some(r => r.observedMicrounits == null)) throw new Error("UNKNOWN_USAGE");
    return appendUnlocked(directory, { event: "COMPLETE", ...input, gate: "PASS", retainedMicrounits: finishes.reduce((sum, r) => sum + r.observedMicrounits!, 0) });
  });
}

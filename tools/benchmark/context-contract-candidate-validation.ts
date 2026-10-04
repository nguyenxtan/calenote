import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync, lstatSync, existsSync, mkdirSync, openSync, writeSync, fsyncSync, closeSync, readdirSync } from "node:fs";
import { join, relative, isAbsolute, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { immutableApplicationProof } from "./context-contract-single-replay";
import { auditCampaignAccountRoot, preflightContextCampaign, withAccountRootLock, contextCampaignGitEnvironment } from "./context-contract-live";
import { contextCampaignMaximumReservation, contextCampaignGatewayConfig, executeObservableR01Turn0Replay } from "./context-contract-runner";
import type { SemanticTransport } from "../../src/modules/intelligence/infrastructure/openrouter/semantic-gateway";
import { createContextHttpTransport } from "../../src/modules/intelligence/infrastructure/openrouter/semantic-gateway";

const digest = z.string().regex(/^[a-f0-9]{64}$/u), sha = z.string().regex(/^[a-f0-9]{40}$/u);
const hash = (text: string | Uint8Array) => createHash("sha256").update(text).digest("hex");
const scopeSchema = z.strictObject({ version: z.literal("candidate-validation-authority-1"), operation: z.literal("SINGLE_T11_R01_VALIDATION"),
  authorizationId: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/u), campaignRoot: z.string(), evaluationCandidateSha: sha,
  fixture: z.literal("R01"), turn: z.literal(0), maxProviderHttpRequests: z.literal(1), model: z.literal("google/gemini-2.5-flash-lite"),
  provider: z.literal("google-vertex/eu"), retry: z.literal(0), fallback: z.literal("none"), ownerMessagePath: z.string(), ownerMessageSha256: digest });
const admissionSchema = z.strictObject({ version: z.literal("candidate-validation-admission-1"), accountRoot: z.string(),
  evaluationCandidateSha: sha, harnessRevisionSha: sha, candidateProofSha256: digest, harnessProofSha256: digest,
  authorizationPath: z.string(), authorizationSha256: digest, historicalInventorySha256: digest });
type Admission = z.infer<typeof admissionSchema>;
type Scope = z.infer<typeof scopeSchema>;
/** Reviewed pins come from the direct owner-facing orchestration boundary,
 * never from the record being loaded, credentials, CLI flags or old bootstrap. */
export interface CandidateValidationTrust {
  accountRoot: string; parentCampaignRoot: string; expectedCandidateSha: string;
  reviewedRecordSha256: string; reviewedAuthorizationSha256: string; reviewedOwnerMessageSha256: string;
}
const brand: unique symbol = Symbol("CandidateValidationAuthority");
export interface CandidateValidationAuthority { readonly [brand]: true }
const grants = new WeakMap<object, { record: Admission; scope: Scope; trust: CandidateValidationTrust; recordPath: string; root: string }>();
const trustedLoadedChecks = new WeakMap<object, () => void>();
function contained(root: string, path: string) {
  const rel = relative(root, path);
  if (!isAbsolute(path) || !rel || rel.startsWith("..") || isAbsolute(rel) || realpathSync(path) !== path || lstatSync(path).isSymbolicLink()) throw new Error("VALIDATION_PATH_BINDING");
}
function boundedRead(path: string) {
  if (lstatSync(path).size > 16384) throw new Error("VALIDATION_RECORD_SIZE");
  return readFileSync(path, "utf8");
}
export function candidateValidationProof(root: string, candidate: string) {
  try { return immutableApplicationProof(root, candidate); }
  catch (error) { if (error instanceof Error) throw new Error(error.message.replace("SINGLE_REPLAY_", "VALIDATION_")); throw error; }
}
/** Direct message consumption identity: changing run-id/candidate cannot
 * repackage this same owner grant into a second dispatch. */
export function validationExecutionKey(ownerMessageSha256: string) { return `r01-validation-${hash(ownerMessageSha256).slice(0, 40)}`; }
function directory(scope: Scope) { return join(scope.campaignRoot, "candidate-validations", validationExecutionKey(scope.ownerMessageSha256), "PILOT"); }
function marker(record: Admission, scope: Scope) { return join(record.accountRoot, `.${validationExecutionKey(scope.ownerMessageSha256)}.consumed.json`); }
function assertUnconsumed(record: Admission, scope: Scope) {
  if (existsSync(marker(record, scope)) || existsSync(directory(scope))) throw new Error("VALIDATION_ALREADY_CONSUMED");
  // Legacy tombstones are immutable but retain their owner-message digest.
  // A new record format cannot resurrect any already-consumed direct message.
  for (const name of readdirSync(record.accountRoot).filter(name => name.startsWith(".") && name.endsWith(".consumed.json"))) {
    const path = join(record.accountRoot, name); contained(record.accountRoot, path);
    const consumed = JSON.parse(boundedRead(path)) as { ownerApprovalSha256?: string; ownerMessageSha256?: string };
    if (consumed.ownerApprovalSha256 === scope.ownerMessageSha256 || consumed.ownerMessageSha256 === scope.ownerMessageSha256) throw new Error("VALIDATION_ALREADY_CONSUMED");
  }
}
function verify(recordPath: string, root: string, trust: CandidateValidationTrust) {
  if (realpathSync(trust.accountRoot) !== trust.accountRoot || !isAbsolute(trust.accountRoot)) throw new Error("VALIDATION_ACCOUNT_ROOT");
  contained(trust.accountRoot, recordPath); contained(trust.accountRoot, trust.parentCampaignRoot);
  const text = boundedRead(recordPath);
  if (hash(text) !== trust.reviewedRecordSha256) throw new Error("VALIDATION_RECORD_BINDING");
  const record = admissionSchema.parse(JSON.parse(text));
  if (record.accountRoot !== trust.accountRoot || record.evaluationCandidateSha !== trust.expectedCandidateSha) throw new Error("VALIDATION_CANDIDATE_BINDING");
  contained(trust.accountRoot, record.authorizationPath);
  const authorityText = boundedRead(record.authorizationPath);
  if (hash(authorityText) !== trust.reviewedAuthorizationSha256 || record.authorizationSha256 !== trust.reviewedAuthorizationSha256) throw new Error("VALIDATION_AUTHORIZATION_BINDING");
  const scope = scopeSchema.parse(JSON.parse(authorityText));
  if (scope.campaignRoot !== trust.parentCampaignRoot || scope.evaluationCandidateSha !== trust.expectedCandidateSha) throw new Error("VALIDATION_SCOPE_BINDING");
  contained(trust.accountRoot, scope.ownerMessagePath);
  if (scope.ownerMessageSha256 !== trust.reviewedOwnerMessageSha256 || hash(boundedRead(scope.ownerMessagePath)) !== trust.reviewedOwnerMessageSha256) throw new Error("VALIDATION_OWNER_BINDING");
  const proof = candidateValidationProof(root, record.evaluationCandidateSha);
  if (proof.harnessRevisionSha !== record.harnessRevisionSha || proof.candidateProofSha256 !== record.candidateProofSha256 || proof.harnessProofSha256 !== record.harnessProofSha256) throw new Error("VALIDATION_SOURCE_BINDING");
  const history = auditCampaignAccountRoot(trust.accountRoot, directory(scope));
  if (history.inventoryDigest !== record.historicalInventorySha256 || !history.bindings.some(b => b.directory === join(scope.campaignRoot, "PILOT"))) throw new Error("VALIDATION_HISTORY_BINDING");
  return { record, scope, trust: Object.freeze({ ...trust }), root, recordPath };
}
export function createCandidateValidationLoader(trust: CandidateValidationTrust) {
  const pins = Object.freeze({ ...trust });
  return (recordPath: string, root: string): CandidateValidationAuthority => {
    const value = verify(recordPath, root, pins), authority = Object.freeze({}) as CandidateValidationAuthority;
    grants.set(authority, value); return authority;
  };
}
function grant(authority: CandidateValidationAuthority | undefined) {
  const prior = authority && grants.get(authority);
  if (!prior) throw new Error("VALIDATION_AUTHORIZATION_REQUIRED");
  return verify(prior.recordPath, prior.root, prior.trust);
}
function accounting(root: string, accountRoot: string) {
  const audit = auditCampaignAccountRoot(accountRoot), capMicrounits = preflightContextCampaign({ root }).pilot.maxMicrounits;
  const { retainedMicrounits, unknownMicrounits } = audit.totals.PILOT;
  const remainingMicrounits = capMicrounits - retainedMicrounits;
  if (remainingMicrounits < contextCampaignMaximumReservation) throw new Error("SINGLE_REPLAY_BUDGET_INSUFFICIENT");
  return { capMicrounits, retainedMicrounits, remainingMicrounits, unknownMicrounits,
    knownRetainedMicrounits: retainedMicrounits - unknownMicrounits, reservationMicrounits: contextCampaignMaximumReservation,
    inventoryDigest: audit.inventoryDigest, ledgerHashChain: "PASS" as const };
}
export function inspectCandidateValidation(authority: CandidateValidationAuthority | undefined) {
  const { record, scope, root } = grant(authority); assertUnconsumed(record, scope);
  return accounting(root, record.accountRoot);
}
/** Read-only readiness is not a grant. Fixed physical anchor prevents copied
 * worktrees from advertising a fresh namespace/budget. */
export function prepareCandidateValidation(root: string, candidate: string) {
  assertExecutingRoot(root);
  if (execFileSync("git", ["-C", root, "status", "--porcelain", "--untracked-files=normal"], { encoding: "utf8", env: contextCampaignGitEnvironment }).trim()) throw new Error("SOURCE_NOT_CLEAN");
  const accountRoot = "/Users/bichtuyen/code/calenote/.worktrees/product-experience-v2/.superpowers/sdd/2026-09-28-llm-context-contract-implementation";
  const parentCampaignRoot = join(accountRoot, "t11-inference-resume-03b8896-20261003");
  contained(accountRoot, parentCampaignRoot);
  const proof = candidateValidationProof(root, candidate), derived = accounting(root, accountRoot);
  if (!auditCampaignAccountRoot(accountRoot).bindings.some(b => b.directory === join(parentCampaignRoot, "PILOT"))) throw new Error("VALIDATION_PARENT_MISSING");
  return { ...proof, ...derived, accountRoot, parentCampaignRoot, target: "R01_TURN_0" as const, maxProviderHttpRequests: 1 as const,
    authorityMechanism: "READY_FOR_FRESH_DIRECT_OWNER_GRANT" as const, paidAuthorityPresent: false as const };
}
/** Live orchestration pins must be reviewed from the fresh direct message,
 * not copied out of an untrusted admission JSON. No CLI/file-only grant. */
export async function loadTrustedCandidateValidation(root: string, candidate: string, pins: {
  recordPath: string; reviewedRecordSha256: string; reviewedAuthorizationSha256: string; reviewedOwnerMessageSha256: string;
}) {
  const prepared = prepareCandidateValidation(root, candidate);
  // This same preload was installed before ANY application import. Its closed
  // registry detects stale cached modules even after disk bytes are restored.
  const loader = await import("./register-conversation-loader.mjs");
  const loadedCheck = () => { loader.assertLoadedCandidateModules(root, candidate, prepared.harnessRevisionSha); };
  loadedCheck();
  const authority = createCandidateValidationLoader({ accountRoot: prepared.accountRoot, parentCampaignRoot: prepared.parentCampaignRoot,
    expectedCandidateSha: candidate, reviewedRecordSha256: pins.reviewedRecordSha256,
    reviewedAuthorizationSha256: pins.reviewedAuthorizationSha256, reviewedOwnerMessageSha256: pins.reviewedOwnerMessageSha256 })(pins.recordPath, root);
  inspectCandidateValidation(authority); trustedLoadedChecks.set(authority, loadedCheck); return authority;
}
/** Only the trusted live entry composes physical HTTP. Low-level injected
 * transports remain for local fixtures; live callers cannot supply retries. */
export async function runTrustedCandidateValidation(authority: CandidateValidationAuthority | undefined, key: string) {
  const check = authority && trustedLoadedChecks.get(authority);
  if (!check) throw new Error("VALIDATION_TRUSTED_LIVE_AUTHORITY_REQUIRED");
  check(); inspectCandidateValidation(authority);
  if (!key || /[\r\n]/u.test(key)) throw new Error("CREDENTIAL_MISSING_OR_INVALID");
  let httpAttempts = 0;
  const transport = createContextHttpTransport(key, async (url, init) => {
    check();
    if (httpAttempts !== 0) throw new Error("VALIDATION_HTTP_FENCE");
    httpAttempts++;
    return fetch(url, { ...init, redirect: "error" });
  });
  const result = await runCandidateValidation(authority, transport);
  return { ...result, providerInferenceHttpAttempts: httpAttempts };
}
function assertExecutingRoot(root: string) {
  const executingRoot = realpathSync(fileURLToPath(new URL("../../", import.meta.url)));
  if (realpathSync(root) !== executingRoot || realpathSync(process.cwd()) !== executingRoot) throw new Error("VALIDATION_EXECUTING_ROOT");
}
function syncChain(accountRoot: string, leaf: string) {
  const rel = relative(accountRoot, leaf);
  if (rel.startsWith("..") || isAbsolute(rel)) throw new Error("VALIDATION_PATH_BINDING");
  const paths = [accountRoot]; let current = accountRoot;
  for (const segment of rel.split("/").filter(Boolean)) { current = join(current, segment); paths.push(current); }
  for (const path of paths.reverse()) { const fd = openSync(path, "r"); try { fsyncSync(fd); } finally { closeSync(fd); } }
}
function durableExclusive(path: string, value: unknown) {
  const fd = openSync(path, "wx", 0o600); try { writeSync(fd, JSON.stringify(value)); fsyncSync(fd); } finally { closeSync(fd); }
}
/** Storage primitive only: it neither infers owner approval nor grants paid
 * authority. Orchestration may call it only AFTER the fresh direct approval. */
export function appendCandidateValidationRecord(accountRoot: string, path: string, value: unknown) {
  const parent = dirname(path), rel = relative(accountRoot, path);
  if (realpathSync(accountRoot) !== accountRoot || !isAbsolute(path) || !rel || rel.startsWith("..") || isAbsolute(rel)) throw new Error("VALIDATION_PATH_BINDING");
  if (parent !== accountRoot) contained(accountRoot, parent);
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (Buffer.byteLength(text) > 16384) throw new Error("VALIDATION_RECORD_SIZE");
  const fd = openSync(path, "wx", 0o600); try { writeSync(fd, text); fsyncSync(fd); } finally { closeSync(fd); }
  syncChain(accountRoot, parent);
}
export async function runCandidateValidation(authority: CandidateValidationAuthority | undefined, transport: SemanticTransport, options: { now?: () => number } = {}) {
  const initial = grant(authority); assertExecutingRoot(initial.root);
  return withAccountRootLock(initial.record.accountRoot, async () => {
    const { record, scope, root } = grant(authority), derived = inspectCandidateValidation(authority);
    durableExclusive(marker(record, scope), { authorizationSha256: record.authorizationSha256, ownerMessageSha256: scope.ownerMessageSha256, evaluationCandidateSha: scope.evaluationCandidateSha });
    syncChain(record.accountRoot, record.accountRoot);
    const leaf = directory(scope); mkdirSync(leaf, { recursive: true, mode: 0o700 }); contained(record.accountRoot, leaf);
    durableExclusive(join(leaf, "execution.json"), { ...record, scope, accounting: derived }); syncChain(record.accountRoot, leaf);
    let requests = 0; const now = options.now ?? Date.now, startedAt = now(), expiresAt = startedAt + 1200000;
    return executeObservableR01Turn0Replay({ root, directory: leaf, sourceSha: record.evaluationCandidateSha, provenanceDigest: record.candidateProofSha256,
      profile: "PILOT", runId: validationExecutionKey(scope.ownerMessageSha256), cumulativeAuthorizedMicrounits: derived.capMicrounits,
      // Authorization belongs to execution.json, not a new campaign grant.
      cumulativeRetainedMicrounits: derived.retainedMicrounits, startedAt, expiresAt, now,
      httpRequestCount: () => requests, transport: async (request, requestOptions) => {
        if (requests !== 0 || now() >= expiresAt || requestOptions.signal.aborted) throw new Error("VALIDATION_DISPATCH_FENCE");
        if (request.model !== contextCampaignGatewayConfig.primary.model || request.stream !== false || request.provider.only.join("|") !== scope.provider
          || request.provider.allow_fallbacks !== false || request.provider.require_parameters !== true || request.provider.zdr !== true) throw new Error("VALIDATION_ROUTE_MISMATCH");
        grant(authority); trustedLoadedChecks.get(authority!)?.(); syncChain(record.accountRoot, leaf);
        requests++; return transport(request, requestOptions);
      } });
  });
}

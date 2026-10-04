import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, openSync, closeSync, writeSync, fsyncSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { join, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { auditCampaignAccountRoot, contextCampaignGitEnvironment, preflightContextCampaign, withAccountRootLock } from "./context-contract-live";
import { contextCampaignGatewayConfig, contextCampaignMaximumReservation, executeObservableR01Turn0Replay } from "./context-contract-runner";
import type { SemanticTransport } from "../../src/modules/intelligence/infrastructure/openrouter/semantic-gateway";

export const SINGLE_REPLAY_CANDIDATE = "0631ba97ae237711c10568ed16a4cb697cf5a621";
/** Digest of the already-granted human authorization, exact UTF-8 + newline.
 * Bootstrap metadata may bind execution artifacts, never mint this authority. */
export const SINGLE_REPLAY_OWNER_APPROVAL_SHA256 = "76ec4aa32be784cf5729c467c9c7621f02a6051fef59c4351a382fcb87e694b5";
/** This one-shot authority belongs to one physical accounting namespace.
 * A copied checkout must not fork its spend/consumption state. */
const approvedPhysicalAccountRoot = "/Users/bichtuyen/code/calenote/.worktrees/product-experience-v2/.superpowers/sdd/2026-09-28-llm-context-contract-implementation";
const approvedParentRelativePath = "t11-inference-resume-03b8896-20261003";
export const singleReplayBootstrapPath = ".superpowers/sdd/2026-09-28-llm-context-contract-implementation/trusted-orchestration/single-replay-bootstrap.json";
const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const git = (root: string, args: string[]) => execFileSync("git", ["-C", root, ...args], { env: contextCampaignGitEnvironment, encoding: "utf8" }).trim();
const digest = z.string().regex(/^[a-f0-9]{64}$/u), sha = z.string().regex(/^[a-f0-9]{40}$/u);
const recordSchema = z.strictObject({ version: z.literal("single-t11-replay-1"), operation: z.literal("SINGLE_T11_R01_DIAGNOSTIC_REPLAY"),
  evaluationCandidateSha: z.literal(SINGLE_REPLAY_CANDIDATE), harnessRevisionSha: sha, candidateProofSha256: digest, harnessProofSha256: digest,
  historicalInventorySha256: digest,
  accountRoot: z.string(), parentCampaignRoot: z.string(), executionKey: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/u),
  ownerApprovalPath: z.string(), ownerApprovalSha256: digest, model: z.literal("google/gemini-2.5-flash-lite"), provider: z.literal("google-vertex/eu"),
  maxProviderHttpRequests: z.literal(1), retry: z.literal(0), fallback: z.literal("none") });
type Record = z.infer<typeof recordSchema>;
const brand: unique symbol = Symbol("SingleReplayAuthority");
export interface SingleReplayAuthority { readonly [brand]: true }
const grants = new WeakMap<object, { record: Record; root: string; recordPath: string; recordDigest: string }>();
function contained(root: string, path: string) {
  const rel = relative(root, path);
  if (!rel || rel.startsWith("..") || isAbsolute(rel) || realpathSync(path) !== path || lstatSync(path).isSymbolicLink()) throw new Error("SINGLE_REPLAY_PATH_BINDING");
}
function verifyExecutingRoot(root: string) {
  const executingRoot = realpathSync(fileURLToPath(new URL("../../", import.meta.url)));
  if (realpathSync(root) !== executingRoot || realpathSync(process.cwd()) !== executingRoot) throw new Error("SINGLE_REPLAY_EXECUTING_ROOT_MISMATCH");
}
function executionDirectory(record: Record) { return join(record.parentCampaignRoot, "single-replay-executions", record.executionKey, "PILOT"); }
function consumptionPath(record: Record) { return join(record.accountRoot, `.single-replay-${record.executionKey}.consumed.json`); }
/** Sync every linking directory, not just the leaf. A durable file is useless
 * if power loss can discard its newly-created ancestor directory entries. */
function syncDirectoryChain(accountRoot: string, leaf: string) {
  const rel = relative(accountRoot, leaf);
  if (rel.startsWith("..") || isAbsolute(rel)) throw new Error("SINGLE_REPLAY_PATH_BINDING");
  const chain = [accountRoot]; let current = accountRoot;
  for (const segment of rel.split("/").filter(Boolean)) { current = join(current, segment); chain.push(current); }
  for (const path of chain.reverse()) {
    const descriptor = openSync(path, "r"); try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
  }
}
/** Compare the complete application namespace, not HEAD. Added files and
 * symlinks cannot evade the immutable candidate proof. Tooling is separately
 * bound to its reviewed harness revision. */
export function singleReplayCandidateProof(root: string, candidate: string) {
  if (candidate !== SINGLE_REPLAY_CANDIDATE) throw new Error("SINGLE_REPLAY_CANDIDATE_MISMATCH");
  const selected = (path: string) => path.startsWith("src/") || path.startsWith("migrations/")
    || ["wrangler.jsonc", "package.json", "pnpm-lock.yaml", "tools/calendar/reference-vectors.json"].includes(path);
  const entries = git(root, ["ls-tree", "-r", candidate]).split("\n").map(line => {
    const [metadata, path] = line.split("\t"), [mode, , blob] = metadata.split(" "); return { path, mode, blob };
  }).filter(entry => selected(entry.path)).sort((a, b) => a.path.localeCompare(b.path, "en"));
  const expected = entries.map(entry => entry.path).sort();
  const current: string[] = [];
  function walk(path: string) {
    for (const entry of readdirSync(join(root, path), { withFileTypes: true })) {
      const file = `${path}/${entry.name}`;
      if (entry.isSymbolicLink()) throw new Error("SINGLE_REPLAY_APPLICATION_ALIAS");
      if (entry.isDirectory()) walk(file); else current.push(file);
    }
  }
  walk("src"); walk("migrations");
  current.push("wrangler.jsonc", "package.json", "pnpm-lock.yaml", "tools/calendar/reference-vectors.json"); current.sort();
  if (JSON.stringify(expected) !== JSON.stringify(current)) throw new Error("SINGLE_REPLAY_APPLICATION_FILES_CHANGED");
  const proof = expected.map(path => {
    if (lstatSync(join(root, path)).isSymbolicLink()) throw new Error("SINGLE_REPLAY_APPLICATION_ALIAS");
    const actual = readFileSync(join(root, path));
    const original = entries.find(entry => entry.path === path)!;
    const actualBlob = createHash("sha1").update(`blob ${actual.byteLength}\0`).update(actual).digest("hex");
    if (original.mode === "120000" || original.blob !== actualBlob) throw new Error("SINGLE_REPLAY_APPLICATION_CHANGED");
    return [path, hash(actual)];
  });
  const harnessPaths: string[] = [];
  function walkHarness(path: string) {
    for (const entry of readdirSync(join(root, path), { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new Error("SINGLE_REPLAY_HARNESS_ALIAS");
      const file = `${path}/${entry.name}`;
      if (entry.isDirectory()) walkHarness(file); else harnessPaths.push(file);
    }
  }
  walkHarness("tools/benchmark"); harnessPaths.push("vitest.config.ts", "vitest.setup.ts");
  const harnessProof = harnessPaths.sort().map(path => [path, hash(readFileSync(join(root, path)))]);
  return { evaluationCandidateSha: candidate, harnessRevisionSha: git(root, ["rev-parse", "HEAD"]), candidateProofSha256: hash(JSON.stringify(proof)), harnessProofSha256: hash(JSON.stringify(harnessProof)) };
}
export function singleReplayExecutionKey(ownerApprovalSha256: string) {
  return `r01-turn0-${hash(`${ownerApprovalSha256}|SINGLE_T11_R01_DIAGNOSTIC_REPLAY|${SINGLE_REPLAY_CANDIDATE}`).slice(0, 40)}`;
}
/** Only the trusted fixed bootstrap supplies these reviewed digests. A record
 * and a credential alone are not a capability. No campaign grant is created. */
export function createSingleReplayAuthorizationLoader(trusted: { reviewedRecordSha256: string; reviewedOwnerApprovalSha256: string; accountRoot: string; parentCampaignRoot: string }) {
  return (recordPath: string, root: string): SingleReplayAuthority => {
    const text = readFileSync(recordPath, "utf8");
    if (text.length > 16384 || hash(text) !== trusted.reviewedRecordSha256) throw new Error("SINGLE_REPLAY_RECORD_BINDING");
    const record = recordSchema.parse(JSON.parse(text));
    if (record.executionKey !== singleReplayExecutionKey(record.ownerApprovalSha256)) throw new Error("SINGLE_REPLAY_OPERATION_KEY");
    if (record.accountRoot !== trusted.accountRoot || record.parentCampaignRoot !== trusted.parentCampaignRoot) throw new Error("SINGLE_REPLAY_CAMPAIGN_MISMATCH");
    if (realpathSync(record.accountRoot) !== record.accountRoot) throw new Error("SINGLE_REPLAY_PATH_BINDING");
    contained(record.accountRoot, record.parentCampaignRoot);
    const directory = join(record.parentCampaignRoot, "single-replay-executions", record.executionKey, "PILOT");
    const history = auditCampaignAccountRoot(record.accountRoot, directory);
    if (history.inventoryDigest !== record.historicalInventorySha256) throw new Error("SINGLE_REPLAY_HISTORY_CHANGED");
    if (!history.bindings.some(binding => relative(record.parentCampaignRoot, binding.directory) === "PILOT")) throw new Error("SINGLE_REPLAY_PARENT_MISSING");
    if (record.ownerApprovalSha256 !== trusted.reviewedOwnerApprovalSha256 || hash(readFileSync(record.ownerApprovalPath)) !== record.ownerApprovalSha256) throw new Error("SINGLE_REPLAY_OWNER_BINDING");
    const proof = singleReplayCandidateProof(root, record.evaluationCandidateSha);
    if (proof.harnessRevisionSha !== record.harnessRevisionSha || proof.candidateProofSha256 !== record.candidateProofSha256 || proof.harnessProofSha256 !== record.harnessProofSha256) throw new Error("SINGLE_REPLAY_SOURCE_BINDING");
    const capability = Object.freeze({}) as SingleReplayAuthority;
    grants.set(capability, { record, root, recordPath, recordDigest: trusted.reviewedRecordSha256 }); return capability;
  };
}
function grant(capability: SingleReplayAuthority | undefined) {
  const value = capability && grants.get(capability);
  if (!value) throw new Error("SINGLE_REPLAY_AUTHORIZATION_REQUIRED");
  if (hash(readFileSync(value.recordPath)) !== value.recordDigest || hash(readFileSync(value.record.ownerApprovalPath)) !== value.record.ownerApprovalSha256) throw new Error("SINGLE_REPLAY_RECORD_BINDING");
  const proof = singleReplayCandidateProof(value.root, value.record.evaluationCandidateSha);
  if (proof.harnessRevisionSha !== value.record.harnessRevisionSha || proof.candidateProofSha256 !== value.record.candidateProofSha256 || proof.harnessProofSha256 !== value.record.harnessProofSha256) throw new Error("SINGLE_REPLAY_SOURCE_BINDING");
  const directory = join(value.record.parentCampaignRoot, "single-replay-executions", value.record.executionKey, "PILOT");
  if (auditCampaignAccountRoot(value.record.accountRoot, directory).inventoryDigest !== value.record.historicalInventorySha256) throw new Error("SINGLE_REPLAY_HISTORY_CHANGED");
  return value;
}
export function inspectSingleReplay(capability: SingleReplayAuthority | undefined) {
  const { record, root } = grant(capability), accounting = auditCampaignAccountRoot(record.accountRoot);
  const directory = executionDirectory(record);
  if (existsSync(consumptionPath(record)) || existsSync(join(directory, "execution.json")) || existsSync(join(directory, "campaign.jsonl"))) throw new Error("SINGLE_REPLAY_ALREADY_ADMITTED");
  const capMicrounits = preflightContextCampaign({ root }).pilot.maxMicrounits;
  const { retainedMicrounits, unknownMicrounits } = accounting.totals.PILOT;
  if (capMicrounits - retainedMicrounits < contextCampaignMaximumReservation) throw new Error("SINGLE_REPLAY_BUDGET_INSUFFICIENT");
  return { capMicrounits, retainedMicrounits, remainingMicrounits: capMicrounits - retainedMicrounits, unknownMicrounits,
    inventoryDigest: accounting.inventoryDigest, ledgerHashChain: "PASS" as const };
}
export async function runSingleReplay(capability: SingleReplayAuthority, transport: SemanticTransport, options: { now?: () => number } = {}) {
  const initial = grant(capability);
  verifyExecutingRoot(initial.root);
  const outcome = await withAccountRootLock(initial.record.accountRoot, async () => {
    try {
    const { record, root, recordDigest } = grant(capability), accounting = inspectSingleReplay(capability);
    const directory = executionDirectory(record);
    if (existsSync(join(directory, "execution.json")) || existsSync(join(directory, "campaign.jsonl"))) throw new Error("SINGLE_REPLAY_ALREADY_ADMITTED");
    if (accounting.remainingMicrounits < contextCampaignMaximumReservation) throw new Error("SINGLE_REPLAY_BUDGET_INSUFFICIENT");
    const now = options.now ?? Date.now, startedAt = now(), expiresAt = startedAt + 1200000;
    const consumed = openSync(consumptionPath(record), "wx", 0o600);
    try { writeSync(consumed, JSON.stringify({ operation: record.operation, evaluationCandidateSha: record.evaluationCandidateSha, ownerApprovalSha256: record.ownerApprovalSha256, executionKey: record.executionKey, startedAt })); fsyncSync(consumed); } finally { closeSync(consumed); }
    syncDirectoryChain(record.accountRoot, record.accountRoot);
    mkdirSync(directory, { recursive: true, mode: 0o700 }); contained(record.accountRoot, directory);
    const descriptor = openSync(join(directory, "execution.json"), "wx", 0o600);
    try { writeSync(descriptor, JSON.stringify({ ...record, authorityRecordSha256: recordDigest, accounting, startedAt, expiresAt })); fsyncSync(descriptor); } finally { closeSync(descriptor); }
    syncDirectoryChain(record.accountRoot, directory);
    let requests = 0;
    const result = await executeObservableR01Turn0Replay({ root, directory, sourceSha: record.evaluationCandidateSha, provenanceDigest: record.candidateProofSha256,
      profile: "PILOT", runId: record.executionKey, cumulativeAuthorizedMicrounits: accounting.capMicrounits, cumulativeRetainedMicrounits: accounting.retainedMicrounits,
      now, startedAt, expiresAt, httpRequestCount: () => requests, transport: async (request, requestOptions) => {
        if (requests !== 0 || now() >= expiresAt || requestOptions.signal.aborted) throw new Error("SINGLE_REPLAY_DISPATCH_FENCE");
        if (request.model !== contextCampaignGatewayConfig.primary.model || request.stream !== false
          || request.provider.only.join("|") !== contextCampaignGatewayConfig.primary.provider || request.provider.allow_fallbacks !== false) throw new Error("SINGLE_REPLAY_ROUTE_MISMATCH");
        // BEGIN/RESERVE/DISPATCH are fsynced by existing ledger primitives.
        // Sync directory entries after campaign.jsonl creation before HTTP.
        syncDirectoryChain(record.accountRoot, directory);
        requests++; return transport(request, requestOptions);
      } });
    return { kind: "EXECUTED" as const, result };
    } catch (error) { return { kind: "REJECTED" as const, error }; }
  });
  if (outcome.kind === "REJECTED") throw outcome.error;
  return outcome.result;
}
/** Future launcher has no authority CLI flags and never uses the historical
 * stopped bootstrap. The append-only record is pinned by reviewed metadata. */
export function loadTrustedSingleReplay(root: string) {
  verifyExecutingRoot(root);
  if (git(root, ["status", "--porcelain", "--untracked-files=normal"])) throw new Error("SOURCE_NOT_CLEAN");
  const schema = z.strictObject({ version: z.literal("single-replay-bootstrap-1"), recordPath: z.string(), reviewedRecordSha256: digest,
    reviewedOwnerApprovalSha256: digest, accountRoot: z.string(), parentCampaignRoot: z.string() });
  const bootstrap = schema.parse(JSON.parse(readFileSync(join(root, singleReplayBootstrapPath), "utf8")));
  const approvedAccountRoot = approvedPhysicalAccountRoot;
  if (bootstrap.reviewedOwnerApprovalSha256 !== SINGLE_REPLAY_OWNER_APPROVAL_SHA256
    || bootstrap.accountRoot !== approvedAccountRoot || bootstrap.parentCampaignRoot !== join(approvedAccountRoot, approvedParentRelativePath)) throw new Error("SINGLE_REPLAY_SOURCE_AUTHORITY_MISMATCH");
  return createSingleReplayAuthorizationLoader(bootstrap)(bootstrap.recordPath, root);
}

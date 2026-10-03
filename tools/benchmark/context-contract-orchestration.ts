import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { z } from "zod";
import { admitCanonicalCampaign, type ContextManifest } from "./context-contract";
import { preflightContextCampaign, auditCampaignAccountRoot, createCampaignAuthorizationLoader, admitFutureLiveIntent, withAccountRootLock, contextCampaignGitEnvironment, bindCampaignPaidAdmission } from "./context-contract-live";
import { CONTEXT_PROTOCOL_V3 } from "../../src/modules/conversation/context-contract/protocol";
import { InterpretationJsonSchema } from "../../src/modules/conversation/context-contract/contracts";
import { googleLiteEuContextWireSchemaV3 } from "../../src/modules/intelligence/infrastructure/openrouter/context-provider-wire";
import { contextCampaignGatewayConfig, contextCampaignMaximumReservation, runAuthorizedContextCampaign } from "./context-contract-runner";
import type { SemanticTransport } from "../../src/modules/intelligence/infrastructure/openrouter/semantic-gateway";

export { withAccountRootLock };
export type CredentialStatus = "READY" | "CREDENTIAL_MISSING" | "CREDENTIAL_INVALID" | "CREDENTIAL_INPUT_MECHANISM_UNSAFE";
export type AuthorizationStatus = "CONFIGURED" | "AUTHORIZATION_NOT_CONFIGURED" | "AUTHORIZATION_INVALID" | "AUTHORIZATION_MISMATCH";
const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
export const trustedBootstrapRelativePath = ".superpowers/sdd/2026-09-28-llm-context-contract-implementation/trusted-orchestration/bootstrap.mjs";
const sha256 = z.string().regex(/^[a-f0-9]{64}$/u);
const bootstrapSchema = z.strictObject({ version: z.literal("context-contract-trusted-orchestration-1"),
  candidateSha: z.string().regex(/^[a-f0-9]{40}$/u), provenanceDigest: sha256, contractDigest: sha256,
  ownerRecordPath: z.string(), reviewedOwnerRecordSha256: sha256, accountRoot: z.string(),
  targetDirectory: z.string(), inventoryDigest: sha256, paidConfirmation: z.union([z.literal("PENDING"),
    z.strictObject({ status: z.literal("CONFIRMED"), recordPath: z.string(), reviewedSha256: sha256 })]) });
export type TrustedContextBootstrap = z.infer<typeof bootstrapSchema>;
/** Fixed reviewed local module is the trust boundary; no CLI/environment pin. */
export async function loadTrustedContextBootstrap(root: string): Promise<unknown | undefined> {
  const path = join(root, trustedBootstrapRelativePath);
  try { if (realpathSync(path) !== path) throw new Error("TRUSTED_BOOTSTRAP_ALIAS"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
  return (await import(pathToFileURL(path).href)).default;
}
export function computeContextExecutionContract(root: string) {
  const manifests = ["regressions", "development", "heldout"].map(name => JSON.parse(readFileSync(join(root, `src/modules/conversation/context-contract/benchmark/${name}.json`), "utf8")) as ContextManifest);
  const corpus: ContextManifest = { version: "context-contract-corpus-1", cases: manifests.flatMap(m => m.cases) };
  const contract = { protocol: CONTEXT_PROTOCOL_V3, canonicalSchemaDigest: hash(JSON.stringify(InterpretationJsonSchema)),
    wire: googleLiteEuContextWireSchemaV3(), inputSchemaSourceDigest: hash(readFileSync(join(root, "src/modules/conversation/context-contract/contracts.ts"))),
    promptSourceDigest: hash(readFileSync(join(root, "src/modules/conversation/context-contract/prompt.ts"))),
    scorerSourceDigest: hash(readFileSync(join(root, "tools/benchmark/context-contract.ts"))),
    pilotDigest: hash(JSON.stringify(admitCanonicalCampaign(corpus, "PILOT"))), fullDigest: hash(JSON.stringify(admitCanonicalCampaign(corpus, "FULL"))),
    gatewayConfig: contextCampaignGatewayConfig, maximumReservation: contextCampaignMaximumReservation,
    gatewaySourceDigest: hash(readFileSync(join(root, "src/modules/intelligence/infrastructure/openrouter/semantic-gateway.ts"))),
    dataCollection: "deny", stream: false, retries: 0, fallback: "none",
    pilot: { maxCalls: 192, maxMicrounits: 1500000, maxMs: 1200000 }, full: { maxCalls: 480, maxMicrounits: 1000000, maxMs: 2700000 } };
  return { contract, contractDigest: hash(JSON.stringify(contract)) };
}
function loadTrustedIntent(root: string, trusted: unknown, now: number) {
  const bootstrap = bootstrapSchema.parse(trusted), current = preflightContextCampaign({ root });
  if (bootstrap.candidateSha !== current.sourceSha || bootstrap.provenanceDigest !== current.provenanceDigest
    || bootstrap.contractDigest !== computeContextExecutionContract(root).contractDigest) throw new Error("AUTHORIZATION_MISMATCH");
  if (execFileSync("git", ["-C", root, "status", "--porcelain", "--untracked-files=normal"], { encoding: "utf8", env: contextCampaignGitEnvironment }).trim()) throw new Error("SOURCE_NOT_CLEAN");
  if (realpathSync(bootstrap.ownerRecordPath) !== bootstrap.ownerRecordPath) throw new Error("OWNER_RECORD_ALIAS");
  const text = readFileSync(bootstrap.ownerRecordPath, "utf8");
  if (hash(text) !== bootstrap.reviewedOwnerRecordSha256) throw new Error("OWNER_AUTHORIZATION_MISMATCH");
  const raw = JSON.parse(text);
  const capability = createCampaignAuthorizationLoader({ accountRoot: bootstrap.accountRoot,
    reviewedOwnerRecordSha256: bootstrap.reviewedOwnerRecordSha256, reviewedAccountInventorySha256: bootstrap.inventoryDigest }).load(raw, bootstrap.targetDirectory);
  const intent = { root, enableLive: true, profile: raw.account as "PILOT" | "FULL", runId: raw.runId as string,
    authorizationPath: bootstrap.ownerRecordPath, authorizationCapability: capability, now };
  const authorization = admitFutureLiveIntent(intent), audit = auditCampaignAccountRoot(bootstrap.accountRoot, bootstrap.targetDirectory);
  const remainingMicrounits = (intent.profile === "PILOT" ? 1500000 : 1000000) - audit.totals[intent.profile].retainedMicrounits;
  return { intent, authorization, remainingMicrounits };
}
/** Credentials are unobserved: MISSING means no safe input was provided to
 * this preflight, not that the process environment was inspected. */
export async function preflightTrustedContextCampaign(root: string, trusted: unknown, now: number) {
  const base = preflightContextCampaign({ root });
  const common = { ...base, credentialStatus: "CREDENTIAL_MISSING" as CredentialStatus, paidConfirmation: "PENDING" as const,
    executionStatus: "NOT_AUTHORIZED_FOR_THIS_STEP" };
  if (trusted === undefined) return { ...common, authorizationStatus: "AUTHORIZATION_NOT_CONFIGURED" as AuthorizationStatus, reason: "AUTHORIZATION_NOT_CONFIGURED" };
  const parsed = bootstrapSchema.safeParse(trusted);
  if (!parsed.success) return { ...common, authorizationStatus: "AUTHORIZATION_INVALID" as AuthorizationStatus, reason: "INVALID_TRUSTED_BOOTSTRAP" };
  try { return await withAccountRootLock(parsed.data.accountRoot, async () => {
    // Rejected read-only diagnostics release this preflight's own lock.
    try { const loaded = loadTrustedIntent(root, parsed.data, now);
      if (parsed.data.paidConfirmation !== "PENDING") validatePaidConfirmation(parsed.data, loaded, now);
      return { ...common, authorizationStatus: "CONFIGURED" as AuthorizationStatus,
        paidConfirmation: parsed.data.paidConfirmation === "PENDING" ? "PENDING" : "CONFIRMED",
        reason: loaded.remainingMicrounits < contextCampaignMaximumReservation ? "BUDGET_INSUFFICIENT" : "CREDENTIAL_MISSING", remainingMicrounits: loaded.remainingMicrounits };
    } catch (error) { return { ...common, authorizationStatus: "AUTHORIZATION_MISMATCH" as AuthorizationStatus, reason: (error as Error).message }; }
  }); } catch (error) { return { ...common, authorizationStatus: "AUTHORIZATION_MISMATCH" as AuthorizationStatus, reason: (error as Error).message }; }
}
const paidSchema = z.strictObject({ version: z.literal("context-contract-paid-confirmation-1"), status: z.literal("CONFIRMED"),
  candidateSha: z.string().regex(/^[a-f0-9]{40}$/u), provenanceDigest: sha256, contractDigest: sha256,
  ownerRecordSha256: sha256, accountRoot: z.string(), inventoryDigest: sha256, targetDirectory: z.string(),
  runId: z.string(), profile: z.enum(["PILOT", "FULL"]), approvedAt: z.number().int().nonnegative(), expiresAt: z.number().int().nonnegative() });
/** Paid record is separately pinned in the fixed reviewed bootstrap. */
function validatePaidConfirmation(bootstrap: TrustedContextBootstrap, loaded: ReturnType<typeof loadTrustedIntent>, now: number) {
  if (bootstrap.paidConfirmation === "PENDING") throw new Error("PAID_CONFIRMATION_PENDING");
  const reference = bootstrap.paidConfirmation;
  if (realpathSync(reference.recordPath) !== reference.recordPath) throw new Error("PAID_CONFIRMATION_ALIAS");
  const text = readFileSync(reference.recordPath, "utf8");
  if (hash(text) !== reference.reviewedSha256) throw new Error("PAID_CONFIRMATION_MISMATCH");
  const record = paidSchema.parse(JSON.parse(text));
  if (record.candidateSha !== bootstrap.candidateSha || record.provenanceDigest !== bootstrap.provenanceDigest
    || record.contractDigest !== bootstrap.contractDigest || record.ownerRecordSha256 !== bootstrap.reviewedOwnerRecordSha256
    || record.accountRoot !== bootstrap.accountRoot || record.inventoryDigest !== bootstrap.inventoryDigest || record.targetDirectory !== bootstrap.targetDirectory
    || record.runId !== loaded.intent.runId || record.profile !== loaded.intent.profile || record.approvedAt > now
    || now >= record.expiresAt || record.expiresAt > Math.min(loaded.authorization.expiresAt,
      loaded.authorization.startedAt + (loaded.intent.profile === "PILOT" ? 1200000 : 2700000))) throw new Error("PAID_CONFIRMATION_MISMATCH");
  return record.expiresAt;
}
export async function runTrustedContextCampaign(root: string, trusted: unknown, readSecret: () => string, testTransport?: SemanticTransport) {
  const bootstrap = bootstrapSchema.parse(trusted);
  if (bootstrap.paidConfirmation === "PENDING") throw new Error("PAID_CONFIRMATION_PENDING");
  const now = Date.now(), loaded = loadTrustedIntent(root, bootstrap, now);
  validatePaidConfirmation(bootstrap, loaded, now);
  if (loaded.remainingMicrounits < contextCampaignMaximumReservation) throw new Error("BUDGET_INSUFFICIENT");
  bindCampaignPaidAdmission(loaded.intent.authorizationCapability, () => {
    // Invoked under the shared root lock: re-read exact owner/source/account
    // bindings and actual paid bytes; validate the paid clock after all I/O.
    const locked = loadTrustedIntent(root, bootstrap, Date.now());
    return validatePaidConfirmation(bootstrap, locked, Date.now());
  });
  // Runner reacquires the root and revalidates both authorities with fresh
  // clocks, then guards input/holds/dispatch/HTTP with the paid deadline.
  return runAuthorizedContextCampaign(loaded.intent, readSecret, undefined, testTransport);
}

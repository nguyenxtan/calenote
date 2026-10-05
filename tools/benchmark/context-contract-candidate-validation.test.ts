// @vitest-environment node
import { it, expect } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, realpathSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { candidateValidationProof, createCandidateValidationLoader, inspectCandidateValidation, runCandidateValidation, validationExecutionKey, loadTrustedCandidateValidation, appendCandidateValidationRecord } from "./context-contract-candidate-validation";
import { appendCampaignEvent, reserveCampaignCall, markCampaignDispatched, readCampaignLedger, auditCampaignAccountRoot } from "./context-contract-live";
import { encodeFixtureV3, frozenContextProposal } from "./context-contract-fixtures";
import type { ContextInput } from "../../src/modules/conversation/context-contract/contracts";

// Immutable local test-only candidate snapshot: application evolution must not
// relabel an old grant or require committing unverified runtime code first.
function currentFixtureCandidate() {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "candidate-index-"));
  const env = { ...process.env, GIT_INDEX_FILE: join(fixtureRoot, "index") };
  try {
    execFileSync("git", ["read-tree", "HEAD"], { env });
    execFileSync("git", ["add", "src", "migrations", "wrangler.jsonc", "package.json", "pnpm-lock.yaml", "tools/calendar/reference-vectors.json"], { env });
    const tree = execFileSync("git", ["write-tree"], { env, encoding: "utf8" }).trim();
    return execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit-tree", tree, "-p", "HEAD", "-m", "Immutable test-only candidate"], { env, encoding: "utf8" }).trim();
  } finally { rmSync(fixtureRoot, { recursive: true, force: true }); }
}
const candidate = currentFixtureCandidate();
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
function setup() {
  const accountRoot = realpathSync(mkdtempSync(join(tmpdir(), "candidate-validation-"))), parentCampaignRoot = join(accountRoot, "existing-T11");
  const history = join(parentCampaignRoot, "PILOT"); mkdirSync(history, { recursive: true });
  appendCampaignEvent(history, { event: "BEGIN", runId: "old-terminal", profile: "PILOT", sourceSha: "a".repeat(40), provenanceDigest: "b".repeat(64), cumulativeAuthorizedMicrounits: 1500000, cumulativeRetainedMicrounits: 0, startedAt: 1 });
  reserveCampaignCall(history, { runId: "old-terminal", profile: "PILOT", provenanceDigest: "b".repeat(64), reservationId: "old-unknown", maximumMicrounits: 10000, now: 1, startedAt: 1 });
  appendCampaignEvent(history, { event: "STOP", runId: "old-terminal", at: 1, reason: "HISTORICAL" });
  const ownerMessagePath = join(accountRoot, "direct-owner.txt"); writeFileSync(ownerMessagePath, "fresh direct scoped owner authorization test fixture");
  const scope = { campaignRoot: parentCampaignRoot, evaluationCandidateSha: candidate, fixture: "R01", turn: 0, maxProviderHttpRequests: 1,
    model: "google/gemini-2.5-flash-lite", provider: "google-vertex/eu", retry: 0, fallback: "none" };
  const authorization = { version: "candidate-validation-authority-1", operation: "SINGLE_T11_R01_VALIDATION", authorizationId: "fresh-owner-message-1", ...scope,
    ownerMessagePath, ownerMessageSha256: hash(readFileSync(ownerMessagePath, "utf8")) };
  const authorizationPath = join(accountRoot, "authorization.json"); writeFileSync(authorizationPath, JSON.stringify(authorization));
  const proof = candidateValidationProof(process.cwd(), candidate);
  const record = { version: "candidate-validation-admission-1", accountRoot, ...proof, authorizationPath,
    authorizationSha256: hash(JSON.stringify(authorization)), historicalInventorySha256: auditCampaignAccountRoot(accountRoot).inventoryDigest };
  const recordPath = join(accountRoot, "admission.json");
  const trusted = { accountRoot, parentCampaignRoot, expectedCandidateSha: candidate, reviewedAuthorizationSha256: record.authorizationSha256,
    reviewedOwnerMessageSha256: authorization.ownerMessageSha256, reviewedRecordSha256: hash(JSON.stringify(record)) };
  function load(value = record, grant = authorization, pins = trusted) {
    writeFileSync(recordPath, JSON.stringify(value)); writeFileSync(authorizationPath, JSON.stringify(grant));
    return createCandidateValidationLoader(pins)(recordPath, process.cwd());
  }
  return { accountRoot, parentCampaignRoot, history, authorization, record, trusted, load,
    directory: join(parentCampaignRoot, "candidate-validations", validationExecutionKey(authorization.ownerMessageSha256), "PILOT"),
    cleanup: () => rmSync(accountRoot, { recursive: true, force: true }) };
}

it("proves actual candidate bytes independently of harness identity", () => {
  const proof = candidateValidationProof(process.cwd(), candidate);
  expect(proof.evaluationCandidateSha).toBe(candidate);
  expect(proof.candidateProofSha256).toMatch(/^[a-f0-9]{64}$/);
  expect(() => candidateValidationProof(process.cwd(), "0631ba97ae237711c10568ed16a4cb697cf5a621")).toThrow(/VALIDATION_APPLICATION_(?:FILES_)?CHANGED/u);
});
it("rejects a changed loaded application rather than accepting its SHA label", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "candidate-proof-")));
  try {
    execFileSync("git", ["clone", "--quiet", "--local", "--shared", "--no-hardlinks", process.cwd(), root]);
    execFileSync("git", ["-C", root, "checkout", "--quiet", "--detach", candidate]);
    writeFileSync(join(root, "src/modules/conversation/context-contract/protocol.ts"), "changed runtime");
    expect(() => candidateValidationProof(root, candidate)).toThrow("VALIDATION_APPLICATION_CHANGED");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
it("derives debt and UNKNOWN without editing a stopped history", () => {
  const s = setup(); try {
    const before = readFileSync(join(s.history, "campaign.jsonl"), "utf8");
    expect(inspectCandidateValidation(s.load())).toMatchObject({ capMicrounits: 1500000, retainedMicrounits: 10000, remainingMicrounits: 1490000, unknownMicrounits: 10000, reservationMicrounits: 105472 });
    expect(readFileSync(join(s.history, "campaign.jsonl"), "utf8")).toBe(before);
    expect(existsSync(s.directory)).toBe(false);
  } finally { s.cleanup(); }
});
it("rejects absent authority even when a transport credential would be available", async () => {
  let calls = 0;
  await expect(runCandidateValidation(undefined, async () => { calls++; throw new Error("credential is not authority"); })).rejects.toThrow("VALIDATION_AUTHORIZATION_REQUIRED");
  expect(calls).toBe(0);
});
it.each(["evaluationCandidateSha", "campaignRoot", "fixture", "turn", "maxProviderHttpRequests", "model", "provider", "retry", "fallback", "operation"])("rejects a freshly digest-pinned but wrongly scoped %s", field => {
  const s = setup(); try {
    const grant = { ...s.authorization, [field]: ["turn", "maxProviderHttpRequests", "retry"].includes(field) ? 2 : "wrong" };
    const text = JSON.stringify(grant), record = { ...s.record, authorizationSha256: hash(text) };
    expect(() => s.load(record, grant, { ...s.trusted, reviewedAuthorizationSha256: hash(text), reviewedRecordSha256: hash(JSON.stringify(record)) })).toThrow();
  } finally { s.cleanup(); }
});
it("old raw replay authority cannot substitute for a fresh structured grant", () => {
  const s = setup(); try {
    expect(() => s.load(s.record, { ...s.authorization, evaluationCandidateSha: "0631ba97ae237711c10568ed16a4cb697cf5a621" })).toThrow("VALIDATION_AUTHORIZATION_BINDING");
  } finally { s.cleanup(); }
});
it("repackaged consumed legacy owner message cannot open a fresh candidate execution", async () => {
  const s = setup(); let calls = 0;
  try {
    writeFileSync(join(s.accountRoot, ".single-replay-old.consumed.json"), JSON.stringify({ ownerApprovalSha256: s.authorization.ownerMessageSha256, evaluationCandidateSha: "0631ba97ae237711c10568ed16a4cb697cf5a621" }));
    const authority = s.load();
    await expect(runCandidateValidation(authority, async () => { calls++; throw new Error("old grant replay"); })).rejects.toThrow("VALIDATION_ALREADY_CONSUMED");
    expect(calls).toBe(0); expect(existsSync(s.directory)).toBe(false);
  } finally { s.cleanup(); }
});
it.each(["PASS", "HTTP_FAILURE", "THROW", "WIRE_FAILURE"] as const)("one %s outcome is terminal with durable reservation and no next turn", async outcome => {
  const s = setup(); let calls = 0;
  try {
    const before = readFileSync(join(s.history, "campaign.jsonl"), "utf8"), authority = s.load();
    const result = await runCandidateValidation(authority, async request => {
      expect(readCampaignLedger(s.directory).map(row => row.event)).toEqual(["BEGIN", "RESERVE", "DISPATCH"]);
      calls++;
      if (outcome === "THROW") throw new Error("fake network failure");
      const context = JSON.parse(request.messages[1].content) as ContextInput;
      const body = JSON.stringify({ model: request.model, provider: "Google", id: "gen-local", usage: { cost: .001, prompt_tokens: 100, completion_tokens: 100 },
        choices: [{ finish_reason: "stop", message: { content: JSON.stringify(outcome === "WIRE_FAILURE" ? {} : encodeFixtureV3(frozenContextProposal(context, "R01", 0))) } }] });
      return { status: outcome === "HTTP_FAILURE" ? 500 : 200, body, rawResponseBytes: body.length };
    }, { now: () => 100 });
    expect(calls).toBe(1); expect(result.providerHttpRequests).toBe(1);
    expect(result.applicationEvidence.every(row => row.fixtureId === "R01" && row.turnIndex === 0 && row.mutations === 0)).toBe(true);
    expect(readCampaignLedger(s.directory).at(-1)?.event).toBe("STOP");
    expect(readCampaignLedger(s.directory).filter(row => row.event === "RESERVE")).toHaveLength(1);
    expect(readFileSync(join(s.history, "campaign.jsonl"), "utf8")).toBe(before);
    await expect(runCandidateValidation(authority, async () => { calls++; throw new Error("second request"); })).rejects.toThrow("VALIDATION_ALREADY_CONSUMED");
    expect(calls).toBe(1);
    expect(auditCampaignAccountRoot(s.accountRoot).bindings).toHaveLength(2);
  } finally { s.cleanup(); }
});
it.each([false, true])("reservation crash with dispatched=%s cannot be resumed", async dispatched => {
  const s = setup(); let calls = 0;
  try {
    mkdirSync(s.directory, { recursive: true }); writeFileSync(join(s.directory, "execution.json"), "{}");
    appendCampaignEvent(s.directory, { event: "BEGIN", runId: "crashed", profile: "PILOT", sourceSha: candidate, provenanceDigest: s.record.candidateProofSha256, cumulativeAuthorizedMicrounits: 1500000, cumulativeRetainedMicrounits: 10000, startedAt: 1 });
    reserveCampaignCall(s.directory, { runId: "crashed", profile: "PILOT", provenanceDigest: s.record.candidateProofSha256, reservationId: "crash-call", maximumMicrounits: 105472, now: 1, startedAt: 1 });
    if (dispatched) markCampaignDispatched(s.directory, { runId: "crashed", reservationId: "crash-call", at: 1 });
    const record = { ...s.record, historicalInventorySha256: auditCampaignAccountRoot(s.accountRoot, s.directory).inventoryDigest };
    const authority = s.load(record, s.authorization, { ...s.trusted, reviewedRecordSha256: hash(JSON.stringify(record)) });
    await expect(runCandidateValidation(authority, async () => { calls++; throw new Error("no restart dispatch"); })).rejects.toThrow("VALIDATION_ALREADY_CONSUMED");
    expect(calls).toBe(0);
    expect(auditCampaignAccountRoot(s.accountRoot).totals.PILOT.unknownMicrounits).toBe(115472);
    expect(readCampaignLedger(s.directory).some(row => row.event === "FINISH")).toBe(false);
  } finally { s.cleanup(); }
});

it("trusted entry cannot load an alternate checkout or manufacture campaign pins", async () => {
  const s = setup(); try {
    await expect(loadTrustedCandidateValidation(s.accountRoot, candidate, {
      recordPath: join(s.accountRoot, "admission.json"), reviewedRecordSha256: s.trusted.reviewedRecordSha256,
      reviewedAuthorizationSha256: s.trusted.reviewedAuthorizationSha256, reviewedOwnerMessageSha256: s.trusted.reviewedOwnerMessageSha256,
    })).rejects.toThrow("VALIDATION_EXECUTING_ROOT");
  } finally { s.cleanup(); }
});
it("tooling-only commit may differ from any immutable application candidate", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "harness-proof-")));
  try {
    execFileSync("git", ["clone", "--quiet", "--local", "--shared", "--no-hardlinks", process.cwd(), root]);
    execFileSync("git", ["-C", root, "checkout", "--quiet", "--detach", candidate]);
    execFileSync("git", ["-C", root, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "-c", "core.hooksPath=/dev/null", "commit", "--quiet", "--allow-empty", "-m", "Tooling fixture"]);
    const proof = candidateValidationProof(root, candidate);
    expect(proof.harnessRevisionSha).not.toBe(candidate);
    expect(proof.evaluationCandidateSha).toBe(candidate);
    const nextCandidate = proof.harnessRevisionSha;
    expect(candidateValidationProof(root, nextCandidate).evaluationCandidateSha).toBe(nextCandidate);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
it("duplicate concurrent invocation cannot reserve twice before dispatch", async () => {
  const s = setup(); let calls = 0;
  try {
    const authority = s.load();
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    const first = runCandidateValidation(authority, async () => { calls++; await pending; return { status: 500, body: "{}", rawResponseBytes: 2 }; });
    await expect(runCandidateValidation(authority, async () => { calls++; throw new Error("duplicate"); })).rejects.toThrow("ACCOUNT_LOCKED");
    release(); await first;
    expect(calls).toBe(1);
    expect(readCampaignLedger(s.directory).filter(row => row.event === "RESERVE")).toHaveLength(1);
  } finally { s.cleanup(); }
});
it("changed owner message and corrupt history invalidate an already-loaded capability", async () => {
  const s = setup(); let calls = 0;
  try {
    const authority = s.load(); writeFileSync(s.authorization.ownerMessagePath, "not the approved message");
    await expect(runCandidateValidation(authority, async () => { calls++; throw new Error("must not dispatch"); })).rejects.toThrow("VALIDATION_OWNER_BINDING");
    expect(calls).toBe(0); expect(existsSync(s.directory)).toBe(false);
  } finally { s.cleanup(); }
});
it("current derived budget cannot be replaced by a fresh execution pool", async () => {
  const s = setup(); let calls = 0;
  try {
    const debt = join(s.accountRoot, "other-stopped", "PILOT"); mkdirSync(debt, { recursive: true });
    appendCampaignEvent(debt, { event: "BEGIN", runId: "debt", profile: "PILOT", sourceSha: candidate, provenanceDigest: "b".repeat(64), cumulativeAuthorizedMicrounits: 1500000, cumulativeRetainedMicrounits: 10000, startedAt: 1 });
    reserveCampaignCall(debt, { runId: "debt", profile: "PILOT", provenanceDigest: "b".repeat(64), reservationId: "debt", maximumMicrounits: 1480000, now: 1, startedAt: 1 });
    appendCampaignEvent(debt, { event: "STOP", runId: "debt", at: 1, reason: "UNKNOWN" });
    const record = { ...s.record, historicalInventorySha256: auditCampaignAccountRoot(s.accountRoot).inventoryDigest };
    const authority = s.load(record, s.authorization, { ...s.trusted, reviewedRecordSha256: hash(JSON.stringify(record)) });
    await expect(runCandidateValidation(authority, async () => { calls++; throw new Error("must not dispatch"); })).rejects.toThrow("SINGLE_REPLAY_BUDGET_INSUFFICIENT");
    expect(calls).toBe(0); expect(existsSync(s.directory)).toBe(false);
    expect(auditCampaignAccountRoot(s.accountRoot).totals.PILOT.unknownMicrounits).toBe(1490000);
  } finally { s.cleanup(); }
});
it("fresh authority records append exclusively, never replace earlier authority", () => {
  const s = setup(); try {
    const path = join(s.accountRoot, "fresh-authority.json");
    appendCandidateValidationRecord(s.accountRoot, path, s.authorization);
    const before = readFileSync(path, "utf8");
    expect(() => appendCandidateValidationRecord(s.accountRoot, path, { ...s.authorization, evaluationCandidateSha: "a".repeat(40) })).toThrow();
    expect(readFileSync(path, "utf8")).toBe(before);
  } finally { s.cleanup(); }
});
it("corrupted ledger rejects a loaded capability before reservation", async () => {
  const s = setup(); let calls = 0;
  try {
    const authority = s.load(), path = join(s.history, "campaign.jsonl");
    writeFileSync(path, readFileSync(path, "utf8").replace('"maximumMicrounits":10000', '"maximumMicrounits":1'));
    await expect(runCandidateValidation(authority, async () => { calls++; throw new Error("no dispatch"); })).rejects.toThrow("LEDGER_PROVENANCE_CORRUPT");
    expect(calls).toBe(0); expect(existsSync(s.directory)).toBe(false);
  } finally { s.cleanup(); }
});

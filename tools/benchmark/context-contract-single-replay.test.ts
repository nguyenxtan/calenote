// @vitest-environment node
import { it, expect, vi } from "vitest";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, realpathSync, cpSync, symlinkSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executeObservableR01Turn0Replay } from "./context-contract-runner";
import { readCampaignLedger, appendCampaignEvent, reserveCampaignCall, markCampaignDispatched, finishCampaignCall, auditCampaignAccountRoot } from "./context-contract-live";
import { createSingleReplayAuthorizationLoader, inspectSingleReplay, runSingleReplay, loadTrustedSingleReplay, SINGLE_REPLAY_CANDIDATE, singleReplayCandidateProof, singleReplayExecutionKey } from "./context-contract-single-replay";
import { frozenContextProposal, encodeFixtureV3 } from "./context-contract-fixtures";
import type { ContextInput } from "../../src/modules/conversation/context-contract/contracts";

it.each(["PASS", "HTTP_FAILURE", "THROW", "WIRE_FAILURE"] as const)("R01 turn zero is the only application turn after %s", async outcome => {
  const root = mkdtempSync(join(tmpdir(), "single-replay-"));
  let calls = 0;
  try {
    const result = await executeObservableR01Turn0Replay({ directory: root, root: process.cwd(), sourceSha: "a".repeat(40), provenanceDigest: "b".repeat(64),
      profile: "PILOT", runId: "single-turn-zero", cumulativeAuthorizedMicrounits: 1500000, cumulativeRetainedMicrounits: 1000000, now: () => 100,
      transport: async request => {
        expect(readCampaignLedger(root).map(row => row.event)).toEqual(["BEGIN", "RESERVE", "DISPATCH"]);
        calls++;
        if (outcome === "THROW") throw new Error("fake provider failure");
        const context = JSON.parse(request.messages[1].content) as ContextInput;
        const proposal = outcome === "WIRE_FAILURE" ? {} : encodeFixtureV3(frozenContextProposal(context, "R01", 0));
        const body = JSON.stringify({ model: request.model, provider: "Google", id: "gen-local", usage: { cost: .001, prompt_tokens: 100, completion_tokens: 100 },
          choices: [{ finish_reason: "stop", message: { content: JSON.stringify(proposal) } }] });
        return { status: outcome === "HTTP_FAILURE" ? 500 : 200, body, rawResponseBytes: body.length };
      } });
    expect(calls).toBe(1);
    expect(result.providerHttpRequests).toBe(1);
    expect(result.applicationEvidence.every(row => row.fixtureId === "R01" && row.turnIndex === 0)).toBe(true);
    expect(readCampaignLedger(root).at(-1)?.event).toBe("STOP");
    expect(readCampaignLedger(root).filter(row => row.event === "RESERVE")).toHaveLength(1);
    expect(readFileSync(join(root, "report.json"), "utf8")).not.toContain('"turnIndex":1');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

const sha = (text: string) => createHash("sha256").update(text).digest("hex");
function setup() {
  const accountRoot = realpathSync(mkdtempSync(join(tmpdir(), "replay-account-"))), parentCampaignRoot = join(accountRoot, "existing-campaign");
  const historical = join(parentCampaignRoot, "PILOT"); mkdirSync(historical, { recursive: true });
  appendCampaignEvent(historical, { event: "BEGIN", runId: "old", sourceSha: "a".repeat(40), profile: "PILOT", provenanceDigest: "b".repeat(64), cumulativeAuthorizedMicrounits: 1500000, cumulativeRetainedMicrounits: 0, startedAt: 1 });
  reserveCampaignCall(historical, { runId: "old", profile: "PILOT", provenanceDigest: "b".repeat(64), reservationId: "old-call", maximumMicrounits: 10000, now: 1, startedAt: 1 });
  markCampaignDispatched(historical, { runId: "old", reservationId: "old-call", at: 1 });
  finishCampaignCall(historical, { runId: "old", reservationId: "old-call", at: 1, observedMicrounits: null });
  appendCampaignEvent(historical, { event: "STOP", runId: "old", at: 1, reason: "HISTORICAL" });
  const proof = singleReplayCandidateProof(process.cwd(), SINGLE_REPLAY_CANDIDATE);
  const approvalPath = join(accountRoot, "owner-replay-approval.txt"); writeFileSync(approvalPath, "existing direct owner replay authority");
  const record = { version: "single-t11-replay-1", operation: "SINGLE_T11_R01_DIAGNOSTIC_REPLAY", evaluationCandidateSha: SINGLE_REPLAY_CANDIDATE,
    harnessRevisionSha: proof.harnessRevisionSha, candidateProofSha256: proof.candidateProofSha256, harnessProofSha256: proof.harnessProofSha256,
    historicalInventorySha256: auditCampaignAccountRoot(accountRoot).inventoryDigest, accountRoot, parentCampaignRoot,
    executionKey: singleReplayExecutionKey(sha(readFileSync(approvalPath, "utf8"))), ownerApprovalPath: approvalPath, ownerApprovalSha256: sha(readFileSync(approvalPath, "utf8")),
    model: "google/gemini-2.5-flash-lite", provider: "google-vertex/eu", maxProviderHttpRequests: 1, retry: 0, fallback: "none" };
  const recordPath = join(accountRoot, "execution-admission.json");
  function load(value = record) {
    const text = JSON.stringify(value); writeFileSync(recordPath, text);
    return createSingleReplayAuthorizationLoader({ accountRoot, parentCampaignRoot, reviewedRecordSha256: sha(text), reviewedOwnerApprovalSha256: record.ownerApprovalSha256 })(recordPath, process.cwd());
  }
  return { accountRoot, parentCampaignRoot, historical, record, load, cleanup: () => rmSync(accountRoot, { recursive: true, force: true }) };
}
it("derives current account debt without resetting stopped history or UNKNOWN", () => {
  const s = setup(); try {
    const before = readFileSync(join(s.historical, "campaign.jsonl"), "utf8");
    expect(inspectSingleReplay(s.load())).toMatchObject({ capMicrounits: 1500000, retainedMicrounits: 10000, remainingMicrounits: 1490000, unknownMicrounits: 10000 });
    expect(readFileSync(join(s.historical, "campaign.jsonl"), "utf8")).toBe(before);
    expect(auditCampaignAccountRoot(s.accountRoot).bindings).toHaveLength(1);
  } finally { s.cleanup(); }
});
it.each(["evaluationCandidateSha", "parentCampaignRoot", "model", "provider", "operation", "maxProviderHttpRequests", "retry", "fallback", "harnessRevisionSha", "candidateProofSha256", "harnessProofSha256", "historicalInventorySha256"] as const)("rejects mismatched authority %s", field => {
  const s = setup(); try { expect(() => s.load({ ...s.record, [field]: field === "maxProviderHttpRequests" || field === "retry" ? 2 : "wrong" })).toThrow(); } finally { s.cleanup(); }
});
it("rejects corrupted canonical history before any dispatch", async () => {
  const s = setup(); let calls = 0;
  try {
    const capability = s.load();
    const path = join(s.historical, "campaign.jsonl"); writeFileSync(path, readFileSync(path, "utf8").replace('"maximumMicrounits":10000', '"maximumMicrounits":1'));
    await expect(runSingleReplay(capability, async () => { calls++; throw new Error("must not dispatch"); })).rejects.toThrow("LEDGER_PROVENANCE_CORRUPT");
    expect(calls).toBe(0);
  } finally { s.cleanup(); }
});
it.each(["BEFORE_DISPATCH", "AFTER_DISPATCH"] as const)("restart cannot spend authority after crash %s", async crash => {
  const s = setup(); let calls = 0;
  try {
    const directory = join(s.parentCampaignRoot, "single-replay-executions", s.record.executionKey, "PILOT"); mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, "execution.json"), "{}");
    appendCampaignEvent(directory, { event: "BEGIN", runId: s.record.executionKey, sourceSha: SINGLE_REPLAY_CANDIDATE, profile: "PILOT", executionKind: "R01_REPLAY",
      provenanceDigest: s.record.candidateProofSha256, cumulativeAuthorizedMicrounits: 1500000, cumulativeRetainedMicrounits: 10000, startedAt: 1 });
    reserveCampaignCall(directory, { runId: s.record.executionKey, profile: "PILOT", provenanceDigest: s.record.candidateProofSha256, reservationId: "call-1", maximumMicrounits: 105472, now: 1, startedAt: 1 });
    if (crash === "AFTER_DISPATCH") markCampaignDispatched(directory, { runId: s.record.executionKey, reservationId: "call-1", at: 1 });
    const capability = s.load();
    expect(auditCampaignAccountRoot(s.accountRoot).totals.PILOT).toMatchObject({ retainedMicrounits: 115472, unknownMicrounits: 115472 });
    expect(() => inspectSingleReplay(capability)).toThrow("SINGLE_REPLAY_ALREADY_ADMITTED");
    await expect(runSingleReplay(capability, async () => { calls++; throw new Error("must not dispatch"); })).rejects.toThrow("SINGLE_REPLAY_ALREADY_ADMITTED");
    expect(calls).toBe(0); expect(readCampaignLedger(directory).some(row => row.event === "FINISH")).toBe(false);
  } finally { s.cleanup(); }
});
it("does not consume replay authority during repeated read-only admission inspection", () => {
  const s = setup(); try {
    const a = inspectSingleReplay(s.load()), b = inspectSingleReplay(s.load()); expect(a).toEqual(b);
    expect(auditCampaignAccountRoot(s.accountRoot).bindings).toHaveLength(1);
  } finally { s.cleanup(); }
});
it("fails insufficient normal reservation without creating a fresh budget or execution", async () => {
  const s = setup(); let calls = 0;
  try {
    const extra = join(s.accountRoot, "older", "PILOT"); mkdirSync(extra, { recursive: true });
    appendCampaignEvent(extra, { event: "BEGIN", runId: "debt", sourceSha: "a".repeat(40), profile: "PILOT", provenanceDigest: "b".repeat(64), cumulativeAuthorizedMicrounits: 1500000, cumulativeRetainedMicrounits: 10000, startedAt: 1 });
    reserveCampaignCall(extra, { runId: "debt", profile: "PILOT", provenanceDigest: "b".repeat(64), reservationId: "debt-1", maximumMicrounits: 1480000, now: 1, startedAt: 1 });
    appendCampaignEvent(extra, { event: "STOP", runId: "debt", at: 1, reason: "CRASH" });
    const capability = s.load({ ...s.record, historicalInventorySha256: auditCampaignAccountRoot(s.accountRoot).inventoryDigest });
    expect(() => inspectSingleReplay(capability)).toThrow("SINGLE_REPLAY_BUDGET_INSUFFICIENT");
    expect(auditCampaignAccountRoot(s.accountRoot).totals.PILOT).toMatchObject({ retainedMicrounits: 1490000, unknownMicrounits: 1490000 });
    await expect(runSingleReplay(capability, async () => { calls++; throw new Error("must not dispatch"); })).rejects.toThrow("SINGLE_REPLAY_BUDGET_INSUFFICIENT");
    expect(calls).toBe(0); expect(auditCampaignAccountRoot(s.accountRoot).bindings).toHaveLength(2);
  } finally { s.cleanup(); }
});
it.each([0, 4])("actual turn-zero gateway persists sanitized query evidence cardinality %i", async count => {
  const s = setup(); let calls = 0;
  try {
    const result = await runSingleReplay(s.load(), async request => {
      calls++;
      const context = JSON.parse(request.messages[1].content) as ContextInput;
      const wire = encodeFixtureV3(frozenContextProposal(context, "R01", 0)) as { query: { evidence: unknown[] } };
      wire.query.evidence = Array(count).fill(wire.query.evidence[0]);
      const body = JSON.stringify({ model: request.model, provider: "Google", id: "gen-cardinality-local", usage: { cost: .001, prompt_tokens: 100, completion_tokens: 100 },
        choices: [{ finish_reason: "stop", message: { content: JSON.stringify(wire) } }] });
      return { status: 200, body, rawResponseBytes: body.length };
    }, { now: () => 100 });
    expect(calls).toBe(1);
    expect(result.responses[0].canonicalValidationDiagnostics).toMatchObject({ validation: { issues: expect.arrayContaining([expect.objectContaining({
      path: ["query", "evidence"], actualCount: count, minItems: 1, maxItems: 3 })]) } });
    const directory = join(s.parentCampaignRoot, "single-replay-executions", s.record.executionKey, "PILOT");
    const text = readFileSync(join(directory, "responses.json"), "utf8");
    expect(JSON.parse(text)[0].canonicalValidationDiagnostics).toEqual(result.responses[0].canonicalValidationDiagnostics);
    expect(text).not.toContain("Có lịch nào ko?"); expect(text).not.toContain('"quote":');
    expect(result.applicationEvidence[0]).toMatchObject({ listStoreReads: 0, mutations: 0 });
  } finally { s.cleanup(); }
});
it("rejects absent capability and changed owner approval", () => {
  const s = setup(); try {
    expect(() => inspectSingleReplay(undefined)).toThrow("SINGLE_REPLAY_AUTHORIZATION_REQUIRED");
    writeFileSync(s.record.ownerApprovalPath, "changed"); expect(() => s.load()).toThrow("SINGLE_REPLAY_OWNER_BINDING");
  } finally { s.cleanup(); }
});
it("creates one append-only child execution and rejects duplicate attempts before transport", async () => {
  const s = setup(); let calls = 0;
  try {
    const before = readFileSync(join(s.historical, "campaign.jsonl"), "utf8"), capability = s.load();
    const transport = async () => { calls++; return { status: 500, body: "{}", rawResponseBytes: 2 }; };
    const result = await runSingleReplay(capability, transport, { now: () => 100 });
    expect(result.providerHttpRequests).toBe(1); expect(calls).toBe(1);
    expect(readFileSync(join(s.historical, "campaign.jsonl"), "utf8")).toBe(before);
    expect(auditCampaignAccountRoot(s.accountRoot).bindings).toHaveLength(2);
    await expect(runSingleReplay(capability, transport, { now: () => 100 })).rejects.toThrow("SINGLE_REPLAY_ALREADY_ADMITTED");
    await expect(runSingleReplay(s.load(), transport, { now: () => 100 })).rejects.toThrow("SINGLE_REPLAY_ALREADY_ADMITTED");
    expect(() => s.load({ ...s.record, executionKey: "another-key" })).toThrow("SINGLE_REPLAY_OPERATION_KEY");
    expect(calls).toBe(1);
  } finally { s.cleanup(); }
});
it("spent replay cannot be advertised READY by read-only preflight", async () => {
  const s = setup(); try {
    const capability = s.load(); await runSingleReplay(capability, async () => ({ status: 500, body: "{}", rawResponseBytes: 2 }));
    expect(() => inspectSingleReplay(capability)).toThrow("SINGLE_REPLAY_ALREADY_ADMITTED");
  } finally { s.cleanup(); }
});
it("one owner operation cannot execute again under another parent campaign", async () => {
  const s = setup(); let calls = 0;
  try {
    await runSingleReplay(s.load(), async () => { calls++; return { status: 500, body: "{}", rawResponseBytes: 2 }; });
    const parentCampaignRoot = join(s.accountRoot, "alternate-existing-campaign"), historical = join(parentCampaignRoot, "PILOT");
    mkdirSync(historical, { recursive: true }); cpSync(join(s.historical, "campaign.jsonl"), join(historical, "campaign.jsonl"));
    const record = { ...s.record, parentCampaignRoot, historicalInventorySha256: auditCampaignAccountRoot(s.accountRoot).inventoryDigest };
    const recordPath = join(s.accountRoot, "alternate.json"), text = JSON.stringify(record); writeFileSync(recordPath, text);
    const capability = createSingleReplayAuthorizationLoader({ accountRoot: s.accountRoot, parentCampaignRoot, reviewedRecordSha256: sha(text), reviewedOwnerApprovalSha256: record.ownerApprovalSha256 })(recordPath, process.cwd());
    await expect(runSingleReplay(capability, async () => { calls++; return { status: 500, body: "{}", rawResponseBytes: 2 }; })).rejects.toThrow("SINGLE_REPLAY_ALREADY_ADMITTED");
    expect(calls).toBe(1);
  } finally { s.cleanup(); }
});
it("trusted loader rejects a different root from the executing module checkout", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "other-checkout-")));
  try { expect(() => loadTrustedSingleReplay(root)).toThrow("SINGLE_REPLAY_EXECUTING_ROOT_MISMATCH"); }
  finally { rmSync(root, { recursive: true, force: true }); }
});
it.each(["REPLACEMENT_APPROVAL", "AUTHENTIC_APPROVAL_COPIED_CHECKOUT"] as const)("trusted source authority rejects %s", attack => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "replay-trusted-clone-")));
  const env = { PATH: "/opt/homebrew/bin:/usr/bin:/bin", TMPDIR: "/tmp", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" } as unknown as NodeJS.ProcessEnv;
  try {
    execFileSync("git", ["clone", "--local", "--shared", "--no-hardlinks", "--quiet", process.cwd(), root], { env });
    writeFileSync(join(root, ".git/info/exclude"), "node_modules/\n.superpowers/\n");
    cpSync(join(process.cwd(), "tools/benchmark"), join(root, "tools/benchmark"), { recursive: true });
    const accountRoot = join(root, ".superpowers/sdd/2026-09-28-llm-context-contract-implementation"), parentCampaignRoot = join(accountRoot, "t11-inference-resume-03b8896-20261003");
    if (attack === "REPLACEMENT_APPROVAL") {
      // A synthetic local source fixture anchors its own disposable namespace
      // so this case still independently exercises the real owner digest gate.
      // The copied-checkout attack below retains the production source anchor.
      const modulePath = join(root, "tools/benchmark/context-contract-single-replay.ts");
      writeFileSync(modulePath, readFileSync(modulePath, "utf8").replace(
        '"/Users/bichtuyen/code/calenote/.worktrees/product-experience-v2/.superpowers/sdd/2026-09-28-llm-context-contract-implementation"', JSON.stringify(accountRoot)));
    }
    execFileSync("git", ["-C", root, "add", "tools/benchmark"], { env });
    execFileSync("git", ["-C", root, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "-c", "core.hooksPath=/dev/null", "commit", "--quiet", "-m", "Local trusted-loader fixture"], { env });
    symlinkSync(join(process.cwd(), "node_modules"), join(root, "node_modules"), "dir");
    const historical = join(parentCampaignRoot, "PILOT"); mkdirSync(historical, { recursive: true });
    appendCampaignEvent(historical, { event: "BEGIN", runId: "old", sourceSha: "a".repeat(40), profile: "PILOT", provenanceDigest: "b".repeat(64), cumulativeAuthorizedMicrounits: 1500000, cumulativeRetainedMicrounits: 0, startedAt: 1 });
    appendCampaignEvent(historical, { event: "STOP", runId: "old", at: 1, reason: "OLD_STOP" });
    const approvalPath = join(accountRoot, "owner.txt");
    const originalApproval = "Tôi xác nhận cho phép chạy đúng một T11 R01 diagnostic replay cho candidate `0631ba97ae237711c10568ed16a4cb697cf5a621`, dùng inference credential hiện tại và ngân sách T11 hiện tại. Không tăng/reset budget, không release UNKNOWN holds, không đổi model/provider, không retry lần hai, không push/deploy.\n";
    writeFileSync(approvalPath, attack === "REPLACEMENT_APPROVAL" ? "fake replacement owner approval" : originalApproval);
    const proof = singleReplayCandidateProof(root, SINGLE_REPLAY_CANDIDATE), approvalHash = sha(readFileSync(approvalPath, "utf8"));
    const record = { version: "single-t11-replay-1", operation: "SINGLE_T11_R01_DIAGNOSTIC_REPLAY", ...proof,
      historicalInventorySha256: auditCampaignAccountRoot(accountRoot).inventoryDigest, accountRoot, parentCampaignRoot,
      executionKey: singleReplayExecutionKey(approvalHash), ownerApprovalPath: approvalPath, ownerApprovalSha256: approvalHash,
      model: "google/gemini-2.5-flash-lite", provider: "google-vertex/eu", maxProviderHttpRequests: 1, retry: 0, fallback: "none" };
    const recordPath = join(accountRoot, "admission.json"), recordText = JSON.stringify(record); writeFileSync(recordPath, recordText);
    const trustedDirectory = join(accountRoot, "trusted-orchestration"); mkdirSync(trustedDirectory);
    writeFileSync(join(trustedDirectory, "single-replay-bootstrap.json"), JSON.stringify({ version: "single-replay-bootstrap-1", recordPath,
      reviewedRecordSha256: sha(recordText), reviewedOwnerApprovalSha256: approvalHash, accountRoot, parentCampaignRoot }));
    const output = execFileSync(process.execPath, ["--experimental-strip-types", "--import", "./tools/benchmark/register-conversation-loader.mjs", "--input-type=module", "-e",
      'import {loadTrustedSingleReplay,inspectSingleReplay} from "./tools/benchmark/context-contract-single-replay.ts"; try {inspectSingleReplay(loadTrustedSingleReplay(process.cwd()));console.log("READY")}catch(e){console.log(e.message)}'],
      { cwd: root, env, encoding: "utf8" });
    expect(output.trim()).toBe("SINGLE_REPLAY_SOURCE_AUTHORITY_MISMATCH");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
it("real directory fsync covers every newly linked ancestor before provider dispatch", async () => {
  const s = setup(), synced = new Set<string>(), actualFsync = fs.fsyncSync;
  let syncedBeforeDispatch: boolean[] = [], persistedBeforeDispatch: string[] = [];
  const spy = vi.spyOn(fs, "fsyncSync").mockImplementation(descriptor => {
    const stat = fs.fstatSync(descriptor); if (stat.isDirectory()) synced.add(`${stat.dev}:${stat.ino}`);
    actualFsync(descriptor);
  });
  syncBuiltinESMExports();
  try {
    const result = await runSingleReplay(s.load(), async () => {
      const parent = join(s.parentCampaignRoot, "single-replay-executions"), execution = join(parent, s.record.executionKey), leaf = join(execution, "PILOT");
      syncedBeforeDispatch = [s.accountRoot, s.parentCampaignRoot, parent, execution, leaf].map(path => {
        const stat = fs.statSync(path); return synced.has(`${stat.dev}:${stat.ino}`);
      });
      persistedBeforeDispatch = readCampaignLedger(leaf).map(row => row.event);
      return { status: 500, body: "{}", rawResponseBytes: 2 };
    });
    expect(result.providerHttpRequests).toBe(1);
    expect(syncedBeforeDispatch).toEqual([true, true, true, true, true]);
    expect(persistedBeforeDispatch).toEqual(["BEGIN", "RESERVE", "DISPATCH"]);
  } finally { spy.mockRestore(); syncBuiltinESMExports(); s.cleanup(); }
});

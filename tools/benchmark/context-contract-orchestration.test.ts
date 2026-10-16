// @vitest-environment node
import { it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdtempSync, realpathSync, existsSync, rmSync, mkdirSync, writeFileSync, copyFileSync, cpSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as orchestration from "./context-contract-orchestration";
import { encodeFixtureV3, frozenContextProposal } from "./context-pointer-fixtures";
import type { ContextInput } from "../../src/modules/conversation/context-contract/contracts";
import { execFileSync } from "node:child_process";
const safeEnv = { PATH: "/opt/homebrew/bin:/usr/bin:/bin", TMPDIR: "/tmp", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" } as unknown as NodeJS.ProcessEnv;
let cleanRoot: string;
beforeAll(() => {
  cleanRoot = realpathSync(mkdtempSync(join(tmpdir(), "t11-clean-git-")));
  execFileSync("git", ["clone", "--local", "--shared", "--no-hardlinks", "--quiet", process.cwd(), cleanRoot], { env: safeEnv });
  // Tooling now consumes staged LIST application modules. Snapshot the whole
  // runtime with its tooling, never a hybrid with the historical application.
  cpSync(join(process.cwd(), "src"), join(cleanRoot, "src"), { recursive: true });
  // Snapshot the runner's changed tooling dependencies together. A hybrid of
  // working runner and historical oracle/probe is not a runnable clean fixture.
  for (const path of ["context-contract.ts", "context-contract-probe.ts", "context-pointer-fixtures.ts", "context-contract-live.ts", "context-contract-runner.ts", "context-seed.ts", "context-query-diagnostics.ts", "context-contract-orchestration.ts", "context-contract-orchestration.test.ts", "run-context-contract-live.mjs"])
    copyFileSync(join(process.cwd(), "tools", "benchmark", path), join(cleanRoot, "tools", "benchmark", path));
  mkdirSync(join(cleanRoot,"tools/benchmark/fixtures"),{recursive:true});
  copyFileSync(join(process.cwd(),"tools/benchmark/fixtures/trusted-context-checkpoints.json"),join(cleanRoot,"tools/benchmark/fixtures/trusted-context-checkpoints.json"));
  execFileSync("git", ["-C", cleanRoot, "add", "tools/benchmark", "src"], { env: safeEnv });
  execFileSync("git", ["-C", cleanRoot, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "-c", "core.hooksPath=/dev/null", "commit", "--allow-empty", "--quiet", "-m", "Synthetic local orchestration fixture"], { env: safeEnv });
  // Local installed dependencies only; clone has no workstation bootstrap.
  symlinkSync(join(process.cwd(), "node_modules"), join(cleanRoot, "node_modules"), "dir");
});
afterAll(() => rmSync(cleanRoot, { recursive: true, force: true }));

it("already committed clean fixture supports the real configured orchestration control without source edits", () => {
  const output = execFileSync(process.execPath, [join(cleanRoot, "node_modules/vitest/vitest.mjs"), "run",
    "tools/benchmark/context-contract-orchestration.test.ts", "-t", "real clean source and trusted loader configure authority"],
    { cwd: cleanRoot, env: safeEnv, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  expect(output).toContain("1 passed");
});

function syntheticBootstrap() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "t11-approved-"))), target = join(root, "attempt", "PILOT");
  mkdirSync(target, { recursive: true });
  const p = preflightContextCampaign({ root: cleanRoot }), now = Date.now();
  const record = { version: "context-contract-live-3", method: "OBSERVABLE_CANARY", authorizationId: "synthetic-fixture-only", account: "PILOT",
    sourceSha: p.sourceSha, provenanceDigest: p.provenanceDigest, protocolDigest: p.protocolDigest, corpusDigest: p.corpusDigest,
    runId: "attempt", approvedAt: now - 1000, startedAt: now - 100, expiresAt: now + 60000, priorLedgers: [], pilotLedger: null };
  const text = JSON.stringify(record), ownerRecordPath = join(root, "owner.json"); writeFileSync(ownerRecordPath, text);
  const bootstrap: orchestration.TrustedContextBootstrap = { version: "context-contract-trusted-orchestration-1", candidateSha: p.sourceSha,
    provenanceDigest: p.provenanceDigest, contractDigest: orchestration.computeContextExecutionContract(cleanRoot).contractDigest,
    accountRoot: root, targetDirectory: target, ownerRecordPath, reviewedOwnerRecordSha256: createHash("sha256").update(text).digest("hex"),
    inventoryDigest: auditCampaignAccountRoot(root, target).inventoryDigest, paidConfirmation: "PENDING" };
  const confirm = () => {
    const paid = { version: "context-contract-paid-confirmation-1", status: "CONFIRMED", candidateSha: bootstrap.candidateSha,
      provenanceDigest: bootstrap.provenanceDigest, contractDigest: bootstrap.contractDigest, ownerRecordSha256: bootstrap.reviewedOwnerRecordSha256,
      accountRoot: root, inventoryDigest: bootstrap.inventoryDigest, targetDirectory: target, runId: "attempt", profile: "PILOT", approvedAt: now - 50, expiresAt: now + 50000 };
    const recordPath = join(root, "paid.json"), body = JSON.stringify(paid); writeFileSync(recordPath, body);
    bootstrap.paidConfirmation = { status: "CONFIRMED", recordPath, reviewedSha256: createHash("sha256").update(body).digest("hex") };
    return paid;
  };
  return { root, target, bootstrap, confirm };
}

it("real clean source and trusted loader configure authority while credentials and paid approval remain absent", async () => {
  const f = syntheticBootstrap();
  try { const result = await orchestration.preflightTrustedContextCampaign(cleanRoot, f.bootstrap, Date.now());
    expect(result.authorizationStatus).toBe("CONFIGURED"); expect(result.credentialStatus).toBe("CREDENTIAL_MISSING");
    expect(result.reason).toBe("CREDENTIAL_MISSING"); expect(readCampaignLedger(f.target)).toHaveLength(0);
    await expect(orchestration.runTrustedContextCampaign(cleanRoot, f.bootstrap, () => { throw new Error("SECRET_READ"); })).rejects.toThrow("PAID_CONFIRMATION_PENDING");
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

it.each(["candidateSha", "provenanceDigest", "contractDigest", "reviewedOwnerRecordSha256", "inventoryDigest"] as const)("pin substitution %s rejects before credentials or financial writes", async field => {
  const f = syntheticBootstrap();
  try { f.bootstrap[field] = "0".repeat(field === "candidateSha" ? 40 : 64);
    const result = await orchestration.preflightTrustedContextCampaign(cleanRoot, f.bootstrap, Date.now());
    expect(result.authorizationStatus).toBe("AUTHORIZATION_MISMATCH"); expect(readCampaignLedger(f.target)).toHaveLength(0);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

it("separately confirmed fake execution records one UNKNOWN dispatch, fences restart and never retries", async () => {
  const f = syntheticBootstrap();
  try { f.confirm(); let requests = 0;
    const result = await orchestration.runTrustedContextCampaign(cleanRoot, f.bootstrap, () => "SYNTHETIC_SENTINEL", async () => { requests++; throw new Error("synthetic timeout"); });
    expect(result.status).toBe("STOP"); expect(requests).toBe(1);
    const rows = readCampaignLedger(f.target); expect(rows.filter(r => r.event === "DISPATCH")).toHaveLength(1);
    expect(auditCampaignAccountRoot(f.root).totals.PILOT.retainedMicrounits).toBe(105472);
    await expect(orchestration.runTrustedContextCampaign(cleanRoot, f.bootstrap, () => { throw new Error("SECRET_READ"); })).rejects.toThrow();
    expect(requests).toBe(1);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

it.each(["candidateSha", "contractDigest", "ownerRecordSha256", "accountRoot", "inventoryDigest", "targetDirectory", "runId", "expiresAt"])("separate paid confirmation binds %s before credential input", async field => {
  const f = syntheticBootstrap();
  try {
    const paid = f.confirm() as Record<string, unknown>;
    paid[field] = field === "expiresAt" ? 0 : "wrong";
    const reference = f.bootstrap.paidConfirmation;
    if (reference === "PENDING") throw new Error("fixture");
    const body = JSON.stringify(paid); writeFileSync(reference.recordPath, body);
    reference.reviewedSha256 = createHash("sha256").update(body).digest("hex");
    await expect(orchestration.runTrustedContextCampaign(cleanRoot, f.bootstrap, () => { throw new Error("SECRET_READ"); })).rejects.toThrow();
    expect(readCampaignLedger(f.target)).toHaveLength(0);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

it("missing confirmed credential input creates no financial rows", async () => {
  const f = syntheticBootstrap();
  try { f.confirm();
    await expect(orchestration.runTrustedContextCampaign(cleanRoot, f.bootstrap, () => "")).rejects.toThrow("CREDENTIAL_MISSING");
    expect(readCampaignLedger(f.target)).toHaveLength(0);
    expect(existsSync(join(f.root, "account.lock"))).toBe(false);
    const retry = await orchestration.runTrustedContextCampaign(cleanRoot, f.bootstrap, () => "SYNTHETIC_SENTINEL", async () => { throw new Error("synthetic timeout"); });
    expect(retry.status).toBe("STOP");
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

it("paid expiry reached during locked admission reads no credential and writes no financial rows", async () => {
  const f = syntheticBootstrap(), paid = f.confirm(), before = Date.now(); let secretReads = 0;
  const clock = vi.spyOn(Date, "now").mockImplementation(() => existsSync(join(f.root, "account.lock")) ? paid.expiresAt + 1 : before);
  try {
    await expect(orchestration.runTrustedContextCampaign(cleanRoot, f.bootstrap, () => { secretReads++; return "SYNTHETIC"; }, async () => { throw new Error("fake"); })).rejects.toThrow();
    expect(secretReads).toBe(0); expect(readCampaignLedger(f.target)).toHaveLength(0); expect(existsSync(join(f.root, "account.lock"))).toBe(false);
  } finally { clock.mockRestore(); rmSync(f.root, { recursive: true, force: true }); }
});

it("paid clock expiring after validation but immediately before credential input still rejects with zero rows", async () => {
  const f = syntheticBootstrap(), paid = f.confirm(), before = Date.now(); let lockedClockReads = 0, secretReads = 0;
  const clock = vi.spyOn(Date, "now").mockImplementation(() => {
    if (existsSync(join(f.root, "account.lock")) && ++lockedClockReads >= 4) return paid.expiresAt + 1;
    return before;
  });
  try {
    await expect(orchestration.runTrustedContextCampaign(cleanRoot, f.bootstrap, () => { secretReads++; return "SYNTHETIC"; }, async () => { throw new Error("fake"); })).rejects.toThrow();
    expect(secretReads).toBe(0); expect(readCampaignLedger(f.target)).toHaveLength(0); expect(existsSync(join(f.root, "account.lock"))).toBe(false);
  } finally { clock.mockRestore(); rmSync(f.root, { recursive: true, force: true }); }
});

it("paid record substitution at the locked boundary rejects before credential input and BEGIN", async () => {
  const f = syntheticBootstrap(); f.confirm(); const before = Date.now(); let secretReads = 0, replaced = false;
  const reference = f.bootstrap.paidConfirmation; if (reference === "PENDING") throw new Error("fixture");
  const clock = vi.spyOn(Date, "now").mockImplementation(() => {
    if (!replaced && existsSync(join(f.root, "account.lock"))) { replaced = true; writeFileSync(reference.recordPath, "{}"); }
    return before;
  });
  try {
    await expect(orchestration.runTrustedContextCampaign(cleanRoot, f.bootstrap, () => { secretReads++; return "SYNTHETIC"; }, async () => { throw new Error("fake"); })).rejects.toThrow("PAID_CONFIRMATION_MISMATCH");
    expect(replaced).toBe(true); expect(secretReads).toBe(0); expect(readCampaignLedger(f.target)).toHaveLength(0); expect(existsSync(join(f.root, "account.lock"))).toBe(false);
  } finally { clock.mockRestore(); rmSync(f.root, { recursive: true, force: true }); }
});

it("earlier paid deadline between successful calls prohibits the next reserve and dispatch while keeping owner BEGIN intact", async () => {
  const f = syntheticBootstrap(), paid = f.confirm(); let time = Date.now(), requests = 0;
  const clock = vi.spyOn(Date, "now").mockImplementation(() => time);
  try {
    const result = await orchestration.runTrustedContextCampaign(cleanRoot, f.bootstrap, () => "SYNTHETIC", async request => {
      const index = requests++;
      if (index > 0) throw new Error("unexpected second dispatch");
      const input = JSON.parse(request.messages[1].content) as ContextInput;
      const body = JSON.stringify({ model: request.model, provider: "Google", id: "gen-paid-clock", usage: { cost: .000001, prompt_tokens: 1, completion_tokens: 1 },
        choices: [{ finish_reason: "stop", message: { content: JSON.stringify(encodeFixtureV3(frozenContextProposal(input, "R01", 0))) } }] });
      time = paid.expiresAt + 1;
      return { status: 200, body, rawResponseBytes: new TextEncoder().encode(body).length };
    });
    expect(result.status).toBe("STOP"); expect(requests).toBe(1);
    const rows = readCampaignLedger(f.target);
    expect(rows.filter(r => r.event === "RESERVE")).toHaveLength(1); expect(rows.filter(r => r.event === "DISPATCH")).toHaveLength(1);
    expect(rows.filter(r => r.event === "FINISH")).toHaveLength(1);
    expect(rows[0].event === "BEGIN" && rows[0].expiresAt).toBe(paid.expiresAt + 10000);
  } finally { clock.mockRestore(); rmSync(f.root, { recursive: true, force: true }); }
});
import { createHash } from "node:crypto";
import { appendCampaignEvent, reserveCampaignCall, markCampaignDispatched, finishCampaignCall, readCampaignLedger, auditCampaignAccountRoot, createCampaignAuthorizationLoader, preflightContextCampaign } from "./context-contract-live";

it("account root lock excludes concurrent admissions and keeps an abnormal execution fenced", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "t11-lock-")));
  try {
    await orchestration.withAccountRootLock(root, async () => {
      await expect(orchestration.withAccountRootLock(root, async () => 1)).rejects.toThrow("ACCOUNT_LOCKED");
      expect(existsSync(join(root, "account.lock"))).toBe(true);
    });
    expect(existsSync(join(root, "account.lock"))).toBe(false);
    await expect(orchestration.withAccountRootLock(root, async () => { throw new Error("crash"); })).rejects.toThrow("crash");
    await expect(orchestration.withAccountRootLock(root, async () => 1)).rejects.toThrow("ACCOUNT_LOCKED");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

it("a different actual process cannot admit while the shared account root is held", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "t11-process-")));
  try { await orchestration.withAccountRootLock(root, async () => {
    const result = execFileSync(process.execPath, ["--experimental-strip-types", "--import", "./tools/benchmark/register-conversation-loader.mjs", "--input-type=module", "-e",
      `import { withAccountRootLock } from './tools/benchmark/context-contract-live.ts'; try { await withAccountRootLock(${JSON.stringify(root)}, async()=>1); process.exitCode=9; } catch(e) { console.log(e.message); }`],
      { cwd: process.cwd(), env: safeEnv, encoding: "utf8" });
    expect(result.trim()).toBe("ACCOUNT_LOCKED");
  }); } finally { rmSync(root, { recursive: true, force: true }); }
});

it.each([false, true])("process termination after durable reserve (dispatch=%s) preserves the fence and full unknown hold", dispatch => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "t11-crash-"))), target = join(root, "attempt", "PILOT");
  mkdirSync(target, { recursive: true });
  try {
    expect(() => execFileSync(process.execPath, ["--experimental-strip-types", "--import", "./tools/benchmark/register-conversation-loader.mjs", "--input-type=module", "-e",
      `import { withAccountRootLock,appendCampaignEvent,reserveCampaignCall,markCampaignDispatched } from './tools/benchmark/context-contract-live.ts';
       await withAccountRootLock(${JSON.stringify(root)},async()=>{
         const directory=${JSON.stringify(target)};
         appendCampaignEvent(directory,{event:'BEGIN',runId:'crash',sourceSha:'a'.repeat(40),profile:'PILOT',provenanceDigest:'b'.repeat(64),cumulativeAuthorizedMicrounits:1500000,cumulativeRetainedMicrounits:0,startedAt:0});
         reserveCampaignCall(directory,{runId:'crash',profile:'PILOT',provenanceDigest:'b'.repeat(64),reservationId:'held',maximumMicrounits:100,now:1,startedAt:0});
         ${dispatch ? "markCampaignDispatched(directory,{runId:'crash',reservationId:'held',at:1});" : ""}
         process.exit(7);
       });`], { env: safeEnv, stdio: "pipe" })).toThrow();
    expect(existsSync(join(root, "account.lock"))).toBe(true);
    expect(auditCampaignAccountRoot(root).totals.PILOT).toEqual({ retainedMicrounits: 100, unknownMicrounits: 100, calls: 1 });
    expect(readCampaignLedger(target).filter(r => r.event === "DISPATCH")).toHaveLength(dispatch ? 1 : 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

it("actual CLI preflight never touches credential environment and keeps authority independent", () => {
  expect(existsSync(join(cleanRoot, orchestration.trustedBootstrapRelativePath))).toBe(false);
  const result = execFileSync(process.execPath, ["--experimental-strip-types", "--import", "./tools/benchmark/register-conversation-loader.mjs", "--input-type=module", "-e",
    `const original=process.env; process.env=new Proxy(original,{get(target,key){if(key==='OPENROUTER_API_KEY')throw new Error('SECRET_READ');return target[key];}});
     process.argv=['node','run-context-contract-live.mjs','--preflight']; await import('./tools/benchmark/run-context-contract-live.mjs');`],
    { cwd: cleanRoot, env: safeEnv, encoding: "utf8" });
  const observed = JSON.parse(result);
  expect(observed.authorizationStatus).toBe("AUTHORIZATION_NOT_CONFIGURED");
  expect(observed.credentialStatus).toBe("CREDENTIAL_MISSING");
  expect(observed.secretReads).toBe(0); expect(observed.networkRequests).toBe(0);
});

it("shared stage inventory carries prior unknown and known holds without inherited BEGIN double count", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "t11-shared-")));
  try {
    for (const profile of ["PILOT", "FULL"] as const) {
      const dir = join(root, "prior", profile); mkdirSync(dir, { recursive: true });
      appendCampaignEvent(dir, { event: "BEGIN", runId: "prior", sourceSha: "a".repeat(40), profile, provenanceDigest: "b".repeat(64), cumulativeAuthorizedMicrounits: 2500000, cumulativeRetainedMicrounits: 1234, startedAt: 0 });
      reserveCampaignCall(dir, { runId: "prior", profile, provenanceDigest: "b".repeat(64), reservationId: "held", maximumMicrounits: 100, now: 1, startedAt: 0 });
      if (profile === "FULL") { markCampaignDispatched(dir, { runId: "prior", reservationId: "held", at: 1 }); finishCampaignCall(dir, { runId: "prior", reservationId: "held", at: 1, observedMicrounits: 7 }); }
    }
    const target = join(root, "new", "FULL"); mkdirSync(target, { recursive: true });
    const audit = auditCampaignAccountRoot(root, target);
    expect(audit.totals.PILOT).toEqual({ retainedMicrounits: 100, unknownMicrounits: 100, calls: 1 });
    expect(audit.totals.FULL).toEqual({ retainedMicrounits: 7, unknownMicrounits: 0, calls: 1 });
    const p = preflightContextCampaign({ root: process.cwd() });
    const record = { version: "context-contract-live-3", method: "OBSERVABLE_CANARY", authorizationId: "synthetic", account: "FULL", sourceSha: p.sourceSha, provenanceDigest: p.provenanceDigest, protocolDigest: p.protocolDigest, corpusDigest: p.corpusDigest,
      runId: "new", approvedAt: 0, startedAt: 1, expiresAt: 1000, priorLedgers: audit.bindings.filter(b => b.account === "FULL").map(({ directory, finalHash }) => ({ directory, finalHash })), pilotLedger: null };
    const pin = createHash("sha256").update(JSON.stringify(record)).digest("hex");
    expect(createCampaignAuthorizationLoader({ accountRoot: root, reviewedOwnerRecordSha256: pin, reviewedAccountInventorySha256: audit.inventoryDigest }).load(record, target)).toBeTruthy();
    expect(() => createCampaignAuthorizationLoader({ accountRoot: root, reviewedOwnerRecordSha256: pin }).load(record, target)).toThrow("PRIOR_LEDGER_INVENTORY");
    const rows = readCampaignLedger(join(root, "prior", "PILOT"));
    writeFileSync(join(root, "prior", "PILOT", "campaign.jsonl"), JSON.stringify({ ...rows[0], hash: "0".repeat(64) }) + "\n");
    expect(() => auditCampaignAccountRoot(root, target)).toThrow("LEDGER_PROVENANCE_CORRUPT");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

it("unconfigured preflight reports credential missing separately without reading a secret", async () => {
  const result = await orchestration.preflightTrustedContextCampaign(process.cwd(), undefined, Date.now());
  expect(result.authorizationStatus).toBe("AUTHORIZATION_NOT_CONFIGURED");
  expect(result.credentialStatus).toBe("CREDENTIAL_MISSING");
  expect(result.secretReads).toBe(0);
  expect(result.networkRequests).toBe(0);
  expect(result.paidConfirmation).toBe("PENDING");
});

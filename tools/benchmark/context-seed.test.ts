// @vitest-environment node
import { it, expect } from "vitest";
import { resolveSingleValidationTarget } from "./context-contract-runner";
import { createContextContractProbe } from "./context-contract-probe";
import { frozenContextProposal } from "./context-contract-fixtures";
import { diagnoseContextTurn } from "./context-contract";
import { deriveContextSeed, normalizedSeedJson } from "./context-seed";
import { readFileSync } from "node:fs";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

it("rejects changed checkpoint source provenance without silently reseeding", () => {
  const root = mkdtempSync(join(tmpdir(), "seed-provenance-"));
  try {
    mkdirSync(join(root,"tools/benchmark/fixtures"),{recursive:true});
    const registry = JSON.parse(readFileSync("tools/benchmark/fixtures/trusted-context-checkpoints.json","utf8"));
    registry.checkpoints[0].sourceRevision = "a".repeat(40);
    writeFileSync(join(root,"tools/benchmark/fixtures/trusted-context-checkpoints.json"),JSON.stringify(registry));
    const manifest = JSON.parse(readFileSync("src/modules/conversation/context-contract/benchmark/regressions.json","utf8"));
    expect(()=>deriveContextSeed(root,manifest.cases[0],1)).toThrow("CONTEXT_SEED_SOURCE_REVISION_INVALID");
  } finally { rmSync(root,{recursive:true,force:true}); }
});

it("rejects a schema-valid snapshot whose database revision disagrees before any gateway preparation", async () => {
  const target = resolveSingleValidationTarget(process.cwd(), {fixture:"R01",turn:1});
  const state = structuredClone(target.contextSeed.state)!;
  state.contexts[0].revision = 2;
  let calls = 0;
  await expect(createContextContractProbe({sourceSha:"d861b9bbffdd73d6d1251805538c404fd56c7a44",referenceNow:Date.parse("2026-09-28T03:00:00Z"),contextSeed:state},()=>{calls++;throw Error("must not prepare");})).rejects.toThrow("CONTEXT_SEED_APPLICATION_READBACK_FAILED");
  expect(calls).toBe(0);
});

it("binds only the prerequisite, not a changed target oracle, into seed identity", () => {
  const manifest = JSON.parse(readFileSync("src/modules/conversation/context-contract/benchmark/regressions.json", "utf8"));
  const script = manifest.cases[0];
  const original = deriveContextSeed(process.cwd(), script, 1);
  script.turns[1].expect.queryRange = { start: 0, end: 1 };
  script.turns[1].expect.status = "NOT_A_SEED_INPUT";
  expect(deriveContextSeed(process.cwd(), script, 1).contextSeedDigest).toBe(original.contextSeedDigest);
  expect(normalizedSeedJson({ b: 1, a: [2, 3] })).toBe(normalizedSeedJson({ a: [2, 3], b: 1 }));
  script.turns[0].text = "changed prior user turn";
  expect(() => deriveContextSeed(process.cwd(), script, 1)).toThrow("CONTEXT_SEED_PREREQUISITE_CHANGED");
});

it.each([["R01",1],["R02",1],["R05",2]] as const)("fixture-owned %s/%s checkpoint equals its accepted local prerequisite application state", async (fixture, targetTurn) => {
  const manifest = JSON.parse(readFileSync("src/modules/conversation/context-contract/benchmark/regressions.json", "utf8"));
  const script = manifest.cases.find((s: { id: string }) => s.id === fixture);
  let turn = 0;
  const probe = await createContextContractProbe({ sourceSha: "d861b9bbffdd73d6d1251805538c404fd56c7a44", referenceNow: Date.parse(script.turns[0].receipt) }, input => frozenContextProposal(input, fixture, turn));
  try {
    for (; turn < targetTurn; turn++) {
      const prior = script.turns[turn];
      const observed = await probe.turn(prior.text, prior.receipt);
      expect(diagnoseContextTurn(prior, observed).failedAssertionCount).toBe(0);
    }
    const actual = await probe.checkpoint();
    const expected=deriveContextSeed(process.cwd(), script, targetTurn).contextSeed.state;
    // Attempt observation hashes bind the decoder protocol, not semantic
    // checkpoint content. The immutable seed retains its historical protocol;
    // compare semantic state while separately requiring a valid current hash.
    if(actual.snapshot?.modelAttemptBinding && expected?.snapshot?.modelAttemptBinding) {
      expect(actual.snapshot.modelAttemptBinding.observationId).toMatch(/^[a-f0-9]{64}$/u);
      actual.snapshot.modelAttemptBinding.observationId=expected.snapshot.modelAttemptBinding.observationId;
    }
    if (actual.snapshot?.modelAttemptBinding) actual.snapshot.modelAttemptBinding.attemptId = "seed-attempt";
    for (const row of actual.outcomes) row.proof_hash = null;
    expect(actual).toEqual(expected);
  } finally { probe.dispose(); }
});

it.each([["R01", 1, "REMINDERS_LISTED"], ["R02", 1, "CLARIFICATION_REQUESTED"], ["R05", 2, "DRAFT_CREATED"]] as const)("hydrates %s turn %s without a prerequisite gateway dispatch", async (fixture, turn, status) => {
  const target = resolveSingleValidationTarget(process.cwd(), { fixture, turn });
  const config = { sourceSha: "d861b9bbffdd73d6d1251805538c404fd56c7a44", referenceNow: Date.parse("2026-09-28T03:00:00Z"), contextSeed: target.contextSeed.state };
  let fixtureCalls = 0;
  const probe = await createContextContractProbe(config, input => { fixtureCalls++; return frozenContextProposal(input, fixture, turn); });
  try {
    expect(probe.inputs).toHaveLength(0);
    const selected = target.script.turns[0];
    const observed = await probe.turn(selected.text, selected.receipt);
    expect(observed.status).toBe(status);
    expect(diagnoseContextTurn(selected, observed).failedAssertionCount).toBe(0);
    expect(fixtureCalls).toBe(1);
    expect(probe.inputs).toHaveLength(1);
    if (fixture === "R01") expect(probe.inputs[0].pendingQuestion?.field).toBe("queryRange");
  } finally { probe.dispose(); }
});

it("captures accepted prior application state without retaining provider output", async () => {
  const probe = await createContextContractProbe({ sourceSha: "d861b9bbffdd73d6d1251805538c404fd56c7a44", referenceNow: Date.parse("2026-09-28T03:00:00Z") }, input => frozenContextProposal(input, "R01", 0));
  try {
    const observed = await probe.turn("Có lịch nào ko?", "2026-09-28T03:00:00Z");
    expect(observed.status).toBe("CLARIFICATION_REQUESTED");
    const checkpoint = await (probe as unknown as { checkpoint(): Promise<{ snapshot: { pendingQueryQuestion: { field: string } }; inbounds: unknown[] }> }).checkpoint();
    expect(checkpoint.snapshot.pendingQueryQuestion.field).toBe("queryRange");
    expect(checkpoint.inbounds).toHaveLength(2);
    expect(JSON.stringify(checkpoint)).not.toContain("choices");
  } finally { probe.dispose(); }
});

it("admits a canonical continuation with a trusted prior application seed, not the target month", () => {
  const target = resolveSingleValidationTarget(process.cwd(), { fixture: "R01", turn: 1 });
  expect(target.turn).toBe(1);
  expect(target).toHaveProperty("contextSeed");
  expect(target).toHaveProperty("contextSeedDigest");
  const seed = (target as unknown as { contextSeed: { snapshot: { pendingQueryQuestion: { field: string }; facts: unknown[] } } }).contextSeed;
  expect(seed.snapshot.pendingQueryQuestion.field).toBe("queryRange");
  expect(JSON.stringify(seed.snapshot.facts)).not.toContain("MONTH");
});

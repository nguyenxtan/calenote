import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildConversationProvenance, runConversationCorpus, summarizeConversationRun, verifyConversationProvenance } from "./conversation-v2";

const root = process.cwd();
const corpus = () => JSON.parse(readFileSync(resolve(root, "src/modules/conversation/benchmark/conversation-v2.json"), "utf8"));
afterEach(() => vi.unstubAllGlobals());

describe("Conversation V2 offline acceptance", () => {
  it("never promotes mock success to model or deployment acceptance", () => {
    expect(summarizeConversationRun({ transport: "MOCK", total: 1, passed: 1, safetyFailures: 0 }))
      .toMatchObject({ offlinePass: true, liveModelAccepted: false, deploymentAuthorized: false });
  });
  it.each([
    { total: 0, passed: 0, safetyFailures: 0 },
    { total: 2, passed: 1, safetyFailures: 0 },
    { total: 2, passed: 2, safetyFailures: 1 },
    { total: 1, passed: 2, safetyFailures: 0 },
    { total: 1.5, passed: 1.5, safetyFailures: 0 },
  ])("fails closed for invalid or incomplete accounting %j", counts => {
    expect(summarizeConversationRun({ transport: "MOCK", ...counts }).offlinePass).toBe(false);
  });
  it("executes the complete synthetic multi-turn corpus without network", () => {
    vi.stubGlobal("fetch", () => { throw new Error("OFFLINE_NETWORK_FORBIDDEN"); });
    const result = runConversationCorpus(corpus());
    expect(result.failures).toEqual([]);
    expect(result.total).toBeGreaterThanOrEqual(30);
    expect(result.passed).toBe(result.total);
    expect(result.offlinePass).toBe(true);
    expect(result.persistenceAcceptance).toBe("SEPARATE_D1_SUITE_REQUIRED");
    expect(result.liveModelAccepted).toBe(false);
  });
  it("scores temporal and dialogue denominators independently without dropping failures", () => {
    const altered = corpus();
    altered.cases[0].turns[0].expected.evidence.date = "2099-01-01";
    altered.cases[0].turns[0].expected.outcome = "HELP";
    const result = runConversationCorpus(altered);
    expect(result.offlinePass).toBe(false);
    expect(result.safetyFailures).toBe(1);
    expect(result.temporalPassed).toBe(result.total - 1);
    expect(result.dialoguePassed).toBe(result.total - 1);
    expect(result.failures[0].categories).toEqual(["TEMPORAL", "DIALOGUE"]);
    expect(JSON.stringify(result)).not.toContain("gọi mẹ");
  });
  it("rejects live transport, unknown fields and duplicate fixture IDs", () => {
    const live = corpus(); live.transport = "LIVE";
    expect(() => runConversationCorpus(live)).toThrow();
    const duplicate = corpus(); duplicate.cases.push(duplicate.cases[0]);
    expect(() => runConversationCorpus(duplicate)).toThrow();
    const injected = corpus(); injected.models.create.localDate = "2026-01-01";
    expect(() => runConversationCorpus(injected)).toThrow();
  });
  it("binds every acceptance dependency and rejects changed provenance", () => {
    const provenance = buildConversationProvenance(root);
    expect(verifyConversationProvenance(root, provenance)).toBe(true);
    for (const key of Object.keys(provenance.digests)) {
      const changed = structuredClone(provenance);
      changed.digests[key] = "0".repeat(64);
      expect(verifyConversationProvenance(root, changed)).toBe(false);
    }
    expect(Object.keys(provenance.digests).sort()).toEqual([
      "calendar", "config", "corpus", "migrations", "prompt", "reconciliation", "runtime", "schema", "scorer",
    ]);
  });
});

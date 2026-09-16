// @vitest-environment node
import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertCanonicalSyntheticFixtureIdentity,
  calculateSemanticBenchmarkMetrics,
  loadSyntheticSemanticFixture,
  renderOfflineBenchmarkEvidence,
  runOfflineSemanticBenchmark,
  type CandidateBenchmarkTransport,
  type SyntheticSemanticFixture,
} from "./semantic-v1";

const fixturePath = resolve(process.cwd(), "src/modules/semantic/benchmark/semantic-v1.json");
const runFile = promisify(execFile);

describe("semantic V1 offline benchmark scaffold", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("loads the frozen 216-case synthetic fixture reproducibly", async () => {
    const fixture = await loadSyntheticSemanticFixture(fixturePath);

    expect(fixture.version).toBe("semantic-v1-synthetic");
    expect(fixture.cases).toHaveLength(216);
    expect(fixture.cases.every((item) => item.id.startsWith("synthetic-"))).toBe(true);
  });

  it("rejects a noncanonical fixture path at the offline runner boundary", async () => {
    await expect(runOfflineSemanticBenchmark({ fixturePath: resolve(process.cwd(), "fixtures/semantic-v1.json") }))
      .rejects.toThrow("canonical fixture path");
  });

  it("rejects a canonical-path fixture with a count below the frozen 216 cases", async () => {
    const fixture = await loadSyntheticSemanticFixture(fixturePath);

    expect(() => assertCanonicalSyntheticFixtureIdentity(fixturePath, {
      ...fixture,
      cases: fixture.cases.slice(0, -1),
    })).toThrow("exactly 216");
  });

  it("rejects a canonical-path fixture whose synthetic identity differs", async () => {
    const fixture = await loadSyntheticSemanticFixture(fixturePath);
    const cases = fixture.cases.map((item, index) => index === 0 ? { ...item, id: "synthetic-tampered-001" } : item);

    expect(() => assertCanonicalSyntheticFixtureIdentity(fixturePath, { ...fixture, cases }))
      .toThrow("identity");
  });

  it("calculates aggregate schema, semantic, latency, and estimated-cost metrics without retaining outputs", () => {
    const fixture: SyntheticSemanticFixture = {
      version: "semantic-v1-synthetic",
      cases: [
        {
          id: "synthetic-create-001", category: "test", message: "synthetic only",
          interpretationReferenceTime: "2026-09-16T09:00:00+07:00", timezone: "Asia/Ho_Chi_Minh", priorContext: null,
          expected: { intent: "CREATE_REMINDER", title: "Việc", localDate: "2026-09-17", localTime: "09:00", timezone: "Asia/Ho_Chi_Minh", needsClarification: false },
          businessValidation: "ACCEPT",
        },
        {
          id: "synthetic-clarification-002", category: "test", message: "synthetic only",
          interpretationReferenceTime: "2026-09-16T09:00:00+07:00", timezone: "Asia/Ho_Chi_Minh", priorContext: null,
          expected: { intent: "NEEDS_CLARIFICATION", targetIntent: "CREATE_REMINDER", missingFields: ["time"], question: "Khi nào?" },
          businessValidation: "ACCEPT",
        },
      ],
    };

    const metrics = calculateSemanticBenchmarkMetrics(fixture, [
      {
        caseId: "synthetic-create-001", latencyMs: 10, estimatedCostMicrounits: 7,
        interpretation: { intent: "CREATE_REMINDER", title: "Việc", localDate: "2026-09-17", localTime: "09:00", timezone: "Asia/Ho_Chi_Minh", needsClarification: false },
      },
      {
        caseId: "synthetic-clarification-002", latencyMs: 30, estimatedCostMicrounits: 11,
        interpretation: { intent: "NEEDS_CLARIFICATION", targetIntent: "CREATE_REMINDER", missingFields: ["date"], question: "Khi nào?" },
      },
    ]);

    expect(metrics).toMatchObject({
      totalCases: 2, scoredCases: 2, missingCases: 0, schemaValidCases: 2,
      intentCorrectCases: 2, localDateCorrectCases: 1, localTimeCorrectCases: 1,
      titleCorrectCases: 1, clarificationCorrectCases: 0,
      p95LatencyMs: 30, estimatedCostMicrounits: 18,
    });
    expect(metrics.schemaValidRate).toBe(1);
    expect(metrics.clarificationCorrectRate).toBe(0);
  });

  it("runs the normal dry-run without calling an injected transport or global fetch", async () => {
    const transport: CandidateBenchmarkTransport = { interpret: vi.fn(async () => {
      throw new Error("the offline runner must not dispatch candidates");
    }) };
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);

    const result = await runOfflineSemanticBenchmark({ fixturePath, transport });

    expect(result.execution).toEqual({ mode: "OFFLINE_DRY_RUN", candidateTransportInvoked: false });
    expect(result.metrics).toMatchObject({
      totalCases: 216, scoredCases: 0, missingCases: 216, estimatedCostMicrounits: null,
      schemaValidRate: null, intentCorrectRate: null, localDateCorrectRate: null,
      localTimeCorrectRate: null, titleCorrectRate: null, clarificationCorrectRate: null,
    });
    expect(transport.interpret).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("renders evidence containing only safe aggregate metadata and never fixture prompts or interpretations", async () => {
    const result = await runOfflineSemanticBenchmark({ fixturePath });
    const evidence = renderOfflineBenchmarkEvidence(result);
    const fixture = await loadSyntheticSemanticFixture(fixturePath);

    expect(evidence).toContain("OFFLINE_DRY_RUN");
    expect(evidence).toContain("216");
    expect(evidence).toContain("No candidate was executed");
    for (const item of fixture.cases) {
      expect(evidence).not.toContain(item.message);
      expect(evidence).not.toContain(JSON.stringify(item.expected));
    }
    expect(evidence).not.toMatch(/api[_ -]?key|authorization|secret|prompt|response/iu);
  });

  it("has no environment or HTTP dependency in the offline runner source", async () => {
    const source = await readFile(new URL("./semantic-v1.ts", import.meta.url), "utf8");

    expect(source).not.toContain("process.env");
    expect(source).not.toMatch(/\bfetch\s*\(/u);
    expect(source).not.toMatch(/openrouter|authorization|api[_-]?key/iu);
  });

  it("keeps the normal CLI limited to the offline dry-run runner", async () => {
    const source = await readFile(new URL("./run-semantic-v1-offline.mjs", import.meta.url), "utf8");

    expect(source).toContain("runOfflineSemanticBenchmark");
    expect(source).not.toContain("process.env");
    expect(source).not.toMatch(/\bfetch\s*\(/u);
    expect(source).not.toMatch(/openrouter|authorization|api[_-]?key/iu);
  });

  it("executes the normal CLI as an offline dry-run", async () => {
    const output = await runFile(process.execPath, ["--experimental-strip-types", "--import", "./tools/benchmark/register-typescript-loader.mjs", "tools/benchmark/run-semantic-v1-offline.mjs"], {
      cwd: process.cwd(),
    });

    expect(output.stdout).toContain("Execution mode: OFFLINE_DRY_RUN");
    expect(output.stdout).toContain("No candidate was executed");
    expect(output.stderr).toBe("");
  });
});

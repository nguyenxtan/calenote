// @vitest-environment node
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CANONICAL_SEMANTIC_PROMPT } from "../../src/modules/intelligence/semantic-gateway";
import { ModelSemanticInterpretationJsonSchema } from "../../src/modules/semantic/contracts";
import { CANONICAL_SYNTHETIC_FIXTURE_PATH, loadSyntheticSemanticFixture } from "./semantic-v1";
import { createLiveSemanticBenchmarkRunner, createOpenRouterTransport, GEMINI_PILOT_CASE_IDS, type LiveBenchmarkOptions, type LiveBenchmarkTransport, type LiveSemanticJsonRequest } from "./live-semantic-v1";

const runFile = promisify(execFile);
const gemini = { candidateId: "gemini-2.5-flash-lite", model: "google/gemini-2.5-flash-lite", provider: "google-vertex/eu", reasoning: "OMIT", promptPriceMicrounitsPerMillionTokens: 100_000, completionPriceMicrounitsPerMillionTokens: 400_000 } as const;
const model = { intent: "HELP", title: null, titleState: "NOT_APPLICABLE", targetIntent: null };
const response = JSON.stringify({ choices: [{ message: { content: JSON.stringify(model) }, finish_reason: "stop" }], usage: { cost: 0.000001, prompt_tokens: 1, completion_tokens: 1 } });
const directories: string[] = [];
async function directory() { const path = await mkdtemp(join(tmpdir(), "calenote-live-benchmark-")); directories.push(path); return path; }
function options(stateDirectory: string, transport: LiveBenchmarkTransport, overrides: Partial<LiveBenchmarkOptions> = {}): LiveBenchmarkOptions {
  return { fixturePath: CANONICAL_SYNTHETIC_FIXTURE_PATH, stateDirectory, runId: "semantic-v1-hybrid-test",
    candidates: [gemini], transport, profile: "gemini-flash-lite-hybrid-pilot", ...overrides };
}
function runner(stateDirectory: string, transport: LiveBenchmarkTransport, overrides: Partial<LiveBenchmarkOptions> = {}) { return createLiveSemanticBenchmarkRunner(options(stateDirectory, transport, overrides)); }
function fakeTransport(body = response) { return vi.fn<LiveBenchmarkTransport>(async () => ({ status: 200, body })); }
afterEach(async () => { vi.unstubAllGlobals(); vi.doUnmock("node:fs"); vi.doUnmock("./semantic-v1"); vi.doUnmock("../../src/modules/intelligence/semantic-gateway"); vi.resetModules(); await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });

describe("hybrid live runner with local fake transport only", () => {
  it("rejects an oversized canonical request in preflight before ledger creation or dispatch", async () => {
    vi.resetModules();
    vi.doMock("../../src/modules/intelligence/semantic-gateway", async (original) => ({
      ...await original<typeof import("../../src/modules/intelligence/semantic-gateway")>(), CANONICAL_SEMANTIC_PROMPT: "x".repeat(12_001),
    }));
    const path = await directory(); const transport = fakeTransport();
    const create = (await import("./live-semantic-v1")).createLiveSemanticBenchmarkRunner;
    await expect(create(options(path, transport)).preflight({ apiKeyPresent: true })).rejects.toThrow("input token budget");
    expect(transport).not.toHaveBeenCalled();
    await expect(readFile(join(path, "semantic-v1-hybrid-test.json"))).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("emits canonical prompt/model schema/evidence and exact pinned no-fallback privacy envelope", async () => {
    const transport = fakeTransport();
    const result = await runner(await directory(), transport, { maxHttpRequests: 1 }).run({ apiKeyPresent: true });
    const request = transport.mock.calls[0]?.[0] as unknown as LiveSemanticJsonRequest;
    expect(result.requestCount).toBe(1);
    expect(request).toMatchObject({ model: gemini.model, stream: false, max_tokens: 256,
      provider: { only: [gemini.provider], allow_fallbacks: false, require_parameters: true, data_collection: "deny", zdr: true, max_price: { prompt: 0.1, completion: 0.4 } } });
    expect(request.messages[0]).toEqual({ role: "system", content: CANONICAL_SEMANTIC_PROMPT });
    expect(request.response_format.json_schema.schema).toEqual(ModelSemanticInterpretationJsonSchema);
    expect(JSON.parse(request.messages[1].content)).toMatchObject({ temporalEvidence: { date: { state: "RESOLVED", localDate: "2026-09-16" }, time: { state: "RESOLVED", localTime: "08:00" } } });
    for (const key of ["reasoning", "tools", "functions", "tool_choice", "function_call"]) expect(request).not.toHaveProperty(key);
  });

  it("sends only an injected sentinel in Authorization and rejects redirects", async () => {
    const transport = fakeTransport();
    await runner(await directory(), transport, { maxHttpRequests: 1 }).run({ apiKeyPresent: true });
    const request = transport.mock.calls[0]?.[0] as unknown as LiveSemanticJsonRequest;
    const sentinel = "SYNTHETIC_TEST_KEY";
    const fetcher = vi.fn<typeof fetch>(async () => new Response("{}", { status: 200 })); vi.stubGlobal("fetch", fetcher);
    await createOpenRouterTransport(sentinel)(request, { signal: new AbortController().signal });
    const init = fetcher.mock.calls[0]?.[1] as unknown as RequestInit;
    expect(init).toMatchObject({ redirect: "error", headers: { authorization: "Bearer SYNTHETIC_TEST_KEY" } });
    expect(String(init.body)).not.toContain(sentinel);
  });

  it("runs deterministic preflight before ledger creation or transport when evidence is wrong", async () => {
    vi.doMock("./semantic-v1", async (original) => {
      const source = await original<typeof import("./semantic-v1")>();
      return { ...source, loadSyntheticSemanticFixture: async (path: string) => {
        const fixture = await source.loadSyntheticSemanticFixture(path);
        fixture.cases[215].expectedTemporalEvidence.date = { state: "RESOLVED", source: "TODAY", localDate: "2026-09-16" };
        return fixture;
      } };
    });
    const path = await directory(); const transport = fakeTransport();
    const create = (await import("./live-semantic-v1")).createLiveSemanticBenchmarkRunner;
    await expect(create(options(path, transport)).run({ apiKeyPresent: true })).rejects.toThrow("temporal preflight");
    await expect(readFile(join(path, "semantic-v1-hybrid-test.json"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(transport).not.toHaveBeenCalled();
  });

  it("rejects historical IDs, schema versions, and corrupt ledgers without rewriting", async () => {
    const path = await directory(); const transport = fakeTransport();
    expect(() => runner(path, transport, { runId: "gemini-flash-lite-contract-v3-20260917-01" })).toThrow("historical IDs");
    const report = await runner(path, transport).preflight({ apiKeyPresent: false });
    const old = JSON.parse(await readFile(report.ledgerPath, "utf8")); old.schemaVersion = 1; old.benchmarkVersion = "live-semantic-v1-2";
    const source = JSON.stringify(old); await writeFile(report.ledgerPath, source);
    await expect(runner(path, transport).preflight({ apiKeyPresent: true })).rejects.toThrow("ledger");
    expect(await readFile(report.ledgerPath, "utf8")).toBe(source);
    expect(transport).not.toHaveBeenCalled();
  });

  it.each(["../../src/modules/semantic/temporal-evidence.ts", "../../src/modules/semantic/reconciliation.ts", "../../src/modules/semantic/contracts.ts", "./semantic-v1.ts"])("invalidates resume when provenance dependency %s changes", async (dependency) => {
    const path = await directory();
    const first = await runner(path, fakeTransport()).preflight({ apiKeyPresent: false });
    const before = await readFile(first.ledgerPath, "utf8");
    vi.doMock("node:fs", async (original) => {
      const fs = await original<typeof import("node:fs")>();
      return { ...fs, readFileSync: (file: URL, encoding: "utf8") => {
        const content = fs.readFileSync(file, encoding);
        return file.href === new URL(dependency, import.meta.url).href ? content + "\n// changed contract" : content;
      } };
    });
    const create = (await import("./live-semantic-v1")).createLiveSemanticBenchmarkRunner;
    await expect(create(options(path, fakeTransport())).preflight({ apiKeyPresent: false })).rejects.toThrow("ledger");
    expect(await readFile(first.ledgerPath, "utf8")).toBe(before);
  });

  it("rejects altered candidate, provider, price, profiles, subsets and cap increases", async () => {
    const path = await directory();
    for (const candidate of [{ ...gemini, provider: "google-vertex/global" }, { ...gemini, promptPriceMicrounitsPerMillionTokens: 1 }]) {
      expect(() => runner(path, fakeTransport(), { candidates: [candidate] })).toThrow();
    }
    for (const override of [{ maxHttpRequests: 41 }, { maxCostMicrounits: 100_001 }, { maxInputTokens: 11_999 }, { maxOutputTokens: 257 }, { caseIds: GEMINI_PILOT_CASE_IDS.slice(1) }]) {
      expect(() => runner(path, fakeTransport(), override)).toThrow();
    }
    expect(() => runner(path, fakeTransport(), { profile: "legacy-pair" as never })).toThrow("profile");
    expect(() => runner(path, fakeTransport(), { profile: "gemini-flash-lite-hybrid-full", maxHttpRequests: 221 })).toThrow("cap");
  });

  it("reserves durably before dispatch and resumes completed attempts exactly once", async () => {
    const path = await directory();
    const transport = vi.fn(async () => {
      const ledger = JSON.parse(await readFile(join(path, "semantic-v1-hybrid-test.json"), "utf8"));
      expect(ledger.attempts).toMatchObject([{ state: "DISPATCHED", reservedCostMicrounits: 1_303 }]);
      return { status: 200, body: response };
    });
    const first = await runner(path, transport, { maxHttpRequests: 1 }).run({ apiKeyPresent: true });
    const second = await runner(path, transport, { maxHttpRequests: 1 }).run({ apiKeyPresent: true });
    expect(first.metricsByCandidate[gemini.candidateId].scoredCases).toBe(1);
    expect(second.requestCount).toBe(1); expect(transport).toHaveBeenCalledTimes(1);
  });

  it.each(["DISPATCHED", "RESERVED"] as const)("recovers %s without retrying dispatched work or double-charging undelivered reservations", async (state) => {
    const path = await directory();
    const result = await runner(path, fakeTransport(), { maxHttpRequests: 1 }).run({ apiKeyPresent: true });
    const ledger = JSON.parse(await readFile(result.ledgerPath, "utf8"));
    ledger.attempts[0] = { candidateId: gemini.candidateId, caseId: GEMINI_PILOT_CASE_IDS[0], ordinal: 1, state, reservedAt: "2026-09-19T00:00:00.000Z", reservedCostMicrounits: 1_303 };
    await writeFile(result.ledgerPath, JSON.stringify(ledger));
    const transport = fakeTransport(); const resumed = await runner(path, transport, { maxHttpRequests: 1 }).run({ apiKeyPresent: true });
    expect(resumed.requestCount).toBe(1); expect(transport).toHaveBeenCalledTimes(state === "RESERVED" ? 1 : 0);
  });

  it.each(["negative-cost", "foreign-case", "foreign-candidate", "missing-completion"] as const)("rejects ledger corruption %s before dispatch", async (corruption) => {
    const path = await directory();
    const result = await runner(path, fakeTransport(), { maxHttpRequests: 1 }).run({ apiKeyPresent: true });
    const ledger = JSON.parse(await readFile(result.ledgerPath, "utf8"));
    if (corruption === "negative-cost") ledger.attempts[0].finalizedCostMicrounits = -1_000_000;
    if (corruption === "foreign-case") ledger.attempts[0].caseId = "synthetic-other";
    if (corruption === "foreign-candidate") ledger.attempts[0].candidateId = "other";
    if (corruption === "missing-completion") delete ledger.attempts[0].interpretation;
    await writeFile(result.ledgerPath, JSON.stringify(ledger));
    const transport = fakeTransport();
    await expect(runner(path, transport, { maxHttpRequests: 1 }).run({ apiKeyPresent: true })).rejects.toThrow("ledger");
    expect(transport).not.toHaveBeenCalled();
  });

  it("stops before exceeding request or conservative cost caps and preserves overages", async () => {
    const transport = fakeTransport();
    const request = await runner(await directory(), transport, { maxHttpRequests: 0 }).run({ apiKeyPresent: true });
    expect(request.status).toBe("INCOMPLETE_REQUEST_CAP"); expect(transport).not.toHaveBeenCalled();
    const cost = await runner(await directory(), transport, { maxCostMicrounits: 1_302 }).run({ apiKeyPresent: true });
    expect(cost.status).toBe("INCOMPLETE_COST_CAP"); expect(transport).not.toHaveBeenCalled();
    const overage = JSON.parse(response); overage.usage.cost = 0.11;
    const over = fakeTransport(JSON.stringify(overage));
    const result = await runner(await directory(), over).run({ apiKeyPresent: true });
    expect(result).toMatchObject({ status: "INCOMPLETE_COST_CAP", requestCount: 1, retainedCostMicrounits: 110_000 });
    expect(over).toHaveBeenCalledTimes(1);
  });

  it("keeps a final-call cost overage failed on both completion and resume", async () => {
    let calls = 0;
    const transport = vi.fn(async () => {
      const result = JSON.parse(response); result.usage.cost = ++calls === 36 ? 0.11 : 0;
      return { status: 200, body: JSON.stringify(result) };
    });
    const path = await directory();
    const result = await runner(path, transport).run({ apiKeyPresent: true });
    expect(result).toMatchObject({ status: "INCOMPLETE_COST_CAP", requestCount: 36 });
    const resumed = await runner(path, transport).run({ apiKeyPresent: true });
    expect(resumed.status).toBe("INCOMPLETE_COST_CAP");
    expect(transport).toHaveBeenCalledTimes(36);
  });

  it.each(["not-json", "temporal-injection", "oversized", "rate-limit"])("terminalizes %s without retries, fallback, raw persistence or a passing gate", async (kind) => {
    const body = kind === "oversized" ? "x".repeat(1_000_001) : JSON.stringify({ choices: [{ message: { content: kind === "temporal-injection" ? JSON.stringify({ ...model, localDate: "2030-01-01" }) : "not-json" }, finish_reason: "stop" }] });
    const transport = vi.fn(async () => ({ status: kind === "rate-limit" ? 429 : 200, body }));
    const path = await directory();
    const first = await runner(path, transport, { maxHttpRequests: 1 }).run({ apiKeyPresent: true });
    await runner(path, transport, { maxHttpRequests: 1 }).run({ apiKeyPresent: true });
    const ledger = await readFile(first.ledgerPath, "utf8");
    expect(ledger).toContain('"state":"FAILED"'); expect(ledger).not.toContain("not-json"); expect(ledger).not.toContain("2030-01-01");
    expect(first.retainedCostMicrounits).toBe(1_303);
    expect(first.qualityGates[gemini.candidateId].status).toBe("FAIL");
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("fences concurrent ledger runners deterministically", async () => {
    const path = await directory(); let release: () => void = () => {}; let reached: () => void = () => {};
    const arrived = new Promise<void>((resolve) => { reached = resolve; });
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const first = runner(path, async () => { reached(); await blocked; return { status: 200, body: response }; }, { maxHttpRequests: 1 }).run({ apiKeyPresent: true });
    await arrived;
    try { await expect(runner(path, fakeTransport(), { maxHttpRequests: 1 }).run({ apiKeyPresent: true })).rejects.toThrow("locked"); }
    finally { release(); await first; }
  });

  it("uses all fixed pilot inputs, bounded context, and reconciled metrics for an offline oracle response run", async () => {
    const fixture = await loadSyntheticSemanticFixture(CANONICAL_SYNTHETIC_FIXTURE_PATH);
    const selected = fixture.cases.filter((item) => GEMINI_PILOT_CASE_IDS.includes(item.id as never));
    let index = 0;
    const transport = vi.fn(async (request: LiveSemanticJsonRequest) => {
      const item = selected[index++]; const input = JSON.parse(request.messages[1].content);
      expect(input.text).toBe(item.message); expect(input.temporalEvidence).toEqual(item.expectedTemporalEvidence);
      if (item.priorContext) expect(input.previousContext).toMatchObject({ targetIntent: "CREATE_REMINDER", localDate: "2026-09-17" });
      return { status: 200, body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(item.expectedModel) }, finish_reason: "stop" }] }) };
    });
    const result = await runner(await directory(), transport).run({ apiKeyPresent: true });
    expect(result).toMatchObject({ status: "COMPLETE", requestCount: 36, retainedCostMicrounits: 46_908 });
    expect(result.qualityGates[gemini.candidateId]).toEqual({ status: "PASS", failures: [] });
  });

  it.each(["gemini-flash-lite-hybrid-pilot", "gemini-flash-lite-hybrid-full"])("preflights exact CLI profile %s without credentials or transport", async (profile) => {
    const path = await directory();
    const output = await runFile(process.execPath, ["--experimental-strip-types", "--import", "./tools/benchmark/register-typescript-loader.mjs", "tools/benchmark/run-semantic-v1-live.mjs", "--preflight", "--profile", profile, "--run-id", "semantic-v1-hybrid-cli-test"],
      { env: { ...process.env, OPENROUTER_API_KEY: "", SEMANTIC_BENCHMARK_STATE_DIRECTORY: path } });
    const report = JSON.parse(output.stdout);
    expect(report).toMatchObject({ caseCount: profile.endsWith("pilot") ? 36 : 216, networkRequests: 0, apiKey: "ABSENT", temporalEvidence: { correctRate: 1 } });
    expect(output.stderr).toBe("");
  });

  it("accepts pnpm forwarding and rejects old CLI profiles with zero dispatch", async () => {
    const path = await directory(); const env = { ...process.env, OPENROUTER_API_KEY: "", SEMANTIC_BENCHMARK_STATE_DIRECTORY: path };
    const result = await runFile("pnpm", ["benchmark:semantic-v1:live", "--", "--preflight", "--profile", "gemini-flash-lite-hybrid-pilot", "--run-id", "semantic-v1-hybrid-cli-pnpm"], { env });
    expect(result.stdout).toContain('"networkRequests":0');
    await expect(runFile(process.execPath, ["--experimental-strip-types", "--import", "./tools/benchmark/register-typescript-loader.mjs", "tools/benchmark/run-semantic-v1-live.mjs", "--preflight", "--profile", "gemini-pilot", "--run-id", "old"], { env })).rejects.toMatchObject({ code: 1 });
  });
});

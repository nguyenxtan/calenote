// @vitest-environment node
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CANONICAL_SYNTHETIC_FIXTURE_CONTENT_SHA256 } from "./semantic-v1";
import {
  createLiveSemanticBenchmarkRunner,
  type LiveBenchmarkCandidate,
  type LiveBenchmarkTransport,
} from "./live-semantic-v1";

const fixturePath = resolve(process.cwd(), "src/modules/semantic/benchmark/semantic-v1.json");
const runFile = promisify(execFile);
const candidates: LiveBenchmarkCandidate[] = [
  { candidateId: "gpt-oss", model: "openai/gpt-oss-120b", provider: "crusoe/bf16", promptPriceMicrounitsPerMillionTokens: 50_000, completionPriceMicrounitsPerMillionTokens: 250_000 },
  { candidateId: "nemotron", model: "nvidia/nemotron-3.5-lightning", provider: "phala", promptPriceMicrounitsPerMillionTokens: 80_000, completionPriceMicrounitsPerMillionTokens: 200_000 },
];

const response = JSON.stringify({ choices: [{ message: { content: JSON.stringify({ intent: "HELP" }) }, finish_reason: "stop" }], usage: { cost: 0.000001, prompt_tokens: 1, completion_tokens: 1 } });
const stateDirectories: string[] = [];

async function stateDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "calenote-live-benchmark-"));
  stateDirectories.push(directory);
  return directory;
}
function runner(directory: string, transport: LiveBenchmarkTransport, overrides: Record<string, unknown> = {}) {
  return createLiveSemanticBenchmarkRunner({
    fixturePath, stateDirectory: directory, runId: "safe-run-001", candidates, transport,
    maxHttpRequests: 450, maxCostMicrounits: 500_000, maxInputTokens: 10_000, maxOutputTokens: 1_024,
    ...overrides,
  });
}
function fakeTransport(body = response): LiveBenchmarkTransport {
  return vi.fn(async () => ({ status: 200, body }));
}

afterEach(async () => {
  await Promise.all(stateDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("live semantic V1 benchmark runner", () => {
  it("preflight verifies the pinned 216-case fixture without dispatching", async () => {
    const transport = fakeTransport();
    const report = await runner(await stateDirectory(), transport).preflight({ apiKeyPresent: false });
    expect(report).toMatchObject({ caseCount: 216, fixtureContentDigest: CANONICAL_SYNTHETIC_FIXTURE_CONTENT_SHA256, networkRequests: 0, apiKey: "ABSENT" });
    expect(transport).not.toHaveBeenCalled();
  });

  it("fails closed before transport when fixture identity is not canonical", async () => {
    const transport = fakeTransport();
    await expect(runner(await stateDirectory(), transport, { fixturePath: "/tmp/not-the-reviewed-fixture.json" }).preflight({ apiKeyPresent: true }))
      .rejects.toThrow("canonical fixture");
    expect(transport).not.toHaveBeenCalled();
  });

  it("persists RESERVED and then DISPATCHED before invoking transport", async () => {
    const directory = await stateDirectory();
    let observedStates: string[] = [];
    const transport: LiveBenchmarkTransport = vi.fn(async () => {
      const ledger = JSON.parse(await readFile(join(directory, "safe-run-001.json"), "utf8"));
      observedStates = ledger.attempts.map((attempt: { state: string }) => attempt.state);
      return { status: 200, body: response };
    });
    await runner(directory, transport, { maxHttpRequests: 1 }).run({ apiKeyPresent: true });
    expect(observedStates).toEqual(["DISPATCHED"]);
  });

  it("disables and excludes reasoning on every live request", async () => {
    const transport: LiveBenchmarkTransport = vi.fn(async (request) => {
      expect(request.reasoning).toEqual({ effort: "none", exclude: true });
      return { status: 200, body: response };
    });
    await runner(await stateDirectory(), transport, { maxHttpRequests: 1 }).run({ apiKeyPresent: true });
  });

  it("persists a schema-valid completed observation and reuses it without a second call", async () => {
    const directory = await stateDirectory();
    const transport = fakeTransport();
    const first = await runner(directory, transport, { maxHttpRequests: 1 }).run({ apiKeyPresent: true });
    const second = await runner(directory, transport, { maxHttpRequests: 1 }).run({ apiKeyPresent: true });
    expect(first.metricsByCandidate["gpt-oss"].scoredCases).toBe(1);
    expect(second.metricsByCandidate["gpt-oss"].scoredCases).toBe(1);
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("does not retry an attempt left UNKNOWN_DISPATCHED after a restart", async () => {
    const directory = await stateDirectory();
    await expect(runner(directory, fakeTransport(), { maxHttpRequests: 1 }).run({ apiKeyPresent: true })).resolves.toBeDefined();
    const current = JSON.parse(await readFile(join(directory, "safe-run-001.json"), "utf8"));
    current.attempts[0].state = "DISPATCHED";
    await (await import("node:fs/promises")).writeFile(join(directory, "safe-run-001.json"), JSON.stringify(current));
    const transport = fakeTransport();
    await runner(directory, transport, { maxHttpRequests: 1 }).run({ apiKeyPresent: true });
    expect(transport).not.toHaveBeenCalled();
  });

  it("recovers a proven never-dispatched reservation without undercounting a later dispatch", async () => {
    const directory = await stateDirectory();
    await runner(directory, fakeTransport(), { maxHttpRequests: 1 }).preflight({ apiKeyPresent: true });
    const path = join(directory, "safe-run-001.json");
    const ledger = JSON.parse(await readFile(path, "utf8"));
    ledger.attempts.push({ candidateId: "gpt-oss", caseId: "synthetic-relative-001", ordinal: 1, state: "RESERVED", reservedAt: new Date().toISOString(), reservedCostMicrounits: 1 });
    await writeFile(path, JSON.stringify(ledger));
    const transport = fakeTransport();
    const resumed = await runner(directory, transport, { maxHttpRequests: 1 }).run({ apiKeyPresent: true });
    expect(resumed.requestCount).toBe(1);
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("fails closed when another local runner holds the durable ledger lock", async () => {
    const directory = await stateDirectory();
    let unblock: (() => void) | undefined;
    const blocked = new Promise<void>((resolve) => { unblock = resolve; });
    const first = runner(directory, vi.fn(async () => { await blocked; return { status: 200, body: response }; }), { maxHttpRequests: 1 }).run({ apiKeyPresent: true });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const secondTransport = fakeTransport();
    await expect(runner(directory, secondTransport, { maxHttpRequests: 1 }).run({ apiKeyPresent: true })).rejects.toThrow("locked");
    unblock?.(); await first;
    expect(secondTransport).not.toHaveBeenCalled();
  });

  it("stops before request 451 and before a cost reservation above the hard cap", async () => {
    const requests = fakeTransport();
    const directory = await stateDirectory();
    const requestCapped = await runner(directory, requests, { maxHttpRequests: 0 }).run({ apiKeyPresent: true });
    expect(requestCapped.status).toBe("INCOMPLETE_REQUEST_CAP");
    expect(requests).not.toHaveBeenCalled();
    const costCapped = await runner(await stateDirectory(), fakeTransport(), { maxCostMicrounits: 1 }).run({ apiKeyPresent: true });
    expect(costCapped.status).toBe("INCOMPLETE_COST_CAP");
  });

  it("stops before the next durable dispatch when the exact two-model run reaches its cap", async () => {
    const transport = fakeTransport();
    const run = await runner(await stateDirectory(), transport, { maxHttpRequests: 431 }).run({ apiKeyPresent: true });
    expect(run.status).toBe("INCOMPLETE_REQUEST_CAP");
    expect(run.requestCount).toBe(431);
    expect(transport).toHaveBeenCalledTimes(431);
  }, 15_000);

  it("retains the conservative reservation for unknown usage and never automatically retries failures", async () => {
    const directory = await stateDirectory();
    const transport = fakeTransport(JSON.stringify({ choices: [{ message: { content: "not-json" }, finish_reason: "stop" }] }));
    await runner(directory, transport, { maxHttpRequests: 1 }).run({ apiKeyPresent: true });
    const ledger = JSON.parse(await readFile(join(directory, "safe-run-001.json"), "utf8"));
    expect(ledger.attempts[0]).toMatchObject({ state: "FAILED", finalizedCostMicrounits: ledger.attempts[0].reservedCostMicrounits, errorCategory: "INVALID_JSON" });
    await runner(directory, transport, { maxHttpRequests: 1 }).run({ apiKeyPresent: true });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("retains a reported overage rather than under-accounting it", async () => {
    const directory = await stateDirectory();
    const overage = JSON.stringify({ choices: [{ message: { content: JSON.stringify({ intent: "HELP" }) }, finish_reason: "stop" }], usage: { cost: 0.9, prompt_tokens: 1, completion_tokens: 1 } });
    await runner(directory, fakeTransport(overage), { maxHttpRequests: 1 }).run({ apiKeyPresent: true });
    const ledger = JSON.parse(await readFile(join(directory, "safe-run-001.json"), "utf8"));
    expect(ledger.attempts[0].finalizedCostMicrounits).toBe(900_000);
  });

  it("terminalizes an oversized provider body without retaining or retrying it", async () => {
    const directory = await stateDirectory();
    const oversized = "x".repeat(1_000_001);
    const transport = fakeTransport(oversized);
    await runner(directory, transport, { maxHttpRequests: 1 }).run({ apiKeyPresent: true });
    const ledger = await readFile(join(directory, "safe-run-001.json"), "utf8");
    expect(ledger).toContain("SCHEMA_INVALID");
    expect(ledger).not.toContain(oversized);
    await runner(directory, transport, { maxHttpRequests: 1 }).run({ apiKeyPresent: true });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("fails closed on corrupt or incompatible local ledger without resetting it", async () => {
    const directory = await stateDirectory();
    await (await import("node:fs/promises")).writeFile(join(directory, "safe-run-001.json"), "{partial");
    const transport = fakeTransport();
    await expect(runner(directory, transport).preflight({ apiKeyPresent: true })).rejects.toThrow("ledger");
    expect(transport).not.toHaveBeenCalled();
  });

  it("rejects an incompatible candidate configuration and does not write a replacement ledger", async () => {
    const directory = await stateDirectory();
    await runner(directory, fakeTransport()).preflight({ apiKeyPresent: true });
    const transport = fakeTransport();
    await expect(runner(directory, transport, { candidates: [{ ...candidates[0], promptPriceMicrounitsPerMillionTokens: 50_001 }, candidates[1]] }).preflight({ apiKeyPresent: true }))
      .rejects.toThrow("ledger");
    expect(transport).not.toHaveBeenCalled();
  });

  it("never persists synthetic message text, transport bodies, headers, or a supplied key", async () => {
    const directory = await stateDirectory();
    const forbidden = "not-a-real-secret-value";
    await runner(directory, fakeTransport()).preflight({ apiKeyPresent: true });
    const ledger = await readFile(join(directory, "safe-run-001.json"), "utf8");
    expect(ledger).not.toContain(forbidden);
    expect(ledger).not.toMatch(/authorization|header|message|prompt|response/iu);
  });

  it("emits only allowlisted safe progress while retaining the exact approved candidate set", async () => {
    const progress: string[] = [];
    const transport = fakeTransport();
    await runner(await stateDirectory(), transport, { maxHttpRequests: 1, onProgress: (line: string) => progress.push(line) }).run({ apiKeyPresent: true });
    expect(progress.join("\n")).toContain("openai/gpt-oss-120b");
    expect(progress.join("\n")).not.toMatch(/authorization|api[_ -]?key|not-json|choices/iu);
  });

  it("keeps the explicit CLI preflight network-free and Keychain-independent", async () => {
    const source = await readFile(new URL("./run-semantic-v1-live.mjs", import.meta.url), "utf8");
    expect(source).toContain("process.env.OPENROUTER_API_KEY");
    expect(source).not.toMatch(/find-generic-password|security\s+find|keychain/iu);
    const output = await runFile(process.execPath, ["--experimental-strip-types", "--import", "./tools/benchmark/register-typescript-loader.mjs", "tools/benchmark/run-semantic-v1-live.mjs", "--preflight", "--run-id", "test-preflight-safe"], { cwd: process.cwd(), env: { ...process.env, OPENROUTER_API_KEY: "" } });
    expect(output.stdout).toContain('"networkRequests":0');
    expect(output.stdout).toContain('"apiKey":"ABSENT"');
    expect(output.stderr).toBe("");
  });

  it("accepts package-script argument forwarding for the network-free preflight", async () => {
    const output = await runFile("pnpm", ["benchmark:semantic-v1:live", "--", "--preflight", "--run-id", "test-preflight-pnpm"], { cwd: process.cwd(), env: { ...process.env, OPENROUTER_API_KEY: "" } });
    expect(output.stdout).toContain('"networkRequests":0');
  });
});

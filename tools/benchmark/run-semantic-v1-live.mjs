import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createLiveSemanticBenchmarkRunner, createOpenRouterTransport, HYBRID_BENCHMARK_PROFILES } from "./live-semantic-v1.ts";

const directory = dirname(fileURLToPath(import.meta.url));
const stateDirectory = process.env.SEMANTIC_BENCHMARK_STATE_DIRECTORY
  ? resolve(process.env.SEMANTIC_BENCHMARK_STATE_DIRECTORY)
  : resolve(directory, "../../benchmark-state/semantic-v1");
const args = process.argv.slice(2).filter((argument, index) => !(index === 0 && argument === "--"));
const values = new Map();
for (let index = 0; index < args.length; index += 1) {
  const flag = args[index];
  if (!["--preflight", "--run-id", "--profile"].includes(flag) || values.has(flag)) throw new TypeError("Invalid or duplicate benchmark argument");
  if (flag === "--preflight") values.set(flag, true);
  else {
    const value = args[++index];
    if (!value || value.startsWith("--")) throw new TypeError("Missing benchmark argument");
    values.set(flag, value);
  }
}
const profile = values.get("--profile");
const runId = values.get("--run-id");
if (!runId || !Object.hasOwn(HYBRID_BENCHMARK_PROFILES, profile)) {
  throw new TypeError("Usage: run-semantic-v1-live.mjs [--preflight] --profile gemini-flash-lite-hybrid-pilot|gemini-flash-lite-hybrid-full --run-id semantic-v1-hybrid-<new-id>");
}
const preflight = values.has("--preflight");
// Preflight never reads a credential or constructs a live transport.
const apiKey = preflight ? undefined : process.env.OPENROUTER_API_KEY;
const transport = apiKey ? createOpenRouterTransport(apiKey) : async () => { throw new Error("network dispatch blocked"); };
const runner = createLiveSemanticBenchmarkRunner({
  profile, runId, stateDirectory, transport,
  fixturePath: resolve(directory, "../../src/modules/semantic/benchmark/semantic-v1.json"),
  candidates: [{ candidateId: "gemini-2.5-flash-lite", model: "google/gemini-2.5-flash-lite", provider: "google-vertex/eu", reasoning: "OMIT", promptPriceMicrounitsPerMillionTokens: 100_000, completionPriceMicrounitsPerMillionTokens: 400_000 }],
  onProgress: (line) => console.log(line),
});
const report = preflight ? await runner.preflight({ apiKeyPresent: false }) : await runner.run({ apiKeyPresent: Boolean(apiKey) });
console.log(JSON.stringify(report));
if (!preflight && (report.status !== "COMPLETE" || Object.values(report.qualityGates).some((gate) => gate.status !== "PASS"))) process.exitCode = 1;

import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createLiveSemanticBenchmarkRunner, createOpenRouterTransport, GEMINI_PILOT_CASE_IDS } from "./live-semantic-v1.ts";

const directory = dirname(fileURLToPath(import.meta.url));
const stateDirectory = process.env.SEMANTIC_BENCHMARK_STATE_DIRECTORY
  ? resolve(process.env.SEMANTIC_BENCHMARK_STATE_DIRECTORY)
  : resolve(directory, "../../benchmark-state/semantic-v1");
const args = process.argv.slice(2).filter((argument, index) => !(index === 0 && argument === "--"));
const preflight = args[0] === "--preflight";
const runIdIndex = args.indexOf("--run-id");
const profileIndex = args.indexOf("--profile");
const profile = profileIndex === -1 ? "legacy-pair" : args[profileIndex + 1];
if (runIdIndex === -1 || !args[runIdIndex + 1] || !["legacy-pair", "gemini-pilot"].includes(profile)
  || args.some((arg, index) => !["--preflight", "--run-id", "--profile"].includes(arg) && index !== runIdIndex + 1 && index !== profileIndex + 1)) {
  throw new TypeError("Usage: run-semantic-v1-live.mjs [--preflight] [--profile legacy-pair|gemini-pilot] --run-id <safe-run-id>");
}
const apiKey = process.env.OPENROUTER_API_KEY;
const transport = apiKey ? createOpenRouterTransport(apiKey) : async () => { throw new Error("network dispatch blocked without OPENROUTER_API_KEY"); };
const gemini = { candidateId: "gemini-2.5-flash-lite", model: "google/gemini-2.5-flash-lite", provider: "google-vertex/eu", reasoning: "OMIT", promptPriceMicrounitsPerMillionTokens: 100_000, completionPriceMicrounitsPerMillionTokens: 400_000 };
const profileOptions = profile === "gemini-pilot"
  ? { candidates: [gemini], caseIds: GEMINI_PILOT_CASE_IDS, maxHttpRequests: 40, maxCostMicrounits: 100_000, maxInputTokens: 12_000, maxOutputTokens: 256 }
  : { candidates: [
      { candidateId: "qwen3-30b-a3b-instruct-2507", model: "qwen/qwen3-30b-a3b-instruct-2507", provider: "siliconflow/fp8", reasoning: "OMIT", promptPriceMicrounitsPerMillionTokens: 90_000, completionPriceMicrounitsPerMillionTokens: 300_000 },
      { candidateId: "nemotron-3.5-lightning", model: "nvidia/nemotron-3.5-lightning", provider: "phala", reasoning: "DISABLED", promptPriceMicrounitsPerMillionTokens: 80_000, completionPriceMicrounitsPerMillionTokens: 200_000 },
    ] };
const runner = createLiveSemanticBenchmarkRunner({
  fixturePath: resolve(directory, "../../src/modules/semantic/benchmark/semantic-v1.json"),
  stateDirectory, runId: args[runIdIndex + 1], transport,
  ...profileOptions,
  onProgress: (line) => console.log(line),
});
const report = preflight ? await runner.preflight({ apiKeyPresent: Boolean(apiKey) }) : await runner.run({ apiKeyPresent: Boolean(apiKey) });
console.log(JSON.stringify(report));

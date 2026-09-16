import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createLiveSemanticBenchmarkRunner, createOpenRouterTransport } from "./live-semantic-v1.ts";

const directory = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2).filter((argument, index) => !(index === 0 && argument === "--"));
const preflight = args[0] === "--preflight";
const runIdIndex = args.indexOf("--run-id");
if (runIdIndex === -1 || !args[runIdIndex + 1] || args.some((arg, index) => !["--preflight", "--run-id"].includes(arg) && index !== runIdIndex + 1)) {
  throw new TypeError("Usage: run-semantic-v1-live.mjs [--preflight] --run-id <safe-run-id>");
}
const apiKey = process.env.OPENROUTER_API_KEY;
const transport = apiKey ? createOpenRouterTransport(apiKey) : async () => { throw new Error("network dispatch blocked without OPENROUTER_API_KEY"); };
const runner = createLiveSemanticBenchmarkRunner({
  fixturePath: resolve(directory, "../../src/modules/semantic/benchmark/semantic-v1.json"),
  stateDirectory: resolve(directory, "../../benchmark-state/semantic-v1"), runId: args[runIdIndex + 1], transport,
  candidates: [
    { candidateId: "gpt-oss-120b", model: "openai/gpt-oss-120b", provider: "crusoe/bf16", promptPriceMicrounitsPerMillionTokens: 50_000, completionPriceMicrounitsPerMillionTokens: 250_000 },
    { candidateId: "nemotron-3.5-lightning", model: "nvidia/nemotron-3.5-lightning", provider: "phala", promptPriceMicrounitsPerMillionTokens: 80_000, completionPriceMicrounitsPerMillionTokens: 200_000 },
  ],
  onProgress: (line) => console.log(line),
});
const report = preflight ? await runner.preflight({ apiKeyPresent: Boolean(apiKey) }) : await runner.run({ apiKeyPresent: Boolean(apiKey) });
console.log(JSON.stringify(report));

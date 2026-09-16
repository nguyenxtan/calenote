import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { renderOfflineBenchmarkEvidence, runOfflineSemanticBenchmark } from "./semantic-v1.ts";

const toolDirectory = dirname(fileURLToPath(import.meta.url));
const fixturePath = resolve(toolDirectory, "../../src/modules/semantic/benchmark/semantic-v1.json");
const run = await runOfflineSemanticBenchmark({ fixturePath });

console.log(renderOfflineBenchmarkEvidence(run));

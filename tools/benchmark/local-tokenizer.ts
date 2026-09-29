import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { CONTEXT_CONTRACT_PROMPT } from "../../src/modules/conversation/context-contract/prompt";
import { InterpretationJsonSchema, type ContextInput } from "../../src/modules/conversation/context-contract/contracts";
import { serializeContextRequest } from "../../src/modules/conversation/context-contract/wire";

/** Development bridge only. Never imported by src/ or used for route admission. */
export function measureLocalTokens(samples: { name: string; input: ContextInput; output?: string }[]) {
  const rows = samples.map(s => ({ case: s.name, prompt: CONTEXT_CONTRACT_PROMPT, inputJson: JSON.stringify(s.input), schemaJson: JSON.stringify(InterpretationJsonSchema), wireJson: JSON.stringify(serializeContextRequest(s.input)), outputJson: s.output ?? null }));
  const result = spawnSync("/usr/bin/sandbox-exec", ["-p", "(version 1)(allow default)(deny network*)", resolve("artifacts/context-contract-tokenizer/venv/bin/python"), resolve("tools/benchmark/tokenizer/measure.py")], {
    input: JSON.stringify(rows), encoding: "utf8", maxBuffer: 16 * 1024 * 1024,
    // Worker-generated ProcessEnv augmentation is irrelevant to this isolated
    // Python child. Deliberately inherit no application environment/credentials.
    env: { PATH: "/usr/bin:/bin", PYTHONDONTWRITEBYTECODE: "1", PYTHONHASHSEED: "0" } as unknown as NodeJS.ProcessEnv,
  });
  if (result.error || result.status !== 0) throw new Error(`Offline tokenizer failed: ${result.error?.message ?? result.stderr}`);
  return JSON.parse(result.stdout) as {
    phase: "OFFLINE_MEASUREMENT";
    provenance: { networkGuardActive: boolean; networkAttemptsAfterSelfCheck: string[]; [key: string]: unknown };
    rows: { case: string; applicationTextTokens: number; sdkTextProjectionTokens: number; sdkFullStructuredTokens: number | null; rawJsonDiagnosticTokens: number; rawSchemaDiagnosticTokens: number; outputTextTokens: number | null; unsupportedSchema: { path: string[]; type: string }[]; routeFramingTokens: "UNKNOWN"; [key: string]: unknown }[];
  };
}

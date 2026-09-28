import { InterpretationJsonSchema, type ContextInput } from "./contracts";
import { CONTEXT_CONTRACT_PROMPT } from "./prompt";
/** Serialization only. Admission is separate; this function cannot dispatch. */
export function serializeContextRequest(input: ContextInput) {
  return {
    messages: [{ role: "system" as const, content: CONTEXT_CONTRACT_PROMPT }, { role: "user" as const, content: JSON.stringify(input) }],
    response_format: { type: "json_schema" as const, json_schema: { name: "calenote_context_1", strict: true, schema: InterpretationJsonSchema } },
    stream: false as const, max_tokens: 1536 as const,
  };
}

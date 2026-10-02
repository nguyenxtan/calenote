import type { ContextInput } from "./contracts";
import { LegacyV2InterpretationJsonSchema, type LegacyV2ContextInput } from "./contracts";
import { googleLiteEuContextWireSchemaV3 } from "@/modules/intelligence/infrastructure/openrouter/context-provider-wire";
import { CONTEXT_CONTRACT_PROMPT } from "./prompt";
/** Serialization only. Admission is separate; this function cannot dispatch. */
export function serializeContextRequest(input: ContextInput) {
  return {
    messages: [{ role: "system" as const, content: CONTEXT_CONTRACT_PROMPT }, { role: "user" as const, content: JSON.stringify(input) }],
    response_format: { type: "json_schema" as const, json_schema: { name: "calenote_context_3", strict: true, schema: googleLiteEuContextWireSchemaV3().schema } },
    stream: false as const, max_tokens: 1536 as const,
  };
}

/** Historical byte-specimen reference only; never selected by service/gateway. */
export function serializeLegacyV2ContextRequestReference(input: LegacyV2ContextInput) {
  return { messages: [{ role: "system" as const, content: CONTEXT_CONTRACT_PROMPT }, { role: "user" as const, content: JSON.stringify(input) }],
    response_format: { type: "json_schema" as const, json_schema: { name: "calenote_context_2", strict: true, schema: LegacyV2InterpretationJsonSchema } },
    stream: false as const, max_tokens: 1536 as const };
}

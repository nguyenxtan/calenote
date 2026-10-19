import type { ContextInput } from "./contracts";
import { googleLiteEuTypedContextWireSchemaV3 } from "@/modules/intelligence/infrastructure/openrouter/context-provider-typed-wire";
import { CONTEXT_TYPED_PROMPT } from "./typed-prompt";
import { evidenceSourceCatalogue } from "../../intelligence/infrastructure/openrouter/evidence-pointer";
import { deriveGenerationFieldCapability } from "./field-capability";
import { numericOwnershipCatalogue } from "./wire";

/** Input selects the complete typed grammar before any transport is available. */
export function serializeTypedContextRequest(input: ContextInput) {
  const evidenceSources = evidenceSourceCatalogue(input);
  const fieldCapability = deriveGenerationFieldCapability(input);
  const selected = googleLiteEuTypedContextWireSchemaV3(input);
  return {
    messages: [{ role: "system" as const, content: CONTEXT_TYPED_PROMPT }, {
      role: "user" as const,
      content: JSON.stringify({ ...input, ...(evidenceSources.length ? { evidenceSources } : {}), numericOwnership: numericOwnershipCatalogue(input), fieldCapability }),
    }],
    response_format: { type: "json_schema" as const, json_schema: {
      name: "calenote_context_typed_105", strict: true as const, schema: selected.schema,
    } },
    stream: false as const, max_tokens: 1536 as const, temperature: 0 as const,
  };
}

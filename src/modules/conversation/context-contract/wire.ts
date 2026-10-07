import type { ContextInput } from "./contracts";
import { LegacyV2InterpretationJsonSchema, type LegacyV2ContextInput } from "./contracts";
import { googleLiteEuContextWireSchemaV3 } from "@/modules/intelligence/infrastructure/openrouter/context-provider-wire";
import { CONTEXT_CONTRACT_PROMPT } from "./prompt";
import {evidenceSourceCatalogue} from "../../intelligence/infrastructure/openrouter/evidence-pointer";
export function numericOwnershipCatalogue(input: ContextInput) {
  const frequency = input.activeRequest?.slots.frequency, count = input.activeRequest?.slots.occurrenceCount;
  const retained = frequency && count && ["PROPOSED", "RESOLVED"].includes(frequency.state)
    && ["PROPOSED", "RESOLVED"].includes(count.state) && frequency.value === "DAILY" && typeof count.value === "number";
  return { version: "numeric-ownership-1" as const, currentSeriesCount: retained ? count.value : null, newInheritsSeries: false as const };
}
/** Serialization only. Admission is separate; this function cannot dispatch. */
export function serializeContextRequest(input: ContextInput) {
  const evidenceSources=evidenceSourceCatalogue(input);
  return {
    messages: [{ role: "system" as const, content: CONTEXT_CONTRACT_PROMPT }, { role: "user" as const, content: JSON.stringify({ ...input, ...(evidenceSources.length ? { evidenceSources } : {}), numericOwnership: numericOwnershipCatalogue(input) }) }],
    response_format: { type: "json_schema" as const, json_schema: { name: "calenote_context_3", strict: true, schema: googleLiteEuContextWireSchemaV3().schema } },
    stream: false as const, max_tokens: 1536 as const, temperature: 0 as const,
  };
}

/** Historical byte-specimen reference only; never selected by service/gateway. */
export function serializeLegacyV2ContextRequestReference(input: LegacyV2ContextInput) {
  return { messages: [{ role: "system" as const, content: CONTEXT_CONTRACT_PROMPT }, { role: "user" as const, content: JSON.stringify(input) }],
    response_format: { type: "json_schema" as const, json_schema: { name: "calenote_context_2", strict: true, schema: LegacyV2InterpretationJsonSchema } },
    stream: false as const, max_tokens: 1536 as const };
}

import * as wire108 from '../../intelligence/infrastructure/openrouter/context-order-reference-wire';
import type { ContextInput } from "./contracts";
import { LegacyV2InterpretationJsonSchema, type LegacyV2ContextInput } from "./contracts";
import { googleLiteEuContextWireSchemaV3 } from "@/modules/intelligence/infrastructure/openrouter/context-provider-wire";
import { CONTEXT_CONTRACT_PROMPT } from "./prompt";
import {evidenceSourceCatalogue} from "../../intelligence/infrastructure/openrouter/evidence-pointer";
import { deriveGenerationFieldCapability } from "./field-capability";
import {googleLiteEuContextWireSchemaV3 as selectedSchema,CONTEXT_ORDER_REFERENCE_PROMPT,googleLiteEuContextWireSchemaReference110,CONTEXT_ORDER_REFERENCE_PROMPT_REFERENCE110,googleLiteEuContextWireSchemaReference111,CONTEXT_ORDER_REFERENCE_PROMPT_REFERENCE111} from '../../intelligence/infrastructure/openrouter/context-literal-insertion-wire';
export function numericOwnershipCatalogue(input: ContextInput) {
  const frequency = input.activeRequest?.slots.frequency, count = input.activeRequest?.slots.occurrenceCount;
  const retained = frequency && count && ["PROPOSED", "RESOLVED"].includes(frequency.state)
    && ["PROPOSED", "RESOLVED"].includes(count.state) && frequency.value === "DAILY" && typeof count.value === "number";
  return { version: "numeric-ownership-1" as const, currentSeriesCount: retained ? count.value : null, newInheritsSeries: false as const };
}
/** Serialization only. Admission is separate; this function cannot dispatch. */
export function serializeWire107ContextRequestReference(input: ContextInput) {
  const evidenceSources=evidenceSourceCatalogue(input);
  const fieldCapability = deriveGenerationFieldCapability(input);
  return {
    messages: [{ role: "system" as const, content: CONTEXT_CONTRACT_PROMPT }, { role: "user" as const, content: JSON.stringify({ ...input, ...(evidenceSources.length ? { evidenceSources } : {}), numericOwnership: numericOwnershipCatalogue(input), fieldCapability }) }],
    response_format: { type: "json_schema" as const, json_schema: { name: "calenote_context_3", strict: true as const, schema: googleLiteEuContextWireSchemaV3(fieldCapability,input).schema } },
    stream: false as const, max_tokens: 1536 as const, temperature: 0 as const,
  };
}
/** Named immutable108 serializer reference; never selected by gateway. */
export function serializeWire108ContextRequestReference(input:ContextInput) {
 const request=serializeWire107ContextRequestReference(input);
 request.messages[0].content=wire108.CONTEXT_ORDER_REFERENCE_PROMPT;
 request.response_format.json_schema.schema=wire108.googleLiteEuContextWireSchemaV3(deriveGenerationFieldCapability(input),input).schema;
 return request;
}
/** Named110 reference; numeric uncertainty codes and exact original prompt. */
export function serializeWire110ContextRequestReference(input:ContextInput){const request=serializeWire107ContextRequestReference(input);request.messages[0].content=CONTEXT_ORDER_REFERENCE_PROMPT_REFERENCE110;request.response_format.json_schema.schema=googleLiteEuContextWireSchemaReference110(deriveGenerationFieldCapability(input),input).schema;return request;}
/** Immutable111 specimen, never selected by gateway. */
export function serializeWire111ContextRequestReference(input:ContextInput){const request=serializeWire110ContextRequestReference(input);request.messages[0].content=CONTEXT_ORDER_REFERENCE_PROMPT_REFERENCE111;request.response_format.json_schema.schema=googleLiteEuContextWireSchemaReference111(deriveGenerationFieldCapability(input),input).schema;return request;}
/** Selected112 only; named serializers are historical evidence. */
export function serializeContextRequest(input:ContextInput) {
 const request=serializeWire107ContextRequestReference(input);
 request.messages[0].content=CONTEXT_ORDER_REFERENCE_PROMPT;
 request.response_format.json_schema.schema=selectedSchema(deriveGenerationFieldCapability(input),input).schema;
 return request;
}

/** Historical byte-specimen reference only; never selected by service/gateway. */
export function serializeLegacyV2ContextRequestReference(input: LegacyV2ContextInput) {
  return { messages: [{ role: "system" as const, content: CONTEXT_CONTRACT_PROMPT }, { role: "user" as const, content: JSON.stringify(input) }],
    response_format: { type: "json_schema" as const, json_schema: { name: "calenote_context_2", strict: true, schema: LegacyV2InterpretationJsonSchema } },
    stream: false as const, max_tokens: 1536 as const };
}

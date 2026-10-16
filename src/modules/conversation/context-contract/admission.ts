import { ContextInputSchema, ConversationInterpretationSchema, type ContextInput } from "./contracts";
import { LegacyV2ContextInputSchema, LegacyV2ConversationInterpretationSchema, type LegacyV2ContextInput } from "./contracts";
import { CONTEXT_CONTRACT_PROMPT } from "./prompt";
import { serializeContextRequest, serializeLegacyV2ContextRequestReference } from "./wire";

export const CONTEXT_LIMITS = { currentUtf16: 1800, retainedCodePoints: 2000, users: 6, assistants: 6, snapshotBytes: 16384, inputTokens: 12000, outputTokens: 1536, responseBytes: 32768 } as const;
export interface EnvelopeMeasurement {
  current: { utf16Units: number; codePoints: number };
  turns: { role: string; utf16Units: number; codePoints: number }[];
  bytes: { snapshot: number; prompt: number; schema: number; input: number; request: number; framing: number; output: number | null };
  tokenMethod: "gemini-2.5-flash-lite:UNVERIFIED";
  inputTokens: null; outputTokens: null; serverFramingTokens: null;
  admitted: boolean; reasons: string[];
}
const bytes = (text: string) => new TextEncoder().encode(text).byteLength;
const counts = (text: string) => { const nfc = text.normalize("NFC"); return { utf16Units: nfc.length, codePoints: [...nfc].length }; };

export interface RefusedEnvelopeTransition {
  action: "REFUSE";
  reason: string;
  recovery: "SHORTEN_OR_RESTART" | "REPHRASE" | "ADMISSION_UNAVAILABLE";
  retainedSnapshotJson: string;
}
/** Pure preflight plan; no storage/transport capability. Actual CAS and recovery
 * remain later integration work. Missing route proof always refuses dispatch. */
export function preflightEnvelopeTransition(previousSnapshotJson: string, input: ContextInput, candidateSnapshotJson: string, outputJson?: string): RefusedEnvelopeTransition {
  const measurement = measureEnvelope(input, candidateSnapshotJson, outputJson);
  const reason = measurement.reasons[0] ?? "TOKEN_BOUND_UNVERIFIED";
  const recovery = reason === "TOKEN_BOUND_UNVERIFIED" ? "ADMISSION_UNAVAILABLE"
    : reason.endsWith("TOO_LARGE") || reason.endsWith("TOO_LONG") || reason === "CONTEXT_TURN_COUNT_EXCEEDED" ? "SHORTEN_OR_RESTART" : "REPHRASE";
  return { action: "REFUSE", reason, recovery, retainedSnapshotJson: previousSnapshotJson };
}

/** Offline only. snapshotJson is the full pre-encryption source snapshot, not a
 * model summary. outputJson is extracted model JSON, NOT raw provider HTTP body.
 * Transport bytes/finish reason require future gateway checks. Without proof of
 * model tokenization and server framing, this dormant artifact admits nothing.
 */
export function measureEnvelope(input: ContextInput, snapshotJson: string, outputJson?: string): EnvelopeMeasurement {
  const wire = serializeContextRequest(input);
  return measureReferenceEnvelope(input, snapshotJson, outputJson, wire, ContextInputSchema, ConversationInterpretationSchema);
}

/** Old fixed-size specimen reference, unreachable from selected V3 dispatch. */
export function measureLegacyV2EnvelopeReference(input: LegacyV2ContextInput, snapshotJson: string, outputJson?: string): EnvelopeMeasurement {
  return measureReferenceEnvelope(input, snapshotJson, outputJson, serializeLegacyV2ContextRequestReference(input), LegacyV2ContextInputSchema, LegacyV2ConversationInterpretationSchema);
}
export function preflightLegacyV2EnvelopeReference(previous: string, input: LegacyV2ContextInput, candidate: string, output?: string): RefusedEnvelopeTransition {
  const reason = measureLegacyV2EnvelopeReference(input, candidate, output).reasons[0] ?? "TOKEN_BOUND_UNVERIFIED";
  return { action: "REFUSE", reason, recovery: reason === "TOKEN_BOUND_UNVERIFIED" ? "ADMISSION_UNAVAILABLE" : reason.endsWith("TOO_LARGE") || reason.endsWith("TOO_LONG") || reason === "CONTEXT_TURN_COUNT_EXCEEDED" ? "SHORTEN_OR_RESTART" : "REPHRASE", retainedSnapshotJson: previous };
}
function measureReferenceEnvelope(input: ContextInput | LegacyV2ContextInput, snapshotJson: string, outputJson: string | undefined,
  wire: ReturnType<typeof serializeContextRequest> | ReturnType<typeof serializeLegacyV2ContextRequestReference>,
  inputSchema: { safeParse(value: unknown): { success: boolean } }, outputSchema: { safeParse(value: unknown): { success: boolean } }): EnvelopeMeasurement {
  const current = counts(input.turns[input.currentTurn]?.text ?? "");
  const turns = input.turns.map(t => ({ role: t.role, ...counts(t.text) }));
  const sizes = { snapshot: bytes(snapshotJson), prompt: bytes(CONTEXT_CONTRACT_PROMPT), schema: bytes(JSON.stringify(wire.response_format.json_schema.schema)), input: bytes(JSON.stringify(input)), request: bytes(JSON.stringify(wire)), framing: 0, output: outputJson === undefined ? null : bytes(outputJson) };
  // JSON wrappers/escaping only; never a claim about hidden provider tokens.
  sizes.framing = sizes.request - sizes.prompt - sizes.schema - sizes.input;
  const reasons: string[] = [];
  if (current.utf16Units > CONTEXT_LIMITS.currentUtf16) reasons.push("SEMANTIC_INPUT_TOO_LONG");
  if (turns.some(t => t.role === "USER" && t.codePoints > CONTEXT_LIMITS.retainedCodePoints)) reasons.push("CONTEXT_TURN_TOO_LONG");
  if (turns.filter(t => t.role === "USER").length > 6 || turns.filter(t => t.role === "ASSISTANT").length > 6) reasons.push("CONTEXT_TURN_COUNT_EXCEEDED");
  if (sizes.snapshot > CONTEXT_LIMITS.snapshotBytes) reasons.push("CONTEXT_SNAPSHOT_TOO_LARGE");
  if (!inputSchema.safeParse(input).success) reasons.push("INPUT_SCHEMA_INVALID");
  try {
    const snapshot: unknown = JSON.parse(snapshotJson);
    if (snapshot === null || typeof snapshot !== "object" || Array.isArray(snapshot)) reasons.push("SNAPSHOT_JSON_INVALID");
  } catch { reasons.push("SNAPSHOT_JSON_INVALID"); }
  if (outputJson !== undefined) {
    if (sizes.output! > CONTEXT_LIMITS.responseBytes) reasons.push("OUTPUT_JSON_TOO_LARGE");
    try {
      if (!outputSchema.safeParse(JSON.parse(outputJson)).success) reasons.push("OUTPUT_SCHEMA_INVALID");
    } catch { reasons.push("OUTPUT_JSON_INVALID"); }
  }
  // UTF8(request)+1024 is not an established Gemini bound; no caller override.
  reasons.push("TOKEN_BOUND_UNVERIFIED");
  return { current, turns, bytes: sizes, tokenMethod: "gemini-2.5-flash-lite:UNVERIFIED", inputTokens: null, outputTokens: null, serverFramingTokens: null, admitted: reasons.length === 0, reasons };
}

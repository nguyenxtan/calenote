import { ContextInputSchema, ConversationInterpretationSchema, InterpretationJsonSchema, type ContextInput } from "./contracts";
import { CONTEXT_CONTRACT_PROMPT } from "./prompt";
import { serializeContextRequest } from "./wire";

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

/** Offline only. snapshotJson is the full pre-encryption source snapshot, not a
 * model summary. outputJson is extracted model JSON, NOT raw provider HTTP body.
 * Transport bytes/finish reason require future gateway checks. Without proof of
 * model tokenization and server framing, this dormant artifact admits nothing.
 */
export function measureEnvelope(input: ContextInput, snapshotJson: string, outputJson?: string): EnvelopeMeasurement {
  const wire = serializeContextRequest(input);
  const current = counts(input.turns[input.currentTurn]?.text ?? "");
  const turns = input.turns.map(t => ({ role: t.role, ...counts(t.text) }));
  const sizes = { snapshot: bytes(snapshotJson), prompt: bytes(CONTEXT_CONTRACT_PROMPT), schema: bytes(JSON.stringify(InterpretationJsonSchema)), input: bytes(JSON.stringify(input)), request: bytes(JSON.stringify(wire)), framing: 0, output: outputJson === undefined ? null : bytes(outputJson) };
  // JSON wrappers/escaping only; never a claim about hidden provider tokens.
  sizes.framing = sizes.request - sizes.prompt - sizes.schema - sizes.input;
  const reasons: string[] = [];
  if (current.utf16Units > CONTEXT_LIMITS.currentUtf16) reasons.push("SEMANTIC_INPUT_TOO_LONG");
  if (turns.some(t => t.role === "USER" && t.codePoints > CONTEXT_LIMITS.retainedCodePoints)) reasons.push("CONTEXT_TURN_TOO_LONG");
  if (turns.filter(t => t.role === "USER").length > 6 || turns.filter(t => t.role === "ASSISTANT").length > 6) reasons.push("CONTEXT_TURN_COUNT_EXCEEDED");
  if (sizes.snapshot > CONTEXT_LIMITS.snapshotBytes) reasons.push("CONTEXT_SNAPSHOT_TOO_LARGE");
  if (!ContextInputSchema.safeParse(input).success) reasons.push("INPUT_SCHEMA_INVALID");
  try {
    const snapshot: unknown = JSON.parse(snapshotJson);
    if (snapshot === null || typeof snapshot !== "object" || Array.isArray(snapshot)) reasons.push("SNAPSHOT_JSON_INVALID");
  } catch { reasons.push("SNAPSHOT_JSON_INVALID"); }
  if (outputJson !== undefined) {
    if (sizes.output! > CONTEXT_LIMITS.responseBytes) reasons.push("OUTPUT_JSON_TOO_LARGE");
    try {
      if (!ConversationInterpretationSchema.safeParse(JSON.parse(outputJson)).success) reasons.push("OUTPUT_SCHEMA_INVALID");
    } catch { reasons.push("OUTPUT_JSON_INVALID"); }
  }
  // UTF8(request)+1024 is not an established Gemini bound; no caller override.
  reasons.push("TOKEN_BOUND_UNVERIFIED");
  return { current, turns, bytes: sizes, tokenMethod: "gemini-2.5-flash-lite:UNVERIFIED", inputTokens: null, outputTokens: null, serverFramingTokens: null, admitted: reasons.length === 0, reasons };
}

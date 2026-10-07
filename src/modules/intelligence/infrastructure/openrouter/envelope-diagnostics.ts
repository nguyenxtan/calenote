import { createHash } from "node:crypto";

const finishTokens = new Set(["stop", "length", "error", "content_filter", "tool_calls", "function_call", "STOP", "MAX_TOKENS", "SAFETY", "RECITATION", "OTHER", "BLOCKLIST", "PROHIBITED_CONTENT", "MALFORMED_FUNCTION_CALL"]);
type Control = { type: string; token?: string; length?: number; sha256?: string };
export interface ProviderEnvelopeDiagnostics {
  version: "provider-envelope-1"; choicesType: string; choicesCount?: number;
  errorPresent: boolean; errorCode?: number;
  firstChoice?: { finishReason: Control; nativeFinishReason: Control; contentType: string; contentByteCount?: number; messageErrorPresent: boolean };
}
const type = (value: unknown) => value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const control = (value: unknown): Control => ({ type: type(value), ...(typeof value === "string" ? {
  length: value.length, sha256: createHash("sha256").update(value).digest("hex"), ...(finishTokens.has(value) ? { token: value } : {})
} : {}) });
/** Called only after the gateway's original response byte bound. Never copy
 * content, unknown strings/keys, error messages, headers or nested payloads. */
export function projectProviderEnvelope(raw: unknown): ProviderEnvelopeDiagnostics {
  const root = object(raw), choices = root.choices, first = object(Array.isArray(choices) ? choices[0] : undefined), message = object(first.message), error = object(root.error);
  const result: ProviderEnvelopeDiagnostics = { version: "provider-envelope-1", choicesType: type(choices),
    ...(Array.isArray(choices) ? { choicesCount: choices.length } : {}), errorPresent: Object.hasOwn(root, "error"),
    ...(typeof error.code === "number" && Number.isInteger(error.code) && error.code >= 100 && error.code <= 599 ? { errorCode: error.code } : {}) };
  if (Array.isArray(choices) && choices.length) result.firstChoice = { finishReason: control(first.finish_reason), nativeFinishReason: control(first.native_finish_reason),
    contentType: type(message.content), ...(typeof message.content === "string" ? { contentByteCount: new TextEncoder().encode(message.content).byteLength } : {}),
    messageErrorPresent: Object.hasOwn(message, "error") };
  return result;
}

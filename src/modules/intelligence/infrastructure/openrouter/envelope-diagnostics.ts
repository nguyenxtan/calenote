import { parseJsonWithoutDuplicateMembers } from "./strict-json";
import { createHash } from "node:crypto";

const finishTokens = new Set(["stop", "length", "error", "content_filter", "tool_calls", "function_call", "STOP", "MAX_TOKENS", "SAFETY", "RECITATION", "OTHER", "BLOCKLIST", "PROHIBITED_CONTENT", "MALFORMED_FUNCTION_CALL"]);
type Control = { type: string; token?: string; length?: number; sha256?: string };
type ErrorContent = { state: "NOT_INSPECTED" | "OVERSIZED" | "MALFORMED" | "JSON";
  jsonType?: string; errorPresent?: boolean; errorType?: string; errorCode?: number; code?: number };
export interface ProviderEnvelopeDiagnostics {
  version: "provider-envelope-1"; choicesType: string; choicesCount?: number;
  errorPresent: boolean; errorType: string; errorCode?: number;
  firstChoice?: { finishReason: Control; nativeFinishReason: Control; contentType: string; contentByteCount?: number;
    choiceErrorPresent: boolean; choiceErrorType: string; choiceErrorCode?: number;
    messageErrorPresent: boolean; messageErrorType: string; messageErrorCode?: number; errorContent: ErrorContent };
}
const type = (value: unknown) => value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const control = (value: unknown): Control => ({ type: type(value), ...(typeof value === "string" ? {
  length: value.length, sha256: createHash("sha256").update(value).digest("hex"), ...(finishTokens.has(value) ? { token: value } : {})
} : {}) });
const errorCode = (value: unknown): number | undefined => typeof value === "number" && Number.isInteger(value) && value >= 100 && value <= 599 ? value : undefined;
/** Diagnostic-only inspection of explicit provider-error content, never model
 * semantic content. Copy only JSON types, presence and finite HTTP-like codes. */
function errorContent(content: unknown, finish: unknown): ErrorContent {
  if (finish !== "error" || typeof content !== "string") return { state: "NOT_INSPECTED" };
  if (content.length > 32768 || new TextEncoder().encode(content).byteLength > 32768) return { state: "OVERSIZED" };
  let raw: unknown;
  try { raw = parseJsonWithoutDuplicateMembers(content); } catch { return { state: "MALFORMED" }; }
  const root = object(raw), error = object(root.error), nestedCode = errorCode(error.code), code = errorCode(root.code);
  return { state: "JSON", jsonType: type(raw), errorPresent: Object.hasOwn(root, "error"), errorType: type(root.error),
    ...(nestedCode === undefined ? {} : { errorCode: nestedCode }), ...(code === undefined ? {} : { code }) };
}
/** Called only after the gateway's original response byte bound. Never copy
 * content, unknown strings/keys, error messages, headers or nested payloads. */
export function projectProviderEnvelope(raw: unknown): ProviderEnvelopeDiagnostics {
  const root = object(raw), choices = root.choices, first = object(Array.isArray(choices) ? choices[0] : undefined), message = object(first.message);
  const rootCode = errorCode(object(root.error).code), choiceCode = errorCode(object(first.error).code), messageCode = errorCode(object(message.error).code);
  const result: ProviderEnvelopeDiagnostics = { version: "provider-envelope-1", choicesType: type(choices),
    ...(Array.isArray(choices) ? { choicesCount: choices.length } : {}), errorPresent: Object.hasOwn(root, "error"), errorType: type(root.error),
    ...(rootCode === undefined ? {} : { errorCode: rootCode }) };
  if (Array.isArray(choices) && choices.length) result.firstChoice = { finishReason: control(first.finish_reason), nativeFinishReason: control(first.native_finish_reason),
    contentType: type(message.content), ...(typeof message.content === "string" ? { contentByteCount: new TextEncoder().encode(message.content).byteLength } : {}),
    choiceErrorPresent: Object.hasOwn(first, "error"), choiceErrorType: type(first.error), ...(choiceCode === undefined ? {} : { choiceErrorCode: choiceCode }),
    messageErrorPresent: Object.hasOwn(message, "error"), messageErrorType: type(message.error), ...(messageCode === undefined ? {} : { messageErrorCode: messageCode }),
    errorContent: errorContent(message.content, first.finish_reason) };
  return result;
}

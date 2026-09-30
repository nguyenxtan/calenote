import { InterpretationJsonSchema } from "../../../conversation/context-contract/contracts";
import type { SemanticFailureDiagnostics } from "../../semantic-gateway";

// v1: <=4096 UTF8 serialized bytes; body <=32768 bytes; depth4, nodes128,
// arrays8; strings256; encoded raw JSON <=4096 bytes and <=3 nested parses.
// Arbitrary prose/identifiers never survive, even under a benign JSON key.
const encoder = new TextEncoder();
const codes = new Set(["invalid_argument", "invalid_request_error", "invalid_schema", "unsupported_parameters", "bad_request", "rate_limit_exceeded", "insufficient_quota", "context_length_exceeded", "permission_denied", "unauthenticated", "not_found", "resource_exhausted", "internal", "unavailable", "deadline_exceeded"]);
const providers = new Set(["Google", "google-vertex", "google-vertex/eu"]);
const keywords = new Set(["$schema", "$defs", "$ref", "definitions", "type", "properties", "required", "additionalProperties", "items", "prefixItems", "anyOf", "oneOf", "allOf", "not", "enum", "const", "pattern", "format", "minLength", "maxLength", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf", "minItems", "maxItems", "uniqueItems", "minProperties", "maxProperties", "description", "title", "default", "nullable"]);
const parameters = new Set(["generation_config", "response_schema", "generationConfig", "responseSchema", "response_format", "json_schema", "schema", "name", "strict", "messages", "max_tokens", "stream", "provider", "zdr", "require_parameters", "allow_fallbacks", "data_collection", "max_price", "prompt", "completion", "only", "order"]);
export async function projectProviderFailure(input: {
  status: number; length: number; media: string | null; bytes?: Uint8Array;
  state?: SemanticFailureDiagnostics["bodyState"]; headers: Headers; sensitive: readonly string[];
  /** Reviewed outbound request schema, never a provider-response schema. */
  schema?: unknown;
}): Promise<SemanticFailureDiagnostics> {
  const media = input.media?.split(";", 1)[0].trim().toLowerCase();
  const contentType = media === "application/json" || media === "text/plain" || media === "text/html" ? media : input.media === null ? "MISSING" : "OTHER";
  const result: SemanticFailureDiagnostics = { version: "provider-failure-1", httpStatus: input.status, responseBytes: input.length, contentType,
    bodyState: input.state ?? (!input.bytes?.byteLength ? "EMPTY" : contentType === "application/json" ? "JSON" : "NON_JSON") };
  const echoes = (value: string) => input.sensitive.some(secret => secret.length > 0 && value.includes(secret));
  const safeString = (value: unknown): value is string => typeof value === "string" && value.length <= 256 && !echoes(value);
  const properties = new Set<string>();
  let schemaNodes = 0;
  const schemaWords = (value: unknown, depth: number): void => {
    if (++schemaNodes > 16384 || depth > 64 || !value || typeof value !== "object") return;
    if (Array.isArray(value)) { value.slice(0, 128).forEach(child => schemaWords(child, depth + 1)); return; }
    const object = value as Record<string, unknown>;
    if (object.properties && typeof object.properties === "object" && !Array.isArray(object.properties)) {
      for (const name of Object.keys(object.properties).slice(0, 128)) {
        if (safeString(name) && /^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(name)) properties.add(name);
      }
    }
    Object.values(object).slice(0, 128).forEach(child => schemaWords(child, depth + 1));
  };
  schemaWords(input.schema ?? InterpretationJsonSchema, 0);
  // Header grammars contain only hex payload slots. Check the reversible UTF8
  // representation of every known sensitive value, including a value spanning
  // trace-id/span-id slots. Long values cannot fit the <=64-hex payload budget.
  const sensitiveHex = input.sensitive.flatMap(value => {
    if (!value || value.length > 64) return [];
    const bytes = encoder.encode(value);
    return bytes.byteLength <= 32 ? [[...bytes].map(byte => byte.toString(16).padStart(2, "0")).join("")] : [];
  });
  const safePayload = (hex: string) => !sensitiveHex.some(secret => hex.includes(secret));
  // Only these exact headers are read. Their formats constrain the entire value.
  const requestId = input.headers.get("x-request-id");
  if (safeString(requestId) && /^req-[a-f0-9]{16,64}$/u.test(requestId) && safePayload(requestId.slice(4))) result.requestId = requestId;
  const ray = input.headers.get("cf-ray"), trace = input.headers.get("traceparent");
  if (safeString(trace) && /^00-[a-f0-9]{32}-[a-f0-9]{16}-0[01]$/u.test(trace) && !/^00-0{32}|^00-[a-f0-9]{32}-0{16}/u.test(trace)
    && safePayload(trace.slice(3, 35) + trace.slice(36, 52))) result.traceId = trace;
  else if (safeString(ray) && /^[a-f0-9]{16}-[A-Z]{3}$/u.test(ray) && safePayload(ray.slice(0, 16))) result.traceId = ray;
  if (input.bytes) {
    try {
      const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(input.bytes));
      result.bodyDigest = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
    } catch { /* Digest failure cannot emit raw text or alter application policy. */ }
  }
  let nodes = 0, parses = 0;
  const code = (value: unknown): string | number | undefined => {
    if (typeof value === "number" && Number.isInteger(value) && (value >= 0 && value <= 16 || value >= 100 && value <= 599)) return value;
    if (safeString(value)) {
      const normalized = value.toLowerCase();
      if (codes.has(normalized) && !echoes(normalized)) return normalized;
    }
  };
  const path = (value: unknown): string | undefined => {
    if (!safeString(value)) return;
    // Validate the complete grammar before splitting; reject empty segments,
    // unmatched brackets and suffixes rather than retaining a plausible prefix.
    if (!/^[A-Za-z_$][A-Za-z0-9_$]*(?:(?:[./][A-Za-z_$0-9][A-Za-z0-9_$]*)|(?:\[[A-Za-z_$0-9][A-Za-z0-9_$]*\]))*$/u.test(value)) return;
    const pieces = value.match(/[A-Za-z_$0-9]+/gu)!;
    if (pieces.length > 24 || !parameters.has(pieces[0])) return;
    for (let i = 1; i < pieces.length; i++) {
      if (pieces[i - 1] === "properties") { if (!properties.has(pieces[i])) return; }
      else if (!parameters.has(pieces[i]) && !keywords.has(pieces[i]) && !/^\d{1,2}$/u.test(pieces[i])) return;
    }
    if (pieces.at(-1) === "properties") return;
    return value;
  };
  const keyword = (value: unknown): string | undefined => safeString(value) && keywords.has(value) ? value : undefined;
  const labels = (value: unknown): Record<string, string> => {
    const out: Record<string, string> = {};
    if (typeof value !== "string" || value.length > 4096) return out;
    // Only validated labels survive. A private sibling sentence cannot erase
    // an independent structural cause; a private label itself never survives.
    const named = /(?:Unknown name|unsupported (?:schema )?keyword)\s*(?::\s*|["'])([A-Za-z_$][A-Za-z0-9_$]{0,255})(?=$|[\s"',:;])/iu.exec(value);
    const safeKeyword = keyword(named?.[1]); if (safeKeyword) out.keyword = safeKeyword;
    const located = /\bat\s+["']([^"']{1,256})["']/u.exec(value);
    const safePath = path(located?.[1]); if (safePath) out.path = safePath;
    const field = /\b(?:field|parameter|param)\s*:\s*["']?([^\s"',:;]{1,256})(?=$|[\s"',:;])/iu.exec(value);
    const safeParam = path(field?.[1]); if (safeParam) out.param = safeParam;
    const describedPath = /\bpath\s*:\s*["']?([^\s"',:;]{1,256})(?=$|[\s"',:;])/iu.exec(value);
    const safeDescribedPath = path(describedPath?.[1]); if (safeDescribedPath) out.path = safeDescribedPath;
    // Match complete categorical tokens, never arbitrary provider reason prose.
    for (const token of value.match(/[A-Za-z_]+/gu) ?? []) {
      const safeCode = code(token); if (typeof safeCode === "string") { out.status = safeCode; break; }
    }
    return out;
  };
  const message = (value: unknown): string | undefined => {
    if (typeof value !== "string" || value.length > 4096) return "[REDACTED]";
    // Emit only locally authored categories, never slices of untrusted prose.
    let category: string | undefined;
    if (/\bUnknown name\s+["']/u.test(value) && labels(value).keyword) category = `Unsupported schema construct: ${labels(value).keyword}`;
    else if (/\bunsupported (?:schema )?keywords?\b/iu.test(value)) category = "Unsupported schema keyword";
    else if (/\binvalid schema\b/iu.test(value)) category = "Invalid schema";
    else if (/\bunsupported parameters?\b/iu.test(value)) category = "Unsupported parameter";
    else if (/\bcontext length\b/iu.test(value)) category = "Context length exceeded";
    else if (/\bschema\b/iu.test(value) && /\btoo many states\b/iu.test(value)) category = "Schema state limit exceeded";
    else if (/\bschema\b/iu.test(value) && /\bnesting (?:depth )?(?:exceeded|limit)\b/iu.test(value)) category = "Schema nesting limit exceeded";
    else if (/\bschema\b/iu.test(value) && /\btoo complex\b/iu.test(value)) category = "Schema complexity limit exceeded";
    if (category && !echoes(category)) return category;
    return "[REDACTED]";
  };
  const project = (value: unknown, depth: number): unknown => {
    if (++nodes > 128 || depth > 4 || value === null || typeof value !== "object") return undefined;
    if (Array.isArray(value)) return value.slice(0, 8).map(v => project(v, depth + 1)).filter(v => v !== undefined);
    const object = value as Record<string, unknown>, out: Record<string, unknown> = {};
    for (const key of ["code", "status", "type", "reason"]) { const safe = code(object[key]); if (safe !== undefined) out[key] = safe; }
    for (const key of ["message", "description"]) {
      if (Object.hasOwn(object, key)) { out[key] = message(object[key]); Object.assign(out, labels(object[key])); }
    }
    for (const key of ["param", "path", "field"]) { const safe = path(object[key]); if (safe) out[key] = safe; }
    const safeKeyword = keyword(object.keyword); if (safeKeyword) out.keyword = safeKeyword;
    if (safeString(object.provider_name) && providers.has(object.provider_name)) out.provider_name = object.provider_name;
    for (const key of ["error", "errors", "details", "metadata", "fieldViolations"]) {
      if (Object.hasOwn(object, key)) { const nested = project(object[key], depth + 1); if (nested !== undefined) out[key] = nested; }
    }
    if (typeof object.raw === "string" && encoder.encode(object.raw).byteLength <= 4096 && ++parses <= 3) {
      try { const nested = project(JSON.parse(object.raw), depth + 1); if (nested !== undefined) out.raw = nested; } catch { /* Never copy raw. */ }
    }
    return Object.keys(out).length ? out : undefined;
  };
  if (result.bodyState === "JSON" && input.bytes) {
    let text: string;
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(input.bytes); } catch { result.bodyState = "INVALID_UTF8"; return result; }
    try {
      const raw: unknown = JSON.parse(text);
      if (raw && typeof raw === "object" && !Array.isArray(raw)) {
        const error = (raw as Record<string, unknown>).error;
        if (error && typeof error === "object" && !Array.isArray(error)) {
          const object = error as Record<string, unknown>;
          const safeCode = code(object.code); if (safeCode !== undefined) result.errorCode = safeCode;
          if (Object.hasOwn(object, "message")) result.errorMessageSanitized = message(object.message);
          // Exclude only the provider's root error envelope from metadata depth;
          // root and nested structural causes now share the same projection.
          result.errorMetadataSanitized = project(object, -1);
          const metadata = object.metadata as Record<string, unknown> | undefined;
          if (metadata && safeString(metadata.provider_name) && providers.has(metadata.provider_name)) result.upstreamProvider = metadata.provider_name;
        }
      }
    } catch { result.bodyState = "MALFORMED_JSON"; }
  }
  if (encoder.encode(JSON.stringify(result)).byteLength > 4096) delete result.errorMetadataSanitized;
  return result;
}

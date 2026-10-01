import type { z } from "zod";

const keys = new Set("schemaVersion intent dialogueAct continuation changes query uncertainties controlEvidence conversationDirective replyProposal field fieldCode operation value evidence kind calendar day month year leapMonth offsetDays weekday qualifier hour minute turn quote occurrence ref period statusScope date outputCalendar topic offset from through reason alternatives issue queryKind text".split(" "));
const rootKeys = new Set("schemaVersion intent dialogueAct continuation changes query uncertainties controlEvidence conversationDirective replyProposal".split(" "));
const types = new Set(["string", "number", "boolean", "null", "undefined", "array", "object", "int"]);
export interface CanonicalValidationIssue {
  path: Array<string | number>; code: string; expected?: string; actualType: string;
  classification: "missing" | "extra" | "value"; unknownPathSegments: number; extraKeyCount?: number;
}
export interface CanonicalValidationDiagnostics {
  schemaVersion: "calenote-context-2"; issues: CanonicalValidationIssue[];
  topLevelKeys: string[]; unknownTopLevelKeyCount: number; truncated: boolean;
}
const jsonType = (value: unknown) => value === null ? "null" : Array.isArray(value) ? "array" : typeof value === "object" ? "object" : types.has(typeof value) ? typeof value : "non_json";
/** Zod issues are untrusted: never copy messages, literals, inputs or unknown
 * names. Visit only bounded issue lists and bounded paths, never payload trees. */
export function projectCanonicalValidation(raw: unknown, issues: readonly z.core.$ZodIssue[]): CanonicalValidationDiagnostics {
  const result: CanonicalValidationDiagnostics = { schemaVersion: "calenote-context-2", issues: [], topLevelKeys: [], unknownTopLevelKeyCount: 0, truncated: false };
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const key of Object.keys(raw)) {
      if (rootKeys.has(key)) result.topLevelKeys.push(key);
      else result.unknownTopLevelKeyCount++;
    }
  }
  let visited = 0;
  const visit = (list: readonly z.core.$ZodIssue[], depth: number, prefix: PropertyKey[] = []) => {
    for (const issue of list) {
      if (result.issues.length >= 24 || visited++ >= 128 || depth > 4) { result.truncated = true; return; }
      const fullPath = [...prefix, ...issue.path];
      const segments = fullPath.slice(0, 8); let value = raw, unknownPathSegments = 0;
      const path = segments.map(segment => {
        if (value && typeof value === "object" && Object.hasOwn(value, segment)) value = (value as Record<PropertyKey, unknown>)[segment]; else value = undefined;
        if (typeof segment === "number" && Number.isSafeInteger(segment) && segment >= 0) return segment;
        if (typeof segment === "string" && keys.has(segment)) return segment;
        unknownPathSegments++; return "REDACTED";
      });
      if (fullPath.length > 8) result.truncated = true;
      result.issues.push({ path, code: issue.code, actualType: jsonType(value), unknownPathSegments,
        classification: issue.code === "unrecognized_keys" ? "extra" : value === undefined && issue.code === "invalid_type" ? "missing" : "value",
        ...(issue.code === "invalid_type" && types.has(issue.expected) ? { expected: issue.expected } : issue.code === "invalid_value" ? { expected: "CONTROL_ENUM" } : {}),
        ...(issue.code === "unrecognized_keys" ? { extraKeyCount: issue.keys.length } : {}) });
      if (issue.code === "invalid_union") {
        // Prefer branches whose trusted control discriminants matched. Otherwise
        // the first text branch can consume the budget before a later date or
        // evidence branch exposes the actual structural failure.
        const rank = (branch: readonly z.core.$ZodIssue[]) => branch.filter(child => child.code === "invalid_value"
          && ["field", "operation", "kind"].includes(String(child.path.at(-1)))).length;
        for (const branch of [...issue.errors].sort((a, b) => rank(a) - rank(b))) { visit(branch, depth + 1, fullPath); if (result.truncated) break; }
      }
    }
  };
  visit(issues, 0); return result;
}
export function projectWireValidation(raw: unknown, path: PropertyKey[], expected: string, extraKeyCount?: number): CanonicalValidationDiagnostics {
  const result = projectCanonicalValidation(raw, [{ code: "custom", path, message: "" }]);
  result.issues[0].code = "WIRE_SHAPE_INVALID";
  if (["null", "string", "number", "integer", "boolean", "array", "object", "CONTROL_ENUM", "UNION", "REQUIRED_PROPERTY"].includes(expected)) result.issues[0].expected = expected;
  if (result.issues[0].actualType === "undefined") result.issues[0].classification = "missing";
  if (extraKeyCount !== undefined) { result.issues[0].classification = "extra"; result.issues[0].extraKeyCount = extraKeyCount; }
  return result;
}

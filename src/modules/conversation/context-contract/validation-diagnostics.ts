import type { z } from "zod";
import { createHash } from "node:crypto";
import { projectCanonicalConstraint, type CanonicalConstraintId, type OwnershipControlState } from "./canonical-constraints";
import { FieldChangeV3Schema } from "./contracts";

const keys = new Set("schemaVersion operationCode intent requestTarget dialogueAct continuation changes query uncertainties controlEvidence conversationDirective replyProposal field fieldCode operation value evidence primaryEvidence additionalEvidenceJson kind calendar day month year leapMonth offsetDays weekday qualifier hour minute turn quote occurrence ref period statusScope date outputCalendar topic offset from through reason alternatives issue queryKind text".split(" "));
const rootKeys = new Set("schemaVersion operationCode intent requestTarget dialogueAct continuation changes query uncertainties controlEvidence conversationDirective replyProposal".split(" "));
for(const key of ["titleChange","index","change"])keys.add(key);
rootKeys.add("titleChange");
// Trusted provider-envelope paths only; values and unknown keys stay redacted.
for (const key of ["choices", "message", "content", "finish_reason", "tool_calls", "function_call"]) keys.add(key);
const types = new Set(["string", "number", "boolean", "null", "undefined", "array", "object", "int"]);
export interface CanonicalValidationIssue {
  path: Array<string | number>; code: string; expected?: string; actualType: string;
  classification: "missing" | "extra" | "value"; unknownPathSegments: number; extraKeyCount?: number;
  constraint?: "ARRAY_CARDINALITY" | "CONTROL_ENUM"; actualCount?: number; minItems?: number; maxItems?: number;
  acceptedDomainId?: string; acceptedValueCount?: number; actualSafeToken?: string; actualDigest?: string; actualLength?: number;
  constraintId?: CanonicalConstraintId; participatingFields?: string[]; expectedCategory?: string; actualCategory?: string;
  ownershipState?: OwnershipControlState;
  embeddedJsonType?: "object" | "array" | "null" | "string" | "number" | "boolean" | "INVALID_JSON" | "OVERSIZED";
  titleOwnership?: {ordinaryCount:number;carrierOperation:ReturnType<typeof projectControlEnum>;ordinaryOperations:Array<{index:number}&ReturnType<typeof projectControlEnum>>;truncated:boolean};
}
/** Only the decoder's trusted finite domains may call this projector. Never
 * infer control authority from an arbitrary string's shape. */
export function projectControlEnum(domain: readonly unknown[], actual: unknown): Pick<CanonicalValidationIssue, "constraint" | "acceptedDomainId" | "acceptedValueCount" | "actualSafeToken" | "actualDigest" | "actualLength" | "actualType" | "classification"> {
  const values = [...new Set(domain.map(value => JSON.stringify(value)))].sort();
  return { constraint: "CONTROL_ENUM", acceptedDomainId: `CONTROL_DOMAIN_SHA256:${createHash("sha256").update(JSON.stringify(values)).digest("hex")}`, acceptedValueCount: values.length, actualType: jsonType(actual), classification: actual === undefined ? "missing" : "value",
    ...(typeof actual === "string" ? { actualLength: actual.length, actualDigest: createHash("sha256").update(actual, "utf8").digest("hex"),
      ...(/^[A-Za-z0-9_:.\-]{1,48}$/.test(actual) ? { actualSafeToken: actual } : {}) } : {}) };
}
export interface CanonicalValidationDiagnostics {
  schemaVersion: "calenote-context-2" | "calenote-context-3"; issues: CanonicalValidationIssue[];
  topLevelKeys: string[]; unknownTopLevelKeyCount: number; truncated: boolean;
}
const jsonType = (value: unknown) => value === null ? "null" : Array.isArray(value) ? "array" : typeof value === "object" ? "object" : types.has(typeof value) ? typeof value : "non_json";
/** Zod issues are untrusted: never copy messages, literals, inputs or unknown
 * names. Visit only bounded issue lists and bounded paths, never payload trees. */
export function projectCanonicalValidation(raw: unknown, issues: readonly z.core.$ZodIssue[], schemaVersion: CanonicalValidationDiagnostics["schemaVersion"] = "calenote-context-2"): CanonicalValidationDiagnostics {
  const result: CanonicalValidationDiagnostics = { schemaVersion, issues: [], topLevelKeys: [], unknownTopLevelKeyCount: 0, truncated: false };
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
        ...(issue.code === "unrecognized_keys" ? { extraKeyCount: issue.keys.length } : {}),
        ...(issue.code === "custom" ? projectCanonicalConstraint(issue.params) : {}) });
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
export function projectWireValidation(raw: unknown, path: PropertyKey[], expected: string, extraKeyCount?: number, schemaVersion: CanonicalValidationDiagnostics["schemaVersion"] = "calenote-context-2", cardinality?: { actualCount: number; minItems?: number; maxItems?: number }, control?: ReturnType<typeof projectControlEnum>): CanonicalValidationDiagnostics {
  const result = projectCanonicalValidation(raw, [{ code: "custom", path, message: "" }], schemaVersion);
  // These two trusted transport slots encode evidence JSON. Traverse the
  // bounded decoded structure only for type telemetry, never retain values.
  // Canonical projection and all acceptance predicates remain unchanged.
  let structural: unknown = raw, decodedBoundary = false;
  for (const segment of path.slice(0, 8)) {
    structural = structural && typeof structural === "object" && Object.hasOwn(structural, segment)
      ? (structural as Record<PropertyKey, unknown>)[segment] : undefined;
    if ((segment === "primaryEvidence" || segment === "additionalEvidenceJson") && typeof structural === "string"
      && new TextEncoder().encode(structural).length <= 32768) {
      try { structural = JSON.parse(structural); decodedBoundary = true; } catch { /* Invalid JSON stays a string. */ }
    }
  }
  if (decodedBoundary) {
    result.issues[0].actualType = jsonType(structural);
    result.issues[0].classification = structural === undefined ? "missing" : "value";
  }
  result.issues[0].code = "WIRE_SHAPE_INVALID";
  if (["null", "string", "number", "integer", "boolean", "array", "object", "CONTROL_ENUM", "UNION", "REQUIRED_PROPERTY", "DATE_OPERAND_JSON", "UNIQUE_TITLE_OWNER", "TITLE_SET_CARRIER_REQUIRED"].includes(expected)) result.issues[0].expected = expected;
  if (result.issues[0].actualType === "undefined") result.issues[0].classification = "missing";
  if (extraKeyCount !== undefined) { result.issues[0].classification = "extra"; result.issues[0].extraKeyCount = extraKeyCount; }
  if (result.issues[0].actualType === "array" && cardinality && [cardinality.actualCount, cardinality.minItems, cardinality.maxItems].every(value => value === undefined || Number.isSafeInteger(value) && value >= 0)) {
    result.issues[0].constraint = "ARRAY_CARDINALITY";
    result.issues[0].actualCount = cardinality.actualCount;
    if (cardinality.minItems !== undefined) result.issues[0].minItems = cardinality.minItems;
    if (cardinality.maxItems !== undefined) result.issues[0].maxItems = cardinality.maxItems;
  }
  if (expected === "CONTROL_ENUM" && control) Object.assign(result.issues[0], control);
  if(expected==="UNIQUE_TITLE_OWNER" && path.length===1 && path[0]==="titleChange" && raw && typeof raw==="object" && !Array.isArray(raw)){
    const object=raw as Record<string,unknown>,carrier=object.titleChange as {change?:{operation?:unknown}}|undefined;
    if(carrier && typeof carrier==="object" && Array.isArray(object.changes)){
      const domain=[...new Set(FieldChangeV3Schema.options.flatMap(branch=>{
        const operation=branch.shape.operation;
        return "options" in operation ? operation.options : [operation.value];
      }))];
      const operationMetadata=(value:unknown)=>{
        const projected=projectControlEnum(domain,value);
        if(!domain.some(member=>member===value))delete projected.actualSafeToken;
        return projected;
      };
      const operations:Array<{index:number}&ReturnType<typeof projectControlEnum>>=[];
      let ordinaryCount=0;
      for(const [index,change] of object.changes.entries())if(change && typeof change==="object" && !Array.isArray(change) && change.field==="title"){
        ordinaryCount++;
        if(operations.length<8)operations.push({index,...operationMetadata(change.operation)});
      }
      result.issues[0].titleOwnership={ordinaryCount,carrierOperation:operationMetadata(carrier.change?.operation),ordinaryOperations:operations,truncated:ordinaryCount>operations.length};
    }
  }
  // This carrier must be an object, never JSON-in-a-string. Inspect only the
  // rejected top-level requestTarget for bounded type telemetry; do not use
  // the parsed value for decoding, repair, semantic authority or acceptance.
  if (path.length === 1 && path[0] === "requestTarget" && expected === "object" && typeof structural === "string") {
    // Only exact members of the application-owned target control family are
    // safe to retain here. Never use arbitrary token shape to classify text.
    if (["CURRENT", "NEW", "UNRESOLVED"].includes(structural)) result.issues[0].actualSafeToken = structural;
    if (structural.length > 32768 || new TextEncoder().encode(structural).byteLength > 32768) result.issues[0].embeddedJsonType = "OVERSIZED";
    else {
      try { result.issues[0].embeddedJsonType = jsonType(JSON.parse(structural)) as NonNullable<CanonicalValidationIssue["embeddedJsonType"]>; }
      catch { result.issues[0].embeddedJsonType = "INVALID_JSON"; }
    }
  }
  return result;
}

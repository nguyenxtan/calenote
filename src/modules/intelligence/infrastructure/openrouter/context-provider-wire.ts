import { LegacyV2ConversationInterpretationSchema as ConversationInterpretationSchema, LegacyV2InterpretationJsonSchema as InterpretationJsonSchema, LegacyV2UncertaintySchema as UncertaintySchema, LegacyV2parseInterpretationSections as parseInterpretationSections, type LegacyV2InterpretationSections as InterpretationSections, type LegacyV2ConversationInterpretation as ConversationInterpretation } from "../../../conversation/context-contract/contracts";
import { projectCanonicalValidation, projectControlEnum, projectWireValidation } from "../../../conversation/context-contract/validation-diagnostics";
import { googleLiteEuProviderWireSchema } from "./provider-wire-schema";
import { ConversationInterpretationV3Schema, DateOperandSchema, InterpretationJsonSchemaV3, UncertaintyV3Schema, parseInterpretationSectionsV3, type ConversationInterpretationV3, type InterpretationSectionsV3 } from "../../../conversation/context-contract/contracts";
import { CONTEXT_PROTOCOL_V3, isContextProtocolV3, type ContextProtocolV3 } from "../../../conversation/context-contract/protocol";
import type { ProviderWireSchemaV3 } from "./provider-wire-schema";
import {issueListTransport, type ContextGatewayInterpretation, type DecodedListCore, type ListPeriodProposal} from "../../../conversation/context-contract/list-period-transport";

export const GOOGLE_LITE_EU_CONTEXT_WIRE_VERSION = "google-gemini-2.5-flash-lite-vertex-eu-context-field-codebook-9" as const;
// Immutable V1 transport protocol, independent of canonical declaration order.
// The application chooses this mapping, never the model or response payload.
export const UNCERTAINTY_FIELD_WIRE_CODE_V1 = Object.freeze({
  title: 0, location: 1, notes: 2, eventDate: 3, eventTime: 4,
  reminderDate: 5, reminderTime: 6, calendar: 7, frequency: 8,
  occurrenceCount: 9, eventRelation: 10, leadOffsetDays: 11, endDate: 12,
  intent: 13, queryRange: 14, operation: 15,
} as const satisfies Record<ConversationInterpretation["uncertainties"][number]["field"], number>);
const uncertaintyFieldByCode = new Map<number, string>(Object.entries(UNCERTAINTY_FIELD_WIRE_CODE_V1).map(([field, code]) => [code, field]));
type Schema = { [key: string]: unknown; $ref?: string; type?: string; properties?: Record<string, Schema>; required?: string[]; additionalProperties?: boolean; $defs?: Record<string, Schema>; anyOf?: Schema[]; oneOf?: Schema[]; allOf?: Schema[]; items?: Schema; enum?: unknown[]; const?: unknown; };
function requireShape(condition: unknown): asserts condition { if (!condition) throw new Error("CONTEXT_PROVIDER_WIRE_INVALID"); }
const stable = (value: unknown): unknown => Array.isArray(value) ? value.map(stable) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stable(item)])) : value;
const equal = (a: unknown, b: unknown) => JSON.stringify(stable(a)) === JSON.stringify(stable(b));
const unique = (values: Schema[]) => [...new Map(values.map(value => [JSON.stringify(stable(value)), value])).values()];
const union = (values: Schema[]): Schema => { const options = unique(values); return options.length === 1 ? options[0] : { anyOf: options }; };
function at(root: Schema, pointer: string): Schema {
  requireShape(pointer.startsWith("#/"));
  let node: unknown = root;
  for (const token of decodeURIComponent(pointer).slice(2).split("/")) {
    const key = token.replaceAll("~1", "/").replaceAll("~0", "~");
    requireShape(node && typeof node === "object" && Object.hasOwn(node, key)); node = (node as Record<string, unknown>)[key];
  }
  requireShape(node && typeof node === "object" && !Array.isArray(node)); return node as Schema;
}
function deref(node: Schema, root: Schema): Schema {
  const seen = new Set<string>();
  while (node.$ref) { requireShape(Object.keys(node).length === 1 && !seen.has(node.$ref)); seen.add(node.$ref); node = at(root, node.$ref); }
  return node;
}
function taggedPlan(node: Schema, root: Schema) {
  const keyword = node.anyOf ? "anyOf" : node.oneOf ? "oneOf" : null;
  if (!keyword) return null;
  const branches = node[keyword]!.map(branch => deref(branch, root));
  if (!branches.every(branch => branch.type === "object" && branch.additionalProperties === false)) return null;
  requireShape(Object.keys(node).length === 1);
  const tags = branches.map(branch => {
    requireShape(branch.properties && branch.required && equal([...branch.required].sort(), Object.keys(branch.properties).sort()));
    return Object.fromEntries(Object.entries(branch.properties).flatMap(([key, child]) => {
      const predicate = deref(child, root), values = Object.hasOwn(predicate, "const") ? [predicate.const] : predicate.enum;
      return values && branch.required!.includes(key) ? [[key, values]] : [];
    })) as Record<string, unknown[]>;
  });
  if (!tags.every(tag => Object.keys(tag).length > 0)) return null;
  for (let i = 0; i < tags.length; i++) for (let j = i + 1; j < tags.length; j++) requireShape(Object.entries(tags[i]).some(([key, values]) => tags[j][key] && !values.some(value => tags[j][key].some(other => equal(value, other)))));
  return { keyword, branches, tags, keys: [...new Set(branches.flatMap(branch => Object.keys(branch.properties!)))] };
}
function mapSchemas(node: Schema, transform: (child: Schema) => Schema): Schema {
  const output = structuredClone(node);
  for (const key of ["properties", "$defs"] as const) if (node[key]) output[key] = Object.fromEntries(Object.entries(node[key]).map(([name, child]) => [name, transform(child)]));
  for (const key of ["anyOf", "oneOf", "allOf"] as const) if (node[key]) output[key] = node[key].map(transform);
  if (node.items) output.items = transform(node.items);
  return output;
}
const original = googleLiteEuProviderWireSchema(InterpretationJsonSchema).schema as Schema;
function flatten(node: Schema, root: Schema = original): Schema {
  const plan = taggedPlan(node, root);
  if (!plan) return mapSchemas(node, child => flatten(child, root));
  // Keep the discriminator, payload and inactive nulls in the SAME branch.
  // Independently unioning properties admits their Cartesian product; likewise
  // moving alternatives across arrays loses the uncertainty field association.
  return { anyOf: plan.branches.map(branch => ({ type: "object",
    properties: Object.fromEntries(plan.keys.map(key => [key, Object.hasOwn(branch.properties!, key) ? flatten(branch.properties![key], root) : { type: "null" }])),
    required: [...plan.keys], additionalProperties: false })) };
}
function prune(root: Schema): Schema {
  const output = structuredClone(root), reached = new Set<string>();
  function visit(node: Schema) {
    if (node.$ref) {
      const tokens = decodeURIComponent(node.$ref).slice(2).split("/").map(token => token.replaceAll("~1", "/").replaceAll("~0", "~"));
      requireShape(node.$ref.startsWith("#/$defs/") && tokens.length === 2 && output.$defs && Object.hasOwn(output.$defs, tokens[1]));
      if (!reached.has(tokens[1])) { reached.add(tokens[1]); visit(output.$defs[tokens[1]]); }
    }
    for (const child of Object.values(node.properties ?? {})) visit(child);
    for (const children of [node.anyOf, node.oneOf, node.allOf]) for (const child of children ?? []) visit(child);
    if (node.items) visit(node.items);
  }
  visit(output);
  for (const key of Object.keys(output.$defs!)) if (!reached.has(key)) delete output.$defs![key];
  return output;
}
function omitAnnotations(node: Schema): Schema {
  const output = mapSchemas(node, omitAnnotations);
  for (const key of ["minimum", "maximum", "minItems", "maxItems", "minLength", "maxLength", "pattern"]) delete output[key];
  return output;
}
function simpleScalar(node: Schema, root: Schema) {
  node = deref(node, root);
  if (!node.type || !["string", "integer", "number", "boolean"].includes(node.type) || Object.keys(node).some(key => !["type", "const", "enum"].includes(key)) || Object.hasOwn(node, "const") && node.enum) return null;
  const values = Object.hasOwn(node, "const") ? [node.const] : node.enum;
  if (values && (!values.length || !values.every(value => predicate({ type: node.type }, value, root)))) return null;
  return { node, base: Object.keys(node).length === 1, values };
}
function normalizeScalars(root: Schema): Schema {
  function visit(node: Schema): Schema {
    if (node.anyOf && Object.keys(node).length === 1) {
      const classes = node.anyOf.map(branch => simpleScalar(branch, root)), keep = new Set(node.anyOf.map((_, index) => index));
      classes.forEach((item, index) => {
        if (!item) return;
        const duplicate = classes.some((other, earlier) => earlier < index && keep.has(earlier) && other && equal(item.node, other.node));
        const covered = !item.base && classes.some((other, witness) => witness !== index && keep.has(witness) && other?.base && item.values?.every(value => predicate(other.node, value, root)));
        if (duplicate || covered) keep.delete(index);
      });
      if (keep.size !== node.anyOf.length) return { anyOf: [...keep].map(index => structuredClone(node.anyOf![index])) };
    }
    return mapSchemas(node, visit);
  }
  return visit(root);
}
/** Merge only branches that differ in one finite scalar discriminant. The
 * shared payload remains correlated; no array/item or property cross-product. */
function coalesceBranches(root: Schema): Schema {
  function visit(raw: Schema): Schema {
    const node = mapSchemas(raw, visit);
    if (!node.anyOf || Object.keys(node).length !== 1) return node;
    const branches = unique(node.anyOf);
    for (let i = 0; i < branches.length; i++) for (let j = i + 1; j < branches.length; j++) {
      const left = branches[i], right = branches[j];
      if (left.type !== "object" || right.type !== "object" || !left.properties || !right.properties) continue;
      const leftShell = { ...left, properties: undefined }, rightShell = { ...right, properties: undefined };
      if (!equal(leftShell, rightShell) || !equal(Object.keys(left.properties), Object.keys(right.properties))) continue;
      const changed = Object.keys(left.properties).filter(key => !equal(left.properties![key], right.properties![key]));
      if (changed.length !== 1) continue;
      const key = changed[0], a = simpleScalar(left.properties[key], root), b = simpleScalar(right.properties[key], root);
      if (!a?.values || !b?.values || a.node.type !== b.node.type) continue;
      left.properties[key] = { type: a.node.type, enum: [...new Set([...a.values, ...b.values])] };
      branches.splice(j--, 1);
    }
    return union(branches);
  }
  return visit(root);
}
/** Identical assertions under different local names denote the same language.
 * Intern only exact schema equality, never a union of differing payloads. */
function internDefinitions(root: Schema): Schema {
  const aliases = new Map<string, string>(), representatives = new Map<string, string>();
  for (const [name, definition] of Object.entries(root.$defs ?? {})) {
    const signature = JSON.stringify(stable(definition)), representative = representatives.get(signature);
    if (representative) aliases.set(`#/$defs/${name}`, `#/$defs/${representative}`);
    else representatives.set(signature, name);
  }
  const visit = (node: Schema): Schema => {
    if (node.$ref && aliases.has(node.$ref)) {
      requireShape(Object.keys(node).length === 1);
      return { $ref: aliases.get(node.$ref)! };
    }
    return mapSchemas(node, visit);
  };
  return visit(root);
}
/** Avoid the measured nested alternative-object state explosion. Field/value
 * association and evidence constraints remain canonical application checks. */
function simplifyUncertainties(root: Schema): Schema {
  const output = structuredClone(root), items = deref(output.properties!.uncertainties.items!, output);
  requireShape(items.anyOf?.length);
  const reason = items.anyOf[0].properties!.reason;
  requireShape(items.anyOf.every(branch => equal(branch.properties!.reason, reason)));
  output.properties!.uncertainties.items = { type: "object", properties: {
    fieldCode: { type: "integer", minimum: 0, maximum: 15,
      description: "UncertaintyFieldWireCodeV1: " + Object.entries(UNCERTAINTY_FIELD_WIRE_CODE_V1).map(([field, code]) => `${code}=${field}`).join(","),
    }, reason: structuredClone(reason), alternatives: { type: "array", items: {
      type: "string", description: "JSON encoding of a canonical alternative object with value and evidence; use the value type corresponding to the uncertainty field.",
    } },
  }, required: ["fieldCode", "reason", "alternatives"], additionalProperties: false };
  return prune(output);
}
const applicationSchemaVersion = ConversationInterpretationSchema.shape.schemaVersion.value;
// Only root protocol metadata is application-owned. Nested kind/field/operation
// discriminators remain model proposals and must retain their existing checks.
const providerRoot = structuredClone(original);
delete providerRoot.properties!.schemaVersion;
providerRoot.required = providerRoot.required!.filter(key => key !== "schemaVersion");
const providerSchema = simplifyUncertainties(prune(coalesceBranches(internDefinitions(normalizeScalars(omitAnnotations(prune(flatten(providerRoot))))))));
/** Versioned context representation. Canonical prompt/schema and the namespace-only adapter remain unchanged. */
/** Historical context2 reference codec only. Selected service/gateway use V3
 * exports below; this cannot select, dispatch, or adapt protocols. */
export function legacyV2GoogleLiteEuContextWireSchema() {
  return { version: GOOGLE_LITE_EU_CONTEXT_WIRE_VERSION, schema: structuredClone(providerSchema) as typeof InterpretationJsonSchema };
}
function predicate(raw: Schema, value: unknown, root: Schema): boolean {
  const node = deref(raw, root);
  if (node.anyOf && !node.anyOf.some(branch => predicate(branch, value, root))) return false;
  if (node.oneOf && node.oneOf.filter(branch => predicate(branch, value, root)).length !== 1) return false;
  if (Object.hasOwn(node, "const") && !equal(value, node.const)) return false;
  if (node.enum && !node.enum.some(item => equal(value, item))) return false;
  if (node.type === "null") return value === null;
  if (node.type === "boolean") return typeof value === "boolean";
  if (node.type === "integer" || node.type === "number") return typeof value === "number" && Number.isFinite(value) && (node.type !== "integer" || Number.isInteger(value)) && (node.minimum === undefined || value >= Number(node.minimum)) && (node.maximum === undefined || value <= Number(node.maximum));
  if (node.type === "string") return typeof value === "string" && (node.minLength === undefined || [...value].length >= Number(node.minLength)) && (node.maxLength === undefined || [...value].length <= Number(node.maxLength)) && (node.pattern === undefined || new RegExp(String(node.pattern), "u").test(value));
  if (node.type === "array") return Array.isArray(value) && (node.minItems === undefined || value.length >= Number(node.minItems)) && (node.maxItems === undefined || value.length <= Number(node.maxItems)) && value.every(item => predicate(node.items!, item, root));
  if (node.type === "object") return !!value && typeof value === "object" && !Array.isArray(value) && node.required!.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => Object.hasOwn(node.properties!, key)) && Object.entries(value).every(([key, child]) => predicate(node.properties![key], child, root));
  return true;
}
class WireShapeFailure extends Error {
  constructor(readonly path: PropertyKey[], readonly expected: string, readonly extraKeyCount?: number,
    readonly cardinality?: { actualCount: number; minItems?: number; maxItems?: number },
    readonly control?: ReturnType<typeof projectControlEnum>) { super("WIRE_SHAPE_INVALID"); }
}
function requireWireKeys(object: Record<string, unknown>, required: string[], allowed: string[], path: PropertyKey[]) {
  for (const key of required) if (!Object.hasOwn(object, key)) throw new WireShapeFailure([...path, key], "REQUIRED_PROPERTY");
  const extra = Object.keys(object).filter(key => !allowed.includes(key)).length;
  if (extra) throw new WireShapeFailure(path, "object", extra);
}
function codec(raw: Schema, value: unknown, direction: "encode" | "decode", path: PropertyKey[] = [], root: Schema = original, canonicalEvidenceJson = false): unknown {
  const node = deref(raw, root), plan = taggedPlan(node, root);
  const requireShape = (condition: unknown, expected = node.type ?? "UNION") => { if (!condition) throw new WireShapeFailure(path, expected); };
  if (plan) {
    requireShape(value && typeof value === "object" && !Array.isArray(value));
    const object = value as Record<string, unknown>, matches = plan.tags.flatMap((tag, index) => Object.entries(tag).every(([key, values]) => values.some(option => equal(object[key], option))) ? [index] : []);
    if (matches.length !== 1) {
      // Compare only trusted schema discriminants. A matching field must not
      // be blamed when a later operation tag is the sole failed discriminator.
      // Prefer a uniquely selected branch when its primary discriminator is
      // valid. Otherwise an equally close unrelated branch can blame a valid
      // kind instead of the invalid reason in the actual directive branch.
      // This affects diagnostics only: matches.length remains invalid above.
      const selectorKeys = Object.keys(plan.tags[0]).filter(key => plan.tags.every((tag, i) => tag[key]
        && plan.tags.every((other, j) => i === j || other[key] && !tag[key].some(value => other[key].some(candidate => equal(value, candidate))))));
      const selectedTags = plan.tags.filter(tag => selectorKeys.some(key => tag[key].some(value => equal(object[key], value))));
      const closest = (selectedTags.length ? selectedTags : plan.tags).map(tag => Object.entries(tag).filter(([key, values]) => !values.some(option => equal(object[key], option))).map(([key]) => key))
        .sort((a, b) => a.length - b.length)[0];
      const key = closest[0] ?? Object.keys(plan.tags[0])[0];
      throw new WireShapeFailure([...path, key], "CONTROL_ENUM", undefined, undefined,
        projectControlEnum(plan.tags.flatMap(tag => tag[key] ?? []), object[key]));
    }
    const branch = plan.branches[matches[0]];
    if (direction === "decode") {
      requireWireKeys(object, canonicalEvidenceJson ? branch.required! : plan.keys, plan.keys, path);
      // Encoded evidence uses canonical refs: only selected active keys are
      // required. Optional known legacy padding is never authority. All other
      // provider objects still require their declared transport keys.
      // Known inactive keys are transport padding. Check their presence, but
      // never read or traverse their values; only the selected branch supplies
      // canonical fields. Its active values still pass codec and validation.
    } else requireShape(predicate(branch, value, root));
    const result = Object.fromEntries(Object.entries(branch.properties!).map(([key, child]) => [key, codec(child, object[key], direction, [...path, key], root)]));
    if (direction === "encode") { for (const key of plan.keys) if (!Object.hasOwn(result, key)) result[key] = null; }
    else requireShape(predicate(branch, result, root));
    return result;
  }
  if (node.anyOf || node.oneOf) {
    const results: unknown[] = [], failures: WireShapeFailure[] = [];
    for (const branch of node.anyOf ?? node.oneOf!) try { const result = codec(branch, value, direction, path, root); if (predicate(branch, direction === "encode" ? value : result, root)) results.push(result); } catch (error) { if (error instanceof WireShapeFailure) failures.push(error); }
    if (results.length === 0 && failures.length) throw failures.sort((a, b) => b.path.length - a.path.length)[0];
    requireShape(results.length > 0 && (!!node.anyOf || results.length === 1) && results.every(result => equal(result, results[0]))); return results[0];
  }
  if (node.type === "array") {
    // Active V3 semantic evidence uses the same bounded wire representation.
    // Canonical arrays and JSON-encoded uncertainty alternatives stay strict.
    if (root === originalV3 && path.at(-1) === "evidence") {
      const keys = ["primaryEvidence", "additionalEvidenceJson"];
      if (direction === "encode") {
        requireShape(Array.isArray(value) && predicate(node, value, root));
        const refs = value as unknown[];
        return { primaryEvidence: JSON.stringify(refs[0]),
          additionalEvidenceJson: JSON.stringify(refs.slice(1)) };
      }
      // Preserve sanitized diagnostics for the old observed invalid array;
      // no legacy array (including a valid-sized one) is accepted as V3 slots.
      if (Array.isArray(value) && (value.length < 1 || value.length > 3)) {
        throw new WireShapeFailure(path, "array", undefined, { actualCount: value.length, minItems: 1, maxItems: 3 });
      }
      requireShape(value && typeof value === "object" && !Array.isArray(value), "object");
      const object = value as Record<string, unknown>;
      requireWireKeys(object, keys, keys, path);
      // Avoid nested provider evidence unions while preserving the exact
      // canonical reference language. This is parsing, never repair/coercion.
      const primaryPath=[...path,keys[0]];
      if(typeof object.primaryEvidence!=="string"||new TextEncoder().encode(object.primaryEvidence).length>32768)throw new WireShapeFailure(primaryPath,"BOUNDED_JSON_OBJECT");
      let primary:unknown;
      try{primary=JSON.parse(object.primaryEvidence)}catch{throw new WireShapeFailure(primaryPath,"JSON_OBJECT")}
      const refs = [codec(node.items!, primary, direction, primaryPath, root, true)];
      const extraPath = [...path, keys[1]];
      if (typeof object.additionalEvidenceJson !== "string" || new TextEncoder().encode(object.additionalEvidenceJson).length > 32768) throw new WireShapeFailure(extraPath, "BOUNDED_JSON_ARRAY");
      let extras: unknown;
      try { extras = JSON.parse(object.additionalEvidenceJson); } catch { throw new WireShapeFailure(extraPath, "JSON_ARRAY"); }
      if (!Array.isArray(extras)) throw new WireShapeFailure(extraPath, "array");
      if (extras.length > 2) throw new WireShapeFailure(extraPath, "array", undefined, { actualCount: extras.length, minItems: 0, maxItems: 2 });
      for (const [index, extra] of extras.entries()) refs.push(codec(node.items!, extra, direction, [...extraPath, index], root, true));
      return refs;
    }
    requireShape(Array.isArray(value));
    const items = value as unknown[];
    if ((node.minItems !== undefined && items.length < Number(node.minItems)) || (node.maxItems !== undefined && items.length > Number(node.maxItems))) {
      throw new WireShapeFailure(path, "array", undefined, { actualCount: items.length,
        ...(node.minItems !== undefined ? { minItems: Number(node.minItems) } : {}),
        ...(node.maxItems !== undefined ? { maxItems: Number(node.maxItems) } : {}) });
    }
    return items.map((item, index) => codec(node.items!, item, direction, [...path, index], root));
  }
  if (node.type === "object") {
    requireShape(value && typeof value === "object" && !Array.isArray(value));
    requireWireKeys(value as Record<string, unknown>, node.required!, node.required!, path);
    return Object.fromEntries(Object.entries(node.properties!).map(([key, child]) => [key, codec(child, (value as Record<string, unknown>)[key], direction, [...path, key], root)]));
  }
  if (!predicate(node, value, root)) {
    const domain = node.enum ?? (Object.hasOwn(node, "const") ? [node.const] : undefined);
    if (domain && !domain.some(option => equal(value, option))) throw new WireShapeFailure(path, "CONTROL_ENUM", undefined, undefined, projectControlEnum(domain, value));
    requireShape(false);
  }
  return structuredClone(value);
}
export function legacyV2EncodeGoogleLiteEuContext(canonical: unknown): unknown {
  requireShape(ConversationInterpretationSchema.safeParse(canonical).success);
  const encoded = codec(original, canonical, "encode") as Record<string, unknown>;
  delete encoded.schemaVersion;
  encoded.uncertainties = (canonical as ConversationInterpretation).uncertainties.map(item => ({ fieldCode: UNCERTAINTY_FIELD_WIRE_CODE_V1[item.field], reason: item.reason, alternatives: item.alternatives.map(alternative => JSON.stringify(alternative)) }));
  return encoded;
}
function decodeUncertainties(raw: unknown, successor = false): unknown {
  if (!Array.isArray(raw) || raw.length > 4) throw new WireShapeFailure(["uncertainties"], "ARRAY_MAX_4");
  return raw.map((item, index) => {
    const path = ["uncertainties", index];
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new WireShapeFailure(path, "object");
    requireWireKeys(item, ["fieldCode", "reason", "alternatives"], ["fieldCode", "reason", "alternatives"], path);
    if (typeof item.reason !== "string" || !Array.isArray(item.alternatives) || item.alternatives.length > 2) throw new WireShapeFailure(path, "UNCERTAINTY_SHAPE");
    const allowedCodes = [...uncertaintyFieldByCode].filter(([, field]) => (successor ? UncertaintyV3Schema : UncertaintySchema).options.some(branch => branch.shape.field.safeParse(field).success)).map(([code]) => code);
    if (typeof item.fieldCode !== "number" || !Number.isSafeInteger(item.fieldCode) || !uncertaintyFieldByCode.has(item.fieldCode)) throw new WireShapeFailure([...path, "fieldCode"], "CONTROL_ENUM", undefined, undefined, projectControlEnum(allowedCodes, item.fieldCode));
    const field = uncertaintyFieldByCode.get(item.fieldCode)!;
    if (!(successor ? UncertaintyV3Schema : UncertaintySchema).options.some(branch => branch.shape.field.safeParse(field).success)) throw new WireShapeFailure([...path, "fieldCode"], "CONTROL_ENUM", undefined, undefined, projectControlEnum(allowedCodes, item.fieldCode));
    return { field, reason: item.reason, alternatives: item.alternatives.map((text: unknown, alternative: number) => {
      if (typeof text !== "string" || text.length > 32768) throw new WireShapeFailure([...path, "alternatives", alternative], "BOUNDED_JSON_STRING");
      try { return JSON.parse(text) as unknown; } catch { throw new WireShapeFailure([...path, "alternatives", alternative], "JSON_ALTERNATIVE"); }
    }) };
  });
}
/** Core is atomic; guidance is decoded independently and remains quarantinable. */
export function legacyV2ParseGoogleLiteEuContextSections(raw: unknown, observeInvalid?: Parameters<typeof parseInterpretationSections>[1], observeWireInvalid?: Parameters<typeof parseInterpretationSections>[1], wireVersion: string = GOOGLE_LITE_EU_CONTEXT_WIRE_VERSION): InterpretationSections {
  if (wireVersion !== GOOGLE_LITE_EU_CONTEXT_WIRE_VERSION) return { status: "REFUSED", reason: "ENVELOPE_INVALID" };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) { observeWireInvalid?.(projectWireValidation(raw, [], "object")); return { status: "REFUSED", reason: "ENVELOPE_INVALID" }; }
  const object = raw as Record<string, unknown>, guidance = new Set(["conversationDirective", "replyProposal"]), coreKeys = providerRoot.required!.filter(key => !guidance.has(key));
  try {
    requireWireKeys(object, coreKeys, Object.keys(providerRoot.properties!), []);
    const decoded = Object.fromEntries(coreKeys.map(key => [key, key === "uncertainties" ? decodeUncertainties(object[key]) : codec(original.properties![key], object[key], "decode", [key])]));
    decoded.schemaVersion = applicationSchemaVersion;
    try { decoded.conversationDirective = codec(original.properties!.conversationDirective, object.conversationDirective, "decode", ["conversationDirective"]); }
    catch (error) { if (error instanceof WireShapeFailure) observeWireInvalid?.(projectWireValidation(raw, error.path, error.expected, error.extraKeyCount, "calenote-context-2", error.cardinality, error.control)); decoded.conversationDirective = { kind: "INVALID_PROVIDER_WIRE" }; }
    // Reply has no flattened tagged union. Retaining an invalid original reply
    // preserves the canonical parser's REPLY_TOO_LONG vs REPLY_INVALID reason.
    try { decoded.replyProposal = codec(original.properties!.replyProposal, object.replyProposal, "decode", ["replyProposal"]); }
    catch (error) { if (error instanceof WireShapeFailure) observeWireInvalid?.(projectWireValidation(raw, error.path, error.expected, error.extraKeyCount, "calenote-context-2", error.cardinality, error.control)); decoded.replyProposal = object.replyProposal; }
    return parseInterpretationSections(decoded, observeInvalid);
  } catch (error) { observeWireInvalid?.(error instanceof WireShapeFailure ? projectWireValidation(raw, error.path, error.expected, error.extraKeyCount, "calenote-context-2", error.cardinality, error.control) : projectCanonicalValidation(raw, [])); return { status: "REFUSED", reason: "SEMANTIC_PATCH_INVALID" }; }
}

function omitOwnedV3(node: Schema): Schema {
  const result = mapSchemas(node, omitOwnedV3);
  if (result.properties) for (const key of ["schemaVersion", "statusScope"]) {
    delete result.properties[key];
    result.required = result.required?.filter(name => name !== key);
  }
  return result;
}
const originalV3 = omitOwnedV3(googleLiteEuProviderWireSchema(InterpretationJsonSchemaV3).schema as Schema);
function semanticEvidenceSlots(root: Schema): Schema {
  const visit = (node: Schema): Schema => {
    const result = mapSchemas(node, visit);
    if (node.properties?.evidence) {
      const evidence = deref(node.properties.evidence, root);
      requireShape(evidence.type === "array" && evidence.items);
      result.properties!.evidence = { type: "object", properties: {
        primaryEvidence: { type: "string" },
        additionalEvidenceJson: { type: "string" },
      }, required: ["primaryEvidence", "additionalEvidenceJson"], additionalProperties: false };
    }
    return result;
  };
  return visit(root);
}
function encodedDateSchemas(node: Schema, root: Schema): Schema {
  const plan=taggedPlan(node,root);
  if(plan && plan.tags.length===3 && plan.tags.every(tag=>tag.kind?.length===1 && ["CIVIL_DATE","RELATIVE_DAY","WEEKDAY"].includes(String(tag.kind[0]))))return {type:"string"};
  return mapSchemas(node,child=>encodedDateSchemas(child,root));
}
const evidenceSlottedV3 = semanticEvidenceSlots(originalV3);
const slottedV3 = encodedDateSchemas(evidenceSlottedV3,evidenceSlottedV3);
// Only known date operand positions are transformed. Business strings and
// JSON-encoded canonical uncertainty alternatives are never traversed.
function dateJsonOperands(object: Record<string, unknown>, mode: "encode" | "decode"): Record<string, unknown> {
  const date = (value: unknown, path: (string | number)[]): unknown => {
    if(value===null)return null;
    let candidate:unknown;
    if(mode==="decode"){
      if(typeof value!=="string" || new TextEncoder().encode(value).byteLength>32768)throw new WireShapeFailure(path,"DATE_OPERAND_JSON");
      try{candidate=JSON.parse(value);}catch{throw new WireShapeFailure(path,"DATE_OPERAND_JSON");}
    }else{
      if(!value || typeof value!=="object" || Array.isArray(value))throw new WireShapeFailure(path,"DATE_OPERAND_JSON");
      const item=value as Record<string,unknown>;
      const keys=item.kind==="CIVIL_DATE"?["kind","calendar","day","month","year","leapMonth"]:item.kind==="RELATIVE_DAY"?["kind","offsetDays"]:["kind","weekday","qualifier"];
      candidate=Object.fromEntries(keys.map(key=>[key,item[key]]));
    }
    const parsed=DateOperandSchema.safeParse(candidate);
    if(!parsed.success)throw new WireShapeFailure([...path,...parsed.error.issues[0].path],"DATE_OPERAND_JSON");
    if(mode==="encode")return JSON.stringify(parsed.data);
    return {...Object.fromEntries(["calendar","day","month","year","leapMonth","offsetDays","weekday","qualifier"].map(key=>[key,null])),...parsed.data};
  };
  const result={...object};
  if(Array.isArray(object.changes))result.changes=object.changes.map((raw,index)=>{
    if(!raw || typeof raw!=="object" || Array.isArray(raw))return raw;
    const change=raw as Record<string,unknown>;
    return ["eventDate","reminderDate","endDate"].includes(String(change.field)) && ["SET","REPLACE"].includes(String(change.operation))?{...change,value:date(change.value,["changes",index,"value"])}:raw;
  });
  if(object.query && typeof object.query==="object" && !Array.isArray(object.query)){
    const query=object.query as Record<string,unknown>;
    const mapped={...query};
    if(query.kind==="CALENDAR_DATE" && Object.hasOwn(query,"date"))mapped.date=date(query.date,["query","date"]);
    if(query.kind==="LIST" && query.period && typeof query.period==="object" && !Array.isArray(query.period)){
      const period={...query.period as Record<string,unknown>};
      const known=["DAY","DATE_BOUNDS","WEEK","WEEKEND","MONTH","REST_OF_MONTH","NEXT_7_DAYS","UPCOMING"];
      const active=period.kind==="DAY"?["date"]:period.kind==="DATE_BOUNDS"?["from","through"]:known.includes(String(period.kind))?[]:["date","from","through"];
      for(const key of active)if(Object.hasOwn(period,key))period[key]=date(period[key],["query","period",key]);
      mapped.period=period;
    }
    result.query=mapped;
  }
  return result;
}
function outgoingSemanticKindEnums(node: Schema): Schema {
  const result=mapSchemas(node,outgoingSemanticKindEnums);
  if(typeof result.const==="string" && ["LIST","CALENDAR_DATE","CAPABILITY"].includes(result.const)){
    requireShape(!result.enum || result.enum.includes(result.const));
    result.enum=[result.const];delete result.const;
  }
  return result;
}
// A single untrusted selection losslessly carries the canonical ownership
// tuple. Its immutable application mapping does not confer execution authority.
const operationTuples = Object.freeze([
 ["CREATE_REMINDER","CURRENT",null],["CREATE_REMINDER","NEW",null],["CREATE_REMINDER","UNRESOLVED",null],
 ["LIST_REMINDERS",null,"LIST"],["CALENDAR_QUERY",null,"CALENDAR_DATE"],["CAPABILITY_QUERY",null,"CAPABILITY"],
 ["HELP",null,null],["UNSUPPORTED",null,null],["AMBIGUOUS",null,null],
 ["AMBIGUOUS","CURRENT",null],["AMBIGUOUS","NEW",null],["AMBIGUOUS","UNRESOLVED",null],
].map(tuple=>Object.freeze(tuple)));
function operationSchema(root:Schema):Schema{
 const result=structuredClone(root);
 delete result.properties!.intent;
 result.properties={operationCode:{type:"integer",enum:operationTuples.map((_,index)=>index)},...result.properties!};
 result.required=result.required!.filter(key=>key!=="intent");result.required.unshift("operationCode");
 const strip=(node:Schema):void=>{
  if(node.$ref){strip(at(result,node.$ref));return;}
  if(node.properties?.kind){delete node.properties.kind;node.required=node.required?.filter(key=>key!=="kind");}
  for(const branch of node.anyOf??[])strip(branch);
 };
 strip(result.properties!.requestTarget);strip(result.properties!.query);
 return prune(result);
}
const providerSchemaV3 = operationSchema(outgoingSemanticKindEnums(simplifyUncertainties(prune(coalesceBranches(internDefinitions(normalizeScalars(omitAnnotations(prune(flatten(slottedV3, slottedV3))))))))));
function operationValues(raw:Record<string,unknown>,mode:"encode"|"decode"):Record<string,unknown>{
 const result={...raw};
 if(mode==="encode"){
  const target=raw.requestTarget as Record<string,unknown>|null,query=raw.query as Record<string,unknown>|null;
  const code=operationTuples.findIndex(([intent,targetKind,queryKind])=>intent===raw.intent&&targetKind===(target?.kind??null)&&queryKind===(query?.kind??null));
  if(code<0)throw new WireShapeFailure(["operationCode"],"CONTROL_ENUM");
  result.operationCode=code;delete result.intent;
  for(const key of ["requestTarget","query"]){const carrier=result[key];if(carrier){const copy={...(carrier as Record<string,unknown>)};delete copy.kind;result[key]=copy;}}
 }else{
  requireWireKeys(raw,providerSchemaV3.required!.filter(key=>key!=="conversationDirective"&&key!=="replyProposal"),Object.keys(providerSchemaV3.properties!),[]);
  const code=raw.operationCode;
  if(typeof code!=="number"||!Number.isInteger(code)||code<0||code>=operationTuples.length)throw new WireShapeFailure(["operationCode"],"CONTROL_ENUM",undefined,undefined,projectControlEnum(operationTuples.map((_,i)=>i),code));
  const [intent,targetKind,queryKind]=operationTuples[code];result.intent=intent;delete result.operationCode;
  for(const [key,kind,keys] of [["requestTarget",targetKind,["evidence"]],["query",queryKind,["period","evidence","date","outputCalendar","topic"]]] as const){
   const carrier=raw[key];
   if(kind===null){if(carrier!==null)throw new WireShapeFailure([key],"null");}
   else{
    if(!carrier||typeof carrier!=="object"||Array.isArray(carrier))throw new WireShapeFailure([key],"object");
    requireWireKeys(carrier as Record<string,unknown>,[...keys],[...keys],[key]);
    result[key]={...(carrier as Record<string,unknown>),kind};
   }
  }
 }
 return result;
}
export function googleLiteEuContextWireSchemaV3(): ProviderWireSchemaV3 {
  return { version: CONTEXT_PROTOCOL_V3.wireVersion, schema: structuredClone(providerSchemaV3) as typeof InterpretationJsonSchemaV3 };
}
export function encodeGoogleLiteEuContextV3(canonical: ConversationInterpretationV3): unknown {
  const parsed = ConversationInterpretationV3Schema.parse(canonical);
  const generated: Record<string, unknown> = Object.fromEntries(Object.entries(parsed).filter(([key]) => key !== "schemaVersion"));
  // The generated view omits owned constants without mutating canonical data.
  if (parsed.query?.kind === "LIST") generated.query = Object.fromEntries(Object.entries(parsed.query).filter(([key]) => key !== "statusScope"));
  const output = codec(originalV3, generated, "encode", [], originalV3) as Record<string, unknown>;
  output.uncertainties = parsed.uncertainties.map(item => ({ fieldCode: UNCERTAINTY_FIELD_WIRE_CODE_V1[item.field], reason: item.reason, alternatives: item.alternatives.map(alternative => JSON.stringify(alternative)) }));
  return operationValues(dateJsonOperands(output,"encode"),"encode");
}
export function parseGoogleLiteEuContextSectionsV3(raw: unknown, selected: ContextProtocolV3, observeInvalid?: Parameters<typeof parseInterpretationSectionsV3>[1], observeWireInvalid?: Parameters<typeof parseInterpretationSectionsV3>[1], observeDecoded?: (value: unknown) => void): InterpretationSectionsV3 {
  return decodeContextSectionsV3(raw, selected, false, observeInvalid, observeWireInvalid, observeDecoded) as InterpretationSectionsV3;
}
export function decodeGoogleLiteEuContextTransportV3(raw:unknown,selected:ContextProtocolV3,observeInvalid?:Parameters<typeof parseInterpretationSectionsV3>[1],observeWireInvalid?:Parameters<typeof parseInterpretationSectionsV3>[1]) {
  return decodeContextSectionsV3(raw,selected,true,observeInvalid,observeWireInvalid);
}
function decodeContextSectionsV3(raw: unknown, selected: ContextProtocolV3, staged:boolean, observeInvalid?: Parameters<typeof parseInterpretationSectionsV3>[1], observeWireInvalid?: Parameters<typeof parseInterpretationSectionsV3>[1], observeDecoded?: (value: unknown) => void): {status:"PARSED";value:ContextGatewayInterpretation}|{status:"REFUSED";reason:"ENVELOPE_INVALID"|"SEMANTIC_PATCH_INVALID"} {
  if (!isContextProtocolV3(selected)) return { status: "REFUSED", reason: "ENVELOPE_INVALID" };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    observeWireInvalid?.(projectWireValidation(raw, [], "object", undefined, "calenote-context-3"));
    return { status: "REFUSED", reason: "ENVELOPE_INVALID" };
  }
  const guidance = new Set(["conversationDirective", "replyProposal"]);
  const coreKeys = originalV3.required!.filter(key => !guidance.has(key));
  try {
    const object = dateJsonOperands(operationValues(raw as Record<string,unknown>,"decode"),"decode");
    requireWireKeys(object, coreKeys, Object.keys(originalV3.properties!), []);
    let period:ListPeriodProposal|undefined;
    let queryWire=object.query;
    if(staged && queryWire && typeof queryWire==="object" && !Array.isArray(queryWire) && "kind" in queryWire && queryWire.kind==="LIST") {
      const query=queryWire as Record<string,unknown>, proposal=query.period;
      if(proposal===null)period={status:"ABSENT"};
      else if(proposal && typeof proposal==="object" && !Array.isArray(proposal)) {
        const p=proposal as Record<string,unknown>;
        const known=["DAY","DATE_BOUNDS","WEEK","WEEKEND","MONTH","REST_OF_MONTH","NEXT_7_DAYS","UPCOMING"];
        if(!known.includes(String(p.kind))) {
          requireWireKeys(p,["kind","date","offset","from","through"],["kind","date","offset","from","through"],["query","period"]);
          if(typeof p.kind!=="string" || !/^[A-Za-z0-9_:.-]{1,48}$/u.test(p.kind))throw new WireShapeFailure(["query","period","kind"],"CONTROL_ENUM");
          if(p.offset!==null && (typeof p.offset!=="number" || !Number.isFinite(p.offset)))throw new WireShapeFailure(["query","period","offset"],"number");
          // Validate unknown operands structurally through the existing date codec;
          // the temporary known branch is never a semantic proposal.
          for(const key of ["date","from","through"]) {
            codec(originalV3.properties!.query,{...query,period:{...p,kind:"DAY",date:p[key]}},"decode",["query"],originalV3);
          }
          period={status:"UNSUPPORTED",diagnostic:projectWireValidation(raw,["query","period","kind"],"CONTROL_ENUM",undefined,"calenote-context-3",undefined,projectControlEnum(known,p.kind))};
          // Unsupported tokens are not approved finite literals. Keep the
          // existing structural projection, but never retain its raw token.
          for(const issue of period.diagnostic.issues)delete issue.actualSafeToken;
          queryWire={...query,period:null};
        }
      }
    }
    const decoded = Object.fromEntries(coreKeys.map(key => [key, key === "uncertainties" ? decodeUncertainties(object[key], true) : codec(originalV3.properties![key], key==="query"?queryWire:object[key], "decode", [key], originalV3)]));
    decoded.schemaVersion = selected.canonicalVersion;
    if (decoded.query && typeof decoded.query === "object" && "kind" in decoded.query && decoded.query.kind === "LIST") decoded.query = { ...decoded.query, statusScope: "DEFAULT" };
    for (const key of guidance) {
      try { decoded[key] = codec(originalV3.properties![key], object[key], "decode", [key], originalV3); }
      catch (error) {
        if (error instanceof WireShapeFailure) observeWireInvalid?.(projectWireValidation(raw, error.path, error.expected, error.extraKeyCount, "calenote-context-3", error.cardinality, error.control));
        decoded[key] = key === "conversationDirective" ? { kind: "INVALID_PROVIDER_WIRE" } : object[key];
      }
    }
    // Diagnostic observers receive a detached copy and cannot alter acceptance.
    // Runtime callers omit this hook; canonical predicates remain authoritative.
    if (observeDecoded) try { observeDecoded(structuredClone(decoded)); } catch { /* Observation is non-authoritative. */ }
    if(staged && decoded.query && typeof decoded.query==="object" && "kind" in decoded.query && decoded.query.kind==="LIST") {
      // Root ownership is outside this amendment. Preserve its canonical
      // rejection diagnostics instead of staging an unrelated invalid action.
      if(decoded.intent!=="LIST_REMINDERS" || decoded.requestTarget!==null || !Array.isArray(decoded.changes) || decoded.changes.length!==0)return parseInterpretationSectionsV3(decoded,observeInvalid);
      const {period:canonicalPeriod,...query}=decoded.query as Extract<ConversationInterpretationV3["query"],{kind:"LIST"}>;
      const {conversationDirective,replyProposal,...core}=decoded;
      return {status:"PARSED",value:issueListTransport({core:{...core,query} as DecodedListCore,period:period??{status:"KNOWN",value:canonicalPeriod!},guidance:{conversationDirective,replyProposal}})};
    }
    return parseInterpretationSectionsV3(decoded, observeInvalid);
  } catch (error) {
    observeWireInvalid?.(error instanceof WireShapeFailure ? projectWireValidation(raw, error.path, error.expected, error.extraKeyCount, "calenote-context-3", error.cardinality, error.control) : projectCanonicalValidation(raw, [], "calenote-context-3"));
    return { status: "REFUSED", reason: "SEMANTIC_PATCH_INVALID" };
  }
}

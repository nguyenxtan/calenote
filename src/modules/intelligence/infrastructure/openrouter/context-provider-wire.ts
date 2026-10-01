import { ConversationInterpretationSchema, InterpretationJsonSchema, parseInterpretationSections, type InterpretationSections, type ConversationInterpretation } from "../../../conversation/context-contract/contracts";
import { projectCanonicalValidation, projectWireValidation } from "../../../conversation/context-contract/validation-diagnostics";
import { googleLiteEuProviderWireSchema } from "./provider-wire-schema";

export const GOOGLE_LITE_EU_CONTEXT_WIRE_VERSION = "google-gemini-2.5-flash-lite-vertex-eu-context-uncertainty-json-6" as const;
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
function flatten(node: Schema): Schema {
  const plan = taggedPlan(node, original);
  if (!plan) return mapSchemas(node, flatten);
  // Keep the discriminator, payload and inactive nulls in the SAME branch.
  // Independently unioning properties admits their Cartesian product; likewise
  // moving alternatives across arrays loses the uncertainty field association.
  return { anyOf: plan.branches.map(branch => ({ type: "object",
    properties: Object.fromEntries(plan.keys.map(key => [key, Object.hasOwn(branch.properties!, key) ? flatten(branch.properties![key]) : { type: "null" }])),
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
    field: { type: "string" }, reason: structuredClone(reason), alternatives: { type: "array", items: {
      type: "string", description: "JSON encoding of a canonical alternative object with value and evidence; use the value type corresponding to the uncertainty field.",
    } },
  }, required: ["field", "reason", "alternatives"], additionalProperties: false };
  return prune(output);
}
const providerSchema = simplifyUncertainties(prune(coalesceBranches(internDefinitions(normalizeScalars(omitAnnotations(prune(flatten(original))))))));
/** Versioned context representation. Canonical prompt/schema and the namespace-only adapter remain unchanged. */
export function googleLiteEuContextWireSchema() {
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
  constructor(readonly path: PropertyKey[], readonly expected: string, readonly extraKeyCount?: number) { super("WIRE_SHAPE_INVALID"); }
}
function requireWireKeys(object: Record<string, unknown>, required: string[], allowed: string[], path: PropertyKey[]) {
  for (const key of required) if (!Object.hasOwn(object, key)) throw new WireShapeFailure([...path, key], "REQUIRED_PROPERTY");
  const extra = Object.keys(object).filter(key => !allowed.includes(key)).length;
  if (extra) throw new WireShapeFailure(path, "object", extra);
}
function codec(raw: Schema, value: unknown, direction: "encode" | "decode", path: PropertyKey[] = []): unknown {
  const node = deref(raw, original), plan = taggedPlan(node, original);
  const requireShape = (condition: unknown, expected = node.type ?? "UNION") => { if (!condition) throw new WireShapeFailure(path, expected); };
  if (plan) {
    requireShape(value && typeof value === "object" && !Array.isArray(value));
    const object = value as Record<string, unknown>, matches = plan.tags.flatMap((tag, index) => Object.entries(tag).every(([key, values]) => values.some(option => equal(object[key], option))) ? [index] : []);
    if (matches.length !== 1) {
      // Compare only trusted schema discriminants. A matching field must not
      // be blamed when a later operation tag is the sole failed discriminator.
      const closest = plan.tags.map(tag => Object.entries(tag).filter(([key, values]) => !values.some(option => equal(object[key], option))).map(([key]) => key))
        .sort((a, b) => a.length - b.length)[0];
      throw new WireShapeFailure([...path, closest[0] ?? Object.keys(plan.tags[0])[0]], "CONTROL_ENUM");
    }
    const branch = plan.branches[matches[0]];
    if (direction === "decode") {
      requireWireKeys(object, plan.keys, plan.keys, path);
      for (const key of plan.keys) if (!Object.hasOwn(branch.properties!, key) && object[key] !== null) throw new WireShapeFailure([...path, key], "null");
    } else requireShape(predicate(branch, value, original));
    const result = Object.fromEntries(Object.entries(branch.properties!).map(([key, child]) => [key, codec(child, object[key], direction, [...path, key])]));
    if (direction === "encode") { for (const key of plan.keys) if (!Object.hasOwn(result, key)) result[key] = null; }
    else requireShape(predicate(branch, result, original));
    return result;
  }
  if (node.anyOf || node.oneOf) {
    const results: unknown[] = [], failures: WireShapeFailure[] = [];
    for (const branch of node.anyOf ?? node.oneOf!) try { const result = codec(branch, value, direction, path); if (predicate(branch, direction === "encode" ? value : result, original)) results.push(result); } catch (error) { if (error instanceof WireShapeFailure) failures.push(error); }
    if (results.length === 0 && failures.length) throw failures.sort((a, b) => b.path.length - a.path.length)[0];
    requireShape(results.length > 0 && (!!node.anyOf || results.length === 1) && results.every(result => equal(result, results[0]))); return results[0];
  }
  if (node.type === "array") { requireShape(Array.isArray(value) && (node.minItems === undefined || value.length >= Number(node.minItems)) && (node.maxItems === undefined || value.length <= Number(node.maxItems))); return (value as unknown[]).map((item, index) => codec(node.items!, item, direction, [...path, index])); }
  if (node.type === "object") {
    requireShape(value && typeof value === "object" && !Array.isArray(value));
    requireWireKeys(value as Record<string, unknown>, node.required!, node.required!, path);
    return Object.fromEntries(Object.entries(node.properties!).map(([key, child]) => [key, codec(child, (value as Record<string, unknown>)[key], direction, [...path, key])]));
  }
  requireShape(predicate(node, value, original)); return structuredClone(value);
}
export function encodeGoogleLiteEuContext(canonical: unknown): unknown {
  requireShape(ConversationInterpretationSchema.safeParse(canonical).success);
  const encoded = codec(original, canonical, "encode") as Record<string, unknown>;
  encoded.uncertainties = (canonical as ConversationInterpretation).uncertainties.map(item => ({ field: item.field, reason: item.reason, alternatives: item.alternatives.map(alternative => JSON.stringify(alternative)) }));
  return encoded;
}
function decodeUncertainties(raw: unknown): unknown {
  if (!Array.isArray(raw) || raw.length > 4) throw new WireShapeFailure(["uncertainties"], "ARRAY_MAX_4");
  return raw.map((item, index) => {
    const path = ["uncertainties", index];
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new WireShapeFailure(path, "object");
    requireWireKeys(item, ["field", "reason", "alternatives"], ["field", "reason", "alternatives"], path);
    if (typeof item.field !== "string" || typeof item.reason !== "string" || !Array.isArray(item.alternatives) || item.alternatives.length > 2) throw new WireShapeFailure(path, "UNCERTAINTY_SHAPE");
    return { field: item.field, reason: item.reason, alternatives: item.alternatives.map((text: unknown, alternative: number) => {
      if (typeof text !== "string" || text.length > 32768) throw new WireShapeFailure([...path, "alternatives", alternative], "BOUNDED_JSON_STRING");
      try { return JSON.parse(text) as unknown; } catch { throw new WireShapeFailure([...path, "alternatives", alternative], "JSON_ALTERNATIVE"); }
    }) };
  });
}
/** Core is atomic; guidance is decoded independently and remains quarantinable. */
export function parseGoogleLiteEuContextSections(raw: unknown, observeInvalid?: Parameters<typeof parseInterpretationSections>[1], observeWireInvalid?: Parameters<typeof parseInterpretationSections>[1]): InterpretationSections {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) { observeWireInvalid?.(projectWireValidation(raw, [], "object")); return { status: "REFUSED", reason: "ENVELOPE_INVALID" }; }
  const object = raw as Record<string, unknown>, guidance = new Set(["conversationDirective", "replyProposal"]), coreKeys = original.required!.filter(key => !guidance.has(key));
  try {
    requireWireKeys(object, coreKeys, Object.keys(original.properties!), []);
    const decoded = Object.fromEntries(coreKeys.map(key => [key, key === "uncertainties" ? decodeUncertainties(object[key]) : codec(original.properties![key], object[key], "decode", [key])]));
    try { decoded.conversationDirective = codec(original.properties!.conversationDirective, object.conversationDirective, "decode", ["conversationDirective"]); }
    catch (error) { if (error instanceof WireShapeFailure) observeWireInvalid?.(projectWireValidation(raw, error.path, error.expected, error.extraKeyCount)); decoded.conversationDirective = { kind: "INVALID_PROVIDER_WIRE" }; }
    // Reply has no flattened tagged union. Retaining an invalid original reply
    // preserves the canonical parser's REPLY_TOO_LONG vs REPLY_INVALID reason.
    try { decoded.replyProposal = codec(original.properties!.replyProposal, object.replyProposal, "decode", ["replyProposal"]); }
    catch (error) { if (error instanceof WireShapeFailure) observeWireInvalid?.(projectWireValidation(raw, error.path, error.expected, error.extraKeyCount)); decoded.replyProposal = object.replyProposal; }
    return parseInterpretationSections(decoded, observeInvalid);
  } catch (error) { observeWireInvalid?.(error instanceof WireShapeFailure ? projectWireValidation(raw, error.path, error.expected, error.extraKeyCount) : projectCanonicalValidation(raw, [])); return { status: "REFUSED", reason: "SEMANTIC_PATCH_INVALID" }; }
}

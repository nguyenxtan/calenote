import { LegacyV2ConversationInterpretationSchema as ConversationInterpretationSchema, LegacyV2InterpretationJsonSchema as InterpretationJsonSchema, LegacyV2UncertaintySchema as UncertaintySchema, LegacyV2parseInterpretationSections as parseInterpretationSections, type LegacyV2InterpretationSections as InterpretationSections, type LegacyV2ConversationInterpretation as ConversationInterpretation } from "../../../conversation/context-contract/contracts";
import { projectCanonicalValidation, projectControlEnum, projectWireValidation, projectDateOperandFailure, projectUncertaintyWireShape, projectCatalogueDiagnostic, type CatalogueDiagnostic, type DateOperandDiagnostic, type CanonicalValidationDiagnostics } from "../../../conversation/context-contract/validation-diagnostics";
import { googleLiteEuProviderWireSchema } from "./provider-wire-schema";
import { ConversationInterpretationV3Schema, DateOperandSchema, InterpretationJsonSchemaV3, UncertaintyV3Schema, parseInterpretationSectionsV3, type ConversationInterpretationV3, type InterpretationSectionsV3 } from "../../../conversation/context-contract/contracts";
import { CONTEXT_PROTOCOL_V3, isContextProtocolV3, type ContextProtocolV3 } from "../../../conversation/context-contract/protocol";
import type { ProviderWireSchemaV3 } from "./provider-wire-schema";
import {issueListTransport, type ContextGatewayInterpretation, type DecodedListCore, type ListPeriodProposal} from "../../../conversation/context-contract/list-period-transport";
import type {ContextInput} from "../../../conversation/context-contract/contracts";
import { isBoundExactReminderClockMissingExcluded, isBoundSourceUniqueReminderClock, isBoundCompleteFiniteSeriesClockAnswer, isInitialExplicitReminderIntentKnown, isBoundSeriesDistanceOffsetMissingExcluded, isInitialFiniteSeriesWithoutRelationSource, isBoundSeriesDistanceRelationMissingExcluded, isWholeSeriesOffsetAlternativeAbsent, isInitialRelationUncertaintyAbsent, isWholeSeriesOffsetUncertaintyAbsent, isInitialReminderDateMissingExcluded, isBoundRelationUncertaintyAbsent } from "../../../conversation/context-contract/field-capability";
import { CHANGE_ORDER_FIELDS_V3, decodeAuthoredChangeRank } from "../../../conversation/context-contract/output-authority";
import {materializeProviderEvidence,EvidencePointerFailure,primaryEvidenceSourceCodebook,expandPrimaryEvidenceSourceCodes} from "./evidence-pointer";
import { NUMERIC_PROPOSAL_FIELDS, CLOCK_PROPOSAL_FIELDS, deriveGenerationFieldCapability, isBoundReminderClockAnswer, isBoundMissingReminderClockWithoutCandidates, isInitialExplicitReminderClockRequired, isInitialExplicitEventClockRequired, isInitialEventDateYearNullRequired, isInitialUniqueCadenceCountRequired, isInitialSupportedCadenceCount, type GenerationFieldCapability, type NumericProposalField, type ClockProposalField } from "../../../conversation/context-contract/field-capability";
import {z} from "zod";

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
function simplifyUncertainties(root: Schema, successor=false): Schema {
  const output = structuredClone(root), items = deref(output.properties!.uncertainties.items!, output);
  requireShape(items.anyOf?.length);
  const reason = items.anyOf[0].properties!.reason;
  requireShape(items.anyOf.every(branch => equal(branch.properties!.reason, reason)));
  output.properties!.uncertainties.items = { type: "object", properties: {
    fieldCode: { type: "integer", minimum: 0, maximum: 15,
      description: "UncertaintyFieldWireCodeV1: " + Object.entries(UNCERTAINTY_FIELD_WIRE_CODE_V1).map(([field, code]) => `${code}=${field}`).join(","),
    }, reason: structuredClone(reason), alternatives: { type: "array", items: {
      type: "string", description: successor?"JSON {value,evidence}; canonical field value, evidence {primaryEvidence:available source code,additionalEvidenceJson:JSON array of 0–2 pointers}.":"JSON encoding of a canonical alternative object with value and evidence; use the value type corresponding to the uncertainty field.",
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
export class WireShapeFailure extends Error {
  constructor(readonly path: PropertyKey[], readonly expected: string, readonly extraKeyCount?: number,
    readonly cardinality?: { actualCount: number; minItems?: number; maxItems?: number },
    readonly control?: ReturnType<typeof projectControlEnum>, readonly dateOperand?:DateOperandDiagnostic,readonly catalogue?:CatalogueDiagnostic,
    readonly projectedIssues?:Pick<CanonicalValidationDiagnostics,"issues"|"truncated">,
    readonly singletonJson?:import("../../../conversation/context-contract/validation-diagnostics").SingletonJsonDiagnostic) { super("WIRE_SHAPE_INVALID"); }
}
function requireWireKeys(object: Record<string, unknown>, required: string[], allowed: string[], path: PropertyKey[]) {
  for (const key of required) if (!Object.hasOwn(object, key)) throw new WireShapeFailure([...path, key], "REQUIRED_PROPERTY");
  const extra = Object.keys(object).filter(key => !allowed.includes(key)).length;
  if (extra) throw new WireShapeFailure(path, "object", extra);
}
function codec(raw: Schema, value: unknown, direction: "encode" | "decode", path: PropertyKey[] = [], root: Schema = original, canonicalEvidenceJson = false, typedTransport = false): unknown {
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
      requireWireKeys(object, canonicalEvidenceJson || typedTransport ? branch.required! : plan.keys, plan.keys, path);
      // Encoded evidence uses canonical refs: only selected active keys are
      // required. Optional known legacy padding is never authority. All other
      // provider objects still require their declared transport keys.
      // Known inactive keys are transport padding. Check their presence, but
      // never read or traverse their values; only the selected branch supplies
      // canonical fields. Its active values still pass codec and validation.
    } else requireShape(predicate(branch, value, root));
    const result = Object.fromEntries(Object.entries(branch.properties!).map(([key, child]) => [key, codec(child, object[key], direction, [...path, key], root, false, typedTransport)]));
    if (direction === "encode") { for (const key of plan.keys) if (!Object.hasOwn(result, key)) result[key] = null; }
    else requireShape(predicate(branch, result, root));
    return result;
  }
  if (node.anyOf || node.oneOf) {
    const results: unknown[] = [], failures: WireShapeFailure[] = [];
    for (const branch of node.anyOf ?? node.oneOf!) try { const result = codec(branch, value, direction, path, root, false, typedTransport); if (predicate(branch, direction === "encode" ? value : result, root)) results.push(result); } catch (error) { if (error instanceof WireShapeFailure) failures.push(error); }
    if (results.length === 0 && failures.length) throw failures.sort((a, b) => b.path.length - a.path.length)[0];
    requireShape(results.length > 0 && (!!node.anyOf || results.length === 1) && results.every(result => equal(result, results[0]))); return results[0];
  }
  if (node.type === "array") {
    // Active V3 semantic evidence uses the same bounded wire representation.
    // Canonical arrays and JSON-encoded uncertainty alternatives stay strict.
    if (!typedTransport && root === originalV3 && path.at(-1) === "evidence") {
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
    return items.map((item, index) => codec(node.items!, item, direction, [...path, index], root, false, typedTransport));
  }
  if (node.type === "object") {
    requireShape(value && typeof value === "object" && !Array.isArray(value));
    requireWireKeys(value as Record<string, unknown>, node.required!, node.required!, path);
    return Object.fromEntries(Object.entries(node.properties!).map(([key, child]) => [key, codec(child, (value as Record<string, unknown>)[key], direction, [...path, key], root, false, typedTransport)]));
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
  if (!Array.isArray(raw) || raw.length > 4) throw new WireShapeFailure(["uncertainties"], "ARRAY_MAX_4",undefined,Array.isArray(raw)?{actualCount:raw.length,maxItems:4}:undefined);
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
      let decoded:unknown;try { decoded=JSON.parse(text); } catch { throw new WireShapeFailure([...path, "alternatives", alternative], "JSON_ALTERNATIVE"); }
      if(!successor)return decoded;
      const alternativePath=[...path,"alternatives",alternative];
      if(!decoded||typeof decoded!=="object"||Array.isArray(decoded))throw new WireShapeFailure(alternativePath,"object");
      const object=decoded as Record<string,unknown>;
      requireWireKeys(object,["value","evidence"],["value","evidence"],alternativePath);
      const branch=deref(deref(originalV3.properties!.uncertainties.items!,originalV3).anyOf![0],originalV3);
      const evidenceNode=deref(branch.properties!.alternatives.items!,originalV3).properties!.evidence;
      return {value:object.value,evidence:codec(evidenceNode,object.evidence,"decode",[...alternativePath,"evidence"],originalV3)};
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
const dateWireKeys=["kind","calendar","day","month","year","leapMonth","offsetDays","weekday","qualifier"] as const;
const canonicalDateKeys={CIVIL_DATE:["kind","calendar","day","month","year","leapMonth"],RELATIVE_DAY:["kind","offsetDays"],WEEKDAY:["kind","weekday","qualifier"]} as const;
function encodedDateSchemas(node: Schema, root: Schema): Schema {
  const plan=taggedPlan(node,root);
  if(plan && plan.tags.length===3 && plan.tags.every(tag=>tag.kind?.length===1 && ["CIVIL_DATE","RELATIVE_DAY","WEEKDAY"].includes(String(tag.kind[0]))))return {type:"string"};
  return mapSchemas(node,child=>encodedDateSchemas(child,root));
}
const evidenceSlottedV3 = semanticEvidenceSlots(originalV3);
const slottedV3 = encodedDateSchemas(evidenceSlottedV3,evidenceSlottedV3);
// Only known date operand positions are transformed. Business strings and
// JSON-encoded canonical uncertainty alternatives are never traversed.
/** Bounded flat representation only, never a semantic/date parser. JSON.parse
 * validates syntax; this scanner rejects duplicate decoded keys before any
 * slot can be discarded, and forbids nested representation containers. */
function parseDateWireJson(value:unknown,path:(string|number)[],field?:DateOperandDiagnostic["field"]):Record<string,unknown>{
  const fail=(stage:DateOperandDiagnostic["stage"],reason:DateOperandDiagnostic["reason"],subject:unknown=value):never=>{throw new WireShapeFailure(path,"DATE_OPERAND_JSON",undefined,undefined,undefined,projectDateOperandFailure(subject,stage,reason,field))};
  if(typeof value!=="string")return fail("WIRE_VALUE","WRONG_WIRE_TYPE");
  if(new TextEncoder().encode(value).length>32768)return fail("WIRE_VALUE","OVERSIZED");
  let parsed:unknown;
  try{parsed=JSON.parse(value)}catch{fail("JSON_PARSE","INVALID_JSON")}
  if(!parsed||typeof parsed!=="object"||Array.isArray(parsed))fail("WIRE_VALUE","INVALID_OPERAND",parsed);
  const token=/\s*(?:"(?:[^"\\\u0000-\u001f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*"|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null|[{}:,])\s*/y;
  let position=0;
  const next=()=>{token.lastIndex=position;const match=token.exec(value);if(!match)return fail("WIRE_VALUE","INVALID_OPERAND",parsed);position=token.lastIndex;return match[0].trim()};
  if(next()!=="{")fail("WIRE_VALUE","INVALID_OPERAND",parsed);
  const keys=new Set<string>();let part=next();
  while(part!=="}"){
    if(!part.startsWith('"'))fail("WIRE_VALUE","INVALID_OPERAND",parsed);
    const key=JSON.parse(part) as string;
    if(keys.has(key))fail("WIRE_VALUE","INVALID_OPERAND",parsed);keys.add(key);
    if(next()!==":")fail("WIRE_VALUE","INVALID_OPERAND",parsed);
    const scalar=next();if(["{","}",":",",","["].includes(scalar))fail("WIRE_VALUE","INVALID_OPERAND",parsed);
    const separator=next();if(separator==="}")break;
    if(separator!==",")fail("WIRE_VALUE","INVALID_OPERAND",parsed);part=next();
  }
  if(position!==value.length)fail("WIRE_VALUE","INVALID_OPERAND",parsed);
  return parsed as Record<string,unknown>;
}
function dateJsonOperands(object: Record<string, unknown>, mode: "encode" | "decode", yearNullEventDate=false): Record<string, unknown> {
  const date = (value: unknown, path: (string | number)[], field?:DateOperandDiagnostic["field"]): unknown => {
    if(value===null)return null;
    let candidate:unknown;
    const typed=yearNullEventDate&&field==="eventDate";
    if(mode==="decode"&&typed){
      const fail=(subject:unknown=value):never=>{throw new WireShapeFailure(path,"DATE_OPERAND_JSON",undefined,undefined,undefined,projectDateOperandFailure(subject,"WIRE_VALUE","INVALID_OPERAND",field))};
      if(!value||typeof value!=="object"||Array.isArray(value))fail();
      const item=value as Record<string,unknown>,keys=[...canonicalDateKeys.CIVIL_DATE];
      requireWireKeys(item,keys,keys,path);
      for(const key of keys)if(!Object.hasOwn(Object.getOwnPropertyDescriptor(item,key)??{},"value"))fail();
      if(item.kind!=="CIVIL_DATE"||item.year!==null)fail();
      candidate=item;
    }else if(mode==="decode"){
      const item=parseDateWireJson(value,path,field);
      try{
      const code=item.kind;
      if(code!=="CIVIL_DATE"&&code!=="RELATIVE_DAY"&&code!=="WEEKDAY"){
        const control=projectControlEnum(Object.keys(canonicalDateKeys),code);delete control.actualSafeToken;
        throw new WireShapeFailure([...path,"kind"],"CONTROL_ENUM",undefined,undefined,control);
      }
      const keys=[...canonicalDateKeys[code]];
      requireWireKeys(item,keys,keys,path);
      candidate=item;
      }catch(error){
        if(error instanceof WireShapeFailure)throw new WireShapeFailure(error.path,error.expected,error.extraKeyCount,error.cardinality,error.control,projectDateOperandFailure(item,"WIRE_VALUE","INVALID_OPERAND",field));
        throw error;
      }
    }else{
      if(!value || typeof value!=="object" || Array.isArray(value))throw new WireShapeFailure(path,"DATE_OPERAND_JSON");
      const item=value as Record<string,unknown>;
      const keys=item.kind==="CIVIL_DATE"?["kind","calendar","day","month","year","leapMonth"]:item.kind==="RELATIVE_DAY"?["kind","offsetDays"]:["kind","weekday","qualifier"];
      candidate=Object.fromEntries(keys.map(key=>[key,item[key]]));
    }
    const parsed=DateOperandSchema.safeParse(candidate);
    if(!parsed.success){const structure=projectDateOperandFailure(candidate,"CANONICAL_OPERAND","INVALID_OPERAND",field,parsed.error.issues[0].code);
      if(candidate&&typeof candidate==="object"&&!Array.isArray(candidate)&&structure.kind==="UNKNOWN")structure.reason="UNKNOWN_KIND";
      throw new WireShapeFailure([...path,...parsed.error.issues[0].path],"DATE_OPERAND_JSON",undefined,undefined,undefined,structure);}
    if(typed&&(parsed.data.kind!=="CIVIL_DATE"||parsed.data.year!==null))throw new WireShapeFailure(path,"DATE_OPERAND_JSON",undefined,undefined,undefined,projectDateOperandFailure(candidate,"CANONICAL_OPERAND","INVALID_OPERAND",field));
    if(mode==="encode"&&typed)return structuredClone(parsed.data);
    if(mode==="encode"){
      const encoded=JSON.stringify(parsed.data);
      return parsed.data.kind==="RELATIVE_DAY"&&Object.is(parsed.data.offsetDays,-0)?encoded.replace('"offsetDays":0','"offsetDays":-0'):encoded;
    }
    return {...Object.fromEntries(["calendar","day","month","year","leapMonth","offsetDays","weekday","qualifier"].map(key=>[key,null])),...parsed.data};
  };
  const result={...object};
  if(Array.isArray(object.changes))result.changes=object.changes.map((raw,index)=>{
    if(!raw || typeof raw!=="object" || Array.isArray(raw))return raw;
    const change=raw as Record<string,unknown>;
    return ["eventDate","reminderDate","endDate"].includes(String(change.field)) && ["SET","REPLACE"].includes(String(change.operation))?{...change,value:date(change.value,["changes",index,"value"],change.field as DateOperandDiagnostic["field"])}:raw;
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
export const CONTEXT_OPERATION_WIRE_METADATA_V1=operationTuples;
const operationWireCodes=Object.freeze(operationTuples.map((_,index)=>String(index)));
function operationSchema(root:Schema):Schema{
 const result=structuredClone(root);
 delete result.properties!.intent;
 result.properties={operationCode:{type:"string",enum:[...operationWireCodes]},...result.properties!};
 result.required=result.required!.filter(key=>key!=="intent");result.required.unshift("operationCode");
 const strip=(node:Schema):void=>{
  if(node.$ref){strip(at(result,node.$ref));return;}
  if(node.properties?.kind){delete node.properties.kind;node.required=node.required?.filter(key=>key!=="kind");}
  for(const branch of node.anyOf??[])strip(branch);
 };
 strip(result.properties!.requestTarget);strip(result.properties!.query);
 // The operation code already selects the semantic query branch. Keeping
 // three tagless object alternatives makes their all-null forms overlap.
 // Consolidate only the carrier domains; the original branch codec remains
 // authoritative for active operands and the existing inactive-padding policy.
 const query=result.properties!.query;
 const branches=query.anyOf?.[0]?.anyOf;
 if(!branches||branches.length!==3||branches.some(branch=>branch.type!=="object"||!branch.properties||!branch.required))throw Error("OPERATION_QUERY_SCHEMA_SHAPE");
 const properties:Record<string,Schema>={};
 for(const key of branches[0].required!){
  const alternatives=branches.flatMap(branch=>{const value=branch.properties![key];return value.anyOf??[value];});
  const unique=[...new Map(alternatives.map(value=>[JSON.stringify(value),value])).values()];
  properties[key]=unique.length===1?unique[0]:{anyOf:unique};
 }
 result.properties!.query={anyOf:[{type:"object",properties,required:[...branches[0].required!],additionalProperties:false},{type:"null"}]};
 return prune(result);
}
function indexedReminderSchema(root:Schema):Schema {
  const result=structuredClone(root),items=deref(result.properties!.changes.items!,result);
  result.$defs!.r={type:"integer",minimum:0,maximum:CHANGE_ORDER_FIELDS_V3.length-1};
  for(const field of ["title","reminderDate","reminderTime","eventDate","eventTime","eventRelation","frequency","occurrenceCount","endDate","location"] as const){
    const changes:Schema[]=[];
    items.anyOf=items.anyOf!.flatMap(raw=>{
      const branch=deref(raw,result),control=branch.properties!.field,fields=control.enum??[control.const];
      if(!fields.includes(field))return [raw];
      const change=structuredClone(branch);change.properties!.field={type:"string",const:field};changes.push(change);
      const remaining=fields.filter(value=>value!==field);
      if(!remaining.length)return [];
      const ordinary=structuredClone(branch);ordinary.properties!.field={type:"string",enum:remaining};return [ordinary];
    });
    requireShape(changes.length);
    result.properties![field+"Change"]={anyOf:[{type:"object",properties:{rank:{$ref:"#/$defs/r"},change:{anyOf:changes}},required:["rank","change"],additionalProperties:false},{type:"null"}]};
    result.required!.push(field+"Change");
  }
  result.properties!.changes.items={type:"object",properties:{rank:{$ref:"#/$defs/r"},change:items},required:["rank","change"],additionalProperties:false};
  return result;
}
const providerSchemaV3 = indexedReminderSchema(operationSchema(outgoingSemanticKindEnums(simplifyUncertainties(prune(coalesceBranches(internDefinitions(normalizeScalars(omitAnnotations(prune(flatten(slottedV3, slottedV3))))))),true))));

/** Move only explicitly model-authored carrier data; order and ownership are
 * strict transport assertions, never an opportunity to repair a proposal. */
const singletonChangeDefinitions=[{field:"title",root:"titleChange"},{field:"reminderDate",root:"reminderDateChange"},{field:"reminderTime",root:"reminderTimeChange"},{field:"eventDate",root:"eventDateChange"},{field:"eventTime",root:"eventTimeChange"},{field:"eventRelation",root:"eventRelationChange"},{field:"frequency",root:"frequencyChange"},{field:"occurrenceCount",root:"occurrenceCountChange"},{field:"endDate",root:"endDateChange"},{field:"location",root:"locationChange"}] as const;
function indexedChangeCarriers(raw:Record<string,unknown>,mode:"encode"|"decode",required=false,yearNullEventDate=false,typedTransport=false):Record<string,unknown>{
  const definitions=singletonChangeDefinitions;
  const own=(object:object,key:string,path:PropertyKey[])=>{const descriptor=Object.getOwnPropertyDescriptor(object,key);if(!descriptor)throw new WireShapeFailure(path,"REQUIRED_PROPERTY");if(!Object.hasOwn(descriptor,"value"))throw new WireShapeFailure(path,"object");return descriptor.value;};
  const ranks=new Set<number>(),ranked:Array<{rank:number;change:unknown}>=[];
  const wrapper=(value:unknown,path:PropertyKey[])=>{
    if(!value||typeof value!=="object"||Array.isArray(value))throw new WireShapeFailure(path,"object");
    requireWireKeys(value as Record<string,unknown>,["rank","change"],["rank","change"],path);
    const rank=decodeAuthoredChangeRank(own(value,"rank",[...path,"rank"])),change=own(value,"change",[...path,"change"]);
    if(rank===undefined||ranks.has(rank))throw new WireShapeFailure([...path,"rank"],"CHANGE_RANK");
    ranks.add(rank);return {rank,change};
  };
  const sourceChanges=own(raw,"changes",["changes"]);
  if(!Array.isArray(sourceChanges))throw new WireShapeFailure(["changes"],"array");
  const length=own(sourceChanges,"length",["changes"]);if(!Number.isSafeInteger(length)||length<0||length>13)throw new WireShapeFailure(["changes"],"array");
  const ordinaryChanges:unknown[]=[];let prior=-1;
  for(let index=0;index<length;index++){const item=own(sourceChanges,String(index),["changes",index]);if(mode==="encode")ordinaryChanges.push(item);else{const entry=wrapper(item,["changes",index]);if(entry.rank<=prior)throw new WireShapeFailure(["changes",index,"rank"],"CHANGE_RANK");prior=entry.rank;ordinaryChanges.push(entry.change);ranked.push(entry);}}
  if(mode==="decode"){
    if(Object.hasOwn(raw,"changeOrder"))throw new WireShapeFailure(["changeOrder"],"object",1);
    for(const {root} of definitions){const carrier=own(raw,root,[root]);if(carrier!==null){if(!carrier||typeof carrier!=="object"||Array.isArray(carrier))throw new WireShapeFailure([root],"object");own(carrier,"rank",[root,"rank"]);own(carrier,"change",[root,"change"]);}}
  }
  const result:Record<string,unknown>={};for(const key of Object.keys(raw))result[key]=own(raw,key,[key]);
  const emitted=new Map<string,unknown>();
  const fieldOf=(change:unknown,path:(string|number)[]=["changes"]):string=>{
    const field=change&&typeof change==="object"&&!Array.isArray(change)?Object.getOwnPropertyDescriptor(change,"field")?.value:undefined;
    if(typeof field!=="string"||!(CHANGE_ORDER_FIELDS_V3 as readonly string[]).includes(field))throw new WireShapeFailure(path,"CONTROL_ENUM");
    return field;
  };
  ordinaryChanges.forEach((change,index)=>{const path=mode==="decode"?["changes",index,"change"]:["changes",index],field=fieldOf(change,[...path,"field"]);if(mode==="decode"&&change&&typeof change==="object")for(const key of ["field","operation","value","evidence"])own(change,key,[...path,key]);emitted.set(field,change);});
  for(const definition of definitions){
    const authored=ordinaryChanges.flatMap((change,index)=>fieldOf(change)===definition.field?[{change,index}]:[]);
    const duplicate=definition.field==="title"?"UNIQUE_TITLE_OWNER":"UNIQUE_FIELD_OWNER";
    if(mode==="encode"){
      if(authored.length>1)throw new WireShapeFailure([definition.root],duplicate);
      const item=authored[0];
      result[definition.root]=item?{rank:item.index,change:item.change}:null;
      continue;
    }
    if(!Object.hasOwn(raw,definition.root))throw new WireShapeFailure([definition.root],"REQUIRED_PROPERTY");
    const carrier=own(raw,definition.root,[definition.root]);delete result[definition.root];
    if(carrier===null){
      if(definition.field==="title"&&required)throw new WireShapeFailure([definition.root],"object");
      if(authored.length)throw new WireShapeFailure([definition.root],"FIELD_CARRIER_REQUIRED");
      continue;
    }
    if(!carrier||typeof carrier!=="object"||Array.isArray(carrier))throw new WireShapeFailure([definition.root],"object");
    const entry=wrapper(carrier,[definition.root]),{change}=entry;
    let shape=providerSchemaV3.properties![definition.root].anyOf![0].properties!.change;
    if(yearNullEventDate&&definition.field==="eventDate"){
      const value=change&&typeof change==="object"?Object.getOwnPropertyDescriptor(change,"value")?.value:undefined;
      if(value&&typeof value==="object"&&Object.keys(value).some(key=>!Object.hasOwn(Object.getOwnPropertyDescriptor(value,key)??{},"value")))throw new WireShapeFailure([definition.root,"change","value"],"DATE_OPERAND_JSON",undefined,undefined,undefined,projectDateOperandFailure(value,"WIRE_VALUE","INVALID_OPERAND","eventDate"));
      shape={...shape,anyOf:shape.anyOf!.map(raw=>{const branch=structuredClone(deref(raw,providerSchemaV3)),operation=branch.properties!.operation;if((operation.enum??[operation.const]).some(value=>value==="SET"||value==="REPLACE"))branch.properties!.value={type:"object",properties:Object.fromEntries(canonicalDateKeys.CIVIL_DATE.map(key=>[key,{}])),required:[...canonicalDateKeys.CIVIL_DATE]};return branch;})};
    }
    if(change&&typeof change==="object"&&!Array.isArray(change)){
      const item=change as Record<string,unknown>;
      const field=own(item,"field",[definition.root,"change","field"]),operation=own(item,"operation",[definition.root,"change","operation"]);
      for(const key of ["value","evidence"])own(item,key,[definition.root,"change",key]);
      if(field!==definition.field){
        const diagnostic=projectControlEnum([definition.field],field);
        // Carrier field controls are schema-owned finite literals, not arbitrary
        // token-shaped user values. Unknown field strings retain digest only.
        delete diagnostic.actualSafeToken;
        throw new WireShapeFailure([definition.root,"change","field"],"CONTROL_ENUM",undefined,undefined,diagnostic);
      }
      if(definition.field==="title"){
        const allowed=required?["SET"]:["SET","REPLACE","CLEAR"];
        if(typeof operation!=="string"||!allowed.includes(operation))throw new WireShapeFailure([definition.root,"change","operation"],"CONTROL_ENUM",undefined,undefined,projectControlEnum(allowed,operation));
      }
    }
    if(!typedTransport&&!predicate(shape,change,providerSchemaV3))throw new WireShapeFailure([definition.root,"change"],"FIELD_CHANGE",undefined,undefined,undefined,undefined,undefined,singletonPredicateDiagnostics(shape,change,definition.root),{stage:"TYPED_PREDICATE",reason:"INVALID_TYPED_ROOT"});
    if(authored.length)throw new WireShapeFailure([definition.root],duplicate);
    emitted.set(definition.field,change);
    ranked.push(entry);
  }
  if(mode==="encode")result.changes=ordinaryChanges.flatMap((change,rank)=>definitions.some(definition=>definition.field===fieldOf(change))?[]:[{rank,change}]);
  else {const ordinaryFields=ordinaryChanges.map(change=>fieldOf(change));if(new Set(ordinaryFields).size!==ordinaryFields.length)throw new WireShapeFailure(["changes"],"UNIQUE_FIELD_OWNER");result.changes=ranked.sort((left,right)=>left.rank-right.rank).map(entry=>entry.change);}
  return result;
}
function operationValues(raw:Record<string,unknown>,mode:"encode"|"decode"):Record<string,unknown>{
 const result={...raw};
 if(mode==="encode"){
  const target=raw.requestTarget as Record<string,unknown>|null,query=raw.query as Record<string,unknown>|null;
  const code=operationTuples.findIndex(([intent,targetKind,queryKind])=>intent===raw.intent&&targetKind===(target?.kind??null)&&queryKind===(query?.kind??null));
  if(code<0)throw new WireShapeFailure(["operationCode"],"CONTROL_ENUM");
  result.operationCode=operationWireCodes[code];delete result.intent;
  for(const key of ["requestTarget","query"]){const carrier=result[key];if(carrier){const copy={...(carrier as Record<string,unknown>)};delete copy.kind;result[key]=copy;}}
 }else{
  const carriers=["changeOrder","titleChange","reminderDateChange","reminderTimeChange","eventDateChange","eventTimeChange","eventRelationChange","frequencyChange","occurrenceCountChange","endDateChange","locationChange"];
  requireWireKeys(raw,providerSchemaV3.required!.filter(key=>!["conversationDirective","replyProposal",...carriers].includes(key)),Object.keys(providerSchemaV3.properties!).filter(key=>!carriers.includes(key)),[]);
  const code=raw.operationCode;
  const index=typeof code==="string"?operationWireCodes.indexOf(code):-1;
  if(index<0)throw new WireShapeFailure(["operationCode"],"CONTROL_ENUM",undefined,undefined,projectControlEnum(operationWireCodes,code));
  const [intent,targetKind,queryKind]=operationTuples[index];result.intent=intent;delete result.operationCode;
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
function uncertaintyIntegerDomains(node:Schema,root:Schema):Schema {
 if(node.$ref){const target=at(root,node.$ref);Object.assign(target,uncertaintyIntegerDomains(target,root));return node;}
 const result=mapSchemas(node,child=>uncertaintyIntegerDomains(child,root)),field=result.properties?.fieldCode&&deref(result.properties.fieldCode,root);
 if(field?.type==="integer"&&field.enum){
  requireShape(field.enum.length>0&&field.enum.every(value=>typeof value==="number"&&Number.isSafeInteger(value)));
  const values=[...new Set(field.enum as number[])].sort((a,b)=>a-b),ranges:{minimum:number;maximum:number}[]=[];
  for(const value of values){const last=ranges.at(-1);if(last&&value===last.maximum+1)last.maximum=value;else ranges.push({minimum:value,maximum:value});}
  const replacement={...field};delete replacement.enum;
  if(ranges.length===1){replacement.minimum=ranges[0].minimum;replacement.maximum=ranges[0].maximum;}
  else replacement.anyOf=ranges.map(range=>({type:"integer",...range}));
  result.properties!.fieldCode=replacement;
 }
 return result;
}
/** Canonical unique-field ownership bounds only ordinary emitted entries. */
function ordinaryFieldMaximum(root:Schema):number {
 const array=root.properties!.changes;
 requireShape(array.type==="array"&&array.items);
 const wrapper=deref(array.items,root);
 if(wrapper.type==="null"){requireShape(array.maxItems===0);return 0;}
 requireShape(wrapper.type==="object"&&wrapper.required?.includes("change")&&wrapper.properties?.change);
 const fields=new Set<string>();
 const visit=(raw:Schema)=>{
  const node=deref(raw,root);
  requireShape(!node.allOf&&!(node.anyOf&&node.oneOf));
  const branches=node.anyOf??node.oneOf;
  if(branches){requireShape(branches.length);branches.forEach(visit);return;}
  requireShape(node.type==="object"&&node.required?.includes("field")&&node.properties?.field);
  const field=deref(node.properties.field,root),values=Object.hasOwn(field,"const")?[field.const]:field.enum;
  requireShape(field.type==="string"&&values?.length);
  for(const value of values){requireShape(typeof value==="string"&&CHANGE_ORDER_FIELDS_V3.some(field=>field===value)&&!Object.hasOwn(root.properties!,`${value}Change`));fields.add(value);}
 };
 visit(wrapper.properties.change);
 requireShape(fields.size);return fields.size;
}
/** Internal definition alpha-renaming; no source-domain or codec change. */
function compactSourceDefinition(root:Schema):Schema {
 const names:Record<string,string>={__sources:"s",__ec:"c",__e:"e"};
 for(const name of Object.values(names))requireShape(!Object.hasOwn(root.$defs??{},name));
 const rename=(node:Schema):Schema=>{
  if(node.$ref){at(root,node.$ref);for(const name of Object.keys(names))requireShape(!node.$ref.startsWith(`#/$defs/${name}/`));}
  const result=mapSchemas(node,rename);for(const [before,after] of Object.entries(names))if(result.$ref===`#/$defs/${before}`)result.$ref=`#/$defs/${after}`;return result;
 };
 const result=rename(root);
 if(result.$defs)result.$defs=Object.fromEntries(Object.entries(result.$defs).map(([key,value])=>[names[key]??key,value]));
 return result;
}
function typedWireSchemaV3(capability?: GenerationFieldCapability,primaryEvidenceInput?:ContextInput): Schema {
  let schema = structuredClone(providerSchemaV3);
  if (capability) {
    requireShape(typeof capability.notesProposalAllowed==="boolean" && typeof capability.titlePresenceRequired==="boolean" && typeof capability.titleCorrectionAllowed==="boolean" && typeof capability.calendarProposalAllowed==="boolean");
    if(capability.titlePresenceRequired||!capability.titleCorrectionAllowed){
      const title=schema.properties!.titleChange.anyOf![0].properties!.change;
      title.anyOf=title.anyOf!.flatMap(raw=>{
        const branch=structuredClone(deref(raw,schema)),operation=branch.properties!.operation;
        if(!(operation.enum??[operation.const]).includes("SET"))return [];
        branch.properties!.operation={type:"string",enum:["SET"]};return [branch];
      });
    }
    if(capability.titlePresenceRequired){
      schema.properties!.titleChange=schema.properties!.titleChange.anyOf![0];
      schema.properties!.requestTarget=schema.properties!.requestTarget.anyOf![0];
      schema.properties!.operationCode.enum=operationWireCodes.filter((_,index)=>operationTuples[index][1]!==null);
    }
    const numeric = (value: unknown): value is NumericProposalField => NUMERIC_PROPOSAL_FIELDS.some(field => field === value);
    const clock = (value: unknown): value is ClockProposalField => CLOCK_PROPOSAL_FIELDS.some(field => field === value);
    requireShape(capability.version === "generation-field-capability-16" && typeof capability.reminderDateProposalAllowed==="boolean" && capability.allowedNumericFields.every(field => NUMERIC_PROPOSAL_FIELDS.includes(field)));
    if(!capability.reminderDateProposalAllowed)schema.properties!.reminderDateChange={type:"null"};
    requireShape(capability.allowedClockFields.every(field => CLOCK_PROPOSAL_FIELDS.includes(field)));
    if(!capability.allowedClockFields.includes("reminderTime"))schema.properties!.reminderTimeChange={type:"null"};
    if(!capability.allowedClockFields.includes("eventTime"))schema.properties!.eventTimeChange={type:"null"};
    for(const field of ["frequency","occurrenceCount"] as const)if(!capability.allowedNumericFields.includes(field))schema.properties![`${field}Change`]={type:"null"};
    const changes = deref(deref(schema.properties!.changes.items!,schema).properties!.change, schema);
    requireShape(changes.anyOf?.length);
    changes.anyOf = changes.anyOf.flatMap(raw => {
      const branch = deref(raw, schema), field = deref(branch.properties!.field, schema);
      const values = Object.hasOwn(field, "const") ? [field.const] : field.enum;
      requireShape(values?.length);
      const permitted = values.filter(value => !((capability.titlePresenceRequired || !capability.titleCorrectionAllowed) && value==="title") && (value!=="calendar" || capability.calendarProposalAllowed) && (value!=="notes" || capability.notesProposalAllowed) && (!numeric(value) || capability.allowedNumericFields.includes(value)) && (!clock(value) || capability.allowedClockFields.includes(value)));
      if (!permitted.length) return [];
      branch.properties!.field = Object.hasOwn(field, "const") ? { ...field, const: permitted[0] } : { ...field, enum: permitted };
      return [branch];
    });
    if(!changes.anyOf.length)schema.properties!.changes={type:"array",items:{type:"null"},maxItems:0};
  }
  if(primaryEvidenceInput!==undefined){
    const sourceCodebook=primaryEvidenceSourceCodebook(primaryEvidenceInput),domain=[...sourceCodebook.codes];
    const requiredClock=isInitialExplicitEventClockRequired(primaryEvidenceInput)?"eventTime":isInitialExplicitReminderClockRequired(primaryEvidenceInput)?"reminderTime":null;
    const uniqueNumeric=isInitialUniqueCadenceCountRequired(primaryEvidenceInput);
    const requiredFields=[...(requiredClock?[requiredClock]:[]),...(uniqueNumeric?["frequency","occurrenceCount"]:[])];
    for(const requiredField of requiredFields){
      const root=`${requiredField}Change`;
      const carrier=deref(schema.properties![root].anyOf![0],schema);
      const changes=deref(carrier.properties!.change,schema);
      requireShape(changes.anyOf?.length);
      changes.anyOf=changes.anyOf.flatMap(raw=>{
        const branch=deref(raw,schema),operation=branch.properties!.operation;
        if(!(operation.enum??[operation.const]).includes("SET"))return [];
        branch.properties!.operation={type:"string",enum:["SET"]};return [branch];
      });
      requireShape(changes.anyOf.length);
      schema.properties![root]=carrier;
    }
    const initialWithoutRelation=isInitialFiniteSeriesWithoutRelationSource(primaryEvidenceInput);
    const offsetAbsent=isWholeSeriesOffsetAlternativeAbsent(primaryEvidenceInput);
    const missingExclusionFields=[...requiredFields,...(isBoundExactReminderClockMissingExcluded(primaryEvidenceInput)?["reminderTime"]:[]),...(isInitialExplicitReminderIntentKnown(primaryEvidenceInput)?["intent"]:[]),...(isBoundSeriesDistanceOffsetMissingExcluded(primaryEvidenceInput)?["leadOffsetDays"]:[]),...(isBoundSeriesDistanceRelationMissingExcluded(primaryEvidenceInput)?["eventRelation"]:[]),...(initialWithoutRelation?["eventRelation","leadOffsetDays"]:[]),...(offsetAbsent?["leadOffsetDays"]:[]),...(isInitialReminderDateMissingExcluded(primaryEvidenceInput)?["reminderDate"]:[])];
    if(missingExclusionFields.length){
      const item=deref(schema.properties!.uncertainties.items!,schema),reason=deref(item.properties!.reason,schema);
      requireShape(reason.enum && reason.enum.includes("MISSING"));
      const missing=structuredClone(item),other=structuredClone(item);
      missing.properties!.reason={type:"string",enum:["MISSING"]};
      const excluded=missingExclusionFields.map(field=>UNCERTAINTY_FIELD_WIRE_CODE_V1[field as keyof typeof UNCERTAINTY_FIELD_WIRE_CODE_V1]);
      missing.properties!.fieldCode={...missing.properties!.fieldCode,enum:Object.values(UNCERTAINTY_FIELD_WIRE_CODE_V1).filter(code=>!excluded.includes(code))};
      other.properties!.reason={...reason,enum:reason.enum.filter(value=>value!=="MISSING")};
      if(uniqueNumeric){
        const supportedNumeric=isInitialSupportedCadenceCount(primaryEvidenceInput);
        const unsupported=structuredClone(item);
        unsupported.properties!.reason={type:"string",enum:["UNSUPPORTED_COMBINATION"]};
        other.properties!.reason={type:"string",enum:supportedNumeric?["AMBIGUOUS","CONFLICT","UNSUPPORTED_COMBINATION"]:["AMBIGUOUS","CONFLICT"]};
        other.properties!.fieldCode={...other.properties!.fieldCode,enum:Object.values(UNCERTAINTY_FIELD_WIRE_CODE_V1).filter(code=>code!==UNCERTAINTY_FIELD_WIRE_CODE_V1.frequency&&code!==UNCERTAINTY_FIELD_WIRE_CODE_V1.occurrenceCount)};
        schema.properties!.uncertainties.items={anyOf:supportedNumeric?[missing,other]:[missing,other,unsupported]};
      }else schema.properties!.uncertainties.items={anyOf:[missing,other]};
      // Fold only equal uncertainty shells differing in one finite control.
      // Distinct field/reason domains (including required clocks) stay paired.
      schema.properties!.uncertainties.items=coalesceBranches(schema.properties!.uncertainties.items!);
    }
    if(offsetAbsent){
      const items=deref(schema.properties!.uncertainties.items!,schema),offsetCode=UNCERTAINTY_FIELD_WIRE_CODE_V1.leadOffsetDays;
      const branches=(items.anyOf??[items]).flatMap(raw=>{
        const item=deref(raw,schema),fields=deref(item.properties!.fieldCode,schema),alternatives=deref(item.properties!.alternatives,schema);
        const domain=fields.enum??(fields.type==="integer"&&fields.minimum===0&&fields.maximum===15?Object.values(UNCERTAINTY_FIELD_WIRE_CODE_V1):undefined);
        requireShape(domain?.length&&alternatives.type==="array");
        const result:Schema[]=[],otherFields=domain.filter(code=>code!==offsetCode);
        if(otherFields.length){const other=structuredClone(item);other.properties!.fieldCode={...fields,enum:otherFields};result.push(other);}
        if(domain.includes(offsetCode)){const offset=structuredClone(item);offset.properties!.fieldCode={...fields,enum:[offsetCode]};offset.properties!.alternatives={...alternatives,maxItems:0};result.push(offset);}
        return result;
      });
      requireShape(branches.length);schema.properties!.uncertainties.items=coalesceBranches({anyOf:branches});
    }
    const absentUncertaintyCodes=[...((isInitialRelationUncertaintyAbsent(primaryEvidenceInput)||isBoundRelationUncertaintyAbsent(primaryEvidenceInput))?[UNCERTAINTY_FIELD_WIRE_CODE_V1.eventRelation]:[]),...(isWholeSeriesOffsetUncertaintyAbsent(primaryEvidenceInput)?[UNCERTAINTY_FIELD_WIRE_CODE_V1.leadOffsetDays]:[])];
    if(absentUncertaintyCodes.length){
      const items=deref(schema.properties!.uncertainties.items!,schema);
      const branches=(items.anyOf??[items]).flatMap(raw=>{
        const item=deref(raw,schema),fields=deref(item.properties!.fieldCode,schema);
        const domain=fields.enum??(fields.type==="integer"&&fields.minimum===0&&fields.maximum===15?Object.values(UNCERTAINTY_FIELD_WIRE_CODE_V1):undefined);
        requireShape(domain?.length);
        const retained=domain.filter(code=>!absentUncertaintyCodes.includes(code as 10|11));if(!retained.length)return [];
        const next=structuredClone(item);next.properties!.fieldCode={...fields,enum:retained};return [next];
      });
      requireShape(branches.length);schema.properties!.uncertainties.items=coalesceBranches({anyOf:branches});
    }
    if(isBoundMissingReminderClockWithoutCandidates(primaryEvidenceInput)){
      const reminderClockCode=UNCERTAINTY_FIELD_WIRE_CODE_V1.reminderTime;
      const items=deref(schema.properties!.uncertainties.items!,schema);
      const branches=(items.anyOf??[items]).flatMap(raw=>{
        const item=deref(raw,schema),fields=deref(item.properties!.fieldCode,schema),reasons=deref(item.properties!.reason,schema);
        const alternatives=deref(item.properties!.alternatives,schema);
        const fieldDomain=fields.enum??(fields.type==="integer"&&fields.minimum===0&&fields.maximum===15?Object.values(UNCERTAINTY_FIELD_WIRE_CODE_V1):undefined);
        requireShape(fieldDomain&&reasons.enum&&alternatives.type==="array");
        const result:Schema[]=[];
        const otherFields=fieldDomain.filter(code=>code!==reminderClockCode);
        if(otherFields.length){const other=structuredClone(item);other.properties!.fieldCode={...fields,enum:otherFields};result.push(other);}
        if(fieldDomain.includes(reminderClockCode)){
          if(reasons.enum.includes("MISSING")){const missing=structuredClone(item);missing.properties!.fieldCode={...fields,enum:[reminderClockCode]};missing.properties!.reason={...reasons,enum:["MISSING"]};missing.properties!.alternatives={...alternatives,maxItems:0};result.push(missing);}
          const otherReasons=reasons.enum.filter(reason=>reason!=="MISSING");
          if(otherReasons.length){const other=structuredClone(item);other.properties!.fieldCode={...fields,enum:[reminderClockCode]};other.properties!.reason={...reasons,enum:otherReasons};result.push(other);}
        }
        return result;
      });
      requireShape(branches.length);
      schema.properties!.uncertainties.items=coalesceBranches({anyOf:branches});
    }
    if(isBoundSourceUniqueReminderClock(primaryEvidenceInput)){
      const items=deref(schema.properties!.uncertainties.items!,schema);
      const branches=(items.anyOf??[items]).flatMap(raw=>{
        const item=deref(raw,schema),fields=deref(item.properties!.fieldCode,schema);
        const domain=fields.enum??(fields.type==="integer"&&fields.minimum===0&&fields.maximum===15?Object.values(UNCERTAINTY_FIELD_WIRE_CODE_V1):undefined);
        requireShape(domain?.length);
        const permitted=domain.filter(code=>code!==UNCERTAINTY_FIELD_WIRE_CODE_V1.reminderTime);
        if(!permitted.length)return [];
        const kept=structuredClone(item);kept.properties!.fieldCode={...fields,enum:permitted};return [kept];
      });
      requireShape(branches.length);schema.properties!.uncertainties.items=coalesceBranches({anyOf:branches});
    }
    const clockOnlyMutations=isBoundReminderClockAnswer(primaryEvidenceInput);
    const bind=(node:Schema):Schema=>{
      const result=mapSchemas(node,bind);
      if(result.properties&&Object.hasOwn(result.properties,"primaryEvidence"))result.properties.primaryEvidence={$ref:"#/$defs/__sources"};
      return result;
    };
    schema=bind(schema);schema.$defs!.__sources={type:"string",enum:domain};
    const evidence:Schema={type:"object",properties:{primaryEvidence:{$ref:"#/$defs/__sources"},additionalEvidenceJson:{type:"string"}},required:["primaryEvidence","additionalEvidenceJson"],additionalProperties:false};
    const pool=(node:Schema):Schema=>{const result=mapSchemas(node,pool);return equal(result,evidence)?{$ref:"#/$defs/__e"}:result;};
    schema=pool(schema);schema.$defs!.__e=evidence;
    // A stricter sufficient generation subset: mutating primary evidence is
    // current USER only; the unchanged backend still accepts ANY current ref.
    const currentDomain=[...sourceCodebook.currentCodes];
    const omitted:Schema={},splits=new WeakSet<Schema>();
    const specialize=(node:Schema):Schema=>{
      const result=mapSchemas(node,specialize);
      if(result.anyOf)result.anyOf=result.anyOf.flatMap(branch=>branch===omitted?[]:splits.has(branch)?branch.anyOf!:[branch]);
      requireShape(!Object.values(result.properties??{}).includes(omitted));
      const properties=result.properties;
      if(!properties?.field||!properties.operation||!properties.evidence)return result;
      const operation=properties.operation,operations=operation.enum??[operation.const];
      requireShape(operations.length>0&&operations.every(value=>["SET","REPLACE","CLEAR"].includes(String(value))));
      const mutating=operations.filter(value=>value!=="SET");if(!mutating.length)return result;
      const fields=properties.field.enum??[properties.field.const];
      requireShape(fields.length>0&&fields.every(value=>typeof value==="string"));
      const mutationFields=clockOnlyMutations?fields.filter(value=>CLOCK_PROPOSAL_FIELDS.some(field=>field===value)):fields;
      const branches:Schema[]=[];
      if(operations.includes("SET")){const kept=structuredClone(result);kept.properties!.operation={type:"string",enum:["SET"]};branches.push(kept);}
      if(currentDomain.length&&mutationFields.length){
        const changed=structuredClone(result);changed.properties!.operation={type:"string",enum:mutating};
        if(clockOnlyMutations&&properties.field.enum)changed.properties!.field={...properties.field,enum:mutationFields};
        changed.properties!.evidence={$ref:"#/$defs/__ec"};branches.push(changed);
      }
      if(!branches.length)return omitted;
      if(branches.length===1)return branches[0];
      const split:Schema={anyOf:branches};splits.add(split);return split;
    };
    schema=specialize(schema);
    if(currentDomain.length){
      schema.$defs!.__current={type:"string",enum:currentDomain};
      schema.$defs!.__ec={...structuredClone(evidence),properties:{...evidence.properties,primaryEvidence:{$ref:"#/$defs/__current"}}};
    }
  }
  // Provider dialect supports string enums, not const. Apply only after every
  // builder/specialization; internal decoder predicates remain unchanged.
  const outgoingStringEnums = (node: Schema): Schema => {
    const result = mapSchemas(node, outgoingStringEnums);
    if (typeof result.const === "string") {
      requireShape(!result.enum || result.enum.includes(result.const));
      result.enum = [result.const]; delete result.const;
    }
    return result;
  };
  // Share the one fixed object after specialization; restore its reviewed
  // scalar bounds omitted by the historical generic provider simplifier.
  const dateDefinitions=Object.entries(schema.$defs??{}).filter(([,node])=>node.type==="object"&&node.required?.length===dateWireKeys.length&&dateWireKeys.every(key=>node.required!.includes(key))).map(([key])=>key);
  const shareDate=(node:Schema):Schema=>{
    if(node.$ref&&dateDefinitions.some(key=>node.$ref===`#/$defs/${key}`))return {$ref:"#/$defs/__d"};
    if(node.type==="object"&&node.required?.length===dateWireKeys.length&&dateWireKeys.every(key=>node.required!.includes(key)))return {$ref:"#/$defs/__d"};
    return mapSchemas(node,shareDate);
  };
  schema=shareDate(schema);
  for(const key of dateDefinitions)delete schema.$defs![key];
  schema.$defs!.__d={type:"string"};
  if(primaryEvidenceInput&&isInitialEventDateYearNullRequired(primaryEvidenceInput)){
    schema.$defs!.__yearlessCivil={type:"object",properties:{kind:{type:"string",enum:["CIVIL_DATE"]},calendar:{type:"string",enum:["GREGORIAN","LUNAR_VN"]},day:{type:"integer",minimum:1,maximum:31},month:{type:"integer",minimum:1,maximum:12},year:{type:"null"},leapMonth:{anyOf:[{type:"boolean"},{type:"null"}]}},required:[...canonicalDateKeys.CIVIL_DATE],additionalProperties:false};
    const carrier=deref(schema.properties!.eventDateChange.anyOf![0],schema),changes=deref(carrier.properties!.change,schema);
    requireShape(changes.anyOf?.length);
    for(const raw of changes.anyOf){const branch=deref(raw,schema),operation=branch.properties!.operation;if((operation.enum??[operation.const]).some(value=>value==="SET"||value==="REPLACE"))branch.properties!.value={$ref:"#/$defs/__yearlessCivil"};}
  }
  schema.properties!.uncertainties.maxItems=primaryEvidenceInput&&isBoundCompleteFiniteSeriesClockAnswer(primaryEvidenceInput)?0:4;
  schema.properties!.uncertainties.items=uncertaintyIntegerDomains(schema.properties!.uncertainties.items!,schema);
  schema.properties!.changes.maxItems=ordinaryFieldMaximum(schema);
  return compactSourceDefinition(outgoingStringEnums(prune(schema)));
}
const singletonJsonRoots=singletonChangeDefinitions.map(definition=>definition.root);
export function googleLiteEuContextWireSchemaV3(capability?: GenerationFieldCapability,primaryEvidenceInput?:ContextInput): ProviderWireSchemaV3 {
 const schema=structuredClone(typedWireSchemaV3(capability,primaryEvidenceInput)),seen=new WeakSet<object>();
 for(const root of singletonJsonRoots){const node=deref(schema.properties![root],schema);for(const raw of node.anyOf??[node]){const wrapper=deref(raw,schema);if(wrapper.type==="null")continue;requireShape(wrapper.type==="object"&&wrapper.properties?.change&&equal(wrapper.required,["rank","change"])&&!seen.has(wrapper));seen.add(wrapper);wrapper.properties.change={type:"string"};}}
 return {version:CONTEXT_PROTOCOL_V3.wireVersion,schema:schema as typeof InterpretationJsonSchemaV3};
}
/** Private lexical syntax guard for a single bounded change envelope only. */
function parseSingletonChangeJson(value:unknown,path:PropertyKey[]):Record<string,unknown>{
 const fail=(stage:NonNullable<WireShapeFailure["singletonJson"]>["stage"]="JSON_SCAN",reason:NonNullable<WireShapeFailure["singletonJson"]>["reason"]="SCAN_INVALID"):never=>{throw new WireShapeFailure(path,"FIELD_CHANGE_JSON",undefined,undefined,undefined,undefined,undefined,undefined,{stage,reason})};
 if(typeof value!=="string")return fail("WIRE_VALUE","WRONG_WIRE_TYPE");
 if(value.length>32768||new TextEncoder().encode(value).length>32768)return fail("WIRE_VALUE","OVERSIZED");
 let parsed:unknown;try{parsed=JSON.parse(value)}catch{return fail("JSON_PARSE","INVALID_JSON")}
 if(!parsed||typeof parsed!=="object"||Array.isArray(parsed))return fail("JSON_PARSE","NON_OBJECT");
 const token=/[ \t\r\n]*(?:"(?:[^"\\\u0000-\u001f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*"|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null|[{}\[\]:,])[ \t\r\n]*/y;
 let position=0,nodes=0;
 const next=()=>{token.lastIndex=position;const match=token.exec(value);if(!match)return fail();position=token.lastIndex;return match[0].trim()};
 const scan=(depth:number,part=next()):void=>{
  if(depth>8)return fail("JSON_SCAN","DEPTH_LIMIT");
  if(++nodes>256)return fail("JSON_SCAN","NODE_LIMIT");
  if(part==="{"){const keys=new Set<string>();let key=next();if(key==="}")return;for(;;){if(!key.startsWith('"'))return fail();const decoded=JSON.parse(key) as string;if(keys.has(decoded))return fail("JSON_SCAN","DUPLICATE_KEY");keys.add(decoded);if(next()!==":")return fail();scan(depth+1);const separator=next();if(separator==="}")return;if(separator!==",")return fail();key=next();}}
  if(part==="["){let first=next();if(first==="]")return;for(;;){scan(depth+1,first);const separator=next();if(separator==="]")return;if(separator!==",")return fail();first=next();}}
  if(["}","]",":",","].includes(part))return fail();
 };
 scan(0);if(position!==value.length)return fail();return parsed as Record<string,unknown>;
}
function boundedTypedRefInliner(schema:Schema):(node:Schema)=>Schema{
 let nodes=0;
 const inline=(node:Schema,depth:number,refs:Set<string>):Schema=>{
  requireShape(depth<=64&&++nodes<=8192&&node&&typeof node==="object"&&!Array.isArray(node));
  if(node.$ref){requireShape(Object.keys(node).length===1&&/^#\/\$defs\/[^/]+$/u.test(node.$ref)&&!refs.has(node.$ref));return inline(at(schema,node.$ref),depth+1,new Set([...refs,node.$ref]));}
  const result=mapSchemas(node,child=>inline(child,depth+1,refs));delete result.$defs;return result;
 };
 return node=>inline(node,0,new Set());
}
function singletonTypedProjection(schema:Schema):Schema{
 const inline=boundedTypedRefInliner(schema);
 const result:Schema={type:"object",properties:Object.fromEntries(singletonJsonRoots.map(root=>[root,inline(schema.properties![root])])),required:[...singletonJsonRoots],additionalProperties:false};
 requireShape(new TextEncoder().encode(JSON.stringify(result)).length<=524288);return result;
}
/** Evidence only after the original predicate refused. Never use parsed data. */
function singletonPredicateDiagnostics(shape:Schema,change:unknown,root:string):Pick<CanonicalValidationDiagnostics,"issues"|"truncated">|undefined{
 try{
  if(!change||typeof change!=="object"||Array.isArray(change))return;
  const field=Object.getOwnPropertyDescriptor(change,"field"),operation=Object.getOwnPropertyDescriptor(change,"operation");
  if(!field||!operation||!Object.hasOwn(field,"value")||!Object.hasOwn(operation,"value"))return;
  const node=deref(shape,providerSchemaV3),branches=(node.anyOf??[node]).map(branch=>deref(branch,providerSchemaV3)).filter(branch=>branch.properties?.field&&branch.properties.operation&&predicate(branch.properties.field,field.value,providerSchemaV3)&&predicate(branch.properties.operation,operation.value,providerSchemaV3));
  if(branches.length!==1)return;
  const schema=boundedTypedRefInliner(providerSchemaV3)(branches[0]);requireShape(new TextEncoder().encode(JSON.stringify(schema)).length<=524288);
  const checked=z.fromJSONSchema(schema as Parameters<typeof z.fromJSONSchema>[0]).safeParse(change);if(checked.success)return;
  const issues=checked.error.issues.map(issue=>({...issue,path:[root,"change",...issue.path]}));
  const projected=projectCanonicalValidation({[root]:{change}},issues,"calenote-context-3");
  return {issues:projected.issues.slice(0,23),truncated:projected.truncated||projected.issues.length>23};
 }catch{return;}
}
function singletonJsonTransport(raw:Record<string,unknown>,mode:"encode"|"decode"):Record<string,unknown>{
 const own=(object:object,key:string,path:PropertyKey[])=>{const descriptor=Object.getOwnPropertyDescriptor(object,key);if(!descriptor)throw new WireShapeFailure(path,"REQUIRED_PROPERTY");if(!Object.hasOwn(descriptor,"value"))throw new WireShapeFailure(path,"object");return descriptor.value;};
 const output:Record<string,unknown>={};for(const key of Object.keys(raw))output[key]=own(raw,key,[key]);
 for(const root of singletonJsonRoots){const carrier=own(raw,root,[root]);if(carrier===null)continue;if(!carrier||typeof carrier!=="object"||Array.isArray(carrier))throw new WireShapeFailure([root],"object");requireWireKeys(carrier,["rank","change"],["rank","change"],[root]);const rank=own(carrier,"rank",[root,"rank"]),change=own(carrier,"change",[root,"change"]);
  output[root]={rank,change:mode==="encode"?JSON.stringify(change):parseSingletonChangeJson(change,[root,"change"])};
 }
 return output;
}
function assertSingletonTypedRoots(raw:Record<string,unknown>,input?:ContextInput):void{
  const projection=Object.fromEntries(singletonJsonRoots.map(root=>[root,Object.getOwnPropertyDescriptor(raw,root)?.value]));
  const schema=singletonTypedProjection(typedWireSchemaV3(input?deriveGenerationFieldCapability(input):undefined,input));
  let checked:ReturnType<z.ZodType["safeParse"]>;try{checked=z.fromJSONSchema(schema as Parameters<typeof z.fromJSONSchema>[0]).safeParse(projection)}catch{throw new WireShapeFailure([],"FIELD_CHANGE_JSON",undefined,undefined,undefined,undefined,undefined,undefined,{stage:"TYPED_PROJECTION",reason:"PROJECTION_UNAVAILABLE"})}
  if(!checked.success){const root=checked.error.issues[0]?.path[0];throw new WireShapeFailure(typeof root==="string"&&(singletonJsonRoots as readonly string[]).includes(root)?[root,"change"]:[],"FIELD_CHANGE_JSON",undefined,undefined,undefined,undefined,undefined,undefined,{stage:"TYPED_PROJECTION",reason:"INVALID_TYPED_ROOT"});}
}
export function encodeGoogleLiteEuContextV3(canonical: ConversationInterpretationV3,input?:ContextInput): unknown {
  const parsed = ConversationInterpretationV3Schema.parse(canonical);
  const generated: Record<string, unknown> = Object.fromEntries(Object.entries(parsed).filter(([key]) => key !== "schemaVersion"));
  // The generated view omits owned constants without mutating canonical data.
  if (parsed.query?.kind === "LIST") generated.query = Object.fromEntries(Object.entries(parsed.query).filter(([key]) => key !== "statusScope"));
  const output = codec(originalV3, generated, "encode", [], originalV3) as Record<string, unknown>;
  const encodedUncertainties=output.uncertainties as Array<{alternatives:Array<{evidence:unknown}>}>;
  output.uncertainties = parsed.uncertainties.map((item,index) => ({ fieldCode: UNCERTAINTY_FIELD_WIRE_CODE_V1[item.field], reason: item.reason, alternatives: item.alternatives.map((alternative,position) => JSON.stringify({value:alternative.value,evidence:encodedUncertainties[index].alternatives[position].evidence})) }));
  return singletonJsonTransport(indexedChangeCarriers(operationValues(dateJsonOperands(output,"encode",!!input&&isInitialEventDateYearNullRequired(input)),"encode"),"encode"),"encode");
}
export function parseGoogleLiteEuContextSectionsV3(raw: unknown, selected: ContextProtocolV3, observeInvalid?: Parameters<typeof parseInterpretationSectionsV3>[1], observeWireInvalid?: Parameters<typeof parseInterpretationSectionsV3>[1], observeDecoded?: (value: unknown) => void): InterpretationSectionsV3 {
  return decodeContextSectionsV3(raw, selected, false, observeInvalid, observeWireInvalid, observeDecoded) as InterpretationSectionsV3;
}
export function decodeGoogleLiteEuContextTransportV3(raw:unknown,selected:ContextProtocolV3,observeInvalid?:Parameters<typeof parseInterpretationSectionsV3>[1],observeWireInvalid?:Parameters<typeof parseInterpretationSectionsV3>[1],input?:ContextInput) {
  return decodeContextSectionsV3(raw,selected,true,observeInvalid,observeWireInvalid,undefined,input);
}
function decodeContextSectionsV3(raw: unknown, selected: ContextProtocolV3, staged:boolean, observeInvalid?: Parameters<typeof parseInterpretationSectionsV3>[1], observeWireInvalid?: Parameters<typeof parseInterpretationSectionsV3>[1], observeDecoded?: (value: unknown) => void,input?:ContextInput): {status:"PARSED";value:ContextGatewayInterpretation}|{status:"REFUSED";reason:"ENVELOPE_INVALID"|"SEMANTIC_PATCH_INVALID"} {
  if (!isContextProtocolV3(selected)) return { status: "REFUSED", reason: "ENVELOPE_INVALID" };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    observeWireInvalid?.(projectWireValidation(raw, [], "object", undefined, "calenote-context-3"));
    return { status: "REFUSED", reason: "ENVELOPE_INVALID" };
  }
  const guidance = new Set(["conversationDirective", "replyProposal"]);
  const coreKeys = originalV3.required!.filter(key => !guidance.has(key));
  try {
    const expanded=singletonJsonTransport(raw as Record<string,unknown>,"decode");
    const unfolded=indexedChangeCarriers(expanded,"decode",input ? deriveGenerationFieldCapability(input).titlePresenceRequired : false,!!input&&isInitialEventDateYearNullRequired(input));
    assertSingletonTypedRoots(expanded,input);
    const pointed=input?expandPrimaryEvidenceSourceCodes(unfolded,input):unfolded;
    const object = dateJsonOperands(operationValues(materializeProviderEvidence(pointed,input,input!==undefined) as Record<string,unknown>,"decode"),"decode",!!input&&isInitialEventDateYearNullRequired(input));
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
    const diagnostic=error instanceof EvidencePointerFailure ? projectWireValidation(raw,error.path,"EVIDENCE_SOURCE_POINTER",undefined,"calenote-context-3") : error instanceof WireShapeFailure ? projectWireValidation(raw, error.path, error.expected, error.extraKeyCount, "calenote-context-3", error.cardinality, error.control) : projectCanonicalValidation(raw, [], "calenote-context-3");
    if(error instanceof EvidencePointerFailure)diagnostic.issues[0].evidencePointer=error.diagnostic;
    if(error instanceof WireShapeFailure&&error.dateOperand)diagnostic.issues[0].dateOperand=error.dateOperand;
    if(error instanceof WireShapeFailure&&error.singletonJson)diagnostic.issues[0].singletonJson={...error.singletonJson};
    if(error instanceof WireShapeFailure&&error.catalogue){const catalogue=projectCatalogueDiagnostic(error.catalogue);if(catalogue)diagnostic.issues[0].catalogue=catalogue;}
    if(error instanceof WireShapeFailure&&error.projectedIssues){diagnostic.issues.push(...error.projectedIssues.issues.slice(0,23));diagnostic.truncated||=error.projectedIssues.truncated;}
    if(error instanceof WireShapeFailure){const shape=projectUncertaintyWireShape(raw,error.path,uncertaintyFieldByCode);if(shape){diagnostic.issues[0].uncertaintyShape=shape;if(error.path[2]==="fieldCode"&&shape.fieldCode===undefined)delete diagnostic.issues[0].actualSafeToken;}}
    try{observeWireInvalid?.(diagnostic);}catch{ /* Diagnostic observers cannot alter failclosed refusal. */ }
    return { status: "REFUSED", reason: "SEMANTIC_PATCH_INVALID" };
  }
}

/** Structural primitives shared with the separately versioned typed transport.
 * Existing wire104 calls retain their default behavior and exact bytes. */
export const contextTypedWirePrimitives = Object.freeze({
 selectedSchema:typedWireSchemaV3, originalSchema:originalV3,
 canonicalCodec:(raw:unknown,direction:"encode"|"decode")=>codec(originalV3,raw,direction,[],originalV3,false,true),
 indexedChanges:(raw:Record<string,unknown>,direction:"encode"|"decode",required=false)=>indexedChangeCarriers(raw,direction,required,false,true),
 canonicalField:(key:string,value:unknown)=>codec(originalV3.properties![key],value,"decode",[key],originalV3,false,true),
 operationValues, singletonChangeDefinitions,
});

export const GOOGLE_LITE_EU_WIRE_SCHEMA_VERSION = "google-gemini-2.5-flash-lite-vertex-eu-defs-1" as const;
export interface ProviderWireSchema<T> { version: typeof GOOGLE_LITE_EU_WIRE_SCHEMA_VERSION; schema: T; }
export interface ProviderWireSchemaV3 { version: import("../../../conversation/context-contract/protocol").ContextProtocolV3["wireVersion"]; schema: ReturnType<typeof import("../../../conversation/context-contract/contracts").ConversationInterpretationV3Schema.toJSONSchema>; }
const maps = new Set(["properties", "patternProperties", "definitions", "$defs", "dependentSchemas"]);
const singles = new Set(["additionalProperties", "additionalItems", "unevaluatedProperties", "unevaluatedItems", "contains", "propertyNames", "not", "if", "then", "else"]);
const arrays = new Set(["allOf", "anyOf", "oneOf", "prefixItems"]);
const escapePointer = (key: string) => key.replaceAll("~", "~0").replaceAll("/", "~1");
/** Provider-specific namespace adaptation; never visits literal instance data. */
export function googleLiteEuProviderWireSchema<T>(canonical: T): ProviderWireSchema<T> {
  const pointers = new Map<string, string>();
  const references: Array<{ output: Record<string, unknown>; reference: string }> = [];
  const visit = (value: unknown, before: string, after: string): unknown => {
    if (typeof value === "boolean") { pointers.set(before, after); return value; }
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("PROVIDER_SCHEMA_INVALID_NODE");
    pointers.set(before, after);
    const node = value as Record<string, unknown>, output: Record<string, unknown> = {};
    if (Object.hasOwn(node, "definitions") && Object.hasOwn(node, "$defs")) throw new Error("PROVIDER_SCHEMA_NAMESPACE_COLLISION");
    for (const [key, item] of Object.entries(node)) {
      const destination = key === "definitions" ? "$defs" : key;
      const oldPath = before + "/" + escapePointer(key), newPath = after + "/" + escapePointer(destination);
      if (key === "$ref") {
        if (typeof item !== "string") throw new Error("PROVIDER_SCHEMA_UNRESOLVED_REF");
        references.push({ output, reference: item });
        output[key] = item;
      } else if (maps.has(key)) {
        if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("PROVIDER_SCHEMA_INVALID_NODE");
        output[destination] = Object.fromEntries(Object.entries(item).map(([name, child]) => {
          const suffix = "/" + escapePointer(name);
          return [name, visit(child, oldPath + suffix, newPath + suffix)];
        }));
      } else if (arrays.has(key) || key === "items" && Array.isArray(item)) {
        if (!Array.isArray(item)) throw new Error("PROVIDER_SCHEMA_INVALID_NODE");
        output[key] = item.map((child, index) => visit(child, oldPath + "/" + index, newPath + "/" + index));
      } else if (singles.has(key) || key === "items") output[key] = visit(item, oldPath, newPath);
      else if (key === "dependencies" && item && typeof item === "object" && !Array.isArray(item)) {
        output[key] = Object.fromEntries(Object.entries(item).map(([name, child]) => {
          const suffix = "/" + escapePointer(name);
          return [name, Array.isArray(child) ? structuredClone(child) : visit(child, oldPath + suffix, newPath + suffix)];
        }));
      } else output[key] = structuredClone(item);
    }
    return output;
  };
  const schema = visit(canonical, "#", "#") as T;
  for (const { output, reference } of references) {
    if (!reference.startsWith("#")) throw new Error("PROVIDER_SCHEMA_EXTERNAL_REF");
    let pointer: string;
    try { pointer = decodeURIComponent(reference); } catch { throw new Error("PROVIDER_SCHEMA_UNRESOLVED_REF"); }
    const translated = pointers.get(pointer);
    if (translated === undefined) throw new Error("PROVIDER_SCHEMA_UNRESOLVED_REF");
    // Pointer lookup uses decoded tokens; the emitted URI fragment must encode
    // them again or literal percent sequences change the reference's target.
    output.$ref = "#" + encodeURI(translated.slice(1)).replaceAll("#", "%23");
  }
  return { version: GOOGLE_LITE_EU_WIRE_SCHEMA_VERSION, schema };
}

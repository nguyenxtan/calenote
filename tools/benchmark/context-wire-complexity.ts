/** Syntactic review metrics, NOT Google's proprietary state calculator.
 * Count schema nodes once as emitted, including $defs; never expand references. */
export function contextWireComplexity(schema: unknown) {
  const counts = { objects: 0, properties: 0, required: 0, nullableUnions: 0, unions: 0, branches: 0, enums: 0, enumValues: 0, definitions: 0, references: 0, arrays: 0, maxObjectDepth: 0 };
  function visit(value: unknown, depth = 0) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    const node = value as Record<string, unknown>;
    if (node.type === "object") { counts.objects++; depth++; counts.maxObjectDepth = Math.max(counts.maxObjectDepth, depth); }
    if (node.type === "array") counts.arrays++;
    if (typeof node.$ref === "string") counts.references++;
    for (const key of ["properties", "$defs"]) if (node[key] && typeof node[key] === "object") {
      const values = Object.values(node[key] as Record<string, unknown>);
      if (key === "properties") counts.properties += values.length; else counts.definitions += values.length;
      values.forEach(child => visit(child, depth));
    }
    if (Array.isArray(node.required)) counts.required += node.required.length;
    if (Array.isArray(node.enum)) { counts.enums++; counts.enumValues += node.enum.length; }
    for (const key of ["anyOf", "oneOf", "allOf"]) if (Array.isArray(node[key])) {
      const values = node[key] as Array<Record<string, unknown>>;
      if (key !== "allOf") { counts.unions++; counts.branches += values.length; if (values.some(child => child.type === "null")) counts.nullableUnions++; }
      values.forEach(child => visit(child, depth));
    }
    if (node.items) visit(node.items, depth);
  }
  visit(schema); return counts;
}

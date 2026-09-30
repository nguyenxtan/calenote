// @vitest-environment node
import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { InterpretationJsonSchema, parseInterpretationSections } from "../../../conversation/context-contract/contracts";
import { googleLiteEuProviderWireSchema } from "./provider-wire-schema";

it("translates schema namespaces and local pointers while preserving property names and literal data", () => {
  const literal = { definitions: { data: { $ref: "#/definitions/do-not-rewrite" } }, $defs: { untouched: true } };
  const canonical = { type: "object", definitions: { Flag: { type: "boolean" } },
    properties: { definitions: { type: "object", definitions: { Inner: { type: "string" } }, properties: { value: { $ref: "#/properties/definitions/definitions/Inner" } } },
      flag: { $ref: "#/definitions/Flag" }, payload: { const: literal, enum: [literal], default: literal } } };
  const before = JSON.stringify(canonical), wire = googleLiteEuProviderWireSchema(canonical);
  expect(wire.version).toBe("google-gemini-2.5-flash-lite-vertex-eu-defs-1");
  expect(wire.schema).toEqual({ type: "object", $defs: { Flag: { type: "boolean" } },
    properties: { definitions: { type: "object", $defs: { Inner: { type: "string" } }, properties: { value: { $ref: "#/properties/definitions/$defs/Inner" } } },
      flag: { $ref: "#/$defs/Flag" }, payload: { const: literal, enum: [literal], default: literal } } });
  expect(JSON.stringify(canonical)).toBe(before);
});

it("fails closed on namespace collisions and unresolved or external references", () => {
  expect(() => googleLiteEuProviderWireSchema({ definitions: { A: {} }, $defs: { B: {} } })).toThrow("PROVIDER_SCHEMA_NAMESPACE_COLLISION");
  expect(() => googleLiteEuProviderWireSchema({ properties: { bad: { $ref: "#/definitions/Absent" } } })).toThrow("PROVIDER_SCHEMA_UNRESOLVED_REF");
  expect(() => googleLiteEuProviderWireSchema({ $ref: "https://example.test/schema" })).toThrow("PROVIDER_SCHEMA_EXTERNAL_REF");
});

it("preserves URI fragment resolution for percent, whitespace, Unicode and hash names", () => {
  const canonical = { definitions: { "A%20B": { type: "boolean" }, "A B": { type: "string" }, "é#": { type: "number" } },
    properties: { "%20": { $ref: "#/definitions/A%2520B" }, space: { $ref: "#/definitions/A%20B" },
      unicode: { $ref: "#/definitions/%C3%A9%23" }, pointer: { $ref: "#/properties/%2520" },
      literal: { const: { $ref: "#/definitions/A%2520B" } } } };
  expect(googleLiteEuProviderWireSchema(canonical).schema).toEqual({
    $defs: { "A%20B": { type: "boolean" }, "A B": { type: "string" }, "é#": { type: "number" } },
    properties: { "%20": { $ref: "#/$defs/A%2520B" }, space: { $ref: "#/$defs/A%20B" },
      unicode: { $ref: "#/$defs/%C3%A9%23" }, pointer: { $ref: "#/properties/%2520" },
      literal: { const: { $ref: "#/definitions/A%2520B" } } } });
});

it("retains canonical validation and exact frozen schema while changing only the provider namespace", () => {
  const before = JSON.stringify(InterpretationJsonSchema), hash = (text: string) => createHash("sha256").update(text).digest("hex");
  expect(hash(before)).toBe("8f1b868f606fd39972adc8984666f62960bf6c6f5ad38ff64774997b8765ba2d");
  const wire = googleLiteEuProviderWireSchema(InterpretationJsonSchema);
  expect(hash(JSON.stringify(wire.schema))).toBe("1ccd317a66f7de068d6f4e29a38346a880898a8445b1dad256a34c23bc1d0446");
  expect(JSON.stringify(InterpretationJsonSchema)).toBe(before);
  expect(parseInterpretationSections({ ok: true })).toEqual({ status: "REFUSED", reason: "SEMANTIC_PATCH_INVALID" });
});

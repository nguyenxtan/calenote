import { describe, expect, it } from "vitest";
import { z } from "zod";
import { LegacyV2UncertaintySchema as UncertaintySchema, LegacyV2parseInterpretationSections as parseInterpretationSections } from "../../../conversation/context-contract/contracts";
import * as wire from "./context-provider-wire";
import { ConversationInterpretationV3Schema, parseInterpretationSectionsV3 } from "../../../conversation/context-contract/contracts";
import { CONTEXT_PROTOCOL_V3 } from "../../../conversation/context-contract/protocol";

// Protocol snapshot is explicit: reordering the canonical declaration cannot
// change V1 wire meaning. Domain coverage below is independently derived.
const v1 = { title: 0, location: 1, notes: 2, eventDate: 3, eventTime: 4,
  reminderDate: 5, reminderTime: 6, calendar: 7, frequency: 8,
  occurrenceCount: 9, eventRelation: 10, leadOffsetDays: 11, endDate: 12,
  intent: 13, queryRange: 14, operation: 15 };
const base = { schemaVersion: "calenote-context-2", intent: "HELP", dialogueAct: "GREET", continuation: "NO", changes: [], query: null, uncertainties: [], controlEvidence: [], conversationDirective: { kind: "HELP", topic: "GENERAL" }, replyProposal: null };
const successorBase = { schemaVersion: "calenote-context-3", intent: "HELP", requestTarget: null, changes: [], query: null, uncertainties: [], conversationDirective: { kind: "HELP", topic: "GENERAL" }, replyProposal: null };
it.each(Object.entries(v1))("all_16_codes_roundtrip_and_unknown_code_rejects: %s=%s", (field, fieldCode) => {
  const canonical = ConversationInterpretationV3Schema.parse({ ...successorBase, uncertainties: [{ field, reason: "MISSING", alternatives: [] }] });
  const encoded = wire.encodeGoogleLiteEuContextV3(canonical) as Record<string, unknown>;
  expect(encoded.uncertainties).toEqual([{ fieldCode, reason: "MISSING", alternatives: [] }]);
  expect(wire.parseGoogleLiteEuContextSectionsV3(encoded, CONTEXT_PROTOCOL_V3)).toEqual(parseInterpretationSectionsV3(canonical));
  for (const invalid of [-1, 16, 0.5, "0", null]) expect(wire.parseGoogleLiteEuContextSectionsV3({ ...encoded, uncertainties: [{ fieldCode: invalid, reason: "MISSING", alternatives: [] }] }, CONTEXT_PROTOCOL_V3).status).toBe("REFUSED");
});
it("v3_alternative_json_and_mandatory_evidence_are_atomic", () => {
  const encoded = wire.encodeGoogleLiteEuContextV3(ConversationInterpretationV3Schema.parse(successorBase)) as Record<string, unknown>;
  for (const text of ["{", JSON.stringify({ value: "NEW", evidence: [] }), JSON.stringify({ value: "EDIT", evidence: [{ kind: "USER_QUOTE", turn: 0, quote: "new", occurrence: 1 }] }), JSON.stringify({ value: "NEW", evidence: [{ kind: "USER_QUOTE", turn: 0, quote: "new", occurrence: 1 }], extra: true })]) {
    expect(wire.parseGoogleLiteEuContextSectionsV3({ ...encoded, uncertainties: [{ fieldCode: 15, reason: "AMBIGUOUS", alternatives: [text] }] }, CONTEXT_PROTOCOL_V3).status).toBe("REFUSED");
  }
});
const publicCodeShape = () => z.object({ properties: z.object({ uncertainties: z.object({ items: z.object({ properties: z.object({ fieldCode: z.object({ type: z.literal("integer"), minimum: z.number(), maximum: z.number() }).passthrough() }).passthrough() }) }) }) }).parse(wire.legacyV2GoogleLiteEuContextWireSchema().schema).properties.uncertainties.items.properties;
describe("immutable uncertainty field codebook V1", () => {
  it.each(Object.entries(v1))("round trips established %s code %s", (field, fieldCode) => {
    const canonical = { ...base, uncertainties: [{ field, reason: "MISSING", alternatives: [] }] };
    const encoded = wire.legacyV2EncodeGoogleLiteEuContext(canonical) as Record<string, unknown>;
    expect(encoded.uncertainties).toEqual([{ fieldCode, reason: "MISSING", alternatives: [] }]);
    expect(wire.legacyV2ParseGoogleLiteEuContextSections(encoded)).toEqual(parseInterpretationSections(canonical));
  });
  it("keeps exact canonical domain and unique established V1 code meanings", () => {
    expect(wire.UNCERTAINTY_FIELD_WIRE_CODE_V1).toEqual(v1);
    expect(Object.isFrozen(wire.UNCERTAINTY_FIELD_WIRE_CODE_V1)).toBe(true);
    expect(Object.keys(v1).sort()).toEqual(UncertaintySchema.options.map(b => b.shape.field.value).sort());
    expect(new Set(Object.values(v1)).size).toBe(16);
  });
  it("advertises integer bounds not an arbitrary string or high-state enum", () => {
    const properties = publicCodeShape();
    expect(properties.fieldCode).toMatchObject({ type: "integer", minimum: 0, maximum: 15 });
    expect(properties).not.toHaveProperty("field");
    expect(properties.fieldCode).not.toHaveProperty("enum");
  });
  it.each([-1, 16, 0.5, "0", null, undefined, NaN, Infinity])("rejects active invalid code %# independently", fieldCode => {
    const encoded = { ...wire.legacyV2EncodeGoogleLiteEuContext(base) as object, uncertainties: [{ fieldCode, reason: "MISSING", alternatives: [] }] };
    expect(wire.legacyV2ParseGoogleLiteEuContextSections(encoded).status).toBe("REFUSED");
    expect(z.fromJSONSchema(publicCodeShape().fieldCode).safeParse(fieldCode).success).toBe(false);
  });
  it("rejects unsupported application-selected wire version before decoding", () => {
    expect(wire.legacyV2ParseGoogleLiteEuContextSections(wire.legacyV2EncodeGoogleLiteEuContext(base), undefined, undefined, "unknown-version").status).toBe("REFUSED");
  });
  it("model cannot select codebook version or use old field names", () => {
    for (const item of [{ field: "title", reason: "MISSING", alternatives: [] }, { fieldCode: 0, codebookVersion: "v1", reason: "MISSING", alternatives: [] }]) {
      expect(wire.legacyV2ParseGoogleLiteEuContextSections({ ...wire.legacyV2EncodeGoogleLiteEuContext(base) as object, uncertainties: [item] }).status).toBe("REFUSED");
    }
  });
  it("identifies the new structural code path without retaining invalid values", () => {
    const diagnostics: unknown[] = [];
    const encoded = { ...wire.legacyV2EncodeGoogleLiteEuContext(base) as object, uncertainties: [{ fieldCode: "sensitive-code-value", reason: "MISSING", alternatives: [] }] };
    expect(wire.legacyV2ParseGoogleLiteEuContextSections(encoded, undefined, d => diagnostics.push(d)).status).toBe("REFUSED");
    expect(JSON.stringify(diagnostics)).toContain('"uncertainties",0,"fieldCode"');
    expect(JSON.stringify(diagnostics)).not.toContain("sensitive-code-value");
  });
});

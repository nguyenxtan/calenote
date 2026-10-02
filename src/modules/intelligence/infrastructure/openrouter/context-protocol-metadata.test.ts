// @vitest-environment node
import { expect, it } from "vitest";
import { LegacyV2ConversationInterpretationSchema as ConversationInterpretationSchema, LegacyV2parseInterpretationSections as parseInterpretationSections } from "../../../conversation/context-contract/contracts";
import { legacyV2EncodeGoogleLiteEuContext as encodeGoogleLiteEuContext, legacyV2GoogleLiteEuContextWireSchema as googleLiteEuContextWireSchema, legacyV2ParseGoogleLiteEuContextSections as parseGoogleLiteEuContextSections } from "./context-provider-wire";
import { ConversationInterpretationV3Schema } from "../../../conversation/context-contract/contracts";
import { CONTEXT_PROTOCOL_V3, type ContextProtocolV3 } from "../../../conversation/context-contract/protocol";
import { encodeGoogleLiteEuContextV3, parseGoogleLiteEuContextSectionsV3 } from "./context-provider-wire";

const canonical = { schemaVersion: "calenote-context-2", intent: "HELP", dialogueAct: "GREET", continuation: "NO", changes: [], query: null,
  uncertainties: [], controlEvidence: [], conversationDirective: { kind: "HELP", topic: "GENERAL" }, replyProposal: null };
const canonicalV3 = ConversationInterpretationV3Schema.parse({ schemaVersion: "calenote-context-3", intent: "LIST_REMINDERS", requestTarget: null, changes: [], query: { kind: "LIST", period: { kind: "UPCOMING" }, statusScope: "DEFAULT", evidence: [{ kind: "USER_QUOTE", turn: 0, quote: "upcoming", occurrence: 1 }] }, uncertainties: [], conversationDirective: { kind: "HELP", topic: "GENERAL" }, replyProposal: null });
it("successor_decoder_binds_version_and_default_status_locally", () => {
  const wire = encodeGoogleLiteEuContextV3(canonicalV3) as Record<string, unknown>;
  expect(wire).not.toHaveProperty("schemaVersion"); expect(wire.query).not.toHaveProperty("statusScope");
  expect(parseGoogleLiteEuContextSectionsV3(wire, CONTEXT_PROTOCOL_V3)).toMatchObject({ status: "PARSED", value: { semantic: { schemaVersion: "calenote-context-3", query: { statusScope: "DEFAULT" } } } });
  for (const metadata of ["schemaVersion", "wireVersion", "codebookVersion"]) expect(parseGoogleLiteEuContextSectionsV3({ ...wire, [metadata]: "arbitrary" }, CONTEXT_PROTOCOL_V3).status).toBe("REFUSED");
  expect(parseGoogleLiteEuContextSectionsV3({ ...wire, query: { ...wire.query as object, statusScope: "DEFAULT" } }, CONTEXT_PROTOCOL_V3).status).toBe("REFUSED");
});
it.each(Object.keys(CONTEXT_PROTOCOL_V3))("unsupported_selected_%s_rejects_without_model_selection", key => {
  const wire = encodeGoogleLiteEuContextV3(canonicalV3);
  expect(parseGoogleLiteEuContextSectionsV3(wire, { ...CONTEXT_PROTOCOL_V3, [key]: "unsupported" } as unknown as ContextProtocolV3).status).toBe("REFUSED");
});

it("application binds fixed protocol metadata when the provider omits it (R02 structural regression)", () => {
  const wire = encodeGoogleLiteEuContext(canonical) as Record<string, unknown>;
  delete wire.schemaVersion;
  const parsed = parseGoogleLiteEuContextSections(wire);
  expect(parsed).toEqual(parseInterpretationSections(canonical));
  expect(parsed).toMatchObject({ status: "PARSED", value: { semantic: { schemaVersion: "calenote-context-2" }, fullSchemaValid: true } });
});

it("provider output schema and encoder do not delegate the application version to the model", () => {
  const wire = googleLiteEuContextWireSchema().schema;
  expect(wire.properties).not.toHaveProperty("schemaVersion");
  expect(wire.required).not.toContain("schemaVersion");
  expect(encodeGoogleLiteEuContext(canonical)).not.toHaveProperty("schemaVersion");
});

it.each(["calenote-context-2", "calenote-context-1", "calenote-context-999", "arbitrary-protocol"])("model version %s cannot select or downgrade a decoder", schemaVersion => {
  expect(parseGoogleLiteEuContextSections({ ...encodeGoogleLiteEuContext(canonical) as object, schemaVersion })).toMatchObject({ status: "REFUSED" });
});

it("unknown application contract fails closed rather than being reinterpreted", () => {
  expect(ConversationInterpretationSchema.safeParse({ ...canonical, schemaVersion: "calenote-context-999" }).success).toBe(false);
  expect(() => encodeGoogleLiteEuContext({ ...canonical, schemaVersion: "calenote-context-999" })).toThrow();
});

it("real semantic discriminators remain authoritative proposals subject to strict validation", () => {
  const wire = encodeGoogleLiteEuContext(canonical) as Record<string, unknown>;
  expect(parseGoogleLiteEuContextSections({ ...wire, intent: "ARBITRARY" })).toMatchObject({ status: "REFUSED" });
  expect(parseGoogleLiteEuContextSections({ ...wire, dialogueAct: "ARBITRARY" })).toMatchObject({ status: "REFUSED" });
});

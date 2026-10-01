// @vitest-environment node
import { expect, it } from "vitest";
import { ConversationInterpretationSchema, parseInterpretationSections } from "../../../conversation/context-contract/contracts";
import { encodeGoogleLiteEuContext, googleLiteEuContextWireSchema, parseGoogleLiteEuContextSections } from "./context-provider-wire";

const canonical = { schemaVersion: "calenote-context-2", intent: "HELP", dialogueAct: "GREET", continuation: "NO", changes: [], query: null,
  uncertainties: [], controlEvidence: [], conversationDirective: { kind: "HELP", topic: "GENERAL" }, replyProposal: null };

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
